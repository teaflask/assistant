"use client";

import type { ServingAssistantThread } from "../contract/threads.js";
import type {
  ActiveConversation,
  ComposerContract,
} from "../core/conversation-store.js";
import type { PendingDecisionGap } from "../core/pending-decision-gap.js";
import type { ServingApiError } from "../transport/serving-error.js";
import { useAssistantSession } from "./teaflask-assistant-provider.js";
import { useCell } from "./use-store-cell.js";

/** The surface-facing view of the shared conversation core — exactly what
 *  the chromes render, nothing the store keeps to itself. */
export interface AssistantConversation {
  setupError: ServingApiError | null;
  conversation: ActiveConversation | null;
  threads: ServingAssistantThread[];
  historyExpected: boolean;
  threadOpening: boolean;
  reconnectNonce: number;
  composerContract: ComposerContract;
  sendError: string | null;
  turnFailure: string | null;
  showInterruptionBanner: boolean;
  // The server names pending interrupts this client could build no card
  // for — rendered as an explicit recoverable alert, because no generic
  // wait label exists to even hint at the state anymore.
  pendingDecisionGap: PendingDecisionGap | null;
  retryStream: () => void;
  // The gap alert's recovery: a fresh REST read re-runs the
  // hydrate-before-reconcile over the durable pending_approvals snapshot.
  refreshConversation: () => Promise<void>;
  openThread: (thread: ServingAssistantThread) => void;
  startNewConversation: () => void;
  // Re-adopts the stored thread (another surface may have moved it while
  // this one wasn't looking). The provider boots it once; the palette
  // calls it again on every open.
  resumeStoredThread: () => void;
}

/**
 * The React binding of the shared conversation store: every mounted
 * surface subscribing here reads the SAME store — one thread, one resume
 * state, one send path — so surfaces are pure chrome over one live
 * conversation. The engine itself lives in core/conversation-store.
 */
export function useAssistantConversation(): AssistantConversation {
  const { setupError, store } = useAssistantSession();
  const conversation = useCell(store.conversation);
  const composerContract = useCell(store.composer);

  return {
    setupError,
    conversation: conversation.active,
    threads: conversation.threads,
    historyExpected: conversation.historyExpected,
    threadOpening: conversation.threadOpening,
    reconnectNonce: conversation.reconnectNonce,
    composerContract,
    sendError: conversation.sendError,
    turnFailure: conversation.turnFailure,
    showInterruptionBanner: conversation.showInterruptionBanner,
    pendingDecisionGap: conversation.pendingDecisionGap,
    retryStream: store.retryStream,
    refreshConversation: store.refreshConversation,
    openThread: store.openThread,
    startNewConversation: store.startNewConversation,
    resumeStoredThread: store.resumeStoredThread,
  };
}
