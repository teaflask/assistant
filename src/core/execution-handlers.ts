// What this client can execute, keyed by the request's kind —
// builtin.navigate for the host's router hookup, http_intent for the
// host's actions adapter, builtin.read_page / builtin.highlight /
// builtin.prefill_form served by the package itself, and the seam any
// future kind plugs into. A kind with no
// handler here is answered with the canned unsupported error rather than
// ignored: inside a single mount there is no other handler to defer to,
// and silence would park the turn for the whole wait window. Every error
// message is model-actionable prose telling the model what to do next —
// never a stack, never text derived from customer content.

import { spotlightElement } from "../affordances/highlight.js";
import {
  prefilledFieldsReport,
  type PrefillField,
} from "../affordances/prefill.js";
import type { ActionIntent } from "../contract/actions-adapter.js";
import type {
  HighlightResult,
  NavigateResult,
  PrefillFormResult,
  ReadPageResult,
} from "../contract/threads.js";
import type { HttpIntentResult } from "../generated/models/index.js";
import { openCompanionDrawer } from "./companion-drawer-flag.js";
import { browserLayoutProbe } from "../reader/layout-probe.js";
import {
  readPageResultOf,
  SnapshotUnavailableError,
} from "../reader/read-page.js";
import { resolvedElementOfRef } from "../reader/snapshot.js";
import { actionIntentOf } from "../transport/actions-adapter.js";
import {
  boundedTextOf,
  doorCostOfText,
  doorLengthCeilingOf,
} from "../transport/door-budget.js";
import type { ExecutionEntryModel } from "./execution-inbox.js";

export type ExecutionHandler = (
  entry: ExecutionEntryModel,
) => Promise<ExecutionOutcome>;

/** How the host takes the visitor to an app-relative path. */
export type HostNavigate = (path: string) => void | Promise<void>;

/** How the provider's wired adapter executes one action intent. */
export type ExecuteActionIntent = (
  intent: ActionIntent,
) => Promise<HttpIntentResult>;

// The kind vocabulary — and the outcome vocabulary with
// the canned kind-unsupported refusal — lives in core/execution-kinds.ts
// (a dependency-free leaf: the ./transcript projection
// entry's decision-anchor family reads MEMBER_ANSWERABLE_KINDS, and
// reading it through THIS module dragged the transport/reader/affordance
// imports below into a closure whose law is transport-free). Re-exported
// here so this module's consumers keep their one import site.
export {
  ASK_QUESTIONS_REQUEST_KIND,
  HIGHLIGHT_REQUEST_KIND,
  HTTP_INTENT_REQUEST_KIND,
  KIND_UNSUPPORTED_OUTCOME,
  MEMBER_ANSWERABLE_KINDS,
  NAVIGATE_REQUEST_KIND,
  PREFILL_FORM_REQUEST_KIND,
  READ_PAGE_REQUEST_KIND,
  type ExecutionOutcome,
} from "./execution-kinds.js";
import {
  HIGHLIGHT_REQUEST_KIND,
  HTTP_INTENT_REQUEST_KIND,
  NAVIGATE_REQUEST_KIND,
  PREFILL_FORM_REQUEST_KIND,
  READ_PAGE_REQUEST_KIND,
  type ExecutionFailureDetail,
  type ExecutionOutcome,
} from "./execution-kinds.js";

const UNUSABLE_PATH_OUTCOME: ExecutionOutcome = {
  ok: false,
  error: {
    code: "execution_failed",
    message:
      "The navigation request did not carry a usable path. Tell the user " +
      "where to go instead of retrying.",
  },
};

const UNUSABLE_INTENT_OUTCOME: ExecutionOutcome = {
  ok: false,
  error: {
    code: "execution_failed",
    message:
      "The action request did not carry a usable intent. Tell the user " +
      "what you were trying to do so they can do it themselves.",
  },
};

