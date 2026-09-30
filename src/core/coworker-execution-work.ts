// What the member's browser is doing for each coworker, and
// what the member owes it: the execution inbox's coworker
// entries and the approval inbox's coworker cards folded to one line per
// ordinal, for the delegation group row — the coworker's own line names
// the asker, so a request the browser performs or a decision the member
// owes on a coworker's behalf never reads as the assistant's. Pure over
// the published entries and cards.

import type { ApprovalCardModel } from "./approval-inbox.js";
import type { ExecutionEntryModel } from "./execution-inbox.js";

export interface CoworkerExecutionWork {
  /** Null when the approval stopped no tool call — the card's tool fields
   *  are best-effort on the contract; an execution always names its tool. */
  toolName: string | null;
  status: "pending" | "executing" | "reported" | "stale";
  /** The reported outcome (a decision's approved); null until reported. */
  ok: boolean | null;
  /** browser: the member's browser performs it; approval: the member
   *  decides it. */
  via: "browser" | "approval";
}

// Live work first, then the open ask, then what was reported, then stale.
const RANK: readonly CoworkerExecutionWork["status"][] = [
  "executing",
  "pending",
  "reported",
  "stale",
];

/** ordinal → the entry or card most worth showing (RANK's order; an open
 *  approval outranks an open execution of the same rank — the member is
 *  the one who must act). */
export function coworkerExecutionWorkOf(
  entries: readonly ExecutionEntryModel[],
  cards: readonly ApprovalCardModel[] = [],
): ReadonlyMap<number, CoworkerExecutionWork> {
  const byOrdinal = new Map<number, CoworkerExecutionWork>();
  const consider = (ordinal: number, work: CoworkerExecutionWork) => {
    const held = byOrdinal.get(ordinal);
    if (
      held === undefined ||
      RANK.indexOf(work.status) < RANK.indexOf(held.status)
    ) {
      byOrdinal.set(ordinal, work);
    }
  };
  for (const card of cards) {
    if (card.asker.kind !== "coworker") {
      continue;
    }
    consider(card.asker.ordinal, {
      toolName: card.toolName,
      status: _approvalWorkStatusOf(card),
      ok: card.status.kind === "answered" ? card.status.approved : null,
      via: "approval",
    });
  }
  for (const entry of entries) {
    if (entry.asker.kind !== "coworker") {
      continue;
    }
    consider(entry.asker.ordinal, {
      toolName: entry.toolName,
      status: entry.status.kind,
      ok: entry.status.kind === "reported" ? entry.status.ok : null,
      via: "browser",
    });
  }
  return byOrdinal;
}

function _approvalWorkStatusOf(
  card: ApprovalCardModel,
): CoworkerExecutionWork["status"] {
  switch (card.status.kind) {
    case "actionable":
    case "submitting":
      return "pending";
    case "answered":
      return "reported";
    case "stale":
      return "stale";
  }
}

/** Equality by content — both maps fold entries in publish order, so the
 *  serialized pairs compare directly. */
export function sameCoworkerExecutionWork(
  a: ReadonlyMap<number, CoworkerExecutionWork>,
  b: ReadonlyMap<number, CoworkerExecutionWork>,
): boolean {
  return JSON.stringify([...a]) === JSON.stringify([...b]);
}
