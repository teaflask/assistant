// Shared DOM vocabulary for the package's built-in tool views (rung 3,
// tool-views.md). Vanilla imperative adapters on purpose: the frozen
// registration table lives in core/tool-view.ts, which is
// runtime-React-free by design, and these views hold no local UI state
// — the canonical mount/update/destroy adapter costs nothing and keeps
// React out of the core closure. The directory is load-bearing: the
// Tailwind source scan is `@source "../components"` (styles.css), so
// utility classes referenced outside src/components are never emitted.
// The class strings are parts-classes.ts — the same vocabulary the React
// parts (parts.tsx) hand to host views, so ours and theirs are one look.

import type {
  ToolViewAdapter,
  ToolViewCall,
  ToolViewProps,
} from "../../core/tool-view.js";
import {
  BADGE_CLASS,
  BONES_CLASS,
  BONE_CLASS,
  CAPTION_ROW_CLASS,
  CARD_CLASS,
  CARD_TITLE_CLASS,
  FACT_LABEL_CLASS,
  FACT_LIST_CLASS,
  FACT_ROW_CLASS,
  FACT_VALUE_CLASS,
  LABEL_CLASS,
  NOTE_CLASS,
  PANE_CLASS,
  PANE_WRAPPER_CLASS,
  ROW_CLASS,
  ROW_ICON_CLASS,
  ROW_SECONDARY_CLASS,
  ROW_TEXT_CLASS,
  ROW_TITLE_CLASS,
  ROW_TRAIL_CLASS,
  SCROLL_REGION_CLASS,
  TERMINAL_CLASS,
  TERMINAL_OUTPUT_CLASS,
  TERMINAL_PROMPT_CLASS,
  TERMINAL_STDERR_CLASS,
} from "./parts-classes.js";