const UNUSABLE_REF_OUTCOME: ExecutionOutcome = {
  ok: false,
  error: {
    code: "execution_failed",
    message:
      "The request did not carry a usable ref_id. Read the page and use " +
      "a [ref=…] id from it.",
  },
};

const UNUSABLE_FIELDS_OUTCOME: ExecutionOutcome = {
  ok: false,
  error: {
    code: "execution_failed",
    message:
      "The prefill request did not carry usable fields. Each entry needs " +
      "a ref_id from your read of this page and a string value.",
  },
};

const FAILURE_REASON_MAX_CHARS = 300;

// Action failures are different from the page failures above: the reason
// is the API's own refusal message, WRITTEN FOR THE MODEL (the server's
// teach-back law — a 422 lists every offender, and the server budgets
// that list to ~12k door units), never a host stack trace. Tersing it to
// 300 chars would amputate the offender list the whole exchange exists
// to deliver, so it rides a door-sized bound instead.
const ACTION_FAILURE_REASON_MAX_ESCAPED_CHARS = 14_000;
// Two 20k ceilings sit downstream of this error object, and the tighter
// one is the carrier's: the tool-results door drops an error whose own
// JSON passes 20k (toolresultv1.py TOOL_RESULT_JSON_MAX_CHARS) for its
// canned too-large failure, whose instruction says the action ran; then
// the server wraps the error in the interrupt envelope
// `{"ok": false, "error": …, "instruction": "…"}` (failed_interrupt_
// response_of) and the AG-UI mapper clips THAT text at 20k
// (TOOL_RESULT_CONTENT_MAX_CHARS) — a clip mid-JSON collapses the whole
// failure to the generic sentence. So the error object is fitted against
// the cap less the envelope's proven overhead: 42 characters of frame
// punctuation plus the 165-character canned instruction, 207 in all,
// reserved at 1,024 for headroom (a longer instruction, the sanitizer's
// longer replacement tokens). The fit is measured as the door measures:
// the reason yields first, down to a floor that keeps the API's own
// words, then the field list from its tail — on the sentence and the
// detail together, since each field rides both.
const ACTION_FAILURE_ENVELOPE_RESERVE_DOOR_CHARS = 1_024;
const ACTION_FAILURE_PAYLOAD_MAX_DOOR_CHARS =
  20_000 - ACTION_FAILURE_ENVELOPE_RESERVE_DOOR_CHARS;
const ACTION_FAILURE_REASON_MIN_ESCAPED_CHARS = 2_000;

/**
 * The registry of kinds this mount can serve. A host that wired no
 * navigation hookup or actions adapter simply has no handler for that
 * kind — the driver answers the request with KIND_UNSUPPORTED_OUTCOME,
 * same as any kind this package has never heard of. read_page,
 * highlight, and prefill_form need no hookup at all: the package
 * operates on the page it is mounted in, so their handlers are always
 * present. threadId keys the reader's diff baseline —
 * the per-thread memory lives at module level in the reader, because
 * this map's identity churns with its React deps.
 */
export function executionHandlersFor(
  navigate: HostNavigate | null,
  executeActionIntent: ExecuteActionIntent | null,
  threadId: string,
): ReadonlyMap<string, ExecutionHandler> {
  const handlers = new Map<string, ExecutionHandler>();
  if (navigate !== null) {
    handlers.set(NAVIGATE_REQUEST_KIND, (entry) =>
      _navigateOutcomeOf(navigate, entry),
    );
  }
  if (executeActionIntent !== null) {
    handlers.set(HTTP_INTENT_REQUEST_KIND, (entry) =>
      _httpIntentOutcomeOf(executeActionIntent, entry),
    );
  }
  handlers.set(READ_PAGE_REQUEST_KIND, (entry) =>
    _readPageOutcomeOf(threadId, entry),
  );
  handlers.set(HIGHLIGHT_REQUEST_KIND, (entry) =>
    Promise.resolve(_highlightOutcomeOf(entry)),
  );
  handlers.set(PREFILL_FORM_REQUEST_KIND, (entry) =>
    Promise.resolve(_prefillFormOutcomeOf(entry)),
  );
  return handlers;
}

