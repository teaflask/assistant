import type { Message } from "@ag-ui/core";

import type { TurnAttachment } from "../contract/threads.js";
import type { UserTurnMeta } from "./user-turn-ledger.js";
import { newestAssistantProseIdOf } from "./assistant-prose.js";
import type { MarkerAnchorsSnapshot } from "./connection-epoch.js";
import {
  memoryFootersOf,
  type MemoryUpdated,
} from "./memory-provenance-anchors.js";
import type { BlockTiming } from "./segment-timing.js";
import {
  DISPATCH_SUBAGENT_TOOL_NAME,
  withSubagentGroups,
  type DispatchCall,
  type SubagentGroupRow,
} from "./subagent-rows.js";
import type { DeliveredResult } from "./subagent-delivery-anchors.js";
import { EMPTY_TOOL_DECISION_ANCHORS } from "./tool-decision-anchors.js";
import { EMPTY_TOOL_DENIAL_ANCHORS } from "./tool-denial-anchors.js";
import type { AnchoredTurnFailReceipts } from "./turn-failed-anchors.js";
import type { ToolCallDisplay, ToolCallState } from "./tool-call-display.js";
import type { ToolCallSchemas } from "./tool-schema-anchors.js";

// The transcript's flat row list: one pure derivation from the messages
// cell and the marker anchors — per message id, in order: the "before"
// marker rows (a delivery divider, a turn-failed receipt), the message's own
// rows (a user row, an assistant markdown row, one tool row per call), then
// the "after" marker rows. The meta-receipt row kinds (resume, voided,
// approval) render no rows: the markers stay on the wire and in the
// store. React-free so the interleave is unit-testable without a DOM.

/** The chassis' ReactCustomMessageRendererPosition, owned. */
export type MarkerPosition = "before" | "after";

export interface UserMessageRow {
  kind: "user";
  key: string;
  text: string;
  /** The message's attachments (upload order) — from the turn ledger's
   *  side table, never the AG-UI Message itself. */
  attachments: TurnAttachment[];
  /** The turn's server created_at stamp (ISO-8601), from the same side
   *  table: the wire carries no per-message timestamp, so the turn's
   *  creation is the bubble's one honest clock — never a client's. Absent
   *  on an optimistic echo (no turn yet) and on hosts that pass no meta
   *  (the bench, probes). */
  createdAt?: string;
  /** The send has left the composer but replay has not injected its
   *  authoritative user message yet. It still occupies its final place
   *  in the transcript; this flag is presentation/accessibility state,
   *  never a second message kind. */
  optimistic?: true;
}

export interface AssistantTextRow {
  kind: "assistant-text";
  key: string;
  text: string;
  /** True only on the newest assistant text while the run streams — the
   *  one row whose markdown gets the streaming repair. */
  streaming: boolean;
  /** The memory writes this message's run caused, in stream
   *  order — the message-level provenance footer. Row-embedded rather
   *  than a row kind of its own, so a write never splits a run fold and
   *  the row count stays a function of the messages alone. Absent when
   *  the history carries no attribution — old markers render no footer,
   *  never a synthesized one. */
  memoryUpdates?: MemoryUpdated[];
}

export interface ReasoningRow {
  kind: "reasoning";
  key: string;
  text: string;
  /** True while the run streams and this is the newest message — the
   *  auto-open window; the row collapses the moment the next block
   *  (answer text or a tool call) starts a new message. */
  streaming: boolean;
  /** The block's observed server timing, joined from the
   *  timing anchors by this row's message id. Absent when the history
   *  carries no timestamps — unknown, never zero. */
  timing?: BlockTiming;
}

