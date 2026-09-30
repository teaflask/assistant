import type { Message } from "@ag-ui/core";
import { describe, expect, it, vi } from "vitest";

import { ServingReplayStreamAgent } from "../src/transport/replay-stream-agent";
import {
  resumeMarkerRecorder,
  resumeSnapshotRecorder,
  StreamResumeStore,
} from "../src/transport/stream-resume";

const STREAM_URL =
  "https://api.example.test/serving/v1/assistant-threads/t-1/stream";
const STREAM_THREAD_ID = "assistant-thread-1";

interface Frame {
  id?: string;
  data: Record<string, unknown>;
}

function _sseBody(frames: Frame[]): string {
  return frames
    .map(
      (frame) =>
        `${frame.id === undefined ? "" : `id: ${frame.id}\n`}data: ${JSON.stringify(frame.data)}\n\n`,
    )
    .join("");
}

function _capturingFetch(frames: Frame[]) {
  const captured: { body?: Record<string, unknown> } = {};
  const fetchFn = (url: string, requestInit: RequestInit) => {
    captured.body = JSON.parse(requestInit.body as string) as Record<
      string,
      unknown
    >;
    return Promise.resolve(
      new Response(_sseBody(frames), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
  };
  return { captured, fetchFn };
}

function _settledTextTurn(
  runId: string,
  messageId: string,
  text: string,
  firstRowId: number,
): Frame[] {
  return [
    { data: { type: "RUN_STARTED", threadId: STREAM_THREAD_ID, runId } },
    {
      id: String(firstRowId),
      data: { type: "TEXT_MESSAGE_START", messageId, role: "assistant" },
    },
    {
      id: String(firstRowId + 1),
      data: { type: "TEXT_MESSAGE_CONTENT", messageId, delta: text },
    },
    {
      id: String(firstRowId + 2),
      data: { type: "TEXT_MESSAGE_END", messageId },
    },
    {
      id: String(firstRowId + 3),
      data: { type: "RUN_FINISHED", threadId: STREAM_THREAD_ID, runId },
    },
  ];
}

function _agentOver(frames: Frame[], resume?: StreamResumeStore) {
  const { captured, fetchFn } = _capturingFetch(frames);
  const agent = new ServingReplayStreamAgent({
    streamUrl: STREAM_URL,
    streamThreadId: STREAM_THREAD_ID,
    authorizedFetch: fetchFn,
    resume,
  });
  return { agent, captured };
}

// The <ResumeSnapshotRecorder/> component's wiring, without React: the
// recorder rides the subscriber list of the mounted agent only.
function _recordInto(
  agent: ServingReplayStreamAgent,
  store: StreamResumeStore,
) {
  return agent.subscribe(
    resumeSnapshotRecorder(() => agent.resumeCursor, store),
  );
}

// onRunFinalized rides the pipeline's finalize as a floating promise —
// it can land just after connectAgent resolves, so recording assertions
// wait a macrotask out.
function _finalizeSettles(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ServingReplayStreamAgent", () => {
  it("full-replays with no cursor when there is no snapshot", async () => {
    const { agent, captured } = _agentOver(
      _settledTextTurn("run-1", "m-1", "Steep it.", 1),
      new StreamResumeStore(),
    );

    await agent.connectAgent();

    expect(captured.body?.forwardedProps).toEqual({});
    expect(agent.messages.map((message) => message.id)).toEqual(["m-1"]);
  });

  it("asks for the tail past the snapshot and uploads no transcript", async () => {
    const store = new StreamResumeStore();
    store.recordPair("4", [
      { id: "m-1", role: "assistant", content: "Steep it." },
    ]);
    const { agent, captured } = _agentOver(
      _settledTextTurn("run-2", "m-2", "Three minutes.", 5),
      store,
    );

    await agent.connectAgent();

    expect(captured.body?.forwardedProps).toEqual({ after_id: "4" });
    // Watch-only endpoint: the seeded transcript must not ride the body.
    expect(captured.body?.messages).toEqual([]);
    expect(agent.messages.map((message) => message.id)).toEqual(["m-1", "m-2"]);
  });

  it("cannot duplicate seeded content when a server ignores the cursor", async () => {
    const store = new StreamResumeStore();
    const seeded: Message[] = [
      { id: "u-1", role: "user", content: "How do I brew?" },
      {
        id: "a-1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tc-1",
            type: "function",
            function: { name: "grep", arguments: "{}" },
          },
        ],
      },
      { id: "tr-1", role: "tool", content: "3 matches", toolCallId: "tc-1" },
      { id: "m-1", role: "assistant", content: "Steep it." },
    ];
    store.recordPair("6", seeded);
    const fullReplay: Frame[] = [
      {
        data: {
          type: "RUN_STARTED",
          threadId: STREAM_THREAD_ID,
          runId: "run-1",
        },
      },
      {
        id: "1",
        data: {
          type: "TOOL_CALL_START",
          toolCallId: "tc-1",
          toolCallName: "grep",
          parentMessageId: "a-1",
        },
      },
      {
        id: "2",
        data: { type: "TOOL_CALL_ARGS", toolCallId: "tc-1", delta: "{}" },
      },
      { id: "3", data: { type: "TOOL_CALL_END", toolCallId: "tc-1" } },
      {
        id: "4",
        data: {
          type: "TOOL_CALL_RESULT",
          messageId: "tr-1",
          toolCallId: "tc-1",
          content: "3 matches",
        },
      },
      {
        id: "5",
        data: {
          type: "TEXT_MESSAGE_START",
          messageId: "m-1",
          role: "assistant",
        },
      },
      {
        id: "5",
        data: {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "m-1",
          delta: "Steep it.",
        },
      },
      { id: "6", data: { type: "TEXT_MESSAGE_END", messageId: "m-1" } },
      {
        id: "6",
        data: {
          type: "RUN_FINISHED",
          threadId: STREAM_THREAD_ID,
          runId: "run-1",
        },
      },
      ..._settledTextTurn("run-2", "m-2", "Three minutes.", 7),
    ];
    const { agent } = _agentOver(fullReplay, store);

    await agent.connectAgent();

    expect(agent.messages.map((message) => message.id)).toEqual([
      "u-1",
      "a-1",
      "tr-1",
      "m-1",
      "m-2",
    ]);
    const toolCallCarriers = agent.messages.filter(
      (message) =>
        message.role === "assistant" &&
        (message.toolCalls ?? []).some((toolCall) => toolCall.id === "tc-1"),
    );
    expect(toolCallCarriers).toHaveLength(1);
    const steepIt = agent.messages.find((message) => message.id === "m-1");
    expect(steepIt?.content).toBe("Steep it.");
  });

  it("records the resume pair when a run settles cleanly", async () => {
    const store = new StreamResumeStore();
    const { agent } = _agentOver(
      _settledTextTurn("run-1", "m-1", "Steep it.", 1),
      store,
    );
    _recordInto(agent, store);

    await agent.connectAgent();
    await _finalizeSettles();

    expect(store.snapshot?.afterId).toBe("4");
    expect(store.snapshot?.messages.map((message) => message.id)).toEqual([
      "m-1",
    ]);
  });

  it("two rounds of one run that each retried once anchor TWO resumptions — attempt is per-round and must not collide the key", async () => {
    // `attempt` resets per ROUND under one run id, so round 0 retried
    // once and round 1 retried once both say attempt 2 — and each
    // marker carries its round on the wire, so the store's (runId,
    // round, attempt) key holds the two resumptions apart with no
    // client-side counting. An attempt-only key collides and
    // permanently drops the second round's anchor on every full replay
    // — and with it that window's severance.
    const store = new StreamResumeStore();
    const twoRoundsEachRetried: Frame[] = [
      {
        data: {
          type: "RUN_STARTED",
          threadId: STREAM_THREAD_ID,
          runId: "run-1",
        },
      },
      {
        id: "1",
        data: {
          type: "TEXT_MESSAGE_START",
          messageId: "m-a",
          role: "assistant",
        },
      },
      { id: "2", data: { type: "TEXT_MESSAGE_END", messageId: "m-a" } },
      // Round 0's retry.
      {
        id: "3",
        data: {
          type: "CUSTOM",
          name: "run_resumed",
          value: { attempt: 2, round: 0 },
        },
      },
      {
        id: "4",
        data: {
          type: "TEXT_MESSAGE_START",
          messageId: "m-b",
          role: "assistant",
        },
      },
      { id: "5", data: { type: "TEXT_MESSAGE_END", messageId: "m-b" } },
      // Round 1's retry — same attempt, its own round on the wire.
      {
        id: "6",
        data: {
          type: "CUSTOM",
          name: "run_resumed",
          value: { attempt: 2, round: 1 },
        },
      },
      {
        id: "7",
        data: {
          type: "TEXT_MESSAGE_START",
          messageId: "m-c",
          role: "assistant",
        },
      },
      { id: "8", data: { type: "TEXT_MESSAGE_END", messageId: "m-c" } },
    ];
    const { agent } = _agentOver(twoRoundsEachRetried, store);
    // Wired exactly as connection-epoch wires it — all four recorder
    // args forwarded. Round-4 parity fix: this line's claim was false
    // while the markerTimestamp forward was dropped onto a signature
    // default, silently exercising a wiring in which every round-less
    // row would have taken the untimed collapse path; the parameter is
    // required now, so the omission cannot recur silently.
    agent.subscribe(
      resumeMarkerRecorder((runId, messageId, markerValue, markerTimestamp) => {
        store.recordResumeAnchor(
          runId,
          messageId,
          markerValue,
          markerTimestamp,
        );
      }),
    );

    await agent.connectAgent();
    await _finalizeSettles();

    expect([...store.resumeAnchors.keys()].sort()).toEqual(["m-b", "m-c"]);
  });

  it("records the pair at a parked quiet close — blocks closed, no terminal", async () => {
    // The parked contract ends the stream with no terminal, only its
    // open blocks closed. A background attach seeds its fresh agent from
    // this pair; before round 4 nothing recorded here and the attach
    // re-seeded an EMPTY transcript over a parked page.
    const store = new StreamResumeStore();
    const parkedClose: Frame[] = [
      {
        data: {
          type: "RUN_STARTED",
          threadId: STREAM_THREAD_ID,
          runId: "run-1",
        },
      },
      {
        id: "1",
        data: {
          type: "TEXT_MESSAGE_START",
          messageId: "m-1",
          role: "assistant",
        },
      },
      {
        id: "2",
        data: {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "m-1",
          delta: "Watching the child.",
        },
      },
      { id: "3", data: { type: "TEXT_MESSAGE_END", messageId: "m-1" } },
      {
        id: "4",
        data: {
          type: "TOOL_CALL_START",
          toolCallId: "tc-1",
          toolCallName: "dispatch_subagent",
        },
      },
      {
        id: "5",
        data: { type: "TOOL_CALL_ARGS", toolCallId: "tc-1", delta: "{}" },
      },
      { id: "6", data: { type: "TOOL_CALL_END", toolCallId: "tc-1" } },
    ];
    const { agent } = _agentOver(parkedClose, store);
    _recordInto(agent, store);

    await agent.connectAgent();
    await _finalizeSettles();

    expect(store.snapshot?.afterId).toBe("6");
    expect(store.snapshot?.messages.map((message) => message.id)).toContain(
      "m-1",
    );
    expect(
      store.snapshot?.messages.some(
        (message) =>
          message.role === "assistant" &&
          (message.toolCalls ?? []).some((toolCall) => toolCall.id === "tc-1"),
      ),
    ).toBe(true);
  });

  it("keeps the previous pair through a silently-closed resumed stream", async () => {
    const store = new StreamResumeStore();
    store.recordPair("4", [
      { id: "m-1", role: "assistant", content: "Steep it." },
    ]);
    const { agent } = _agentOver([], store);
    _recordInto(agent, store);

    await agent.connectAgent();
    await _finalizeSettles();

    expect(store.snapshot?.afterId).toBe("4");
  });

  it("an unsubscribed (unmounted) recorder never records", async () => {
    const store = new StreamResumeStore();
    const { agent } = _agentOver(
      _settledTextTurn("run-1", "m-1", "Steep it.", 1),
      store,
    );
    _recordInto(agent, store).unsubscribe();

    await agent.connectAgent();
    await _finalizeSettles();

    expect(store.snapshot).toBeNull();
  });

  it("records nothing when the connection dies mid-run", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const store = new StreamResumeStore();
    // The stream closes after a partial run — no terminal ever arrives
    // (a proxy timeout's shape). The applied messages stop mid-run and
    // must not become a resume pair.
    const midRunDeath: Frame[] = [
      {
        data: {
          type: "RUN_STARTED",
          threadId: STREAM_THREAD_ID,
          runId: "run-1",
        },
      },
      {
        id: "1",
        data: {
          type: "TEXT_MESSAGE_START",
          messageId: "m-1",
          role: "assistant",
        },
      },
      {
        id: "2",
        data: {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "m-1",
          delta: "Half a",
        },
      },
    ];
    const { agent } = _agentOver(midRunDeath, store);
    _recordInto(agent, store);

    await agent.connectAgent().catch(() => undefined);
    await _finalizeSettles();

    expect(store.snapshot).toBeNull();
    consoleError.mockRestore();
  });

  it("records the pair when the thread settles failed (RUN_ERROR)", async () => {
    const store = new StreamResumeStore();
    const failedTurn: Frame[] = [
      {
        data: {
          type: "RUN_STARTED",
          threadId: STREAM_THREAD_ID,
          runId: "run-1",
        },
      },
      {
        id: "1",
        data: {
          type: "TEXT_MESSAGE_START",
          messageId: "m-1",
          role: "assistant",
        },
      },
      { id: "2", data: { type: "TEXT_MESSAGE_END", messageId: "m-1" } },
      { id: "3", data: { type: "RUN_ERROR", message: "The turn broke." } },
    ];
    const { agent } = _agentOver(failedTurn, store);
    _recordInto(agent, store);

    // A verbatim RUN_ERROR ending IS the thread's settled terminal (and
    // completes the watch cleanly in @ag-ui/client) — the pair is valid:
    // resuming past it serves only whatever a later turn appends.
    await agent.connectAgent();
    await _finalizeSettles();

    expect(store.snapshot?.afterId).toBe("3");
    expect(store.snapshot?.messages.map((message) => message.id)).toEqual([
      "m-1",
    ]);
  });

  it("records the settle of a mid-flight attach that opened caller-framed", async () => {
    // The sandbox-caught shape: the attach raced the first turn (empty
    // log), so the stream opens with a caller-framed RUN_STARTED whose
    // segment is later closed by a synthesized (id-less) RUN_FINISHED,
    // and the turn then settles RUN_ERROR under its stored row id.
    const store = new StreamResumeStore();
    const racedAttach: Frame[] = [
      {
        data: {
          type: "RUN_STARTED",
          threadId: STREAM_THREAD_ID,
          runId: "caller",
        },
      },
      {
        data: {
          type: "RUN_FINISHED",
          threadId: STREAM_THREAD_ID,
          runId: "caller",
        },
      },
      {
        data: {
          type: "RUN_STARTED",
          threadId: STREAM_THREAD_ID,
          runId: "run-1",
        },
      },
      { id: "868", data: { type: "RUN_ERROR", message: "Not configured." } },
    ];
    const { agent } = _agentOver(racedAttach, store);
    _recordInto(agent, store);

    await agent.connectAgent();
    await _finalizeSettles();

    expect(store.snapshot?.afterId).toBe("868");
  });
});
