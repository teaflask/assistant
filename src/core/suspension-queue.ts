// The suspension slot's queue, pure of React: which decisions
// are suspended on the member, in what order. A decision — an approval or
// an ask_user question — is IN the queue exactly while it is actionable or
// its submit is in flight; answered, stale and withdrawn ones never enter
// (the transcript's quiet settled lines went with the meta-receipt rows;
// the card footer and the row's state pill are the settled record).

import type { ApprovalCardModel } from "./approval-inbox.js";
import type { ElicitationCardModel } from "./elicitation-cards.js";

export type PendingDecision =
  | { kind: "approval"; card: ApprovalCardModel }
  | { kind: "elicitation"; card: ElicitationCardModel };

/** The queue identity of one decision — interrupt ids are the contract's
 *  opaque per-pause keys, unique across both families on the wire; the
 *  kind prefix keeps the key total even against a degenerate stream. */
export function decisionKeyOf(decision: PendingDecision): string {
  return `${decision.kind}:${decision.card.interruptId}`;
}

// THE pending-decision predicate — the one spelling of which card statuses
// count as "still waiting on the human", per family. Three consumers are
// load-bearing in tandem: the row's "Needs input" pill, this queue, and
// the FOLD's default openness (_groupAwaitsDecision, activity-rail.tsx) —
// a fold holds itself open while a member awaits the decision and releases
// when it settles. The ROW's placement hold is deliberately not a consumer:
// it ends with the TURN, so it keys on the durable decision
// anchor (the row's decisionBearing derivation, tool-call-rows.tsx), never
// awaiting.

export function approvalAwaitsMember(card: ApprovalCardModel): boolean {
  return card.status.kind === "actionable" || card.status.kind === "submitting";
}

export function elicitationAwaitsMember(card: ElicitationCardModel): boolean {
  return card.status === "actionable" || card.status === "submitting";
}

/**
 * The deterministic queue: ordered by where each decision's operation
 * arose in the transcript (the anchoring call's row index; orphans —
 * decisions whose call never streamed — go last), then approvals before
 * questions on an exact tie, then each family's own arrival order (the
 * inboxes preserve stream order, and the sort is stable over it).
 */
export function suspensionQueueOf(
  approvals: readonly ApprovalCardModel[],
  elicitations: readonly ElicitationCardModel[],
  rowIndexByToolCallId: ReadonlyMap<string, number>,
): PendingDecision[] {
  const pending: PendingDecision[] = [
    ...approvals
      .filter(approvalAwaitsMember)
      .map((card): PendingDecision => ({ kind: "approval", card })),
    ...elicitations
      .filter(elicitationAwaitsMember)
      .map((card): PendingDecision => ({ kind: "elicitation", card })),
  ];
  return pending
    .map((decision, arrival) => ({ decision, arrival }))
    .sort((a, b) => {
      const rowA = _rowIndexOf(a.decision, rowIndexByToolCallId);
      const rowB = _rowIndexOf(b.decision, rowIndexByToolCallId);
      if (rowA !== rowB) {
        return rowA - rowB;
      }
      if (a.decision.kind !== b.decision.kind) {
        return a.decision.kind === "approval" ? -1 : 1;
      }
      return a.arrival - b.arrival;
    })
    .map((entry) => entry.decision);
}

/** The pager cursor, clamped into the live queue: resolving the current
 *  decision keeps the position, so the next decision becomes current;
 *  a shrunken queue never strands the cursor past its end. */
export function clampedCursorOf(cursor: number, queueLength: number): number {
  if (queueLength <= 0) {
    return 0;
  }
  return Math.min(Math.max(cursor, 0), queueLength - 1);
}

function _rowIndexOf(
  decision: PendingDecision,
  rowIndexByToolCallId: ReadonlyMap<string, number>,
): number {
  const toolCallId = decision.card.toolCallId;
  if (toolCallId === null) {
    return Number.POSITIVE_INFINITY;
  }
  return rowIndexByToolCallId.get(toolCallId) ?? Number.POSITIVE_INFINITY;
}