export interface ToolCallRow {
  kind: "tool-call";
  key: string;
  toolCallId: string;
  toolName: string;
  state: ToolCallState;
  /** The raw streamed arguments (JSON text, possibly mid-stream). */
  argsText: string;
  result?: string;
  /** True when the wire's result is the context offloader's model-facing
   *  replacement, not the tool's output — the Result pane renders a quiet
   *  shortened-result line instead of the content. */
  offloaded: boolean;
  /** The failure sentence, present only on output-error rows. */
  errorText?: string;
  /** The door's refusal sentence, present only on refused rows. */
  refusalText?: string;
  /** The backend-authored display copy, when the wire annotated the call. */
  display?: ToolCallDisplay;
  /** The tool's registered schemas, joined from the schema
   *  anchors by this row's tool call id. Absent when none were declared
   *  or the history predates the channel — never `{}`. */
  schemas?: ToolCallSchemas;
  /** The block's observed server timing, joined from the
   *  timing anchors by this row's tool call id. Absent when the history
   *  carries no timestamps — unknown, never zero. */
  timing?: BlockTiming;
  /** True when a member decision rode this call: an
   *  approval_requested or member-answerable execution marker named it —
   *  the DURABLE evidence the placement hold's decision arm reads, so
   *  the hold survives the card stores' pruning (the gated call's
   *  result, RUN_ERROR, the turn's settle) and a reload of a
   *  settled thread. Absent on histories with no such marker. */
  decisionBearing?: boolean;
}

export interface TurnFailedReceiptsRow {
  kind: "turn-failed-receipts";
  key: string;
  /** The reader-aware sentences the failed settle recorded —
   *  the turn-level terminal state, distinct from any single
   *  operation's failure. */
  receipts: AnchoredTurnFailReceipts[MarkerPosition];
}

export interface SubagentDeliveryRow {
  kind: "subagent-delivery";
  key: string;
  /** The settled dispatches the machine-started delivery run pushed
   *  — the divider names them before the run's first prose. */
  results: DeliveredResult[];
}

export type TranscriptRow =
  | UserMessageRow
  | AssistantTextRow
  | ReasoningRow
  | ToolCallRow
  | SubagentGroupRow
  | TurnFailedReceiptsRow
  | SubagentDeliveryRow;

export interface PendingUserEcho {
  messageId: string;
  text: string;
  attachments: TurnAttachment[];
}

const NO_TURN_META: ReadonlyMap<string, UserTurnMeta> = new Map();

export function transcriptRowsOf(
  messages: readonly Message[],
  anchors: MarkerAnchorsSnapshot,
  running: boolean,
  metaByMessageId: ReadonlyMap<string, UserTurnMeta> = NO_TURN_META,
): TranscriptRow[] {
  const results = _toolResultsOf(messages);
  const rows: TranscriptRow[] = [];
  const lastAssistantTextId = newestAssistantProseIdOf(messages);
  const lastMessageId = messages.at(-1)?.id ?? null;
  const memoryFooters = memoryFootersOf(
    anchors.memoryProvenanceAnchors,
    anchors.memoryAttributionAnchors,
  );
  // A run_resumed marker anchors to the retry's FIRST message
  // (stream-resume.ts), so a message strictly before it in the SAME turn
  // is a prior attempt's — its open tool calls can never receive a
  // result and must not read as running.
  const severed = _severedFlagsOf(messages, anchors);
  for (const [index, message] of messages.entries()) {
    _pushMarkersAt(rows, anchors, message.id, "before");
    _pushMessageRows(rows, message, results, {
      streamingMessageId: running ? lastAssistantTextId : null,
      // Reasoning streams only while it is the newest message of a live
      // run: the next block (answer text, a tool call) starts a new
      // message and thereby closes the window.
      streamingReasoningId: running ? lastMessageId : null,
      running,
      superseded: severed[index],
      errors: anchors.toolErrorAnchors,
      refusals: anchors.toolRefusalAnchors,
      cancels: anchors.toolCancelAnchors,
      offloads: anchors.toolOffloadAnchors,
      decisions: anchors.toolDecisionAnchors ?? EMPTY_TOOL_DECISION_ANCHORS,
      denials: anchors.toolDenialAnchors ?? EMPTY_TOOL_DENIAL_ANCHORS,
      displays: anchors.toolCallDisplayAnchors,
      schemas: anchors.toolSchemaAnchors,
      timings: anchors.blockTimingAnchors,
      turnMeta: metaByMessageId,
      memoryFooters,
    });
    _pushMarkersAt(rows, anchors, message.id, "after");
  }
  // Dispatch calls fold into subagent group rows at their exact spot in the
  // flat interleave — over the WHOLE list, because the wire puts every
  // streamed call in its own assistant message, so one parallel fan-out
  // arrives as adjacent single-call messages; any visible row still splits.
  return withSubagentGroups(rows, _asDispatchCall, (row) => row.key);
}

