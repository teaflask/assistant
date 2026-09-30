import type { Message } from "@ag-ui/core";

import { ServingReplayStreamAgent } from "../transport/replay-stream-agent.js";
import {
  getAssistantThread,
  resolveTurnToolResults,
  streamUrlForThread,
} from "../transport/serving-api.js";
import {
  resumeMarkerRecorder,
  resumeSnapshotRecorder,
  type StreamResumeStore,
} from "../transport/stream-resume.js";
import type { TokenSession } from "../transport/token-session.js";
import {
  approvalInboxRecorder,
  type ApprovalInbox,
  type ApprovalCardModel,
} from "./approval-inbox.js";
import {
  blockTimingRecorder,
  wellFormedBlockTimingAnchorsOf,
} from "./block-timing-anchors.js";
import { consumedInterruptRecorder } from "./consumed-interrupts.js";
import { ExecutionDriver } from "./execution-driver.js";
import type { ExecutionHandler } from "./execution-handlers.js";
import {
  executionInboxRecorder,
  ExecutionInbox,
  type ExecutionEntryModel,
} from "./execution-inbox.js";
import {
  memoryUpdatedRecorder,
  wellFormedMemoryAttributionAnchorsOf,
  wellFormedMemoryProvenanceAnchorsOf,
  type MemoryUpdated,
} from "./memory-provenance-anchors.js";
import type { BlockTiming } from "./segment-timing.js";
import {
  subagentDeliveryMarkerRecorder,
  wellFormedDeliveryAnchorsOf,
  type DeliveredResult,
} from "./subagent-delivery-anchors.js";
import type { ToolCallDisplay } from "./tool-call-display.js";
import {
  toolCallDisplayRecorder,
  wellFormedToolCallDisplayAnchorsOf,
} from "./tool-call-display-anchors.js";
import {
  toolSchemaRecorder,
  wellFormedToolSchemaAnchorsOf,
  type ToolCallSchemas,
} from "./tool-schema-anchors.js";
import {
  toolCancelRecorder,
  wellFormedToolCancelAnchorsOf,
} from "./tool-cancel-anchors.js";
import {
  toolErrorRecorder,
  wellFormedToolErrorAnchorsOf,
} from "./tool-error-anchors.js";
import {
  toolDecisionRecorder,
  wellFormedToolDecisionAnchorsOf,
} from "./tool-decision-anchors.js";
import {
  toolDenialRecorder,
  wellFormedToolDenialAnchorsOf,
} from "./tool-denial-anchors.js";
import {
  toolOffloadRecorder,
  wellFormedToolOffloadAnchorsOf,
} from "./tool-offload-anchors.js";
import {
  toolRefusalRecorder,
  wellFormedToolRefusalAnchorsOf,
} from "./tool-refusal-anchors.js";
import {
  turnFailedMarkerRecorder,
  wellFormedFailAnchorsOf,
  type AnchoredTurnFailReceipts,
} from "./turn-failed-anchors.js";
import {
  turnUsageRecorder,
  wellFormedTurnUsageAnchorsOf,
  type TurnUsage,
} from "./turn-usage-anchors.js";
import { messagesRecorder, streamErrorRecorder } from "./messages-cell.js";
import { userTurnInjector, type UserTurnLedger } from "./user-turn-ledger.js";

// One connection epoch = today's remount-to-reconnect unit, relocated
// into the store: a fresh agent seeded from the resume store, a fresh
// execution inbox (a paused run always re-delivers in full from its
// boundary, so execution entries rebuild from scratch), a fresh execution
// driver with a fresh attempts map — and every store-side subscriber
// attached at construction, strictly BEFORE any connect, which retires
// the old "recorders must render before the chat" tree-order rule.
//
// The APPROVAL inbox is the exception: pending approval asks
// outlive the epoch — they belong to the conversation, beside its ledger
// and resume store — so the epoch receives the thread-lived inbox instead
// of constructing one, and a reconnect's replay re-delivers into it
// idempotently (markers dedupe by interrupt id, receipts keep answered).

