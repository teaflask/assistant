// The connection epoch: one epoch per (thread, stream id, reconnect
// nonce, background-attach nonce, resume store) — minting it, retiring
// it, and the durable-turn machinery that rides its publishes (the
// newest-turn note, approval-card reconcile and hydration, execution
// entries, the activity feed). The epoch-confined callbacks keep
// dropping a retired epoch's late writes exactly as the comments below
// rule.

import { APPROVAL_REQUESTED_EVENT_NAME } from "../contract/events.js";
import type { ServingAssistantTurn } from "../contract/threads.js";
import {
  activitySnapshotOf,
  IDLE_ACTIVITY,
  sameActivitySnapshot,
  settledResultOf,
} from "./activity.js";
import type { ApprovalCardModel } from "./approval-inbox.js";
import {
  beginConnectionEpoch,
  markerAnchorsOf,
  type ConnectionEpochDeps,
} from "./connection-epoch.js";
import {
  busyOf,
  noteInterruptAnswerConsumed,
  publishStore,
} from "./conversation-publish.js";
import type { ActiveConversation } from "./conversation-contract.js";
import type { AssistantConversationStore } from "./conversation-store.js";
import {
  coworkerExecutionWorkOf,
  sameCoworkerExecutionWork,
} from "./coworker-execution-work.js";
import {
  elicitationCardsOf,
  sameElicitationCards,
} from "./elicitation-cards.js";
import {
  executionHandlersFor,
  type ExecutionHandler,
} from "./execution-handlers.js";
import type { ExecutionEntryModel } from "./execution-inbox.js";
import { restDisplayAnchorsOf } from "./tool-call-display-anchors.js";
import { toolDenialMarkerOf } from "./tool-denial-anchors.js";
import { approvalCardSchemasOf } from "./tool-schema-anchors.js";

// One epoch per (thread, stream id, reconnect nonce, background-attach
// nonce, resume store): the first three are exactly the old remount
// key, so a send, a retry, a thread switch, or a restart reclaim
// begins a fresh epoch — a fresh agent seeded from the resume store, a
// fresh execution inbox (the approval inbox is thread-lived and rides
// through), a fresh driver. The background-attach nonce
// begins a fresh epoch WITHOUT moving the remount key — see
// the no-remount premise at syncConnection's remint branch.
export function syncEpoch(store: AssistantConversationStore): void {
  const active = store._active;
  if (active === null || store._disposed) {
    retireEpoch(store);
    // No conversation, no cards — guarded so an idle publish loop
    // never re-sets the cell (it notifies on reference change).
    if (store._approvalsCell.get().length > 0) {
      publishApprovalCards(store, []);
    }
    // The coworker rows' work line dies with the conversation too
    // — same guard, same reason.
    if (store._coworkerWorkCell.get().size > 0) {
      store._coworkerWorkCell.set(new Map());
    }
    return;
  }
  const signature = `${active.thread.id}|${active.thread.stream_thread_id}|${String(store._reconnectNonce)}|${String(store._backgroundAttachNonce)}`;
  if (
    store._epoch !== null &&
    store._epochSignature === signature &&
    store._epochResume === active.resume
  ) {
    return;
  }
  retireEpoch(store);
  const epochId = store._nextEpochId;
  store._nextEpochId += 1;
  store._epoch = beginConnectionEpoch(_mintEpochDeps(store, active, epochId));

  store._epochSignature = signature;
  store._epochResume = active.resume;
  store._epochConnectedOnce = false;
  // The pending approval asks are thread-lived: seed the cell
  // from the carried inbox synchronously — the reconnect's replay
  // re-delivers into it idempotently — exactly like the message list
  // seeds from the resume snapshot below, so a remount paints the cards
  // instantly instead of flashing them away mid-decision.
  publishApprovalCards(store, active.approvalInbox.cards());
  store._elicitationErrors.clear();
  store._questionAnswers.clear();
  // questionDrafts is deliberately NOT cleared here: an epoch
  // reset is a transport event — a reconnect, a workflow restart — and
  // the member's half-typed answers must survive it. Draft lifetime is
  // ruled in question-drafts.ts: cleared on present-and-settled
  // evidence (publishExecutionEntries) or a thread switch.
  publishExecutionEntries(store, []);
  // The coworker requests are conversation-lived: the fresh
  // inbox is seeded from the ACTIVE conversation's turns window, the way
  // the approval cards seed from its carried inbox above — a stream reset
  // must not drop an ask nothing on the stream re-delivers, and nothing
  // outliving the conversation may seed an epoch (the send empties the
  // window, a switch or abandon drops it; tests/epoch-seed-census).
  store._epoch.withExecutionInbox((inbox) =>
    inbox.adoptCoworkerRequests(active.coworkerRequestTurns),
  );
  store._messagesCell.set([...store._epoch.agent.messages]);
  store._markerAnchorsCell.set(markerAnchorsOf(active.resume));
  store._connectionCell.set({
    epochId,
    agent: store._epoch.agent,
    threadId: active.thread.id,
    streamThreadId: active.thread.stream_thread_id,
  });
}

