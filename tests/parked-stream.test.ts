// The parked contract at the stream level: a parked turn's stream ends
// with no terminal event (only its open blocks closed), and that quiet
// close — not any event — is what the inbox recorder must notice. These
// pins drive approvalInboxRecorder over real SSE frames, the way the
// mounted Transcript would.

import { describe, expect, it, vi } from "vitest";

import {
  approvalInboxRecorder,
  ApprovalInbox,
  type ApprovalCardModel,
  reconcileApprovalsWithTurns,
  SERVING_APPROVAL_CAPABILITIES,
} from "../src/core/approval-inbox";
import { markerAnchorsOf } from "../src/core/connection-epoch";
import { toolRowHeadlineOf } from "../src/core/tool-call-display";
import { toolCallDisplayRecorder } from "../src/core/tool-call-display-anchors";
import { transcriptRowsOf } from "../src/core/transcript-rows";
import { ServingReplayStreamAgent } from "../src/transport/replay-stream-agent";
import { StreamResumeStore } from "../src/transport/stream-resume";

const STREAM_URL =
  "https://api.example.test/serving/v1/assistant-threads/t-1/stream";
const STREAM_THREAD_ID = "assistant-thread-1";
const RUN_ID = "run-1";
const TOOL_CALL_ID = "run-1-a1-t1";
const INTERRUPT_ID = "v1:before_tool_call:t1:handler";

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