export interface MarkerAnchorsSnapshot {
  /** Resume anchors: message id → the run_resumed marker's raw payload
   *  (null for payload-less legacy markers), kept as provenance for the
   *  wire (round, attempt) the key was derived from. Presence
   *  drives the severance scan (a prior attempt's open calls read as
   *  interrupted); the divider row it used to drive went with the
   *  meta-receipt rows. */
  resumeAnchors: ReadonlyMap<string, unknown>;
  /** Failure-receipt anchors: message id → the receipts of a
   *  turn that settled failed outside any single tool, rendered after
   *  the failed run's last message — the failure's durable record. */
  turnFailedAnchors: ReadonlyMap<string, AnchoredTurnFailReceipts>;
  /** Delivery-receipt anchors: message id → the settled
   *  dispatches the machine-started delivery run pushed — the divider
   *  naming them renders before that message. */
  subagentDeliveryAnchors: ReadonlyMap<string, DeliveredResult[]>;
  /** Errored tool calls, toolCallId → the wire's error text. */
  toolErrorAnchors: ReadonlyMap<string, string>;
  /** Cancelled tool calls (they never ran), by toolCallId. */
  toolCancelAnchors: ReadonlySet<string>;
  /** Refused calls: tool call id → the door's refusal sentence,
   *  shown as the declined row's reason. */
  toolRefusalAnchors: ReadonlyMap<string, string>;
  /** Offloaded tool calls (the wire's content is the offloader's
   *  model-facing replacement, not the tool's output), by toolCallId. */
  toolOffloadAnchors: ReadonlySet<string>;
  /** Decision-bearing tool calls: an approval_requested or
   *  member-answerable tool_execution_requested marker named this
   *  toolCallId. The placement hold's durable arm — the card stores
   *  prune at the result and the settle by design, while TVC-014's hold
   *  window is the turn. OPTIONAL because the snapshot type ships on the
   *  `./transcript` composition surface — a host-built
   *  snapshot without the member reads as empty, never breaks. */
  toolDecisionAnchors?: ReadonlySet<string>;
  /** Denied tool calls: the toolCallIds whose approval a
   *  member declined — approval_resolved{approved:false} joined to its
   *  approval_requested's tool_call_id in the resume store's ledger. The
   *  state ladder's rung above `cancelled` (the stamp the wire gives a
   *  denial). OPTIONAL for the same reason as toolDecisionAnchors: the
   *  snapshot type ships on the `./transcript` composition surface, and
   *  a host-built snapshot without the member reads as empty. */
  toolDenialAnchors?: ReadonlySet<string>;
  /** Annotated tool calls, toolCallId → the wire's display copy. */
  toolCallDisplayAnchors: ReadonlyMap<string, ToolCallDisplay>;
  /** Registered tool schemas, toolCallId → the wire's
   *  argsSchema / resultSchema. Absent call = no schema declared (or an
   *  older history) — the view's fields stay `undefined`. */
  toolSchemaAnchors: ReadonlyMap<string, ToolCallSchemas>;
  /** Block timing: block id (messageId/toolCallId) → the
   *  earliest/latest server timestamps observed for it. Absent block =
   *  duration unknown, never zero. */
  blockTimingAnchors: ReadonlyMap<string, BlockTiming>;
  /** Turn usage: turn id → the runtime's own token totals.
   *  Absent turn = usage unknown; the number hides. */
  turnUsageAnchors: ReadonlyMap<string, TurnUsage>;
  /** Memory provenance: durable memory id → the end-user-safe
   *  write receipt, in stream order. */
  memoryProvenanceAnchors: ReadonlyMap<string, MemoryUpdated>;
  /** Memory attribution: memory id → the assistant prose
   *  message its footer renders under. A provenance record without an
   *  attribution renders no footer — old histories degrade, never
   *  synthesize. */
  memoryAttributionAnchors: ReadonlyMap<string, string>;
}

/** The anchors' single source of truth is the resume store (it outlives
 *  every epoch); the snapshot re-validates on derivation so a stale shape
 *  degrades to missing rows, never a crash. */
