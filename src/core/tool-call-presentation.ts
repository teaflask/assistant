// One presenter, many consumers: the transcript row, the
// resolved-action summary, the subagent current-work label and the
// tool-view slot all read ONE resolved presentation — consumers select
// slots, none reinterprets the raw display envelope (that would fork the
// fallback ladder). Unknown wire vocabulary collapses to the documented
// fallbacks here and only here, so a stored display survives a vocabulary
// the build predates. React-free by design.

import type { ToolCallState, ToolCallViewModel } from "./tool-call-display.js";
import { toolRowHeadlineOf } from "./tool-call-display.js";
import { toolResultEnvelopePayloadOf } from "./tool-result-envelope.js";
import type {
  ToolViewCall,
  ToolViewRegistry,
  ToolViewResolution,
} from "./tool-view.js";
import { STEP_CAPTION_ARG_KEY, withoutStepCaption } from "./step-caption.js";
import { resolvedToolViewsOf } from "./tool-view.js";

/** The semantic icon vocabulary — operational meaning, never a brand or
 *  a tool name. Open on the wire; unknown values resolve to "generic". */
export const TOOL_CALL_ICONS = [
  "search",
  "file",
  "terminal",
  "question",
  "memory",
  "delegation",
  "routine",
  "todo",
  "navigation",
  "generic",
] as const;

export type ToolCallIcon = (typeof TOOL_CALL_ICONS)[number];

/**
 * One tool call's resolved presentation — every consumer's single source.
 * Slots, and who reads them: the transcript row takes headline, icon and
 * status; resolved-action and provenance summaries take settledSummary;
 * subagent presence takes currentWorkLabel; toolView is the resolution
 * ladder's answer (tool-views.md) and the row's whole body — no raw
 * payload disclosure exists. The approval banner reads no slot.
 */
export interface ToolCallPresentation {
  /** The transcript row's words — the fallback ladder's answer:
   *  backend copy when the wire sent it, the mechanical
   *  protocol-state frame otherwise. */
  headline: string;
  icon: ToolCallIcon;
  status: ToolCallState;
  /** The line a settled call leaves behind — BY DEFINITION the resolved
   *  headline (the ladder's settled arms are the summary: completion
   *  copy, error copy or the failed frame, the refusal frame, the
   *  not-approved frame). The slot is named separately so summary
   *  consumers bind here, not to the row's wording; if the two are ever
   *  meant to differ, the divergence lands in this one resolver, never
   *  in a consumer. */
  settledSummary: string;
  /** The present-progressive "what it is doing now" line — the
   *  ladder's RUNNING arm regardless of the view's own state, so
   *  consumers need no state guard of their own. */
  currentWorkLabel: string;
  toolView: ToolViewResolution;
}

export function toolCallPresentationOf(
  view: ToolCallViewModel,
  registry?: ToolViewRegistry,
  options?: { awaitingDecision?: boolean },
): ToolCallPresentation {
  const headline = toolRowHeadlineOf(view);
  const resolved = resolvedToolViewsOf(
    view.display?.view,
    view.toolName,
    registry,
  );
  // The call is assembled LAZILY, memoized per presentation, and its
  // RESULT structures lazier still (see _toolViewCallOf): the row's slot
  // reads the call on every render, the default view reads args alone,
  // and a transcript re-renders every row per streamed token — so a
  // rung-4 row never structures its result, and the parse memo holds
  // only what a mounted view read. The getters keep the single-
  // resolution-point law: assembly still happens only here, on first read.
  let call: ToolViewCall | undefined;
  const awaitingDecision = options?.awaitingDecision === true;
  return {
    headline,
    icon: _iconOf(view.display?.icon),
    status: view.state,
    settledSummary: headline,
    currentWorkLabel: toolRowHeadlineOf({ ...view, state: "input-available" }),
    toolView: {
      views: resolved.views,
      icons: resolved.icons,
      get call(): ToolViewCall {
        call ??= _toolViewCallOf(view, awaitingDecision);
        return call;
      },
    },
  };
}

function _iconOf(token: string | undefined): ToolCallIcon {
  if (
    token !== undefined &&
    (TOOL_CALL_ICONS as readonly string[]).includes(token)
  ) {
    return token as ToolCallIcon;
  }
  return "generic";
}

/**
 * The tool-view call, assembled once here: parsing wire text into
 * renderable data is resolution, and it must not fork per consumer.
 * `context.themeMode` is deliberately NOT assembled here — it is the
 * slot's ambient fact (use-resolved-theme-mode.ts), not replay data.
 * `result` and `truncated` are lazy accessors over the verbatim
 * resultText: a settled result can run to the door's 20k and most rows
 * (rung 4, whose default view reads args alone) never look at it, so
 * the structuring parse happens on first read and once per call.
 * IDENTITY LAW: every value on the call is identity-stable across a
 * re-render with unchanged source, because the mount slot's structural
 * delivery guard rests on it. The member-by-member census:
 * docs/tool-call-contract.md, "The identity law".
 */
