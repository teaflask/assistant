// Accessible-name computation, W3C-accname-shaped: the label a user
// (or assistive tech) would know an element by. Precedence walks from
// author overrides (aria-labelledby, aria-label) through native labeling
// (label elements, alt, captions) down to content and tooltips. Results
// are cached per snapshot pass — the walk asks for the same names many
// times — and capped at 300 characters.

import type { LayoutProbe } from "./layout-probe.js";
import { roleOf } from "./roles.js";

const MAX_NAME_DEPTH = 10;
const MAX_NAME_LENGTH = 300;

// Roles that take their name from their contents.
const NAME_FROM_CONTENT_ROLES = new Set([
  "button",
  "link",
  "heading",
  "cell",
  "columnheader",
  "rowheader",
  "tooltip",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "treeitem",
  "option",
  "listitem",
  "row",
  "term",
]);

// Roles for which naming is prohibited outright — a bare div (generic)
// has no accessible name, which is what lets the reader tell a labeled
// control from an anonymous wrapper.
const PROHIBITS_NAMING = new Set([
  "caption",
  "code",
  "definition",
  "deletion",
  "emphasis",
  "generic",
  "insertion",
  "mark",
  "paragraph",
  "presentation",
  "strong",
  "subscript",
  "superscript",
  "term",
  "time",
]);

const NATIVELY_LABELABLE_TAGS = new Set([
  "input",
  "textarea",
  "select",
  "meter",
  "progress",
  "output",
]);

interface NameComputationState {
  depth: number;
  visited: Set<Element>;
  inLabelledBy: boolean;
  inLabel: boolean;
  /** Inside a name-from-content descent, every child names from content. */
  inContent: boolean;
}

export type AccessibleNameCache = Map<Element, string>;

export function accessibleNameOf(
  element: Element,
  probe: LayoutProbe,
  cache: AccessibleNameCache,
): string {
  const cached = cache.get(element);
  if (cached !== undefined) {
    return cached;
  }
  let name = "";
  if (!PROHIBITS_NAMING.has(roleOf(element))) {
    name = _computedNameOf(element, probe, {
      depth: 0,
      visited: new Set(),
      inLabelledBy: false,
      inLabel: false,
      inContent: false,
    });
  }
  name = name.replace(/\s+/g, " ").trim().substring(0, MAX_NAME_LENGTH);
  cache.set(element, name);
  return name;
}

function _computedNameOf(
  element: Element,
  probe: LayoutProbe,
  state: NameComputationState,
): string {
  if (state.depth >= MAX_NAME_DEPTH || state.visited.has(element)) {
    return "";
  }
  state.visited.add(element);

  if (
    !state.inLabelledBy &&
    !state.inLabel &&
    _isHiddenForNaming(element, probe)
  ) {
    return "";
  }

  if (!state.inLabelledBy) {
    const labelledBy = _labelledByNameOf(element, probe, state);
    if (labelledBy !== "") {
      return labelledBy;
    }
  }

  const ariaLabel = (element.getAttribute("aria-label") ?? "").trim();
  if (ariaLabel !== "") {
    return ariaLabel;
  }

  if (
    NATIVELY_LABELABLE_TAGS.has(element.tagName.toLowerCase()) &&
    !state.inLabel &&
    !state.inLabelledBy
  ) {
    const fromLabels = _nativeLabelNameOf(element, probe, state);
    if (fromLabels !== "") {
      return fromLabels;
    }
  }

  const alt = _altNameOf(element);
  if (alt !== null) {
    return alt;
  }

  const fromCaption = _captionNameOf(element, probe, state);
  if (fromCaption !== "") {
    return fromCaption;
  }

  if (element instanceof HTMLSelectElement && element.selectedIndex >= 0) {
    const selected = element.options[element.selectedIndex] as
      HTMLOptionElement | undefined;
    const text = (selected?.textContent ?? "").trim();
    if (text !== "") {
      return text;
    }
  }

  if (
    NAME_FROM_CONTENT_ROLES.has(roleOf(element)) ||
    state.inLabelledBy ||
    state.inLabel ||
    state.inContent
  ) {
    const fromContent = _contentNameOf(element, probe, state);
    if (fromContent !== "") {
      return fromContent;
    }
  }

  if (
    element instanceof HTMLInputElement &&
    (element.type === "submit" || element.type === "button")
  ) {
    const value = element.value.trim();
    if (value !== "") {
      return value;
    }
  }

  const placeholder = (element.getAttribute("placeholder") ?? "").trim();
  if (placeholder !== "") {
    return placeholder;
  }

  return (element.getAttribute("title") ?? "").trim();
}