/** Paint a submitted user message at the transcript tail while replay is
 *  catching up. Once the POST lands the echo adopts the authoritative
 *  message id, so an already-injected row wins without a duplicate. */
export function withPendingUserEcho(
  rows: readonly TranscriptRow[],
  echo: PendingUserEcho | null,
): readonly TranscriptRow[] {
  if (
    echo === null ||
    rows.some((row) => row.kind === "user" && row.key === echo.messageId)
  ) {
    return rows;
  }
  return [
    ...rows,
    {
      kind: "user",
      key: echo.messageId,
      text: echo.text,
      attachments: echo.attachments,
      optimistic: true,
    },
  ];
}

/** True when the newest row is itself live streamed content — the window
 *  where a typing dot underneath would double-announce what is already
 *  animating. */
export function trailingRowIsStreaming(
  rows: readonly TranscriptRow[],
): boolean {
  const last = rows.at(-1);
  if (last === undefined) {
    return false;
  }
  return (
    (last.kind === "assistant-text" || last.kind === "reasoning") &&
    last.streaming
  );
}

// --- message rows -------------------------------------------------------------

function _pushMessageRows(
  rows: TranscriptRow[],
  message: Message,
  results: ReadonlyMap<string, string>,
  context: {
    streamingMessageId: string | null;
    streamingReasoningId: string | null;
    running: boolean;
    /** True when this message precedes the last resume anchor — a prior
     *  attempt's message, whose open calls are severed. */
    superseded: boolean;
    errors: ReadonlyMap<string, string>;
    refusals: ReadonlyMap<string, string>;
    cancels: ReadonlySet<string>;
    offloads: ReadonlySet<string>;
    decisions: ReadonlySet<string>;
    /** Calls whose approval a member declined — the ladder's
     *  rung above the wire's own `cancelled` stamp. */
    denials: ReadonlySet<string>;
    displays: ReadonlyMap<string, ToolCallDisplay>;
    schemas: ReadonlyMap<string, ToolCallSchemas>;
    timings: ReadonlyMap<string, BlockTiming>;
    turnMeta: ReadonlyMap<string, UserTurnMeta>;
    memoryFooters: ReadonlyMap<string, MemoryUpdated[]>;
    /** Attachments-only side table for hosts without a turn ledger
     *  (transcriptBlocksOf's option): consulted only when the id has no
     *  turn meta, and it carries no createdAt — the bubble renders no
     *  stamp there, never a synthesized clock. */
    sideAttachments?: ReadonlyMap<string, TurnAttachment[]>;
  },
): void {
  if (message.role === "user") {
    const meta = context.turnMeta.get(message.id);
    const attachments =
      meta?.attachments ?? context.sideAttachments?.get(message.id) ?? [];
    // An attachment-only turn has empty text and must still render its
    // chips; a genuinely empty message stays dropped.
    if (
      typeof message.content === "string" &&
      (message.content !== "" || attachments.length > 0)
    ) {
      rows.push({
        kind: "user",
        key: message.id,
        text: message.content,
        attachments,
        // Spread-conditional, not always-on: hosts that pass no meta
        // (the bench, probes, child transcripts) render no stamp.
        ...(meta !== undefined ? { createdAt: meta.createdAt } : {}),
      });
    }
    return;
  }
  if (message.role === "reasoning") {
    if (message.content !== "") {
      rows.push({
        kind: "reasoning",
        key: message.id,
        text: message.content,
        streaming: message.id === context.streamingReasoningId,
        timing: context.timings.get(message.id),
      });
    }
    return;
  }
  if (message.role !== "assistant") {
    // Tool results render under their call's row; system/activity
    // messages have no standalone rendering in the transcript.
    return;
  }
  if (typeof message.content === "string" && message.content !== "") {
    const memoryUpdates = context.memoryFooters.get(message.id);
    rows.push({
      kind: "assistant-text",
      key: message.id,
      text: message.content,
      streaming: message.id === context.streamingMessageId,
      // Present only when attributed writes exist: the footer is
      // provenance on the message it explains, never a default slot.
      ...(memoryUpdates !== undefined ? { memoryUpdates } : {}),
    });
  }
  for (const toolCall of message.toolCalls ?? []) {
    const result = results.get(toolCall.id);
    const recordedError = context.errors.get(toolCall.id);
    const recordedRefusal = context.refusals.get(toolCall.id);
    const state = _toolStateOf(
      result,
      recordedError !== undefined,
      context.denials.has(toolCall.id),
      context.cancels.has(toolCall.id),
      recordedRefusal !== undefined,
      context.superseded,
      context.running,
    );
    rows.push({
      kind: "tool-call",
      key: `${message.id}:${toolCall.id}`,
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
      state,
      argsText: toolCall.function.arguments,
      result,
      // An offloaded call settled normally — the state ladder is
      // untouched; only the Result pane's content decision changes.
      offloaded: context.offloads.has(toolCall.id),
      errorText: errorTextOf(recordedError, result),
      // The reason rides only the refused state: a higher rung (a
      // recorded error, a cancel) owns its own story.
      ...(state === "refused" ? { refusalText: recordedRefusal } : {}),
      display: context.displays.get(toolCall.id),
      schemas: context.schemas.get(toolCall.id),
      timing: context.timings.get(toolCall.id),
      // Present only when the durable marker named this call — hand-built
      // rows and old histories simply omit it.
      ...(context.decisions.has(toolCall.id) ? { decisionBearing: true } : {}),
    });
  }
}

