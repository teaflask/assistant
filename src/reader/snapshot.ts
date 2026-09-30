// The snapshot walk: DOM + shadow DOM in, a compact semantic tree out.
// Elements earn a place by meaning something — interactive, scrollable,
// landmark, named, or a non-generic role — and everything else
// contributes only its text. Curation is opt-out and enforced here, at
// the walk: a data-teaflask-ignore attribute or a grant-configured
// selector silently prunes the subtree, and redaction (redaction.ts)
// guards every value read. Iframes render as leaf nodes: a same-JS
// bundle cannot see into cross-origin frames, and same-origin recursion
// is deliberately deferred (the f-prefix ref grammar stays reserved for
// it — this function is the seam).
//
// Ref-ids are minted monotonically and remembered per element across
// snapshots (WeakMap badge): an unchanged button keeps its ref from read
// to read, which is what keeps repeat-read diffs small and will let a
// future capability address elements by ref.

import type { LayoutProbe } from "./layout-probe.js";
import {
  accessibleNameOf,
  type AccessibleNameCache,
} from "./accessible-name.js";
import {
  interactivitySignalsOf,
  isLandmark,
  isScrollable,
} from "./interactivity.js";
import { roleOf } from "./roles.js";
import {
  _duplicateRefOf,
  _foldTextLeaves,
  _mergeStringChildren,
  _unwrapBareGenerics,
} from "./snapshot-compaction.js";
import {
  _fragmentNode,
  _normalizedNodeName,
  _snapshotNodeOf,
} from "./snapshot-node.js";
import {
  _resolvedRootOf,
  _theSubtreeIsCurated,
  IGNORE_ATTRIBUTE,
  type RootAddress,
} from "./snapshot-root.js";
import {
  lightAndShadowChildNodesOf,
  visibilityOracleOf,
  type VisibilityOracle,
} from "./visibility.js";

export { IGNORE_ATTRIBUTE };
export const DEFAULT_MAX_DEPTH = 50;

const SKIP_TAGS = new Set([
  "script",
  "style",
  "meta",
  "link",
  "title",
  "noscript",
]);

export interface SnapshotOptions {
  probe: LayoutProbe;
  /** Grant-configured opt-out selectors; invalid ones are ignored. */
  ignoreSelectors: string[];
  maxDepth: number;
  /** Interactive-elements-only view (with skipped text hoisted). */
  interactive: boolean;
  /** Keep invisible elements, marked [hidden]. */
  showHidden: boolean;
  /** Root the snapshot at a selector match instead of the body. */
  selector: string | null;
  /** Root the snapshot at a previously-minted ref. */
  refId: string | null;
  /**
   * A pre-resolved root, taking precedence over refId/selector. The
   * size-fitting ladder re-renders one read several times, and each
   * render rebuilds the ref registry — re-resolving a refId mid-ladder
   * would fail if the walk just re-minted the element under a new ref,
   * so the orchestrator resolves once and pins the element.
   */
  rootElement: Element | null;
}

export interface SnapshotNode {
  role: string;
  name: string;
  level: number | null;
  hidden: boolean;
  scrollable: boolean;
  checked: boolean;
  selected: boolean;
  focused: boolean;
  disabled: boolean;
  offscreen: boolean;
  refId: string | null;
  hints: string[];
  placeholder: string | null;
  element: Element | null;
  children: (SnapshotNode | string)[];
}

export type SnapshotOutcome =
  { tree: SnapshotNode; error: null } | { tree: null; error: string };

// Monotonic across snapshots on purpose: a ref is never reissued to a
// different element, and an unchanged element keeps its badge.
let _refCounter = 0;
const _refBadgeByElement = new WeakMap<
  Element,
  { role: string; name: string; ref: string }
>();
// The last snapshot's ref → element registry, for refId-rooted reads.
const _elementByRef = new Map<string, Element>();

export interface WalkContext {
  options: SnapshotOptions;
  oracle: VisibilityOracle;
  nameCache: AccessibleNameCache;
}

export function snapshotTreeOf(options: SnapshotOptions): SnapshotOutcome {
  const context: WalkContext = {
    options,
    oracle: visibilityOracleOf(options.probe),
    nameCache: new Map(),
  };
  const rooting = _resolvedRootOf(options, _elementByRef);
  if (rooting.error !== null) {
    return { tree: null, error: rooting.error };
  }
  const root = rooting.root;
  _elementByRef.clear();
  const fragment = _fragmentNode();
  _traverse(root, 0, fragment, context);
  _mergeStringChildren(fragment);
  _unwrapBareGenerics(fragment, options.showHidden);
  _foldTextLeaves(fragment);
  const duplicate = _duplicateRefOf(fragment);
  if (duplicate !== null) {
    return {
      tree: null,
      error: `The snapshot minted the ref "${duplicate}" twice; take a fresh read.`,
    };
  }
  return { tree: fragment, error: null };
}

// --- root resolution -------------------------------------------------------

/** Resolve a read's root without walking — for pinning it across the
 * orchestrator's repeated renders of one read. */
export function resolvedSnapshotRootOf(
  options: SnapshotOptions,
): { root: Element; error: null } | { root: null; error: string } {
  return _resolvedRootOf(options, _elementByRef);
}

