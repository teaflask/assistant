import type { AssistantSurfacePresence } from "./surface-registry.js";

// The companion's presence rule, as a pure derivation: which chrome the
// widget shows, answered from inputs it already holds. The drawer flag's
// writers live in core/companion-drawer-flag; this module only reads it.

export type CompanionChrome = "companion" | "drawer" | "none";

export interface CompanionChromeInput {
  surfaces: AssistantSurfacePresence;
  /** The corner drawer is open (widget state). */
  expanded: boolean;
}

export function companionChromeOf(
  input: CompanionChromeInput,
): CompanionChrome {
  if (_yieldsToAnotherSurface(input.surfaces)) {
    return "none";
  }
  return input.expanded ? "drawer" : "companion";
}

/** A full-surface chrome anywhere hides everything: that surface is the
 *  assistant now. The open palette hides the whole cluster too, drawer
 *  included: the widget keeps its expanded flag, so the drawer returns the
 *  moment the palette closes — but while the palette holds the transcript
 *  lease the drawer would render as a hollow shell behind the modal, and
 *  two gutted twins of one surface read as broken. */
function _yieldsToAnotherSurface(surfaces: AssistantSurfacePresence): boolean {
  return surfaces.fullSurfaceMounted || surfaces.transientOpen;
}
