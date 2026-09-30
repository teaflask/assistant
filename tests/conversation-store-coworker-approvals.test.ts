// @vitest-environment jsdom

// A coworker's approval card reaches the store from REST: the dispatching
// turn's snapshot lists it, the conversation read adopts it into the carried
// approval inbox, the submit posts to the DISPATCHING turn's door (never the
// newest or answerable turn), a 409 stales that card alone, and the member's
// send stales every coworker card.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { writeStoredThread } from "../src/persistence/stored-thread";
import {
  getAssistantThread,
  resolveTurnApproval,
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

const COWORKER_INTERRUPT_ID = "v1:before_tool_call:cw-cancel:gate-hash";

function coworkerApprovalOf(
  interruptId = COWORKER_INTERRUPT_ID,
  flags: { gated: boolean; trust_available: boolean } = {
    gated: true,
    trust_available: false,
  },
) {
  return {
    ordinal: 3,
    label: "Cancel subscription 41.",
    child_session_id: "subagent-thread-3",
    round: 2,
    expires_at: "2026-09-16T00:05:00Z",
    parked: false,
    card: {
      interrupt_id: interruptId,
      tool_name: "action__cancel",
      tool_args: {},
      tool_input_schema: null,
      tool_output_schema: null,
      prompt: 'A coworker wants to use "Cancel subscription".',
      tool_call_id: "cw-run-a1-t1",
      round: 2,
      ...flags,
    },
  };
}

function dispatchingTurnOf(approvals: ReturnType<typeof coworkerApprovalOf>[]) {
  return turnOf({
    id: "turn-dispatching",
    status: "succeeded",
    run_id: "run-dispatching",
    pending_coworker_approvals: approvals,
  });
}

// The window a reload reads: the settled dispatching turn, then a NEWER
// turn that is itself awaiting its own approval — the turn every
// assistant-card resolution would pick.
function windowOf(approvals = [coworkerApprovalOf()]) {
  return [
    dispatchingTurnOf(approvals),
    turnOf({
      id: "turn-newest",
      status: "awaiting_input",
      run_id: "run-newest",
      pending_interrupt_ids: ["v1:before_tool_call:own:hitl"],
      awaiting_round: 0,
    }),
  ];
}

async function storeWithCoworkerCard(approvals = [coworkerApprovalOf()]) {
  writeStoredThread(PK, { threadId: "thread-1", identified: false });
  vi.mocked(getAssistantThread).mockResolvedValue(
    detailOf(threadOf(), windowOf(approvals)),
  );
  const store = aStore();
  store.bootstrap();
  await settled();
  const card = store.approvals
    .get()
    .find((held) => held.interruptId === COWORKER_INTERRUPT_ID);
  if (card === undefined) {
    throw new Error("the coworker's card was not adopted");
  }
  return { store, card };
}

describe("a coworker's approval card from the dispatching turn's snapshot", () => {
  beforeEach(() => {
    vi.mocked(resolveTurnApproval).mockReset();
  });

  it("is adopted on the conversation read — a fresh store fed only the snapshot renders an actionable card naming the coworker", async () => {
    const { card } = await storeWithCoworkerCard();
    expect(card).toEqual(
      expect.objectContaining({
        asker: {
          kind: "coworker",
          ordinal: 3,
          label: "Cancel subscription 41.",
        },
        turnId: "turn-dispatching",
        runId: "run-dispatching",
        gated: true,
        trustAvailable: false,
        parked: false,
        status: { kind: "actionable", errorSentence: null },
      }),
    );
  });

  it("names the owed decision on the coworker's work cell, and a refresh that delists it clears the line", async () => {
    const { store } = await storeWithCoworkerCard();
    expect(store.coworkerWork.get().get(3)).toEqual({
      toolName: "action__cancel",
      status: "pending",
      ok: null,
      via: "approval",
    });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), windowOf([])),
    );
    await store.refreshConversation();
    expect(store.coworkerWork.get().size).toBe(0);
  });

  it("posts the decision to the DISPATCHING turn's door, not the newest awaiting turn — a gated card posts no trust token", async () => {
    const { store, card } = await storeWithCoworkerCard();
    vi.mocked(resolveTurnApproval).mockResolvedValue({
      delivery: "signaled",
    } as Awaited<ReturnType<typeof resolveTurnApproval>>);

    await store.submitApprovalDecision(card, { approved: true, trust: true });

    expect(resolveTurnApproval).toHaveBeenCalledTimes(1);
    const [, threadId, turnId, body] = vi.mocked(resolveTurnApproval).mock
      .calls[0] as unknown as [
      unknown,
      string,
      string,
      { approvals: unknown[] },
    ];
    expect(threadId).toBe("thread-1");
    expect(turnId).toBe("turn-dispatching");
    expect(body.approvals).toEqual([
      { interrupt_id: COWORKER_INTERRUPT_ID, approved: true },
    ]);
    expect(
      store.approvals.get().find((c) => c.interruptId === COWORKER_INTERRUPT_ID)
        ?.status,
    ).toEqual({ kind: "answered", approved: true, trusted: false });
  });

  it("posts the trust token to the dispatching turn's door when the coworker's card advertised it", async () => {
    const { store, card } = await storeWithCoworkerCard([
      coworkerApprovalOf(COWORKER_INTERRUPT_ID, {
        gated: false,
        trust_available: true,
      }),
    ]);
    expect(card.trustAvailable).toBe(true);
    vi.mocked(resolveTurnApproval).mockResolvedValue({
      delivery: "signaled",
    } as Awaited<ReturnType<typeof resolveTurnApproval>>);

    await store.submitApprovalDecision(card, { approved: true, trust: true });

    const [, , turnId, body] = vi.mocked(resolveTurnApproval).mock
      .calls[0] as unknown as [
      unknown,
      string,
      string,
      { approvals: unknown[] },
    ];
    expect(turnId).toBe("turn-dispatching");
    expect(body.approvals).toEqual([
      { interrupt_id: COWORKER_INTERRUPT_ID, approved: true, trust: true },
    ]);
    expect(
      store.approvals.get().find((c) => c.interruptId === COWORKER_INTERRUPT_ID)
        ?.status,
    ).toEqual({ kind: "answered", approved: true, trusted: true });
  });

  it("a 409 stales that card alone — the turn's own pause is untouched — and re-reads the thread", async () => {
    const { store, card } = await storeWithCoworkerCard();
    vi.mocked(getAssistantThread).mockClear();
    vi.mocked(resolveTurnApproval).mockRejectedValue(
      new ServingApiError({
        code: "ASSISTANT_TURN_NOT_AWAITING_APPROVAL",
        status: 409,
        message: "This message isn't waiting for an approval.",
        retryAfterSeconds: null,
      }),
    );
    // The turn's own card, held beside the coworker's.
    const inbox = (
      store as unknown as {
        _active: {
          approvalInbox: import("../src/core/approval-inbox").ApprovalInbox;
        };
      }
    )._active.approvalInbox;
    inbox.noteRunStarted("run-newest");
    inbox.noteApprovalRequested({
      interrupt_id: "v1:before_tool_call:own:hitl",
      tool_name: "docs_search",
      tool_args: {},
      tool_input_schema: null,
      tool_output_schema: null,
      prompt: "Search?",
      tool_call_id: null,
      round: 0,
      gated: false,
      trust_available: false,
    });

    await store.submitApprovalDecision(card, { approved: false });

    expect(inbox.statusOf(COWORKER_INTERRUPT_ID)).toBe("stale");
    expect(inbox.statusOf("v1:before_tool_call:own:hitl")).toBe("actionable");
    await vi.waitFor(() => {
      expect(getAssistantThread).toHaveBeenCalledTimes(1);
    });
  });

  it("a refresh that no longer lists the card drops it — the coworker's row left paused", async () => {
    const { store } = await storeWithCoworkerCard();
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), windowOf([])),
    );

    await store.refreshConversation();

    expect(
      store.approvals
        .get()
        .some((c) => c.interruptId === COWORKER_INTERRUPT_ID),
    ).toBe(false);
  });

  it("the member's send stales every coworker card at once", async () => {
    const { store } = await storeWithCoworkerCard();
    vi.mocked(sendAssistantMessage).mockResolvedValue({
      thread: threadOf({ busy: true }),
      turn: turnOf({ id: "t2", status: "queued" }),
    });

    await store.sendMessage("never mind");

    expect(
      store.approvals.get().find((c) => c.interruptId === COWORKER_INTERRUPT_ID)
        ?.status,
    ).toEqual({ kind: "stale" });
  });
});