function _labelledByNameOf(
  element: Element,
  probe: LayoutProbe,
  state: NameComputationState,
): string {
  const references = _idReferencesOf(
    element,
    element.getAttribute("aria-labelledby"),
  );
  const parts = references.map((reference) =>
    _computedNameOf(reference, probe, {
      depth: state.depth + 1,
      visited: new Set(state.visited),
      inLabelledBy: true,
      inLabel: state.inLabel,
      inContent: false,
    }),
  );
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function _nativeLabelNameOf(
  element: Element,
  probe: LayoutProbe,
  state: NameComputationState,
): string {
  const parts = _labelsOf(element).map((label) =>
    _computedNameOf(label, probe, {
      depth: state.depth + 1,
      visited: new Set(state.visited),
      inLabelledBy: state.inLabelledBy,
      inLabel: true,
      inContent: false,
    }),
  );
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function _altNameOf(element: Element): string | null {
  const tag = element.tagName.toLowerCase();
  const eligible =
    tag === "area" ||
    tag === "img" ||
    (tag === "input" && element.getAttribute("type") === "image");
  if (!eligible) {
    return null;
  }
  const alt = element.getAttribute("alt");
  // A present-but-empty alt is "purely decorative" and short-circuits.
  return alt === null ? null : alt.trim();
}

function _captionNameOf(
  element: Element,
  probe: LayoutProbe,
  state: NameComputationState,
): string {
  const tag = element.tagName.toLowerCase();
  const captionSelector =
    tag === "fieldset"
      ? ":scope > legend"
      : tag === "figure"
        ? ":scope > figcaption"
        : tag === "table"
          ? ":scope > caption"
          : null;
  if (captionSelector === null) {
    return "";
  }
  const caption = element.querySelector(captionSelector);
  if (caption === null) {
    return "";
  }
  return _computedNameOf(caption, probe, {
    depth: state.depth + 1,
    visited: new Set(state.visited),
    inLabelledBy: true,
    inLabel: state.inLabel,
    inContent: false,
  });
}

function _contentNameOf(
  element: Element,
  probe: LayoutProbe,
  state: NameComputationState,
): string {
  const parts: string[] = [probe.pseudoContentOf(element, "::before")];
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      parts.push(child.textContent ?? "");
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      parts.push(
        _computedNameOf(child as Element, probe, {
          depth: state.depth + 1,
          visited: new Set(state.visited),
          inLabelledBy: state.inLabelledBy,
          inLabel: state.inLabel,
          inContent: true,
        }),
      );
    }
  }
  parts.push(probe.pseudoContentOf(element, "::after"));
  // No separator: inline fragments carry their own whitespace, and a
  // forced space would split words that wrap in nested spans.
  return parts.join("").replace(/\s+/g, " ").trim();
}

function _isHiddenForNaming(element: Element, probe: LayoutProbe): boolean {
  if (element.getAttribute("aria-hidden") === "true") {
    return true;
  }
  const style = probe.styleOf(element);
  return style.display === "none" || style.visibility === "hidden";
}

function _idReferencesOf(
  element: Element,
  attributeValue: string | null,
): Element[] {
  if (attributeValue === null || attributeValue === "") {
    return [];
  }
  const documentOf = element.ownerDocument;
  return attributeValue
    .split(/\s+/)
    .filter((id) => id !== "")
    .map((id) => documentOf.getElementById(id))
    .filter((referenced): referenced is HTMLElement => referenced !== null);
}

function _labelsOf(element: Element): Element[] {
  const labels: Element[] = [];
  const id = element.getAttribute("id");
  if (id !== null && id !== "") {
    labels.push(..._labelsWiredTo(element.ownerDocument, id));
  }
  for (
    let parent = element.parentElement;
    parent !== null;
    parent = parent.parentElement
  ) {
    if (parent.tagName.toLowerCase() === "label") {
      // A label that both wraps its control and names it via for= is
      // one label, not two — collecting it twice would double the name.
      if (!labels.includes(parent)) {
        labels.push(parent);
      }
      break;
    }
  }
  return labels;
}

function _labelsWiredTo(documentOf: Document, id: string): Element[] {
  // Inside a double-quoted CSS string only the quote and the backslash
  // are meta — both must be escaped, or an id ending in a backslash eats
  // the closing quote and the selector throws. The fence upholds the
  // reader's invariant: an unselectable id costs one label, never the
  // whole read.
  const escaped = id.replace(/[\\"]/g, "\\$&");
  try {
    return Array.from(documentOf.querySelectorAll(`label[for="${escaped}"]`));
  } catch {
    return [];
  }
}
