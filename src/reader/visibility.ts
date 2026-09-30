// Whether an element is actually rendered, and whether what's rendered
// sits inside the current viewport. The two answers serve different
// lines: invisible elements are filtered out of the snapshot entirely,
// while visible-but-scrolled-away elements stay in with an [offscreen]
// mark — the reader must answer "what is on the user's screen right
// now", and a toast above the fold and a footer below it are different
// answers. Verdicts are cached per oracle; one oracle lives exactly one
// snapshot pass.

import type { LayoutProbe } from "./layout-probe.js";

export interface VisibilityOracle {
  isVisible(element: Element): boolean;
  isOffscreen(element: Element): boolean;
}

export function visibilityOracleOf(probe: LayoutProbe): VisibilityOracle {
  const visibleByElement = new Map<Element, boolean>();
  return {
    isVisible(element) {
      const cached = visibleByElement.get(element);
      if (cached !== undefined) {
        return cached;
      }
      const verdict = _isVisibleUncached(element, probe);
      visibleByElement.set(element, verdict);
      return verdict;
    },
    isOffscreen(element) {
      const rect = probe.rectOf(element);
      if (rect.width <= 0 || rect.height <= 0) {
        return false;
      }
      const viewport = probe.viewportSizeOf();
      return (
        rect.bottom <= 0 ||
        rect.right <= 0 ||
        rect.top >= viewport.height ||
        rect.left >= viewport.width
      );
    },
  };
}

/** The parent, crossing a shadow root's boundary to its host. */
export function parentAcrossShadowBoundaryOf(element: Element): Element | null {
  return element.parentElement ?? _containingShadowHostOf(element);
}

/**
 * Light-DOM children followed by shadow-DOM children, flat. Slotted
 * content is traversed at its light-DOM location — the flat view is what
 * the user perceives; no assignedNodes() projection.
 */
export function lightAndShadowChildNodesOf(element: Element): Node[] {
  const nodes: Node[] = Array.from(element.childNodes);
  if (element.shadowRoot !== null) {
    nodes.push(...Array.from(element.shadowRoot.childNodes));
  }
  return nodes;
}

function _containingShadowHostOf(element: Element): Element | null {
  const root = element.getRootNode();
  if (root instanceof ShadowRoot) {
    return root.host;
  }
  return null;
}

function _isVisibleUncached(element: Element, probe: LayoutProbe): boolean {
  const ownVisibility = probe.styleOf(element).visibility;
  let hasDisplayContentsAncestor = false;
  for (
    let current: Element | null = element;
    current !== null && current !== document.documentElement;
    current = parentAcrossShadowBoundaryOf(current)
  ) {
    // aria-hidden covers the whole subtree, so an ancestor's counts —
    // checking only the element itself would read a wrapper's children
    // as visible while the wrapper reads hidden.
    if (current.getAttribute("aria-hidden") === "true") {
      return false;
    }
    const style = probe.styleOf(current);
    if (style.display === "contents") {
      hasDisplayContentsAncestor = true;
      continue;
    }
    if (style.display === "none") {
      return false;
    }
    if (_hasClippedZeroSizeBox(current, style, probe)) {
      return false;
    }
    if (_isZeroSizedIframe(current, probe)) {
      return false;
    }
    // An explicitly visibility:visible element inside a hidden ancestor
    // is still rendered — visibility inherits but can be overridden.
    if (style.visibility === "hidden" && ownVisibility !== "visible") {
      return false;
    }
    if (Number.parseFloat(style.opacity) === 0) {
      return false;
    }
  }
  const native = probe.nativeVisibilityOf(element);
  if (native === false && !hasDisplayContentsAncestor) {
    return false;
  }
  return !_isClippedPastTopLeft(element, probe);
}

function _hasClippedZeroSizeBox(
  element: Element,
  style: { overflowX: string; overflowY: string },
  probe: LayoutProbe,
): boolean {
  const clips =
    style.overflowX === "hidden" ||
    style.overflowX === "clip" ||
    style.overflowY === "hidden" ||
    style.overflowY === "clip";
  if (!clips) {
    return false;
  }
  const size = probe.offsetSizeOf(element);
  return size.width === 0 || size.height === 0;
}

function _isZeroSizedIframe(element: Element, probe: LayoutProbe): boolean {
  if (element.tagName.toLowerCase() !== "iframe") {
    return false;
  }
  const size = probe.offsetSizeOf(element);
  return size.width === 0 || size.height === 0;
}

function _isClippedPastTopLeft(element: Element, probe: LayoutProbe): boolean {
  // A sized element entirely past the top-left corner whose own overflow
  // clips is a hidden scroller remnant, not content the user can reach.
  const rect = probe.rectOf(element);
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }
  if (rect.right > 0 && rect.bottom > 0) {
    return false;
  }
  const style = probe.styleOf(element);
  return style.overflowX !== "visible" || style.overflowY !== "visible";
}
