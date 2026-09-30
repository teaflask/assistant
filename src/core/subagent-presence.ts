// Subagent presence derivations: the pure reads behind the
// agent-identity variants, the inline current-work line and the roster's
// settled-duration copy. Kept OUTSIDE subagent-roster.ts — these pull in
// run-folds and tool-call-display; the roster imports from here, never back.

import { settledFoldHeadlineOf } from "./run-folds.js";
import type { ToolCallViewModel } from "./tool-call-display.js";
import type { TranscriptRow } from "./transcript-rows.js";

/** The deterministic per-coworker palette index (law 10): distinct children
 *  wear distinct colors, and the SAME child keeps the SAME color across the
 *  inline group, the roster, the child transcript, a reconnect and a full
 *  replay. Replay-stable by construction: coworkers rank by their FIRST
 *  ask's ordinal — a durable wire fact — so arrival and settle order can
 *  never permute it, and a resume chain keeps one index. 1-based. */
export function coworkerIndicesOf(
  dispatches: Iterable<{ ordinal: number; child_session_id: string }>,
): ReadonlyMap<string, number> {
  const firstOrdinalBySession = new Map<string, number>();
  for (const dispatch of dispatches) {
    const held = firstOrdinalBySession.get(dispatch.child_session_id);
    if (held === undefined || dispatch.ordinal < held) {
      firstOrdinalBySession.set(dispatch.child_session_id, dispatch.ordinal);
    }
  }
  const ranked = [...firstOrdinalBySession.entries()].sort(
    (a, b) => a[1] - b[1],
  );
  const indices = new Map<string, number>();
  ranked.forEach(([childSessionId], position) => {
    indices.set(childSessionId, position + 1);
  });
  return indices;
}

/** A child transcript's newest LIVE tool call, as the presenter's view shape
 *  — the evidence behind the inline current-work line (TVC-072). Rows sit in
 *  TOOL_CALL_START order while results land in COMPLETION order, and every
 *  result-less call is input-available while the run streams (bar the
 *  retry-severed), so several live calls at once are normal: the
 *  scan walks past settled rows to the newest LIVE one, null when none is.
 *  Only `input-available` counts — `input-streaming` is never live here. */
export function newestToolCallViewOf(
  rows: readonly TranscriptRow[],
): ToolCallViewModel | null {
  for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex -= 1) {
    const row = rows[rowIndex];
    if (row.kind === "tool-call") {
      const view = _liveViewOf(row);
      if (view !== null) {
        return view;
      }
    }
  }
  return null;
}

/** Whether two published live views carry the same current-work EVIDENCE —
 *  the fields the running-arm headline reads: the model's `caption`, else
 *  the authored `progressText` when the wire annotated the call, else the
 *  tool name. The publish path
 *  may treat equal-evidence views as one fact; a consumer reading payload
 *  fields off the map must extend this comparison first. */
export function sameCurrentWorkView(
  a: ToolCallViewModel,
  b: ToolCallViewModel,
): boolean {
  return (
    a.toolName === b.toolName &&
    a.state === b.state &&
    a.display?.caption === b.display?.caption &&
    a.display?.progressText === b.display?.progressText
  );
}

function _liveViewOf(row: {
  toolName: string;
  state: ToolCallViewModel["state"];
  argsText: string;
  errorText?: string;
  display?: ToolCallViewModel["display"];
}): ToolCallViewModel | null {
  if (row.state !== "input-available") {
    return null;
  }
  // The label-bearing fields only: currentWorkLabel derives from the
  // headline ladder (display text → humanized tool name), never from the
  // payload panes, so output stays off this narrow view.
  return {
    toolName: row.toolName,
    state: row.state,
    input: row.argsText,
    errorText: row.errorText,
    display: row.display,
  };
}

/** A settled dispatch's span in milliseconds — the ONE timestamp read behind
 *  both duration registers: null while the child runs and on unparseable
 *  timestamps (hidden, never invented); clock skew clamps to a measured
 *  zero, which the ladder renders "<1s" (TVC-073). */
export function settledSpanMsOf(
  startedAt: string,
  settledAt: string | null,
): number | null {
  if (settledAt === null) {
    return null;
  }
  const started = new Date(startedAt).getTime();
  const ended = new Date(settledAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(ended)) {
    return null;
  }
  return Math.max(0, ended - started);
}

/** A settled dispatch's duration in the settled-fold register (law 2):
 *  "Worked for 12s" / "Worked for <1s" — sentence AND ladder come from
 *  settledFoldHeadlineOf, so "Worked for 0s" is unrenderable (TVC-073).
 *  Null while the child runs and on unparseable timestamps — never invents. */
export function settledWorkedLabelOf(
  startedAt: string,
  settledAt: string | null,
): string | null {
  const durationMs = settledSpanMsOf(startedAt, settledAt);
  if (durationMs === null) {
    return null;
  }
  return settledFoldHeadlineOf({ kind: "measured", durationMs });
}
