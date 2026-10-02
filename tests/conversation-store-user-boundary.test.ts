// @vitest-environment jsdom

// The user boundary as the store sees it: a disposed or superseded store
// writes nothing when a late answer lands, the stored pointer belongs to
// the user it was written for, and a history entry that 404s leaves the
// list.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AssistantThreadDetailResponse,
  ServingAssistantThread,
  ServingAssistantTurn,
} from "../src/contract/threads";
import { refreshThreads } from "../src/core/conversation-adoption";
import {
  readStoredThread,
  writeStoredThread,
} from "../src/persistence/stored-thread";
import {
  getAssistantThread,
  listAssistantThreads,
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
  settled,
  threadOf,
  turnOf,
} from "./conversation-store-harness";

installConversationStoreLifecycle();

beforeEach(() => {
  // The identified stores below load history on setTier; an empty list
  // is the quiet default, overridden per case where the list matters.
  vi.mocked(listAssistantThreads).mockResolvedValue([]);
});

const USER_A = "user-a";
const USER_B = "user-b";

function notFound(): ServingApiError {
  return new ServingApiError({
    code: "NOT_FOUND",
    message: "gone",
    status: 404,
    retryAfterSeconds: null,
  });
}

function deferred<Value>() {
  let resolve: (value: Value) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<Value>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("late answers after dispose", () => {
  it("a refreshThreads answer landing after dispose is ignored", async () => {
    const list = deferred<ServingAssistantThread[]>();
    const store = aStore({ userId: USER_A });
    store.setTier("identified");
    await settled();
    vi.mocked(listAssistantThreads).mockReturnValueOnce(list.promise);
    const refresh = refreshThreads(store);

    store.dispose();
    list.resolve([threadOf({ id: "late" })]);
    await refresh;
    await settled();

    expect(store.conversation.get().threads).toEqual([]);
  });

  it("refreshThreads on an already disposed store asks nothing", async () => {
    const store = aStore({ userId: USER_A });
    store.setTier("identified");
    await settled();
    vi.mocked(listAssistantThreads).mockClear();
    store.dispose();

    await refreshThreads(store);

    expect(listAssistantThreads).not.toHaveBeenCalled();
  });

  it("an openThread detail landing after dispose adopts nothing and writes no pointer", async () => {
    const detail = deferred<AssistantThreadDetailResponse>();
    vi.mocked(getAssistantThread).mockReturnValueOnce(detail.promise);
    const store = aStore({ userId: USER_A });
    store.setTier("identified");

    store.openThread(threadOf({ id: "picked" }));
    store.dispose();
    detail.resolve(detailOf(threadOf({ id: "picked" })));
    await settled();

    expect(store.conversation.get().active).toBeNull();
    expect(readStoredThread(PK)).toBeNull();
  });

  it("an openThread answer superseded by a later open is ignored", async () => {
    const first = deferred<AssistantThreadDetailResponse>();
    vi.mocked(getAssistantThread)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(detailOf(threadOf({ id: "second" })));
    const store = aStore({ userId: USER_A });
    store.setTier("identified");

    store.openThread(threadOf({ id: "first" }));
    store.openThread(threadOf({ id: "second" }));
    await settled();
    first.resolve(detailOf(threadOf({ id: "first" })));
    await settled();

    expect(store.conversation.get().active?.thread.id).toBe("second");
    expect(readStoredThread(PK)?.threadId).toBe("second");
  });
});

describe("a send landing after the user changed", () => {
  it("writes nothing: the next user's pointer and conversation stand", async () => {
    let land: (value: {
      thread: ServingAssistantThread;
      turn: ServingAssistantTurn;
    }) => void = () => undefined;
    vi.mocked(sendAssistantMessage).mockImplementation(
      () =>
        new Promise<{
          thread: ServingAssistantThread;
          turn: ServingAssistantTurn;
        }>((resolve) => {
          land = resolve;
        }),
    );
    const previous = aStore({ userId: USER_A });
    previous.setTier("identified");
    const sending = previous.sendMessage("from the previous user");
    // The account changed in another tab: the registry swept this store.
    previous.dispose();

    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf({ id: "thread-b" })),
    );
    const next = aStore({ userId: USER_B });
    next.setTier("identified");
    next.openThread(threadOf({ id: "thread-b" }));
    await settled();
    expect(readStoredThread(PK)).toEqual({
      threadId: "thread-b",
      identified: true,
      userId: USER_B,
    });

    land({
      thread: threadOf({ id: "thread-a" }),
      turn: turnOf({ thread_id: "thread-a", status: "queued" }),
    });
    await sending;
    await settled();

    expect(readStoredThread(PK)).toEqual({
      threadId: "thread-b",
      identified: true,
      userId: USER_B,
    });
    expect(previous.conversation.get().active).toBeNull();
    // The next user's resume still finds their own pointer.
    next.resumeStoredThread();
    await settled();
    expect(next.conversation.get().active?.thread.id).toBe("thread-b");
  });
});