export { LABEL_CLASS, PANE_CLASS, PANE_WRAPPER_CLASS };

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== "") {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

/** A labeled mono pane — one honest block of recorded text on the muted
 *  ground, flush with its container: standalone it sits on the row like
 *  the file-edit view's diff panes; inside a card the caller insets it
 *  (docs-search). Never a second border. */
export function pane(label: string, text: string): HTMLElement {
  const wrapper = el("div", PANE_WRAPPER_CLASS);
  wrapper.append(el("p", LABEL_CLASS, label));
  const pre = el("pre", PANE_CLASS);
  pre.append(el("code", "tf:font-mono", text));
  wrapper.append(pre);
  return wrapper;
}

/** A command and its streams as one terminal block — `$ command`, then
 *  stdout, then stderr (quiet, never failure ink: stderr is routine). */
export function terminal(options: {
  command: string | null;
  output?: string;
  stderr?: string;
}): HTMLElement {
  const block = el("pre", TERMINAL_CLASS);
  block.dataset.tfTerminal = "";
  if (options.command !== null && options.command !== "") {
    const line = el("code", "");
    line.dataset.tfTerminalCommand = "";
    line.append(el("span", TERMINAL_PROMPT_CLASS, "$ "));
    line.append(document.createTextNode(options.command));
    block.append(line);
  }
  if (options.output !== undefined && options.output !== "") {
    const out = el(
      "code",
      TERMINAL_OUTPUT_CLASS,
      options.output.replace(/\n$/, ""),
    );
    out.dataset.tfTerminalOutput = "";
    block.append(out);
  }
  if (options.stderr !== undefined && options.stderr !== "") {
    const err = el(
      "code",
      TERMINAL_STDERR_CLASS,
      options.stderr.replace(/\n$/, ""),
    );
    err.dataset.tfTerminalStderr = "";
    block.append(err);
  }
  return block;
}

/** A bounded, scrolling region for a long list inside a card. */
export function scrollRegion(children: readonly HTMLElement[]): HTMLElement {
  const region = el("div", SCROLL_REGION_CLASS);
  region.dataset.tfScrollRegion = "";
  region.append(...children);
  return region;
}

/** The hairline card every built-in composes its content into. */
export function card(
  children: readonly HTMLElement[],
  title?: string,
): HTMLElement {
  const wrapper = el("div", "");
  if (title !== undefined) {
    wrapper.append(el("p", CARD_TITLE_CLASS, title));
  }
  const body = el("div", CARD_CLASS);
  body.dataset.tfToolViewCard = "";
  body.append(...children);
  wrapper.append(body);
  return wrapper;
}

/** One list row: an optional icon tile, a title line, a muted second
 *  line, and trailing content (a badge, a fact). */
export function listRow(options: {
  title: string;
  secondary?: string;
  trailing?: HTMLElement | string;
  icon?: Element;
  below?: HTMLElement;
}): HTMLElement {
  const row = el("div", ROW_CLASS);
  if (options.icon !== undefined) {
    const tile = el("span", ROW_ICON_CLASS);
    tile.append(options.icon);
    row.append(tile);
  }
  const text = el("span", ROW_TEXT_CLASS);
  text.append(el("span", ROW_TITLE_CLASS, options.title));
  if (options.secondary !== undefined && options.secondary !== "") {
    text.append(el("span", ROW_SECONDARY_CLASS, options.secondary));
  }
  if (options.below !== undefined) {
    text.append(options.below);
  }
  row.append(text);
  if (options.trailing !== undefined) {
    const trail = el("span", ROW_TRAIL_CLASS);
    trail.append(options.trailing);
    row.append(trail);
  }
  return row;
}

/** Property rows: a muted label column and a value column. */
export function factRows(
  facts: readonly (readonly [label: string, value: string | HTMLElement])[],
): HTMLElement {
  const list = el("dl", FACT_LIST_CLASS);
  for (const [label, value] of facts) {
    const row = el("div", FACT_ROW_CLASS);
    row.append(el("dt", FACT_LABEL_CLASS, label));
    const dd = el("dd", FACT_VALUE_CLASS);
    dd.append(value);
    row.append(dd);
    list.append(row);
  }
  return list;
}

/** A quiet caption row inside a card, with optional trailing content. */
export function captionRow(
  text: string,
  trailing?: HTMLElement | string,
): HTMLElement {
  const row = el("div", CAPTION_ROW_CLASS);
  row.append(el("span", "tf:min-w-0", text));
  if (trailing !== undefined) {
    const trail = el("span", "tf:shrink-0");
    trail.append(trailing);
    row.append(trail);
  }
  return row;
}

/** A trailing badge on a list row — the vanilla twin of ToolViewBadge,
 *  for the wait on a built-in's proposal row. */
export function badge(text: string): HTMLElement {
  return el("span", BADGE_CLASS, text);
}

/** Skeleton lines where the result will land — pending is a shape. */
export function boneRows(count: number): HTMLElement {
  const wrapper = el("div", BONES_CLASS);
  wrapper.setAttribute("aria-hidden", "true");
  for (let index = 0; index < count; index += 1) {
    wrapper.append(
      el("span", `${BONE_CLASS} ${index === 0 ? "tf:w-1/2" : "tf:w-full"}`),
    );
  }
  return wrapper;
}

/** One quiet sentence in the muted register — for what is absent,
 *  degraded, or not renderable, never for invented structure. */
export function note(text: string): HTMLElement {
  return el("p", NOTE_CLASS, text);
}

export function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function stringOf(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * The lifecycle factory every built-in rides: `render` is a pure
 * function of the props, so a full re-render IS the contract's
 * update-in-place — the state the update law protects is state these
 * views deliberately don't hold. A throw from `render` propagates as
 * the adapter's one failure channel and the slot advances a rung.
 */
export function statelessToolView(
  render: (props: ToolViewProps) => HTMLElement,
): ToolViewAdapter {
  return {
    mount(container, props) {
      container.replaceChildren(render(props));
      return {
        update(next) {
          container.replaceChildren(render(next));
        },
        destroy() {
          container.replaceChildren();
        },
      };
    },
  };
}

/** True when the call settled cleanly with its own recorded output —
 *  the only state in which a built-in may draw a result shape. */
export function settledWithResult(call: ToolViewCall): boolean {
  return call.status === "output-available" && call.offloaded !== true;
}

/**
 * The honesty ladder every built-in applies before any success shape:
 * a call that didn't finish cleanly never wears success furniture, and
 * a result the transcript doesn't hold is said to be missing, never
 * invented. The row narrates these states with richer copy of its own
 * (the pill, the refusal reason, the error pane).
 *
 * REACHABILITY, recorded (re-derived from this function's own switch):
 * the refused, output-error, denied, cancelled, superseded and offloaded
 * arms are REACHABLE in production — tool-row no longer gates output, so
 * a view mounts for the call's whole lifecycle while the view model
 * withholds output on exactly these settles. A still-RUNNING call
 * renders none of them: input-streaming and input-available break out to
 * the empty list below. That is the difference from the action view's
 * deleted ok:false arm, which needed output-available PLUS a failure
 * envelope — a pairing the producers can never emit under any gating.
 */
export function settledOutcomeNotesOf(call: ToolViewCall): HTMLElement[] {
  const sentence = settledOutcomeNoteOf(call);
  return sentence === null ? [] : [note(sentence)];
}

/** The same honesty ladder as one sentence, for React hosts that render
 *  text rather than package DOM — the vocabulary exists once. */
export function settledOutcomeNoteOf(call: ToolViewCall): string | null {
  switch (call.status) {
    case "refused":
      return "Declined — the call didn't run.";
    case "output-error":
      return "Failed — no result to render.";
    case "denied":
      return "Not approved — the call didn't run.";
    case "cancelled":
      return "This call didn't run.";
    case "superseded":
      return "Interrupted — the result never arrived.";
    case "input-streaming":
    case "input-available":
    case "output-available":
      break;
  }
  if (call.offloaded === true) {
    return "The result was replaced by a shortened preview and isn't rendered here.";
  }
  return null;
}

/** An action call's recorded response: the http_intent success envelope
 *  `{"ok": true, "result": {status, body, truncated}}` that
 *  tool_return_of (toolresultv1.py) serializes whole into resultText.
 *  The core unwrapper hands `call.result` the BODY alone, so the HTTP
 *  status is recoverable only here. Null for anything that is not
 *  exactly this envelope (ok:false shapes included) — a view then says
 *  so, never guesses. Authored knowledge of our own tool's format,
 *  exported so hosts re-use it instead of respelling the parse. */
export interface ActionEnvelope {
  status: number | null;
  body: unknown;
  truncated: boolean;
}

export function actionEnvelopeOf(
  resultText: string | undefined,
): ActionEnvelope | null {
  if (resultText === undefined) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultText);
  } catch {
    return null;
  }
  const envelope = recordOf(parsed);
  if (envelope?.ok !== true) {
    return null;
  }
  const result = recordOf(envelope.result);
  if (result === null) {
    return null;
  }
  return {
    status: typeof result.status === "number" ? result.status : null,
    body: result.body,
    truncated: result.truncated === true,
  };
}

