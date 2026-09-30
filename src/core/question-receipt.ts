import type { AnsweredQuestions } from "./elicitation-cards.js";
import {
  askQuestionsActionOf,
  type QuestionModel,
} from "./elicitation-pickers.js";

/** A settled question set as the transcript states it: the questions
 *  and the member's answers (verbatim, line breaks kept). A cancelled set
 *  is NOT a receipt — nothing was answered, and the dismissed fact is
 *  the panel footer's to state (the meta-receipt rule), never a
 *  transcript row's. */
export interface SettledQuestionsReceipt {
  questions: readonly QuestionModel[];
  answers: readonly { id: string; text: string }[];
}

/** The receipt for a card this tab saw settle: the member's own answers
 *  when the store stamped them, else the plain answered fact per
 *  question (a set another client answered — the text never reached this
 *  tab; the row's tool result is the durable record). Null for a
 *  cancelled set: no receipt renders for a dismissal. */
export function settledQuestionsReceiptOfCard(
  questions: readonly QuestionModel[],
  answered: AnsweredQuestions | null,
): SettledQuestionsReceipt | null {
  if (answered !== null && answered.kind === "cancelled") {
    return null;
  }
  return { questions, answers: answered === null ? [] : answered.answers };
}

/**
 * Recover a settled question set from a durable ask_user tool row:
 * the stored arguments must narrow to a question set AND the
 * result must be the tool's ANSWERED return — `{answers: [{id, text}]}` —
 * for the row to collapse into a receipt. A cancelled return
 * (`{cancelled: true}`) is a settled decision with no answers: the row
 * keeps its own state and no prose renders for it (the meta-receipt rule:
 * the dismissed fact is the panel footer's, in shelf-less hosts). A failure
 * envelope, the chat fallback, or an unrelated tool's questions-shaped
 * arguments never become one. Tool identity is checked first; the
 * projection routes, it never guesses.
 */
export function settledQuestionsReceiptOf(
  toolName: string,
  argsText: string,
  resultText: string | undefined,
): SettledQuestionsReceipt | null {
  if (
    toolName !== "ask_user" ||
    resultText === undefined ||
    resultText === ""
  ) {
    return null;
  }
  const args = _recordOf(argsText);
  const set = args === null ? null : askQuestionsActionOf(args);
  if (set === null) {
    return null;
  }
  const result = _recordOf(resultText);
  if (result === null) {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(result, "answers")) {
    return null;
  }
  const raw = result.answers;
  if (!Array.isArray(raw)) {
    return null;
  }
  const answers: { id: string; text: string }[] = [];
  for (const candidate of raw) {
    if (typeof candidate !== "object" || candidate === null) {
      return null;
    }
    const record = candidate as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.text !== "string") {
      return null;
    }
    answers.push({ id: record.id, text: record.text });
  }
  return { questions: set.questions, answers };
}

function _recordOf(text: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}
