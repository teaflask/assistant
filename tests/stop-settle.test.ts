/**
 * The stop's bounded fallback probe (single-sourced when the playground
 * fork collapsed): one re-read per beat until the settle shows up or the
 * budget runs out; the verdict tells the caller whether to release its
 * "Stopping…" lock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SETTLE_REFRESH_DELAY_MS } from "../src/core/settle-refresh";
import { probeStopSettle, STOP_SETTLE_PROBES } from "../src/core/stop-settle";

describe("probeStopSettle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a settle that already landed probes nothing", async () => {
    let refreshes = 0;
    const verdict = probeStopSettle({
      refresh: () => {
        refreshes += 1;
        return Promise.resolve();
      },
      stillAwaitsSettle: () => false,
    });
    await expect(verdict).resolves.toBe(false);
    expect(refreshes).toBe(0);
  });

  it("a settle landing mid-probe ends the loop early, not exhausted", async () => {
    let refreshes = 0;
    let settled = false;
    const verdict = probeStopSettle({
      refresh: () => {
        refreshes += 1;
        settled = refreshes >= 2;
        return Promise.resolve();
      },
      stillAwaitsSettle: () => !settled,
    });
    await vi.advanceTimersByTimeAsync(SETTLE_REFRESH_DELAY_MS * 4);
    await expect(verdict).resolves.toBe(false);
    expect(refreshes).toBe(2);
  });

  it("an exhausted budget reports true after exactly STOP_SETTLE_PROBES beats and re-reads", async () => {
    let refreshes = 0;
    const verdict = probeStopSettle({
      refresh: () => {
        refreshes += 1;
        return Promise.resolve();
      },
      stillAwaitsSettle: () => true,
    });
    await vi.advanceTimersByTimeAsync(
      SETTLE_REFRESH_DELAY_MS * (STOP_SETTLE_PROBES + 2),
    );
    await expect(verdict).resolves.toBe(true);
    expect(refreshes).toBe(STOP_SETTLE_PROBES);
  });
});
