// The compaction passes over a walked tree: merge text runs, unwrap
// anonymous wrappers, fold text leaves into their parent's name, and
// refuse a tree that minted one ref twice.

import type { SnapshotNode } from "./snapshot.js";
import { _normalizedNodeName } from "./snapshot-node.js";

/** Merge adjacent string children, fold bare paragraphs into the run,
 * and drop a lone text child that just repeats the node's name. */
export function _mergeStringChildren(node: SnapshotNode): void {
  for (const child of node.children) {
    if (typeof child !== "string") {
      _mergeStringChildren(child);
    }
  }
  const merged: (SnapshotNode | string)[] = [];
  let buffer: string[] = [];
  const flush = (): void => {
    const text = _mergedTextOf(buffer);
    if (text !== "") {
      merged.push(text);
    }
    buffer = [];
  };
  for (const child of node.children) {
    if (typeof child === "string") {
      buffer.push(child);
    } else if (_isBareTextParagraph(child)) {
      buffer.push(
        _mergedTextOf(child.children.filter((c) => typeof c === "string")),
      );
    } else {
      flush();
      merged.push(child);
    }
  }
  flush();
  node.children = merged;
  if (
    node.children.length === 1 &&
    typeof node.children[0] === "string" &&
    node.children[0] === node.name
  ) {
    node.children = [];
  }
}

function _isBareTextParagraph(node: SnapshotNode): boolean {
  return (
    node.role === "paragraph" &&
    node.refId === null &&
    !node.hidden &&
    !node.scrollable &&
    node.children.every((child) => typeof child === "string")
  );
}

/** Drop hidden ref-less subtrees and unwrap anonymous wrappers whose
 * only content is a single ref-bearing child. */
export function _unwrapBareGenerics(
  node: SnapshotNode,
  showHidden: boolean,
): void {
  const result: (SnapshotNode | string)[] = [];
  for (const child of node.children) {
    if (typeof child === "string") {
      result.push(child);
      continue;
    }
    _unwrapBareGenerics(child, showHidden);
    // Hidden ref-less noise is pruned from a default read (only the
    // branded checkbox/radio escape reaches here, and it carries a ref)
    // — but a show_hidden read exists precisely to surface hidden text
    // and structure, so there the drop would gut the knob.
    if (
      !showHidden &&
      child.hidden &&
      child.refId === null &&
      !_hasRefInSubtree(child)
    ) {
      continue;
    }
    if (
      child.role === "paragraph" &&
      child.refId === null &&
      child.children.length === 1 &&
      typeof child.children[0] !== "string" &&
      child.children[0].role === "paragraph"
    ) {
      result.push(child.children[0]);
      continue;
    }
    if (
      child.role === "generic" &&
      !child.hidden &&
      child.name === "" &&
      child.children.length === 1 &&
      typeof child.children[0] !== "string" &&
      child.children[0].refId !== null
    ) {
      result.push(child.children[0]);
      continue;
    }
    result.push(child);
  }
  node.children = result;
}

function _hasRefInSubtree(node: SnapshotNode): boolean {
  if (node.refId !== null) {
    return true;
  }
  return node.children.some(
    (child) => typeof child !== "string" && _hasRefInSubtree(child),
  );
}

const TEXT_LEAF_ROLES = new Set(["generic", "heading", "paragraph", "label"]);

/** Fold a ref-bearing node's few text-only children into its own name. */
export function _foldTextLeaves(node: SnapshotNode): void {
  for (const child of node.children) {
    if (typeof child !== "string") {
      _foldTextLeaves(child);
    }
  }
  if (node.refId === null) {
    return;
  }
  if (node.children.length < 1 || node.children.length > 3) {
    return;
  }
  const texts: string[] = [];
  for (const child of node.children) {
    if (typeof child === "string") {
      texts.push(child);
      continue;
    }
    const isFoldableLeaf =
      !child.hidden &&
      TEXT_LEAF_ROLES.has(child.role) &&
      child.name !== "" &&
      child.children.length === 0 &&
      child.refId === null;
    if (!isFoldableLeaf) {
      return;
    }
    texts.push(child.name);
  }
  const mergedText = _normalizedNodeName(texts.join(" "));
  if (node.name === "") {
    node.name = mergedText;
    node.children = [];
  } else if (node.name.replace(/\s+/g, "") === mergedText.replace(/\s+/g, "")) {
    node.children = [];
  }
}

function _mergedTextOf(parts: string[]): string {
  let merged = "";
  for (const part of parts) {
    if (part === "") {
      continue;
    }
    if (merged === "") {
      merged = part;
      continue;
    }
    if (_wordsMeetAtTheSeam(merged, part)) {
      merged += " ";
    }
    merged += part;
  }
  return merged.trim();
}

function _wordsMeetAtTheSeam(left: string, right: string): boolean {
  // Raw boundary characters, not trimmed ends: a fragment that already
  // carries its own boundary space ("Welcome " + "back") must not gain a
  // second one — the doubled space would also defeat the repeats-the-name
  // dedup above.
  if (/\s$/u.test(left) || /^\s/u.test(right)) {
    return false;
  }
  return /[\p{L}\p{N}]$/u.test(left) && /^[\p{L}\p{N}]/u.test(right);
}

export function _duplicateRefOf(node: SnapshotNode): string | null {
  const seen = new Set<string>();
  const walk = (current: SnapshotNode): string | null => {
    if (current.refId !== null) {
      if (seen.has(current.refId)) {
        return current.refId;
      }
      seen.add(current.refId);
    }
    for (const child of current.children) {
      if (typeof child !== "string") {
        const duplicate = walk(child);
        if (duplicate !== null) {
          return duplicate;
        }
      }
    }
    return null;
  };
  return walk(node);
}
