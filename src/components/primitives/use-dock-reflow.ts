"use client";

import { useEffect, type RefObject } from "react";

import { dockReflowFor } from "../../core/dock-reflow.js";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Keeps the host page pushed exactly while the docked panel is actually
 * visible. Visibility, not the mode setting or the open prop: a host
 * modal that force-hides (parks) the panel must un-push the page, and
 * the way-is-clear restore must re-push it. The native `toggle` event is
 * the one signal that fires on every show and hide regardless of who
 * drove it — our own show/hide effect, the modal's spec-mandated
 * hide-all-popovers, a meddling host script, the watcher's re-show — so
 * it is the single source of truth here, and the React onToggle prop
 * stays the park detector's alone. */
export function useDockReflow(
  panelRef: RefObject<HTMLDivElement | null>,
  dock: "floating" | "sidebar",
): void {
  useEffect(() => {
    const panel = panelRef.current;
    if (
      dock !== "sidebar" ||
      panel === null ||
      typeof panel.showPopover !== "function"
    ) {
      return;
    }
    const controller = dockReflowFor(panel.ownerDocument.documentElement);
    // Both switches the stylesheet answers, answered here too: the OS
    // preference and the host's data-reduce-motion kill switch — an
    // inline transition is invisible to those CSS selectors.
    const reduceMotion = () =>
      (panel.ownerDocument.defaultView ?? window).matchMedia(
        REDUCED_MOTION_QUERY,
      ).matches || panel.closest('[data-reduce-motion="true"]') !== null;
    const syncPushToVisibility = () => {
      if (panel.matches(":popover-open")) {
        // The rendered width, not the nominal 26rem: offsetWidth is
        // layout width (the sidebar pins scale to 1), and it already
        // reflects a host root font-size inflating rem and the
        // max-width clamp on narrow viewports.
        controller.push(panel.offsetWidth, reduceMotion());
      } else {
        controller.release();
      }
    };
    panel.addEventListener("toggle", syncPushToVisibility);
    // A dock-mode switch on an already-open panel changes no popover
    // state and fires no toggle; this one call covers it.
    syncPushToVisibility();
    return () => {
      panel.removeEventListener("toggle", syncPushToVisibility);
      // Mode switch, close, or unmount: the un-push still animates —
      // the controller lives on the documentElement's lifetime, which
      // outlives this panel.
      controller.release();
    };
  }, [panelRef, dock]);
}