/** A failed action call's recorded reason: the failure envelope
 *  `{"ok": false, "error": {code, message, detail?}, instruction}` that
 *  tool_return_of serializes into the call's error text. `detail` is the
 *  API's own account when the adapter's error carried one
 *  (execution-kinds.ts ExecutionFailureDetail). Null for any other text
 *  — the row's own error pane still shows the raw reason. */
export interface ActionFailure {
  message: string;
  detail: {
    status: number;
    code: string;
    fields: { path: string; message: string }[];
    /** Problems the API named beyond `fields` — the producer's cap or
     *  door fit dropped them from the tail (execution-handlers.ts);
     *  present only when positive, so a partial list never reads whole. */
    fieldsOmitted?: number;
  } | null;
}

export function actionFailureOf(
  errorText: string | undefined,
): ActionFailure | null {
  if (errorText === undefined) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(errorText);
  } catch {
    // The transcript's error channel carries the SENTENCE alone (the
    // mapper keeps error.message): the facts ride in its words.
    return { message: errorText, detail: _failureDetailInSentence(errorText) };
  }
  const envelope = recordOf(parsed);
  if (envelope?.ok !== false) {
    return null;
  }
  const error = recordOf(envelope.error);
  const message = error === null ? null : stringOf(error.message);
  if (message === null) {
    return null;
  }
  return {
    message,
    detail:
      _failureDetailRecordOf(error?.detail) ??
      _failureDetailInSentence(message),
  };
}

/** The failure sentence's grammar, exactly as execution-handlers.ts
 *  writes it: after the frame's own words, a three-digit status (the
 *  producer admits 100–599 and nothing else) and a whitespace-free code
 *  (any casing or punctuation the API spells) before the dash; then the field clause — each path and message a JSON string
 *  literal, `"path": "message"` or a bare `"message"`, joined by "; " —
 *  closed by the model-facing tail. A clause that does not tokenize to
 *  the end is not the producer's and yields no fields, never a guess. */
const SENTENCE_STATUS = / failed in this page: HTTP (\d{3}) (\S{1,80}) — /;
const FIELDS_CLAUSE_OPEN = "Field problems: ";
const FIELDS_CLAUSE_CLOSE = ". Do not assume";
const JSON_STRING_LITERAL = /^"(?:[^"\\]|\\.)*"/;

/** The status, code and field problems as the failure sentence spells
 *  them (execution-handlers.ts) — null when the sentence names none. */