async function _navigateOutcomeOf(
  navigate: HostNavigate,
  entry: ExecutionEntryModel,
): Promise<ExecutionOutcome> {
  // The server's fence already validated the path; this narrowing is only
  // wire defense, so its failure text stays canned.
  const path = _appRelativePathOf(entry.action);
  if (path === null) {
    return UNUSABLE_PATH_OUTCOME;
  }
  try {
    await navigate(path);
  } catch (error) {
    return _navigationFailedOutcome(path, error);
  }
  // The visitor moved: the companion drawer is open at the destination.
  // Never on a refused path or a throwing host — only a navigation that
  // actually happened earns the conversation's return.
  openCompanionDrawer();
  // The package synthesizes the contract's strict NavigateResult itself —
  // a host callback can never malform the wire shape into a 422.
  const result: NavigateResult = { navigated: true, path };
  return { ok: true, result: { ...result } };
}

function _appRelativePathOf(
  action: Record<string, unknown> | null,
): string | null {
  const path = action?.path;
  if (typeof path !== "string" || !path.startsWith("/")) {
    return null;
  }
  return path;
}

function _navigationFailedOutcome(
  path: string,
  error: unknown,
): ExecutionOutcome {
  return {
    ok: false,
    error: {
      code: "execution_failed",
      message:
        `Navigation to "${path}" failed in this page: ` +
        `${_reasonSentenceOf(error)}. Do not assume the user moved; tell ` +
        "them the path so they can go there themselves.",
    },
  };
}

async function _httpIntentOutcomeOf(
  executeActionIntent: ExecuteActionIntent,
  entry: ExecutionEntryModel,
): Promise<ExecutionOutcome> {
  // The server built the intent from the vetted catalog row; this
  // narrowing is only wire defense, so its failure text stays canned and
  // the adapter is never invoked on a shape it can't trust.
  const intent = actionIntentOf(entry.intent);
  if (intent === null) {
    return UNUSABLE_INTENT_OUTCOME;
  }
  try {
    const result = await executeActionIntent(intent);
    // The package synthesizes the contract's strict HttpIntentResult
    // itself — an adapter can never malform the wire shape into a 422.
    return { ok: true, result: { ...result } };
  } catch (error) {
    return _actionFailedOutcome(intent, error);
  }
}

function _actionFailedOutcome(
  intent: ActionIntent,
  error: unknown,
): ExecutionOutcome {
  const detail = _failureDetailOf(error);
  const reason = _failureFirstLineOf(error);
  let omitted = detail?.fieldsOmitted ?? 0;
  // Every pass changes the candidate: the budget is clamped to the
  // bounded reason's real door cost before it shrinks, so a decrement
  // always drops at least one character, and a field drop is a change
  // by itself. Passes are therefore bounded by the field count plus the
  // reason's convergence — each reason pass removes at least a third of
  // the overshoot (a removed unit costs the ceiling at least a third of
  // what it cost the budget) — never by a budget's idle countdown.
  let reasonBudget = Math.min(
    ACTION_FAILURE_REASON_MAX_ESCAPED_CHARS,
    doorCostOfText(reason),
  );
  let fields = detail?.fields;
  for (;;) {
    const boundedReason = boundedTextOf(reason, reasonBudget);
    reasonBudget = doorCostOfText(boundedReason);
    const candidate = _actionFailureErrorOf(
      intent,
      detail === null
        ? null
        : {
            status: detail.status,
            code: detail.code,
            ...(fields === undefined ? {} : { fields }),
            ...(omitted > 0 ? { fieldsOmitted: omitted } : {}),
          },
      boundedReason,
    );
    const over =
      doorLengthCeilingOf(JSON.stringify(candidate)) -
      ACTION_FAILURE_PAYLOAD_MAX_DOOR_CHARS;
    if (over <= 0 || reasonBudget === 0) {
      return { ok: false, error: candidate };
    }
    if (reasonBudget > ACTION_FAILURE_REASON_MIN_ESCAPED_CHARS) {
      reasonBudget = Math.max(
        ACTION_FAILURE_REASON_MIN_ESCAPED_CHARS,
        reasonBudget - over,
      );
    } else if (fields !== undefined && fields.length > 1) {
      // Never below one: the first problem plus the count of the rest
      // always fits, and "and N more" keeps the list honest.
      fields = fields.slice(0, -1);
      omitted += 1;
    } else {
      reasonBudget = Math.max(0, reasonBudget - over);
    }
  }
}

