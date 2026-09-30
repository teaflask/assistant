import type { AgentSubscriber } from "@ag-ui/client";
import { EventType } from "@ag-ui/core";
import type { BaseEvent, Message } from "@ag-ui/core";

import { RUN_RESUMED_EVENT_NAME } from "../contract/events.js";
import { foldBlockTimingObserved } from "../core/block-timing-anchors.js";
import {
  EMPTY_MEMORY_ATTRIBUTION_ANCHORS,
  EMPTY_MEMORY_PROVENANCE_ANCHORS,
  withMemoryAttributed,
  withMemoryUpdateAnchored,
  type MemoryUpdated,
} from "../core/memory-provenance-anchors.js";
import type { BlockTiming } from "../core/segment-timing.js";
import {
  EMPTY_TURN_USAGE_ANCHORS,
  withTurnUsageAnchored,
  type TurnUsage,
} from "../core/turn-usage-anchors.js";
import type { ToolCallDisplay } from "../core/tool-call-display.js";
import {
  EMPTY_TOOL_SCHEMA_ANCHORS,
  withToolSchemasAnchored,
} from "../core/tool-schema-anchors.js";
import type { ToolCallSchemas } from "../core/tool-schema-anchors.js";
import {
  EMPTY_TOOL_CALL_DISPLAY_ANCHORS,
  withToolCallDisplayAnchored,
} from "../core/tool-call-display-anchors.js";
import {
  EMPTY_TOOL_CANCEL_ANCHORS,
  withToolCancelAnchored,
} from "../core/tool-cancel-anchors.js";
import {
  EMPTY_TOOL_DECISION_ANCHORS,
  withToolDecisionAnchored,
} from "../core/tool-decision-anchors.js";
import {
  EMPTY_TOOL_DENIAL_LEDGER,
  withToolDenialMarkerFolded,
  type ToolDenialLedger,
  type ToolDenialMarker,
} from "../core/tool-denial-anchors.js";
import {
  EMPTY_TOOL_ERROR_ANCHORS,
  withToolErrorAnchored,
} from "../core/tool-error-anchors.js";
import {
  EMPTY_TOOL_REFUSAL_ANCHORS,
  withToolRefusalAnchored,
} from "../core/tool-refusal-anchors.js";
import {
  EMPTY_TOOL_OFFLOAD_ANCHORS,
  withToolOffloadAnchored,
} from "../core/tool-offload-anchors.js";
import {
  EMPTY_SUBAGENT_DELIVERY_ANCHORS,
  withSubagentDeliveryAnchored,
  type DeliveredResult,
} from "../core/subagent-delivery-anchors.js";
import {
  EMPTY_TURN_FAILED_ANCHORS,
  withTurnFailedAnchored,
  type AnchoredTurnFailReceipts,
} from "../core/turn-failed-anchors.js";

// The resume cursor is the newest SSE `id:` line received. The contract
// attaches ids to stored events only and snaps any cursor down to a run
// boundary, so a held cursor never claims an event the server cannot
// re-serve — and full replay remains the always-correct fallback.

export interface ResumeSnapshot {
  afterId: string;
  messages: Message[];
}

/**
 * A conversation's resume state, held above the Transcript remount
 * boundary: reconnect works by remounting a fresh agent, so anything the
 * next connection needs must outlive the current one.
 *
 * A snapshot is a consistent pair — the applied message list and the
 * cursor of the newest received frame — recorded at any BLOCK-COMPLETE,
 * non-failed close that committed a cursor: a settled terminal, or the
 * parked contract's quiet close (a background attach seeds its
 * fresh agent from this pair, and a parked page whose close recorded
 * nothing would re-seed an EMPTY transcript). A snapshot is never proof
 * the run settled — only that the pair is consistent. A mid-BLOCK
 * interruption keeps the previous pair; the server re-delivers the
 * unsettled run in full from its boundary, and the seeded agent de-dupes
 * by the contract's stable ids.
 */
