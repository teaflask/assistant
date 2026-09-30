"use client";

import { useEffect, type RefObject } from "react";

import {
  firstClearLiftFor,
  INTERACTIVE_OBSTRUCTION_SELECTOR,
  type ClearancePoint,
  type ClearanceRect,
} from "../core/perch-clearance.js";

/**
 * Collision awareness for the fixed corner perch: a page that already
 * owns the corner — a composer's send button, a copy control — must keep
 * its clicks. The hook probes what the page stacks beneath the perch's
 * hit box (document.elementsFromPoint sees through the top layer) and
 * lifts the dock by the smallest clear step (core/perch-clearance owns
 * the verdict). Re-measured on resize, any scroll, and DOM mutations —
 * route swaps included — all coalesced to one measurement per frame.
 * Browsers without elementsFromPoint keep the unlifted corner; the
 * transparent dock itself never obstructs anything (pointer-events:
 * none).
 */
// How long the settle fallback waits out the dock's 180ms bottom glide
// when transitionend cannot fire, with room for a busy frame.
const LIFT_SETTLE_FALLBACK_MS = 400;

// When the dock lives inside a shadow root (the script-tag custom
// element), document.elementsFromPoint retargets in-shadow hits to the
// shadow host — an element the dock neither contains nor shares a tree
// with, so the self-exclusion checks below can't recognize it and the
// dock would read itself as an obstruction.
function _shadowHostChainOf(node: Node): readonly Element[] {
  const hosts: Element[] = [];
  let root = node.getRootNode();
  while (root instanceof ShadowRoot) {
    hosts.push(root.host);
    root = root.host.getRootNode();
  }
  return hosts;
}

export function usePerchClearance(
  dockRef: RefObject<HTMLDivElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    const dock = dockRef.current;
    if (!active || dock === null) {
      return;
    }
    return _watchPerchClearance(dock);
  }, [dockRef, active]);
}

/** Whether the PAGE stacks an interactive control under a point: the
 *  dock's own elements, its shadow hosts and every other assistant
 *  surface are never obstructions. */
function _hostObstructionProbeFor(
  dock: HTMLDivElement,
): (point: ClearancePoint) => boolean {
  const doc = dock.ownerDocument;
  const shadowHostsOfDock = _shadowHostChainOf(dock);
  return (point) =>
    doc
      .elementsFromPoint(point.x, point.y)
      .some(
        (element) =>
          !dock.contains(element) &&
          !shadowHostsOfDock.includes(element) &&
          element.closest("[data-tf-assistant]") === null &&
          element.closest(INTERACTIVE_OBSTRUCTION_SELECTOR) !== null,
      );
}

// The dock's one click target: the mark's hit box.
// The rect is re-based to lift 0 (the natural corner) so the verdict is
// absolute, not relative to wherever the dock sits right now — valid
// because a settled dock sits exactly at appliedLift. Null while the
// box has no size (unmounted, or a dock the browser never showed).
function _hitBoxRectOf(
  dock: HTMLDivElement,
  appliedLift: number,
): ClearanceRect | null {
  const body = dock.querySelector<HTMLElement>("[data-tf-companion-body]");
  if (body === null) {
    return null;
  }
  const rect = body.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return null;
  }
  return {
    left: rect.left,
    top: rect.top + appliedLift,
    width: rect.width,
    height: rect.height,
  };
}

/** Measures, lifts and re-measures the dock for as long as it is shown;
 *  returns the teardown. */
function _watchPerchClearance(dock: HTMLDivElement): (() => void) | undefined {
  const doc = dock.ownerDocument;
  if (typeof doc.elementsFromPoint !== "function") {
    return;
  }
  const view = doc.defaultView ?? window;

  let frame: number | null = null;
  let appliedLift = 0;
  // A lift change glides there over the dock's bottom transition, and
  // getBoundingClientRect reads the in-flight position — re-basing with
  // appliedLift is only exact once the glide lands. While settling,
  // every trigger defers to the single post-settle measure.
  let settling = false;
  let settleTimer: number | null = null;

  const hostObstructionAt = _hostObstructionProbeFor(dock);

  const measure = () => {
    frame = null;
    if (settling) {
      return;
    }
    const rect = _hitBoxRectOf(dock, appliedLift);
    if (rect === null) {
      return;
    }
    const lift = firstClearLiftFor({ rect, probe: hostObstructionAt });
    if (lift !== appliedLift) {
      appliedLift = lift;
      settling = true;
      dock.style.setProperty("--_tf-companion-lift", `${String(lift)}px`);
      // Belt-and-braces settle: transitionend is the precise clock, but
      // it never fires when the transition doesn't run (a hidden dock,
      // a browser without the property) — the timer outlasts the 180ms
      // glide either way.
      settleTimer = view.setTimeout(settle, LIFT_SETTLE_FALLBACK_MS);
    }
  };
  const scheduleMeasure = () => {
    if (settling) {
      return;
    }
    frame ??= view.requestAnimationFrame(measure);
  };
  // Landing re-measures once: anything the page did mid-glide was
  // deferred, and the verdict must be re-checked from exact geometry.
  const settle = () => {
    if (!settling) {
      return;
    }
    settling = false;
    if (settleTimer !== null) {
      view.clearTimeout(settleTimer);
      settleTimer = null;
    }
    scheduleMeasure();
  };
  const settleOnBottomTransition = (event: TransitionEvent) => {
    if (event.target === dock && event.propertyName === "bottom") {
      settle();
    }
  };

  scheduleMeasure();
  view.addEventListener("resize", scheduleMeasure);
  doc.addEventListener("scroll", scheduleMeasure, {
    capture: true,
    passive: true,
  });
  dock.addEventListener("transitionend", settleOnBottomTransition);
  dock.addEventListener("transitioncancel", settleOnBottomTransition);
  const observer = new MutationObserver(scheduleMeasure);
  observer.observe(doc.body, { childList: true, subtree: true });
  return () => {
    if (frame !== null) {
      view.cancelAnimationFrame(frame);
    }
    if (settleTimer !== null) {
      view.clearTimeout(settleTimer);
    }
    view.removeEventListener("resize", scheduleMeasure);
    doc.removeEventListener("scroll", scheduleMeasure, { capture: true });
    dock.removeEventListener("transitionend", settleOnBottomTransition);
    dock.removeEventListener("transitioncancel", settleOnBottomTransition);
    observer.disconnect();
    dock.style.removeProperty("--_tf-companion-lift");
  };
}