// The package's row shape, normalized to the shared grouping module's
// contract — this tree keeps the raw args text on the row, so no
// round-trip is needed.
function _asDispatchCall(row: TranscriptRow): DispatchCall | null {
  if (
    row.kind !== "tool-call" ||
    row.toolName !== DISPATCH_SUBAGENT_TOOL_NAME ||
    // A refused dispatch launched no child: there is no
    // coworker to group, so the row stays a plain declined tool row with
    // its reason line — never a group entry wearing a child's word. A
    // denied dispatch likewise: the member declined it before
    // it ran, so it stays a plain not-approved row.
    row.state === "refused" ||
    row.state === "denied"
  ) {
    return null;
  }
  // Superseded counts as settled AND cancelled: the dispatch tool answers
  // immediately (its receipt is the launch acknowledgment, never the child's
  // report), so a resultless dispatch row is only ever the severed shape.
  // Behind a later resume marker that receipt can never land, and with no
  // receipt there is no ordinal for the ledger join — an unsettled read
  // would spin the group's "Working" forever.
  return {
    toolCallId: row.toolCallId,
    settled:
      row.state === "output-available" ||
      row.state === "output-error" ||
      row.state === "cancelled" ||
      row.state === "superseded",
    failed: row.state === "output-error",
    cancelled: row.state === "cancelled" || row.state === "superseded",
    result: row.result,
    errorText: row.errorText,
    argsText: row.argsText,
  };
}

/** The Error pane's sentence: the recorded error, or — when the wire sent
 *  an empty one — the result text the failure arrived as. */
export function errorTextOf(
  recordedError: string | undefined,
  result: string | undefined,
): string | undefined {
  if (recordedError === undefined) {
    return undefined;
  }
  return recordedError !== "" ? recordedError : result;
}

