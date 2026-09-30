// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ServingAssistantTurn } from "../src/contract/threads";
import type { ApprovalInbox } from "../src/core/approval-inbox";
import type {
  AssistantConversationStore,
  ConversationStoreDeps,
} from "../src/core/conversation-store";
import { writeStoredThread } from "../src/persistence/stored-thread";
import {
  getAssistantThread,
  resolveTurnApproval,
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
  SESSION,
  settled,
  threadOf,
  turnOf,
} from "./conversation-store-harness";

installConversationStoreLifecycle();

describe("the durable turn record governs the approval path", () => {
  const INTERRUPT = "v1:before_tool_call:t1:handler";

  beforeEach(() => {
    // The file-level beforeEach leaves this mock's calls standing; these
    // tests assert exact POST counts, so they start from zero.
    vi.mocked(resolveTurnApproval).mockReset();
  });

  function approvalPayload(interruptId = INTERRUPT) {
    return {
      interrupt_id: interruptId,
      tool_name: "delete_doc",
      tool_args: { doc_id: "doc-1" },
      tool_input_schema: null,
      tool_output_schema: null,
      prompt: "Delete a doc?",
      tool_call_id: "run-1-a1-t1",
      round: 0,
      gated: false,
      trust_available: false,
    };
  }

  function awaitingTurn(overrides: Partial<ServingAssistantTurn> = {}) {
    return turnOf({
      id: "t1",
      status: "awaiting_input",
      run_id: "run-1",
      pending_interrupt_ids: [INTERRUPT],
      awaiting_round: 0,
      ...overrides,
    });
  }

  function activeInboxOf(store: AssistantConversationStore): ApprovalInbox {
    return (store as unknown as { _active: { approvalInbox: ApprovalInbox } })
      ._active.approvalInbox;
  }

  async function storeWithPendingCard(
    turn: ServingAssistantTurn,
    deps: Partial<ConversationStoreDeps> = {},
  ) {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [turn]),
    );
    const store = aStore(deps);
    store.bootstrap();
    await settled();
    const inbox = activeInboxOf(store);
    inbox.noteRunStarted(turn.run_id ?? "run-1");
    inbox.noteApprovalRequested(approvalPayload());
    return { store, inbox, card: inbox.cards()[0] };
  }

  function telemetryEventsOf(onTelemetry: ReturnType<typeof vi.fn>) {
    return onTelemetry.mock.calls.map(
      ([event]) =>
        event as import("../src/contract/telemetry").AssistantTelemetryEvent,
    );
  }

  it("keeps an actionable card continuously published across a forced retryStream", async () => {
    const { store } = await storeWithPendingCard(awaitingTurn());

    const published: (readonly unknown[])[] = [];
    store.approvals.subscribe(() => {
      published.push(store.approvals.get());
    });

    store.retryStream();
    await settled();

    // The swap must SEED the carried cards, never flash an empty list
    // while the turn still holds the interrupt.
    expect(published.length).toBeGreaterThan(0);
    for (const snapshot of published) {
      expect(snapshot).not.toEqual([]);
    }
    expect(store.approvals.get()).toEqual([
      expect.objectContaining({
        interruptId: INTERRUPT,
        status: { kind: "actionable", errorSentence: null },
      }),
    ]);
  });

  it("a double-click produces exactly one POST, a visible submitting card, and a telemetered drop", async () => {
    const onTelemetry = vi.fn();
    const { store, card } = await storeWithPendingCard(awaitingTurn(), {
      onTelemetry,
    });
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

    const first = store.submitApprovalDecision(card, { approved: true });
    const second = store.submitApprovalDecision(card, { approved: true });
    await settled();

    expect(resolveTurnApproval).toHaveBeenCalledTimes(1);
    expect(store.approvals.get()[0]?.status).toEqual({ kind: "submitting" });

    releaseResolve();
    await Promise.all([first, second]);
    expect(store.approvals.get()[0]?.status).toEqual({
      kind: "answered",
      approved: true,
      trusted: false,
    });

    const events = telemetryEventsOf(onTelemetry);
    expect(
      events.filter((event) => event.name === "approval_submit_attempted"),
    ).toHaveLength(2);
    expect(
      events.filter((event) => event.name === "approval_submit_sent"),
    ).toHaveLength(1);
    expect(
      events.flatMap((event) =>
        event.name === "approval_submit_dropped"
          ? [event.properties.drop_reason]
          : [],
      ),
    ).toEqual(["already_submitting"]);
  });

  it("answers a parked card from the durable turn even when the ledger never saw its run, then reconnects after the reclaim", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    const parkedTurn = awaitingTurn({ status: "parked", run_id: "run-real" });
    vi.mocked(getAssistantThread)
      .mockResolvedValueOnce(detailOf(threadOf(), [parkedTurn]))
      // The restart-reclaim probes read the turn moving off parked.
      .mockResolvedValue(
        detailOf(threadOf({ busy: true }), [
          awaitingTurn({ status: "working", pending_interrupt_ids: [] }),
        ]),
      );
    const store = aStore();
    store.bootstrap();
    await settled();
    const inbox = activeInboxOf(store);
    // The card's stamped run id names a run the ledger cannot resolve —
    // the park-restart shape; only the durable record can name the turn.
    inbox.noteRunStarted("run-the-ledger-never-saw");
    inbox.noteApprovalRequested(approvalPayload());
    const card = inbox.cards()[0];
    vi.mocked(resolveTurnApproval).mockResolvedValue({
      delivery: "workflow_restarted",
    } as Awaited<ReturnType<typeof resolveTurnApproval>>);
    const nonceBefore = store.conversation.get().reconnectNonce;

    await store.submitApprovalDecision(card, { approved: true });

    expect(resolveTurnApproval).toHaveBeenCalledWith(
      SESSION,
      "thread-1",
      "t1",
      { approvals: [{ interrupt_id: INTERRUPT, approved: true }] },
    );
    expect(store.approvals.get()[0]?.status).toEqual({
      kind: "answered",
      approved: true,
      trusted: false,
    });
    // The restart reclaim: probes see the turn moving, then reconnect.
    await vi.waitFor(
      () => {
        expect(store.conversation.get().reconnectNonce).toBeGreaterThan(
          nonceBefore,
        );
      },
      { timeout: 3000 },
    );
  });

  it("an already_consumed receipt re-reads the turn instead of reconnecting", async () => {
    // The receipt's shape: a resume consumed the answer, then the
    // workflow died parked. Nothing was restarted, so no reconnect will
    // ever arrive to move the conversation past this pause — the store
    // re-reads the thread, and the refreshed projection (consumed ids
    // subtracted) retires the pause instead of rendering a wait nothing
    // will resume.
    const { store, card } = await storeWithPendingCard(
      awaitingTurn({ status: "parked" }),
    );
    const restarted = vi.fn();
    store.handleWorkflowRestarted = restarted;
    vi.mocked(getAssistantThread).mockClear();
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [
        awaitingTurn({
          status: "parked",
          pending_interrupt_ids: [],
          awaiting_round: null,
        }),
      ]),
    );
    vi.mocked(resolveTurnApproval).mockResolvedValue({
      delivery: "already_consumed",
    } as Awaited<ReturnType<typeof resolveTurnApproval>>);

    await store.submitApprovalDecision(card, { approved: true });

    expect(store.approvals.get()[0]?.status).toEqual({
      kind: "answered",
      approved: true,
      trusted: false,
    });
    expect(restarted).not.toHaveBeenCalled();
    // The re-read is the receipt's one follow-up: exactly one refresh,
    // no reclaim probes.
    await vi.waitFor(() => {
      expect(getAssistantThread).toHaveBeenCalledTimes(1);
    });
  });

  it("a landed send withdraws the prior pause: the carried card goes visibly stale at once", async () => {
    const { store } = await storeWithPendingCard(
      awaitingTurn({ status: "parked" }),
    );
    vi.mocked(sendAssistantMessage).mockResolvedValue({
      thread: threadOf({ busy: true }),
      turn: turnOf({ id: "t2", status: "queued" }),
    });

    await store.sendMessage("never mind — do this instead");

    // The card promised "sending a new message will withdraw this
    // request": it must not keep live buttons for even a connect
    // round-trip (the voided turn's settled word, on the next REST read,
    // is the later removal — no RUN_FINISHED removes anything).
    expect(store.approvals.get()).toEqual([
      expect.objectContaining({
        interruptId: INTERRUPT,
        status: { kind: "stale" },
      }),
    ]);
  });

  it("a thread switch during the submit's refresh cannot leak the other thread's turn id into the POST", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    // A real pause: a marker under a SETTLED turn's run opens no card
    // (the settled-runs memory), so the fixture pauses.
    const threadOneDetail = detailOf(threadOf(), [awaitingTurn()]);
    const threadTwo = threadOf({
      id: "thread-2",
      stream_thread_id: "stream-2",
    });
    const threadTwoDetail = detailOf(threadTwo, [
      turnOf({
        id: "t2",
        thread_id: "thread-2",
        run_id: "run-2",
        status: "succeeded",
      }),
    ]);
    let releaseRefresh: () => void = () => undefined;
    let threadOneReads = 0;
    vi.mocked(getAssistantThread).mockImplementation((_session, threadId) => {
      if (threadId === "thread-2") {
        return Promise.resolve(threadTwoDetail);
      }
      threadOneReads += 1;
      if (threadOneReads === 1) {
        // The bootstrap adoption.
        return Promise.resolve(threadOneDetail);
      }
      // The submit's refresh — held until the visitor has switched away.
      return new Promise((resolve) => {
        releaseRefresh = () => {
          resolve(threadOneDetail);
        };
      });
    });
    const store = aStore();
    store.bootstrap();
    await settled();
    const inbox = activeInboxOf(store);
    inbox.noteRunStarted("run-1");
    inbox.noteApprovalRequested(approvalPayload());
    const card = inbox.cards()[0];
    vi.mocked(resolveTurnApproval).mockResolvedValue({
      delivery: "signaled",
    } as Awaited<ReturnType<typeof resolveTurnApproval>>);

    const submitting = store.submitApprovalDecision(card, { approved: true });
    await settled();
    store.openThread(threadTwo);
    await settled();
    releaseRefresh();
    await submitting;

    // The captured conversation resolves its OWN turn — a store-global
    // read after the await would have named thread-2's newest turn and
    // posted it to thread-1's approval URL.
    expect(resolveTurnApproval).toHaveBeenCalledWith(
      SESSION,
      "thread-1",
      "t1",
      { approvals: [{ interrupt_id: INTERRUPT, approved: true }] },
    );
    // And the resolved old inbox never stamps thread-2's cell.
    expect(store.approvals.get()).toEqual([]);
  });

  it("a lost run capture (null run_id) still resolves the turn durable-first — no refresh round-trip, no ledger guess", async () => {
    // The contract hides the cards on a lost capture: the set reads
    // empty though the pause is real, so the status gate alone holds
    // (the execution driver's tolerance) and the door's 409 backstops.
    const { store, card } = await storeWithPendingCard(
      awaitingTurn({
        status: "parked",
        run_id: null,
        pending_interrupt_ids: [],
        awaiting_round: null,
      }),
    );
    vi.mocked(resolveTurnApproval).mockResolvedValue({
      delivery: "signaled",
    } as Awaited<ReturnType<typeof resolveTurnApproval>>);
    const threadReadsBefore = vi.mocked(getAssistantThread).mock.calls.length;

    await store.submitApprovalDecision(card, { approved: true });

    expect(resolveTurnApproval).toHaveBeenCalledWith(
      SESSION,
      "thread-1",
      "t1",
      { approvals: [{ interrupt_id: INTERRUPT, approved: true }] },
    );
    expect(vi.mocked(getAssistantThread).mock.calls.length).toBe(
      threadReadsBefore,
    );
  });

  it("a refresh whose window settles the card's turn behind a live successor removes the card — the settled turns' word rides the package host's read", async () => {
    const { store, inbox } = await storeWithPendingCard(awaitingTurn());
    expect(inbox.cards()).toHaveLength(1);

    // The newest row is a WORKING successor: the newest-row judgement
    // alone cannot close the card; the window's settled turn does.
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [
        awaitingTurn({ status: "superseded", pending_interrupt_ids: [] }),
        turnOf({ id: "t2", run_id: "run-2", status: "working" }),
      ]),
    );
    await store.refreshConversation();
    expect(inbox.cards()).toEqual([]);
    expect(store.approvals.get()).toEqual([]);
  });

  it("reconciles the card list from pending_interrupt_ids on every refresh", async () => {
    const { store } = await storeWithPendingCard(awaitingTurn());

    // The turn parks: the card renders the parked notice.
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [awaitingTurn({ status: "parked" })]),
    );
    await store.refreshConversation();
    expect(store.approvals.get()[0]).toMatchObject({
      parked: true,
      status: { kind: "actionable", errorSentence: null },
    });

    // The restarted workflow reclaims it: the parked notice clears.
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [awaitingTurn()]),
    );
    await store.refreshConversation();
    expect(store.approvals.get()[0]?.parked).toBe(false);

    // The pause moves on without this interrupt: visibly stale, no vanish.
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [
        awaitingTurn({ pending_interrupt_ids: ["someone-else"] }),
      ]),
    );
    await store.refreshConversation();
    expect(store.approvals.get()[0]?.status).toEqual({ kind: "stale" });
  });

  it("a parked turn is never busy: composer unlocked, Stop hidden, no interruption banner", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    // A stale thread.busy must not outvote the parked turn record.
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf({ busy: true }), [awaitingTurn({ status: "parked" })]),
    );
    const store = aStore();
    store.bootstrap();
    await settled();

    expect(store.composer.get().busy).toBe(false);
    store.handleStreamError(new Error("the wire died"));
    expect(store.conversation.get().showInterruptionBanner).toBe(false);
  });

  it("drops with no_turn_id visibly: the card returns to actionable with the retry sentence", async () => {
    const onTelemetry = vi.fn();
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    // A thread with no turns at all: nothing can name the POST's target.
    vi.mocked(getAssistantThread).mockResolvedValue(detailOf(threadOf(), []));
    const store = aStore({ onTelemetry });
    store.bootstrap();
    await settled();
    const inbox = activeInboxOf(store);
    inbox.noteRunStarted("run-1");
    inbox.noteApprovalRequested(approvalPayload());
    const card = inbox.cards()[0];

    await store.submitApprovalDecision(card, { approved: true });

    expect(resolveTurnApproval).not.toHaveBeenCalled();
    expect(store.approvals.get()[0]?.status).toEqual({
      kind: "actionable",
      errorSentence: "That answer couldn't be sent. Please try again.",
    });
    expect(
      telemetryEventsOf(onTelemetry).flatMap((event) =>
        event.name === "approval_submit_dropped"
          ? [event.properties.drop_reason]
          : [],
      ),
    ).toEqual(["no_turn_id"]);
  });

  it("drops with no_active_thread loudly when no conversation exists", async () => {
    const onTelemetry = vi.fn();
    const reportError = vi.fn();
    const store = aStore({ onTelemetry, reportError });
    const card = {
      interruptId: INTERRUPT,
      toolName: null,
      toolArgs: {},
      toolInputSchema: null,
      toolOutputSchema: null,
      prompt: "Delete a doc?",
      toolCallId: null,
      anchored: false,
      round: 0,
      runId: "run-1",
      parked: false,
      gated: false,
      trustAvailable: false,
      asker: { kind: "assistant" as const },
      turnId: null,
      status: { kind: "actionable" as const, errorSentence: null },
    };

    await store.submitApprovalDecision(card, { approved: true });

    expect(resolveTurnApproval).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledTimes(1);
    const events = telemetryEventsOf(onTelemetry);
    expect(events.map((event) => event.name)).toEqual([
      "approval_submit_attempted",
      "approval_submit_dropped",
    ]);
    const second = events[1];
    expect(
      second.name === "approval_submit_dropped"
        ? second.properties.drop_reason
        : null,
    ).toBe("no_active_thread");
  });
});
