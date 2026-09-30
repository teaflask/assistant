// Which elements the user can act on. Native interactive tags and
// button/link roles are certain; onclick handlers, focusable tabindex,
// contenteditable, and cursor:pointer are the heuristics that catch the
// div-with-a-click-handler pattern. The cursor signal is suppressed when
// the parent shares it and the element has no signal of its own —
// otherwise every span inside a clickable card would read as
// interactive.

import type { LayoutProbe } from "./layout-probe.js";
import { explicitRoleOf, isContentEditableElement } from "./roles.js";

const INTERACTIVE_TAGS = new Set([
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "details",
  "summary",
]);

// Roles that always earn a ref in the snapshot, interactive by nature.
export const INTERACTIVE_REF_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "treeitem",
]);

// Content roles that earn a ref only when they carry an accessible name.
export const CONTENT_REF_ROLES = new Set([
  "cell",
  "gridcell",
  "columnheader",
  "rowheader",
  "listitem",
  "article",
  "region",
  "main",
  "navigation",
]);

const LANDMARK_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "nav",
  "main",
  "header",
  "footer",
  "section",
  "article",
  "aside",
]);

const SCROLLABLE_OVERFLOW_VALUES = new Set(["auto", "scroll", "overlay"]);

export interface InteractivitySignals {
  interactive: boolean;
  isInteractiveTag: boolean;
  /** The heuristic signals worth surfacing on non-native elements. */
  hints: string[];
}

export function interactivitySignalsOf(
  element: Element,
  probe: LayoutProbe,
): InteractivitySignals {
  const tag = element.tagName.toLowerCase();
  const role = explicitRoleOf(element);
  const tabIndex = element.getAttribute("tabindex");
  const hasTabIndex = tabIndex !== null && tabIndex !== "-1";
  const hasOnClick = element.hasAttribute("onclick");
  const hasCursorPointer = probe.styleOf(element).cursor === "pointer";
  const isInteractiveTag = INTERACTIVE_TAGS.has(tag);
  const isRoleInteractive = role === "button" || role === "link";
  // The shared predicate, so the bare attribute and plaintext-only read
  // as interactive exactly where roles.ts reads them as textboxes.
  const isContentEditable = isContentEditableElement(element);

  let hasPointerInteraction = hasCursorPointer;
  if (hasCursorPointer && !hasOnClick && !hasTabIndex) {
    const parent = element.parentElement;
    if (parent !== null && probe.styleOf(parent).cursor === "pointer") {
      hasPointerInteraction = false;
    }
  }

  const hints: string[] = [];
  if (hasPointerInteraction) {
    hints.push("cursor:pointer");
  }
  if (hasOnClick) {
    hints.push("onclick");
  }
  if (hasTabIndex) {
    hints.push("tabindex");
  }
  return {
    interactive:
      isInteractiveTag ||
      hasOnClick ||
      hasTabIndex ||
      isRoleInteractive ||
      isContentEditable ||
      hasPointerInteraction,
    isInteractiveTag,
    hints,
  };
}

export function isScrollable(element: Element, probe: LayoutProbe): boolean {
  const tag = element.tagName.toLowerCase();
  if (tag === "html" || tag === "body") {
    return false; // page-level scroll is implicit
  }
  const style = probe.styleOf(element);
  if (
    !SCROLLABLE_OVERFLOW_VALUES.has(style.overflowX) &&
    !SCROLLABLE_OVERFLOW_VALUES.has(style.overflowY)
  ) {
    return false;
  }
  return (
    element.scrollHeight > element.clientHeight + 1 ||
    element.scrollWidth > element.clientWidth + 1
  );
}

export function isLandmark(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (LANDMARK_TAGS.has(tag)) {
    return true;
  }
  const explicitRole = explicitRoleOf(element);
  return (
    explicitRole !== null &&
    explicitRole !== "presentation" &&
    explicitRole !== "none"
  );
}
