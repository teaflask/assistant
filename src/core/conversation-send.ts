// Sending and stopping the live turn: the one send POST every surface
// goes through — optimistic echo, model pick capture, the honest refusal
// taxonomy — and the stop that ends a live turn as a quiet receipt.

import type { TurnAttachment } from "../contract/threads.js";
import {
  sendAssistantMessage,
  stopAssistantTurn,
} from "../transport/serving-api.js";
import { ServingApiError } from "../transport/serving-error.js";
import { enterConversationFromSend } from "./conversation-adoption.js";
import { busyOf, publishStore } from "./conversation-publish.js";
import type { AssistantConversationStore } from "./conversation-store.js";
import { stopFailureSentenceFor, userSentenceFor } from "./error-copy.js";
import { probeStopSettle } from "./stop-settle.js";

// The optimistic user message's id mint — module-level so ids stay
// unique across every conversation this page ever opens.
let nextOptimisticMessageId = 1;

export async function sendMessageFromStore(
  store: AssistantConversationStore,
  message: string,
  attachmentIds: string[] = [],
  optimisticAttachments: TurnAttachment[] = [],
): Promise<boolean> {
  store._sendError = null;
  store._turnFailure = null;
  store._streamInterrupted = false;
  store._stopping = false;
  store._pendingSend = true;
  store._pendingEcho = {
    messageId: `optimistic-user-${String(nextOptimisticMessageId++)}`,
    text: message,
    attachments: optimisticAttachments,
  };
  publishStore(store);
  // Captured before the await: the shelf stays live during a send, so
  // a selection changed mid-flight must survive the landing (it rides
  // the NEXT send) — only the pick this send actually carried settles.
  const sentPick = store._modelPick;
  try {
    const response = await sendAssistantMessage(store.deps.session, {
      thread_id: store._active?.thread.id,
      message,
      attachment_ids: attachmentIds,
      // Present = set exactly this (idempotent for an unchanged pick);
      // absent = keep — the contract's set-pick semantics.
      ...(sentPick !== null && {
        model_pick: {
          model_id: sentPick.modelId,
          effort: sentPick.effort,
        },
      }),
    });
    enterConversationFromSend(store, response.thread, response.turn, sentPick);
    // The send just remounted the composer (it rides the transcript,
    // which reconnects by remounting), dropping the caret; the fresh
    // instance takes it back once the turn settles.
    store._composerRefocusPending = true;
    return true;
  } catch (error) {
    store._pendingEcho = null;
    if (_isThreadBusyRefusal(error)) {
      // This is a synchronization correction, not a destructive error:
      // another surface (or a late settle) still owns the turn. Re-read
      // and reconnect to that work; the composer's false return restores
      // the attempted message as a draft (scope-guarded — only into the
      // conversation that sent it).
      store._sendError = null;
      await store.refreshConversation();
      return false;
    }
    store._sendError = userSentenceFor(error);
    if (error instanceof ServingApiError && _isAGateRefusal(error)) {
      // The refusal's recovery is the gate (the composer's takeover
      // card) — the entry adopts it; the banner stands down for it.
      store._sendError = null;
      store.deps.onGateRefusal(error);
    }
    if (error instanceof Error) {
      store.deps.reportError(error);
    }
    return false;
  } finally {
    store._pendingSend = false;
    publishStore(store);
  }
}

export function markComposerRefocusHandledFromStore(
  store: AssistantConversationStore,
): void {
  store._composerRefocusPending = false;
  publishStore(store);
}

// --- stopping the live turn ---

/** Ends the live turn as a quiet receipt. Thread-scoped on
 *  purpose: the serving door's thread pointer names the live turn
 *  (liveness, never recency), so the store never picks one. Deliberately
 *  never touches _streamInterrupted — a stop is a thing the member did,
 *  and the interruption banner would be a lie. */