describe("a landed send supersedes an in-flight open", () => {
  it("ends the opening skeleton with the discarded open, and keeps the sent thread", async () => {
    let land: (value: {
      thread: ServingAssistantThread;
      turn: ServingAssistantTurn;
    }) => void = () => undefined;
    vi.mocked(sendAssistantMessage).mockImplementation(
      () =>
        new Promise<{
          thread: ServingAssistantThread;
          turn: ServingAssistantTurn;
        }>((resolve) => {
          land = resolve;
        }),
    );
    const detail = deferred<AssistantThreadDetailResponse>();
    vi.mocked(getAssistantThread).mockReturnValueOnce(detail.promise);
    const store = aStore({ userId: USER_A });
    store.setTier("identified");
    await settled();

    // The visitor sends, then picks a history row while the POST flies.
    const sending = store.sendMessage("hello");
    store.openThread(threadOf({ id: "picked" }));
    expect(store.conversation.get().threadOpening).toBe(true);

    // The 201 lands first: the sent conversation is the one on screen,
    // and nothing may keep a skeleton over its streaming turn.
    const sent = threadOf({ id: "sent", stream_thread_id: "stream-sent" });
    land({
      thread: sent,
      turn: turnOf({ thread_id: "sent", status: "queued" }),
    });
    await sending;
    await settled();
    expect(store.conversation.get().active?.thread.id).toBe("sent");
    expect(store.conversation.get().threadOpening).toBe(false);

    // The picked thread's detail arriving late changes nothing.
    detail.resolve(detailOf(threadOf({ id: "picked" })));
    await settled();
    expect(store.conversation.get().active?.thread.id).toBe("sent");
    expect(store.conversation.get().threadOpening).toBe(false);
    expect(readStoredThread(PK)?.threadId).toBe("sent");
  });
});

describe("a history pick that is gone", () => {
  it("drops the entry from the list and says the conversation isn't available", async () => {
    vi.mocked(listAssistantThreads).mockResolvedValue([
      threadOf({ id: "alive" }),
      threadOf({ id: "gone" }),
    ]);
    vi.mocked(getAssistantThread).mockRejectedValueOnce(notFound());
    const store = aStore({ userId: USER_A });
    store.setTier("identified");
    await settled();
    expect(store.conversation.get().threads.map((t) => t.id)).toEqual([
      "alive",
      "gone",
    ]);

    store.openThread(threadOf({ id: "gone" }));
    await settled();

    const snapshot = store.conversation.get();
    expect(snapshot.threads.map((t) => t.id)).toEqual(["alive"]);
    expect(snapshot.sendError).toBe("That conversation isn't available.");
  });
});

describe("the stored pointer belongs to its user", () => {
  it("B never resumes A's identified pointer — it is dropped instead", async () => {
    writeStoredThread(PK, {
      threadId: "thread-a",
      identified: true,
      userId: USER_A,
    });
    const store = aStore({ userId: USER_B });

    store.bootstrap();
    await settled();

    expect(getAssistantThread).not.toHaveBeenCalled();
    expect(store.conversation.get().active).toBeNull();
    expect(readStoredThread(PK)).toBeNull();
  });

  it("an anonymous session declines an identified pointer but leaves it for its owner", async () => {
    writeStoredThread(PK, {
      threadId: "thread-a",
      identified: true,
      userId: USER_A,
    });
    const anonymous = aStore();
    anonymous.bootstrap();
    await settled();

    // Declined, not deleted: the host's userId may still be resolving.
    expect(getAssistantThread).not.toHaveBeenCalled();
    expect(anonymous.conversation.get().active).toBeNull();
    expect(readStoredThread(PK)).toEqual({
      threadId: "thread-a",
      identified: true,
      userId: USER_A,
    });

    // The owner, naming themselves a moment later, resumes it.
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf({ id: "thread-a" })),
    );
    const owner = aStore({ userId: USER_A });
    owner.bootstrap();
    await settled();
    expect(owner.conversation.get().active?.thread.id).toBe("thread-a");

    // A different user's session is what drops it.
    const other = aStore({ userId: USER_B });
    other.bootstrap();
    await settled();
    expect(readStoredThread(PK)).toBeNull();
  });

  it("an identified pointer without a user (written before users were named) is nobody's", async () => {
    writeStoredThread(PK, { threadId: "thread-legacy", identified: true });
    const store = aStore({ userId: USER_A });

    store.bootstrap();
    await settled();

    expect(getAssistantThread).not.toHaveBeenCalled();
    expect(readStoredThread(PK)).toBeNull();
  });

  it("A resumes A's own identified pointer", async () => {
    writeStoredThread(PK, {
      threadId: "thread-a",
      identified: true,
      userId: USER_A,
    });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf({ id: "thread-a" })),
    );
    const store = aStore({ userId: USER_A });

    store.bootstrap();
    await settled();

    expect(store.conversation.get().active?.thread.id).toBe("thread-a");
  });

  it("an anonymous pointer stays resumable by a signed-in session (the sign-in claim)", async () => {
    writeStoredThread(PK, { threadId: "thread-anon", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf({ id: "thread-anon" })),
    );
    const store = aStore({ userId: USER_A });

    store.bootstrap();
    await settled();

    expect(store.conversation.get().active?.thread.id).toBe("thread-anon");
    expect(readStoredThread(PK)).toEqual({
      threadId: "thread-anon",
      identified: false,
    });
  });

  it("an identified session writes the pointer for its user; an anonymous one writes no user", async () => {
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf({ id: "opened" })),
    );
    const identified = aStore({ userId: USER_A });
    identified.setTier("identified");
    identified.openThread(threadOf({ id: "opened" }));
    await settled();
    expect(readStoredThread(PK)).toEqual({
      threadId: "opened",
      identified: true,
      userId: USER_A,
    });

    const anonymous = aStore();
    anonymous.openThread(threadOf({ id: "opened" }));
    await settled();
    expect(readStoredThread(PK)).toEqual({
      threadId: "opened",
      identified: false,
    });
  });
});