// The epoch's ~25-key deps object: every store callback the epoch may
// ring, each publish confined to its own epoch id so a retired epoch's
// late writes drop (the in-flight execution pass runs to completion
// after dispose — at-most-once delivery).
function _mintEpochDeps(
  store: AssistantConversationStore,
  active: ActiveConversation,
  epochId: number,
): ConnectionEpochDeps {
  return {
    epochId,
    session: store.deps.session,
    threadId: active.thread.id,
    streamThreadId: active.thread.stream_thread_id,
    ledger: active.ledger,
    resume: active.resume,
    approvalInbox: active.approvalInbox,
    handlersOf: () => _executionHandlers(store, active.thread.id),
    // Every epoch publish is confined to its own epoch. Recorders
    // unsubscribe on retireEpoch, but the execution driver's in-flight
    // pass runs to completion AFTER dispose (at-most-once delivery), so
    // an epoch swap mid-pass would otherwise let a retired epoch stamp
    // the previous thread's entries onto the now-active thread's shared
    // cells. The id check drops those late writes.
    publishApprovalCards: (cards) => {
      if (store._epoch?.epochId === epochId) {
        publishApprovalCards(store, cards);
      }
    },
    publishExecutionEntries: (entries) => {
      if (store._epoch?.epochId === epochId) {
        publishExecutionEntries(store, entries);
      }
    },
    publishMarkerAnchors: () => {
      if (store._epoch?.epochId === epochId) {
        store._markerAnchorsCell.set(markerAnchorsOf(active.resume));
        // A freshly anchored turn_failed receipt changes what the
        // failure banner should say (bannerFailureSentenceOf yields to
        // the in-transcript record), and the banner rides the
        // conversation snapshot, not the anchors cell.
        publishStore(store);
      }
    },
    publishMessages: (messages) => {
      if (store._epoch?.epochId === epochId) {
        store._messagesCell.set(messages);
      }
    },
    noteInterruptAnswerConsumed: (runId, interruptId, round) => {
      if (store._epoch?.epochId === epochId) {
        noteInterruptAnswerConsumed(store, runId, interruptId, round);
      }
    },
    onStreamError: store.handleStreamError,
    refreshLedger: store.refreshConversation,
    onUserMessageInjected: store.handleUserMessageInjected,
    onRunSettled: store.handleRunSettled,
    onQuietClose: store.handleStreamClosedQuietly,
    onWorkflowRestarted: store.handleWorkflowRestarted,
  };
}

export function retireEpoch(store: AssistantConversationStore): void {
  if (store._epoch === null) {
    return;
  }
  store._epoch.dispose();
  store._epoch = null;
  store._epochSignature = null;
  store._epochResume = null;
  store._connectionCell.set(null);
}

export function noteNewestTurn(
  store: AssistantConversationStore,
  turn: ServingAssistantTurn | null,
  switchedThread = false,
): void {
  if (turn?.id !== store._newestTurn?.id) {
    // A different turn is a different story: the automatic-reconnect
    // budget guards one stuck turn, not the conversation.
    store._automaticReconnects = 0;
  }
  if (switchedThread) {
    // A new thread's activity must not inherit the old thread's last
    // result: settledResultOf only WRITES on a terminal turn, so
    // switching to a still-running thread would otherwise leave the
    // feed pointing at the previous conversation's outcome. Clear
    // first; the line below re-sets it iff the new newest already
    // settled. The answerable-pause snapshot is the old thread's too
    // (the full-detail adopters re-derive it right after this call).
    store._lastResult = null;
    store._awaitingTurn = null;
  }
  store._newestTurn = turn;
  const settled = turn === null ? null : settledResultOf(turn);
  if (settled !== null) {
    store._lastResult = settled;
  }
}

export function publishApprovalCards(
  store: AssistantConversationStore,
  cards: readonly ApprovalCardModel[],
): void {
  // The cards' schemas feed the schema anchors first: every
  // card path — the stream marker, the REST pending_approvals rebuild,
  // the submit republish — funnels through here, so an anchored call's
  // argsSchema is resolvable by the time the paint the cards trigger
  // reads the anchors. The card model is the wire's single narrowed
  // home for these fields; this consumes it rather than re-deriving.
  _recordApprovalCardSchemas(store, cards);
  store._approvalsCell.set(cards);
  _publishCoworkerWork(store);
  // Pending-approval count rides the feed, and a card arriving or
  // closing re-judges the pending-decision gap — the full
  // publish covers both and dedupes unchanged snapshots itself.
  publishStore(store);
}

