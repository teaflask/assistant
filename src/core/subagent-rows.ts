// The transcript's subagent grouping: consecutive
// dispatch_subagent tool calls inside one assistant message collapse into
// one "Running N subagents" group row, each dispatch read from its
// receipt. Pure and import-free; public via ./transcript, which the
// dashboard imports rather than keeping a fork.

export const DISPATCH_SUBAGENT_TOOL_NAME = "dispatch_subagent";

/** The stored label's bound, mirrored from the ledger's question_excerpt
 *  clip — a streamed-args fallback must never out-length the real label. */
const MAX_LABEL_CHARS = 200;

/** One dispatch tool call, normalized from either tree's row shape by the
 *  caller — the dashboard's status union and the package's state union
 *  name the same facts differently, so each tree adapts its own. */
export interface DispatchCall {
  toolCallId: string;
  /** The call settled on the wire: a result or failure was recorded. */
  settled: boolean;
  failed: boolean;
  cancelled: boolean;
  result: string | undefined;
  /** The wire's failure sentence, present only on failed calls — a
   *  dispatcher failure's only explanation, since its result is prose,
   *  never a receipt. (A door REFUSAL never reaches this module:
   *  the projection keeps a refused dispatch out of the grouping,
   *  because no child exists.) */
  errorText: string | undefined;
  /** The raw streamed arguments JSON text — the label fallback while the
   *  receipt hasn't landed. */
  argsText: string;
}

/** The dispatch receipt as the tool result carries it (the backend's
 *  DispatchReceipt, read leniently — a truncated result or a failure
 *  sentence parses to null fields, never throws). The wire's settled.status collapses to
 *  a boolean right here, so no surface ever compares status words. */
export interface DispatchReceipt {
  outcome: "launched" | "attached" | "already_settled";
  ordinal: number;
  label: string;
  childSessionId: string | null;
  settled: { failed: boolean; note: string | null } | null;
}

export interface SubagentGroupEntry {
  toolCallId: string;
  receipt: DispatchReceipt | null;
  /** The parent-authored label: the receipt's when it landed, else a
   *  best-effort read of the streamed task text. */
  label: string | null;
  /** Still working, as far as the wire alone can tell — a ledger join
   *  (where the surface has one) refines this. */
  running: boolean;
  failed: boolean;
  cancelled: boolean;
  /** The row's explanation: the settled receipt's note, or a failed
   *  call's failure sentence. A ledger join (where the surface has one)
   *  may outrank it. */
  note: string | null;
}

export interface SubagentGroupRow {
  kind: "subagent-group";
  key: string;
  entries: SubagentGroupEntry[];
}

/** The outcome tallies a group's summary line and trigger icon read. */
export interface SubagentOutcomeCounts {
  running: number;
  failed: number;
  cancelled: number;
  total: number;
}

export function subagentOutcomeCountsOf(
  entries: readonly {
    running: boolean;
    failed: boolean;
    cancelled: boolean;
  }[],
): SubagentOutcomeCounts {
  let running = 0;
  let failed = 0;
  let cancelled = 0;
  for (const entry of entries) {
    if (entry.running) {
      running += 1;
    }
    if (entry.failed) {
      failed += 1;
    }
    if (entry.cancelled) {
      cancelled += 1;
    }
  }
  return { running, failed, cancelled, total: entries.length };
}

/**
 * The group's summary line — the feature's most visible sentence, shared
 * so the dashboard and the widget can never phrase it differently. Every
 * settled outcome survives collapse: failures and interruptions ride the
 * suffix, and "Ran" counts only the calls that actually ran — a cancelled
 * dispatch never did, and a severed one's receipt never landed. The
 * suffix word is "interrupted", the word the entry pills already wear
 * for both shapes — never "cancelled", which would assert a
 * cancellation nobody performed on a retry-severed call.
 * (String() wrappers throughout, satisfying the package's
 * template-expression lint.)
 */