function _actionFailureErrorOf(
  intent: ActionIntent,
  detail: ExecutionFailureDetail | null,
  reason: string,
): Extract<ExecutionOutcome, { ok: false }>["error"] {
  return {
    code: "execution_failed",
    message:
      `"${intent.action.title}" failed in this page: ` +
      `${_detailPrefixOf(detail)}${reason}. ` +
      _fieldProblemsSentenceOf(detail) +
      "Do not assume the action ran; tell " +
      "the user what was being attempted so they can decide what to do.",
    ...(detail === null ? {} : { detail }),
  };
}

/** The status and code inside the sentence too — the mapper keeps only
 *  the sentence for the transcript's error channel, so the facts must
 *  survive in words ("HTTP 422 VALIDATION_ERROR — …"). */
function _detailPrefixOf(detail: ExecutionFailureDetail | null): string {
  return detail === null
    ? ""
    : `HTTP ${String(detail.status)} ${detail.code} — `;
}

/** The field clause's grammar, exact by construction: every path and
 *  message rides as a JSON string literal, so a colon, a semicolon or a
 *  quote inside the API's own words can never read as a delimiter, and a
 *  path-less problem is one bare literal — `"body.title": "Field
 *  required"; "Something: happened"`. The reader (view-dom.ts) tokenizes
 *  exactly this. */
function _fieldProblemsSentenceOf(
  detail: ExecutionFailureDetail | null,
): string {
  if (detail?.fields === undefined || detail.fields.length === 0) {
    return "";
  }
  const problems = detail.fields
    .map((field) =>
      field.path === ""
        ? JSON.stringify(field.message)
        : `${JSON.stringify(field.path)}: ${JSON.stringify(field.message)}`,
    )
    .join("; ");
  const omitted =
    detail.fieldsOmitted === undefined || detail.fieldsOmitted <= 0
      ? ""
      : `; and ${String(detail.fieldsOmitted)} more`;
  return `Field problems: ${problems}${omitted}. `;
}

/** The bounds on what an adapter's typed error may add to the failure —
 *  per member; the whole payload is then fitted to the door's cap above. */
const FAILURE_DETAIL_MAX_FIELDS = 20;
const FAILURE_DETAIL_CODE_MAX_CHARS = 80;
const FAILURE_DETAIL_FIELD_MAX_CHARS = 300;

/** The one grammar a code must fit to ride the sentence whole: a
 *  whitespace-free token, whatever the API's casing or punctuation
 *  (VALIDATION_ERROR, doc.slug-taken, e42), so the reader's
 *  `HTTP <status> <code> — ` split (view-dom.ts) is exact. A code with
 *  whitespace fits no sentence: the detail is dropped whole and the
 *  reason still rides verbatim. */
const FAILURE_CODE_TOKEN = /^\S{1,80}$/;

/** A status the sentence can carry is an HTTP one — an integer in
 *  100–599, the reader's three-digit grammar (view-dom.ts). A host
 *  adapter's 0 (a network failure), a fraction or a made-up 1000 is no
 *  HTTP fact: the detail is dropped whole and the reason rides alone. */
function _isHttpStatus(status: unknown): status is number {
  return (
    typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599
  );
}