function _toolViewCallOf(
  view: ToolCallViewModel,
  awaitingDecision: boolean,
): ToolViewCall {
  const call: ToolViewCall = {
    toolName: view.toolName,
    toolCallId: view.toolCallId ?? "",
    status: view.state,
    awaitingDecision,
    args: _argsOf(view.argsText ?? view.input),
  };
  if (view.output !== undefined) {
    const output = view.output;
    call.resultText = output;
    let structured: StructuredResult | undefined;
    const structure = (): StructuredResult =>
      (structured ??= _structuredResultOf(output));
    Object.defineProperties(call, {
      result: {
        enumerable: true,
        configurable: true,
        get: () => structure().result,
      },
      truncated: {
        enumerable: true,
        configurable: true,
        get: () => structure().truncated,
      },
    });
  }
  if (view.offloaded === true) {
    call.offloaded = true;
  }
  if (view.errorText !== undefined) {
    call.errorText = view.errorText;
  }
  if (view.refusalText !== undefined) {
    call.refusalText = view.refusalText;
  }
  // Absent stays absent: a tool with no declared schema hands
  // the view `undefined`, never `{}` and never an invented one.
  if (view.argsSchema !== undefined) {
    call.argsSchema = view.argsSchema;
  }
  if (view.resultSchema !== undefined) {
    call.resultSchema = view.resultSchema;
  }
  return call;
}

interface StructuredResult {
  result?: unknown;
  truncated?: boolean;
}

/** The tool-result/v1 envelope unwrap (core/tool-result-envelope.ts): a
 *  {payload} box structures, null refuses — the wire's bytes were
 *  degraded to fit the size cap, and a complete-looking `result` over a
 *  cut payload would be a wrong claim; the honest flag rides instead,
 *  beside the verbatim resultText. Non-JSON output structures nothing. */
function _structuredResultOf(output: string): StructuredResult {
  const parsed = _jsonDocumentOf(output);
  if (parsed === undefined) {
    return {};
  }
  const box = toolResultEnvelopePayloadOf(parsed.document);
  return box === null ? { truncated: true } : { result: box.payload };
}

/** The one shared empty-args identity (see the identity law above). */
const EMPTY_ARGS: Record<string, unknown> = Object.freeze({});

/** The streamed arguments, parsed whole: a JSON record when complete,
 *  EMPTY_ARGS while the tail is still arriving or when the text is not
 *  a record — a view must never see half an argument object. */
function _argsOf(argsText: string): Record<string, unknown> {
  const parsed = _jsonDocumentOf(argsText);
  if (parsed === undefined || !_isRecord(parsed.document)) {
    return EMPTY_ARGS;
  }
  if (!(STEP_CAPTION_ARG_KEY in parsed.document)) {
    return parsed.document;
  }
  return _captionlessArgsOf(parsed.document);
}

// The reserved-key strip keeps the identity law: keyed on the memoized
// document, one caption-less copy per source text, the shared document
// itself never mutated.
const _captionlessArgs = new WeakMap<
  Record<string, unknown>,
  Record<string, unknown>
>();

function _captionlessArgsOf(
  document: Record<string, unknown>,
): Record<string, unknown> {
  const memoized = _captionlessArgs.get(document);
  if (memoized !== undefined) {
    return memoized;
  }
  const rest = withoutStepCaption(document);
  const args = Object.keys(rest).length === 0 ? EMPTY_ARGS : rest;
  _captionlessArgs.set(document, args);
  return args;
}

// The parse memo: identity by construction, keyed on the source text, so
// "same source text" and "same object" are one fact. The memoized document
// is SHARED across readers (never mutate what a call hands you); failures
// are not memoized; the cap is a wholesale reset, not an LRU
// (docs/tool-call-contract.md, "The parse memo").
const JSON_MEMO_MAX_ENTRIES = 512;
const _jsonMemo = new Map<string, { document: unknown }>();

/** JSON.parse behind a box, so a legitimately-null document stays
 *  distinguishable from "not JSON". */
function _jsonDocumentOf(text: string): { document: unknown } | undefined {
  const memoized = _jsonMemo.get(text);
  if (memoized !== undefined) {
    return memoized;
  }
  try {
    const parsed = { document: JSON.parse(text) as unknown };
    if (_jsonMemo.size >= JSON_MEMO_MAX_ENTRIES) {
      _jsonMemo.clear();
    }
    _jsonMemo.set(text, parsed);
    return parsed;
  } catch {
    return undefined;
  }
}

function _isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
