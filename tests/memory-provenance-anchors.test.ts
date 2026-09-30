// The memory-provenance anchor laws: the durable memory id is the
// reconcile key (one write is ever one row, however many times the
// replay re-delivers it), the payload is narrowed from unknown with the
// package's caps, and stream order is what consumers list. The
// attribution laws: each write anchors to the assistant prose message
// whose run caused it — first attribution wins, a prose-less run drops
// its writes honestly, and a marker arriving after the terminal still
// attributes (the post-settle arrival the footer must engage on).

import { describe, expect, it, vi } from "vitest";

import {
  EMPTY_MEMORY_ATTRIBUTION_ANCHORS,
  EMPTY_MEMORY_PROVENANCE_ANCHORS,
  memoryFootersOf,
  memoryUpdatedAnchorOf,
  memoryUpdatedRecorder,
  wellFormedMemoryAttributionAnchorsOf,
  wellFormedMemoryProvenanceAnchorsOf,
  withMemoryAttributed,
  withMemoryUpdateAnchored,
  type MemoryUpdated,
} from "../src/core/memory-provenance-anchors";

const A_WIRE_VALUE = {
  memory_id: "3e0f2a4c-1111-4222-8333-944444444444",
  scope: "org",
  summary: "Saved a note to memory.",
};

const NARROWED: MemoryUpdated = {
  memoryId: "3e0f2a4c-1111-4222-8333-944444444444",
  scope: "org",
  summary: "Saved a note to memory.",
};

describe("memoryUpdatedAnchorOf", () => {
  it("narrows the wire payload to the typed provenance record", () => {
    expect(memoryUpdatedAnchorOf(A_WIRE_VALUE)).toEqual(NARROWED);
  });

  it("ignores payloads without the reconcile key or the sentence", () => {
    expect(memoryUpdatedAnchorOf(null)).toBeNull();
    expect(
      memoryUpdatedAnchorOf({ ...A_WIRE_VALUE, memory_id: "" }),
    ).toBeNull();
    expect(
      memoryUpdatedAnchorOf({ ...A_WIRE_VALUE, summary: "  " }),
    ).toBeNull();
    expect(memoryUpdatedAnchorOf({ ...A_WIRE_VALUE, scope: 7 })).toBeNull();
  });

  it("keeps unknown scope tokens verbatim, capped — the renderer owns the fallback", () => {
    const narrowed = memoryUpdatedAnchorOf({
      ...A_WIRE_VALUE,
      scope: "workspace",
    });
    expect(narrowed?.scope).toBe("workspace");
    const runaway = memoryUpdatedAnchorOf({
      ...A_WIRE_VALUE,
      scope: "x".repeat(200),
    });
    expect(runaway?.scope).toHaveLength(64);
  });
});

describe("withMemoryUpdateAnchored", () => {
  it("reconciles by memory id — a re-delivery is a no-op, never a duplicate", () => {
    const anchors = withMemoryUpdateAnchored(
      EMPTY_MEMORY_PROVENANCE_ANCHORS,
      NARROWED,
    );
    expect(anchors.size).toBe(1);
    // The replayed duplicate — same durable id, even a drifted sentence —
    // updates nothing and appends nothing: first anchor wins.
    const replayed = withMemoryUpdateAnchored(anchors, {
      ...NARROWED,
      summary: "Saved.",
    });
    expect(replayed).toBe(anchors);
  });

  it("lists writes in stream order", () => {
    let anchors = withMemoryUpdateAnchored(
      EMPTY_MEMORY_PROVENANCE_ANCHORS,
      NARROWED,
    );
    anchors = withMemoryUpdateAnchored(anchors, {
      ...NARROWED,
      memoryId: "later-id",
    });
    expect([...anchors.keys()]).toEqual([NARROWED.memoryId, "later-id"]);
  });
});

describe("wellFormedMemoryProvenanceAnchorsOf", () => {
  it("drops malformed entries rather than crashing the seed", () => {
    const stored = new Map<string, MemoryUpdated>([
      ["good", NARROWED],
      ["bad", { ...NARROWED, summary: 7 } as never],
    ]);
    const seeded = wellFormedMemoryProvenanceAnchorsOf(stored);
    expect([...seeded.keys()]).toEqual(["good"]);
  });
});

