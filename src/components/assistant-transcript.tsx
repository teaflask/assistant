"use client";

import type { AbstractAgent } from "@ag-ui/client";
import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import type { ApprovalCardModel } from "../core/approval-inbox.js";
import type { MarkerAnchorsSnapshot } from "../core/connection-epoch.js";
import { hostFillDeclines } from "../core/host-fill.js";
import {
  connectionErrorRecorder,
  messagesSnapshotRecorder,
  type MessagesSnapshot,
} from "../core/messages-cell.js";
import type { DeliveredResult } from "../core/subagent-delivery-anchors.js";
import {
  EMPTY_TOOL_CALL_DISPLAY_ANCHORS,
  toolCallDisplayRecorder,
  withToolCallDisplayAnchored,
} from "../core/tool-call-display-anchors.js";
import {
  EMPTY_TOOL_CANCEL_ANCHORS,
  toolCancelRecorder,
  withToolCancelAnchored,
} from "../core/tool-cancel-anchors.js";
import {
  EMPTY_TOOL_ERROR_ANCHORS,
  toolErrorRecorder,
  withToolErrorAnchored,
} from "../core/tool-error-anchors.js";
import {
  EMPTY_TOOL_OFFLOAD_ANCHORS,
  toolOffloadRecorder,
  withToolOffloadAnchored,
} from "../core/tool-offload-anchors.js";
import {
  EMPTY_TOOL_DENIAL_LEDGER,
  toolDenialRecorder,
  withToolDenialMarkerFolded,
} from "../core/tool-denial-anchors.js";
import {
  EMPTY_TOOL_REFUSAL_ANCHORS,
  toolRefusalRecorder,
  withToolRefusalAnchored,
} from "../core/tool-refusal-anchors.js";
import {
  transcriptBlocksOf,
  type MarkerBoundaries,
  type TranscriptRow,
} from "../core/transcript-rows.js";
import type { TurnAttachment } from "../contract/threads.js";
import {
  MessageList,
  type MessageViewSlot,
  type ToolRowSlot,
  type TranscriptMarkerProps,
} from "./message-list.js";
import { HostSlotBoundary } from "./slot-boundary.js";
import { useLatestRef } from "./use-latest-ref.js";

// The one transcript surface, three binders: the package's own
// Transcript, the dashboard's agent-run viewer, and the playground all
// render through this component. Two source modes, a discriminated union
// so no prop combination silently no-ops: AGENT mode ("AbstractAgent in,
// rows out") owns the connection — the recorder subscription, connect on
// mount, unsubscribe-then-abort on teardown — and projects the blocks
// itself (transcriptBlocksOf), with the host's marker composite
// bracketing every block; ROWS mode passes the host's projected rows
// straight through with the store facts beside them. The frame is a
// fragment — the host's flex parent keeps layout ownership. Five slots:
// four inside HostSlotBoundary with package fallbacks, `input`
// deliberately unbounded (the input-region rule on the prop); mandatory
// frame elements outside them all; no row/icon/artifact renderer slots —
// per-tool presentation is the tool-view registry's (docs/tool-views.md).

interface TranscriptSlotProps {
  /** Styles the library's scroll element (a height-capped host puts its
   *  max-h here — see MessageList's prop). */
  scrollClassName?: string;
  /** The host row fill — content only; the package keeps each row's
   *  frame. Returning null/undefined falls through to the package
   *  rendering per row. */
  messageView?: MessageViewSlot;
  /** The host tool-row fill — replaces exactly the package ToolRow;
   *  receipt collapse, decision surfaces, and the frame's status word
   *  stay package-owned outside it. */
  toolRow?: ToolRowSlot;
  /** In-flow input region under the scroll viewport (a composer).
   *  Unfilled renders nothing: watch-only is the honest default (the
   *  package Composer needs the session store an agent-mode host lacks;
   *  the store binder composes its chrome as siblings). THE INPUT-REGION RULE:
   *  this slot mounts its fill WITHOUT an error boundary — the input
   *  region is the surface's ability to act, and a null-fallback latch
   *  would turn a crash into a paused run that looks idle and cannot be
   *  answered. A throw propagates to the host's own boundary on EVERY
   *  binder, enforced at this one seam. The other four slots keep their
   *  latching boundaries. */
  input?: ReactNode;
  /** Rendered in place of the row list when the log is genuinely empty.
   *  Agent mode withholds it until the first snapshot arrives: a settled
   *  run's fallback states a fact ("recorded no activity"), and stating
   *  it during the connect window would be a falsehood every mount
   *  flashes. Unfilled renders nothing — the package's own welcome
   *  surfaces live a level up (conversation-view), which never mounts a
   *  transcript while empty. */
  welcomeScreen?: ReactNode;
  /** Chrome beside the transcript, above the scroll viewport — never a
   *  row source. Unfilled renders nothing. DELIBERATELY UNCONSUMED: the
   *  slot is part of the surface's contract and ships with its filled
   *  and unfilled tests; the package's ThreadHistory is the intended
   *  filler. Not scaffolding to delete. */
  threadList?: ReactNode;
}

