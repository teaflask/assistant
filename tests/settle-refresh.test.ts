/**
 * The settle re-read's debounce (single-sourced when the playground fork
 * collapsed): a burst of settled runs coalesces into one re-read once the
 * burst goes quiet; dispose cancels a pending re-read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SETTLE_REFRESH_DELAY_MS,
  SettleRefreshScheduler,
} from "../src/core/settle-refresh";

describe("SettleRefreshScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a burst of settles coalesces into one re-read after the burst goes quiet", () => {
    let settles = 0;
    const scheduler = new SettleRefreshScheduler(() => {
      settles += 1;
    });
    scheduler.noteRunSettled();
    vi.advanceTimersByTime(SETTLE_REFRESH_DELAY_MS - 1);
    scheduler.noteRunSettled();
    vi.advanceTimersByTime(SETTLE_REFRESH_DELAY_MS - 1);
    expect(settles).toBe(0);
    vi.advanceTimersByTime(1);
    expect(settles).toBe(1);
    // Quiet afterwards: no trailing re-read.
    vi.advanceTimersByTime(SETTLE_REFRESH_DELAY_MS * 3);
    expect(settles).toBe(1);
  });

  it("a later settle earns its own re-read", () => {
    let settles = 0;
    const scheduler = new SettleRefreshScheduler(() => {
      settles += 1;
    });
    scheduler.noteRunSettled();
    vi.advanceTimersByTime(SETTLE_REFRESH_DELAY_MS);
    scheduler.noteRunSettled();
    vi.advanceTimersByTime(SETTLE_REFRESH_DELAY_MS);
    expect(settles).toBe(2);
  });

  it("dispose cancels a pending re-read", () => {
    let settles = 0;
    const scheduler = new SettleRefreshScheduler(() => {
      settles += 1;
    });
    scheduler.noteRunSettled();
    scheduler.dispose();
    vi.advanceTimersByTime(SETTLE_REFRESH_DELAY_MS * 2);
    expect(settles).toBe(0);
  });
});