export class StreamResumeStore {
  snapshot: ResumeSnapshot | null = null;
  // Resume anchors survive remounts here: a resumed stream never replays
  // the historical run_resumed markers the severance scan reads.
  // Each anchor keeps its marker's raw payload as provenance — the wire
  // (round, attempt) the arbitration key was derived from.
  readonly resumeAnchors = new Map<string, unknown>();
  // Failure-receipt anchors survive remounts for a sharper reason than
  // their siblings: a failed run's recorded RUN_ERROR demotes to
  // RUN_FINISHED on replay, but the turn_failed marker replays verbatim,
  // so a reconnect re-anchors it idempotently. Same degrade seam.
  turnFailedAnchors: ReadonlyMap<string, AnchoredTurnFailReceipts> =
    EMPTY_TURN_FAILED_ANCHORS;
  // The four tool-outcome anchor families below survive remounts for the
  // same reason: the transport lifts the wire's TOOL_CALL_RESULT extras
  // into event metadata (core/tool-outcome.ts) and the 1.0 client carries
  // that metadata onto the tool message it mints, but a snapshot-seeded
  // reconnect replays only past the cursor — so these maps and sets are
  // what re-anchors historical calls, and the read path the projection
  // consults for every call.
  toolErrorAnchors: ReadonlyMap<string, string> = EMPTY_TOOL_ERROR_ANCHORS;
  toolRefusalAnchors: ReadonlyMap<string, string> = EMPTY_TOOL_REFUSAL_ANCHORS;
  toolCancelAnchors: ReadonlySet<string> = EMPTY_TOOL_CANCEL_ANCHORS;
  toolOffloadAnchors: ReadonlySet<string> = EMPTY_TOOL_OFFLOAD_ANCHORS;
  // Tool-decision anchors: the durable "a member decision rode
  // this call" record the placement hold reads. The card stores prune at
  // the gated call's result and the turn's settle by design, and a
  // snapshot-seeded reconnect replays only past the cursor, so this set
  // is the decision-bearing calls' only durable home.
  toolDecisionAnchors: ReadonlySet<string> = EMPTY_TOOL_DECISION_ANCHORS;
  // The tool-denial ledger: the durable "a member declined this
  // call's approval" record the state ladder reads, joined from the two
  // approval markers. The inbox card that knew the same fact dies to the
  // gated call's cancelled result by design, and a snapshot-seeded
  // reconnect replays only past the cursor — so this ledger is the
  // denied calls' only durable home, and its ask map is what lets a
  // resolution streamed after the cursor still find its call.
  toolDenialLedger: ToolDenialLedger = EMPTY_TOOL_DENIAL_LEDGER;
  // Display anchors survive remounts for the same reason: the
  // tool_call_annotated marker never becomes a message, and a
  // snapshot-seeded reconnect replays only past the cursor, so this map
  // is historical rows' only source of backend-authored copy.
  toolCallDisplayAnchors: ReadonlyMap<string, ToolCallDisplay> =
    EMPTY_TOOL_CALL_DISPLAY_ANCHORS;
  // Schema anchors survive remounts for the same reason: the
  // schemas ride the same marker's siblings (and the approval card's
  // fields), never a message, so this map is the calls' only client home
  // for argsSchema / resultSchema.
  toolSchemaAnchors: ReadonlyMap<string, ToolCallSchemas> =
    EMPTY_TOOL_SCHEMA_ANCHORS;
  // Delivery-receipt anchors survive remounts for the same reason: a
  // snapshot-seeded reconnect replays only past the cursor, so the
  // historical subagent_results_delivered markers the dividers were
  // derived from never re-arrive on the wire. Same degrade seam: the
  // transcript re-validates on seed, so a malformed entry becomes a
  // missing row, never a wedged resume.
  subagentDeliveryAnchors: ReadonlyMap<string, DeliveredResult[]> =
    EMPTY_SUBAGENT_DELIVERY_ANCHORS;
  // Block-timing anchors survive remounts for the same reason:
  // the client carries no per-event server timestamp onto the messages it
  // builds, and a snapshot-seeded reconnect replays only past the cursor,
  // so this map is historical blocks' only timing home.
  // Unlike every sibling anchor, the backing map MUTATES: timing moves
  // on every block boundary, and a copy-per-write would cost O(N) per
  // event — O(N²) over an N-block replay — so blockTimingRevision, not
  // map identity, is the change signal (entries stay immutable; the
  // snapshot derivation copies before publishing).
  blockTimingRevision = 0;
  private readonly _blockTimingAnchors = new Map<string, BlockTiming>();

