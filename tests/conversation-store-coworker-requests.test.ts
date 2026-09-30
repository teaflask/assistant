// @vitest-environment jsdom

// A coworker's request reaches the execution inbox from REST: the
// dispatching turn's snapshot lists it, the store's adoption hands it to
// the live epoch's inbox, the coworkerWork cell names it for the row, and
// a fresh epoch is re-seeded from the last adopted window.

import { describe, expect, it, vi } from "vitest";

import { writeStoredThread } from "../src/persistence/stored-thread";
import {
  getAssistantThread,
  sendAssistantMessage,
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
  detailOf,
  installConversationStoreLifecycle,
  PK,
  settled,
  threadOf,
  turnOf,
} from "./conversation-store-harness";

installConversationStoreLifecycle();

const COWORKER_INTERRUPT_ID = "v1:tool_call:cw-1";

function coworkerRequestOf() {
  return {
    ordinal: 3,
    label: "Refund order 41.",
    child_session_id: "subagent-thread-3",
    round: 0,
    expires_at: "2026-09-16T00:05:00Z",
    parked: false,
    card: {
      interrupt_id: COWORKER_INTERRUPT_ID,
      tool_name: "action__refund",
      tool_call_id: "cw-run-a1-t1",
      round: 0,
      request: { kind: "http_intent", intent: { method: "POST" } },
    },
  };
}

function dispatchingTurnOf(requests: ReturnType<typeof coworkerRequestOf>[]) {
  return turnOf({
    id: "turn-dispatching",
    status: "succeeded",
    run_id: "run-dispatching",
    pending_coworker_executions: requests,
  });
}

describe("a coworker's request from the dispatching turn's snapshot", () => {
  it("lands in the live epoch's inbox on the conversation read and names the coworker on the work cell", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [dispatchingTurnOf([coworkerRequestOf()])]),
    );
    const store = aStore();
    store.bootstrap();
    await settled();

    const entries = store._epoch?.executionInbox.entries() ?? [];
    expect(
      entries.map((entry) => ({
        interruptId: entry.interruptId,
        turnId: entry.turnId,
        asker: entry.asker,
        status: entry.status,
      })),
    ).toEqual([
      {
        interruptId: COWORKER_INTERRUPT_ID,
        turnId: "turn-dispatching",
        asker: { kind: "coworker", ordinal: 3 },
        status: { kind: "pending" },
      },
    ]);
    expect(store.coworkerWork.get().get(3)).toEqual({
      toolName: "action__refund",
      status: "pending",
      ok: null,
      via: "browser",
    });
  });

  it("a refresh that no longer lists the request drops it — the coworker's row left paused", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [dispatchingTurnOf([coworkerRequestOf()])]),
    );
    const store = aStore();
    store.bootstrap();
    await settled();
    expect(store.coworkerWork.get().size).toBe(1);

    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [dispatchingTurnOf([])]),
    );
    await store.refreshConversation();
    await settled();

    expect(store._epoch?.executionInbox.entries()).toEqual([]);
    expect(store.coworkerWork.get().size).toBe(0);
  });

  it("a fresh epoch is seeded from the last adopted window — a reconnect drops no ask", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [dispatchingTurnOf([coworkerRequestOf()])]),
    );
    const store = aStore();
    store.bootstrap();
    await settled();
    const first = store._epoch;
    expect(first).not.toBeNull();

    store.retryStream();
    await settled();

    expect(store._epoch).not.toBe(first);
    expect(store._epoch?.executionInbox.entries()).toEqual([
      expect.objectContaining({ interruptId: COWORKER_INTERRUPT_ID }),
    ]);
  });

  it("the member's send stales every coworker request AND the fresh epoch the send mints seeds none back — the withdrawn action never re-arms", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [dispatchingTurnOf([coworkerRequestOf()])]),
    );
    const store = aStore();
    store.bootstrap();
    await settled();
    const before = store._epoch;
    expect(store.coworkerWork.get().get(3)?.status).toBe("pending");

    vi.mocked(sendAssistantMessage).mockResolvedValue({
      thread: threadOf(),
      turn: turnOf({ id: "turn-sent", status: "queued", run_id: null }),
    });
    await store.sendMessage("Actually, cancel that.");
    await settled();

    // The send bumped the reconnect nonce: a NEW epoch with a fresh inbox.
    expect(store._epoch).not.toBe(before);
    const pending = (store._epoch?.executionInbox.entries() ?? []).filter(
      (entry) =>
        entry.asker.kind === "coworker" && entry.status.kind === "pending",
    );
    expect(pending).toEqual([]);
    expect(store._active?.coworkerRequestTurns).toEqual([]);
    expect(store.coworkerWork.get().get(3)?.status).not.toBe("pending");
  });

  it("a thread switch drops the previous thread's requests — the next thread's first epoch seeds none of them", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [dispatchingTurnOf([coworkerRequestOf()])]),
    );
    const store = aStore();
    store.bootstrap();
    await settled();
    expect(store.coworkerWork.get().size).toBe(1);

    const other = threadOf({ id: "thread-2", stream_thread_id: "stream-2" });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(other, [turnOf({ id: "turn-9", thread_id: "thread-2" })]),
    );
    store.openThread(other);
    await settled();
    await settled();

    expect(store._active?.thread.id).toBe("thread-2");
    expect(store._active?.coworkerRequestTurns).toEqual([
      expect.objectContaining({ id: "turn-9" }),
    ]);
    expect(store._epoch?.executionInbox.entries()).toEqual([]);
    expect(store.coworkerWork.get().size).toBe(0);
  });

  it("abandoning the conversation drops the window with it — a new conversation's first epoch seeds nothing", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [dispatchingTurnOf([coworkerRequestOf()])]),
    );
    const store = aStore();
    store.bootstrap();
    await settled();
    expect(store.coworkerWork.get().size).toBe(1);

    store.startNewConversation();
    await settled();

    expect(store._active).toBeNull();
    expect(store.coworkerWork.get().size).toBe(0);
  });
});