/** role:"tool" messages carry each call's result, keyed by toolCallId —
 *  and the NEWEST one wins (an intended delta from the chassis' first-wins
 *  accident). Two distinct tool messages can carry one tool_call_id across
 *  an approval-pause round boundary (message ids carry the round infix,
 *  tool-call ids deliberately do not), and there the LATER record is the
 *  call's outcome. One join rule for every surface; pinned by the
 *  projection suite's last-record-wins case. */
function _toolResultsOf(
  messages: readonly Message[],
): ReadonlyMap<string, string> {
  const results = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "tool" && typeof message.content === "string") {
      results.set(message.toolCallId, message.content);
    }
  }
  return results;
}

// A recorded error → the call failed; result present → settled; no
// result before a retry's resume anchor in the same turn → severed by
// that retry, its result can never arrive; no result while
// the run streams → running; no result on a settled run → the call
// never finished (a pause or an interruption ended the run) —
// presented as still pending,
// because the truthful story (an approval card, a receipt row, the
// failure banner) renders alongside and owns the explanation, exactly
// as the chassis presented it.
//
// The failure signal rides TOOL_CALL_RESULT as an `error` field, but
// @ag-ui/client 1.0 strips unknown top-level fields before any subscriber
// (the transport lifts them into metadata, core/tool-outcome.ts) — so
// errored calls arrive via the anchors map the recorder fills, not via
// the message list. A cancelled tool (a stop, a steering
// guide — and, AT THE WIRE, a member's denial, which the mapper stamps
// cancelled before the denied rung below reclassifies it) never carries
// the field: only a tool that ran and broke is a failure. Its
// `cancelled` stamp rides the same lift into its own anchor set —
// checked before the result, because a cancelled call DOES have a result
// message (the model-facing cancellation text, which must not read as an
// outcome). A refused call rides its `refused` stamp the same
// way and ranks next: the
// door answered and declined, and its result message is the refusal
// envelope the model read — never an outcome either; the mapper stamps
// refused INSTEAD of error, so the two rungs are exclusive by
// construction and the order merely states the priority. Supersession
// ranks below all three anchors and below a landed result: a
// prior-attempt call that settled stays settled — only its open calls
// are severed.
//
// The denied rung sits between errored and cancelled, and
// both neighbours are deliberate:
// - Below errored, because a recorded FAILURE outranks everything: a
//   call that ran and broke is never reclassified by a later decision
//   marker (TVC-037's posture for supersession, kept for denial).
// - Above cancelled, because the wire carries a denial AS a cancel —
//   the mapper stamps the denied call's receipt `cancelled` like any
//   tool that never ran — so the rung exists precisely to reclassify
//   that stamp; below it, the state could never show.
// - Above refused by chronology, and the two are exclusive BY
//   CONSTRUCTION: a denied call never ran, so no door ever answered it
//   (the door's `refused` sentence is a tool result, and a denial's
//   only result is the cancellation sentinel). If a history ever
//   carried both stamps on one call the ladder would read it denied —
//   the member's decision came first — and the refusal sentence would
//   drop with its rung, as it does under a cancel today.
function _toolStateOf(
  result: string | undefined,
  errored: boolean,
  denied: boolean,
  cancelled: boolean,
  refused: boolean,
  superseded: boolean,
  running: boolean,
): ToolCallState {
  if (errored) {
    return "output-error";
  }
  if (denied) {
    return "denied";
  }
  if (cancelled) {
    return "cancelled";
  }
  if (refused) {
    return "refused";
  }
  if (result !== undefined) {
    return "output-available";
  }
  if (superseded) {
    return "superseded";
  }
  return running ? "input-available" : "input-streaming";
}

/** Which messages a resume anchor severs — two scopings, both from the
 *  marker's mechanism (docs/transcript-rows-and-folds.md, "Resume severance
 *  scoping"): per turn, never thread-wide (a retry only re-streams its own
 *  turn, whose window starts at its first visible row — the user message or
 *  the delivery divider), and every resume anchor severs (there is no
 *  non-severing shape). Boundary resets apply BEFORE the same message's
 *  severance check, so a shared first message severs nothing — the safe
 *  direction: a missed severance stays pending, a false one asserts an
 *  interruption that never happened. */
