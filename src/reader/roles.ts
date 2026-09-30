// Role resolution for the page reader: which ARIA role a rendered
// element effectively carries. Explicit role attributes win when they
// name a real role; everything else falls back to the tag's implicit
// role. role="presentation"/"none" deliberately fall back too — sites
// slap presentation on styled tables and lists whose semantics the
// reader still wants. Pure attribute logic, no layout reads.

// Tag → implicit ARIA role, consulted when the element is not an input
// and not contentEditable.
const IMPLICIT_ROLE_BY_TAG: Record<string, string> = {
  a: "link",
  button: "button",
  iframe: "iframe",
  select: "combobox",
  textarea: "textbox",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  canvas: "canvas",
  svg: "image",
  img: "image",
  nav: "navigation",
  main: "main",
  header: "banner",
  footer: "contentinfo",
  section: "region",
  article: "article",
  aside: "complementary",
  form: "form",
  fieldset: "group",
  table: "table",
  ul: "list",
  ol: "list",
  li: "listitem",
  p: "paragraph",
  label: "label",
};

// An explicit role="…" is honored only when it names a role in this
// allowlist (first valid token wins).
const VALID_ARIA_ROLES = new Set([
  "alert",
  "alertdialog",
  "application",
  "article",
  "banner",
  "blockquote",
  "button",
  "caption",
  "cell",
  "checkbox",
  "code",
  "columnheader",
  "combobox",
  "complementary",
  "contentinfo",
  "definition",
  "deletion",
  "dialog",
  "directory",
  "document",
  "emphasis",
  "feed",
  "figure",
  "form",
  "generic",
  "grid",
  "gridcell",
  "group",
  "heading",
  "img",
  "insertion",
  "link",
  "list",
  "listbox",
  "listitem",
  "log",
  "main",
  "mark",
  "marquee",
  "math",
  "meter",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "navigation",
  "none",
  "note",
  "option",
  "paragraph",
  "presentation",
  "progressbar",
  "radio",
  "radiogroup",
  "region",
  "row",
  "rowgroup",
  "rowheader",
  "scrollbar",
  "search",
  "searchbox",
  "separator",
  "slider",
  "spinbutton",
  "status",
  "strong",
  "subscript",
  "superscript",
  "switch",
  "tab",
  "table",
  "tablist",
  "tabpanel",
  "term",
  "textbox",
  "time",
  "timer",
  "toolbar",
  "tooltip",
  "tree",
  "treegrid",
  "treeitem",
]);

// Roles whose nodes carry the bracketed state that matches the set.
const ARIA_LEVEL_ROLES = new Set(["heading", "listitem", "row", "treeitem"]);

export const ARIA_SELECTED_ROLES = new Set([
  "gridcell",
  "option",
  "row",
  "tab",
  "rowheader",
  "columnheader",
  "treeitem",
]);

export const ARIA_CHECKED_ROLES = new Set([
  "checkbox",
  "radio",
  "menuitemcheckbox",
  "menuitemradio",
  "switch",
]);

export const ARIA_DISABLED_ROLES = new Set([
  "application",
  "button",
  "composite",
  "gridcell",
  "group",
  "input",
  "link",
  "menuitem",
  "scrollbar",
  "separator",
  "tab",
  "checkbox",
  "columnheader",
  "combobox",
  "grid",
  "listbox",
  "menu",
  "menubar",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "radiogroup",
  "row",
  "rowheader",
  "searchbox",
  "select",
  "slider",
  "spinbutton",
  "switch",
  "tablist",
  "textbox",
  "toolbar",
  "tree",
  "treegrid",
  "treeitem",
]);

const NATIVE_HEADING_LEVELS: Record<string, number | undefined> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
};

/** The element's effective role: explicit when valid, implicit otherwise. */
export function roleOf(element: Element): string {
  const explicit = explicitRoleOf(element);
  if (explicit === null) {
    return _implicitRoleOf(element);
  }
  if (explicit === "presentation" || explicit === "none") {
    return _implicitRoleOf(element);
  }
  return explicit;
}

/** The first valid token of role="…", or null when none names a role. */
export function explicitRoleOf(element: Element): string | null {
  const tokens = (element.getAttribute("role") ?? "")
    .split(" ")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token !== "");
  return tokens.find((token) => VALID_ARIA_ROLES.has(token)) ?? null;
}

/** The heading/listitem/row/treeitem level, or null when the role has none. */
export function ariaLevelOf(element: Element, role: string): number | null {
  if (!ARIA_LEVEL_ROLES.has(role)) {
    return null;
  }
  if (role === "heading") {
    const native = NATIVE_HEADING_LEVELS[element.tagName.toLowerCase()];
    if (native !== undefined) {
      return native;
    }
  }
  const declared = Number(element.getAttribute("aria-level"));
  return Number.isInteger(declared) && declared >= 1 ? declared : null;
}

/** aria-* boolean tri-state: true / false / absent. */
export function ariaBooleanOf(attribute: string | null): boolean | undefined {
  if (attribute === null) {
    return undefined;
  }
  return attribute.toLowerCase() === "true";
}

function _implicitRoleOf(element: Element): string {
  const tag = element.tagName.toLowerCase();
  if (isContentEditableElement(element)) {
    return "textbox";
  }
  if (tag === "input") {
    const type = element.getAttribute("type");
    if (type === "submit" || type === "button" || type === "file") {
      return "button";
    }
    if (type === "checkbox") {
      return "checkbox";
    }
    if (type === "radio") {
      return "radio";
    }
    return "textbox";
  }
  return IMPLICIT_ROLE_BY_TAG[tag] ?? "generic";
}

/** Editable regions read as textboxes. The attribute fallback covers
 * engines that don't reflect the contentEditable property (jsdom). */
export function isContentEditableElement(element: Element): boolean {
  if (element instanceof HTMLElement) {
    const reflected = element.contentEditable;
    if (reflected === "true" || reflected === "plaintext-only") {
      return true;
    }
  }
  const attribute = element.getAttribute("contenteditable");
  return (
    attribute === "" || attribute === "true" || attribute === "plaintext-only"
  );
}