export function markerAnchorsOf(
  resume: StreamResumeStore,
): MarkerAnchorsSnapshot {
  return {
    resumeAnchors: new Map(resume.resumeAnchors),
    turnFailedAnchors: wellFormedFailAnchorsOf(resume.turnFailedAnchors),
    subagentDeliveryAnchors: wellFormedDeliveryAnchorsOf(
      resume.subagentDeliveryAnchors,
    ),
    toolErrorAnchors: wellFormedToolErrorAnchorsOf(resume.toolErrorAnchors),
    toolCancelAnchors: wellFormedToolCancelAnchorsOf(resume.toolCancelAnchors),
    toolRefusalAnchors: wellFormedToolRefusalAnchorsOf(
      resume.toolRefusalAnchors,
    ),
    toolOffloadAnchors: wellFormedToolOffloadAnchorsOf(
      resume.toolOffloadAnchors,
    ),
    toolDecisionAnchors: wellFormedToolDecisionAnchorsOf(
      resume.toolDecisionAnchors,
    ),
    toolDenialAnchors: wellFormedToolDenialAnchorsOf(
      resume.toolDenialLedger.denied,
    ),
    toolCallDisplayAnchors: wellFormedToolCallDisplayAnchorsOf(
      resume.toolCallDisplayAnchors,
    ),
    toolSchemaAnchors: wellFormedToolSchemaAnchorsOf(resume.toolSchemaAnchors),
    blockTimingAnchors: wellFormedBlockTimingAnchorsOf(
      resume.blockTimingAnchors,
    ),
    turnUsageAnchors: wellFormedTurnUsageAnchorsOf(resume.turnUsageAnchors),
    memoryProvenanceAnchors: wellFormedMemoryProvenanceAnchorsOf(
      resume.memoryProvenanceAnchors,
    ),
    memoryAttributionAnchors: wellFormedMemoryAttributionAnchorsOf(
      resume.memoryAttributionAnchors,
    ),
  };
}

export interface ConnectionEpochDeps {
  epochId: number;
  session: TokenSession;
  threadId: string;
  streamThreadId: string;
  ledger: UserTurnLedger;
  resume: StreamResumeStore;
  /** Read fresh at each execution pass — the host's capability wiring
   *  changes identity with provider re-renders. */
  handlersOf: () => ReadonlyMap<string, ExecutionHandler>;
  /** The thread-lived approval inbox: pending asks must survive
   *  this epoch, so the conversation owns it and the epoch borrows it. */
  approvalInbox: ApprovalInbox;
  publishApprovalCards: (cards: readonly ApprovalCardModel[]) => void;
  /** Every execution-entries snapshot — the store derives the
   *  member-answerable elicitation cards from it. */
  publishExecutionEntries: (entries: readonly ExecutionEntryModel[]) => void;
  /** The resume store moved — the store re-derives the anchors snapshot. */
  publishMarkerAnchors: () => void;
  /** The agent's message list moved — a shallow snapshot per change. */
  publishMessages: (messages: readonly Message[]) => void;
  /** A replayed or live interrupt_answer_consumed marker: a
   *  resume already carried this pause's answer into the agent, so the
   *  pending-decision-gap derivation subtracts the id instead of
   *  alarming. Store-lived (keyed by run AND round — the row's identity
   *  is (run_id, round, interrupt_id), and the store matches the round
   *  against the turn's awaiting_round exactly as the server's
   *  subtraction does) — the fold must survive epoch turnover. */
  noteInterruptAnswerConsumed: (
    runId: string,
    interruptId: string,
    round: number,
  ) => void;
  /** A non-abort connection failure (transport death or a server
   *  RUN_ERROR) — the interruption banner's wire. */
  onStreamError: (error: Error) => void;
  refreshLedger: () => Promise<void>;
  onUserMessageInjected: (messageId: string) => void;
  onRunSettled: () => void;
  onQuietClose: (stillStreaming: () => boolean) => void;
  onWorkflowRestarted: () => void;
}

export interface ConnectionEpoch {
  epochId: number;
  agent: ServingReplayStreamAgent;
  approvalInbox: ApprovalInbox;
  executionInbox: ExecutionInbox;
  threadId: string;
  streamThreadId: string;
  /** The REST side's door into the inbox: a mutation that
   *  answers "did visible state change" publishes through this epoch's
   *  own publisher, which also pokes the driver. */
  withExecutionInbox: (mutate: (inbox: ExecutionInbox) => boolean) => void;
  dispose: () => void;
}

type EpochSubscription = ReturnType<ServingReplayStreamAgent["subscribe"]>;

