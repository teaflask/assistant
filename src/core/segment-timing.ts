// The duration contract, pure of React and of the wire. Two laws:
// a fold's duration reduces over its MEMBER blocks' emit-side server
// timestamps — earliest start, latest settle — never turn-level evidence;
// and "unknown" and "sub-second" are DIFFERENT states held apart by type, so
// no consumer renders "Worked for 0s" (docs/transcript-rows-and-folds.md).

/** One transcript block's observed server timing: the earliest and latest
 *  emit-side timestamp seen for its id. Either half may be null — old
 *  histories carry no timestamps, and an open block has no settle yet. */
export interface BlockTiming {
  startedAtMs: number | null;
  settledAtMs: number | null;
}

/** The typed unknown-vs-measured distinction: `measured` under 1000 ms is
 *  the sub-second case (render "<1s", never "0s"); `unknown` means the
 *  evidence does not exist and the UI hides the duration entirely. */
export type SegmentDuration =
  { kind: "unknown" } | { kind: "measured"; durationMs: number };

const UNKNOWN: SegmentDuration = { kind: "unknown" };

/** The settled fold reduction: earliest observed start to latest observed
 *  settle across the members. Members without evidence contribute nothing;
 *  a fold with no timestamped member is unknown. A settle counts as a start
 *  bound too — a block observed only at its settle is still inside. */
export function settledFoldDurationOf(
  members: readonly BlockTiming[],
): SegmentDuration {
  let earliest: number | null = null;
  let latest: number | null = null;
  for (const member of members) {
    for (const observed of [member.startedAtMs, member.settledAtMs]) {
      if (observed === null) {
        continue;
      }
      earliest = earliest === null ? observed : Math.min(earliest, observed);
      latest = latest === null ? observed : Math.max(latest, observed);
    }
  }
  if (earliest === null || latest === null) {
    return UNKNOWN;
  }
  // A single flush can stamp a whole coalesced batch with one instant:
  // that is a MEASURED zero — a real sub-second span — never unknown.
  return { kind: "measured", durationMs: Math.max(0, latest - earliest) };
}

/** The house duration vocabulary for every duration surface: "12s",
 *  "3m 04s", "1h 07m", with the sub-second floor "<1s" — "0s" is not in the
 *  register. The subagent roster's settledDurationLabelOf delegates here. */
export function durationLabelOf(durationMs: number): string {
  if (durationMs < 1_000) {
    return "<1s";
  }
  const totalSeconds = Math.floor(durationMs / 1_000);
  if (totalSeconds < 60) {
    return `${String(totalSeconds)}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${String(totalMinutes)}m ${String(totalSeconds % 60).padStart(2, "0")}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  return `${String(hours)}h ${String(totalMinutes % 60).padStart(2, "0")}m`;
}

/** The active fold's elapsed time: the persisted server start to the
 *  caller's "now"; with no persisted start there is none — unknown, never a
 *  mount-relative stopwatch. CAUTION: a client `Date.now()` as `nowMs` is a
 *  cross-clock-domain subtraction carrying the device's full offset from the
 *  server. No widget chrome consumes this; reach for it only with
 *  a server-derived `nowMs`, or where the surface accepts the skew. */
export function activeFoldElapsedOf(
  members: readonly BlockTiming[],
  nowMs: number,
): SegmentDuration {
  let earliest: number | null = null;
  for (const member of members) {
    for (const observed of [member.startedAtMs, member.settledAtMs]) {
      if (observed !== null) {
        earliest = earliest === null ? observed : Math.min(earliest, observed);
      }
    }
  }
  if (earliest === null) {
    return UNKNOWN;
  }
  return { kind: "measured", durationMs: Math.max(0, nowMs - earliest) };
}
