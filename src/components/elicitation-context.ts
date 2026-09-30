"use client";

import { createContext, useContext } from "react";

import type {
  ElicitationCardModel,
  QuestionSetCardModel,
} from "../core/elicitation-cards.js";
import { QuestionDraftStore } from "../core/question-drafts.js";

// The elicitation surface's contract with the transcript: the pending
// asks travel by context like approvals do, because more than one
// surface reads them — the suspension tenant renders the actionable ones
// (anchored and orphaned alike; anchoring now decides queue ORDER, not
// placement), and the message list joins each anchored ask's settled
// state to its originating row. The anchored split is still a ONE-SHOT
// judgement at marker time — an entry whose TOOL_CALL_START streamed
// first is anchored, anything else stays an orphan for its whole life (a
// snapshot replay with no start events orphans every pending ask, and
// that is safe — the queue answers the same pause either way). The
// question-set drafts ride along too: they live in the store (never in
// the remounting panel), and the panel reads and writes them here. A
// settled row's receipt needs nothing from this context: it collapses
// from the row's own durable arguments and result
// (core/question-receipt.ts).

export interface ElicitationSurface {
  cards: readonly ElicitationCardModel[];
  /** Submit the whole question set at once — the ONE POST for the set;
   *  the panel calls it only when every question has an answer. */
  submitQuestionAnswers: (
    card: QuestionSetCardModel,
    answers: readonly { id: string; text: string }[],
  ) => Promise<void>;
  /** Dismiss the whole set: no partial answers, a distinct outcome. */
  cancelQuestionSet: (card: QuestionSetCardModel) => Promise<void>;
  /** The question-set drafts, keyed by interrupt id then question id —
   *  store-owned so navigation, remount and reconnect never lose them. */
  drafts: QuestionDraftStore;
}

// Inert for rendering, loud on use — the approval guard's rule, applied
// here too because useElicitations is public API: outside a provider
// nothing can be pending, so `cards` is empty and no panel ever mounts.
// But a host calling the submit or cancel anyway — its question UI
// mounted above the provider, say — must never see a member's answers
// dissolve into a successful no-op: the console says so and the promise
// rejects, reaching the host's exception capture.
const EMPTY_ELICITATION_SURFACE: ElicitationSurface = {
  cards: [],
  submitQuestionAnswers: (card) => {
    const error = new Error(
      `submitQuestionAnswers called outside an elicitation surface (interrupt ${card.interruptId}) — the answers were NOT sent.`,
    );
    console.error(error);
    return Promise.reject(error);
  },
  cancelQuestionSet: (card) => {
    const error = new Error(
      `cancelQuestionSet called outside an elicitation surface (interrupt ${card.interruptId}) — the set was NOT cancelled.`,
    );
    console.error(error);
    return Promise.reject(error);
  },
  drafts: new QuestionDraftStore(),
};

export const ElicitationsContext = createContext<ElicitationSurface>(
  EMPTY_ELICITATION_SURFACE,
);

/** The elicitation surface — live under <TeaflaskAssistantProvider>;
 *  outside one it is the inert-but-loud guard above, so a stray
 *  submit or cancel still refuses to dissolve into a no-op. */
export function useElicitations(): ElicitationSurface {
  return useContext(ElicitationsContext);
}

/** The cards anchored to one tool row — consumed by the row projection:
 *  in the shelf composition the pending panel lives in the suspension
 *  queue while the answered receipt and the expired note settle at the
 *  pause point; shelf-less hosts still mount every status there. */
export function anchoredElicitationsFor(
  cards: readonly ElicitationCardModel[],
  toolCallId: string,
): ElicitationCardModel[] {
  return cards.filter(
    (card) => card.anchored && card.toolCallId === toolCallId,
  );
}

// (The old composer-block orphan filter is gone: the suspension queue
// (core/suspension-queue.ts) admits every actionable/submitting ask,
// anchored or not.)