function _recordApprovalCardSchemas(
  store: AssistantConversationStore,
  cards: readonly ApprovalCardModel[],
): void {
  const active = store._active;
  if (active === null) {
    return;
  }
  const before = active.resume.toolSchemaAnchors;
  for (const card of cards) {
    if (card.toolCallId === null) {
      continue;
    }
    const schemas = approvalCardSchemasOf(card);
    if (schemas !== null) {
      active.resume.recordToolSchemas(card.toolCallId, schemas);
    }
  }
  // The anchors map's first-wins merge makes the re-record of an
  // already-anchored card a no-op — identity is the publish gate, the
  // same pattern as the display hydration below.
  if (active.resume.toolSchemaAnchors !== before) {
    store._markerAnchorsCell.set(markerAnchorsOf(active.resume));
  }
}

// The durable turn record re-judges the pending cards on every REST
// read: the parked flag, a superseded ask, a settled turn —
// all rendered from truth instead of stream inference. Hydration runs
// first: the record's pending_approvals snapshot rebuilds any
// card the stream never delivered, so a pending id can never publish
// as "needs input" with an empty approval surface — then reconcile
// judges the whole set, hydrated cards included. The window is required:
// the settled-runs arm is the close a finished run's cards
// get when the stream's own evidence closed none, and a caller cannot
// leave it out by construction.
export function reconcileApprovals(
  store: AssistantConversationStore,
  turns: readonly ServingAssistantTurn[],
): void {
  const inbox = store._active?.approvalInbox;
  if (inbox === undefined) {
    return;
  }
  // The pause is hydrated from the ANSWERABLE turn, not the newest
  // row (a queued message can sit newer than the pause, and
  // hydrating from the queued row would silently disable the REST
  // card rebuild exactly when the member must answer to unblock the
  // queue). reconcileWithTurn deliberately keeps the NEWEST row (a
  // terminal newest turn removes the conversation's cards), and the
  // settled-runs arm closes any window turn's settled run behind it —
  // a RUN_FINISHED closes nothing, so a card the stream's own evidence
  // did not close dies on this read.
  const pause = theAnswerablePause(store);
  // Display annotations land BEFORE the cards hydrate: a
  // recovered call's annotation must already be resolvable when its
  // ROW first paints, never annotation-less-then-annotated. (The
  // banner reads none of it — the row is the
  // annotation's one rendered home.)
  _hydratePendingApprovalDisplays(store, pause);
  _hydratePendingApprovalAsks(store, pause);
  const hydrated = inbox.hydratePendingApprovals(pause);
  const reconciled = inbox.reconcileWithTurn(store._newestTurn);
  const settled = inbox.reconcileWithTurns(turns);
  if (hydrated || reconciled || settled) {
    publishApprovalCards(store, inbox.cards());
  }
}

/** The turn holding the answerable pause, if any: the newest row when
 *  it pauses itself, else the newest ANSWERABLE row off the last full
 *  refresh (see _awaitingTurn's caveat: partial
 *  adopters don't maintain it, so between a send and the next full
 *  refresh this can lag one snapshot; every consumer is re-run at
 *  adoption, and the inbox's own guards absorb a stale read). */
export function theAnswerablePause(
  store: AssistantConversationStore,
): ServingAssistantTurn | null {
  const newest = store._newestTurn;
  if (
    newest !== null &&
    (newest.status === "awaiting_input" || newest.status === "parked")
  ) {
    return newest;
  }
  return store._awaitingTurn;
}

/**
 * The recovery read's display annotations: the turn
 * record's pending_approval_displays carries the same
 * tool_call_annotated content the stream replays, so a REST-recovered
 * call's ROW resolves its annotation — authored copy, icon, and the
 * view contract's key — even when no stream ever delivered the call.
 * (The approval banner reads no annotations; a call that never
 * reaches the transcript at all has no reader for
 * its hydrated display until it does — kept, because the channel is
 * the row's, not the banner's.) Recorded
 * into the resume store's anchors map, the display's single client
 * home: the merge is the map's own first-wins fold, so a later stream
 * replay of the same markers is a no-op, and the same gate as
 * hydratePendingApprovals keeps a stale read from resurrecting
 * superseded copy (an absent field is an older server, never an
 * unannotated pause).
 */
