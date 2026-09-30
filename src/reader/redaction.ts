// What a text control's current value contributes to the snapshot — and
// the always-on redaction gate in front of it. Passwords and fields
// whose autocomplete declares a secret (card numbers, one-time codes)
// never enter a snapshot; there is deliberately no way to turn this off.

import { isContentEditableElement } from "./roles.js";

export const REDACTED_VALUE = "[redacted]";

const SENSITIVE_AUTOCOMPLETE_VALUES = new Set([
  "cc-number",
  "cc-csc",
  "current-password",
  "new-password",
  "one-time-code",
]);

/**
 * The value a textbox-like element shows, redacted where it must be:
 * null when the element holds no readable value at all.
 */
export function textboxValueOf(element: Element): string | null {
  if (isContentEditableElement(element)) {
    // Not every engine implements innerText (jsdom); fall back honestly.
    const rendered: unknown = Reflect.get(element, "innerText");
    if (typeof rendered === "string") {
      return rendered;
    }
    return element.textContent;
  }
  if (
    !(element instanceof HTMLInputElement) &&
    !(element instanceof HTMLTextAreaElement)
  ) {
    return null;
  }
  if (element instanceof HTMLInputElement) {
    const type = element.type;
    // hidden inputs hold machine state the user never sees — CSRF tokens,
    // session blobs — so they never contribute a value, redacted or not
    // (they surface at all only under show_hidden). checkbox/radio/file
    // carry no readable text value either.
    if (
      type === "checkbox" ||
      type === "radio" ||
      type === "file" ||
      type === "hidden"
    ) {
      return null;
    }
    if (type === "password") {
      return element.value === "" ? "" : REDACTED_VALUE;
    }
  }
  if (theFieldHoldsASecret(element) && element.value !== "") {
    return REDACTED_VALUE;
  }
  return element.value;
}

/**
 * Whether a field's autocomplete declares a secret (card numbers,
 * passwords, one-time codes). One predicate for both directions: the
 * snapshot redacts what it reads, and prefill refuses what it would
 * write — the two guards must never disagree about what a secret is.
 */
export function theFieldHoldsASecret(
  element: HTMLInputElement | HTMLTextAreaElement,
): boolean {
  const autocomplete = (element.getAttribute("autocomplete") ?? "")
    .trim()
    .toLowerCase();
  if (autocomplete === "") {
    return false;
  }
  // autocomplete is a token list ("billing cc-number"); any secret token
  // marks the field, and every cc-exp variant counts.
  return autocomplete
    .split(/\s+/)
    .some(
      (token) =>
        SENSITIVE_AUTOCOMPLETE_VALUES.has(token) || token.startsWith("cc-exp"),
    );
}