  get blockTimingAnchors(): ReadonlyMap<string, BlockTiming> {
    return this._blockTimingAnchors;
  }
  // Turn-usage anchors survive remounts for the same reason:
  // the turn_usage_recorded marker never becomes a message. Absence
  // means usage unknown — the number hides, never estimates.
  turnUsageAnchors: ReadonlyMap<string, TurnUsage> = EMPTY_TURN_USAGE_ANCHORS;
  // Memory-provenance anchors survive remounts for the same
  // reason: the memory_updated marker never becomes a message. Keyed by
  // the durable memory id, so re-deliveries reconcile, never duplicate.
  memoryProvenanceAnchors: ReadonlyMap<string, MemoryUpdated> =
    EMPTY_MEMORY_PROVENANCE_ANCHORS;
  // Memory-attribution anchors: memory id → the assistant
  // prose message its footer renders under. Survives remounts with its
  // provenance sibling; first attribution wins (the anchor family's
  // drifted-message arbitration), so a re-delivery never moves a footer.
  memoryAttributionAnchors: ReadonlyMap<string, string> =
    EMPTY_MEMORY_ATTRIBUTION_ANCHORS;
  // One anchor per RESUMPTION, ever: the parked snapshot's
  // cursor sits inside an unsettled run, so a background attach's
  // boundary-snap re-delivers that run in full — content filtered,
  // CUSTOM markers passed by design — and an unarbitrated run_resumed
  // would flush under a drifted message id (the first post-attach
  // message). Keyed by run id plus the payload's own (round, attempt)
  // — round-less legacy rows by their event's stamped timestamp — wire
  // data either way, no client-side counting; the premise
  // lives at recordResumeAnchor.
  private readonly anchoredResumptions = new Set<string>();
  // One receipt row per failed run, ever: re-deliveries (StrictMode's
  // double connection, every reconnect's replay) flush against whatever
  // the message list holds at that moment, so the same receipt can try
  // to anchor under a different message id. First anchor wins.
  private readonly anchoredFailedRuns = new Set<string>();
  // One divider per delivery run, ever: a re-delivery flushes against
  // whatever the message list holds at that moment, so the same divider
  // can try to anchor under a drifted message id — the run's own id
  // arbitrates, first anchor wins.
  private readonly anchoredDeliveryRuns = new Set<string>();

  /** Returns false when this resumption already anchored. Keyed by run id
   *  plus the payload's own (round, attempt) — a round-less legacy row by the
   *  marker's stamped timestamp; premises: docs/stream-resume.md. */
  // markerTimestamp is REQUIRED, not defaulted: the untimed collapse
  // branch is a documented degradation, and a caller must say null out
  // loud to land on it — never arrive there by omitting an argument.
  recordResumeAnchor(
    runId: string | null,
    messageId: string,
    markerValue: unknown,
    markerTimestamp: number | null,
  ): boolean {
    const attempt = _wireCounterOf(markerValue, "attempt");
    const carriesRound =
      typeof markerValue === "object" &&
      markerValue !== null &&
      typeof (markerValue as Record<string, unknown>).round === "number";
    const key = carriesRound
      ? `${runId ?? "unknown-run"}#${String(_wireCounterOf(markerValue, "round"))}#${String(attempt)}`
      : `${runId ?? "unknown-run"}#legacy:${markerTimestamp === null ? "untimed" : String(markerTimestamp)}#${String(attempt)}`;
    if (this.anchoredResumptions.has(key)) {
      return false;
    }
    this.anchoredResumptions.add(key);
    // Null, never undefined: consumers read presence with .get(), and a
    // payload-less legacy marker must still read as anchored.
    this.resumeAnchors.set(messageId, markerValue ?? null);
    return true;
  }

  /** Returns false when this failed run's receipt already anchored. */
  recordTurnFailedReceipts(
    failedRunId: string,
    messageId: string,
    position: keyof AnchoredTurnFailReceipts,
    receipts: string[],
  ): boolean {
    if (this.anchoredFailedRuns.has(failedRunId)) {
      return false;
    }
    this.anchoredFailedRuns.add(failedRunId);
    this.turnFailedAnchors = withTurnFailedAnchored(
      this.turnFailedAnchors,
      messageId,
      position,
      receipts,
    );
    return true;
  }