function _agentOver(frames: Frame[]) {
  return new ServingReplayStreamAgent({
    streamUrl: STREAM_URL,
    streamThreadId: STREAM_THREAD_ID,
    authorizedFetch: () =>
      Promise.resolve(
        new Response(_sseBody(frames), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      ),
  });
}

// The replay of a pause up to (and including) the approval ask, with the
// tool block closed the way close_open_blocks does before a quiet close.
function _pausedTurn(): Frame[] {
  return [
    {
      data: { type: "RUN_STARTED", threadId: STREAM_THREAD_ID, runId: RUN_ID },
    },
    {
      id: "1",
      data: {
        type: "TOOL_CALL_START",
        toolCallId: TOOL_CALL_ID,
        toolCallName: "add_memory",
      },
    },
    {
      id: "2",
      data: { type: "TOOL_CALL_ARGS", toolCallId: TOOL_CALL_ID, delta: "{}" },
    },
    {
      id: "3",
      data: {
        type: "CUSTOM",
        name: "approval_requested",
        value: {
          interrupt_id: INTERRUPT_ID,
          tool_name: "add_memory",
          tool_args: {},
          prompt: "The assistant wants to save a memory. Allow it?",
          tool_call_id: TOOL_CALL_ID,
          round: 0,
        },
      },
    },
    { data: { type: "TOOL_CALL_END", toolCallId: TOOL_CALL_ID } },
  ];
}

// The recorder's wiring without React, the way ApprovalRequestRecorder
// subscribes it through the component tree.
function _recordedRun(frames: Frame[]) {
  const agent = _agentOver(frames);
  const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
  let cards: readonly ApprovalCardModel[] = [];
  let quietCloses = 0;
  agent.subscribe(
    approvalInboxRecorder(
      inbox,
      (snapshot) => {
        cards = snapshot;
      },
      () => {
        quietCloses += 1;
      },
    ),
  );
  return {
    agent,
    inbox,
    latestCards: () => cards,
    quietCloses: () => quietCloses,
  };
}

// onRunFinalized rides the pipeline's finalize as a floating promise —
// it can land just after connectAgent resolves, so assertions wait a
// macrotask out.
function _finalizeSettles(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("approvalInboxRecorder over a parked stream", () => {
  it("flags the open card parked and reports the quiet close exactly once", async () => {
    const run = _recordedRun(_pausedTurn());

    await run.agent.connectAgent();
    await _finalizeSettles();

    expect(run.quietCloses()).toBe(1);
    expect(run.latestCards()).toEqual([
      expect.objectContaining({
        interruptId: INTERRUPT_ID,
        anchored: true,
        parked: true,
        status: { kind: "actionable", errorSentence: null },
      }),
    ]);
  });

  it("keeps one card, status intact, when a reconnect replays the pause into the SAME inbox", async () => {
    const run = _recordedRun(_pausedTurn());
    await run.agent.connectAgent();
    await _finalizeSettles();
    expect(run.latestCards()).toHaveLength(1);

    // The reconnect: a fresh agent and recorder (the epoch rebuilds both)
    // over the thread-lived inbox. The replayed marker dedupes instead of
    // duplicating, and the card never leaves the actionable state.
    const reconnected = _agentOver(_pausedTurn());
    let cards: readonly ApprovalCardModel[] = run.inbox.cards();
    reconnected.subscribe(
      approvalInboxRecorder(
        run.inbox,
        (snapshot) => {
          cards = snapshot;
        },
        () => undefined,
      ),
    );
    await reconnected.connectAgent();
    await _finalizeSettles();

    expect(run.inbox.cards()).toHaveLength(1);
    expect(cards).toEqual([
      expect.objectContaining({
        interruptId: INTERRUPT_ID,
        anchored: true,
        status: { kind: "actionable", errorSentence: null },
      }),
    ]);
  });

  it("answers the replayed card from its approval_resolved receipt — never actionable-again", async () => {
    const answeredReplay: Frame[] = [
      ..._pausedTurn(),
      {
        data: {
          type: "CUSTOM",
          name: "approval_resolved",
          value: { interrupt_id: INTERRUPT_ID, approved: true },
        },
      },
    ];
    const run = _recordedRun(answeredReplay);

    await run.agent.connectAgent();
    await _finalizeSettles();

    expect(run.latestCards()).toEqual([
      expect.objectContaining({
        interruptId: INTERRUPT_ID,
        status: { kind: "answered", approved: true, trusted: false },
      }),
    ]);
  });

  it("stays silent on a settled stream — the terminal was the last applied event", async () => {
    const settledTurn: Frame[] = [
      {
        data: {
          type: "RUN_STARTED",
          threadId: STREAM_THREAD_ID,
          runId: RUN_ID,
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
      {
        id: "3",
        data: {
          type: "RUN_FINISHED",
          threadId: STREAM_THREAD_ID,
          runId: RUN_ID,
        },
      },
    ];
    const run = _recordedRun(settledTurn);

    await run.agent.connectAgent();
    await _finalizeSettles();

    expect(run.quietCloses()).toBe(0);
  });

  it("stays silent on a stream ending in RUN_ERROR, and the cards are gone anyway", async () => {
    const erroredPause: Frame[] = [
      ..._pausedTurn(),
      { id: "4", data: { type: "RUN_ERROR", message: "The turn broke." } },
    ];
    const run = _recordedRun(erroredPause);

    await run.agent.connectAgent();
    await _finalizeSettles();

    expect(run.quietCloses()).toBe(0);
    expect(run.latestCards()).toEqual([]);
  });

  it("reports a mid-run stream that closes cleanly — the wire cannot tell it from a park", async () => {
    // A proxy timeout ends the body cleanly with no terminal, exactly a
    // park's shape. The recorder must report it; the conversation layer's
    // REST confirm is what tells them apart (a turn the workflow still
    // owns raises the interruption banner instead).
    const midRunClose: Frame[] = [
      {
        data: {
          type: "RUN_STARTED",
          threadId: STREAM_THREAD_ID,
          runId: RUN_ID,
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
    ];
    const run = _recordedRun(midRunClose);

    await run.agent.connectAgent();
    await _finalizeSettles();

    expect(run.quietCloses()).toBe(1);
  });

  it("stays silent when the transport itself dies — that is the failed path, not a park", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const agent = new ServingReplayStreamAgent({
      streamUrl: STREAM_URL,
      streamThreadId: STREAM_THREAD_ID,
      authorizedFetch: () => Promise.reject(new Error("The connection reset.")),
    });
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    let quietCloses = 0;
    agent.subscribe(
      approvalInboxRecorder(
        inbox,
        () => undefined,
        () => {
          quietCloses += 1;
        },
      ),
    );

    await agent.connectAgent().catch(() => undefined);
    await _finalizeSettles();

    expect(quietCloses).toBe(0);
    consoleError.mockRestore();
  });

  it("a void replay's RUN_FINISHED alone leaves the card standing — no quiet close, not parked; the voided turn's settled word closes it", async () => {
    const voidedReplay: Frame[] = [
      ..._pausedTurn(),
      {
        id: "4",
        data: {
          type: "CUSTOM",
          name: "turn_voided",
          value: { receipt: "It was set aside." },
        },
      },
      {
        id: "5",
        data: {
          type: "RUN_FINISHED",
          threadId: STREAM_THREAD_ID,
          runId: RUN_ID,
        },
      },
    ];
    const run = _recordedRun(voidedReplay);

    await run.agent.connectAgent();
    await _finalizeSettles();

    expect(run.quietCloses()).toBe(0);
    expect(run.latestCards()).toEqual([
      expect.objectContaining({
        interruptId: INTERRUPT_ID,
        runId: RUN_ID,
        parked: false,
        status: { kind: "actionable", errorSentence: null },
      }),
    ]);
    expect(
      reconcileApprovalsWithTurns(run.inbox, [
        { id: "turn-1", run_id: RUN_ID, status: "superseded" },
      ]),
    ).toBe(true);
    expect(run.inbox.cards()).toEqual([]);
  });

  // The reload scenario: turn N parked with a pending ask, a new message
  // voided it, the visitor reloads while turn N+1 still works.
  // void_any_parked_turn lands turn_voided + the quiet RUN_FINISHED in one
  // commit BEFORE begin_turn, and the replay is an id-ordered log dump, so
  // the terminal precedes the successor's rows — but a RUN_FINISHED closes
  // nothing: the settled turn's word does, and in production that word
  // lands on the adoption read BEFORE the transcript connects.
  function _reloadMidSuccessorReplay(): Frame[] {
    return [
      ..._pausedTurn(),
      {
        id: "4",
        data: {
          type: "CUSTOM",
          name: "turn_voided",
          value: { receipt: "It was set aside." },
        },
      },
      {
        id: "5",
        data: {
          type: "RUN_FINISHED",
          threadId: STREAM_THREAD_ID,
          runId: RUN_ID,
        },
      },
      // The successor turn's still-working run streams on the same
      // attach; it must not resurrect anything.
      {
        data: {
          type: "RUN_STARTED",
          threadId: STREAM_THREAD_ID,
          runId: "run-2",
        },
      },
      {
        id: "6",
        data: {
          type: "TEXT_MESSAGE_START",
          messageId: "m-2",
          role: "assistant",
        },
      },
    ];
  }

  function _countingRun(inbox: ApprovalInbox, frames: Frame[]) {
    const publishedCounts: number[] = [];
    const agent = _agentOver(frames);
    agent.subscribe(
      approvalInboxRecorder(
        inbox,
        (snapshot) => {
          publishedCounts.push(snapshot.length);
        },
        () => undefined,
      ),
    );
    return { agent, publishedCounts };
  }

  const RELOAD_WINDOW = [
    { id: "turn-1", run_id: RUN_ID, status: "superseded" as const },
    { id: "turn-2", run_id: "run-2", status: "working" as const },
  ];

  it("a reload mid-successor-turn: the adoption read precedes the connect, so the replayed voided pause opens NO card", async () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    expect(reconcileApprovalsWithTurns(inbox, RELOAD_WINDOW)).toBe(false);
    const { agent, publishedCounts } = _countingRun(
      inbox,
      _reloadMidSuccessorReplay(),
    );

    await agent.connectAgent();
    await _finalizeSettles();

    expect(publishedCounts).toEqual([]);
    expect(inbox.cards()).toEqual([]);
  });

  it("the same replay into an inbox that never heard the settled word holds the card until the next read — the replayed terminal closes nothing", async () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    const { agent, publishedCounts } = _countingRun(
      inbox,
      _reloadMidSuccessorReplay(),
    );

    await agent.connectAgent();
    await _finalizeSettles();

    // Not vacuous: the replay DID recreate the card (the anti-vacuity
    // arm of the test above), and the terminal left it standing; the
    // harness's stream end then flags it parked, which is the publish
    // after the open.
    expect(publishedCounts[0]).toBe(1);
    expect(publishedCounts.at(-1)).toBe(1);
    expect(inbox.cards()).toEqual([
      expect.objectContaining({ interruptId: INTERRUPT_ID, runId: RUN_ID }),
    ]);
    expect(reconcileApprovalsWithTurns(inbox, RELOAD_WINDOW)).toBe(true);
    expect(inbox.cards()).toEqual([]);
  });

  it("the streamer's synthesized close around a late row keeps the live pause's card through the real recorder", async () => {
    // run-b is live and pauses; a coworker's late row lands under run-a:
    // the streamer closes run-b, re-enters run-a for the row alone,
    // closes it, and re-opens run-b — never re-emitting the pause.
    const lateRowReplay: Frame[] = [
      ..._pausedTurn().map((frame) =>
        frame.data.type === "RUN_STARTED"
          ? { ...frame, data: { ...frame.data, runId: "run-b" } }
          : frame,
      ),
      {
        data: {
          type: "RUN_FINISHED",
          threadId: STREAM_THREAD_ID,
          runId: "run-b",
        },
      },
      {
        data: {
          type: "RUN_STARTED",
          threadId: STREAM_THREAD_ID,
          runId: "run-a",
        },
      },
      {
        id: "4",
        data: {
          type: "TEXT_MESSAGE_START",
          messageId: "m-late",
          role: "assistant",
        },
      },
      {
        id: "5",
        data: {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "m-late",
          delta: "Cancelled subscription 41.",
        },
      },
      { id: "6", data: { type: "TEXT_MESSAGE_END", messageId: "m-late" } },
      {
        data: {
          type: "RUN_FINISHED",
          threadId: STREAM_THREAD_ID,
          runId: "run-a",
        },
      },
      {
        data: {
          type: "RUN_STARTED",
          threadId: STREAM_THREAD_ID,
          runId: "run-b",
        },
      },
    ];
    const run = _recordedRun(lateRowReplay);

    await run.agent.connectAgent();
    await _finalizeSettles();

    // One publish opened the card; the harness's stream end parks it.
    expect(run.quietCloses()).toBe(1);
    expect(run.latestCards()).toEqual([
      expect.objectContaining({
        interruptId: INTERRUPT_ID,
        runId: "run-b",
        status: { kind: "actionable", errorSentence: null },
      }),
    ]);
    // The confirming read keeps it; run-b's settled word closes it.
    const window = [
      { id: "turn-a", run_id: "run-a", status: "succeeded" as const },
      {
        id: "turn-b",
        run_id: "run-b",
        status: "awaiting_input" as const,
        pending_interrupt_ids: [INTERRUPT_ID],
        awaiting_round: 0,
        pending_approvals: [],
      },
    ];
    expect(reconcileApprovalsWithTurns(run.inbox, window)).toBe(true);
    expect(run.inbox.cards()).toEqual([
      expect.objectContaining({ interruptId: INTERRUPT_ID, parked: false }),
    ]);
    expect(reconcileApprovalsWithTurns(run.inbox, window)).toBe(false);
    expect(
      reconcileApprovalsWithTurns(run.inbox, [
        window[0],
        { id: "turn-b", run_id: "run-b", status: "succeeded" as const },
      ]),
    ).toBe(true);
    expect(run.inbox.cards()).toEqual([]);
  });
});

// The full replay of an annotated docs_search turn: the progress marker
// beside the call, the tool body's counted completion first, then the
// hook's plain completion — the exact producer order the backend emits.
function _annotatedTurn(): Frame[] {
  return [
    {
      data: { type: "RUN_STARTED", threadId: STREAM_THREAD_ID, runId: RUN_ID },
    },
    {
      id: "1",
      data: {
        type: "TOOL_CALL_START",
        toolCallId: TOOL_CALL_ID,
        toolCallName: "docs_search",
      },
    },
    {
      id: "2",
      data: {
        type: "TOOL_CALL_ARGS",
        toolCallId: TOOL_CALL_ID,
        delta: '{"query":"sencha"}',
      },
    },
    { data: { type: "TOOL_CALL_END", toolCallId: TOOL_CALL_ID } },
    {
      id: "3",
      data: {
        type: "CUSTOM",
        name: "tool_call_annotated",
        value: {
          tool_call_id: TOOL_CALL_ID,
          display: {
            progress_text: "Searching your docs for “sencha”…",
          },
        },
      },
    },
    {
      id: "4",
      data: {
        type: "CUSTOM",
        name: "tool_call_annotated",
        value: {
          tool_call_id: TOOL_CALL_ID,
          display: {
            complete_text: "Searched your docs for “sencha” — 3 results",
          },
        },
      },
    },
    {
      id: "5",
      data: {
        type: "CUSTOM",
        name: "tool_call_annotated",
        value: {
          tool_call_id: TOOL_CALL_ID,
          display: { kind: "text", complete_text: "Searched your docs" },
        },
      },
    },
    {
      id: "6",
      data: {
        type: "TOOL_CALL_RESULT",
        messageId: `${TOOL_CALL_ID}-result`,
        toolCallId: TOOL_CALL_ID,
        content: "[steeping#water] 80°C for sencha",
        role: "tool",
      },
    },
    {
      id: "7",
      data: { type: "RUN_FINISHED", threadId: STREAM_THREAD_ID, runId: RUN_ID },
    },
  ];
}

// The recorder's wiring without React, the way the connection epoch
// subscribes it: markers land in the resume store, the transcript reads
// the derived anchors.
function _annotatedRunOver(resume: StreamResumeStore) {
  const agent = _agentOver(_annotatedTurn());
  agent.subscribe(
    toolCallDisplayRecorder((toolCallId, display) => {
      resume.recordToolCallDisplay(toolCallId, display);
    }),
  );
  return { agent };
}

describe("toolCallDisplayRecorder over a replayed stream", () => {
  it("headlines the tool row with the wire's copy, frames to words", async () => {
    const resume = new StreamResumeStore();
    const run = _annotatedRunOver(resume);

    await run.agent.connectAgent();
    await _finalizeSettles();

    const rows = transcriptRowsOf(
      run.agent.messages,
      markerAnchorsOf(resume),
      false,
    );
    const tool = rows.find((row) => row.kind === "tool-call");
    if (tool?.kind !== "tool-call") {
      throw new Error("expected a tool row");
    }
    expect(tool.state).toBe("output-available");
    // The body's counted completion arrived first, so it wins the merge
    // over the hook's plain sentence.
    expect(
      toolRowHeadlineOf({
        toolName: tool.toolName,
        state: tool.state,
        input: tool.argsText,
        output: tool.result,
        display: tool.display,
      }),
    ).toBe("Searched your docs for “sencha” — 3 results");
  });

  it("keeps the anchored copy identical under a full replay's re-delivery", async () => {
    const resume = new StreamResumeStore();

    const first = _annotatedRunOver(resume);
    await first.agent.connectAgent();
    await _finalizeSettles();
    const afterFirst = resume.toolCallDisplayAnchors;

    // A reconnect replays the whole recorded log through a fresh agent —
    // every marker arrives again, and the merge must not churn the map.
    const second = _annotatedRunOver(resume);
    await second.agent.connectAgent();
    await _finalizeSettles();

    expect(resume.toolCallDisplayAnchors).toBe(afterFirst);
    expect(resume.toolCallDisplayAnchors.get(TOOL_CALL_ID)).toEqual({
      progressText: "Searching your docs for “sencha”…",
      completeText: "Searched your docs for “sencha” — 3 results",
    });
  });
});
