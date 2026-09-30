// The conversation-wide subagent roster: the dispatch ledger's
// rows bucketed for the count pill and its hover roster; the dashboard's
// conversations pill imports it through agent-run/roster.ts. Status never
// enters as a string: callers inject their own tree's predicates.

import { durationLabelOf } from "./segment-timing.js";
import { settledSpanMsOf } from "./subagent-presence.js";

/** The fields both wires share — AgentDispatchResponse and ThreadDispatch
 *  are each a superset of this shape. */
export interface RosterSourceDispatch {
  ordinal: number;
  label: string;
  error: string | null;
  child_session_id: string;
  created_at: string;
  updated_at: string;
}

/** The caller's status vocabulary, injected so no status literal lives in
 *  this module. Completed is derived: neither running nor failed. */
export interface RosterStatusPredicates<D extends RosterSourceDispatch> {
  isRunning: (dispatch: D) => boolean;
  hasFailed: (dispatch: D) => boolean;
}

export interface SubagentRosterEntry {
  /** The RENDER key — one entry per ASK, unique across the surface: a
   *  resume chain shares child_session_id, so a session-keyed list
   *  would render duplicate React keys and count one coworker per ask. */
  key: string;
  /** The drill-in address — the child SESSION the entry's stream and
   *  page live under; a resume chain's entries share it on purpose (one
   *  extended transcript). */
  childSessionId: string;
  ordinal: number;
  /** Never empty: a whitespace-clipped ledger label falls back here, the
   *  same sentence the tree rows use. */
  label: string;
  running: boolean;
  failed: boolean;
  /** The failure's human sentence — null on running and completed rows. */
  note: string | null;
  startedAt: string;
  /** The ledger's settle timestamp (updated_at doubles as it) — null
   *  while the child is still running. */
  settledAt: string | null;
}

/** The roster, bucketed by outcome. The ledger has no cancelled status
 *  (cancellation is a wire fact that never opens a dispatch row), so the
 *  buckets are exactly these three. */
export interface SubagentRoster {
  running: SubagentRosterEntry[];
  completed: SubagentRosterEntry[];
  failed: SubagentRosterEntry[];
  /** Per-ASK row count — what the roster list renders. */
  total: number;
  /** Distinct COWORKERS (distinct childSessionId) — what the pill's
   *  noun counts: a resume chain is several asks of
   *  ONE subagent, and "3 subagents" for one coworker asked three
   *  things is a lie the per-ask rows must not tell. */
  distinctSessions: number;
  /** Coworkers whose NEWEST ask failed — the pill's loss count: the label
   *  speaks coworkers in every arm, so a failed dispatch superseded by a
   *  succeeded resume is not a lost coworker, and a chain that failed twice
   *  is one. The per-ask rows still name each lost ask individually. */
  failedSessions: number;
}

export function rosterEntriesOf<D extends RosterSourceDispatch>(
  dispatches: Iterable<D>,
  predicates: RosterStatusPredicates<D>,
): SubagentRosterEntry[] {
  const entries: SubagentRosterEntry[] = [];
  for (const dispatch of dispatches) {
    const running = predicates.isRunning(dispatch);
    const failed = predicates.hasFailed(dispatch);
    entries.push({
      key: `${dispatch.child_session_id}:${String(dispatch.ordinal)}`,
      childSessionId: dispatch.child_session_id,
      ordinal: dispatch.ordinal,
      label: dispatch.label === "" ? "Delegated task" : dispatch.label,
      running,
      failed,
      // A failed row must carry a reason: error is nullable and the roster
      // has no wire receipt to fall through to — the constant sentence is the
      // guard every neighbouring surface keeps (dispatchRunOutcomeOf).
      note: failed
        ? (dispatch.error ?? "The subagent failed before it could report back.")
        : null,
      startedAt: dispatch.created_at,
      settledAt: running ? null : dispatch.updated_at,
    });
  }
  // Dispatch order, not settle order: the roster reads as the fan-outs the
  // parent authored. One thread has ONE parent run, so ordinal is unique
  // across the roster — the invariant the group rows' byOrdinal join depends
  // on; startedAt leads the sort, ordinal is the deterministic tiebreak.
  entries.sort(
    (a, b) =>
      Date.parse(a.startedAt) - Date.parse(b.startedAt) ||
      a.ordinal - b.ordinal,
  );
  return entries;
}

export function subagentRosterOf(
  entries: readonly SubagentRosterEntry[],
): SubagentRoster {
  // One coworker = one chain: its NEWEST ask (highest ordinal — chains
  // never span parent runs) is its current state, the same
  // newest-supersedes posture every other surface keeps.
  const newestBySession = new Map<string, SubagentRosterEntry>();
  for (const entry of entries) {
    const held = newestBySession.get(entry.childSessionId);
    if (held === undefined || entry.ordinal > held.ordinal) {
      newestBySession.set(entry.childSessionId, entry);
    }
  }
  let failedSessions = 0;
  for (const newest of newestBySession.values()) {
    if (newest.failed) {
      failedSessions += 1;
    }
  }
  const roster: SubagentRoster = {
    running: [],
    completed: [],
    failed: [],
    total: entries.length,
    distinctSessions: newestBySession.size,
    failedSessions,
  };
  for (const entry of entries) {
    if (entry.running) {
      roster.running.push(entry);
    } else if (entry.failed) {
      roster.failed.push(entry);
    } else {
      roster.completed.push(entry);
    }
  }
  return roster;
}

/** The pill's copy: null when the conversation has no subagents, the live
 *  count while any child runs, the total once everything settled — with the
 *  losses named (the group headline's suffix vocabulary): the pill is the
 *  roster's collapsed form, and the one loud fact must survive the collapse. */
export function subagentPillLabelOf(roster: SubagentRoster): string | null {
  if (roster.total === 0) {
    return null;
  }
  // The loss suffix rides BOTH arms (the group headline's rule): a live
  // fan-out that already lost a coworker must not read clean while someone
  // watches the pill. It counts COWORKERS like every other number here — a
  // coworker is lost when its NEWEST ask failed, recovered by a later resume.
  const failedSuffix =
    roster.failedSessions > 0
      ? ` · ${String(roster.failedSessions)} failed`
      : "";
  if (roster.running.length > 0) {
    // Per-ask is per-coworker here: one chain holds at most one live
    // row (the one-live-run law), so running.length counts coworkers.
    return `${String(roster.running.length)} running${failedSuffix}`;
  }
  // The noun counts COWORKERS, never asks: a resumed
  // child is one subagent asked again, and the pill's word must mean
  // what it says even while the roster honestly lists every ask.
  const noun = roster.distinctSessions === 1 ? "subagent" : "subagents";
  return `${String(roster.distinctSessions)} ${noun}${failedSuffix}`;
}

/** A settled row's duration in the house ladder (segment-timing's
 *  durationLabelOf: "<1s" floor, "0s" unrenderable) — null while running (a
 *  live clock is the dashboard's ElapsedTime concern) and on bad timestamps. */
export function settledDurationLabelOf(
  startedAt: string,
  settledAt: string | null,
): string | null {
  const durationMs = settledSpanMsOf(startedAt, settledAt);
  if (durationMs === null) {
    return null;
  }
  return durationLabelOf(durationMs);
}
