// Root resolution for a read: a pinned element, a remembered ref, a
// selector match, or the body — refused when the root sits inside a
// curated (opted-out) subtree.

import { roleOf } from "./roles.js";
import { parentAcrossShadowBoundaryOf } from "./visibility.js";

export const IGNORE_ATTRIBUTE = "data-teaflask-ignore";

/** The slice of SnapshotOptions that addresses a root — all root
 * resolution needs, so ref-addressed capabilities resolve without
 * inventing a probe or read knobs. */
export interface RootAddress {
  rootElement: Element | null;
  refId: string | null;
  selector: string | null;
  ignoreSelectors: string[];
}

export function _resolvedRootOf(
  options: RootAddress,
  elementByRef: ReadonlyMap<string, Element>,
): { root: Element; error: null } | { root: null; error: string } {
  if (options.rootElement !== null) {
    return _rootUnlessCurated(options.rootElement, options);
  }
  if (options.refId !== null) {
    const remembered = elementByRef.get(options.refId);
    if (remembered?.isConnected !== true) {
      return {
        root: null,
        error:
          `The ref "${options.refId}" is not on the current page — ` +
          "take a fresh full read and use a ref from it.",
      };
    }
    return _rootUnlessCurated(remembered, options);
  }
  if (options.selector !== null) {
    const matched = _safeQuerySelector(options.selector);
    if (matched === null) {
      return {
        root: null,
        error:
          `Nothing on the page matches the selector "${options.selector}" — ` +
          "take a full read to see what is there.",
      };
    }
    return _rootUnlessCurated(matched, options);
  }
  const body = document.body as HTMLElement | null;
  if (body === null) {
    return { root: null, error: "The page has no body to read yet." };
  }
  return { root: body, error: null };
}

function _rootUnlessCurated(
  root: Element,
  options: RootAddress,
): { root: Element; error: null } | { root: null; error: string } {
  // The full-page walk enforces curation top-down — a curated subtree is
  // never entered, so nothing below it is reachable. A scoped read roots
  // BELOW the top, so it must check its own ancestry, or a descendant
  // selector (".private h2") would read inside an opted-out region.
  for (
    let current: Element | null = root;
    current !== null;
    current = parentAcrossShadowBoundaryOf(current)
  ) {
    if (_theSubtreeIsCurated(current, options.ignoreSelectors)) {
      return {
        root: null,
        error:
          "That part of the page has opted out of page reads — " +
          "take a full read to see what is available.",
      };
    }
  }
  return { root, error: null };
}

function _safeQuerySelector(selector: string): Element | null {
  try {
    const direct = document.querySelector(selector);
    if (direct !== null) {
      return direct;
    }
  } catch {
    return null;
  }
  return _firstElementWithImplicitRole(selector);
}

function _firstElementWithImplicitRole(selector: string): Element | null {
  // [role="button"]-shaped selectors should also find elements whose
  // role is implicit (a bare <button> has no role attribute to match).
  const match = /^\[role=["'](\w+)["']\]$/.exec(selector);
  if (match === null) {
    return null;
  }
  const targetRole = match[1];
  for (const element of Array.from(document.querySelectorAll("*"))) {
    if (roleOf(element) === targetRole) {
      return element;
    }
  }
  return null;
}

export function _theSubtreeIsCurated(
  element: Element,
  ignoreSelectors: string[],
): boolean {
  if (element.hasAttribute(IGNORE_ATTRIBUTE)) {
    return true;
  }
  return ignoreSelectors.some((selector) => {
    try {
      return element.matches(selector);
    } catch {
      return false; // an invalid selector never breaks a read
    }
  });
}
