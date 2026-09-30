"use client";

import { createContext, useContext } from "react";

import type {
  ApprovalCardModel,
  ApprovalDecisionInput,
} from "../core/approval-inbox.js";

// The approval surface's contract with the transcript: cards travel by
// context because more than one surface reads them — the suspension
// tenant renders the actionable ones (anchored and orphaned alike), and
// the message list joins each anchored card's settled state to its
// originating row.

export interface ApprovalSurface {
  cards: readonly ApprovalCardModel[];
  submitDecision: (
    card: ApprovalCardModel,
    decision: ApprovalDecisionInput,
  ) => Promise<void>;
}

// Inert for rendering, loud on use: the empty-state composer renders
// outside any transcript, where nothing can be paused — but a decision
// on a safety-critical control must never dissolve into a successful
// no-op, so an out-of-surface submit says so in the console and
// rejects. Callers void the promise, which makes the rejection an
// unhandled one on purpose: it reaches the host's exception capture.
const EMPTY_APPROVAL_SURFACE: ApprovalSurface = {
  cards: [],
  submitDecision: (card) => {
    const error = new Error(
      `submitDecision called outside an approval surface (interrupt ${card.interruptId}) — the decision was NOT sent.`,
    );
    console.error(error);
    return Promise.reject(error);
  },
};

export const ApprovalsContext = createContext<ApprovalSurface>(
  EMPTY_APPROVAL_SURFACE,
);

/** The approval surface — live under <TeaflaskAssistantProvider>;
 *  outside one it is the inert-but-loud guard above, so a stray
 *  submit still refuses to dissolve into a no-op. */
export function useApprovals(): ApprovalSurface {
  return useContext(ApprovalsContext);
}

export function anchoredCardsFor(
  cards: readonly ApprovalCardModel[],
  toolCallId: string,
): ApprovalCardModel[] {
  return cards.filter(
    (card) => card.anchored && card.toolCallId === toolCallId,
  );
}
