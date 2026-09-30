// Publishing: the one place snapshots rebuild and cells emit — a cell's
// identity changes iff its content did (the useSyncExternalStore
// contract), the epoch/connection/idle syncs key off the same pass, and
// the pending-decision gap re-judges on every publish. The re-entrancy
// latch (_inPublish) stays a store field — the gap gate's judge-driven
// transitions fire inside publishStore.

import type {
  ComposerContract,
  ConversationSnapshot,
} from "./conversation-contract.js";
import { syncConnection } from "./connection-driver.js";
import { historyExpected, sameModelPick } from "./conversation-adoption.js";
import type { AssistantConversationStore } from "./conversation-store.js";
import {
  publishActivity,
  syncEpoch,
  theAnswerablePause,
} from "./epoch-sync.js";
import { syncIdleRecheck } from "./idle-recheck.js";
import { pendingDecisionGapOf } from "./pending-decision-gap.js";
import { bannerFailureSentenceOf } from "./turn-failure-copy.js";

// Rebuilds both snapshots and emits only the ones that actually moved,
// so a cell's identity changes iff its content did — the contract
// useSyncExternalStore's cached-snapshot semantics depend on. The
// connection epoch keys off the same state, so it syncs here too.
export function publishStore(store: AssistantConversationStore): void {
  // The re-entrancy latch is the gap gate's: a judge-driven transition
  // fires inside this function (below), where writing _pendingDecisionGap
  // suffices — the snapshot build reads it. Only the gate's timer-driven
  // transitions, firing outside any publish, trigger their own.
  store._inPublish = true;
  try {
    syncEpoch(store);
    _updatePendingDecisionGap(store);
    _publishTurnMeta(store);
    const conversation = conversationSnapshotOf(store);
    if (
      !_sameConversationSnapshot(conversation, store._conversationCell.get())
    ) {
      store._conversationCell.set(conversation);
    }
    const composer = composerSnapshotOf(store);
    if (!_sameComposerSnapshot(composer, store._composerCell.get())) {
      store._composerCell.set(composer);
    }
    publishActivity(store);
    scheduleConnectionSync(store);
    syncIdleRecheck(store);
  } finally {
    store._inPublish = false;
  }
}

// The connect decision is deferred to a coalesced microtask so a
// presence transition that resolves within the same synchronous tick —
// a keyed transcript REMOUNT releases then re-acquires back-to-back —
// is seen settled before the store acts. The check re-reads live at
// fire time.
export function scheduleConnectionSync(
  store: AssistantConversationStore,
): void {
  if (store._connectionSyncQueued || store._disposed) {
    return;
  }
  store._connectionSyncQueued = true;
  queueMicrotask(() => {
    store._connectionSyncQueued = false;
    syncConnection(store);
  });
}

export function conversationSnapshotOf(
  store: AssistantConversationStore,
): ConversationSnapshot {
  return {
    active: store._active,
    threads: store._threads,
    historyExpected: historyExpected(store),
    threadOpening: store._threadOpening,
    reconnectNonce: store._reconnectNonce,
    sendError: store._sendError,
    turnFailure: bannerFailureSentenceOf(
      store._turnFailure,
      store._active?.resume.turnFailedAnchors,
    ),
    // Never during a stop: a member who pressed stop did the
    // interrupting themselves, and any interruption recorded inside the
    // ~2s stop window (the dying stream's own error path) is that stop's
    // mechanics, not connection trouble worth a banner.
    showInterruptionBanner:
      store._streamInterrupted && busyOf(store) && !store._stopping,
    pendingDecisionGap: store._pendingDecisionGap,
  };
}