/**
 * The API's own account of the failure, read off the adapter's thrown
 * error when it is shaped like an HTTP error envelope — a numeric
 * `status` beside an `error: {code, message, details?}` record (the
 * shape teaflask's own dashboard client throws, and a natural one for
 * any adapter over a typed API). Duck-typed on purpose: the package
 * imports no host. `details` contributes only when it is a list of
 * `{path|loc|field, message|msg}` records; anything else is dropped,
 * never guessed at.
 */
function _failureDetailOf(error: unknown): ExecutionFailureDetail | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const status = (error as { status?: unknown }).status;
  const body = (error as { error?: unknown }).error;
  if (
    !_isHttpStatus(status) ||
    typeof body !== "object" ||
    body === null ||
    typeof (body as { code?: unknown }).code !== "string"
  ) {
    return null;
  }
  const code = (body as { code: string }).code.slice(
    0,
    FAILURE_DETAIL_CODE_MAX_CHARS,
  );
  if (!FAILURE_CODE_TOKEN.test(code)) {
    return null;
  }
  const named = _failureFieldsOf((body as { details?: unknown }).details);
  if (named === null) {
    return { status, code };
  }
  return {
    status,
    code,
    fields: named.fields,
    ...(named.omitted > 0 ? { fieldsOmitted: named.omitted } : {}),
  };
}

/** The API's usable problems — the first FAILURE_DETAIL_MAX_FIELDS kept,
 *  the rest COUNTED, so the cap never passes a partial list off as the
 *  whole. Null when the API named none. */
function _failureFieldsOf(
  details: unknown,
): { fields: { path: string; message: string }[]; omitted: number } | null {
  if (!Array.isArray(details)) {
    return null;
  }
  const fields: { path: string; message: string }[] = [];
  let omitted = 0;
  for (const entry of details) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const message = record.message ?? record.msg;
    if (typeof message !== "string") {
      continue;
    }
    const sentenceMessage = _sentenceTextOf(message);
    if (sentenceMessage === "") {
      continue;
    }
    if (fields.length >= FAILURE_DETAIL_MAX_FIELDS) {
      omitted += 1;
      continue;
    }
    fields.push({
      path: _fieldPathOf(record.path ?? record.loc ?? record.field),
      message: sentenceMessage,
    });
  }
  return fields.length === 0 ? null : { fields, omitted };
}

function _fieldPathOf(path: unknown): string {
  if (typeof path === "string") {
    return _sentenceTextOf(path);
  }
  if (Array.isArray(path)) {
    return _sentenceTextOf(
      path
        .filter((part) => typeof part === "string" || typeof part === "number")
        .map(String)
        .join("."),
    );
  }
  return "";
}

/** A field's path or message as the sentence can carry it: one line,
 *  whitespace runs collapsed, bounded — the same text rides the JSON
 *  detail, so the two carriers never disagree. */
function _sentenceTextOf(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, FAILURE_DETAIL_FIELD_MAX_CHARS);
}

function _readPageOutcomeOf(
  threadId: string,
  entry: ExecutionEntryModel,
): Promise<ExecutionOutcome> {
  try {
    // The package synthesizes the contract's strict ReadPageResult
    // itself (readPageResultOf bounds every field) — nothing here can
    // malform the wire shape into a 422.
    const result: ReadPageResult = readPageResultOf(
      threadId,
      entry.action,
      browserLayoutProbe(),
    );
    return Promise.resolve({ ok: true, result: { ...result } });
  } catch (error) {
    return Promise.resolve(_readPageFailedOutcome(error));
  }
}

function _readPageFailedOutcome(error: unknown): ExecutionOutcome {
  // An expected refusal (stale ref, unmatched selector) already carries
  // the reader's own model-actionable sentence — deliver it verbatim;
  // "ask the user instead" would cancel the retry it asks for. Only a
  // genuine reader crash earns the give-up wrapper.
  if (error instanceof SnapshotUnavailableError) {
    return {
      ok: false,
      error: { code: "execution_failed", message: error.message },
    };
  }
  return {
    ok: false,
    error: {
      code: "execution_failed",
      message:
        `Reading this page failed: ${_reasonSentenceOf(error)}. ` +
        "Ask the user to describe what they see instead.",
    },
  };
}

