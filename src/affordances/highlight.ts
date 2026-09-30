// The spotlight: "it's *this* switch". Scrolls the target into view and
// draws the package's own overlay ring around it for a few seconds —
// the host element itself is never touched (no class, no style, no
// attribute), so a highlight can never fight the page's own rendering.
// One spotlight at a time: pointing somewhere new dismisses the old one.
// Geometry goes through the layout probe so the placement logic
// unit-tests under jsdom.

import type { LayoutProbe } from "../reader/layout-probe.js";

// How long the ring dwells before fading — long enough to find, short
// enough that the page never feels annotated.
export const HIGHLIGHT_DWELL_MS = 4_000;
// The fade matches the CSS transition on .tf-highlight-ring.
const FADE_MS = 300;
// The ring sits this far outside the target's own box.
const RING_INSET_PX = 4;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

interface ActiveSpotlight {
  ring: HTMLElement;
  dismiss: () => void;
}

let _activeSpotlight: ActiveSpotlight | null = null;

/**
 * Scroll the element into view and spotlight it. Fire-and-forget on
 * purpose: the tool's result reports that the spotlight was shown, and
 * the dwell/fade play out after the handler has answered.
 */
export function spotlightElement(element: Element, probe: LayoutProbe): void {
  _activeSpotlight?.dismiss();
  _scrollIntoViewRespectingMotion(element);
  const ring = _ringElement();
  document.body.appendChild(ring);
  const track = () => {
    _placeRingAround(ring, element, probe);
  };
  track();
  // Capture-phase scroll hears every scroll container (scroll events do
  // not bubble), so the ring rides along while scrollIntoView animates
  // and while the user keeps scrolling.
  window.addEventListener("scroll", track, { capture: true, passive: true });
  window.addEventListener("resize", track);
  const dismiss = _dismisserOf(ring, track);
  _activeSpotlight = { ring, dismiss };
  window.setTimeout(dismiss, HIGHLIGHT_DWELL_MS);
}

function _dismisserOf(ring: HTMLElement, track: () => void): () => void {
  let dismissed = false;
  return () => {
    if (dismissed) {
      return;
    }
    dismissed = true;
    window.removeEventListener("scroll", track, { capture: true });
    window.removeEventListener("resize", track);
    if (_activeSpotlight?.ring === ring) {
      _activeSpotlight = null;
    }
    ring.dataset.tfHighlightLeaving = "true";
    window.setTimeout(() => {
      ring.remove();
    }, FADE_MS);
  };
}

function _ringElement(): HTMLElement {
  const ring = document.createElement("div");
  // The data-tf-assistant attribute is the package stylesheet's scope
  // marker (never an API); the class carries the ring's look.
  ring.setAttribute("data-tf-assistant", "");
  ring.className = "tf-highlight-ring";
  ring.setAttribute("aria-hidden", "true");
  return ring;
}

function _placeRingAround(
  ring: HTMLElement,
  element: Element,
  probe: LayoutProbe,
): void {
  const rect = probe.rectOf(element);
  ring.style.top = `${String(rect.top - RING_INSET_PX)}px`;
  ring.style.left = `${String(rect.left - RING_INSET_PX)}px`;
  ring.style.width = `${String(rect.width + 2 * RING_INSET_PX)}px`;
  ring.style.height = `${String(rect.height + 2 * RING_INSET_PX)}px`;
}

function _scrollIntoViewRespectingMotion(element: Element): void {
  // jsdom has no scrollIntoView; the ring still places, so a missing
  // scroll degrades to an unscrolled spotlight rather than a crash.
  if (typeof element.scrollIntoView !== "function") {
    return;
  }
  element.scrollIntoView({
    block: "center",
    inline: "nearest",
    behavior: _reducedMotionIsOn() ? "auto" : "smooth",
  });
}

function _reducedMotionIsOn(): boolean {
  // Both switches, like every motion in the package: the OS preference
  // and the host's own kill switch. Walked from where the ring mounts
  // (a <body> child), so the scroll agrees with the ring's own CSS
  // about which ancestors can carry the switch.
  return (
    (typeof window.matchMedia === "function" &&
      window.matchMedia(REDUCED_MOTION_QUERY).matches) ||
    document.body.closest('[data-reduce-motion="true"]') !== null
  );
}
