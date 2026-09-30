"use client";

import { announcedStatusOf } from "../core/run-status.js";
import type { TurnStatus } from "../contract/threads.js";

// The transcript's status live region. The conversation chrome makes no
// visible run-state claims — the shelf's status line was deleted (its
// work-in-progress story belongs to the subagent pill, the fold's own
// "Working…" content headline, and the Stop control; its waiting story
// belongs to the decision surface itself) — but a screen reader still
// needs the transitions the visuals no longer spell out. Rules carried
// over from the line it replaces:
//
// - Mounted UNCONDITIONALLY (an empty sr-only span while idle): screen
//   readers announce MUTATIONS of an existing live region, and generally
//   skip a node that arrives already carrying role="status" and its
//   text — so the element must pre-exist every phrase change. sr-only is
//   absolutely positioned, so it costs the region no layout height, and
//   it lives OUTSIDE the shelf's slots so a permanent occupant cannot
//   defeat their :empty collapse.
// - Throttled by construction: the phrase changes only on status-class
//   transitions (idle ↔ working ↔ waiting), never per streamed token and
//   never per elapsed second.
// - Honest about who is waited on: "Waiting for your input" is claimed
//   only while an actionable decision surface exists — a pause with no
//   pending decision (a subagent park, the execution driver's window)
//   announces the machine's time, "The assistant is working".
export function RunStatusAnnouncer({
  status,
  decisionsPending,
}: {
  status: TurnStatus | null;
  /** True while a member-actionable decision is live (the suspension
   *  slot's own predicates — approvals awaiting the member, questions
   *  still collecting). Never inferred from what rendered. */
  decisionsPending: boolean;
}) {
  const state = announcedStatusOf(status, decisionsPending);
  return (
    <span data-tf-status-announcer="" role="status" className="tf:sr-only">
      {state === "waiting"
        ? "Waiting for your input"
        : state === null
          ? ""
          : "The assistant is working"}
    </span>
  );
}