  /** Returns false when this delivery run's receipt already anchored. */
  recordSubagentDelivery(
    deliveryRunId: string,
    messageId: string,
    results: DeliveredResult[],
  ): boolean {
    if (this.anchoredDeliveryRuns.has(deliveryRunId)) {
      return false;
    }
    this.anchoredDeliveryRuns.add(deliveryRunId);
    this.subagentDeliveryAnchors = withSubagentDeliveryAnchored(
      this.subagentDeliveryAnchors,
      messageId,
      results,
    );
    return true;
  }

  recordToolError(toolCallId: string, errorText: string): void {
    this.toolErrorAnchors = withToolErrorAnchored(
      this.toolErrorAnchors,
      toolCallId,
      errorText,
    );
  }

  recordToolRefusal(toolCallId: string, sentence: string): void {
    this.toolRefusalAnchors = withToolRefusalAnchored(
      this.toolRefusalAnchors,
      toolCallId,
      sentence,
    );
  }

  recordToolCancel(toolCallId: string): void {
    this.toolCancelAnchors = withToolCancelAnchored(
      this.toolCancelAnchors,
      toolCallId,
    );
  }

  recordToolDecision(toolCallId: string): void {
    this.toolDecisionAnchors = withToolDecisionAnchored(
      this.toolDecisionAnchors,
      toolCallId,
    );
  }

  recordToolDenialMarker(marker: ToolDenialMarker): void {
    this.toolDenialLedger = withToolDenialMarkerFolded(
      this.toolDenialLedger,
      marker,
    );
  }

  recordToolOffload(toolCallId: string): void {
    this.toolOffloadAnchors = withToolOffloadAnchored(
      this.toolOffloadAnchors,
      toolCallId,
    );
  }

  recordToolCallDisplay(toolCallId: string, display: ToolCallDisplay): void {
    this.toolCallDisplayAnchors = withToolCallDisplayAnchored(
      this.toolCallDisplayAnchors,
      toolCallId,
      display,
    );
  }

  recordToolSchemas(toolCallId: string, schemas: ToolCallSchemas): void {
    this.toolSchemaAnchors = withToolSchemasAnchored(
      this.toolSchemaAnchors,
      toolCallId,
      schemas,
    );
  }

  recordBlockTiming(blockId: string, observedAtMs: number): void {
    if (
      foldBlockTimingObserved(this._blockTimingAnchors, blockId, observedAtMs)
    ) {
      this.blockTimingRevision += 1;
    }
  }

  recordTurnUsage(usage: TurnUsage): void {
    this.turnUsageAnchors = withTurnUsageAnchored(this.turnUsageAnchors, usage);
  }

  recordMemoryUpdate(update: MemoryUpdated): void {
    this.memoryProvenanceAnchors = withMemoryUpdateAnchored(
      this.memoryProvenanceAnchors,
      update,
    );
  }

  recordMemoryAttribution(memoryId: string, messageId: string): void {
    this.memoryAttributionAnchors = withMemoryAttributed(
      this.memoryAttributionAnchors,
      memoryId,
      messageId,
    );
  }

  /** Records the resume pair. Named for what it records — a consistent
   *  (messages, cursor) PAIR, at any block-complete close, terminal or
   *  quiet — never an assertion that the run settled (the recording
   *  rule lives at resumeSnapshotRecorder). */
  recordPair(afterId: string, messages: readonly Readonly<Message>[]): void {
    this.snapshot = { afterId, messages: structuredClone([...messages]) };
  }
}

/** The tolerant wire read behind the resume arbitration key (the
 *  approval-inbox idiom): legacy markers may carry no payload at all,
 *  so a missing or non-numeric field reads as 0. Round-less rows never
 *  reach the round read — the key's legacy branch uses the event's
 *  stamped timestamp instead (see recordResumeAnchor). */
function _wireCounterOf(payload: unknown, field: "round" | "attempt"): number {
  if (typeof payload !== "object" || payload === null) {
    return 0;
  }
  const value = (payload as Record<string, unknown>)[field];
  return typeof value === "number" ? value : 0;
}