export function beginConnectionEpoch(
  deps: ConnectionEpochDeps,
): ConnectionEpoch {
  const agent = new ServingReplayStreamAgent({
    streamUrl: streamUrlForThread(deps.session, deps.threadId),
    streamThreadId: deps.streamThreadId,
    authorizedFetch: deps.session.authorizedFetch,
    resume: deps.resume,
  });
  const approvalInbox = deps.approvalInbox;
  const executionInbox = new ExecutionInbox();

  // Each published entries snapshot pokes the driver to (re)schedule a
  // drain — the automatic execution loop — and reaches the store, which
  // derives the member-answerable elicitation cards from it (the
  // driver's eligibility filter skips those kinds; the member is their
  // executor).
  const publishEntries = (entries: readonly ExecutionEntryModel[]) => {
    driver.noteEntriesChanged(entries);
    deps.publishExecutionEntries(entries);
  };
  const driver = new ExecutionDriver({
    inbox: executionInbox,
    threadId: deps.threadId,
    handlersOf: deps.handlersOf,
    fetchThreadDetail: () => getAssistantThread(deps.session, deps.threadId),
    postResults: (turnId, request) =>
      resolveTurnToolResults(deps.session, deps.threadId, turnId, request),
    publishEntries,
    onWorkflowRestarted: deps.onWorkflowRestarted,
  });

  // Subscription order is behaviour: @ag-ui/client dispatches every
  // subscriber of an event in attach order.
  const subscriptions = [
    ..._runMarkerSubscriptionsOf(agent, deps),
    ..._toolMarkerSubscriptionsOf(agent, deps),
    ..._timingAndMemoryMarkerSubscriptionsOf(agent, deps),
    ..._streamStateSubscriptionsOf(agent, deps, {
      approvalInbox,
      executionInbox,
      publishEntries,
    }),
  ];

  return {
    epochId: deps.epochId,
    agent,
    approvalInbox,
    executionInbox,
    threadId: deps.threadId,
    streamThreadId: deps.streamThreadId,
    withExecutionInbox: (mutate) => {
      if (mutate(executionInbox)) {
        publishEntries(executionInbox.entries());
      }
    },
    dispose: () => {
      for (const subscription of subscriptions) {
        subscription.unsubscribe();
      }
      driver.dispose();
      // The store-driven run needs an explicit stop on retire — detach finalizes without a terminal event, the wire
      // shape every recorder already handles.
      void agent.detachActiveRun().catch(() => undefined);
    },
  };
}

/** The run-lifecycle markers: resumption, consumed interrupt answers,
 *  turn failure receipts and subagent delivery dividers. */
function _runMarkerSubscriptionsOf(
  agent: ServingReplayStreamAgent,
  deps: ConnectionEpochDeps,
): EpochSubscription[] {
  return [
    agent.subscribe(
      resumeMarkerRecorder((runId, messageId, markerValue, markerTimestamp) => {
        // The resume store arbitrates: one anchor per RESUMPTION, ever
        // (run id + the payload's own (round, attempt); round-less
        // legacy rows by their stamped timestamp — the
        // failed/delivery siblings' posture) — a filtered re-delivery
        // flushing under a drifted message id records nothing. The anchor
        // drives severance only; its divider went with the meta-receipt rows.
        if (
          deps.resume.recordResumeAnchor(
            runId,
            messageId,
            markerValue,
            markerTimestamp,
          )
        ) {
          deps.publishMarkerAnchors();
        }
      }),
    ),
    agent.subscribe(
      consumedInterruptRecorder((runId, consumed) => {
        deps.noteInterruptAnswerConsumed(
          runId,
          consumed.interruptId,
          consumed.round,
        );
      }),
    ),
    agent.subscribe(
      turnFailedMarkerRecorder((failedRunId, messageId, position, receipts) => {
        // The resume store arbitrates: one receipt row per failed run,
        // ever — a re-delivery can flush under a drifted message id.
        if (
          deps.resume.recordTurnFailedReceipts(
            failedRunId,
            messageId,
            position,
            receipts,
          )
        ) {
          deps.publishMarkerAnchors();
        }
      }),
    ),
    agent.subscribe(
      subagentDeliveryMarkerRecorder((deliveryRunId, messageId, results) => {
        // The resume store arbitrates: one divider per delivery run,
        // ever — a re-delivery can flush under a drifted message id.
        if (
          deps.resume.recordSubagentDelivery(deliveryRunId, messageId, results)
        ) {
          deps.publishMarkerAnchors();
        }
      }),
    ),
  ];
}

