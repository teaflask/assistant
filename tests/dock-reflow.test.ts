// @vitest-environment jsdom

// The sidebar's host-reflow controller, driven directly — the popover
// plumbing that triggers it in the app is jsdom-invisible (no popover
// API), so the contract is pinned here on the style writes themselves:
// what push saves and writes, what release restores on which edge, and
// the settle window that keeps the un-push animated.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dockReflowFor } from "../src/core/dock-reflow";

// The panel's motion clock, restated so a retune of either side breaks
// the pin instead of drifting silently.
const EXPECTED_TRANSITION = "margin-right 220ms cubic-bezier(0.22, 1, 0.36, 1)";
const EXPECTED_REDUCED_TRANSITION = "margin-right 1ms";
const SETTLE_MS = 400;

// A fresh root per test: the controller is memoized per root element for
// the root's lifetime, so reusing documentElement would leak one test's
// saved state into the next.
function freshRoot(): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the dock-reflow controller", () => {
  it("pushes with the panel's own clock and releases back to a clean slate", () => {
    const root = freshRoot();
    const reflow = dockReflowFor(root);

    reflow.push(416, false);

    expect(root.style.marginRight).toBe("416px");
    expect(root.style.transition).toBe(EXPECTED_TRANSITION);

    reflow.release();

    // The margin restores immediately — that IS the un-push — while our
    // transition stays inline to pace the slide back.
    expect(root.style.marginRight).toBe("");
    expect(root.style.transition).toBe(EXPECTED_TRANSITION);

    vi.advanceTimersByTime(SETTLE_MS);

    expect(root.style.transition).toBe("");
  });

  it("saves the host's inline values once and restores exactly them", () => {
    const root = freshRoot();
    root.style.marginRight = "7px";
    root.style.transition = "opacity 1s linear";
    const reflow = dockReflowFor(root);

    reflow.push(416, false);
    // A repeat push (a resize, a re-show) re-writes the width without
    // re-saving — the saved values must stay the host's, never our own.
    reflow.push(500, false);

    expect(root.style.marginRight).toBe("500px");

    reflow.release();

    expect(root.style.marginRight).toBe("7px");
    vi.advanceTimersByTime(SETTLE_MS);
    expect(root.style.transition).toBe("opacity 1s linear");
  });

  it("a re-push inside the settle window cancels the stale restore (the park→re-show path)", () => {
    const root = freshRoot();
    root.style.transition = "opacity 1s linear";
    const reflow = dockReflowFor(root);

    reflow.push(416, false);
    reflow.release();
    vi.advanceTimersByTime(SETTLE_MS / 2);
    reflow.push(416, false);
    vi.advanceTimersByTime(SETTLE_MS * 2);

    // The pending settle must not restore the host transition out from
    // under the live push.
    expect(root.style.transition).toBe(EXPECTED_TRANSITION);
    expect(root.style.marginRight).toBe("416px");

    reflow.release();
    vi.advanceTimersByTime(SETTLE_MS);

    expect(root.style.transition).toBe("opacity 1s linear");
  });

  it("collapses the motion when reduced motion asks, per write", () => {
    const root = freshRoot();
    const reflow = dockReflowFor(root);

    reflow.push(416, false);
    expect(root.style.transition).toBe(EXPECTED_TRANSITION);

    // A mid-session preference flip governs the very next write.
    reflow.push(416, true);

    expect(root.style.transition).toBe(EXPECTED_REDUCED_TRANSITION);
  });

  it("release without a push is a no-op", () => {
    const root = freshRoot();
    root.style.marginRight = "7px";
    const reflow = dockReflowFor(root);

    reflow.release();

    expect(root.style.marginRight).toBe("7px");
    expect(root.style.transition).toBe("");
  });

  it("hands the same controller back for the same root", () => {
    const root = freshRoot();

    expect(dockReflowFor(root)).toBe(dockReflowFor(root));
  });
});