export function subagentGroupHeadlineOf(counts: SubagentOutcomeCounts): string {
  const nounOf = (count: number) => (count === 1 ? "subagent" : "subagents");
  const suffixParts: string[] = [];
  if (counts.failed > 0) {
    suffixParts.push(`${String(counts.failed)} failed`);
  }
  if (counts.cancelled > 0) {
    suffixParts.push(`${String(counts.cancelled)} interrupted`);
  }
  const suffix = suffixParts.length > 0 ? ` · ${suffixParts.join(" · ")}` : "";
  if (counts.running > 0) {
    if (counts.running === counts.total) {
      return `Running ${String(counts.total)} ${nounOf(counts.total)}`;
    }
    return `Running ${String(counts.running)} of ${String(counts.total)} ${nounOf(counts.total)}${suffix}`;
  }
  if (counts.cancelled === counts.total) {
    return `${String(counts.total)} ${nounOf(counts.total)} interrupted`;
  }
  const ranCount = counts.total - counts.cancelled;
  return `Ran ${String(ranCount)} ${nounOf(ranCount)}${suffix}`;
}

/**
 * Collapse consecutive dispatch calls into group rows, leaving every
 * other row untouched. Grouping is strictly adjacent within the given
 * rows (one message's): parallel dispatches share one assistant turn and
 * read as one delegation moment; anything between two dispatches splits
 * them into two honest moments.
 */
export function withSubagentGroups<Row>(
  rows: readonly Row[],
  asDispatchCall: (row: Row) => DispatchCall | null,
  keyOf: (row: Row) => string,
): (Row | SubagentGroupRow)[] {
  const out: (Row | SubagentGroupRow)[] = [];
  let group: SubagentGroupRow | null = null;
  for (const row of rows) {
    const call = asDispatchCall(row);
    if (call === null) {
      group = null;
      out.push(row);
      continue;
    }
    if (group === null) {
      group = {
        kind: "subagent-group",
        key: `subagents:${keyOf(row)}`,
        entries: [],
      };
      out.push(group);
    }
    group.entries.push(_entryOf(call));
  }
  return out;
}

function _entryOf(call: DispatchCall): SubagentGroupEntry {
  const receipt = dispatchReceiptOf(call.result);
  // A landed receipt outranks the wire's call status: the dispatch tool
  // answers immediately (the receipt is never the report), so a settled
  // call whose receipt says "launched" names a child still working.
  // already_settled means the child settled BY DEFINITION: a truncated
  // receipt loses its settled payload (and its child_session_id, so no
  // ledger join can correct it) — without the outcome check a coworker
  // that already failed would spin forever.
  const stillDispatched =
    receipt !== null
      ? receipt.settled === null && receipt.outcome !== "already_settled"
      : !call.settled;
  // A truncated receipt can carry an EMPTY label — fall through to the
  // streamed task text rather than rendering a blank row.
  const receiptLabel =
    receipt !== null && receipt.label !== "" ? receipt.label : null;
  return {
    toolCallId: call.toolCallId,
    receipt,
    label: receiptLabel ?? taskExcerptOf(call.argsText),
    running: !call.failed && !call.cancelled && stillDispatched,
    failed: call.failed || receipt?.settled?.failed === true,
    cancelled: call.cancelled,
    note:
      receipt?.settled?.note ?? (call.failed ? (call.errorText ?? null) : null),
  };
}

/**
 * The receipt out of a dispatch call's result text: null for failure
 * sentences, garbage, and results still streaming. A truncated receipt
 * (the transcript store's overflow clip) recovers what its surviving
 * prefix carries — the backend orders outcome/ordinal/label first for
 * exactly this read.
 */
export function dispatchReceiptOf(
  result: string | undefined,
): DispatchReceipt | null {
  if (result === undefined || result === "") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result);
  } catch {
    return _receiptFromTruncatedPrefix(result);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const outcome = record.outcome;
  const ordinal = record.ordinal;
  const label = record.label;
  if (
    !_isOutcome(outcome) ||
    typeof ordinal !== "number" ||
    typeof label !== "string"
  ) {
    return null;
  }
  const childSessionId = record.child_session_id;
  return {
    outcome,
    ordinal,
    label,
    childSessionId: typeof childSessionId === "string" ? childSessionId : null,
    settled: _settledOf(record.settled),
  };
}