export interface AgentTranscriptSource extends TranscriptSlotProps {
  agent: AbstractAgent;
  /** The stream's failure tap (pre-stream failures, verify errors, and
   *  RUN_ERROR terminals — including replayed historical ones; the hosts
   *  absorb those). */
  onStreamError: (error: Error) => void;
  /** Module-level composite of the host's marker rows, invoked before
   *  and after every message block. */
  markers?: ComponentType<TranscriptMarkerProps>;
  /** Where the host's marker rows anchor — a marker splits folds and
   *  delegation groups exactly as a visible row would. Omit ONLY where
   *  no marker can fall between two delegation moments. */
  markerBoundaries?: MarkerBoundaries;
  /** The retry-marker anchor ids alone — never the merged boundary sets
   *  above, which say nothing about an attempt restart. Tool calls left
   *  open behind the last of these read severed instead of spinning
   *  forever. */
  resumeAnchoredIds?: ReadonlySet<string>;
  /** The delivery-marker anchor ids — the turn-start boundary for
   *  machine-initiated delivery turns, which begin with no user
   *  message. The host's own marker draws the divider; the projection
   *  renders none (the anchors ride in empty). */
  deliveryAnchoredIds?: ReadonlySet<string>;
  /** Each injected user message's attachments keyed by its stable id
   *  (`user:{turnId}`) — the turn rows' side table; attachments never
   *  ride the AG-UI Message itself. */
  turnAttachments?: ReadonlyMap<string, TurnAttachment[]>;
  /** True when the host's own chrome already states the run's liveness
   *  for the whole live window (the run viewer's live line). The
   *  package's standalone trailing claimants then yield in every state —
   *  MessageList's liveness-ownership rule — so the frame never carries
   *  two live claims. Content liveness (fold headlines, streaming prose)
   *  is unaffected. */
  frameClaimsLiveness?: boolean;
  rows?: never;
  cards?: never;
  live?: never;
  turnOpen?: never;
  decisionSurfacesInShelf?: never;
}

export interface RowsTranscriptSource extends TranscriptSlotProps {
  /** The host-projected flat rows (the store path). */
  rows: readonly TranscriptRow[];
  cards?: readonly ApprovalCardModel[];
  live?: boolean;
  turnOpen?: boolean;
  decisionSurfacesInShelf?: boolean;
  agent?: never;
  onStreamError?: never;
  markers?: never;
  markerBoundaries?: never;
  resumeAnchoredIds?: never;
  deliveryAnchoredIds?: never;
  turnAttachments?: never;
  frameClaimsLiveness?: never;
}

export type AssistantTranscriptProps =
  AgentTranscriptSource | RowsTranscriptSource;

export function AssistantTranscript(props: AssistantTranscriptProps) {
  // Two internal components so each mode's hook list stays static;
  // switching source kinds remounts, which is the honest lifecycle (an
  // agent-mode mount owns a connection the rows mode never opened).
  if (props.agent !== undefined) {
    return <AgentModeTranscript {...props} />;
  }
  return <RowsModeTranscript {...props} />;
}

const EMPTY_SNAPSHOT: MessagesSnapshot = { messages: [], running: false };
const NO_CARDS: readonly ApprovalCardModel[] = [];
const NO_IDS: ReadonlySet<string> = new Set();
// The anchor families this surface has no recorder for (the ./transcript
// entry's scope note): passable empty by design — absent facts degrade
// the rows honestly (no timing → "Worked", no memory attribution → no
// footer), never crash.
const NO_MAP: ReadonlyMap<string, never> = new Map<string, never>();

