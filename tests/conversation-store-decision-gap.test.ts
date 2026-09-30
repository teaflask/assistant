// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { RunAgentResult } from "@ag-ui/client";
import type { ServingAssistantTurn } from "../src/contract/threads";
import { noteInterruptAnswerConsumed } from "../src/core/conversation-publish";
import type { AssistantConversationStore } from "../src/core/conversation-store";
import type { ExecutionInbox } from "../src/core/execution-inbox";
import { writeStoredThread } from "../src/persistence/stored-thread";
import { getAssistantThread } from "../src/transport/serving-api";

vi.mock("../src/transport/serving-api", () => ({
  getAssistantThread: vi.fn(),
  listAssistantThreads: vi.fn(),
  sendAssistantMessage: vi.fn(),
  stopAssistantTurn: vi.fn(),
  resolveTurnApproval: vi.fn(),
  resolveTurnToolResults: vi.fn(),
  streamUrlForThread: vi.fn(
    () => "https://api.example.test/serving/v1/assistant-threads/x/stream",
  ),
}));

import {
  aStore,
  connectAgent,
  detailOf,
  installConversationStoreLifecycle,
  PK,
  RUN_ENDED,
  threadOf,
  turnOf,
} from "./conversation-store-harness";

installConversationStoreLifecycle();

