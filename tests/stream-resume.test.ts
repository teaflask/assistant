import type { Message } from "@ag-ui/core";
import { describe, expect, it } from "vitest";

import {
  resumeMarkerRecorder,
  SseFrameIdScanner,
  StreamResumeStore,
} from "../src/transport/stream-resume";

function _sseResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function _chunkedSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

async function _drainThroughScanner(
  scanner: SseFrameIdScanner,
  response: Response,
): Promise<string> {
  const fetched = scanner.wrap(() => Promise.resolve(response));
  const teed = await fetched("https://example.test/stream", {});
  return teed.text();
}

describe("SseFrameIdScanner", () => {
  it("commits an id only at its frame's terminating blank line", async () => {
    const scanner = new SseFrameIdScanner();
    const body = 'id: 7\ndata: {"type":"A"}\n\nid: 8\ndata: {"type":"B"}';

    await _drainThroughScanner(scanner, _sseResponse(body));

    // Frame 8 never completed — the parser never dispatched it, so the
    // cursor must not claim it.
    expect(scanner.lastEventId).toBe("7");
  });

  it("survives frames split across arbitrary chunk boundaries", async () => {
    const scanner = new SseFrameIdScanner();
    const chunks = [
      "id: 1",
      '2\ndata: {"ty',
      'pe":"A"}\n',
      "\nid: 34\n",
      'data: {"type":"B"}\n\n',
    ];

    await _drainThroughScanner(scanner, _chunkedSseResponse(chunks));

    expect(scanner.lastEventId).toBe("34");
  });

  it("ignores frames without an id and keeps the last committed cursor", async () => {
    const scanner = new SseFrameIdScanner();
    const body = 'id: 5\ndata: {"type":"A"}\n\ndata: {"type":"B"}\n\n';

    await _drainThroughScanner(scanner, _sseResponse(body));

    expect(scanner.lastEventId).toBe("5");
  });

  it("refuses a non-decimal id", async () => {
    const scanner = new SseFrameIdScanner();
    const body = 'id: nonsense\ndata: {"type":"A"}\n\n';

    await _drainThroughScanner(scanner, _sseResponse(body));

    expect(scanner.lastEventId).toBeNull();
  });

  it("passes the bytes through untouched", async () => {
    const scanner = new SseFrameIdScanner();
    const body = 'id: 7\ndata: {"type":"A","text":"héllo→"}\n\n';

    const drained = await _drainThroughScanner(scanner, _sseResponse(body));

    expect(drained).toBe(body);
  });

  it("a keepalive-only body counts as bytes seen while committing no cursor", async () => {
    // The live-but-idle stream: a resumed connection with nothing new to
    // replay speaks only comment pings. It must read as a connection
    // that responded — the mid-stream/no-response split in failure
    // classification rides this — without the replay cursor pretending a
    // frame was committed.
    const scanner = new SseFrameIdScanner();

    await _drainThroughScanner(scanner, _sseResponse(": ping\n\n: ping\n\n"));

    expect(scanner.bodyBytesSeen).toBe(true);
    expect(scanner.lastEventId).toBeNull();
  });

  it("clears the liveness fact per connection, keeping the committed cursor", async () => {
    const scanner = new SseFrameIdScanner();
    await _drainThroughScanner(
      scanner,
      _sseResponse('id: 7\ndata: {"type":"A"}\n\n'),
    );
    expect(scanner.bodyBytesSeen).toBe(true);

    // The retried connection: wrapping resets the per-connection state
    // before any of the new body arrives — bytes seen is a fact about
    // THIS connection, while the cursor survives for the resume echo.
    const fetched = scanner.wrap(() =>
      Promise.resolve(_sseResponse(": ping\n\n")),
    );
    const teed = await fetched("https://example.test/stream", {});
    expect(scanner.bodyBytesSeen).toBe(false);
    expect(scanner.lastEventId).toBe("7");

    await teed.text();
    expect(scanner.bodyBytesSeen).toBe(true);
    expect(scanner.lastEventId).toBe("7");
  });

  it("leaves non-SSE responses unwrapped", async () => {
    const scanner = new SseFrameIdScanner();
    const response = new Response('{"detail":"nope"}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const fetched = scanner.wrap(() => Promise.resolve(response));

    const result = await fetched("https://example.test/stream", {});

    expect(result).toBe(response);
    expect(scanner.lastEventId).toBeNull();
  });

  it("leaves error responses unwrapped for the error path to parse", async () => {
    const scanner = new SseFrameIdScanner();
    const response = new Response('{"detail":"gone"}', {
      status: 404,
      headers: { "content-type": "application/json" },
    });
    const fetched = scanner.wrap(() => Promise.resolve(response));

    const result = await fetched("https://example.test/stream", {});

    expect(result).toBe(response);
  });

  it("keeps the committed cursor across a retried connection but drops partial frame state", async () => {
    const scanner = new SseFrameIdScanner();
    await _drainThroughScanner(
      scanner,
      _sseResponse('id: 7\ndata: {"type":"A"}\n\nid: 9\ndata: {"tru'),
    );
    expect(scanner.lastEventId).toBe("7");

    await _drainThroughScanner(
      scanner,
      _sseResponse('id: 11\ndata: {"type":"B"}\n\n'),
    );

    expect(scanner.lastEventId).toBe("11");
  });
});

describe("StreamResumeStore", () => {
  it("records a settled pair and detaches it from the live message list", () => {
    const store = new StreamResumeStore();
    const messages: Message[] = [
      { id: "m-1", role: "assistant", content: "Steep it." },
    ];

    store.recordPair("42", messages);
    messages.push({ id: "m-2", role: "assistant", content: "Mutation." });

    expect(store.snapshot?.afterId).toBe("42");
    expect(store.snapshot?.messages).toHaveLength(1);
  });

  it("accumulates divider anchors across snapshots", () => {
    const store = new StreamResumeStore();

    expect(
      store.recordResumeAnchor("run-1", "m-1", { attempt: 2, round: 0 }, null),
    ).toBe(true);
    // The same resumption — same run, same wire (round, attempt) —
    // re-delivered under a DRIFTED message id records nothing: one
    // divider per resumption, ever.
    expect(
      store.recordResumeAnchor("run-1", "m-9", { attempt: 2, round: 0 }, null),
    ).toBe(false);
    // The run's next resumption — a later round's retry — is genuinely
    // distinct and anchors; and a payload-less legacy marker takes the
    // timestamp-keyed legacy branch, off every emitted key (writers
    // only emit at attempt > 1).
    expect(
      store.recordResumeAnchor("run-1", "m-2", { attempt: 2, round: 1 }, null),
    ).toBe(true);
    expect(store.recordResumeAnchor("run-1", "m-3", undefined, 181_000)).toBe(
      true,
    );

    expect([...store.resumeAnchors.keys()].sort()).toEqual([
      "m-1",
      "m-2",
      "m-3",
    ]);
    expect(store.resumeAnchors.get("m-1")).toEqual({ attempt: 2, round: 0 });
    // Undefined payloads store as null: presence must survive .get() reads.
    expect(store.resumeAnchors.get("m-3")).toBeNull();
  });

  it("two rounds of one run, each retrying once, produce four distinct marker keys — (round, attempt) varies on BOTH axes", () => {
    // THE parameter space: tests that only vary the run id cannot see
    // a cross-round collision. Hold ONE run id fixed and let the
    // payload do all the work — four (round, attempt) combinations,
    // four distinct keys, asserted across the whole set. Falsified by
    // construction: with the key derivation reverted to attempt-only
    // (the defect, and the wrong-fix shape), the grid collapses to two
    // keys and this test fails.
    const store = new StreamResumeStore();
    const grid = [
      { round: 0, attempt: 1 },
      { round: 0, attempt: 2 },
      { round: 1, attempt: 1 },
      { round: 1, attempt: 2 },
    ];
    for (const [index, payload] of grid.entries()) {
      expect(
        store.recordResumeAnchor("run-1", `m-${String(index)}`, payload, null),
      ).toBe(true);
    }
    expect(store.resumeAnchors.size).toBe(4);
    // The re-delivery sweep: every combination re-derives its key under
    // a drifted message id and is refused.
    for (const [index, payload] of grid.entries()) {
      expect(
        store.recordResumeAnchor("run-1", `n-${String(index)}`, payload, null),
      ).toBe(false);
    }
    expect(store.resumeAnchors.size).toBe(4);
  });

  it("a round-less pre-rollout marker still renders and still arbitrates — RULING PIN", () => {
    // The rollout ruling, premise stated at recordResumeAnchor: the
    // identity projection serves stored rows verbatim — never
    // re-validated through the Pydantic model — so a pre-rollout row
    // genuinely arrives as {attempt, segment: null} with NO round key,
    // stamped with its write-time timestamp. RULING PIN, not a
    // regression test: this shape also anchored pre-fix (the ordinal
    // ignored the payload); what it pins is the wire-key path's
    // tolerance surviving the ordinal's deletion.
    const store = new StreamResumeStore();
    expect(
      store.recordResumeAnchor(
        "run-1",
        "m-1",
        { attempt: 2, segment: null },
        1_000,
      ),
    ).toBe(true);
    // The payload stores untouched — the divider renders whatever rode
    // the wire.
    expect(store.resumeAnchors.get("m-1")).toEqual({
      attempt: 2,
      segment: null,
    });
    // Re-delivered under a drifted id — the same stored row, so the
    // same stamped timestamp — the legacy row is refused.
    expect(
      store.recordResumeAnchor(
        "run-1",
        "m-9",
        { attempt: 2, segment: null },
        1_000,
      ),
    ).toBe(false);
  });

  it("distinct pre-rollout resumptions keep distinct keys — the row's own timestamp holds them apart, divider and severance alike", () => {
    // The round-3 correction (FAILED against the round-keyed store,
    // which collapsed these to one anchor): a round-less row keys on
    // its stamped timestamp — wire data too; every stored row gets one
    // at write and the identity projection replays stored bytes
    // verbatim, so a re-delivery re-derives the same key while
    // genuinely distinct legacy resumptions keep distinct keys. A
    // suppressed anchor never costs just the hairline — it also
    // suppresses that window's severance — which is why these must
    // anchor, not collapse.
    const store = new StreamResumeStore();
    expect(
      store.recordResumeAnchor("run-1", "m-1", { attempt: 2 }, 1_000),
    ).toBe(true);
    expect(
      store.recordResumeAnchor("run-1", "m-2", { attempt: 2 }, 61_000),
    ).toBe(true);
    // Payload-less legacy markers ride the same fallback.
    expect(store.recordResumeAnchor("run-1", "m-3", null, 121_000)).toBe(true);
    // Re-deliveries — same stored rows, drifted message ids — refuse.
    expect(
      store.recordResumeAnchor("run-1", "m-x", { attempt: 2 }, 1_000),
    ).toBe(false);
    expect(store.recordResumeAnchor("run-1", "m-y", null, 121_000)).toBe(false);
    expect([...store.resumeAnchors.keys()].sort()).toEqual([
      "m-1",
      "m-2",
      "m-3",
    ]);
  });

  it("the recorder reads the legacy key's timestamp off the raw event — the block-timing anchors' posture", () => {
    // Round-less frames carry no round to key on; the recorder must
    // hand the store the event's own stamped timestamp (present on
    // every stored row, replayed verbatim), or every legacy row would
    // take the untimed collapse path.
    const store = new StreamResumeStore();
    const recorder = resumeMarkerRecorder(
      (runId, messageId, markerValue, markerTimestamp) => {
        store.recordResumeAnchor(
          runId,
          messageId,
          markerValue,
          markerTimestamp,
        );
      },
    );
    void recorder.onRunStartedEvent?.({ event: { runId: "run-1" } } as never);
    void recorder.onCustomEvent?.({
      event: { name: "run_resumed", value: { attempt: 2 }, timestamp: 1_000 },
    } as never);
    void recorder.onMessagesChanged?.({ messages: [{ id: "m-a" }] } as never);
    // A genuinely distinct legacy resumption: a later write, later stamp.
    void recorder.onCustomEvent?.({
      event: { name: "run_resumed", value: { attempt: 2 }, timestamp: 61_000 },
    } as never);
    void recorder.onMessagesChanged?.({
      messages: [{ id: "m-a" }, { id: "m-b" }],
    } as never);
    expect([...store.resumeAnchors.keys()].sort()).toEqual(["m-a", "m-b"]);
    // The first row re-delivered — same stored bytes, same stamp,
    // drifted message id — refuses.
    void recorder.onCustomEvent?.({
      event: { name: "run_resumed", value: { attempt: 2 }, timestamp: 1_000 },
    } as never);
    void recorder.onMessagesChanged?.({
      messages: [{ id: "m-a" }, { id: "m-b" }, { id: "m-x" }],
    } as never);
    expect(store.resumeAnchors.has("m-x")).toBe(false);
  });

  it("untimed round-less markers collapse on equal attempt — the residual's FULL cost: the divider and that window's severance", () => {
    // The one shape that still degrades, now purely defensive: a
    // round-less marker with NO timestamp — which no writer ever
    // produced (run_event_draft_of stamps every stored row) — collides
    // on equal attempt. First-wins: never a crash, never a misplaced
    // divider, but the suppressed anchor loses BOTH the hairline and
    // the severance of its window (abandoned calls keep reading
    // in-progress).
    const store = new StreamResumeStore();
    expect(store.recordResumeAnchor("run-1", "m-1", { attempt: 2 }, null)).toBe(
      true,
    );
    expect(store.recordResumeAnchor("run-1", "m-2", { attempt: 2 }, null)).toBe(
      false,
    );
    expect(store.recordResumeAnchor("run-1", "m-3", undefined, null)).toBe(
      true,
    );
    expect(store.recordResumeAnchor("run-1", "m-4", undefined, null)).toBe(
      false,
    );
    expect([...store.resumeAnchors.keys()].sort()).toEqual(["m-1", "m-3"]);
  });

  it("a re-delivery re-derives the same wire key — the background attach's replay refuses every re-delivered marker", () => {
    // Regression test: the key must be identical on BOTH replay paths —
    // the live tail that first anchored, and a boundary-snapped
    // replay's re-delivery. The teeth are now payload-derived: two
    // recorder passes over the same wire order share one store; the
    // second pass carries DRIFTED message ids — the exact re-delivery
    // shape — and must anchor nothing new.
    const store = new StreamResumeStore();
    const recorderInto = () =>
      resumeMarkerRecorder((runId, messageId, markerValue, markerTimestamp) => {
        store.recordResumeAnchor(
          runId,
          messageId,
          markerValue,
          markerTimestamp,
        );
      });
    const drive = (anchorA: string, anchorB: string) => {
      // The recorder's handlers are synchronous; the void satisfies the
      // subscriber type's async-capable signatures.
      const recorder = recorderInto();
      void recorder.onRunStartedEvent?.({
        event: { runId: "run-1" },
      } as never);
      void recorder.onCustomEvent?.({
        event: { name: "run_resumed", value: { attempt: 2, round: 0 } },
      } as never);
      void recorder.onMessagesChanged?.({
        messages: [{ id: anchorA }],
      } as never);
      void recorder.onCustomEvent?.({
        event: { name: "run_resumed", value: { attempt: 2, round: 1 } },
      } as never);
      void recorder.onMessagesChanged?.({
        messages: [{ id: anchorA }, { id: anchorB }],
      } as never);
    };

    // The live pass anchors both resumptions…
    drive("m-b", "m-c");
    // …and the attach's re-delivery, under drifted ids, re-derives the
    // same (run, round, attempt) keys and is refused wholesale.
    drive("m-x", "m-y");

    expect([...store.resumeAnchors.keys()].sort()).toEqual(["m-b", "m-c"]);
  });

  it("survives the shape the ordinal could not: a second RUN_STARTED mid-run neither suppresses nor duplicates", () => {
    // The shape a per-run ordinal cannot survive: a terminal row
    // followed by more rows under the SAME run id synthesizes a second
    // RUN_STARTED, which would restart a per-run count mid-run — the
    // next genuine marker would re-derive an already-taken key and lose
    // its divider. The wire key has no count to restart: each marker
    // carries its own (round, attempt).
    const store = new StreamResumeStore();
    const recorder = resumeMarkerRecorder(
      (runId, messageId, markerValue, markerTimestamp) => {
        store.recordResumeAnchor(
          runId,
          messageId,
          markerValue,
          markerTimestamp,
        );
      },
    );
    void recorder.onRunStartedEvent?.({ event: { runId: "run-1" } } as never);
    void recorder.onCustomEvent?.({
      event: { name: "run_resumed", value: { attempt: 2, round: 0 } },
    } as never);
    void recorder.onMessagesChanged?.({ messages: [{ id: "m-a" }] } as never);
    // The synthesized mid-run restart: a second RUN_STARTED, same run.
    void recorder.onRunStartedEvent?.({ event: { runId: "run-1" } } as never);
    void recorder.onCustomEvent?.({
      event: { name: "run_resumed", value: { attempt: 2, round: 1 } },
    } as never);
    void recorder.onMessagesChanged?.({
      messages: [{ id: "m-a" }, { id: "m-b" }],
    } as never);

    // The later round's genuine divider anchored (the ordinal would
    // have re-derived m-a's key and dropped it)…
    expect([...store.resumeAnchors.keys()].sort()).toEqual(["m-a", "m-b"]);
    // …and re-deliveries of both, under drifted ids, are refused.
    expect(
      store.recordResumeAnchor("run-1", "m-x", { attempt: 2, round: 0 }, null),
    ).toBe(false);
    expect(
      store.recordResumeAnchor("run-1", "m-y", { attempt: 2, round: 1 }, null),
    ).toBe(false);
  });

  it("anchors one delivery receipt per delivery run, ever", () => {
    // A re-delivery can flush under a drifted message id (a reconnect's
    // replay against a longer message list); the run id arbitrates.
    const store = new StreamResumeStore();
    const results = [
      { ordinal: 0, label: "Audit the billing exports", succeeded: true },
    ];

    expect(store.recordSubagentDelivery("run-1", "m-1", results)).toBe(true);
    expect(store.recordSubagentDelivery("run-1", "m-9", results)).toBe(false);

    expect([...store.subagentDeliveryAnchors.keys()]).toEqual(["m-1"]);
    expect(store.subagentDeliveryAnchors.get("m-1")).toEqual(results);
  });
});