/**
 * A run_resumed CUSTOM event never becomes a message, so it cannot be
 * read from the message list alone. This subscriber anchors each marker
 * to the first message that appears after it; the transcript's
 * severance scan reads the anchor to mark the prior attempt's
 * open calls as interrupted.
 */
export function resumeMarkerRecorder(
  onResumeAnchored: (
    runId: string | null,
    messageId: string,
    markerValue: unknown,
    markerTimestamp: number | null,
  ) => void,
): AgentSubscriber {
  // Null (never undefined) doubles as both "no marker pending" reset and
  // a payload-less legacy marker; pendingMarker tracks presence itself.
  // The marker remembers the run it rode in on, plus the event's own
  // stamped timestamp (read off the raw event, because the apply pipeline
  // drops it); the store derives the arbitration key from the run id and the
  // payload's own (round, attempt), falling back to the timestamp for
  // round-less legacy rows — no ordinal is counted here.
  let pendingMarker: {
    runId: string | null;
    value: unknown;
    timestamp: number | null;
  } | null = null;
  let currentRunId: string | null = null;
  return {
    onRunStartedEvent({ event }) {
      currentRunId = event.runId;
    },
    onCustomEvent({ event }) {
      if (event.name === RUN_RESUMED_EVENT_NAME) {
        pendingMarker = {
          runId: currentRunId,
          value: event.value,
          timestamp:
            typeof event.timestamp === "number" ? event.timestamp : null,
        };
      }
    },
    onMessagesChanged({ messages }) {
      const newestMessage = messages.at(-1);
      if (pendingMarker === null || newestMessage === undefined) {
        return;
      }
      const marker = pendingMarker;
      pendingMarker = null;
      onResumeAnchored(
        marker.runId,
        newestMessage.id,
        marker.value,
        marker.timestamp,
      );
    },
  };
}

/**
 * The subscriber that records a resume pair: at any close that is
 * BLOCK-COMPLETE (every block START this connection applied has its END),
 * non-failed, and committed a cursor — terminal or quiet. The
 * premises, and what breaks if the gate is wrong: docs/stream-resume.md.
 *
 * A resumed stream that closed silently applied nothing and committed
 * no cursor — the cursor guard keeps the previous pair. The state
 * resets per run: one agent can be connected more than once, and a
 * stale failure must not veto (or stale completeness approve) a later
 * run's recording.
 *
 * Subscribe this through the component tree, never on a bare agent: only
 * the mounted agent's message list carries the injector's spliced user
 * messages, and an orphaned connection recording its bare list would
 * poison the store.
 */
export function resumeSnapshotRecorder(
  cursorOf: () => string | null,
  store: StreamResumeStore,
): AgentSubscriber {
  let failed = false;
  const openBlocks = new Set<string>();
  return {
    onRunInitialized() {
      failed = false;
      openBlocks.clear();
    },
    // The pipeline routes run lifecycle to the dedicated handlers and
    // everything else (content, markers) through onEvent — where the
    // block ledger tracks every START against its END.
    onEvent({ event }) {
      const edge = _blockEdgeOf(event);
      if (edge === null) {
        return;
      }
      if (edge.opens) {
        openBlocks.add(edge.key);
      } else {
        openBlocks.delete(edge.key);
      }
    },
    onRunFailed() {
      failed = true;
    },
    onRunFinalized({ messages }) {
      // By finalize the scanner has seen every byte the parser
      // dispatched, so the cursor and the applied messages agree.
      const cursor = cursorOf();
      if (!failed && openBlocks.size === 0 && cursor !== null) {
        store.recordPair(cursor, messages);
      }
    },
  };
}

/** The block ledger's edges: which events open a content block and which
 *  close it, keyed so unrelated block families cannot cancel each other.
 *  Atomic events (TOOL_CALL_RESULT, markers, lifecycle) hold no open
 *  state and return null. */
