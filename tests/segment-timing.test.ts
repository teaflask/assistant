// The duration laws, pinned: a fold's duration reduces over its MEMBER
// blocks (earliest start, latest settle) — never turn-level evidence —
// and "unknown" vs "sub-second" are different typed states. The run
// fold renders from exactly these reducers.

import { describe, expect, it } from "vitest";

import {
  activeFoldElapsedOf,
  settledFoldDurationOf,
  type BlockTiming,
} from "../src/core/segment-timing";

function timing(
  startedAtMs: number | null,
  settledAtMs: number | null,
): BlockTiming {
  return { startedAtMs, settledAtMs };
}

describe("settledFoldDurationOf", () => {
  it("reduces earliest start to latest settle across the fold's members", () => {
    const duration = settledFoldDurationOf([
      timing(10_000, 12_000),
      timing(11_000, 19_500),
      timing(10_500, 15_000),
    ]);
    expect(duration).toEqual({ kind: "measured", durationMs: 9_500 });
  });

  it("is UNKNOWN with no timestamped member — old histories hide the number", () => {
    expect(settledFoldDurationOf([])).toEqual({ kind: "unknown" });
    expect(settledFoldDurationOf([timing(null, null)])).toEqual({
      kind: "unknown",
    });
  });

  it("measures a coalesced single-instant fold as ZERO, never unknown", () => {
    // One flush can stamp a whole batch with one instant: that is a real
    // sub-second span. The two states the contract holds apart collapse
    // exactly here if this ever regresses — the fold renders measured
    // sub-second as "<1s" and unknown as nothing at all.
    expect(settledFoldDurationOf([timing(10_000, 10_000)])).toEqual({
      kind: "measured",
      durationMs: 0,
    });
  });

  it("measures over the evidence a mixed old/new history has", () => {
    const duration = settledFoldDurationOf([
      timing(null, null),
      timing(10_000, 11_000),
      timing(null, 13_000),
    ]);
    expect(duration).toEqual({ kind: "measured", durationMs: 3_000 });
  });

  it("clamps a repair-skewed inversion to zero rather than a negative span", () => {
    expect(
      settledFoldDurationOf([timing(12_000, 12_000), timing(null, null)]),
    ).toEqual({ kind: "measured", durationMs: 0 });
  });
});

describe("activeFoldElapsedOf", () => {
  it("ticks from the persisted server start to the caller's now", () => {
    const elapsed = activeFoldElapsedOf(
      [timing(10_000, null), timing(11_000, 12_000)],
      25_000,
    );
    expect(elapsed).toEqual({ kind: "measured", durationMs: 15_000 });
  });

  it("is UNKNOWN with no persisted start — never a mount-relative stopwatch", () => {
    expect(activeFoldElapsedOf([timing(null, null)], 25_000)).toEqual({
      kind: "unknown",
    });
  });

  it("clamps a client clock behind the server to zero", () => {
    expect(activeFoldElapsedOf([timing(30_000, null)], 25_000)).toEqual({
      kind: "measured",
      durationMs: 0,
    });
  });
});