describe("withMemoryAttributed", () => {
  it("first attribution wins — a re-delivery against a drifted message list is a map-identity no-op", () => {
    const anchors = withMemoryAttributed(
      EMPTY_MEMORY_ATTRIBUTION_ANCHORS,
      "mem-1",
      "p1",
    );
    expect(anchors.get("mem-1")).toBe("p1");
    // The drifted re-delivery: same durable id, a different message —
    // identity, not just equality, so publish gates see no change.
    expect(withMemoryAttributed(anchors, "mem-1", "p9")).toBe(anchors);
  });
});

describe("wellFormedMemoryAttributionAnchorsOf", () => {
  it("drops pairs that are not two non-empty strings", () => {
    const stored = new Map<string, string>([
      ["good", "p1"],
      ["empty", ""],
      ["bad", 7 as never],
    ]);
    expect([...wellFormedMemoryAttributionAnchorsOf(stored).keys()]).toEqual([
      "good",
    ]);
  });
});

describe("memoryFootersOf", () => {
  it("groups attributed writes under their message in stream order", () => {
    let provenance = withMemoryUpdateAnchored(
      EMPTY_MEMORY_PROVENANCE_ANCHORS,
      NARROWED,
    );
    provenance = withMemoryUpdateAnchored(provenance, {
      ...NARROWED,
      memoryId: "later-id",
    });
    let attribution = withMemoryAttributed(
      EMPTY_MEMORY_ATTRIBUTION_ANCHORS,
      NARROWED.memoryId,
      "p1",
    );
    attribution = withMemoryAttributed(attribution, "later-id", "p1");
    const footers = memoryFootersOf(provenance, attribution);
    expect(footers.get("p1")?.map((update) => update.memoryId)).toEqual([
      NARROWED.memoryId,
      "later-id",
    ]);
  });

  it("skips provenance without attribution — an old history renders no footer, never a synthesized one", () => {
    const provenance = withMemoryUpdateAnchored(
      EMPTY_MEMORY_PROVENANCE_ANCHORS,
      NARROWED,
    );
    const footers = memoryFootersOf(
      provenance,
      EMPTY_MEMORY_ATTRIBUTION_ANCHORS,
    );
    expect(footers.size).toBe(0);
  });
});