/**
 * The parent-authored task as a label while no receipt exists yet: read
 * from the streamed arguments, whitespace-collapsed and clipped like the
 * ledger's excerpt. Tolerant of mid-stream JSON — a partial "task" string
 * still reads.
 */
export function taskExcerptOf(argsText: string): string | null {
  const task = dispatchedTaskOf(argsText);
  if (task === null) {
    return null;
  }
  const collapsed = task.split(/\s+/).filter(Boolean).join(" ");
  return collapsed === "" ? null : collapsed.slice(0, MAX_LABEL_CHARS);
}

/** The parent-authored task exactly as dispatched, unclipped — the
 *  child's opening brief. Tolerant of mid-stream JSON like the excerpt. */
export function dispatchedTaskOf(argsText: string): string | null {
  try {
    const parsed: unknown = JSON.parse(argsText);
    if (parsed === null || typeof parsed !== "object") {
      return null;
    }
    const value = (parsed as Record<string, unknown>).task;
    return typeof value === "string" ? value : null;
  } catch {
    const match = /"task"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(argsText);
    return match === null ? null : _unescaped(match[1]);
  }
}

function _isOutcome(value: unknown): value is DispatchReceipt["outcome"] {
  return (
    value === "launched" || value === "attached" || value === "already_settled"
  );
}

// The wire's settled-status words as data, not comparisons — identifier
// keys on purpose: status vocabulary is compared only inside lib/status,
// and this seam collapses it to a boolean instead.
const _SETTLED_STATUS_FAILED: Record<string, boolean | undefined> = {
  succeeded: false,
  failed: true,
};

function _settledOf(value: unknown): DispatchReceipt["settled"] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  // Own-key lookup only: a bare record read reaches Object.prototype, so
  // an unrecognized status word like "constructor" would come back
  // truthy instead of falling to the lenient-parse null. (The long form,
  // not Object.hasOwn — the lib-es6 spelling the deleted dashboard fork
  // imposed; kept because changing it buys nothing.)
  const status = String(record.status);
  const failed = Object.prototype.hasOwnProperty.call(
    _SETTLED_STATUS_FAILED,
    status,
  )
    ? _SETTLED_STATUS_FAILED[status]
    : undefined;
  if (failed === undefined) {
    return null;
  }
  const note = record.note;
  return { failed, note: typeof note === "string" ? note : null };
}

// The truncation-proof read, mirrored from the backend's receipt prefix
// law: compact JSON in declaration order, outcome and ordinal always
// inside the surviving prefix.
const _TRUNCATED_RECEIPT_PREFIX =
  /^\{"outcome":"(launched|attached|already_settled)","ordinal":(\d+)(?:,"label":"((?:[^"\\]|\\.)*))?/;

function _receiptFromTruncatedPrefix(result: string): DispatchReceipt | null {
  const match = _TRUNCATED_RECEIPT_PREFIX.exec(result);
  if (match === null) {
    return null;
  }
  const outcome = match[1];
  if (!_isOutcome(outcome)) {
    return null;
  }
  // The label group may be absent on a very short prefix; typed as
  // possibly-undefined explicitly rather than trusting the index read.
  const labelBody = match[3] as string | undefined;
  return {
    outcome,
    ordinal: Number(match[2]),
    label: labelBody === undefined ? "" : (_unescaped(labelBody) ?? ""),
    childSessionId: null,
    settled: null,
  };
}

function _unescaped(jsonStringBody: string): string | null {
  try {
    return JSON.parse(`"${jsonStringBody}"`) as string;
  } catch {
    // A prefix cut mid-escape: drop the dangling backslash and try once
    // more — better a readable label than none.
    try {
      return JSON.parse(`"${jsonStringBody.replace(/\\$/, "")}"`) as string;
    } catch {
      return null;
    }
  }
}