describe("the pending-decision gap — ids with no constructible card are loud, never silent", () => {
  const INTERRUPT = "v1:before_tool_call:t1:handler";

  function approvalPayload(interruptId = INTERRUPT) {
    return {
      interrupt_id: interruptId,
      tool_name: "submit-doc-draft",
      tool_args: { title: "Refund policy", body_md: "# Refund policy\n\n…" },
      tool_input_schema: null,
      tool_output_schema: null,
      prompt: "Submit this draft for review?",
      tool_call_id: "run-1-a1-t1",
      round: 0,
      gated: false,
      trust_available: false,
    };
  }

  // The gap's wire shape: the pause is real and the id is pending, but
  // the durable snapshot could not carry the card (the server skips a
  // malformed marker and logs it; the id still counts —
  // _validated_pending_approvals' contract).
  function gappedTurn(overrides: Partial<ServingAssistantTurn> = {}) {
    return turnOf({
      id: "t1",
      status: "parked",
      run_id: "run-1",
      pending_interrupt_ids: [INTERRUPT],
      awaiting_round: 0,
      pending_approvals: [],
      ...overrides,
    });
  }

  // The probe's settle window (GAP_PROBE_SETTLE_MS) plus slack.
  const PROBE_WINDOW_MS = 2_100;

  // The consumed fold's drive, through the store's own epoch-dep seam —
  // the executionInboxOf posture: internal state the derivation reads,
  // fed directly so the fake-timer tests need no SSE plumbing.
  function noteConsumed(
    store: AssistantConversationStore,
    runId: string,
    interruptId: string,
    round: number,
  ): void {
    noteInterruptAnswerConsumed(store, runId, interruptId, round);
  }

  function executionInboxOf(store: AssistantConversationStore): ExecutionInbox {
    const epoch = (
      store as unknown as { _epoch: { executionInbox: ExecutionInbox } | null }
    )._epoch;
    expect(epoch).not.toBeNull();
    if (epoch === null) {
      throw new Error("no epoch");
    }
    return epoch.executionInbox;
  }

  it("a parked gap publishes when the settle window closes — the timer is the only gate, and the probe never rests in silence", async () => {
    vi.useFakeTimers();
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [gappedTurn()]),
    );
    const store = aStore();
    // A mounted surface: the lease is what makes a paused epoch attempt
    // its one replay stream, which is what makes the gap judgeable
    // (premise #3; the headless posture is pinned separately below).
    store.acquireTranscriptLease("page");
    store.bootstrap();
    await vi.advanceTimersByTimeAsync(0);

    // Inside the window nothing is loud yet: a parked thread still gets
    // one replay stream per epoch (round-1 review corrected the "no
    // socket" premise), and flashing the alert before that replay could
    // land its recorded interrupts was the defect. The window is the
    // TIMER alone (round-3): the best-effort re-read gates nothing.
    expect(store.approvals.get()).toHaveLength(0);
    expect(store.conversation.get().pendingDecisionGap).toBeNull();

    await vi.advanceTimersByTimeAsync(PROBE_WINDOW_MS);

    // The window closed with the gap still standing: loud, with exactly
    // ONE extra best-effort read (bootstrap + probe = 2). A probe that
    // loops, or one that rests in silence, both fail here.
    expect(store.conversation.get().pendingDecisionGap).toEqual({
      turnId: "t1",
      missingInterruptIds: [INTERRUPT],
    });
    expect(vi.mocked(getAssistantThread)).toHaveBeenCalledTimes(2);
    // The feed carries the same fact the alert does (round-1 finding 4):
    // the sr-only announcer reads it from here.
    expect(store.activity.get().pendingDecisionGap).toEqual(
      store.conversation.get().pendingDecisionGap,
    );
  });

  it("awaiting_input rides the same timer-gated probe, and it terminates in the error, never silence", async () => {
    vi.useFakeTimers();
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf({ busy: true }), [
        gappedTurn({ status: "awaiting_input" }),
      ]),
    );
    const store = aStore();
    // A mounted surface: the lease is what makes a paused epoch attempt
    // its one replay stream, which is what makes the gap judgeable
    // (premise #3; the headless posture is pinned separately below).
    store.acquireTranscriptLease("page");
    store.bootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.conversation.get().pendingDecisionGap).toBeNull();

    await vi.advanceTimersByTimeAsync(PROBE_WINDOW_MS);

    expect(store.conversation.get().pendingDecisionGap).toEqual({
      turnId: "t1",
      missingInterruptIds: [INTERRUPT],
    });
    expect(vi.mocked(getAssistantThread)).toHaveBeenCalledTimes(2);
  });

  it("the confirming re-read that recovers the card clears the gap instead — the REST hydration is the first answer", async () => {
    vi.useFakeTimers();
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    // First read: id pending, snapshot empty (the incident's shape).
    // The probe's re-read finds the durable snapshot intact.
    vi.mocked(getAssistantThread)
      .mockResolvedValueOnce(
        detailOf(threadOf({ busy: true }), [
          gappedTurn({ status: "awaiting_input" }),
        ]),
      )
      .mockResolvedValue(
        detailOf(threadOf({ busy: true }), [
          gappedTurn({
            status: "awaiting_input",
            pending_approvals: [approvalPayload()],
          }),
        ]),
      );
    const store = aStore();
    // A mounted surface: the lease is what makes a paused epoch attempt
    // its one replay stream, which is what makes the gap judgeable
    // (premise #3; the headless posture is pinned separately below).
    store.acquireTranscriptLease("page");
    store.bootstrap();
    await vi.advanceTimersByTimeAsync(PROBE_WINDOW_MS);

    expect(store.conversation.get().pendingDecisionGap).toBeNull();
    const [card] = store.approvals.get();
    expect(card).toMatchObject({
      interruptId: INTERRUPT,
      status: { kind: "actionable", errorSentence: null },
    });
  });

  it("a replay that lands the execution entry inside the settle window means the alert never shows — the execution-only pause is the driver's, not a gap", async () => {
    vi.useFakeTimers();
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    // The backend's own contract: an execution-only pause legitimately
    // holds ids with NO approval cards — the REST snapshot cannot carry
    // them, and only the epoch's replay stream rebuilds the entries.
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [gappedTurn()]),
    );
    const store = aStore();
    // A mounted surface: the lease is what makes a paused epoch attempt
    // its one replay stream, which is what makes the gap judgeable
    // (premise #3; the headless posture is pinned separately below).
    store.acquireTranscriptLease("page");
    store.bootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.conversation.get().pendingDecisionGap).toBeNull();

    // The replay lands its recorded interrupt while the window is open —
    // driven straight into the epoch's execution inbox, the exact state
    // the derivation reads.
    const inbox = executionInboxOf(store);
    inbox.noteRunStarted("run-1");
    inbox.noteExecutionRequested({
      interrupt_id: INTERRUPT,
      tool_name: "builtin_navigate",
      tool_call_id: null,
      request: { kind: "builtin.navigate", action: {} },
      round: 0,
    });

    await vi.advanceTimersByTimeAsync(PROBE_WINDOW_MS);

    // The window closed onto evidence, not silence and not a false
    // alarm: the id is the driver's to answer, so no gap ever published.
    expect(store.conversation.get().pendingDecisionGap).toBeNull();
  });

  it("a server-named unservable id never alarms — the 2026-08-31 phantom shape end to end", async () => {
    vi.useFakeTimers();
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    // The phantom's exact wire shape: the pause is real, the id is
    // pending, no card can be built — and the server SAYS so. The old
    // behavior armed the probe and went loud ("waiting on a request
    // that couldn't be shown"); the retry re-read the same broken row
    // forever. Now no wait is presented at all.
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [
        gappedTurn({ unservable_interrupt_ids: [INTERRUPT] }),
      ]),
    );
    const store = aStore();
    store.acquireTranscriptLease("page");
    store.bootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.conversation.get().pendingDecisionGap).toBeNull();

    await vi.advanceTimersByTimeAsync(PROBE_WINDOW_MS * 2);

    // Quiet for good — and the probe never armed, so no best-effort
    // re-read fired: exactly the one bootstrap read.
    expect(store.conversation.get().pendingDecisionGap).toBeNull();
    expect(store.activity.get().pendingDecisionGap).toBeNull();
    expect(vi.mocked(getAssistantThread)).toHaveBeenCalledTimes(1);
  });

  it("a replayed consumption marker keeps the gap quiet — the answer was already carried in", async () => {
    vi.useFakeTimers();
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    // A stale REST snapshot still names the id pending (the consumed
    // subtraction lands server-side on the NEXT read), but the stream
    // already replayed the consumption row.
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [gappedTurn()]),
    );
    const store = aStore();
    store.acquireTranscriptLease("page");
    store.bootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.conversation.get().pendingDecisionGap).toBeNull();

    // The consumed fold lands while the window is open — driven through
    // the store's own epoch-dep seam, the state the derivation reads
    // (the executionInboxOf posture above). Round 0 == the gapped
    // turn's awaiting_round: the fold's identity is the row's,
    // (run_id, round, interrupt_id).
    noteConsumed(store, "run-1", INTERRUPT, 0);

    await vi.advanceTimersByTimeAsync(PROBE_WINDOW_MS);

    expect(store.conversation.get().pendingDecisionGap).toBeNull();
  });

  it("a consumption recorded under a DIFFERENT run subtracts nothing — the fold is run-keyed", async () => {
    // The breaking case for the run keying: a superseded run's consumed
    // marker must never quiet the newest turn's genuine gap.
    vi.useFakeTimers();
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [gappedTurn()]),
    );
    const store = aStore();
    store.acquireTranscriptLease("page");
    store.bootstrap();
    await vi.advanceTimersByTimeAsync(0);
    noteConsumed(store, "run-superseded", INTERRUPT, 0);

    await vi.advanceTimersByTimeAsync(PROBE_WINDOW_MS);

    expect(store.conversation.get().pendingDecisionGap).toEqual({
      turnId: "t1",
      missingInterruptIds: [INTERRUPT],
    });
  });

  it("a consumption recorded at an OLDER round subtracts nothing — the fold matches awaiting_round like the server", async () => {
    // The breaking case for the round keying (the server's own NC: 'a
    // consumed answer must never subtract a later pause's id'): the
    // turn awaits round 1, the replayed row consumed round 0 — even
    // with the same interrupt id, the round-1 gap must still alarm.
    vi.useFakeTimers();
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [gappedTurn({ awaiting_round: 1 })]),
    );
    const store = aStore();
    store.acquireTranscriptLease("page");
    store.bootstrap();
    await vi.advanceTimersByTimeAsync(0);
    noteConsumed(store, "run-1", INTERRUPT, 0);

    await vi.advanceTimersByTimeAsync(PROBE_WINDOW_MS);

    expect(store.conversation.get().pendingDecisionGap).toEqual({
      turnId: "t1",
      missingInterruptIds: [INTERRUPT],
    });
  });

  it("a re-read that NEVER settles cannot delay the alert — its liveness depends on no network call (round-3 review)", async () => {
    vi.useFakeTimers();
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    // The bootstrap read resolves; the probe's best-effort re-read is
    // accepted and then stalls forever (no AbortSignal exists anywhere
    // in this transport layer, so nothing would ever settle it) —
    // mobile handoff, captive portal, a proxy holding the socket.
    vi.mocked(getAssistantThread)
      .mockResolvedValueOnce(detailOf(threadOf(), [gappedTurn()]))
      .mockImplementation(() => new Promise<never>(() => undefined));
    const store = aStore();
    // A mounted surface: the lease is what makes a paused epoch attempt
    // its one replay stream, which is what makes the gap judgeable
    // (premise #3; the headless posture is pinned separately below).
    store.acquireTranscriptLease("page");
    store.bootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.conversation.get().pendingDecisionGap).toBeNull();

    await vi.advanceTimersByTimeAsync(PROBE_WINDOW_MS);

    // The old both-channels gate parked the alert on the hung request —
    // the silent-pending-decision state itself. The timer alone decides.
    expect(store.conversation.get().pendingDecisionGap).toEqual({
      turnId: "t1",
      missingInterruptIds: [INTERRUPT],
    });
  });

  it("a published gap tracks the live derivation — it narrows when a holder lands and widens with a new id, with no re-probe and no extra read (round-3 review)", async () => {
    vi.useFakeTimers();
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    const OTHER = "v1:before_tool_call:t2:handler";
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [
        gappedTurn({ pending_interrupt_ids: [INTERRUPT, OTHER] }),
      ]),
    );
    const store = aStore();
    // A mounted surface: the lease is what makes a paused epoch attempt
    // its one replay stream, which is what makes the gap judgeable
    // (premise #3; the headless posture is pinned separately below).
    store.acquireTranscriptLease("page");
    store.bootstrap();
    await vi.advanceTimersByTimeAsync(PROBE_WINDOW_MS);
    expect(
      store.conversation.get().pendingDecisionGap?.missingInterruptIds,
    ).toEqual([INTERRUPT, OTHER]);
    const readsWhenLoud = vi.mocked(getAssistantThread).mock.calls.length;

    // A holder lands for the first id: the alarm is already ringing, so
    // the public payload must narrow NOW — not after a 2s re-probe that
    // spends another read re-confirming a loud state.
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [
        gappedTurn({
          pending_interrupt_ids: [INTERRUPT, OTHER],
          pending_approvals: [approvalPayload()],
        }),
      ]),
    );
    await store.refreshConversation();
    expect(
      store.conversation.get().pendingDecisionGap?.missingInterruptIds,
    ).toEqual([OTHER]);
    // The feed carries the same narrowed fact.
    expect(store.activity.get().pendingDecisionGap).toBe(
      store.conversation.get().pendingDecisionGap,
    );
    // Exactly the one manual refresh — no probe re-read fired.
    expect(vi.mocked(getAssistantThread).mock.calls.length).toBe(
      readsWhenLoud + 1,
    );

    // Widening tracks too: a new pending id joins while loud.
    const THIRD = "v1:before_tool_call:t3:handler";
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [
        gappedTurn({
          pending_interrupt_ids: [INTERRUPT, OTHER, THIRD],
          pending_approvals: [approvalPayload()],
        }),
      ]),
    );
    await store.refreshConversation();
    expect(
      store.conversation.get().pendingDecisionGap?.missingInterruptIds,
    ).toEqual([OTHER, THIRD]);
  });

  it("a headless store on a paused turn never alarms — the gap is judgeable only once the replay channel had its chance (round-4 review)", async () => {
    vi.useFakeTimers();
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [gappedTurn()]),
    );
    // NO lease: the companion is minimized. Under today's connect table
    // a paused turn with no surfaces opens no socket, so the execution
    // inbox's emptiness proves nothing — an execution-only pause looks
    // identical to a genuine gap. The public activity feed (a companion,
    // a badge, a doorbell) must not carry a false alarm indefinitely.
    const store = aStore();
    store.bootstrap();
    await vi.advanceTimersByTimeAsync(PROBE_WINDOW_MS * 3);
    expect(store.conversation.get().pendingDecisionGap).toBeNull();
    expect(store.activity.get().pendingDecisionGap).toBeNull();

    // A surface mounts: the epoch attempts its stream (the canned agent
    // never resolves — the ATTEMPT is the judgeability record, so a
    // hung socket cannot hold a genuine alert hostage), and the alert
    // lands within one window.
    store.acquireTranscriptLease("page");
    await vi.advanceTimersByTimeAsync(PROBE_WINDOW_MS);
    expect(store.conversation.get().pendingDecisionGap).toEqual({
      turnId: "t1",
      missingInterruptIds: [INTERRUPT],
    });
  });

  it("a StrictMode dispose→bootstrap revival re-arms the probe — a frozen probe must never park the gap in silence (round-2 review)", async () => {
    vi.useFakeTimers();
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [gappedTurn()]),
    );
    // The first life's stream must be end-able: a real teardown ends the
    // connection and _connectionEnded releases the connect slot; the
    // default pending-forever stub would hold `_connectionRunning` across
    // the revival and block the second life's attempt — a mock artifact,
    // not a store behavior.
    let releaseFirstConnect: () => void = () => undefined;
    connectAgent.mockImplementationOnce(
      () =>
        new Promise<RunAgentResult>((resolve) => {
          releaseFirstConnect = () => {
            resolve(RUN_ENDED);
          };
        }),
    );
    const store = aStore();
    // A mounted surface: the lease is what makes a paused epoch attempt
    // its one replay stream, which is what makes the gap judgeable
    // (premise #3; the headless posture is pinned separately below).
    store.acquireTranscriptLease("page");
    store.bootstrap();
    // The probe arms and its confirming re-read resolves, but the settle
    // window is still open when the provider tears down (StrictMode runs
    // dispose between two boots of the SAME store).
    await vi.advanceTimersByTimeAsync(0);
    store.dispose();
    releaseFirstConnect();
    await vi.advanceTimersByTimeAsync(PROBE_WINDOW_MS);

    // Revival: same thread, same gap signature. Without dispose()
    // clearing the probe, the frozen {refreshed, settled:false} probe
    // matched the signature, no new timer or re-read was ever issued,
    // and the gap stayed silent for the life of the store — the exact
    // state this ticket exists to remove.
    store.bootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.conversation.get().pendingDecisionGap).toBeNull();

    await vi.advanceTimersByTimeAsync(PROBE_WINDOW_MS);
    expect(store.conversation.get().pendingDecisionGap).toEqual({
      turnId: "t1",
      missingInterruptIds: [INTERRUPT],
    });
  });

  it("a recovered card clears an already-published parked gap on the next read", async () => {
    vi.useFakeTimers();
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [gappedTurn()]),
    );
    const store = aStore();
    // A mounted surface: the lease is what makes a paused epoch attempt
    // its one replay stream, which is what makes the gap judgeable
    // (premise #3; the headless posture is pinned separately below).
    store.acquireTranscriptLease("page");
    store.bootstrap();
    await vi.advanceTimersByTimeAsync(PROBE_WINDOW_MS);
    expect(store.conversation.get().pendingDecisionGap).not.toBeNull();

    // The retry path: the member clicks Retry → refreshConversation →
    // this time the snapshot carries the card.
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [
        gappedTurn({ pending_approvals: [approvalPayload()] }),
      ]),
    );
    await store.refreshConversation();
    await vi.advanceTimersByTimeAsync(0);

    expect(store.conversation.get().pendingDecisionGap).toBeNull();
    expect(store.approvals.get()).toHaveLength(1);
  });
});
