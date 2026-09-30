import type { ServingAssistantTurn, TurnStatus } from "../contract/threads.js";
import type { ApprovalCardModel } from "./approval-inbox.js";
import type { PendingDecisionGap } from "./pending-decision-gap.js";

// The read-only activity feed: enough for a small surface (a companion,
// a badge, a doorbell) to render presence — is something happening, does
// a human need to act, how did the last thing end — without pulling in
// the transcript. Consumed through useAssistantActivity() in React and
// store.activity.get()/.subscribe() anywhere else.

export interface AssistantActivityResult {
  // The identity a doorbell needs: two consecutive identical failures
  // still differ by the turn that produced them.
  turnId: string;
  status: TurnStatus;
  failureSentence: string | null;
}

export interface AssistantActivitySnapshot {
  busy: boolean;
  newestTurnStatus: TurnStatus | null;
  // The identity a per-event dismissal needs while the turn is still
  // live: the same turn's awaiting_input never re-bubbles once handled,
  // and lastResult only names turns that already settled.
  newestTurnId: string | null;
  // Cards a human can still act on (actionable or mid-submit) — the
  // companion's most important number: a parked turn waiting on an
  // approval is exactly when presence matters most.
  pendingApprovalCount: number;
  // The published pending-decision gap: the server names
  // interrupts this client could build nothing for. Rides the feed so
  // every carrier of "does a human need to act" — the sr-only announcer
  // included — reads the same fact the visible alert does; without it
  // the announcer said "working" over an alert that said "waiting".
  // Reference-stable while its signature holds.
  pendingDecisionGap: PendingDecisionGap | null;
  lastResult: AssistantActivityResult | null;
}

export const IDLE_ACTIVITY: AssistantActivitySnapshot = {
  busy: false,
  newestTurnStatus: null,
  newestTurnId: null,
  pendingApprovalCount: 0,
  pendingDecisionGap: null,
  lastResult: null,
};

export function activitySnapshotOf(args: {
  busy: boolean;
  newestTurn: ServingAssistantTurn | null;
  approvalCards: readonly ApprovalCardModel[];
  pendingDecisionGap: PendingDecisionGap | null;
  lastResult: AssistantActivityResult | null;
}): AssistantActivitySnapshot {
  return {
    busy: args.busy,
    newestTurnStatus: args.newestTurn?.status ?? null,
    newestTurnId: args.newestTurn?.id ?? null,
    pendingApprovalCount: args.approvalCards.filter(_cardAwaitsTheHuman).length,
    pendingDecisionGap: args.pendingDecisionGap,
    lastResult: args.lastResult,
  };
}

/** A settled turn becomes the feed's last result; a live one (queued,
 *  working, awaiting_input, parked) leaves the previous result standing.
 *  Machine turns (kind non-null, the delivery push) report here too,
 *  DELIBERATELY: this feed's contract is "how did the last thing end",
 *  not "did your message fail" — the conversation-level failure banner
 *  (failureSentenceOf) is the surface that hides them. */
export function settledResultOf(
  turn: ServingAssistantTurn,
): AssistantActivityResult | null {
  if (!isTerminalTurnStatus(turn.status)) {
    return null;
  }
  return {
    turnId: turn.id,
    status: turn.status,
    failureSentence: turn.status === "failed" ? (turn.error ?? null) : null,
  };
}

export function sameActivitySnapshot(
  a: AssistantActivitySnapshot,
  b: AssistantActivitySnapshot,
): boolean {
  return (
    a.busy === b.busy &&
    a.newestTurnStatus === b.newestTurnStatus &&
    a.newestTurnId === b.newestTurnId &&
    a.pendingApprovalCount === b.pendingApprovalCount &&
    // Reference identity is sound: the store keeps the published gap
    // reference-stable while its signature holds.
    a.pendingDecisionGap === b.pendingDecisionGap &&
    _sameResult(a.lastResult, b.lastResult)
  );
}

function _sameResult(
  a: AssistantActivityResult | null,
  b: AssistantActivityResult | null,
): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return (
    a.turnId === b.turnId &&
    a.status === b.status &&
    a.failureSentence === b.failureSentence
  );
}

function _cardAwaitsTheHuman(card: ApprovalCardModel): boolean {
  return card.status.kind === "actionable" || card.status.kind === "submitting";
}

/** Terminal turn statuses — the run reached an outcome and will not
 *  produce further work. The completed-episode fold (core/run-folds.ts)
 *  keys on this rather than on "running" (queued/working) so a
 *  HITL pause (awaiting_input, parked) never unifies a turn mid-flight
 *  and then pops its prose back out of the fold on resume. The one
 *  settled-turn predicate in the package: the approval inbox's terminal
 *  reconcile and the execution inbox's ledger's-word close both read it,
 *  so the four words are spelled once against the generated union. */
export function isTerminalTurnStatus(status: TurnStatus): boolean {
  return (
    status === "succeeded" ||
    status === "failed" ||
    status === "superseded" ||
    status === "stopped"
  );
}