function _highlightOutcomeOf(entry: ExecutionEntryModel): ExecutionOutcome {
  // The server sent the ref through verbatim; this narrowing is only
  // wire defense, so its failure text stays canned.
  const refId = _refIdOf(entry.action);
  if (refId === null) {
    return UNUSABLE_REF_OUTCOME;
  }
  const resolved = resolvedElementOfRef(refId);
  if (resolved.error !== null) {
    // The reader's own refusal (stale ref, curated subtree) is already
    // model-actionable — deliver it verbatim, same as read_page does.
    return {
      ok: false,
      error: { code: "execution_failed", message: resolved.error },
    };
  }
  try {
    spotlightElement(resolved.element, browserLayoutProbe());
  } catch (error) {
    return _highlightFailedOutcome(error);
  }
  // The package synthesizes the contract's strict HighlightResult
  // itself — nothing here can malform the wire shape into a 422.
  const result: HighlightResult = { highlighted: true, ref_id: refId };
  return { ok: true, result: { ...result } };
}

function _refIdOf(action: Record<string, unknown> | null): string | null {
  const refId = action?.ref_id;
  if (typeof refId !== "string" || refId.trim() === "") {
    return null;
  }
  return refId;
}

function _highlightFailedOutcome(error: unknown): ExecutionOutcome {
  return {
    ok: false,
    error: {
      code: "execution_failed",
      message:
        `Highlighting on this page failed: ${_reasonSentenceOf(error)}. ` +
        "Describe where the element is in words instead.",
    },
  };
}

function _prefillFormOutcomeOf(entry: ExecutionEntryModel): ExecutionOutcome {
  // The server validated the fields' shape before pausing; this
  // narrowing is only wire defense, so its failure text stays canned.
  const fields = _prefillFieldsOf(entry.action);
  if (fields === null) {
    return UNUSABLE_FIELDS_OUTCOME;
  }
  try {
    // The package synthesizes the contract's strict PrefillFormResult
    // itself (every refusal reason is the package's own prose) — nothing
    // here can malform the wire shape into a 422.
    const result: PrefillFormResult = prefilledFieldsReport(fields);
    return { ok: true, result: { ...result } };
  } catch (error) {
    return _prefillFailedOutcome(error);
  }
}

function _prefillFieldsOf(
  action: Record<string, unknown> | null,
): PrefillField[] | null {
  const fields = action?.fields;
  if (!Array.isArray(fields) || fields.length === 0) {
    return null;
  }
  const narrowed: PrefillField[] = [];
  for (const entry of fields) {
    if (typeof entry !== "object" || entry === null) {
      return null;
    }
    const candidate = entry as Record<string, unknown>;
    const refId = _refIdOf(candidate);
    if (refId === null || typeof candidate.value !== "string") {
      return null;
    }
    narrowed.push({ refId, value: candidate.value });
  }
  return narrowed;
}

function _prefillFailedOutcome(error: unknown): ExecutionOutcome {
  return {
    ok: false,
    error: {
      code: "execution_failed",
      message:
        `Filling this page's fields failed: ${_reasonSentenceOf(error)}. ` +
        "Do not assume anything was filled; tell the user the values so " +
        "they can type them in themselves.",
    },
  };
}

function _reasonSentenceOf(error: unknown): string {
  // The host error's own first line, sliced for READABILITY in raw
  // characters — these callers' errors (navigation, page operations) sit
  // far under any door, so the bound exists to tame stack-trace-shaped
  // messages, and a non-ASCII host error keeps its full 300 characters.
  return _failureFirstLineOf(error).slice(0, FAILURE_REASON_MAX_CHARS);
}

function _failureFirstLineOf(error: unknown): string {
  // A reason the model can act on, never a stack trace.
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split("\n", 1)[0].trim();
  return firstLine === "" ? "an unknown error" : firstLine;
}
