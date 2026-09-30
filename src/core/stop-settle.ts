import { SETTLE_REFRESH_DELAY_MS } from "./settle-refresh.js";

// How many SETTLE_REFRESH_DELAY_MS beats a stop's fallback re-read keeps
// probing for the ~2s stop exit before releasing the "Stopping…" lock.
// Its own constant on purpose: the sibling probe budgets (restart
// reclaim, delivery claim) answer different questions and may be retuned
// without silently changing how long a stop narrates.
export const STOP_SETTLE_PROBES = 10;

/**
 * The stop's bounded fallback probe: the workflow's stop exit lands
 * turn_stopped plus a quiet RUN_FINISHED on the stream (~2s), which the
 * ordinary settle machinery adopts — this loop is the dead-stream corner's
 * fallback, one re-read per beat until the settle shows up or the budget
 * runs out. `stillAwaitsSettle` is read fresh behind every await (thread
 * switches and the settle machinery move the owner's fields while the
 * probe sleeps). Returns true when the budget is exhausted with the stop
 * still unsettled — the caller releases its "Stopping…" lock; false when
 * the settle landed (or the stop lost its thread) mid-probe.
 */
export async function probeStopSettle(deps: {
  refresh: () => Promise<void>;
  stillAwaitsSettle: () => boolean;
}): Promise<boolean> {
  if (!deps.stillAwaitsSettle()) {
    return false;
  }
  for (let probe = 0; probe < STOP_SETTLE_PROBES; probe += 1) {
    await new Promise((resolve) =>
      setTimeout(resolve, SETTLE_REFRESH_DELAY_MS),
    );
    if (!deps.stillAwaitsSettle()) {
      return false;
    }
    await deps.refresh();
  }
  return deps.stillAwaitsSettle();
}
