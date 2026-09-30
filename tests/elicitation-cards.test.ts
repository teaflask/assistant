import { describe, expect, it } from "vitest";

import {
  elicitationCardsOf,
  sameElicitationCards,
} from "../src/core/elicitation-cards";
import {
  ASK_QUESTIONS_REQUEST_KIND,
  MEMBER_ANSWERABLE_KINDS,
} from "../src/core/execution-handlers";
import type {
  ExecutionEntryModel,
  ExecutionEntryStatus,
} from "../src/core/execution-inbox";

const NO_ERRORS: ReadonlyMap<string, string> = new Map();

const ONE_QUESTION_ACTION = {
  questions: [
    {
      id: "plan",
      heading: "Plan",
      prompt: "Proceed by email?",
      options: [{ text: "Yes" }, { text: "No" }],
    },
  ],
};

function askEntry(
  overrides: Partial<ExecutionEntryModel> = {},
): ExecutionEntryModel {
  return {
    interruptId: "v1:tool_call:a1:member-answers",
    toolName: "ask_user",
    toolCallId: "run-1-a1",
    anchored: true,
    kind: ASK_QUESTIONS_REQUEST_KIND,
    action: ONE_QUESTION_ACTION,
    intent: null,
    round: 0,
    runId: "run-1",
    status: { kind: "pending" },
    asker: { kind: "assistant" },
    turnId: null,
    ...overrides,
  };
}

describe("elicitationCardsOf", () => {
  it("cards the question-set entries and skips every other kind — a stored record of the retired one-question kind included", () => {
    const navigate = askEntry({
      interruptId: "v1:tool_call:t1:client-result",
      kind: "builtin.navigate",
      action: { path: "/settings" },
    });
    // The retired kind: it left MEMBER_ANSWERABLE_KINDS with its card, so
    // a record of it that a stored pause still carries mints nothing here
    // — the execution driver answers it kind_unsupported instead
    // (execution-driver.test.ts), never an invisible wait.
    const retired = askEntry({
      interruptId: "v1:tool_call:a0:member-answer-0",
      toolCallId: "run-1-a0",
      kind: "builtin.ask_user",
      action: { schema: { kind: "boolean" }, prompt: "Proceed by email?" },
    });
    // A kind is never inferred from the action's shape (review round 4):
    // a foreign kind carrying a question-set-shaped action still mints
    // nothing — the kind gate, not the narrowing, is what skips it.
    const shapedLikeASet = askEntry({
      interruptId: "v1:tool_call:t2:client-result",
      toolCallId: "run-1-t2",
      kind: "builtin.read_page",
      action: ONE_QUESTION_ACTION,
    });
    const cards = elicitationCardsOf(
      [navigate, retired, shapedLikeASet, askEntry()],
      NO_ERRORS,
    );

    expect(cards).toEqual([
      {
        interruptId: "v1:tool_call:a1:member-answers",
        runId: "run-1",
        toolCallId: "run-1-a1",
        anchored: true,
        round: 0,
        status: "actionable",
        errorSentence: null,
        questions: [
          {
            id: "plan",
            heading: "Plan",
            prompt: "Proceed by email?",
            options: [
              { text: "Yes", description: null },
              { text: "No", description: null },
            ],
          },
        ],
        answered: null,
      },
    ]);
  });

  it("maps the inbox's entry status onto the card's", () => {
    const statusOf = (status: ExecutionEntryStatus) =>
      elicitationCardsOf([askEntry({ status })], NO_ERRORS)[0].status;

    expect(statusOf({ kind: "pending" })).toBe("actionable");
    expect(statusOf({ kind: "executing" })).toBe("submitting");
    expect(statusOf({ kind: "reported", ok: true })).toBe("answered");
    expect(statusOf({ kind: "stale" })).toBe("stale");
  });

  it("carries the anchoring and the submit failure sentence", () => {
    const errors = new Map([
      ["v1:tool_call:a1:member-answers", "Your answer was not sent."],
    ]);
    const [card] = elicitationCardsOf(
      [askEntry({ anchored: false, toolCallId: null })],
      errors,
    );

    expect(card.anchored).toBe(false);
    expect(card.toolCallId).toBe(null);
    expect(card.errorSentence).toBe("Your answer was not sent.");
  });
});

describe("the one-kind premise", () => {
  it("MEMBER_ANSWERABLE_KINDS is exactly the kind this module cards — a second member-answerable kind needs its card arm BEFORE it enters the set", () => {
    // elicitationCardsOf checks only `kind !== ASK_QUESTIONS_REQUEST_KIND`,
    // which is the whole member-answerable test only while the set has
    // this one member. The driver skips every kind in the set
    // (execution-driver.ts), so a kind in the set with no card arm is an
    // invisible wait. This pin makes that failure loud: it goes red the
    // moment a kind is added, and the fix is the card arm, never this
    // assertion.
    expect([...MEMBER_ANSWERABLE_KINDS]).toEqual([ASK_QUESTIONS_REQUEST_KIND]);
  });
});