/** The per-tool-call markers: each records into the resume store and
 *  publishes only when the store's collection identity moved. */
function _toolMarkerSubscriptionsOf(
  agent: ServingReplayStreamAgent,
  deps: ConnectionEpochDeps,
): EpochSubscription[] {
  return [
    agent.subscribe(
      toolErrorRecorder((toolCallId, errorText) => {
        const before = deps.resume.toolErrorAnchors;
        deps.resume.recordToolError(toolCallId, errorText);
        if (deps.resume.toolErrorAnchors !== before) {
          deps.publishMarkerAnchors();
        }
      }),
    ),
    agent.subscribe(
      toolRefusalRecorder((toolCallId, sentence) => {
        const before = deps.resume.toolRefusalAnchors;
        deps.resume.recordToolRefusal(toolCallId, sentence);
        if (deps.resume.toolRefusalAnchors !== before) {
          deps.publishMarkerAnchors();
        }
      }),
    ),
    agent.subscribe(
      toolCancelRecorder((toolCallId) => {
        const before = deps.resume.toolCancelAnchors;
        deps.resume.recordToolCancel(toolCallId);
        if (deps.resume.toolCancelAnchors !== before) {
          deps.publishMarkerAnchors();
        }
      }),
    ),
    agent.subscribe(
      toolDecisionRecorder((toolCallId) => {
        const before = deps.resume.toolDecisionAnchors;
        deps.resume.recordToolDecision(toolCallId);
        if (deps.resume.toolDecisionAnchors !== before) {
          deps.publishMarkerAnchors();
        }
      }),
    ),
    agent.subscribe(
      toolDenialRecorder((marker) => {
        // Gated on the DENIED half's identity, not the ledger's: an ask
        // changes nothing the snapshot shows, so it must not repaint.
        const before = deps.resume.toolDenialLedger.denied;
        deps.resume.recordToolDenialMarker(marker);
        if (deps.resume.toolDenialLedger.denied !== before) {
          deps.publishMarkerAnchors();
        }
      }),
    ),
    agent.subscribe(
      toolOffloadRecorder((toolCallId) => {
        const before = deps.resume.toolOffloadAnchors;
        deps.resume.recordToolOffload(toolCallId);
        if (deps.resume.toolOffloadAnchors !== before) {
          deps.publishMarkerAnchors();
        }
      }),
    ),
    agent.subscribe(
      toolCallDisplayRecorder((toolCallId, display) => {
        const before = deps.resume.toolCallDisplayAnchors;
        deps.resume.recordToolCallDisplay(toolCallId, display);
        if (deps.resume.toolCallDisplayAnchors !== before) {
          deps.publishMarkerAnchors();
        }
      }),
    ),
    agent.subscribe(
      toolSchemaRecorder((toolCallId, schemas) => {
        const before = deps.resume.toolSchemaAnchors;
        deps.resume.recordToolSchemas(toolCallId, schemas);
        if (deps.resume.toolSchemaAnchors !== before) {
          deps.publishMarkerAnchors();
        }
      }),
    ),
  ];
}