/**
 * Resolve a previously-minted ref to its live element — for a capability
 * that addresses the page by ref (highlight, prefill) instead of reading
 * it. Liveness and the in-page curation opt-out are checked the same way
 * a refId-rooted read checks them, and the error is the reader's own
 * model-actionable sentence.
 */
export function resolvedElementOfRef(
  refId: string,
): { element: Element; error: null } | { element: null; error: string } {
  const address: RootAddress = {
    rootElement: null,
    refId,
    selector: null,
    ignoreSelectors: [],
  };
  const rooting = _resolvedRootOf(address, _elementByRef);
  if (rooting.error !== null) {
    return { element: null, error: rooting.error };
  }
  return { element: rooting.root, error: null };
}

// --- the walk --------------------------------------------------------------

function _traverse(
  element: Element,
  depth: number,
  parentNode: SnapshotNode,
  context: WalkContext,
): void {
  const { options, oracle } = context;
  const includeAsRoot = options.refId === null && element === document.body;
  const traversable = _shouldTraverse(element, context);
  if (!traversable && !includeAsRoot) {
    // No name hoisting here: a non-traversable subtree is hidden or
    // curated, and curated content must not leak through its name.
    return;
  }
  const hidden = !oracle.isVisible(element);
  const include =
    includeAsRoot ||
    _shouldIncludeNode(element, context) ||
    (options.showHidden && hidden);

  let targetNode = parentNode;
  if (include) {
    const node = _snapshotNodeOf(element, context, _refFor);
    if (node !== null) {
      parentNode.children.push(node);
      targetNode = node;
    }
  } else if (options.interactive && element.childElementCount === 0) {
    // A hoisted content name already carries the leaf's text (and its
    // pseudo content) — descending as well would emit the text twice.
    if (_hoistSkippedLeafName(element, parentNode, context)) {
      return;
    }
  }

  const before = options.probe.pseudoContentOf(element, "::before");
  if (before !== "") {
    targetNode.children.push(before);
  }
  if (_descendsIntoChildren(element) && depth < options.maxDepth) {
    for (const child of lightAndShadowChildNodesOf(element)) {
      if (child.nodeType === Node.TEXT_NODE) {
        // A textbox's value is already seeded; its text would duplicate it.
        if (targetNode.role !== "textbox" && child.nodeValue !== null) {
          targetNode.children.push(child.nodeValue);
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        _traverse(child as Element, depth + 1, targetNode, context);
      }
    }
  }
  const after = options.probe.pseudoContentOf(element, "::after");
  if (after !== "") {
    targetNode.children.push(after);
  }
}

function _descendsIntoChildren(element: Element): boolean {
  // A <select> renders its own options (render.ts reads element.options
  // directly) and an <iframe> holds a separate document — walking into
  // either only does work whose nodes are discarded downstream, and a
  // select would leak option text as string children the renderer never
  // shows.
  const tag = element.tagName.toLowerCase();
  return tag !== "iframe" && tag !== "select";
}

function _shouldTraverse(element: Element, context: WalkContext): boolean {
  const tag = element.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) {
    return false;
  }
  if (_theSubtreeIsCurated(element, context.options.ignoreSelectors)) {
    return false;
  }
  // No aria-hidden special case: the visibility oracle reads aria-hidden
  // (inherited) as hidden, so default reads prune these subtrees below
  // and show_hidden keeps them, marked — same as any other hidden thing.
  if (!context.options.showHidden && !context.oracle.isVisible(element)) {
    // Branded-control escape: many designs hide the real radio/checkbox
    // and render a styled twin; the input still matters.
    if (element instanceof HTMLInputElement) {
      const type = element.type;
      if (type === "radio" || type === "checkbox") {
        return true;
      }
    }
    return false;
  }
  return true;
}

function _shouldIncludeNode(element: Element, context: WalkContext): boolean {
  const { options, nameCache } = context;
  const role = roleOf(element);
  const interactive = interactivitySignalsOf(
    element,
    options.probe,
  ).interactive;
  const scrollable = isScrollable(element, options.probe);
  const landmark = isLandmark(element);
  if (options.interactive) {
    return role === "canvas" || interactive || scrollable || landmark;
  }
  if (interactive || scrollable || landmark) {
    return true;
  }
  if (accessibleNameOf(element, options.probe, nameCache).length > 0) {
    return true;
  }
  return role !== "generic" && role !== "image";
}

/** Push a skipped leaf's accessible name as loose text; true when one
 * was pushed (naming-prohibited roles contribute nothing). */
function _hoistSkippedLeafName(
  element: Element,
  parentNode: SnapshotNode,
  context: WalkContext,
): boolean {
  const name = _normalizedNodeName(
    accessibleNameOf(element, context.options.probe, context.nameCache),
  );
  if (name === "") {
    return false;
  }
  parentNode.children.push(name);
  return true;
}

// --- the ref mint -----------------------------------------------------------

function _refFor(element: Element, role: string, name: string): string {
  const badge = _refBadgeByElement.get(element);
  if (badge?.role === role && badge.name === name) {
    _elementByRef.set(badge.ref, element);
    return badge.ref;
  }
  _refCounter += 1;
  const ref = `e${String(_refCounter)}`;
  _refBadgeByElement.set(element, { role, name, ref });
  _elementByRef.set(ref, element);
  return ref;
}
