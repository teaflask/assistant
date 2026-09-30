/**
 * The dock's collision verdict (core/perch-clearance): the smallest lift
 * step that takes the perch's hit box off the host's own
 * controls — 0 on a clear corner, never a partial lift, and back to 0
 * (parked, predictable) when no step clears or a step would leave the
 * viewport.
 */
import { describe, expect, it } from "vitest";

import {
  firstClearLiftFor,
  liftedBy,
  PERCH_LIFT_STEPS_PX,
  probePointsOf,
  type ClearancePoint,
  type ClearanceRect,
} from "../src/core/perch-clearance";

const PERCH: ClearanceRect = { left: 1360, top: 800, width: 56, height: 64 };

/** A probe that reports an obstruction inside the given band of natural
 *  viewport y-coordinates — the shape of a composer row pinned to the
 *  bottom of the screen. */
function obstructionBetween(
  yTop: number,
  yBottom: number,
): (point: ClearancePoint) => boolean {
  return (point) => point.y >= yTop && point.y <= yBottom;
}

describe("probePointsOf", () => {
  it("samples the four inset corners and the center", () => {
    const points = probePointsOf(PERCH);

    expect(points).toHaveLength(5);
    expect(points).toContainEqual({ x: 1363, y: 803 });
    expect(points).toContainEqual({ x: 1413, y: 861 });
    expect(points).toContainEqual({ x: 1388, y: 832 });
  });
});

describe("firstClearLiftFor", () => {
  it("a clear corner never moves", () => {
    const lift = firstClearLiftFor({
      rect: PERCH,
      probe: () => false,
    });

    expect(lift).toBe(0);
  });

  it("lifts by the smallest step that clears a bottom-pinned control", () => {
    // A composer row occupying the perch's band: the first step that
    // moves the whole rect above it wins.
    const lift = firstClearLiftFor({
      rect: PERCH,
      probe: obstructionBetween(790, 870),
    });

    expect(lift).toBe(112);
  });

  it("gives the corner back when no step clears", () => {
    const lift = firstClearLiftFor({
      rect: PERCH,
      probe: () => true,
    });

    expect(lift).toBe(0);
  });

  it("stops before lifting a rect off the top of the viewport", () => {
    const nearTheTop: ClearanceRect = {
      left: 300,
      top: 40,
      width: 56,
      height: 64,
    };
    const lift = firstClearLiftFor({
      rect: nearTheTop,
      probe: obstructionBetween(0, 400),
    });

    expect(lift).toBe(0);
  });

  it("tries 0 first and steps upward", () => {
    expect(PERCH_LIFT_STEPS_PX[0]).toBe(0);
    expect([...PERCH_LIFT_STEPS_PX]).toEqual(
      [...PERCH_LIFT_STEPS_PX].sort((a, b) => a - b),
    );
  });
});

describe("liftedBy", () => {
  it("moves a rect up without touching its footprint", () => {
    const lifted = liftedBy(PERCH, 56);

    expect(lifted).toEqual({ ...PERCH, top: PERCH.top - 56 });
  });
});