/** Block timing, turn usage and memory provenance/attribution. */
function _timingAndMemoryMarkerSubscriptionsOf(
  agent: ServingReplayStreamAgent,
  deps: ConnectionEpochDeps,
): EpochSubscription[] {
  // The block-timing recorder's publish coalescer — see its subscriber
  // below. True while a snapshot publish is already queued behind the
  // macrotask window, so a burst of boundary events costs one rebuild,
  // not one per event (and not one per subscriber await — the reason
  // the window is a timer, not a microtask).
  let timingPublishQueued = false;
  return [
    agent.subscribe(
      // Timing is the one recorder here whose trigger is NOT a rare
      // CUSTOM marker: it fires on every block boundary (~2 per block),
      // and each firing moves the map (START creates the pair, END
      // widens it). Publishing per firing would rebuild the whole
      // twelve-collection snapshot ~2N times over an N-block replay —
      // quadratic in transcript length — so the STORE write stays
      // synchronous (the resume store is always current for reconnect
      // seeding) while the derived-snapshot publish coalesces behind a
      // MACROTASK window (setTimeout 0). A microtask window does not
      // work here and must not come back: @ag-ui/client's
      // defaultApplyEvents dispatches subscribers with one `await` per
      // subscriber per event, and every await drains the microtask
      // queue — a queueMicrotask publish fires before the NEXT
      // SUBSCRIBER of the same event, coalescing nothing. The whole
      // apply chain for a delivered chunk runs on one macrotask
      // (concatMap's awaits are all microtasks), so a timer queued at
      // the first moved boundary absorbs every boundary the chunk
      // carries. No consumer needs the anchors cell current sooner: the
      // cell has exactly one subscriber-driven React consumer, and live
      // elapsed time ticks off the client's own "now", never off
      // publishes. Change detection is the store's REVISION counter —
      // the timing map mutates in place (see block-timing-anchors), so
      // identity cannot be the gate. A post-teardown timer firing is
      // harmless: publishMarkerAnchors is epoch-guarded and re-seeded
      // synchronously on epoch swap.
      blockTimingRecorder((blockId, observedAtMs) => {
        const before = deps.resume.blockTimingRevision;
        deps.resume.recordBlockTiming(blockId, observedAtMs);
        if (deps.resume.blockTimingRevision === before || timingPublishQueued) {
          return;
        }
        timingPublishQueued = true;
        setTimeout(() => {
          timingPublishQueued = false;
          deps.publishMarkerAnchors();
        }, 0);
      }),
    ),
    agent.subscribe(
      turnUsageRecorder((usage) => {
        const before = deps.resume.turnUsageAnchors;
        deps.resume.recordTurnUsage(usage);
        if (deps.resume.turnUsageAnchors !== before) {
          deps.publishMarkerAnchors();
        }
      }),
    ),
    agent.subscribe(
      memoryUpdatedRecorder({
        onMemoryAnchored: (update) => {
          const before = deps.resume.memoryProvenanceAnchors;
          deps.resume.recordMemoryUpdate(update);
          if (deps.resume.memoryProvenanceAnchors !== before) {
            deps.publishMarkerAnchors();
          }
        },
        // Attribution publishes synchronously like its provenance
        // sibling — memory markers are rare (one per real insert), so
        // the timing coalescer's macrotask window buys nothing here, and
        // a post-settle arrival must repaint without waiting for another
        // event (the footer engages on genuinely late markers).
        onMemoryAttributed: (memoryId, messageId) => {
          const before = deps.resume.memoryAttributionAnchors;
          deps.resume.recordMemoryAttribution(memoryId, messageId);
          if (deps.resume.memoryAttributionAnchors !== before) {
            deps.publishMarkerAnchors();
          }
        },
      }),
    ),
  ];
}

/** The stream's own state: the resume cursor, the user-turn ledger, both
 *  inboxes, the message list and stream errors. */
function _streamStateSubscriptionsOf(
  agent: ServingReplayStreamAgent,
  deps: ConnectionEpochDeps,
  inboxes: {
    approvalInbox: ApprovalInbox;
    executionInbox: ExecutionInbox;
    publishEntries: (entries: readonly ExecutionEntryModel[]) => void;
  },
): EpochSubscription[] {
  return [
    agent.subscribe(
      resumeSnapshotRecorder(() => agent.resumeCursor, deps.resume),
    ),
    agent.subscribe(
      userTurnInjector(deps.ledger, {
        refreshLedger: deps.refreshLedger,
        onUserMessageInjected: deps.onUserMessageInjected,
        onRunSettled: deps.onRunSettled,
      }),
    ),
    agent.subscribe(
      approvalInboxRecorder(
        inboxes.approvalInbox,
        deps.publishApprovalCards,
        () => {
          // The parked contract's only wire signal is the stream simply
          // ending; the handler consults REST, and reading isRunning at
          // that later moment (not now) is what lets it dismiss a
          // connection that already reconnected.
          deps.onQuietClose(() => agent.isRunning);
        },
      ),
    ),
    agent.subscribe(
      executionInboxRecorder(inboxes.executionInbox, inboxes.publishEntries),
    ),
    agent.subscribe(messagesRecorder(deps.publishMessages)),
    agent.subscribe(streamErrorRecorder(deps.onStreamError)),
  ];
}
