// The dock's collision awareness: a
// fixed corner perch dropped onto a page that already owns that corner —
// a composer's send button, a copy control — steals the host's clicks.
// The cure is a lift: the widget probes what the page stacks under the
// perch's hit box and raises the dock in fixed steps until nothing
// interactive sits beneath. This module is the pure half — the
// geometry and the verdict — so the decision is exhaustively testable;
// the widget owns the DOM probing (document.elementsFromPoint) and the
// re-measure clocks (resize, scroll, mutations).

export interface ClearancePoint {
  x: number;
  y: number;
}

export interface ClearanceRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The lifts tried, in order — 0 first, so an unobstructed corner never
 *  moves. Steps of roughly a control's height; capped so a page that is
 *  interactive everywhere gets the corner back instead of a perch chasing
 *  clearance up the viewport. */
export const PERCH_LIFT_STEPS_PX: readonly number[] = [0, 56, 112, 168];

/** How far probe points pull in from a rect's edges, so a rounded corner
 *  or a hairline neighbour never reads as an obstruction. */
const PROBE_EDGE_INSET_PX = 3;

/** The corners and center of a rect — five probes decide a rect. */
export function probePointsOf(rect: ClearanceRect): ClearancePoint[] {
  const left = rect.left + PROBE_EDGE_INSET_PX;
  const right = rect.left + rect.width - PROBE_EDGE_INSET_PX;
  const top = rect.top + PROBE_EDGE_INSET_PX;
  const bottom = rect.top + rect.height - PROBE_EDGE_INSET_PX;
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: left, y: bottom },
    { x: right, y: bottom },
    { x: centerX, y: centerY },
  ];
}

export function liftedBy(rect: ClearanceRect, liftPx: number): ClearanceRect {
  return { ...rect, top: rect.top - liftPx };
}

/**
 * The verdict: the smallest lift step at which no probe point over the
 * perch's hit box hits an obstruction. Falls back to 0 — never a partial
 * lift — when every step is obstructed or a step would push the box off
 * the top of the viewport: on a page that gives the corner no clearance
 * anywhere, a perch parked where the user expects it beats one that
 * wandered.
 */
export function firstClearLiftFor(options: {
  /** The perch's hit box at lift 0 (its natural position). */
  rect: ClearanceRect;
  /** Whether the page stacks an interactive obstruction at a viewport
   *  point, with the dock's own elements already excluded by the caller. */
  probe: (point: ClearancePoint) => boolean;
  liftSteps?: readonly number[];
}): number {
  const { rect, probe } = options;
  const liftSteps = options.liftSteps ?? PERCH_LIFT_STEPS_PX;
  for (const lift of liftSteps) {
    const lifted = liftedBy(rect, lift);
    if (lifted.top < 0) {
      break;
    }
    if (!probePointsOf(lifted).some(probe)) {
      return lift;
    }
  }
  return 0;
}

/** What counts as the host's interactive surface under a probe point.
 *  Anything a click would activate; label pulls in its control. */
export const INTERACTIVE_OBSTRUCTION_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "label",
  "select",
  "summary",
  "textarea",
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="textbox"]',
].join(", ");
