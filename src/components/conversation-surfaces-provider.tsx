"use client";

import { useMemo, type ReactNode } from "react";

import type { AssistantConversationStore } from "../core/conversation-store.js";
import { ApprovalsContext, type ApprovalSurface } from "./approval-context.js";
import { ConversationContext } from "./conversation-context.js";
import {
  ElicitationsContext,
  type ElicitationSurface,
} from "./elicitation-context.js";
import { useCell } from "./use-store-cell.js";

/**
 * The provider-level provision of the three conversation surfaces: the
 * composer contract, the approval surface and the elicitation surface
 * used to be provided by the chrome — the conversation view and the
 * transcript — which made the hooks unusable without mounting package
 * chrome. They are store bindings, not chrome state, so they belong to
 * the provider: a bring-your-own-frontend host mounts
 * <TeaflaskAssistantProvider> alone and reads them through the
 * ./headless entry's hooks.
 *
 * Internal on purpose (mounted by the provider, exported from no entry):
 * the composition seam stays ours. A child component rather than more
 * hooks in the provider body so the provider itself never subscribes to
 * a cell — its children element is stable, so a cell update re-renders
 * only context consumers, never the host's whole subtree. store.composer
 * is not the keystroke cell (composerInput rides its own cell,
 * core/conversation-store), so this subscription stays coarse.
 */
export function ConversationSurfacesProvider({
  store,
  children,
}: {
  store: AssistantConversationStore;
  children: ReactNode;
}) {
  const composerContract = useCell(store.composer);

  const approvalCards = useCell(store.approvals);
  const approvalSurface = useMemo<ApprovalSurface>(
    () => ({
      cards: approvalCards,
      submitDecision: store.submitApprovalDecision,
    }),
    [approvalCards, store],
  );

  const elicitationCards = useCell(store.elicitations);
  const elicitationSurface = useMemo<ElicitationSurface>(
    () => ({
      cards: elicitationCards,
      submitQuestionAnswers: store.submitQuestionAnswers,
      cancelQuestionSet: store.cancelQuestionSet,
      drafts: store.questionDrafts,
    }),
    [elicitationCards, store],
  );

  return (
    <ConversationContext.Provider value={composerContract}>
      <ApprovalsContext.Provider value={approvalSurface}>
        <ElicitationsContext.Provider value={elicitationSurface}>
          {children}
        </ElicitationsContext.Provider>
      </ApprovalsContext.Provider>
    </ConversationContext.Provider>
  );
}