// Re-judges the pending-decision gap against the current
// truth: the turn's server-named interrupt ids vs every holder this
// client has — approval cards (hydrate-before-reconcile already ran on
// any REST adoption), elicitation cards, and the execution inbox's
// entries. Runs on every publish so any path that moves cards, entries
// or the turn re-judges; the derivation itself is pure and cheap. The
// quiet→loud grace, the once-per-signature probe, and the loud
// tracking all live in the shared PendingDecisionGapGate (its docblock
// enumerates the transitions); this store's premises for the gate's
// three deps are recorded at the _gapGate field.
function _updatePendingDecisionGap(store: AssistantConversationStore): void {
  if (store._disposed) {
    return;
  }
  // The gap watchdog judges the PAUSE (the queuing class): with a
  // message queued newer than the pause, the newest row reads
  // "queued" and the derivation would go quiet in exactly the
  // missing-card state it exists to alarm on. Falls back to the
  // newest row so the no-pause shapes keep their null verdict.
  const pause = theAnswerablePause(store) ?? store._newestTurn;
  store._gapGate.judge(
    pendingDecisionGapOf(
      pause,
      store._active?.approvalInbox.cards() ?? [],
      store._elicitationsCell.get(),
      store._epoch?.executionInbox.entries() ?? [],
      store._consumedInterrupts.idsOf(pause?.run_id, pause?.awaiting_round),
    ),
  );
}

export function noteInterruptAnswerConsumed(
  store: AssistantConversationStore,
  runId: string,
  interruptId: string,
  round: number,
): void {
  if (store._consumedInterrupts.note(runId, interruptId, round)) {
    publishStore(store);
  }
}

export function composerSnapshotOf(
  store: AssistantConversationStore,
): ComposerContract {
  return {
    busy: busyOf(store),
    pendingSend: store._pendingSend,
    sendMessage: store.sendMessage,
    pendingEcho: store._pendingEcho,
    composerRefocusPending: store._composerRefocusPending,
    markComposerRefocusHandled: store.markComposerRefocusHandled,
    stopping: store._stopping,
    stopTurn: store.stopTurn,
    modelPick: store._modelPick,
    setModelPick: store.setModelPick,
    composerInput: store._composerInput,
    setDraft: store.setComposerDraft,
    setAttachments: store.setComposerAttachments,
    noteComposerFocus: store.noteComposerFocus,
    takeComposerCaretReturn: store.takeComposerCaretReturn,
  };
}

export function busyOf(store: AssistantConversationStore): boolean {
  // The composer lock, Stop button and interruption banner follow the
  // turn record: a parked turn is never busy, whatever a
  // stale thread.busy says — there is no run to stop, and the visitor's
  // next message is the designed withdraw path.
  return (
    ((store._active?.thread.busy ?? false) &&
      store._newestTurn?.status !== "parked") ||
    store._pendingSend
  );
}
function _publishTurnMeta(store: AssistantConversationStore): void {
  const ledger = store._active?.ledger ?? null;
  const version = ledger?.version ?? -1;
  if (
    ledger === store._publishedMetaLedger &&
    version === store._publishedMetaVersion
  ) {
    return;
  }
  store._publishedMetaLedger = ledger;
  store._publishedMetaVersion = version;
  store._turnMetaCell.set(
    ledger !== null ? ledger.metaByMessageId() : new Map(),
  );
}

function _sameConversationSnapshot(
  a: ConversationSnapshot,
  b: ConversationSnapshot,
): boolean {
  return (
    a.active === b.active &&
    a.threads === b.threads &&
    a.historyExpected === b.historyExpected &&
    a.threadOpening === b.threadOpening &&
    a.reconnectNonce === b.reconnectNonce &&
    a.sendError === b.sendError &&
    a.turnFailure === b.turnFailure &&
    a.showInterruptionBanner === b.showInterruptionBanner &&
    // Reference identity is sound: the store keeps the published gap
    // reference-stable while its signature holds.
    a.pendingDecisionGap === b.pendingDecisionGap
  );
}

function _sameComposerSnapshot(
  a: ComposerContract,
  b: ComposerContract,
): boolean {
  return (
    a.busy === b.busy &&
    a.pendingSend === b.pendingSend &&
    a.pendingEcho === b.pendingEcho &&
    a.composerRefocusPending === b.composerRefocusPending &&
    a.stopping === b.stopping &&
    // composerInput is deliberately absent: it is the same cell object
    // on every snapshot — its VALUE moves per keystroke, and only the
    // composer's own useCell subscription pays for that.
    sameModelPick(a.modelPick, b.modelPick)
  );
}
