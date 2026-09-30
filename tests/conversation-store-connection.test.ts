// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { ApprovalInbox } from "../src/core/approval-inbox";
import { writeStoredThread } from "../src/persistence/stored-thread";
import {
  getAssistantThread,
  listAssistantThreads,
  resolveTurnApproval,
} from "../src/transport/serving-api";

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
  detachActiveRun,
  detailOf,
  installConversationStoreLifecycle,
  PK,
  RUN_ENDED,
  settled,
  threadOf,
  turnOf,
} from "./conversation-store-harness";

installConversationStoreLifecycle();

// The connection and presence plane (split from the stopping family
// file, whose name covered only its first half — the same drifted-
// banner shape composer-input-state.ts records on the source side):
// the connection truth table, the transcript lease, thread-switch
// confinement of in-flight completions, the park/reconnect-cap arms,
// and dispose→bootstrap revival.
describe("AssistantConversationStore", () => {
  it("identification flips historyExpected and loads the history once", async () => {
    vi.mocked(listAssistantThreads).mockResolvedValue([threadOf()]);
    const store = aStore();
    store.bootstrap();
    expect(store.conversation.get().historyExpected).toBe(false);

    store.setTier("identified");
    store.setTier("identified");
    await settled();

    expect(store.conversation.get().historyExpected).toBe(true);
    expect(store.conversation.get().threads).toHaveLength(1);
    expect(vi.mocked(listAssistantThreads)).toHaveBeenCalledTimes(1);
  });

  it("connects headlessly while a turn is working and no chrome is mounted", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf({ busy: true }), [turnOf({ status: "working" })]),
    );
    const store = aStore();

    store.bootstrap();
    await settled();

    expect(connectAgent).toHaveBeenCalledTimes(1);
  });

  it("holds NO socket for a parked turn — the epoch stays armed instead", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf({ busy: true }), [turnOf({ status: "parked" })]),
    );
    const store = aStore();

    store.bootstrap();
    await settled();

    // Parked is live for the lease/driver/activity lifetime, never the
    // socket: an hour-long park must not hold an hour-long SSE.
    expect(connectAgent).not.toHaveBeenCalled();
    expect(store.connection.get()).not.toBeNull();
    expect(store.activity.get().newestTurnStatus).toBe("parked");
  });

  it("a mounted surface makes the store connect — the store is the only driver", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf({ busy: true }), [turnOf({ status: "working" })]),
    );
    const store = aStore();
    store.acquireTranscriptLease("page");

    store.bootstrap();
    await settled();

    expect(connectAgent).toHaveBeenCalledTimes(1);
  });

  it("a mounted surface connects a SETTLED thread exactly once — history paints by full replay, then idle", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    // The default turn is succeeded: nothing holds a stream.
    vi.mocked(getAssistantThread).mockResolvedValue(detailOf(threadOf()));
    connectAgent.mockImplementation(() => Promise.resolve(RUN_ENDED));
    const store = aStore();
    store.acquireTranscriptLease("page");
    store.bootstrap();
    await settled();
    await settled();

    // One replay for the history; the settled turn demands no reconnect,
    // and a second surface adds nothing (the cells are shared).
    expect(connectAgent).toHaveBeenCalledTimes(1);
    store.acquireTranscriptLease("palette");
    await settled();
    expect(connectAgent).toHaveBeenCalledTimes(1);
  });

  it("the last surface leaving changes nothing mid-turn — the store's run keeps streaming", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf({ busy: true }), [turnOf({ status: "working" })]),
    );
    const store = aStore();
    const release = store.acquireTranscriptLease("palette");
    store.bootstrap();
    await settled();
    expect(connectAgent).toHaveBeenCalledTimes(1);
    const nonceBefore = store.conversation.get().reconnectNonce;

    release();
    await settled();

    // No abort, no second connect, no nonce bump: the run in flight IS
    // the store's run, and unmounting chrome is not a connection event.
    expect(detachActiveRun).not.toHaveBeenCalled();
    expect(connectAgent).toHaveBeenCalledTimes(1);
    expect(store.conversation.get().reconnectNonce).toBe(nonceBefore);
  });

  it("a surface mounting mid-run neither aborts nor doubles the connection", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf({ busy: true }), [turnOf({ status: "working" })]),
    );
    const store = aStore();
    store.bootstrap();
    await settled();
    // No surface + working turn: the store connected, and the run is
    // still in flight (connectAgent is the pending-forever default).
    expect(connectAgent).toHaveBeenCalledTimes(1);

    // A chrome mounts mid-turn: it renders the same cells the run is
    // already feeding — there is no second driver to collide with.
    store.acquireTranscriptLease("palette");
    await settled();

    expect(detachActiveRun).not.toHaveBeenCalled();
    expect(connectAgent).toHaveBeenCalledTimes(1);
  });

  it("a keyed remount (release then re-acquire same tick) does NOT bump the nonce — the loop guard", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf({ busy: true }), [turnOf({ status: "working" })]),
    );
    const store = aStore();
    const releaseOld = store.acquireTranscriptLease("page");
    store.bootstrap();
    await settled();
    const nonceBefore = store.conversation.get().reconnectNonce;

    // Exactly what a keyed <Transcript> remount does: the old instance's
    // effect cleanup releases and the new instance's setup re-acquires in
    // the same synchronous tick. A synchronous nonce bump here would change
    // the key, remount again, and cascade (the streaming-turn infinite
    // loop). The deferred handoff must see the re-acquire and stand down.
    releaseOld();
    store.acquireTranscriptLease("page");
    await settled();

    expect(store.conversation.get().reconnectNonce).toBe(nonceBefore);
    // The remount is not a connection event either: the epoch connected
    // once for the mounted surface and stays connected through it.
    expect(connectAgent).toHaveBeenCalledTimes(1);
  });

  it("a second surface acquiring is silent — concurrent chromes are supported, not a fault", () => {
    const reportError = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const store = aStore({ reportError });

    // The page is mounted; opening the palette over it (the ⌘J dogfood
    // interaction) is a sanctioned first-class interaction, not an error
    // to route to the host's tracking — both render the same cells.
    store.acquireTranscriptLease("page");
    store.acquireTranscriptLease("palette");

    expect(reportError).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("an approval submit resolving after a thread switch does NOT stamp its stale card onto the new thread", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread)
      // thread-1 resume: a PAUSED turn whose run the ledger can name for
      // the submit — a marker under a settled turn's run opens no card
      // (the settled-runs memory).
      .mockResolvedValueOnce(
        detailOf(threadOf(), [
          turnOf({
            id: "t1",
            run_id: "run-1",
            status: "awaiting_input",
            pending_interrupt_ids: ["v1:before_tool_call:t1:handler"],
            awaiting_round: 0,
          }),
        ]),
      )
      // thread-2 open: the epoch the stale submit must not pollute.
      .mockResolvedValue(
        detailOf(threadOf({ id: "thread-2", stream_thread_id: "stream-2" }), [
          turnOf({ id: "t2", run_id: "run-2", status: "working" }),
        ]),
      );
    const store = aStore();
    store.bootstrap();
    await settled();

    // Seed a pending approval card on thread-1's live epoch inbox, then
    // pick the card the human would answer.
    const inbox = (
      store as unknown as { _epoch: { approvalInbox: ApprovalInbox } }
    )._epoch.approvalInbox;
    inbox.noteRunStarted("run-1");
    inbox.noteApprovalRequested({
      interrupt_id: "v1:before_tool_call:t1:handler",
      tool_name: "delete_doc",
      tool_args: { doc_id: "doc-1" },
      tool_input_schema: null,
      tool_output_schema: null,
      prompt: "Delete a doc?",
      tool_call_id: "run-1-a1-t1",
      round: 0,
      gated: false,
      trust_available: false,
    });
    const card = inbox.cards()[0];

    // Gate the resolve POST so the thread switch lands mid-flight.
    let releaseResolve: () => void = () => undefined;
    vi.mocked(resolveTurnApproval).mockReturnValue(
      new Promise((resolve) => {
        releaseResolve = () => {
          resolve({ delivery: "signaled" } as Awaited<
            ReturnType<typeof resolveTurnApproval>
          >);
        };
      }),
    );

    const submitting = store.submitApprovalDecision(card, { approved: true });
    await settled();
    // Switch threads while the POST is in flight — a fresh epoch takes over.
    store.openThread(
      threadOf({ id: "thread-2", stream_thread_id: "stream-2" }),
    );
    await settled();
    releaseResolve();
    await submitting;
    await settled();

    // The stale submit's finally must not have republished thread-1's
    // answered card onto thread-2's now-active (empty) approvals cell.
    expect(store.approvals.get()).toEqual([]);
  });

  it("does not leak the previous thread's lastResult when switching to an in-progress thread", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    // Thread 1 resumes with a FAILED terminal turn — the feed's lastResult.
    vi.mocked(getAssistantThread).mockResolvedValueOnce(
      detailOf(threadOf(), [
        turnOf({ id: "t1", status: "failed", error: "thread-1 failed" }),
      ]),
    );
    const store = aStore();
    store.bootstrap();
    await settled();
    expect(store.activity.get().lastResult?.failureSentence).toBe(
      "thread-1 failed",
    );

    // Switch to thread 2 whose newest turn is still WORKING — no result yet.
    const thread2 = threadOf({ id: "thread-2", stream_thread_id: "stream-2" });
    vi.mocked(getAssistantThread).mockResolvedValueOnce(
      detailOf(thread2, [turnOf({ id: "t2", status: "working" })]),
    );
    store.openThread(thread2);
    await settled();

    expect(store.activity.get().newestTurnStatus).toBe("working");
    // The feed must reflect thread 2, not still show thread 1's failure.
    expect(store.activity.get().lastResult).toBeNull();
  });

  it("stops without reconnecting when the headless stream ends at a park", async () => {
    connectAgent.mockImplementation(() => Promise.resolve(RUN_ENDED));
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread)
      .mockResolvedValueOnce(
        detailOf(threadOf({ busy: true }), [turnOf({ status: "working" })]),
      )
      .mockResolvedValue(
        detailOf(threadOf({ busy: true }), [turnOf({ status: "parked" })]),
      );
    const store = aStore();

    store.bootstrap();
    await vi.waitFor(() => {
      expect(store.activity.get().newestTurnStatus).toBe("parked");
    });

    // The park is a designed stop: resumption rides the human's POST.
    expect(connectAgent).toHaveBeenCalledTimes(1);
    expect(store.conversation.get().showInterruptionBanner).toBe(false);
  });

  it("caps consecutive automatic reconnects and surfaces stream-trouble", async () => {
    connectAgent.mockImplementation(() => Promise.resolve(RUN_ENDED));
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    // The turn never moves: every reconnect finds the identical truth.
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf({ busy: true }), [turnOf({ status: "working" })]),
    );
    const store = aStore();

    store.bootstrap();
    await vi.waitFor(() => {
      expect(store.conversation.get().showInterruptionBanner).toBe(true);
    });

    // MAX_AUTOMATIC_RECONNECTS = 5: the bound, not just a stop condition.
    expect(connectAgent).toHaveBeenCalledTimes(5);
  });

  it("dispose stops timers and bootstrap revives the store (StrictMode)", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(detailOf(threadOf()));
    const store = aStore();

    store.bootstrap();
    store.dispose();
    store.bootstrap();
    await settled();

    expect(store.conversation.get().active?.thread.id).toBe("thread-1");
  });
});
