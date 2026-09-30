// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { RunAgentResult } from "@ag-ui/client";
import type { AssistantThreadDetailResponse } from "../src/contract/threads";
import type { AssistantConversationStore } from "../src/core/conversation-store";
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
  settled,
  threadOf,
  turnOf,
} from "./conversation-store-harness";

installConversationStoreLifecycle();

describe("the guard flags release on every exit path", () => {
  // Mirrors CONNECTION_ENDED_REFRESH_BOUND_MS in conversation-store.ts:
  // the stream-end refresh's bound, equal to the delivery-claim window.
  const CONNECTION_ENDED_REFRESH_BOUND_MS = 8_000;

  function parkedDetail() {
    return detailOf(threadOf({ busy: true }), [
      turnOf({ id: "turn-parent", status: "parked" }),
    ]);
  }

  function deliveryDetail() {
    return detailOf(threadOf({ busy: true }), [
      turnOf({ id: "turn-parent", status: "parked" }),
      turnOf({
        id: "turn-delivery",
        kind: "delivery",
        status: "working",
        user_message: "",
        run_id: "run-delivery",
      }),
    ]);
  }

  function workingDetail() {
    return detailOf(threadOf({ busy: true }), [turnOf({ status: "working" })]);
  }

  function succeededDetail() {
    return detailOf(threadOf(), [turnOf({ status: "succeeded" })]);
  }

  function _running(store: AssistantConversationStore): boolean {
    return (store as unknown as { _connectionRunning: boolean })
      ._connectionRunning;
  }

  function _deferredDetail() {
    let resolve!: (detail: AssistantThreadDetailResponse) => void;
    const promise = new Promise<AssistantThreadDetailResponse>((resolver) => {
      resolve = resolver;
    });
    return { promise, resolve };
  }

  /** A leased page over a WORKING turn whose first connection is held
   *  open by the returned resolver — the rest state for every
   *  stream-ends-then-the-refresh-does-X test below. */
  async function aLeasedWorkingPage() {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(workingDetail());
    let endStream!: (result: RunAgentResult) => void;
    connectAgent
      .mockImplementationOnce(
        () =>
          new Promise<RunAgentResult>((resolve) => {
            endStream = resolve;
          }),
      )
      .mockImplementation(() => new Promise<never>(() => undefined));
    const store = aStore();
    store.acquireTranscriptLease("page");
    store.bootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(connectAgent).toHaveBeenCalledTimes(1);
    return { store, endStream };
  }

  it("a never-resolving stream-end refresh cannot latch the connect gate — released at the bound, the budgeted resync re-attempts the stream", async () => {
    // The ticket's headline latch: _connectionRunning was cleared only
    // after an un-aborted await of refreshConversation, and nothing in
    // this transport aborts a stalled request — one accepted-then-stalled
    // GET refused every future connect on this store for the life of the
    // page.
    vi.useFakeTimers();
    const { store, endStream } = await aLeasedWorkingPage();

    // The stream dies under the working turn; the close's refresh stalls
    // forever.
    vi.mocked(getAssistantThread).mockImplementation(
      () => new Promise<never>(() => undefined),
    );
    endStream(RUN_ENDED);
    await vi.advanceTimersByTimeAsync(0);
    // Held through the bound — the gate is not released early (the
    // "publishes cannot race a second connect" premise still holds while
    // the refresh is genuinely pending)…
    expect(_running(store)).toBe(true);
    expect(connectAgent).toHaveBeenCalledTimes(1);

    // …and released AT the bound: the bounded-out arm charges the
    // automatic budget and reschedules, and the resync re-attempts the
    // stream on the stale working turn — no reload needed. The second
    // connect IS the proof of release: syncConnection bails on
    // _connectionRunning first, so a latched gate could never reach it
    // (the flag itself reads true again here, honestly — connection #2
    // is now the one running).
    await vi.advanceTimersByTimeAsync(CONNECTION_ENDED_REFRESH_BOUND_MS);
    expect(connectAgent).toHaveBeenCalledTimes(2);
    expect(store.activity.get().newestTurnStatus).toBe("working");
  });

  it("bound-out exhaustion surfaces the stream-trouble banner — Retry stays the escape hatch, and the remint loop stays bounded", async () => {
    // Round-1 review finding: the bounded-out arm charged the budget but
    // returned without the death arm's trip, so five bound-outs on a
    // wedged-REST-plus-dying-SSE page exhausted the budget SILENTLY — no
    // banner means no Retry, and with the turn stale-working the idle
    // re-read is disarmed and noteNewestTurn can never see a new id, so
    // nothing short of a reload could ever reset the budget. That is the
    // ticket's own dead end, reached in five steps instead of one.
    vi.useFakeTimers();
    const { store, endStream } = await aLeasedWorkingPage();

    // Every subsequent connection dies instantly, and every refresh
    // stalls: each 8s bound-out charges the budget and remints.
    connectAgent.mockImplementation(() => Promise.resolve(RUN_ENDED));
    vi.mocked(getAssistantThread).mockImplementation(
      () => new Promise<never>(() => undefined),
    );
    endStream(RUN_ENDED);
    await vi.advanceTimersByTimeAsync(5 * CONNECTION_ENDED_REFRESH_BOUND_MS);

    // The loop is bounded (never a runaway remint on a public embed)…
    expect(connectAgent).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connectAgent).toHaveBeenCalledTimes(5);
    // …and the exhaustion is LOUD: the banner renders, so Retry exists.
    expect(store.conversation.get().showInterruptionBanner).toBe(true);

    // Retry recovers with no reload — the acceptance criterion.
    store.retryStream();
    await vi.advanceTimersByTimeAsync(0);
    expect(connectAgent).toHaveBeenCalledTimes(6);
  });

  it("a rejected stream-end refresh releases the connect gate on the spot — an AbortError-shaped rejection identically (the scope-3 ruling pin)", async () => {
    // RULING PIN, NOT A FALSIFIED LATCH TEST: this case already passes at
    // pre-fix HEAD, because refreshConversation's internal catch converts
    // any rejection — AbortError included — into a resolution and the
    // finally runs. It is here because the ticket names it, and to pin
    // the scope-3 ruling: an aborted request releases the guard
    // IMMEDIATELY and is never held for a successor. The falsified twin
    // is the stall test above.
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(parkedDetail());
    let endStream!: (result: RunAgentResult) => void;
    connectAgent
      .mockImplementationOnce(
        () =>
          new Promise<RunAgentResult>((resolve) => {
            endStream = resolve;
          }),
      )
      .mockImplementation(() => new Promise<never>(() => undefined));
    const store = aStore();
    store.acquireTranscriptLease("page");
    store.bootstrap();
    await settled();
    await settled();
    await settled();
    expect(connectAgent).toHaveBeenCalledTimes(1);

    // The close's refresh rejects with an AbortError-shaped error; the
    // gate releases with no timer advanced.
    vi.mocked(getAssistantThread)
      .mockRejectedValueOnce(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      )
      .mockResolvedValue(deliveryDetail());
    endStream(RUN_ENDED);
    await settled();
    await settled();
    await settled();
    expect(_running(store)).toBe(false);

    // And the released gate actually works: a later settle attaches.
    store.noteDispatchSettled();
    await settled();
    await settled();
    await settled();
    expect(connectAgent).toHaveBeenCalledTimes(2);
    expect(store.activity.get().newestTurnStatus).toBe("working");
  });

  it("a retryStream landing while the close's refresh is STALLED still hands the fresh epoch its decision at the bound", async () => {
    // The load-bearing reschedule, stall-shaped: the mooted close's
    // finally must still fire — at the bound — and hand the epoch that
    // won its connect decision. Without it a restarted run sits with
    // no socket on a working turn (the idle re-read is disarmed while
    // the turn holds a stream).
    vi.useFakeTimers();
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(parkedDetail());
    connectAgent.mockImplementation(() => Promise.resolve(RUN_ENDED));
    const store = aStore();
    store.acquireTranscriptLease("page");
    store.bootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(connectAgent).toHaveBeenCalledTimes(1);

    // A settle attaches a delivery turn; the attach's connection is held.
    let endAttach!: (result: RunAgentResult) => void;
    connectAgent
      .mockImplementationOnce(
        () =>
          new Promise<RunAgentResult>((resolve) => {
            endAttach = resolve;
          }),
      )
      .mockImplementation(() => new Promise<never>(() => undefined));
    vi.mocked(getAssistantThread)
      .mockResolvedValueOnce(deliveryDetail())
      .mockImplementation(() => new Promise<never>(() => undefined));
    store.noteDispatchSettled();
    await vi.advanceTimersByTimeAsync(0);
    expect(connectAgent).toHaveBeenCalledTimes(2);

    // The attach's stream ends and its post-close refresh STALLS: the
    // gate is held when retryStream retires the epoch — the fresh
    // epoch's own sync bails on _connectionRunning.
    endAttach(RUN_ENDED);
    await vi.advanceTimersByTimeAsync(0);
    store.retryStream();
    await vi.advanceTimersByTimeAsync(0);
    expect(connectAgent).toHaveBeenCalledTimes(2);

    // At the bound the finally releases the gate and the moot reschedule
    // connects the epoch that won.
    await vi.advanceTimersByTimeAsync(CONNECTION_ENDED_REFRESH_BOUND_MS);
    expect(connectAgent).toHaveBeenCalledTimes(3);
    expect(store.activity.get().newestTurnStatus).toBe("working");
  });

  it("a bounded-out refresh landing late cannot clobber newer truth — adoption is monotonic in issue order", async () => {
    // The other half of the bound's contract: releasing the gate at the
    // bound leaves the GET pending, and this transport never settles a
    // stalled request on its own — so the response may land MINUTES
    // late, after fresher truth adopted. It must adopt nothing.
    vi.useFakeTimers();
    const { store, endStream } = await aLeasedWorkingPage();

    // The close's refresh is HELD — it will land long after the bound.
    const late = _deferredDetail();
    vi.mocked(getAssistantThread)
      .mockImplementationOnce(() => late.promise)
      .mockImplementation(() => new Promise<never>(() => undefined));
    endStream(RUN_ENDED);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(CONNECTION_ENDED_REFRESH_BOUND_MS);

    // Newer truth lands: a fresh refresh adopts the settled turn.
    vi.mocked(getAssistantThread).mockResolvedValueOnce(succeededDetail());
    await store.refreshConversation();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.activity.get().newestTurnStatus).toBe("succeeded");

    // The bounded-out read finally lands with its stale working
    // snapshot: monotonic adoption bars it.
    late.resolve(workingDetail());
    await vi.advanceTimersByTimeAsync(0);
    expect(store.activity.get().newestTurnStatus).toBe("succeeded");
  });
});
