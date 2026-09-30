// Filling without submitting: the reversible half of a form. Each field
// is resolved by the reader's ref, guarded (secrets, files, disabled
// controls are refused with no way to opt out — the write-side twin of
// the snapshot's redaction), written through the element's own prototype
// setter with real input/change events (a React-controlled input ignores
// a bare .value assignment), and then read back: a value the page's own
// scripts rejected is reported as refused, never claimed as filled.
// Nothing here ever submits, clicks a button, or focuses past the field.

import { theFieldHoldsASecret } from "../reader/redaction.js";
import { resolvedElementOfRef } from "../reader/snapshot.js";
import { isContentEditableElement } from "../reader/roles.js";

export interface PrefillField {
  refId: string;
  value: string;
}

interface RefusedFieldReport {
  ref_id: string;
  reason: string;
}

/** The wire shape of PrefillFormResult, synthesized package-side. */
export interface PrefillReport {
  filled: string[];
  refused: RefusedFieldReport[];
}

const SECRET_FIELD_REASON =
  "This field holds a secret (a password or payment detail) — the user " +
  "must type it themselves.";
const FILE_FIELD_REASON =
  "File pickers cannot be filled by the assistant — the user must choose " +
  "the file themselves.";
const INERT_FIELD_REASON =
  "This field is disabled or read-only and cannot take a value right now.";
const NOT_FILLABLE_REASON =
  "This element is not a fillable form field — take a fresh read and " +
  "pick a textbox, dropdown, checkbox, or editor ref.";
const CHECKBOX_VALUE_REASON =
  'A checkbox takes "true" or "false", nothing else.';
const RADIO_VALUE_REASON =
  'A radio button can only be selected — pass "true" on the option to ' +
  "select instead.";
const NO_MATCHING_OPTION_REASON =
  "No option in this dropdown matches that value — read the page to see " +
  "the options it offers.";
const VALUE_DID_NOT_LAND_REASON =
  "The page's own scripts rejected this value — it did not stay in the " +
  "field.";
const EDITOR_UNAVAILABLE_REASON =
  "This editor cannot be filled on this page — tell the user what to " +
  "type instead.";

/**
 * Fill every requested field, one report entry per field — a batch is
 * never all-or-nothing: the fields that landed stay landed, and each
 * refusal carries its own actionable reason.
 */
export function prefilledFieldsReport(fields: PrefillField[]): PrefillReport {
  const report: PrefillReport = { filled: [], refused: [] };
  for (const field of fields) {
    const refusal = _filledFieldRefusalOf(field);
    if (refusal === null) {
      report.filled.push(field.refId);
    } else {
      report.refused.push({ ref_id: field.refId, reason: refusal });
    }
  }
  return report;
}

/** Fill one field; the refusal reason, or null when the value landed. */
function _filledFieldRefusalOf(field: PrefillField): string | null {
  const resolved = resolvedElementOfRef(field.refId);
  if (resolved.error !== null) {
    return resolved.error;
  }
  const element = resolved.element;
  if (element instanceof HTMLInputElement) {
    return _inputRefusalOf(element, field.value);
  }
  if (element instanceof HTMLTextAreaElement) {
    return _textAreaRefusalOf(element, field.value);
  }
  if (element instanceof HTMLSelectElement) {
    return _selectRefusalOf(element, field.value);
  }
  if (isContentEditableElement(element)) {
    return _editorRefusalOf(element, field.value);
  }
  return NOT_FILLABLE_REASON;
}

// --- inputs ------------------------------------------------------------------

const _NOT_A_FIELD_INPUT_TYPES = new Set([
  "hidden",
  "submit",
  "button",
  "reset",
  "image",
]);

function _inputRefusalOf(
  input: HTMLInputElement,
  value: string,
): string | null {
  if (input.type === "password" || theFieldHoldsASecret(input)) {
    return SECRET_FIELD_REASON;
  }
  if (input.type === "file") {
    return FILE_FIELD_REASON;
  }
  // Hidden inputs hold machine state the user never sees — writing one
  // would change what the form submits with nothing to review. The
  // button family is not a field at all: its value IS the visible
  // caption, so "filling" one would relabel a button.
  if (_NOT_A_FIELD_INPUT_TYPES.has(input.type)) {
    return NOT_FILLABLE_REASON;
  }
  if (input.disabled || input.readOnly) {
    return INERT_FIELD_REASON;
  }
  if (input.type === "checkbox" || input.type === "radio") {
    return _checkedRefusalOf(input, value);
  }
  _setThroughThePrototype(input, value);
  _announceTheEdit(input);
  return input.value === value ? null : VALUE_DID_NOT_LAND_REASON;
}