/** A recorder callback that folds its arguments into an anchor map:
 *  `setter(previous => merge(previous, ...args))`, typed once for the
 *  five anchor families the transcript records. */
function anchorInto<S, A extends unknown[]>(
  setter: Dispatch<SetStateAction<S>>,
  merge: (previous: S, ...args: A) => S,
): (...args: A) => void {
  return (...args) => {
    setter((previous) => merge(previous, ...args));
  };
}

interface AgentRecording {
  snapshot: MessagesSnapshot | null;
  displayAnchors: typeof EMPTY_TOOL_CALL_DISPLAY_ANCHORS;
  errorAnchors: typeof EMPTY_TOOL_ERROR_ANCHORS;
  cancelAnchors: typeof EMPTY_TOOL_CANCEL_ANCHORS;
  offloadAnchors: typeof EMPTY_TOOL_OFFLOAD_ANCHORS;
  refusalAnchors: typeof EMPTY_TOOL_REFUSAL_ANCHORS;
  denialLedger: typeof EMPTY_TOOL_DENIAL_LEDGER;
}

/** The connection agent mode owns — recorders subscribed before connect,
 *  unsubscribe-then-abort on teardown — and the snapshot and anchor maps
 *  those recorders publish. */
function useAgentRecording(
  agent: AbstractAgent,
  onStreamError: (error: Error) => void,
): AgentRecording {
  // Null until the recorder publishes its first snapshot — even an empty
  // settled log delivers one (the synthesized RUN_STARTED), so null means
  // exactly "still connecting" and gates the welcome screen.
  const [snapshot, setSnapshot] = useState<MessagesSnapshot | null>(null);
  // Anchor maps for wire facts the message list does not carry as such:
  // backend-authored display copy rides CUSTOM markers, never a message,
  // and the tool-outcome extras reach agent.messages only as lifted
  // metadata (core/tool-outcome.ts) — the recorders keep these maps as the
  // read path, stable across remounts. First-wins merges return the
  // previous map by identity on replayed re-delivery, so StrictMode reruns
  // and reconnect replays no-op these setStates.
  const [displayAnchors, setDisplayAnchors] = useState(
    EMPTY_TOOL_CALL_DISPLAY_ANCHORS,
  );
  const [errorAnchors, setErrorAnchors] = useState(EMPTY_TOOL_ERROR_ANCHORS);
  const [cancelAnchors, setCancelAnchors] = useState(EMPTY_TOOL_CANCEL_ANCHORS);
  // The offload stamp: an offloaded result's content is the offloader's
  // model-facing replacement, not the tool's output — without this set
  // the row would render that replacement as if the tool had said it.
  const [offloadAnchors, setOffloadAnchors] = useState(
    EMPTY_TOOL_OFFLOAD_ANCHORS,
  );
  // The refusal signal: a door that answered and declined stamps
  // `refused` (a sentence) INSTEAD of `error`, so a surface reading only
  // `error` would render the refusal as a clean success whose Result pane
  // shows the refusal envelope — and group a refused dispatch as a
  // coworker that ran.
  const [refusalAnchors, setRefusalAnchors] = useState(
    EMPTY_TOOL_REFUSAL_ANCHORS,
  );
  // The denial ledger: a member's denial reaches the wire as a
  // `cancelled` result, so a surface reading only the cancel stamp
  // renders it "Interrupted". The ledger joins approval_requested to
  // approval_resolved{approved:false} by interrupt id; only its DENIED
  // half reaches the snapshot, and the fold returns the same object when
  // nothing changed, so replays no-op this setState too.
  const [denialLedger, setDenialLedger] = useState(EMPTY_TOOL_DENIAL_LEDGER);

  // The error tap rides a ref so a host handing a fresh closure per
  // render never tears the connection down and replays it.
  const streamErrorRef = useLatestRef(onStreamError);

  useEffect(() => {
    // Subscribe before connect: the recorders must see the replay's
    // first event. Sibling recorder components (markers, approvals)
    // render before this component in the hosts, so their effects — and
    // therefore their subscriptions — run earlier still.
    const taps = [
      agent.subscribe(messagesSnapshotRecorder(setSnapshot)),
      agent.subscribe(
        connectionErrorRecorder((error) => {
          streamErrorRef.current(error);
        }),
      ),
      agent.subscribe(
        toolCallDisplayRecorder(
          anchorInto(setDisplayAnchors, withToolCallDisplayAnchored),
        ),
      ),
      agent.subscribe(
        toolErrorRecorder(anchorInto(setErrorAnchors, withToolErrorAnchored)),
      ),
      agent.subscribe(
        toolCancelRecorder(
          anchorInto(setCancelAnchors, withToolCancelAnchored),
        ),
      ),
      agent.subscribe(
        toolOffloadRecorder(
          anchorInto(setOffloadAnchors, withToolOffloadAnchored),
        ),
      ),
      agent.subscribe(
        toolRefusalRecorder(
          anchorInto(setRefusalAnchors, withToolRefusalAnchored),
        ),
      ),
      agent.subscribe(
        toolDenialRecorder(
          anchorInto(setDenialLedger, withToolDenialMarkerFolded),
        ),
      ),
    ];
    // The recorder carries connection failures (onRunFailed); the
    // rejection here would only duplicate it.
    agent.connectAgent().catch(() => undefined);
    return () => {
      // Unsubscribe BEFORE aborting: the teardown's own synthesized
      // abort RUN_ERROR must never reach the error tap or repaint the
      // message state.
      for (const tap of taps) {
        tap.unsubscribe();
      }
      agent.abortRun();
      void agent.detachActiveRun().catch(() => undefined);
    };
  }, [agent, streamErrorRef]);

  return {
    snapshot,
    displayAnchors,
    errorAnchors,
    cancelAnchors,
    offloadAnchors,
    refusalAnchors,
    denialLedger,
  };
}

