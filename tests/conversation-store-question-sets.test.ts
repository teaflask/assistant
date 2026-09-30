// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { publishExecutionEntries } from "../src/core/epoch-sync";
import type { ExecutionInbox } from "../src/core/execution-inbox";
import { writeStoredThread } from "../src/persistence/stored-thread";
import {
  getAssistantThread,
  resolveTurnToolResults,
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

describe("answering question sets", () => {
  beforeEach(() => {
    // Exact POST counts below — start each case from zero.
    vi.mocked(resolveTurnToolResults).mockClear();
  });

  const SET_INTERRUPT_ID = "v1:tool_call:q1:member-answers";
  const THREE_QUESTIONS_ACTION = {
    questions: [
      {
        id: "fruit",
        heading: "Favorite fruit",
        prompt: "What's your favorite fruit?",
        options: [{ text: "Mango" }, { text: "Apple" }],
      },
      {
        id: "color",
        heading: "Favorite color",
        prompt: "What's your favorite color?",
        options: [{ text: "Blue" }],
      },
      { id: "drink", heading: "Favorite drink", prompt: "Drink?", options: [] },
    ],
  };
  const ANSWERS = [
    { id: "fruit", text: "Mango" },
    { id: "color", text: "Something between blue and green" },
    { id: "drink", text: "Tea —\nthe green kind" },
  ];

  async function storeWithAPendingQuestionSet() {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [turnOf({ id: "t1", run_id: "run-1" })]),
    );
    const store = aStore();
    store.bootstrap();
    await settled();
    const inbox = (
      store as unknown as { _epoch: { executionInbox: ExecutionInbox } }
    )._epoch.executionInbox;
    inbox.noteRunStarted("run-1");
    inbox.noteExecutionRequested({
      interrupt_id: SET_INTERRUPT_ID,
      tool_name: "ask_user",
      tool_call_id: "run-1-q1",
      round: 0,
      request: {
        kind: "builtin.ask_questions",
        action: THREE_QUESTIONS_ACTION,
      },
    });
    const publish = (entries: ReturnType<ExecutionInbox["entries"]>) => {
      publishExecutionEntries(store, entries);
    };
    publish(inbox.entries());
    const [card] = store.elicitations.get();
    return { store, inbox, card, publish };
  }

  it("a lost-capture set behind a QUEUED newer message answers the PAUSE, not the queued row", async () => {
    // The lost-capture class on the question-set path: the ledger cannot
    // name the pausing run (lost capture), and the newest row can be a
    // QUEUED member turn — the retired ledger.newestTurn()-only fallback
    // would target it and 409. turnIdAnsweredBy's refreshed resolution
    // must consult the ANSWERABLE pause first.
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    const pause = turnOf({
      id: "t-pause",
      status: "awaiting_input",
      run_id: null, // the lost capture: the status gate alone holds
      awaiting_round: null,
      pending_approvals: [],
    });
    const queuedNewer = turnOf({
      id: "t-queued",
      status: "queued",
      run_id: null,
      awaiting_round: null,
      pending_approvals: [],
      user_message: "a follow-up sent during the pause",
      // Strictly newer than the pause (review round 4): with equal stamps
      // the ledger's plain newest-turn fallback could hand back the pause
      // by accident, and this case would pass without the branch it pins.
      created_at: "2026-07-29T00:05:00Z",
      updated_at: "2026-07-29T00:05:00Z",
    });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [pause, queuedNewer]),
    );
    const store = aStore();
    store.bootstrap();
    await settled();
    const inbox = (
      store as unknown as { _epoch: { executionInbox: ExecutionInbox } }
    )._epoch.executionInbox;
    inbox.noteRunStarted("run-never-captured");
    inbox.noteExecutionRequested({
      interrupt_id: SET_INTERRUPT_ID,
      tool_name: "ask_user",
      tool_call_id: "run-nc-q1",
      round: 0,
      request: {
        kind: "builtin.ask_questions",
        action: THREE_QUESTIONS_ACTION,
      },
    });
    publishExecutionEntries(store, inbox.entries());
    const [card] = store.elicitations.get();
    vi.mocked(resolveTurnToolResults).mockResolvedValue({
      delivery: "signaled",
      turn: pause,
      notice: null,
    });

    await store.submitQuestionAnswers(card, ANSWERS);

    expect(resolveTurnToolResults).toHaveBeenCalledWith(
      SESSION,
      "thread-1",
      "t-pause",
      {
        results: [
          {
            interrupt_id: SET_INTERRUPT_ID,
            ok: true,
            result: { answers: ANSWERS },
          },
        ],
      },
    );
  });

  it("submits every answer of the set in ONE POST, stamps the receipt and releases the draft", async () => {
    const { store, inbox, card } = await storeWithAPendingQuestionSet();
    store.questionDrafts.selectOption(SET_INTERRUPT_ID, "fruit", "Mango");
    vi.mocked(resolveTurnToolResults).mockResolvedValue({
      delivery: "signaled",
      turn: turnOf({ id: "t1" }),
      notice: null,
    });

    await store.submitQuestionAnswers(card, ANSWERS);

    expect(resolveTurnToolResults).toHaveBeenCalledTimes(1);
    expect(resolveTurnToolResults).toHaveBeenCalledWith(
      SESSION,
      "thread-1",
      "t1",
      {
        results: [
          {
            interrupt_id: SET_INTERRUPT_ID,
            ok: true,
            result: { answers: ANSWERS },
          },
        ],
      },
    );
    expect(inbox.entries()[0].status).toEqual({ kind: "reported", ok: true });
    const [answered] = store.elicitations.get();
    expect(answered.status).toBe("answered");
    expect(answered.answered).toEqual({
      kind: "answers",
      answers: ANSWERS,
    });
    expect(store.questionDrafts.hasContent(SET_INTERRUPT_ID)).toBe(false);
  });

  it("cancels the whole set as a distinct outcome — no partial answers ride along", async () => {
    const { store, card } = await storeWithAPendingQuestionSet();
    store.questionDrafts.selectOption(SET_INTERRUPT_ID, "fruit", "Mango");
    vi.mocked(resolveTurnToolResults).mockResolvedValue({
      delivery: "signaled",
      turn: turnOf({ id: "t1" }),
      notice: null,
    });

    await store.cancelQuestionSet(card);

    expect(resolveTurnToolResults).toHaveBeenCalledWith(
      SESSION,
      "thread-1",
      "t1",
      {
        results: [
          {
            interrupt_id: SET_INTERRUPT_ID,
            ok: true,
            result: { cancelled: true },
          },
        ],
      },
    );
    const [cancelled] = store.elicitations.get();
    expect(cancelled.status).toBe("answered");
    expect(cancelled.answered).toEqual({
      kind: "cancelled",
    });
    expect(store.questionDrafts.hasContent(SET_INTERRUPT_ID)).toBe(false);
  });

  it("a failed POST returns the set to actionable with a sentence and KEEPS the staged answers", async () => {
    const { store, card } = await storeWithAPendingQuestionSet();
    store.questionDrafts.selectOption(SET_INTERRUPT_ID, "fruit", "Mango");
    store.questionDrafts.setCustomText(
      SET_INTERRUPT_ID,
      "drink",
      "Tea —\nthe green kind",
    );
    vi.mocked(resolveTurnToolResults).mockRejectedValue(
      new Error("network down"),
    );

    await store.submitQuestionAnswers(card, ANSWERS);

    const [failed] = store.elicitations.get();
    expect(failed.status).toBe("actionable");
    expect(failed.errorSentence).not.toBeNull();
    expect(
      store.questionDrafts.get(SET_INTERRUPT_ID).answers.get("drink"),
    ).toEqual({
      active: { kind: "custom" },
      customText: "Tea —\nthe green kind",
    });
    expect(
      store.questionDrafts.get(SET_INTERRUPT_ID).answers.get("fruit")?.active,
    ).toEqual({ kind: "option", text: "Mango" });
  });

  it("a door refusal (422) shows the door's own sentence, never the composer's 'shorten it' copy", async () => {
    // Review round 2: the composer's VALIDATION_ERROR copy is about the
    // message field; a member who pasted a control character cannot act
    // on "shorten". The door's sentence names the rule, so it is shown.
    const { store, card } = await storeWithAPendingQuestionSet();
    const doorSentence =
      "An answer contains control characters other than tab and newline — paste it as plain text. Nothing was recorded.";
    vi.mocked(resolveTurnToolResults).mockRejectedValue(
      new ServingApiError({
        code: "VALIDATION_ERROR",
        message: doorSentence,
        status: 422,
        retryAfterSeconds: null,
      }),
    );

    await store.submitQuestionAnswers(card, ANSWERS);

    const [failed] = store.elicitations.get();
    expect(failed.status).toBe("actionable");
    expect(failed.errorSentence).toBe(doorSentence);
    expect(failed.errorSentence).not.toContain("Shorten it");
  });

  it("a 409 (answered elsewhere) stales the set and drops its draft while REST still says the turn is answerable", async () => {
    const { store, card } = await storeWithAPendingQuestionSet();
    store.questionDrafts.selectOption(SET_INTERRUPT_ID, "fruit", "Mango");
    // The refresh the 409 triggers reads a turn still awaiting: the set is
    // over for this tab, so the card goes stale rather than away.
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [
        turnOf({ id: "t1", run_id: "run-1", status: "awaiting_input" }),
      ]),
    );
    vi.mocked(resolveTurnToolResults).mockRejectedValue(
      new ServingApiError({
        code: "ASSISTANT_TURN_NOT_AWAITING_TOOL_RESULTS",
        message: "not awaiting",
        status: 409,
        retryAfterSeconds: null,
      }),
    );

    await store.submitQuestionAnswers(card, ANSWERS);
    await settled();

    expect(store.elicitations.get()[0].status).toBe("stale");
    expect(store.questionDrafts.hasContent(SET_INTERRUPT_ID)).toBe(false);
  });

  it("a 409 whose refresh reads the turn SETTLED removes the set — the ledger's word — and its draft is gone too", async () => {
    const { store, card } = await storeWithAPendingQuestionSet();
    store.questionDrafts.selectOption(SET_INTERRUPT_ID, "fruit", "Mango");
    // The fixture's refresh turn reads succeeded (the harness default): the
    // durable record says the run can hold no ask, so the card is gone.
    vi.mocked(resolveTurnToolResults).mockRejectedValue(
      new ServingApiError({
        code: "ASSISTANT_TURN_NOT_AWAITING_TOOL_RESULTS",
        message: "not awaiting",
        status: 409,
        retryAfterSeconds: null,
      }),
    );

    await store.submitQuestionAnswers(card, ANSWERS);
    await settled();

    expect(store.elicitations.get()).toEqual([]);
    expect(store.questionDrafts.hasContent(SET_INTERRUPT_ID)).toBe(false);
  });

  it("an answer that restarted a parked turn reconnects — the workflow_restarted arm", async () => {
    const { store, card } = await storeWithAPendingQuestionSet();
    const restarted = vi
      .spyOn(store, "handleWorkflowRestarted")
      .mockImplementation(() => undefined);
    vi.mocked(resolveTurnToolResults).mockResolvedValue({
      delivery: "workflow_restarted",
      turn: turnOf({ id: "t1" }),
      notice: null,
    });

    await store.submitQuestionAnswers(card, ANSWERS);

    expect(restarted).toHaveBeenCalledTimes(1);
  });

  it("an oversize-dropped restart still reconnects — delivery alone decides", async () => {
    // The one path where a notice accompanies a DELIVERED result: the
    // door dropped an oversize payload while restarting a parked turn's
    // workflow. The reconnect must fire anyway, or the transcript sits
    // frozen on the dead run. Goes red if the reconnect ever keys on the
    // notice being null.
    const { store, card } = await storeWithAPendingQuestionSet();
    const restarted = vi
      .spyOn(store, "handleWorkflowRestarted")
      .mockImplementation(() => undefined);
    vi.mocked(resolveTurnToolResults).mockResolvedValue({
      delivery: "workflow_restarted",
      turn: turnOf({ id: "t1" }),
      notice: "A reported result exceeded the cap and was dropped.",
    });

    await store.submitQuestionAnswers(card, ANSWERS);

    expect(restarted).toHaveBeenCalledTimes(1);
  });

  it("an unrelated execution publish never moves the elicitations cell", async () => {
    // Entries publish for every execution kind's lifecycle; an unchanged
    // derivation (here: still just the one pending set) must keep the
    // cell's snapshot identity, or every navigate/read_page transition
    // re-renders every elicitation subscriber. Goes red if
    // publishExecutionEntries stops consulting sameElicitationCards.
    const { store, inbox, publish } = await storeWithAPendingQuestionSet();
    const before = store.elicitations.get();

    inbox.noteExecutionRequested({
      interrupt_id: "v1:tool_call:t9:client-result",
      tool_name: "navigate",
      tool_call_id: "run-1-t9",
      round: 0,
      request: { kind: "builtin.navigate", action: { path: "/settings" } },
    });
    publish(inbox.entries());

    expect(store.elicitations.get()).toBe(before);
  });

  it("drafts survive an absent publish (the reconnect's empty list) and clear only on present-and-settled evidence", async () => {
    const { store, inbox, card, publish } =
      await storeWithAPendingQuestionSet();
    store.questionDrafts.selectOption(SET_INTERRUPT_ID, "fruit", "Mango");
    // The reconnect publishes [] before the replay refills the inbox —
    // absence is not evidence, so the draft stays (the negative control
    // for a store that cleared on "no card").
    publish([]);
    expect(store.questionDrafts.hasContent(SET_INTERRUPT_ID)).toBe(true);
    // A replayed receipt settles the set from another client: present
    // AND settled — now the draft goes.
    inbox.noteToolResultRecorded(card.interruptId, true);
    publish(inbox.entries());
    expect(store.elicitations.get()[0].status).toBe("answered");
    expect(store.questionDrafts.hasContent(SET_INTERRUPT_ID)).toBe(false);
  });

  it("a thread switch drops every staged answer", async () => {
    const { store } = await storeWithAPendingQuestionSet();
    store.questionDrafts.selectOption(SET_INTERRUPT_ID, "fruit", "Mango");
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf({ id: "thread-2", stream_thread_id: "stream-2" })),
    );
    store.openThread(
      threadOf({ id: "thread-2", stream_thread_id: "stream-2" }),
    );
    await settled();
    expect(store.questionDrafts.hasContent(SET_INTERRUPT_ID)).toBe(false);
  });
});
