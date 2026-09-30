// Answering question sets: the ONE POST for a whole pending
// set — answers or a distinct cancellation — with the same lock, turn
// lookup, delivery and failure arms as the approval submit. The
// `{ kind: "answers" }` / `{ kind: "cancelled" }` literals below are this
// package's one allowed tool-call state site outside the driver — the
// ledger in tests/tool-call-state-sites.test.ts names this file.

import { resolveTurnToolResults } from "../transport/serving-api.js";
import { ServingApiError } from "../transport/serving-error.js";
import { ANSWER_NOT_SENT_SENTENCE } from "./approval-inbox.js";
import { turnIdAnsweredBy } from "./approval-decision.js";
import type { AssistantConversationStore } from "./conversation-store.js";
import type {
  AnsweredQuestions,
  QuestionSetCardModel,
} from "./elicitation-cards.js";
import { publishExecutionEntries } from "./epoch-sync.js";
import { userSentenceFor } from "./error-copy.js";

/**
 * Submit the member's answers to one pending question set — the ONE
 * POST for the whole set, after the panel's local navigation. Same
 * lock, turn lookup, delivery and failure arms as the approval submit;
 * the draft is released on success and KEPT on any failure, so a retry
 * never starts from an empty panel.
 */
export async function submitQuestionAnswersFromStore(
  store: AssistantConversationStore,
  card: QuestionSetCardModel,
  answers: readonly { id: string; text: string }[],
): Promise<void> {
  await _deliverQuestionSetReport(
    store,
    card,
    { answers: answers.map((answer) => ({ ...answer })) },
    { kind: "answers", answers },
  );
}

/**
 * Dismiss one pending question set whole: no partial answers, and the
 * model hears a distinct cancellation — never the kind-unsupported
 * failure that would tell it to ask the same questions in chat.
 */
export async function cancelQuestionSetFromStore(
  store: AssistantConversationStore,
  card: QuestionSetCardModel,
): Promise<void> {
  await _deliverQuestionSetReport(
    store,
    card,
    { cancelled: true },
    { kind: "cancelled" },
  );
}

async function _deliverQuestionSetReport(
  store: AssistantConversationStore,
  card: QuestionSetCardModel,
  result: Record<string, unknown>,
  answered: AnsweredQuestions,
): Promise<void> {
  const epoch = store._epoch;
  const active = store._active;
  if (epoch === null || active === null) {
    return;
  }
  const inbox = epoch.executionInbox;
  if (!inbox.beginExecution(card.interruptId)) {
    return;
  }
  store._elicitationErrors.delete(card.interruptId);
  const publishIfCurrent = () => {
    if (store._epoch === epoch) {
      publishExecutionEntries(store, inbox.entries());
    }
  };
  publishIfCurrent();
  try {
    const turnId = await turnIdAnsweredBy(store, active, card);
    if (turnId === null) {
      store._elicitationErrors.set(card.interruptId, ANSWER_NOT_SENT_SENTENCE);
      inbox.settlePostFailed(card.interruptId);
      return;
    }
    const resolution = await resolveTurnToolResults(
      store.deps.session,
      active.thread.id,
      turnId,
      { results: [{ interrupt_id: card.interruptId, ok: true, result }] },
    );
    store._questionAnswers.set(card.interruptId, answered);
    inbox.settleReported(card.interruptId, true);
    // Released on success only — a failed POST keeps the member's
    // staged answers for the retry.
    store.questionDrafts.clear(card.interruptId);
    // The delivery field alone decides the reconnect (the approval
    // submit's law): a notice can accompany a DELIVERED restart too (the
    // oversize drop), and skipping the reconnect there would freeze the
    // transcript on the dead run.
    if (resolution.delivery === "workflow_restarted") {
      store.handleWorkflowRestarted();
    }
  } catch (error) {
    if (_turnNoLongerAwaitingToolResults(error)) {
      // Voided, settled, or answered in another tab: the set is over,
      // and so is its draft.
      inbox.markRunStale(card.runId);
      store.questionDrafts.clear(card.interruptId);
      void store.refreshConversation();
    } else {
      store._elicitationErrors.set(
        card.interruptId,
        _questionSetFailureSentenceOf(error),
      );
      inbox.settlePostFailed(card.interruptId);
    }
  } finally {
    publishIfCurrent();
  }
}

function _turnNoLongerAwaitingToolResults(error: unknown): boolean {
  return (
    error instanceof ServingApiError &&
    error.code === "ASSISTANT_TURN_NOT_AWAITING_TOOL_RESULTS"
  );
}

// THE RULES THE DOOR CAN REFUSE A QUESTION SET ON, AND WHAT THE MEMBER
// SEES — the client prevents each one it can:
//   - per-answer length ≤ 1,900 (prevented: overLimitOf gates Submit and
//     names the question; if reached anyway, the door's sentence: "One
//     answer is longer than 1,900 characters. Shorten it and submit
//     again.")
//   - C0 control characters other than tab/newline/CR (prevented:
//     normalizeCustomText at the draft write; if reached anyway — a
//     non-panel client — the door's sentence names the rule)
//   - every question answered exactly once (prevented: answersOf gates
//     Submit and builds the body from the set itself; if reached anyway,
//     the door names the unanswered / repeated / unasked ids)
//   - the answers-or-cancelled shape (prevented by construction; the door
//     would say the answers could not be read)
//   - the whole-report size cap (cannot be reached from a set the client
//     admits: 5 × 2 × 1,900 plus the envelope sits under it — a degrade
//     to the too-large failure, never a 422, if a foreign client did)
//   - 409 not awaiting (stale: the panel leaves and the settled line says
//     the set was already answered or expired)
//   - anything else (the generic sentence: "That answer couldn't be sent.
//     Please try again.")
// The playground's question-submit.ts passes the door's sentence through
// (describeError), the same words. The composer's own VALIDATION_ERROR
// copy ("Shorten it and try again") is about the message field and is
// deliberately NOT reused here — a member who pasted a control character
// cannot act on "shorten".
function _questionSetFailureSentenceOf(error: unknown): string {
  if (
    error instanceof ServingApiError &&
    error.code === "VALIDATION_ERROR" &&
    error.message !== ""
  ) {
    return error.message;
  }
  return userSentenceFor(error);
}