function AgentModeTranscript({
  agent,
  onStreamError,
  markers,
  markerBoundaries,
  resumeAnchoredIds = NO_IDS,
  deliveryAnchoredIds = NO_IDS,
  turnAttachments,
  frameClaimsLiveness,
  scrollClassName,
  messageView,
  toolRow,
  input,
  welcomeScreen,
  threadList,
}: AgentTranscriptSource) {
  const {
    snapshot,
    displayAnchors,
    errorAnchors,
    cancelAnchors,
    offloadAnchors,
    refusalAnchors,
    denialLedger,
  } = useAgentRecording(agent, onStreamError);

  const delivered = snapshot ?? EMPTY_SNAPSHOT;
  // Where each declared value lands is enumerated in
  // docs/transcript-surfaces.md, "The agent binder's declared values".
  // The arms easiest to get wrong: deliveryAnchoredIds feeds BOTH the
  // severance scan (presence-based) and MessageList's turnStartIds (the
  // fold pass is ROW-based, so the empty arrays do not suffice);
  // turnAttachments → transcriptBlocksOf's side-table join only;
  // scrollClassName, the five slots → render only.
  const anchors = useMemo<MarkerAnchorsSnapshot>(
    () => ({
      // Presence drives the severance window; the payload is the host's
      // marker state, not the projection's to read.
      resumeAnchors: new Map<string, unknown>(
        [...resumeAnchoredIds].map((id) => [id, null]),
      ),
      // Empty on purpose: a boundary without a row — the host's own
      // marker draws the divider, so a projected one would double it (the
      // row guard is `results.length > 0`). Every consumer that must see
      // the delivery boundary reads the anchor MAP's keys or an explicit
      // id set (the severance scan, the turnStartIds below); only the
      // divider ROW rides the array length — the one thing suppressed.
      subagentDeliveryAnchors: new Map<string, DeliveredResult[]>(
        [...deliveryAnchoredIds].map((id) => [id, []]),
      ),
      toolErrorAnchors: errorAnchors,
      toolCancelAnchors: cancelAnchors,
      toolRefusalAnchors: refusalAnchors,
      // The ledger's presentation half only; the ask map stays
      // in the fold's own state.
      toolDenialAnchors: denialLedger.denied,
      toolCallDisplayAnchors: displayAnchors,
      turnFailedAnchors: NO_MAP,
      toolOffloadAnchors: offloadAnchors,
      toolSchemaAnchors: NO_MAP,
      blockTimingAnchors: NO_MAP,
      turnUsageAnchors: NO_MAP,
      memoryProvenanceAnchors: NO_MAP,
      memoryAttributionAnchors: NO_MAP,
    }),
    [
      resumeAnchoredIds,
      deliveryAnchoredIds,
      errorAnchors,
      cancelAnchors,
      offloadAnchors,
      refusalAnchors,
      denialLedger.denied,
      displayAnchors,
    ],
  );
  // Memoized on the snapshot AND the marker boundaries: marker positions
  // are part of the block derivation (they split delegation groups), so
  // a newly anchored marker legitimately re-runs the dedupe — a rare
  // event, anchors move a handful of times per run.
  const blocks = useMemo(
    () =>
      transcriptBlocksOf(
        delivered.messages,
        anchors,
        delivered.running,
        undefined,
        {
          markerBoundaries,
          attachmentsByMessageId: turnAttachments,
        },
      ),
    [delivered, anchors, markerBoundaries, turnAttachments],
  );

  const showWelcome = _welcomeMomentOf(snapshot, blocks.length, welcomeScreen);
  return (
    <TranscriptFrame threadList={threadList} input={input}>
      <MessageList
        blocks={blocks}
        cards={NO_CARDS}
        turnStartIds={deliveryAnchoredIds}
        // The dashboard wire has no turn-status cell: the snapshot's
        // running bit is this surface's one liveness fact, so it carries
        // both the live register and the open-tail fold regime.
        live={delivered.running}
        turnOpen={delivered.running}
        markers={markers}
        markerBoundaries={markerBoundaries}
        frameClaimsLiveness={frameClaimsLiveness}
        scrollClassName={scrollClassName}
        messageView={messageView}
        toolRow={toolRow}
        emptyFallback={
          showWelcome ? (
            <HostSlotBoundary slot="welcomeScreen" fallback={null}>
              {welcomeScreen}
            </HostSlotBoundary>
          ) : undefined
        }
      />
    </TranscriptFrame>
  );
}