// The recorder's attribution laws, driven through its typed handlers the
// way @ag-ui/client dispatches them. The epoch-level proof (the real
// subscriber wiring, the settled-then-marker ordering across macrotasks)
// lives in connection-epoch.test.ts.
describe("memoryUpdatedRecorder attribution", () => {
  const PROSE_MESSAGES = [
    { id: "u1", role: "user", content: "Remember I prefer sencha." },
    { id: "p1", role: "assistant", content: "Noted — sencha it is." },
  ];

  function recorderHarness() {
    const onMemoryAnchored = vi.fn();
    const onMemoryAttributed = vi.fn();
    const recorder = memoryUpdatedRecorder({
      onMemoryAnchored,
      onMemoryAttributed,
    });
    return { recorder, onMemoryAnchored, onMemoryAttributed };
  }

  const A_MARKER_EVENT = {
    event: { type: "CUSTOM", name: "memory_updated", value: A_WIRE_VALUE },
  } as never;

  it("buffers a mid-run write and flushes it to the run's own prose at the terminal", () => {
    const { recorder, onMemoryAttributed } = recorderHarness();
    void recorder.onRunStartedEvent?.({
      event: { type: "RUN_STARTED", runId: "run-1" },
      messages: [PROSE_MESSAGES[0]],
    } as never);
    void recorder.onCustomEvent?.(A_MARKER_EVENT);
    // Mid-run: nothing attributed yet — the prose may not exist.
    expect(onMemoryAttributed).not.toHaveBeenCalled();
    void recorder.onMessagesChanged?.({ messages: PROSE_MESSAGES } as never);
    void recorder.onRunFinishedEvent?.({
      event: { type: "RUN_FINISHED" },
    } as never);
    expect(onMemoryAttributed).toHaveBeenCalledWith(NARROWED.memoryId, "p1");
  });

  it("drops a prose-less run's writes under the REAL pipeline ordering — seeded history's prose never adopts them", () => {
    // The round-1 review's finding, pinned as the regression test. A
    // fresh epoch's agent is SEEDED with history (no onMessagesChanged
    // fires before RUN_STARTED — seeding is construction, not an
    // event), so the run's first message change re-presents the
    // PREVIOUS turn's prose alongside the new tool-call message. The
    // baseline taken at RUN_STARTED is what keeps that old prose from
    // reading as "authored this run". (This test's predecessor
    // established the baseline via a pre-run onMessagesChanged — an
    // ordering the real pipeline never produces — and was vacuously
    // green against the broken code.)
    const { recorder, onMemoryAnchored, onMemoryAttributed } =
      recorderHarness();
    void recorder.onRunInitialized?.({} as never);
    // RUN_STARTED carries the seeded pre-run list, prior prose included.
    void recorder.onRunStartedEvent?.({
      event: { type: "RUN_STARTED", runId: "run-2" },
      messages: PROSE_MESSAGES,
    } as never);
    // The run's only message is a tool call — no new prose.
    void recorder.onMessagesChanged?.({
      messages: [
        ...PROSE_MESSAGES,
        {
          id: "a-tool",
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "t-mem",
              type: "function",
              function: { name: "add_memory", arguments: "{}" },
            },
          ],
        },
      ],
    } as never);
    void recorder.onCustomEvent?.(A_MARKER_EVENT);
    void recorder.onRunFinishedEvent?.({
      event: { type: "RUN_FINISHED" },
    } as never);
    // The provenance record still lands (the tool row tells the story);
    // only the footer attribution is withheld — the previous turn's
    // prose must not adopt this run's write.
    expect(onMemoryAnchored).toHaveBeenCalledTimes(1);
    expect(onMemoryAttributed).not.toHaveBeenCalled();
  });

  it("attributes a post-terminal arrival immediately — no later event will flush for it", () => {
    const { recorder, onMemoryAttributed } = recorderHarness();
    void recorder.onRunStartedEvent?.({
      event: { type: "RUN_STARTED", runId: "run-1" },
      messages: [PROSE_MESSAGES[0]],
    } as never);
    void recorder.onMessagesChanged?.({ messages: PROSE_MESSAGES } as never);
    void recorder.onRunFinishedEvent?.({
      event: { type: "RUN_FINISHED" },
    } as never);
    void recorder.onCustomEvent?.(A_MARKER_EVENT);
    expect(onMemoryAttributed).toHaveBeenCalledWith(NARROWED.memoryId, "p1");
  });

  it("a post-terminal arrival after a prose-less run still drops — the seeded baseline holds past the terminal", () => {
    const { recorder, onMemoryAttributed } = recorderHarness();
    void recorder.onRunInitialized?.({} as never);
    void recorder.onRunStartedEvent?.({
      event: { type: "RUN_STARTED", runId: "run-2" },
      messages: PROSE_MESSAGES,
    } as never);
    void recorder.onRunFinishedEvent?.({
      event: { type: "RUN_FINISHED" },
    } as never);
    void recorder.onCustomEvent?.(A_MARKER_EVENT);
    expect(onMemoryAttributed).not.toHaveBeenCalled();
  });

  it("onRunInitialized clears buffered writes — a StrictMode replacement must not double-flush", () => {
    const { recorder, onMemoryAttributed } = recorderHarness();
    void recorder.onRunStartedEvent?.({
      event: { type: "RUN_STARTED", runId: "run-1" },
      messages: [],
    } as never);
    void recorder.onCustomEvent?.(A_MARKER_EVENT);
    void recorder.onRunInitialized?.({} as never);
    void recorder.onMessagesChanged?.({ messages: PROSE_MESSAGES } as never);
    void recorder.onRunFinishedEvent?.({
      event: { type: "RUN_FINISHED" },
    } as never);
    expect(onMemoryAttributed).not.toHaveBeenCalled();
  });
});