export async function stopTurnFromStore(
  store: AssistantConversationStore,
): Promise<void> {
  const active = store._active;
  if (
    store._disposed ||
    active === null ||
    store._stopping ||
    // No turn exists yet while the send POST is in flight; the send's
    // own failure path is the recovery there.
    store._pendingSend ||
    !busyOf(store)
  ) {
    return;
  }
  const threadId = active.thread.id;
  // Each attempt owns its own narration, exactly like sendMessage: a
  // previous attempt's failure sentence must not outlive the retry
  // that worked.
  store._sendError = null;
  store._stopping = true;
  publishStore(store);
  try {
    const receipt = await stopAssistantTurn(store.deps.session, threadId);
    if (_stopLostItsThread(store, threadId)) {
      return;
    }
    // The composer re-enables when busy flips false; the caret comes
    // back with it, exactly like a landed send.
    store._composerRefocusPending = true;
    publishStore(store);
    if (receipt.delivery !== "signaled") {
      // turn_settled / already_settled: the door settled the turn (or
      // found the answer already won the race) — REST is terminal now.
      // A read blip here falls through to the probe loop below.
      await store.refreshConversation();
    }
    // Signaled: the workflow's stop exit lands turn_stopped plus a
    // quiet RUN_FINISHED on the stream (~2s), and the normal settle
    // machinery adopts it. The bounded probe is the no-stream corner's
    // fallback (handleWorkflowRestarted's shape); a settle adopted by
    // the stream clears _stopping and ends the loop early.
    const exhausted = await probeStopSettle({
      refresh: store.refreshConversation,
      stillAwaitsSettle: () => _stopStillAwaitsSettle(store, threadId),
    });
    // Exhausted: the probe window is a fallback, not a promise. A
    // settle that never showed up must not keep narrating "Stopping…"
    // — release the lock so the stop square re-arms (the door answers
    // a receipt to a second press) and a genuinely dead stream's
    // interruption banner (its Retry is the only way back) can
    // surface. A stop that lands later still renders honestly through
    // the ordinary settle machinery. This never resurfaces the banner
    // after a SUCCESSFUL stop: success means busy flipped false inside
    // the window, and a false busy hides the banner on its own.
    if (exhausted) {
      store._stopping = false;
      publishStore(store);
    }
  } catch (error) {
    if (_stopLostItsThread(store, threadId)) {
      return;
    }
    store._stopping = false;
    // The stop door's own vocabulary, never the send door's: a failed
    // stop is not a failed send.
    store._sendError = stopFailureSentenceFor(error);
    publishStore(store);
    if (error instanceof Error) {
      store.deps.reportError(error);
    }
  }
}

// Read fresh behind every await on purpose: dispose, thread switches,
// and the settle machinery all move these fields while a stop sleeps,
// and the function boundary keeps TS narrowing (which cannot see those
// writers) from constant-folding the re-checks.
function _stopLostItsThread(
  store: AssistantConversationStore,
  threadId: string,
): boolean {
  return store._disposed || store._active?.thread.id !== threadId;
}

function _stopStillAwaitsSettle(
  store: AssistantConversationStore,
  threadId: string,
): boolean {
  return !_stopLostItsThread(store, threadId) && store._stopping;
}

function _isThreadBusyRefusal(error: unknown): boolean {
  return (
    error instanceof ServingApiError && error.code === "ASSISTANT_THREAD_BUSY"
  );
}

// The gate-shaped refusal codes: their recovery renders in the
// composer's place (core/connect-gate.ts), so the send banner stands
// down for them — everything else stays the banner's story.
function _isAGateRefusal(error: ServingApiError): boolean {
  return (
    error.code === "ASSISTANT_SIGN_IN_REQUIRED" ||
    error.code === "SUBSCRIPTION_CONNECT_REQUIRED" ||
    error.code === "SUBSCRIPTION_CANNOT_PAY"
  );
}

// Replay injected the optimistic echo's own message: the bridge has done
// its job and the row now renders from the transcript itself.
export function handleUserMessageInjectedFromStore(
  store: AssistantConversationStore,
  messageId: string,
): void {
  if (
    store._pendingEcho !== null &&
    store._pendingEcho.messageId === messageId
  ) {
    store._pendingEcho = null;
    publishStore(store);
  }
}
