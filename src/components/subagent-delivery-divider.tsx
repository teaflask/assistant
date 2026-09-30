"use client";

// A subagent_results_delivered CUSTOM event never becomes a message: it
// is the head of a machine-started delivery run, the answer to "why is
// the assistant talking again". The store-side recorder
// (core/subagent-delivery-anchors) anchors it to the run's first
// message; the row interleave (core/transcript-rows) places this divider
// before that message, and the label names the settled dispatches off
// the anchored payload.

import { activityTitleOf } from "../core/activity-title.js";
import { AgentIdentityMark } from "./agent-identity-mark.js";
import type { DeliveredResult } from "../core/subagent-delivery-anchors.js";

export function deliveryDividerLabelOf(
  results: readonly DeliveredResult[],
): string {
  const failed = results.filter((result) => !result.succeeded).length;
  const succeeded = results.length - failed;
  const first = results.find((result) => result.label !== "")?.label;
  // The title's terminal punctuation is the brief's own delimiter; mid-line
  // it would read "… exports. done", so the subject drops it.
  const subject =
    results.length === 1 && first
      ? `Subagent ${activityTitleOf(first).replace(/[.!?]+$/, "")}`
      : `${String(results.length)} ${results.length === 1 ? "subagent" : "subagents"}`;
  if (failed === 0) {
    return `${subject} done`;
  }
  if (results.length === 1) {
    return `${subject} failed`;
  }
  return `${subject} · ${String(succeeded)} done · ${String(failed)} failed`;
}

export function SubagentDeliveryDivider({
  results,
}: {
  results: readonly DeliveredResult[];
}) {
  return (
    // The completed-background-handoff notice (TVC-132): a trusted
    // system-originated event wears explicit system semantics — role
    // and accessible name — over a compact right-aligned pill that
    // carries the subagent identity mark, so it can never read as
    // assistant prose or a member's message. The visible "System
    // notification" line is aria-hidden: the container's accessible
    // name already says it once. The pill's copy is the client's own
    // read of the typed marker — the dispatch brief compacted through
    // activityTitleOf, the full labels inspectable in the title — and
    // no raw event payload renders.
    <div
      data-tf-system-notice=""
      role="note"
      aria-label="System notification"
      className="tf:flex tf:flex-col tf:items-end tf:gap-1.5 tf:py-3 tf:text-xs tf:text-tf-muted-foreground"
    >
      <span aria-hidden>System notification</span>
      <span
        className="tf:flex tf:max-w-full tf:items-center tf:gap-2 tf:rounded-full tf:bg-tf-muted tf:px-3 tf:py-2"
        title={results.map((result) => result.label).join("; ")}
      >
        <span aria-hidden>
          <AgentIdentityMark register="subagent" />
        </span>
        <span className="tf:min-w-0 tf:truncate">
          {deliveryDividerLabelOf(results)}
        </span>
      </span>
    </div>
  );
}