// --- the work cell never folds a departed conversation's entries ----------------------

function coworkerExecutionOf(ordinal: number) {
  const slot = String(ordinal);
  return {
    ordinal,
    label: "Refund order 41.",
    child_session_id: `subagent-thread-${slot}`,
    round: 0,
    expires_at: "2026-09-16T00:05:00Z",
    parked: false,
    card: {
      interrupt_id: `v1:tool_call:cw-${slot}`,
      tool_name: "action__refund",
      tool_call_id: `cw-run-a1-t${slot}`,
      round: 0,
      request: { kind: "http_intent", intent: { method: "POST" } },
    },
  };
}

/** Every snapshot the work cell publishes from now on, in order. */
function recordWorkPublishes(store: ReturnType<typeof aStore>) {
  const published: ReadonlyMap<number, { via: string }>[] = [];
  store.coworkerWork.subscribe(() => {
    published.push(store.coworkerWork.get());
  });
  return published;
}

describe("the work cell folds only the live conversation's entries with its cards", () => {
  it("a thread switch: no publish — the departing adoption's or the fresh epoch's first — names the previous thread's browser work", async () => {
    // Thread 1: a coworker (ordinal 2) whose action the browser runs.
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [
        turnOf({
          id: "turn-dispatching-1",
          status: "succeeded",
          run_id: "run-dispatching-1",
          pending_coworker_executions: [coworkerExecutionOf(2)],
        }),
      ]),
    );
    const store = aStore();
    store.bootstrap();
    await settled();
    expect(store.coworkerWork.get().get(2)?.via).toBe("browser");

    // Thread 2: a different coworker (ordinal 3) awaiting the member's
    // approval. The switch adopts thread 2's window into the still-live
    // epoch, then mints a fresh one.
    const other = threadOf({ id: "thread-2", stream_thread_id: "stream-2" });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(other, [
        turnOf({
          id: "turn-dispatching-2",
          thread_id: "thread-2",
          status: "succeeded",
          run_id: "run-dispatching-2",
          pending_coworker_approvals: [coworkerApprovalOf()],
        }),
      ]),
    );
    const published = recordWorkPublishes(store);
    store.openThread(other);
    await settled();
    await settled();

    expect(store._active?.thread.id).toBe("thread-2");
    expect(published.length).toBeGreaterThan(0);
    for (const snapshot of published) {
      expect(snapshot.has(2), "the departed thread's browser work leaked").toBe(
        false,
      );
    }
    expect([...store.coworkerWork.get().entries()]).toEqual([
      [3, expect.objectContaining({ via: "approval" })],
    ]);
  });

  it("a new conversation opened by a send: the fresh epoch's first publish folds nothing of the abandoned thread", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [
        turnOf({
          id: "turn-dispatching-1",
          status: "succeeded",
          run_id: "run-dispatching-1",
          pending_coworker_executions: [coworkerExecutionOf(2)],
        }),
      ]),
    );
    const store = aStore();
    store.bootstrap();
    await settled();
    expect(store.coworkerWork.get().get(2)?.via).toBe("browser");

    const published = recordWorkPublishes(store);
    store.startNewConversation();
    vi.mocked(sendAssistantMessage).mockResolvedValue({
      thread: threadOf({
        id: "thread-3",
        stream_thread_id: "stream-3",
        busy: true,
      }),
      turn: turnOf({ id: "turn-new", thread_id: "thread-3", status: "queued" }),
    });
    await store.sendMessage("Start over.");
    await settled();

    expect(store._active?.thread.id).toBe("thread-3");
    for (const snapshot of published) {
      expect(
        snapshot.has(2),
        "the abandoned thread's browser work leaked",
      ).toBe(false);
    }
    expect(store.coworkerWork.get().size).toBe(0);
  });
});