function _severedFlagsOf(
  messages: readonly Message[],
  anchors: MarkerAnchorsSnapshot,
): boolean[] {
  const flags = messages.map(() => false);
  let turnStart = 0;
  for (const [index, message] of messages.entries()) {
    if (message.role === "user") {
      turnStart = index;
      continue;
    }
    if (anchors.subagentDeliveryAnchors.has(message.id)) {
      turnStart = index;
    }
    if (anchors.resumeAnchors.has(message.id)) {
      for (let severed = turnStart; severed < index; severed += 1) {
        flags[severed] = true;
      }
    }
  }
  return flags;
}

// --- marker rows ---------------------------------------------------------------

function _pushMarkersAt(
  rows: TranscriptRow[],
  anchors: MarkerAnchorsSnapshot,
  messageId: string,
  position: MarkerPosition,
): void {
  if (position === "before") {
    const delivered = anchors.subagentDeliveryAnchors.get(messageId);
    if (delivered !== undefined && delivered.length > 0) {
      rows.push({
        kind: "subagent-delivery",
        key: `${messageId}:delivery`,
        results: delivered,
      });
    }
  }
  // The meta-receipt markers (resume, voided, approval) push no rows here:
  // the transcript renders no standalone narration for them. Resume anchors
  // still sever prior-attempt calls (_severedFlagsOf); the approval outcome
  // shows on the decision card's footer and the operation row's state. Only
  // the turn-level failure receipt remains a rendered marker row.
  const failed = anchors.turnFailedAnchors.get(messageId)?.[position];
  if (failed !== undefined && failed.length > 0) {
    rows.push({
      kind: "turn-failed-receipts",
      key: `${messageId}:${position}:failed`,
      receipts: failed,
    });
  }
}

// --- the block projection ---------------------------------------------
//
// The per-message-id shape of the same derivation, for hosts that render
// their own marker rows AROUND each message (AssistantTranscript's agent
// mode): one block per deduped message id, emitted even when the message
// renders no rows, because marker composites anchor to "the newest message
// id". Same walk, same helpers, plus the dedupe (that surface owns connect,
// so StrictMode reruns and reconnect replays land on the agent's uncleared
// list) and the declared marker boundaries (the host says where its markers
// render, and a group splits there exactly as at any visible row).

/** The message ids that render a host marker row, by which side of their
 *  block the marker draws on. Markers aren't block rows here (the host's
 *  marker composite renders them from its own anchor state), so the
 *  cross-block grouping walk can't see them — the host hands their
 *  positions in, and a marker splits two delegation moments exactly the
 *  way any visible row does. */
export interface MarkerBoundaries {
  before: ReadonlySet<string>;
  after: ReadonlySet<string>;
}

export const EMPTY_MARKER_BOUNDARIES: MarkerBoundaries = {
  before: new Set(),
  after: new Set(),
};

/** One entry per deduped message id, rows possibly empty. */
export interface TranscriptBlock {
  messageId: string;
  rows: TranscriptRow[];
}

