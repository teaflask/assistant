// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type {
  AssistantThreadDetailResponse,
  ServingAssistantThread,
  ServingAssistantTurn,
} from "../src/contract/threads";

import type { ServingReplayStreamAgent } from "../src/transport/replay-stream-agent";
import {
  readStoredThread,
  writeStoredThread,
} from "../src/persistence/stored-thread";
import {
  getAssistantThread,
  sendAssistantMessage,
} from "../src/transport/serving-api";
import { ServingApiError } from "../src/transport/serving-error";

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
  detailOf,
  installConversationStoreLifecycle,
  PK,
  SESSION,
  settled,
  threadOf,
  turnOf,
} from "./conversation-store-harness";

installConversationStoreLifecycle();

describe("AssistantConversationStore", () => {
  it("bootstrap adopts the stored thread and publishes one stable snapshot", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(detailOf(threadOf()));
    const store = aStore();
    const listener = vi.fn();
    store.conversation.subscribe(listener);

    store.bootstrap();
    await settled();

    expect(store.conversation.get().active?.thread.id).toBe("thread-1");
    // The cached snapshot keeps its identity between reads.
    expect(store.conversation.get()).toBe(store.conversation.get());
    expect(listener).toHaveBeenCalled();
  });

  it("re-adopting the same thread keeps the ledger and resume store", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(detailOf(threadOf()));
    const store = aStore();
    store.bootstrap();
    await settled();
    const first = store.conversation.get().active;

    store.resumeStoredThread();
    await settled();
    const second = store.conversation.get().active;

    expect(second?.ledger).toBe(first?.ledger);
    expect(second?.resume).toBe(first?.resume);
  });

  it("a full turns window backfills older pages into the ledger, in order", async () => {
    // The serving detail caps turns at the newest 200; the stream replay
    // is the whole conversation, so the ledger walks the cursor back —
    // otherwise old runs replay with the wrong user message spliced in.
    const newestWindow = Array.from({ length: 200 }, (_, index) =>
      turnOf({
        id: `turn-${String(index + 100)}`,
        run_id: `run-${String(index + 100)}`,
        user_message: `newer ${String(index + 100)}`,
      }),
    );
    const olderPage = [
      turnOf({ id: "turn-1", run_id: "run-1", user_message: "the oldest ask" }),
    ];
    vi.mocked(getAssistantThread)
      .mockResolvedValueOnce(detailOf(threadOf(), newestWindow))
      .mockResolvedValueOnce(detailOf(threadOf(), olderPage));
    const store = aStore();

    store.openThread(threadOf());
    await settled();
    await settled();

    expect(vi.mocked(getAssistantThread)).toHaveBeenCalledWith(
      SESSION,
      "thread-1",
      {
        before_created_at: newestWindow[0].created_at,
        before_id: newestWindow[0].id,
        limit: 200,
      },
    );
    const ledger = store.conversation.get().active?.ledger;
    expect(ledger?.turnForRun("run-1")?.userMessage).toBe("the oldest ask");
    // Conversation order survives the prepend: the newest turn is still
    // the ledger's newest (the approval fallback depends on it).
    expect(ledger?.newestTurn()?.turnId).toBe("turn-299");
  });

  it("starting a new conversation kills an in-flight backfill — no resurrection", async () => {
    const newestWindow = Array.from({ length: 200 }, (_, index) =>
      turnOf({
        id: `turn-${String(index + 100)}`,
        run_id: `run-${String(index + 100)}`,
      }),
    );
    let releaseOlder: (detail: AssistantThreadDetailResponse) => void = () => {
      throw new Error("the older page was never awaited");
    };
    vi.mocked(getAssistantThread)
      .mockResolvedValueOnce(detailOf(threadOf(), newestWindow))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          releaseOlder = resolve;
        }),
      );
    const store = aStore();

    store.openThread(threadOf());
    await settled();
    store.startNewConversation();
    await settled();
    // The abandoned thread's drain resolves late — it must adopt nothing
    // over the fresh empty state.
    releaseOlder(detailOf(threadOf(), [turnOf()]));
    await settled();

    expect(store.conversation.get().active).toBeNull();
  });

  it("a short turns window never backfills", async () => {
    vi.mocked(getAssistantThread).mockResolvedValue(detailOf(threadOf()));
    const store = aStore();

    store.openThread(threadOf());
    await settled();
    await settled();

    expect(vi.mocked(getAssistantThread)).toHaveBeenCalledTimes(1);
  });

  it("a stale resume never overwrites a newer adoption", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    let releaseFirst: (detail: AssistantThreadDetailResponse) => void = () => {
      throw new Error("first resume was never awaited");
    };
    vi.mocked(getAssistantThread)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          releaseFirst = resolve;
        }),
      )
      .mockResolvedValueOnce(
        detailOf(threadOf({ id: "thread-2", title: "Newer" })),
      );
    const store = aStore();

    store.resumeStoredThread();
    writeStoredThread(PK, { threadId: "thread-2", identified: false });
    store.resumeStoredThread();
    await settled();
    // The first request resolves late, after the second already adopted.
    releaseFirst(detailOf(threadOf()));
    await settled();

    expect(store.conversation.get().active?.thread.id).toBe("thread-2");
  });

  it("resuming with nothing stored follows another surface to the empty state", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(detailOf(threadOf()));
    const store = aStore();
    store.bootstrap();
    await settled();

    localStorage.clear();
    store.resumeStoredThread();

    expect(store.conversation.get().active).toBeNull();
  });

  it("a 404 on resume clears the stored pointer and starts clean", async () => {
    writeStoredThread(PK, { threadId: "thread-gone", identified: false });
    vi.mocked(getAssistantThread).mockRejectedValue(
      new ServingApiError({
        code: "NOT_FOUND",
        message: "gone",
        status: 404,
        retryAfterSeconds: null,
      }),
    );
    const store = aStore();

    store.bootstrap();
    await settled();

    expect(readStoredThread(PK)).toBeNull();
    expect(store.conversation.get().active).toBeNull();
  });

  it("threadOpening covers the detail fetch: true from openThread until adoption, false on failure", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValueOnce(detailOf(threadOf()));
    const store = aStore();
    store.bootstrap();
    await settled();

    let releaseDetail: (detail: AssistantThreadDetailResponse) => void = () => {
      throw new Error("detail was never awaited");
    };
    vi.mocked(getAssistantThread).mockReturnValueOnce(
      new Promise((resolve) => {
        releaseDetail = resolve;
      }),
    );
    const thread2 = threadOf({ id: "thread-2", stream_thread_id: "stream-2" });
    store.openThread(thread2);
    expect(store.conversation.get().threadOpening).toBe(true);

    releaseDetail(detailOf(thread2));
    await settled();
    expect(store.conversation.get().threadOpening).toBe(false);
    expect(store.conversation.get().active?.thread.id).toBe("thread-2");
  });

  it("a retired epoch's late message publish is dropped — no publish outlives its epoch", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread)
      .mockResolvedValueOnce(detailOf(threadOf()))
      .mockResolvedValue(
        detailOf(threadOf({ id: "thread-2", stream_thread_id: "stream-2" })),
      );
    const store = aStore();
    store.bootstrap();
    await settled();
    const firstAgent = (
      store as unknown as { _epoch: { agent: ServingReplayStreamAgent } }
    )._epoch.agent;

    store.openThread(
      threadOf({ id: "thread-2", stream_thread_id: "stream-2" }),
    );
    await settled();

    // The retired epoch's agent moves after the swap (a run-to-completion
    // tail); its recorder must not stamp the old thread's messages onto
    // the now-active cell.
    firstAgent.addMessages([
      { id: "stale-1", role: "user", content: "from thread-1" },
    ]);
    await settled();

    expect(
      store.messages.get().some((message) => message.id === "stale-1"),
    ).toBe(false);
  });

  it("a landed send adopts the thread, echoes, bumps the nonce, and stores the pointer", async () => {
    vi.mocked(sendAssistantMessage).mockResolvedValue({
      thread: threadOf({ busy: true }),
      turn: turnOf({ status: "queued" }),
    });
    const store = aStore();

    const landed = await store.sendMessage("hello");

    expect(landed).toBe(true);
    expect(store.conversation.get().active?.thread.id).toBe("thread-1");
    expect(store.conversation.get().reconnectNonce).toBe(1);
    expect(store.composer.get().pendingEcho?.text).toBe("hello");
    expect(store.composer.get().busy).toBe(true);
    expect(store.composer.get().composerRefocusPending).toBe(true);
    expect(readStoredThread(PK)).toEqual({
      threadId: "thread-1",
      identified: false,
    });
  });

  it("publishes the user message optimistically before the send response lands", async () => {
    let land: (value: {
      thread: ServingAssistantThread;
      turn: ServingAssistantTurn;
    }) => void = () => {
      throw new Error("send did not start");
    };
    vi.mocked(sendAssistantMessage).mockImplementation(
      () =>
        new Promise<{
          thread: ServingAssistantThread;
          turn: ServingAssistantTurn;
        }>((resolve) => {
          land = resolve;
        }),
    );
    const store = aStore();

    const sending = store.sendMessage("hello now");
    const optimistic = store.composer.get().pendingEcho;
    expect(optimistic?.text).toBe("hello now");
    expect(optimistic?.messageId.startsWith("optimistic-user-")).toBe(true);

    land({
      thread: threadOf({ busy: true }),
      turn: turnOf({ status: "queued", user_message: "hello now" }),
    });
    await sending;
    expect(store.composer.get().pendingEcho).toMatchObject({
      text: "hello now",
      messageId: "user:turn-1",
    });
  });

  it("treats a busy refusal as reconciliation, not a red send error", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread)
      .mockResolvedValueOnce(detailOf(threadOf()))
      .mockResolvedValueOnce(
        detailOf(threadOf({ busy: true }), [turnOf({ status: "working" })]),
      );
    const store = aStore();
    store.bootstrap();
    await settled();
    vi.mocked(sendAssistantMessage).mockRejectedValue(
      new ServingApiError({
        code: "ASSISTANT_THREAD_BUSY",
        message: "still working",
        status: 409,
        retryAfterSeconds: null,
      }),
    );

    const landed = await store.sendMessage("keep this draft");

    expect(landed).toBe(false);
    expect(store.conversation.get().sendError).toBeNull();
    expect(store.composer.get().pendingEcho).toBeNull();
    expect(store.composer.get().busy).toBe(true);
    expect(getAssistantThread).toHaveBeenCalledTimes(2);
  });

  it("a gate-shaped refusal hands the error to the gate and stands the banner down", async () => {
    const onGateRefusal = vi.fn();
    const refusal = new ServingApiError({
      code: "SUBSCRIPTION_CONNECT_REQUIRED",
      message: "Reconnect your ChatGPT plan to continue here.",
      status: 403,
      retryAfterSeconds: null,
      details: { providers: ["openai_chatgpt"], reason: "auth_bounced" },
    });
    vi.mocked(sendAssistantMessage).mockRejectedValue(refusal);
    const store = aStore({ onGateRefusal });

    const landed = await store.sendMessage("hello");

    expect(landed).toBe(false);
    // The gate card owns the moment — the same sentence must not also
    // paint as a red banner above it.
    expect(store.conversation.get().sendError).toBeNull();
    expect(onGateRefusal).toHaveBeenCalledTimes(1);
    expect(onGateRefusal).toHaveBeenCalledWith(refusal);
  });

  it("a sign-in refusal is gate-shaped too", async () => {
    const onGateRefusal = vi.fn();
    vi.mocked(sendAssistantMessage).mockRejectedValue(
      new ServingApiError({
        code: "ASSISTANT_SIGN_IN_REQUIRED",
        message: "Please sign in to this site to chat with the assistant.",
        status: 403,
        retryAfterSeconds: null,
      }),
    );
    const store = aStore({ onGateRefusal });

    await store.sendMessage("hello");

    expect(store.conversation.get().sendError).toBeNull();
    expect(onGateRefusal).toHaveBeenCalledTimes(1);
  });

  it("other send failures keep the banner and never touch the gate", async () => {
    const onGateRefusal = vi.fn();
    vi.mocked(sendAssistantMessage).mockRejectedValue(
      new ServingApiError({
        code: "RATE_LIMITED",
        message: "slow down",
        status: 429,
        retryAfterSeconds: 30,
      }),
    );
    const store = aStore({ onGateRefusal });

    await store.sendMessage("hello");

    expect(store.conversation.get().sendError).not.toBeNull();
    expect(onGateRefusal).not.toHaveBeenCalled();
  });

  it("a failed send keeps the conversation and surfaces the honest sentence", async () => {
    const reportError = vi.fn();
    vi.mocked(sendAssistantMessage).mockRejectedValue(
      new ServingApiError({
        code: "RATE_LIMITED",
        message: "slow down",
        status: 429,
        retryAfterSeconds: 30,
      }),
    );
    const store = aStore({ reportError });

    const landed = await store.sendMessage("hello");

    expect(landed).toBe(false);
    expect(store.conversation.get().sendError).toContain(
      "sending messages too quickly",
    );
    expect(store.composer.get().busy).toBe(false);
    expect(reportError).toHaveBeenCalled();
  });

  it("a quiet close on a turn the workflow still owns raises the banner", async () => {
    vi.mocked(sendAssistantMessage).mockResolvedValue({
      thread: threadOf({ busy: true }),
      turn: turnOf({ status: "working" }),
    });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf({ busy: true }), [turnOf({ status: "working" })]),
    );
    const store = aStore();
    await store.sendMessage("hello");

    store.handleStreamClosedQuietly(() => false);
    await settled();

    expect(store.conversation.get().showInterruptionBanner).toBe(true);
  });

  it("a quiet close on a parked turn stays banner-free", async () => {
    vi.mocked(sendAssistantMessage).mockResolvedValue({
      thread: threadOf({ busy: true }),
      turn: turnOf({ status: "working" }),
    });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf({ busy: true }), [turnOf({ status: "parked" })]),
    );
    const store = aStore();
    await store.sendMessage("hello");

    store.handleStreamClosedQuietly(() => false);
    await settled();

    expect(store.conversation.get().showInterruptionBanner).toBe(false);
  });

  it("reconnects after a workflow restart once the turn stops reading parked", async () => {
    vi.useFakeTimers();
    vi.mocked(sendAssistantMessage).mockResolvedValue({
      thread: threadOf({ busy: true }),
      turn: turnOf({ status: "working" }),
    });
    const store = aStore();
    await store.sendMessage("hello");
    const nonceBefore = store.conversation.get().reconnectNonce;

    vi.mocked(getAssistantThread)
      .mockResolvedValueOnce(
        detailOf(threadOf({ busy: true }), [turnOf({ status: "parked" })]),
      )
      .mockResolvedValue(
        detailOf(threadOf({ busy: true }), [turnOf({ status: "working" })]),
      );
    store.handleWorkflowRestarted();
    await vi.advanceTimersByTimeAsync(1200);

    expect(store.conversation.get().reconnectNonce).toBe(nonceBefore + 1);
  });
});
