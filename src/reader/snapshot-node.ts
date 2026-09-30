// One element becomes one node: role, name, state bits, and a ref when
// the element is addressable. The ref mint is the caller's — the ref
// registries stay single-homed in snapshot.ts.

import { accessibleNameOf } from "./accessible-name.js";
import {
  CONTENT_REF_ROLES,
  INTERACTIVE_REF_ROLES,
  interactivitySignalsOf,
  isScrollable,
} from "./interactivity.js";
import { textboxValueOf } from "./redaction.js";
import {
  ariaBooleanOf,
  ariaLevelOf,
  ARIA_CHECKED_ROLES,
  ARIA_DISABLED_ROLES,
  ARIA_SELECTED_ROLES,
  roleOf,
} from "./roles.js";
import type { SnapshotNode, WalkContext } from "./snapshot.js";
import { parentAcrossShadowBoundaryOf } from "./visibility.js";

const MAX_NODE_NAME_LENGTH = 100;

export function _snapshotNodeOf(
  element: Element,
  context: WalkContext,
  refFor: (element: Element, role: string, name: string) => string,
): SnapshotNode | null {
  const { options, oracle, nameCache } = context;
  const role = roleOf(element);
  const roleLower = role.toLowerCase();
  const interactivity = interactivitySignalsOf(element, options.probe);
  const name = _normalizedNodeName(
    accessibleNameOf(element, options.probe, nameCache),
  );
  const hidden = !oracle.isVisible(element);
  const scrollable = isScrollable(element, options.probe);
  const shouldHaveRef =
    roleLower === "iframe" ||
    roleLower === "canvas" ||
    scrollable ||
    interactivity.interactive ||
    INTERACTIVE_REF_ROLES.has(roleLower) ||
    (CONTENT_REF_ROLES.has(roleLower) && name.length > 0);

  const refId = shouldHaveRef ? refFor(element, role, name) : null;
  if (role === "generic" && refId === null && !hidden) {
    return null; // an anonymous wrapper adds nothing; its children speak
  }

  const hints =
    interactivity.interactive && !interactivity.isInteractiveTag
      ? interactivity.hints
      : [];
  const value = textboxValueOf(element);

  return {
    role,
    name,
    level: ariaLevelOf(element, role),
    hidden,
    scrollable,
    checked: _checkedStateOf(element, roleLower),
    selected: _selectedStateOf(element, roleLower),
    focused: element.ownerDocument.activeElement === element,
    disabled: _disabledStateOf(element, roleLower),
    offscreen: !hidden && oracle.isOffscreen(element),
    refId,
    hints,
    placeholder: element.getAttribute("placeholder"),
    element,
    children: value !== null && value !== "" ? [value] : [],
  };
}

function _checkedStateOf(element: Element, role: string): boolean {
  if (
    element instanceof HTMLInputElement &&
    (element.type === "checkbox" || element.type === "radio")
  ) {
    return element.checked;
  }
  if (!ARIA_CHECKED_ROLES.has(role)) {
    return false;
  }
  return ariaBooleanOf(element.getAttribute("aria-checked")) === true;
}

function _selectedStateOf(element: Element, role: string): boolean {
  if (element instanceof HTMLOptionElement) {
    return element.selected;
  }
  if (!ARIA_SELECTED_ROLES.has(role)) {
    return false;
  }
  return ariaBooleanOf(element.getAttribute("aria-selected")) === true;
}

function _disabledStateOf(element: Element, role: string): boolean {
  if (!ARIA_DISABLED_ROLES.has(role)) {
    return false;
  }
  if (_isNativelyDisabled(element)) {
    return true;
  }
  for (
    let current: Element | null = element;
    current !== null;
    current = parentAcrossShadowBoundaryOf(current)
  ) {
    if (ariaBooleanOf(current.getAttribute("aria-disabled")) === true) {
      return true;
    }
  }
  return false;
}

function _isNativelyDisabled(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (
    !["button", "input", "select", "textarea", "option", "optgroup"].includes(
      tag,
    )
  ) {
    return false;
  }
  try {
    return element.matches(":disabled");
  } catch {
    return false;
  }
}

export function _normalizedNodeName(name: string): string {
  return name.replace(/\s+/g, " ").trim().substring(0, MAX_NODE_NAME_LENGTH);
}

export function _fragmentNode(): SnapshotNode {
  return {
    role: "fragment",
    name: "",
    level: null,
    hidden: false,
    scrollable: false,
    checked: false,
    selected: false,
    focused: false,
    disabled: false,
    offscreen: false,
    refId: null,
    hints: [],
    placeholder: null,
    element: null,
    children: [],
  };
}