export function transcriptBlocksOf(
  messages: readonly Message[],
  anchors: MarkerAnchorsSnapshot,
  running: boolean,
  metaByMessageId: ReadonlyMap<string, UserTurnMeta> = NO_TURN_META,
  options: {
    markerBoundaries?: MarkerBoundaries;
    /** Attachments joined by message id for hosts without a turn ledger —
     *  like meta.attachments, but carrying no createdAt (no stamp is ever
     *  synthesized). Consulted only when the id has no turn meta. */
    attachmentsByMessageId?: ReadonlyMap<string, TurnAttachment[]>;
  } = {},
): TranscriptBlock[] {
  const deduped = _dedupedById(messages);
  const results = _toolResultsOf(deduped);
  const lastAssistantTextId = newestAssistantProseIdOf(deduped);
  const lastMessageId = deduped.at(-1)?.id ?? null;
  const memoryFooters = memoryFootersOf(
    anchors.memoryProvenanceAnchors,
    anchors.memoryAttributionAnchors,
  );
  const severed = _severedFlagsOf(deduped, anchors);
  const blocks = deduped.map((message, index) => {
    const rows: TranscriptRow[] = [];
    _pushMarkersAt(rows, anchors, message.id, "before");
    _pushMessageRows(rows, message, results, {
      streamingMessageId: running ? lastAssistantTextId : null,
      streamingReasoningId: running ? lastMessageId : null,
      running,
      superseded: severed[index],
      errors: anchors.toolErrorAnchors,
      refusals: anchors.toolRefusalAnchors,
      cancels: anchors.toolCancelAnchors,
      offloads: anchors.toolOffloadAnchors,
      decisions: anchors.toolDecisionAnchors ?? EMPTY_TOOL_DECISION_ANCHORS,
      denials: anchors.toolDenialAnchors ?? EMPTY_TOOL_DENIAL_ANCHORS,
      displays: anchors.toolCallDisplayAnchors,
      schemas: anchors.toolSchemaAnchors,
      timings: anchors.blockTimingAnchors,
      turnMeta: metaByMessageId,
      memoryFooters,
      sideAttachments: options.attachmentsByMessageId,
    });
    _pushMarkersAt(rows, anchors, message.id, "after");
    return {
      messageId: message.id,
      // Per block first, merged across blocks below — the same two-step
      // the flat walk collapses into one withSubagentGroups pass. The
      // merged group's key equals the flat pass's (the first dispatch
      // row's), so on a duplicate-free history with empty boundaries the
      // flattened blocks deep-equal transcriptRowsOf's list.
      rows: withSubagentGroups(rows, _asDispatchCall, (row) => row.key),
    };
  });
  return _withCrossBlockGroups(
    blocks,
    options.markerBoundaries ?? EMPTY_MARKER_BOUNDARIES,
  );
}

// A reconnect replays onto the agent's uncleared message list (StrictMode's
// double-mount does the same), so every id can appear twice. The dedupe:
// first-seen position kept, later occurrence wins, assistant entries recover
// content/toolCalls from the earlier one when the later is empty.
function _dedupedById(messages: readonly Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const message of messages) {
    const existing = byId.get(message.id);
    if (
      existing !== undefined &&
      message.role === "assistant" &&
      existing.role === "assistant"
    ) {
      byId.set(message.id, {
        ...existing,
        ...message,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty string is exactly the case to recover from: the re-delivered entry streams "" before its content arrives, and ?? would let it erase the recovered text
        content: message.content || existing.content,
        toolCalls: message.toolCalls ?? existing.toolCalls,
      });
    } else {
      byId.set(message.id, message);
    }
  }
  return [...byId.values()];
}

// The wire puts every streamed tool call in its own assistant message
// (TOOL_CALL_START carries no parent id), so one parallel fan-out arrives as
// adjacent single-call messages. Uninterrupted delegation reads as ONE
// moment: a group swallows the groups of the blocks after it until any
// visible row intervenes — a block row, or a host-declared marker. Swallowed
// blocks keep their place and marker anchors; row-less blocks never break it.
function _withCrossBlockGroups(
  blocks: TranscriptBlock[],
  markerBoundaries: MarkerBoundaries,
): TranscriptBlock[] {
  let standing: SubagentGroupRow | null = null;
  return blocks.map((block) => {
    if (markerBoundaries.before.has(block.messageId)) {
      standing = null;
    }
    const rows: TranscriptRow[] = [];
    for (const row of block.rows) {
      if (row.kind !== "subagent-group") {
        standing = null;
        rows.push(row);
        continue;
      }
      if (standing === null) {
        // Copied, not aliased: the merge grows the entry list, and the
        // per-message group this derives from must stay pure.
        standing = { ...row, entries: [...row.entries] };
        rows.push(standing);
        continue;
      }
      standing.entries.push(...row.entries);
    }
    if (markerBoundaries.after.has(block.messageId)) {
      standing = null;
    }
    return { messageId: block.messageId, rows };
  });
}