function _failureDetailInSentence(sentence: string): ActionFailure["detail"] {
  const status = SENTENCE_STATUS.exec(sentence);
  if (status === null) {
    return null;
  }
  const clause = _fieldsInClauseOf(sentence);
  return {
    status: Number(status[1]),
    code: status[2],
    fields: clause.fields,
    ...(clause.omitted > 0 ? { fieldsOmitted: clause.omitted } : {}),
  };
}

const NO_FIELDS = { fields: [], omitted: 0 };
const OMITTED_TAIL = /^; and (\d+) more/;

function _fieldsInClauseOf(sentence: string): {
  fields: { path: string; message: string }[];
  omitted: number;
} {
  const open = sentence.indexOf(FIELDS_CLAUSE_OPEN);
  if (open === -1) {
    return NO_FIELDS;
  }
  const fields: { path: string; message: string }[] = [];
  let at = open + FIELDS_CLAUSE_OPEN.length;
  for (;;) {
    const first = _jsonStringAt(sentence, at);
    if (first === null) {
      return NO_FIELDS;
    }
    at += first.length;
    let path = "";
    let message = _decodedStringOf(first);
    if (sentence.startsWith(": ", at)) {
      const second = _jsonStringAt(sentence, at + 2);
      if (second === null) {
        return NO_FIELDS;
      }
      path = message ?? "";
      message = _decodedStringOf(second);
      at += 2 + second.length;
    }
    if (message === null) {
      return NO_FIELDS;
    }
    fields.push({ path, message });
    const tail = OMITTED_TAIL.exec(sentence.slice(at));
    if (tail !== null) {
      at += tail[0].length;
      return sentence.startsWith(FIELDS_CLAUSE_CLOSE, at)
        ? { fields, omitted: Number(tail[1]) }
        : NO_FIELDS;
    }
    if (sentence.startsWith(FIELDS_CLAUSE_CLOSE, at)) {
      return { fields, omitted: 0 };
    }
    if (!sentence.startsWith("; ", at)) {
      return NO_FIELDS;
    }
    at += 2;
  }
}

function _jsonStringAt(text: string, at: number): string | null {
  return JSON_STRING_LITERAL.exec(text.slice(at))?.[0] ?? null;
}

/** A literal the producer never writes (a raw control character inside
 *  the quotes) decodes to nothing rather than throwing. */
function _decodedStringOf(literal: string): string | null {
  try {
    const decoded: unknown = JSON.parse(literal);
    return typeof decoded === "string" ? decoded : null;
  } catch {
    return null;
  }
}

function _failureDetailRecordOf(value: unknown): ActionFailure["detail"] {
  const detail = recordOf(value);
  if (detail === null) {
    return null;
  }
  const code = stringOf(detail.code);
  if (typeof detail.status !== "number" || code === null) {
    return null;
  }
  const fields: { path: string; message: string }[] = [];
  if (Array.isArray(detail.fields)) {
    for (const entry of detail.fields) {
      const field = recordOf(entry);
      const path = field === null ? null : stringOf(field.path);
      const message = field === null ? null : stringOf(field.message);
      if (path !== null && message !== null) {
        fields.push({ path, message });
      }
    }
  }
  const omitted = detail.fieldsOmitted;
  return {
    status: detail.status,
    code,
    fields,
    ...(typeof omitted === "number" && Number.isInteger(omitted) && omitted > 0
      ? { fieldsOmitted: omitted }
      : {}),
  };
}

/** The member-facing sentence of a recorded failure: the failure
 *  envelope's message with its model-facing parts removed — the
 *  "HTTP 422 CODE — " prefix, the "Field problems: …" clause and the
 *  "Do not assume …" tail — or the error text itself when it is not the
 *  envelope. The status, code and fields stay machine facts a view reads
 *  through actionFailureOf; a row never prints wire vocabulary at a
 *  member. */
export function humanFailureSentenceOf(errorText: string): string {
  const failure = actionFailureOf(errorText);
  const sentence = failure === null ? errorText : failure.message;
  return _beforeMarker(
    _beforeMarker(sentence, " Do not assume"),
    " Field problems:",
  )
    .replace(SENTENCE_STATUS, " failed in this page: ")
    .trim();
}

function _beforeMarker(text: string, marker: string): string {
  const at = text.indexOf(marker);
  return at === -1 ? text : text.slice(0, at);
}

/** A document glyph for a row's icon tile (the package's file mark, as
 *  an inline SVG so vanilla built-ins carry no icon dependency). */
export function fileGlyph(): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "tf:size-3.5");
  for (const d of [
    "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z",
    "M14 2v4a2 2 0 0 0 2 2h4",
    "M10 9H8",
    "M16 13H8",
    "M16 17H8",
  ]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
