// The elicitation cards: a pure
// derivation from the execution inbox's entries to the member-facing models.
// Member-answerable entries live in the SAME inbox as every execution
// request, but their executor is the member, so they surface as cards
// answered through the store's submit actions. React-free: no clocks, no
// locale. One shape: a bounded set of questions answered as
// text in one submission, or dismissed whole; its shared fields and the one
// pending-decision predicate are what the queue, the row pill, the
// decision-live fact and the pending-decision gap consume.
//
// THE PREMISE: MEMBER_ANSWERABLE_KINDS holds exactly
// ASK_QUESTIONS_REQUEST_KIND, so "not the question-set kind" and "not
// member-answerable" are one test, and the model carries NO discriminant (a
// one-member union needs none). A second member-answerable kind would be
// skipped by the driver and mint no card here — an invisible wait;
// elicitation-cards.test.ts pins the set, so adding a kind goes red until
// its card arm exists, where a discriminant returns with its second reader.

import { ASK_QUESTIONS_REQUEST_KIND } from "./execution-handlers.js";
import type { ExecutionEntryModel } from "./execution-inbox.js";
import {
  askQuestionsActionOf,
  type QuestionModel,
} from "./elicitation-pickers.js";

export type ElicitationCardStatus =
  "actionable" | "submitting" | "answered" | "stale";

interface ElicitationCardBase {
  /** The contract's opaque interrupt id — the card key and the report id. */
  interruptId: string;
  /** The server run that paused — what the answer's turn lookup keys on. */
  runId: string;
  toolCallId: string | null;
  /** True once the ask's own tool row streamed on this connection. Anchoring
   *  decides queue ORDER (the row's transcript position) and lets the row
   *  projection settle the ask on its own row — never placement. */
  anchored: boolean;
  round: number;
  status: ElicitationCardStatus;
  /** The submit failure the member should read, when the last submit
   *  failed — the store stamps it; null otherwise. */
  errorSentence: string | null;
}

/** The question set: answered as text in one submission. */
export interface QuestionSetCardModel extends ElicitationCardBase {
  /** The set, verbatim from the (narrowed) wire; one object per entry
   *  for its whole life, so `same*` compares it by reference. */
  questions: readonly QuestionModel[];
  /** What this member's own submit posted, for the settled receipt —
   *  the store stamps it on success; null before then and on replayed
   *  history, where the tool result row is the durable receipt. */
  answered: AnsweredQuestions | null;
}

export type AnsweredQuestions =
  | { kind: "answers"; answers: readonly { id: string; text: string }[] }
  | { kind: "cancelled" };

/** The member-facing card model — one shape. */
export type ElicitationCardModel = QuestionSetCardModel;

const NO_QUESTION_ANSWERS: ReadonlyMap<string, AnsweredQuestions> = new Map();

// One narrowing per wire object: the action rides one entry for its
// whole life, so caching by it keeps `questions` reference-stable across
// publishes — which is what lets sameElicitationCards compare it by
// reference and the publish gate stay quiet through every unrelated
// execution-lifecycle event.
const NARROWED_SETS = new WeakMap<
  Record<string, unknown>,
  { questions: QuestionModel[] } | null
>();

function narrowedQuestionSetOf(
  action: Record<string, unknown> | null,
): { questions: QuestionModel[] } | null {
  if (action === null) {
    return null;
  }
  const cached = NARROWED_SETS.get(action);
  if (cached !== undefined) {
    return cached;
  }
  const narrowed = askQuestionsActionOf(action);
  NARROWED_SETS.set(action, narrowed);
  return narrowed;
}

/** The member-answerable entries as cards, entry order preserved. An entry
 *  whose action does not carry its kind's shape is skipped — "ignore what
 *  you don't recognize"; the pending-decision gap then names the pause. An
 *  entry of a kind that is not member-answerable is the driver's to serve. */
export function elicitationCardsOf(
  entries: readonly ExecutionEntryModel[],
  errorSentences: ReadonlyMap<string, string>,
  questionAnswers: ReadonlyMap<string, AnsweredQuestions> = NO_QUESTION_ANSWERS,
): ElicitationCardModel[] {
  const cards: ElicitationCardModel[] = [];
  for (const entry of entries) {
    if (entry.kind !== ASK_QUESTIONS_REQUEST_KIND) {
      continue;
    }
    const set = narrowedQuestionSetOf(entry.action);
    if (set === null) {
      continue;
    }
    cards.push({
      interruptId: entry.interruptId,
      runId: entry.runId,
      toolCallId: entry.toolCallId,
      anchored: entry.anchored,
      round: entry.round,
      status: _statusOf(entry),
      errorSentence: errorSentences.get(entry.interruptId) ?? null,
      questions: set.questions,
      answered: questionAnswers.get(entry.interruptId) ?? null,
    });
  }
  return cards;
}

/** Whether two derivations describe the same cards — the publish gate's
 *  structural half. The cell compares snapshots by reference and
 *  elicitationCardsOf builds a fresh array per call, while the entries feed
 *  publishes for EVERY execution kind's lifecycle. questions and answered
 *  compare by reference: one wire object per entry, one answered per settle. */
export function sameElicitationCards(
  a: readonly ElicitationCardModel[],
  b: readonly ElicitationCardModel[],
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((card, index) => {
    const other = b[index];
    return (
      card.interruptId === other.interruptId &&
      card.runId === other.runId &&
      card.toolCallId === other.toolCallId &&
      card.anchored === other.anchored &&
      card.round === other.round &&
      card.status === other.status &&
      card.errorSentence === other.errorSentence &&
      card.questions === other.questions &&
      card.answered === other.answered
    );
  });
}

function _statusOf(entry: ExecutionEntryModel): ElicitationCardStatus {
  switch (entry.status.kind) {
    case "pending":
      return "actionable";
    case "executing":
      // The inbox's claim doubles as the submit lock: the member's
      // answer is in flight.
      return "submitting";
    case "reported":
      return "answered";
    case "stale":
      return "stale";
  }
}