describe("sameElicitationCards", () => {
  it("treats an identical re-derivation as unchanged", () => {
    const entries = [askEntry()];
    const first = elicitationCardsOf(entries, NO_ERRORS);
    const second = elicitationCardsOf(entries, NO_ERRORS);

    expect(first).not.toBe(second);
    expect(sameElicitationCards(first, second)).toBe(true);
    expect(sameElicitationCards([], [])).toBe(true);
  });

  it("sees every field that changes a card", () => {
    const base = elicitationCardsOf([askEntry()], NO_ERRORS);
    const submitting = elicitationCardsOf(
      [askEntry({ status: { kind: "executing" } })],
      NO_ERRORS,
    );
    const errored = elicitationCardsOf(
      [askEntry()],
      new Map([["v1:tool_call:a1:member-answers", "It failed."]]),
    );
    const orphaned = elicitationCardsOf(
      [askEntry({ anchored: false })],
      NO_ERRORS,
    );
    const answered = elicitationCardsOf(
      [askEntry()],
      NO_ERRORS,
      new Map([
        [
          "v1:tool_call:a1:member-answers",
          {
            kind: "answers" as const,
            answers: [{ id: "plan", text: "Yes" }],
          },
        ],
      ]),
    );

    expect(sameElicitationCards(base, submitting)).toBe(false);
    expect(sameElicitationCards(base, errored)).toBe(false);
    expect(sameElicitationCards(base, orphaned)).toBe(false);
    expect(sameElicitationCards(base, answered)).toBe(false);
    expect(sameElicitationCards(base, [])).toBe(false);
  });
});

describe("question sets", () => {
  const THREE_QUESTIONS_ACTION = {
    questions: [
      {
        id: "fruit",
        heading: "Favorite fruit",
        prompt: "What's your favorite fruit?",
        options: [{ text: "Mango", description: "Sweet" }, { text: "Apple" }],
      },
      { id: "drink", heading: "Favorite drink", prompt: "Drink?" },
    ],
  };
  const setEntry = (overrides: Partial<ExecutionEntryModel> = {}) =>
    askEntry({
      interruptId: "v1:tool_call:q1:member-answers",
      toolCallId: "run-1-q1",
      kind: "builtin.ask_questions",
      action: THREE_QUESTIONS_ACTION,
      ...overrides,
    });

  it("cards a builtin.ask_questions entry as a question set, descriptions narrowed and options defaulted", () => {
    const [card] = elicitationCardsOf([setEntry()], NO_ERRORS);
    expect(card.questions).toEqual([
      {
        id: "fruit",
        heading: "Favorite fruit",
        prompt: "What's your favorite fruit?",
        options: [
          { text: "Mango", description: "Sweet" },
          { text: "Apple", description: null },
        ],
      },
      { id: "drink", heading: "Favorite drink", prompt: "Drink?", options: [] },
    ]);
    expect(card.status).toBe("actionable");
    expect(card.answered).toBe(null);
  });

  it("normalizes escaped quotes on every model-authored string — heading, prompt, suggestion text and description alike", () => {
    const [card] = elicitationCardsOf(
      [
        setEntry({
          action: {
            questions: [
              {
                id: "mode",
                heading: 'Use \\"strict\\"?',
                prompt: 'Enable \\"strict\\" mode?',
                options: [
                  {
                    text: 'Use \\"strict\\" mode',
                    description: 'Fails on any \\"loose\\" match.',
                  },
                ],
              },
            ],
          },
        }),
      ],
      NO_ERRORS,
    );
    expect(card.questions[0]).toEqual({
      id: "mode",
      heading: 'Use "strict"?',
      prompt: 'Enable "strict" mode?',
      options: [
        {
          text: 'Use "strict" mode',
          description: 'Fails on any "loose" match.',
        },
      ],
    });
  });

  it("skips a set with a malformed or duplicate question rather than render an unanswerable panel", () => {
    const duplicate = setEntry({
      action: {
        questions: [
          { id: "same", heading: "A", prompt: "A?" },
          { id: "same", heading: "B", prompt: "B?" },
        ],
      },
    });
    const headless = setEntry({
      action: { questions: [{ id: "q", prompt: "No heading" }] },
    });
    // Suggestion texts are the rows' React keys: two alike (even by case)
    // would collide, so the set is refused as the server refuses it.
    const twinOptions = setEntry({
      action: {
        questions: [
          {
            id: "q",
            heading: "H",
            prompt: "P?",
            options: [{ text: "Mango" }, { text: "mango" }],
          },
        ],
      },
    });
    expect(
      elicitationCardsOf([duplicate, headless, twinOptions], NO_ERRORS),
    ).toEqual([]);
  });

  it("carries the stamped answers or cancellation, and compares questions by reference", () => {
    const answered = new Map([
      [
        "v1:tool_call:q1:member-answers",
        { kind: "answers" as const, answers: [{ id: "fruit", text: "Mango" }] },
      ],
    ]);
    const [a] = elicitationCardsOf(
      [setEntry({ status: { kind: "reported", ok: true } })],
      NO_ERRORS,
      answered,
    );
    expect(a.status).toBe("answered");
    expect(a.answered).toEqual({
      kind: "answers",
      answers: [{ id: "fruit", text: "Mango" }],
    });
    const [b] = elicitationCardsOf([setEntry()], NO_ERRORS);
    const [c] = elicitationCardsOf([setEntry()], NO_ERRORS);
    // Same wire object → same derivation; the publish gate holds.
    expect(sameElicitationCards([b], [c])).toBe(true);
    const [d] = elicitationCardsOf(
      [setEntry({ action: { ...THREE_QUESTIONS_ACTION } })],
      NO_ERRORS,
    );
    // A fresh wire object is a new derivation — never mistaken for the old.
    expect(sameElicitationCards([b], [d])).toBe(false);
  });
});