/** The welcome screen's moment: a connected, genuinely empty log with a
 *  host welcome to show (agent mode waits for the first snapshot). */
function _welcomeMomentOf(
  snapshot: ReturnType<typeof useAgentRecording>["snapshot"],
  blockCount: number,
  welcomeScreen: AgentTranscriptSource["welcomeScreen"],
): boolean {
  return (
    snapshot !== null && blockCount === 0 && !hostFillDeclines(welcomeScreen)
  );
}

function RowsModeTranscript({
  rows,
  cards = NO_CARDS,
  live,
  turnOpen,
  decisionSurfacesInShelf,
  scrollClassName,
  messageView,
  toolRow,
  input,
  welcomeScreen,
  threadList,
}: RowsTranscriptSource) {
  const showWelcome = rows.length === 0 && !hostFillDeclines(welcomeScreen);
  return (
    <TranscriptFrame threadList={threadList} input={input}>
      <MessageList
        rows={rows}
        cards={cards}
        live={live}
        turnOpen={turnOpen}
        decisionSurfacesInShelf={decisionSurfacesInShelf}
        scrollClassName={scrollClassName}
        messageView={messageView}
        toolRow={toolRow}
        emptyFallback={
          showWelcome ? (
            <HostSlotBoundary slot="welcomeScreen" fallback={null}>
              {welcomeScreen}
            </HostSlotBoundary>
          ) : undefined
        }
      />
    </TranscriptFrame>
  );
}

/** The frame — a fragment, never a box: chrome above the log inside its
 *  slot boundary, the input region below it deliberately unbounded (the
 *  input-region rule above — a throw propagates to the host's own
 *  boundary), each absent from the DOM entirely when unfilled. */
function TranscriptFrame({
  threadList,
  input,
  children,
}: {
  threadList?: ReactNode;
  input?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      {!hostFillDeclines(threadList) ? (
        // The chrome hook div rides INSIDE the boundary (the keying law): it
        // exists to be host-styled, so a latched-away fill takes it along
        // rather than leave an empty strip wearing the host's padding.
        <HostSlotBoundary slot="threadList" fallback={null}>
          <div data-tf-transcript-chrome="">{threadList}</div>
        </HostSlotBoundary>
      ) : null}
      {children}
      {/* Unbounded on purpose — the input-region rule (see the input
          prop's doc): decision-capable chrome never sits behind a null
          fallback, whoever owns it. */}
      {input ?? null}
    </>
  );
}