function _blockEdgeOf(
  event: BaseEvent,
): { key: string; opens: boolean } | null {
  const messageKey = () =>
    `message:${(event as BaseEvent & { messageId: string }).messageId}`;
  const toolKey = () =>
    `tool:${(event as BaseEvent & { toolCallId: string }).toolCallId}`;
  switch (event.type) {
    case EventType.TEXT_MESSAGE_START:
      return { key: messageKey(), opens: true };
    case EventType.TEXT_MESSAGE_END:
      return { key: messageKey(), opens: false };
    case EventType.TOOL_CALL_START:
      return { key: toolKey(), opens: true };
    case EventType.TOOL_CALL_END:
      return { key: toolKey(), opens: false };
    case EventType.REASONING_START:
      return { key: `reasoning:${messageKey()}`, opens: true };
    case EventType.REASONING_END:
      return { key: `reasoning:${messageKey()}`, opens: false };
    case EventType.REASONING_MESSAGE_START:
      return { key: `reasoning-message:${messageKey()}`, opens: true };
    case EventType.REASONING_MESSAGE_END:
      return { key: `reasoning-message:${messageKey()}`, opens: false };
    default:
      return null;
  }
}

type AuthorizedFetch = (
  url: string,
  requestInit: RequestInit,
) => Promise<Response>;

// The id: line carries a decimal integer by contract; anything else on
// the wire is not a cursor and must not be echoed back.
const DECIMAL_ID = /^\d+$/;

/**
 * Reads the SSE `id:` lines off the raw response bytes. `@ag-ui/client`'s
 * parser surfaces only `data:` lines, so the cursor is captured by teeing
 * the body through a pass-through transform — bytes reach the parser
 * untouched. An id is committed only at its frame's terminating blank
 * line: an `id:` whose frame never completed was never dispatched by the
 * parser either, and must not advance the cursor.
 */
export class SseFrameIdScanner {
  lastEventId: string | null = null;
  // Whether THIS connection's SSE body has delivered any bytes at all —
  // keepalive comment frames included, since they never commit a cursor
  // but do prove the wire was alive past the headers. The liveness fact
  // for failure classification, kept apart from lastEventId on
  // purpose: the replay cursor answers "what do we replay past", not
  // "did bytes flow", and overloading it misread keepalive-only
  // connections as never-responded.
  bodyBytesSeen = false;
  private buffer = "";
  private pendingId: string | null = null;
  private frameHasData = false;
  private decoder = new TextDecoder();

  wrap(fetchFn: AuthorizedFetch): AuthorizedFetch {
    return async (url, requestInit) => {
      const response = await fetchFn(url, requestInit);
      if (!response.ok || response.body === null || !_isEventStream(response)) {
        return response;
      }
      this._resetConnectionState();
      return new Response(this._scannedCopyOf(response.body), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    };
  }

  // A hand-rolled pump instead of pipeThrough(TransformStream): the pipe's
  // internal promise surfaces source errors as unhandled rejections (Node),
  // while a rejecting pull() errors the stream through a handled path.
  private _scannedCopyOf(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader();
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        this._scan(value);
        controller.enqueue(value);
      },
      // Cancelling an already-errored source rejects; the stream is being
      // abandoned either way, so that rejection must not escape.
      cancel: (reason) => reader.cancel(reason).catch(() => undefined),
    });
  }

  // A retried connection must not inherit the previous body's partial
  // line or frame — nor its liveness fact; the committed cursor survives
  // on purpose.
  private _resetConnectionState(): void {
    this.buffer = "";
    this.pendingId = null;
    this.frameHasData = false;
    this.bodyBytesSeen = false;
    this.decoder = new TextDecoder();
  }

  private _scan(chunk: Uint8Array): void {
    this.bodyBytesSeen = true;
    this.buffer += this.decoder.decode(chunk, { stream: true });
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      this._scanLine(line);
    }
  }

  private _scanLine(line: string): void {
    if (line === "") {
      if (this.pendingId !== null && this.frameHasData) {
        this.lastEventId = this.pendingId;
      }
      this.pendingId = null;
      this.frameHasData = false;
      return;
    }
    if (line.startsWith("id:")) {
      const value = line.slice("id:".length).replace(/^ /, "");
      this.pendingId = DECIMAL_ID.test(value) ? value : null;
    } else if (line.startsWith("data:")) {
      this.frameHasData = true;
    }
  }
}

function _isEventStream(response: Response): boolean {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.startsWith("text/event-stream");
}
