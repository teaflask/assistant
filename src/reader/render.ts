// The snapshot's text form: an indented outline the model reads top to
// bottom, one `- role "name" [ref=eN] [flags]` line per node, string
// children as `- text: "…"` rows, and a two-line page header. Selects
// render their options inline — the accessibility walk never descends
// into them, but the choice list is exactly what a "what am I looking
// at" answer needs.

import { boundedTextOf } from "../transport/door-budget.js";
import type { SnapshotNode } from "./snapshot.js";

const MAX_TITLE_LENGTH = 300;
const MAX_URL_LENGTH = 2_000;
const MAX_OPTION_TEXT_LENGTH = 100;

export function pageHeaderOf(title: string, url: string): string {
  const boundedTitle = boundedTextOf(
    title.replace(/\s+/g, " ").trim(),
    MAX_TITLE_LENGTH,
  );
  const boundedUrl = boundedTextOf(url, MAX_URL_LENGTH);
  return `# page: "${_escapedText(boundedTitle)}"\n# url: ${boundedUrl}`;
}

export function renderedTreeOf(root: SnapshotNode): string {
  const lines: string[] = [];
  _renderChildren(root, 0, lines);
  return lines.join("\n");
}

function _renderChildren(
  node: SnapshotNode,
  depth: number,
  lines: string[],
): void {
  for (const child of node.children) {
    if (typeof child === "string") {
      const text = child.trim();
      if (text !== "") {
        lines.push(`${_indentOf(depth)}- text: "${_escapedText(text)}"`);
      }
    } else {
      _renderNode(child, depth, lines);
    }
  }
}

function _renderNode(node: SnapshotNode, depth: number, lines: string[]): void {
  const indent = _indentOf(depth);
  const label = _nodeLineOf(node);
  const isSelect = node.element instanceof HTMLSelectElement;
  const textChildren = node.children.filter(
    (child): child is string => typeof child === "string",
  );
  const elementChildren = node.children.filter(
    (child): child is SnapshotNode => typeof child !== "string",
  );

  if (textChildren.length === 1 && elementChildren.length === 0 && !isSelect) {
    const text = textChildren[0].trim();
    if (text === "") {
      lines.push(`${indent}- ${label}`);
    } else {
      lines.push(`${indent}- ${label}: "${_escapedText(text)}"`);
    }
    return;
  }

  if (node.children.length === 0 && !isSelect) {
    lines.push(`${indent}- ${label}`);
    return;
  }

  lines.push(`${indent}- ${label}:`);
  if (isSelect && node.element instanceof HTMLSelectElement) {
    _renderSelectOptions(node.element, depth + 1, lines);
    return;
  }
  _renderChildren(node, depth + 1, lines);
}

function _renderSelectOptions(
  select: HTMLSelectElement,
  depth: number,
  lines: string[],
): void {
  const indent = _indentOf(depth);
  for (const option of Array.from(select.options)) {
    const text = option.text
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, MAX_OPTION_TEXT_LENGTH);
    let line = `${indent}- option "${_escapedText(text)}"`;
    if (option.selected) {
      line += " (selected)";
    }
    if (option.value !== text) {
      line += ` value="${_escapedText(option.value)}"`;
    }
    lines.push(line);
  }
}

function _nodeLineOf(node: SnapshotNode): string {
  const parts = [node.role];
  if (node.name !== "") {
    parts.push(`"${_escapedText(node.name)}"`);
  }
  if (node.refId !== null) {
    parts.push(`[ref=${node.refId}]`);
  }
  if (node.level !== null && node.level > 0) {
    parts.push(`[level=${String(node.level)}]`);
  }
  if (node.hidden) {
    parts.push("[hidden]");
  }
  if (node.offscreen) {
    parts.push("[offscreen]");
  }
  if (node.scrollable) {
    parts.push("[scrollable]");
  }
  if (node.checked) {
    parts.push("[checked]");
  }
  if (node.disabled) {
    parts.push("[disabled]");
  }
  if (node.focused) {
    parts.push("[focused]");
  }
  if (node.selected) {
    parts.push("[selected]");
  }
  if (node.placeholder !== null && node.placeholder !== "") {
    parts.push(`[placeholder="${_escapedText(node.placeholder)}"]`);
  }
  if (node.hints.length > 0) {
    parts.push(`[${node.hints.join(" ")}]`);
  }
  return parts.join(" ");
}

function _escapedText(text: string): string {
  return text.replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function _indentOf(depth: number): string {
  return "  ".repeat(depth);
}