function _checkedRefusalOf(
  input: HTMLInputElement,
  value: string,
): string | null {
  if (value !== "true" && value !== "false") {
    return CHECKBOX_VALUE_REASON;
  }
  if (input.type === "radio" && value === "false") {
    return RADIO_VALUE_REASON;
  }
  const desired = value === "true";
  if (input.checked !== desired) {
    // A real click, not a checked assignment: it is the one event shape
    // every framework's change handling hears, and on a checkbox it is
    // still reversible prep — the user can click it right back.
    input.click();
  }
  return input.checked === desired ? null : VALUE_DID_NOT_LAND_REASON;
}

// --- textareas ----------------------------------------------------------------

function _textAreaRefusalOf(
  textArea: HTMLTextAreaElement,
  value: string,
): string | null {
  if (theFieldHoldsASecret(textArea)) {
    return SECRET_FIELD_REASON;
  }
  if (textArea.disabled || textArea.readOnly) {
    return INERT_FIELD_REASON;
  }
  _setThroughThePrototype(textArea, value);
  _announceTheEdit(textArea);
  return textArea.value === value ? null : VALUE_DID_NOT_LAND_REASON;
}

// --- selects --------------------------------------------------------------------

function _selectRefusalOf(
  select: HTMLSelectElement,
  value: string,
): string | null {
  if (select.disabled) {
    return INERT_FIELD_REASON;
  }
  const option = _optionMatching(select, value);
  if (option === null) {
    return NO_MATCHING_OPTION_REASON;
  }
  _setThroughThePrototype(select, option.value);
  _announceTheEdit(select);
  return select.value === option.value ? null : VALUE_DID_NOT_LAND_REASON;
}

function _optionMatching(
  select: HTMLSelectElement,
  value: string,
): HTMLOptionElement | null {
  const options = Array.from(select.options);
  // The model quotes what it saw: sometimes the option's value,
  // sometimes its visible label.
  return (
    options.find((option) => option.value === value) ??
    options.find((option) => option.label.trim() === value.trim()) ??
    null
  );
}

// --- contenteditable editors ----------------------------------------------------

function _editorRefusalOf(element: Element, value: string): string | null {
  // The caller established contenteditable; this narrows for focus().
  if (!(element instanceof HTMLElement)) {
    return EDITOR_UNAVAILABLE_REASON;
  }
  // execCommand is deprecated but is the one path that speaks a rich
  // editor's own language: it fires the beforeinput/input sequence the
  // editor's model listens to. jsdom has neither it nor selections.
  /* eslint-disable @typescript-eslint/no-deprecated -- no substitute
     fires an editor's own input pipeline; see the comment above. */
  if (typeof document.execCommand !== "function") {
    return EDITOR_UNAVAILABLE_REASON;
  }
  element.focus();
  const selection = window.getSelection();
  if (selection === null) {
    return EDITOR_UNAVAILABLE_REASON;
  }
  selection.selectAllChildren(element);
  document.execCommand("insertText", false, value);
  /* eslint-enable @typescript-eslint/no-deprecated -- back to the rule
     for everything below the editor write. */
  const landed = element.textContent.includes(value);
  return landed ? null : VALUE_DID_NOT_LAND_REASON;
}

// --- the write mechanics ---------------------------------------------------------

type ValueControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function _setThroughThePrototype(control: ValueControl, value: string): void {
  // React tracks a control's value on the instance to dedupe its own
  // synthetic events; writing through the prototype setter bypasses the
  // tracker so the input event below is heard as a real user edit.
  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(control) as object,
    "value",
  );
  if (descriptor?.set !== undefined) {
    descriptor.set.call(control, value);
  } else {
    control.value = value;
  }
}

function _announceTheEdit(control: ValueControl): void {
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
}
