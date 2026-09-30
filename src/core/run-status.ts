// The status announcer's ladder, pure of
// React and of the wire. Chrome does not narrate run state visibly —
// the actionable thing is its own signal — so this ladder serves only
// the sr-only live region. Honesty rule: the wire's awaiting_input and
// parked statuses record lifecycle, not who the run waits on (a subagent
// park ships the same "parked" as a HITL pause), so "waiting" is claimed
// only while an actionable decision actually exists; a pause with no
// pending decision is the machine's time (delegated children are
// running, or the execution driver is answering) and reads "working".
// Terminal states map to null: transient status disappears at settle,
// and the durable "Worked for …" story belongs to the settled fold
// headline (core/run-folds.ts).

import type { TurnStatus } from "../contract/threads.js";

/** The two states the announcer can honestly claim. */
export type AnnouncedStatus = "working" | "waiting";

/**
 * Map the newest turn's wire status, plus the one fact the status enum
 * cannot carry — whether a member-actionable decision is live — onto the
 * announcer's register. `decisionsPending` comes from the decision
 * surfaces themselves (the cards), never inferred from what rendered.
 */
export function announcedStatusOf(
  status: TurnStatus | null,
  decisionsPending: boolean,
): AnnouncedStatus | null {
  if (status === "queued" || status === "working") {
    return "working";
  }
  if (status === "awaiting_input" || status === "parked") {
    return decisionsPending ? "waiting" : "working";
  }
  return null;
}

/**
 * The VISIBLE liveness register: whether the run reads as the
 * machine's time — the fold headline's "Working…", the tool rows'
 * running-vs-pending projection, the jump affordance's live treatment.
 * One function with the announcer, on purpose: the fold used to derive
 * liveness from the REST-only queued/working status (never advanced by
 * a stream event), so an approved live pause read "Worked for <1s" above
 * a running tool row while the sr-only region honestly said "working".
 * Parity is now by construction — the two registers cannot disagree.
 */
export function runReadsAsWorking(
  status: TurnStatus | null,
  decisionsPending: boolean,
): boolean {
  return announcedStatusOf(status, decisionsPending) === "working";
}