function _hydratePendingApprovalDisplays(
  store: AssistantConversationStore,
  turn: ServingAssistantTurn | null,
): void {
  const active = store._active;
  if (
    active === null ||
    turn === null ||
    (turn.status !== "awaiting_input" && turn.status !== "parked") ||
    turn.run_id === null
  ) {
    return;
  }
  const anchors = restDisplayAnchorsOf(turn.pending_approval_displays);
  if (anchors.size === 0) {
    return;
  }
  const before = active.resume.toolCallDisplayAnchors;
  for (const [toolCallId, display] of anchors) {
    active.resume.recordToolCallDisplay(toolCallId, display);
  }
  if (active.resume.toolCallDisplayAnchors !== before) {
    store._markerAnchorsCell.set(markerAnchorsOf(active.resume));
  }
}

/**
 * The recovery read's half of the denial join: the paused
 * turn's pending_approvals carry the same interrupt_id → tool_call_id
 * pairs the stream's approval_requested markers do, so a client whose
 * stream never delivered the ask (a REST-recovered pause) still holds
 * it in the ledger's ask map when the resumed stream's
 * approval_resolved lands. Same gate as hydratePendingApprovals — a
 * live pause only; a settled turn's asks arrive by full replay. Asks
 * never publish: only the DENIED half is presentation, and it can only
 * move on the durable approval_resolved marker — never on the submit
 * path's own answer — so live and replay derive the row identically
 * (Law 9).
 */
function _hydratePendingApprovalAsks(
  store: AssistantConversationStore,
  turn: ServingAssistantTurn | null,
): void {
  const active = store._active;
  if (
    active === null ||
    turn === null ||
    (turn.status !== "awaiting_input" && turn.status !== "parked") ||
    turn.run_id === null ||
    !Array.isArray(turn.pending_approvals)
  ) {
    return;
  }
  for (const value of turn.pending_approvals) {
    const marker = toolDenialMarkerOf(APPROVAL_REQUESTED_EVENT_NAME, value);
    if (marker !== null) {
      active.resume.recordToolDenialMarker(marker);
    }
  }
}

export function publishExecutionEntries(
  store: AssistantConversationStore,
  entries: readonly ExecutionEntryModel[],
): void {
  // Entries publish for EVERY execution kind's lifecycle; the cell
  // notifies on reference change, so an unchanged derivation (usually
  // the empty list) must never re-set it — the cell contract's
  // "publishers set only when state actually changed".
  const cards = elicitationCardsOf(
    entries,
    store._elicitationErrors,
    store._questionAnswers,
  );
  if (!sameElicitationCards(cards, store._elicitationsCell.get())) {
    store._elicitationsCell.set(cards);
  }
  _publishCoworkerWork(store);
  // A question set's draft is released only on PRESENT-and-settled
  // evidence — a published card for that very interrupt reading
  // answered or stale — never on absence: the reconnect publishes an
  // empty entry list before the replay refills it.
  for (const card of cards) {
    if (card.status === "answered" || card.status === "stale") {
      store.questionDrafts.clear(card.interruptId);
    }
  }
  // Entries can move without the member-answerable cards moving (a
  // driver-claimed navigate, a reported execution) and each of those
  // re-judges the pending-decision gap.
  publishStore(store);
}

export function publishActivity(store: AssistantConversationStore): void {
  const snapshot =
    store._active === null
      ? IDLE_ACTIVITY
      : activitySnapshotOf({
          busy: busyOf(store),
          newestTurn: store._newestTurn,
          approvalCards: store._approvalsCell.get(),
          pendingDecisionGap: store._pendingDecisionGap,
          lastResult: store._lastResult,
        });
  if (!sameActivitySnapshot(snapshot, store._activityCell.get())) {
    store._activityCell.set(snapshot);
  }
}

function _executionHandlers(
  store: AssistantConversationStore,
  threadId: string,
): ReadonlyMap<string, ExecutionHandler> {
  const capabilities = store.deps.hostCapabilitiesOf();
  return executionHandlersFor(
    capabilities.navigate,
    capabilities.executeActionIntent,
    threadId,
  );
}

// The coworker rows' work line: folded from the LIVE
// epoch's execution entries and the carried approval cards, on either
// publish, with the set-only-on-change discipline. The entries are read
// off the epoch's own inbox, never cached on the store: a fresh epoch's
// first publish then folds nothing of the conversation it replaced.
function _publishCoworkerWork(store: AssistantConversationStore): void {
  const coworkerWork = coworkerExecutionWorkOf(
    store._epoch?.executionInbox.entries() ?? [],
    store._approvalsCell.get(),
  );
  if (!sameCoworkerExecutionWork(coworkerWork, store._coworkerWorkCell.get())) {
    store._coworkerWorkCell.set(coworkerWork);
  }
}
