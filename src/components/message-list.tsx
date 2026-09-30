"use client";

import { ArrowDownIcon } from "lucide-react";
import {
  Fragment,
  useLayoutEffect,
  useRef,
  type ComponentType,
  type ReactNode,
} from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

import { PRIMARY_AGENT_IDENTITY_TOKEN } from "../core/agent-identity.js";
import type { ApprovalCardModel } from "../core/approval-inbox.js";
import type { ElicitationCardModel } from "../core/elicitation-cards.js";
import type { FoldedBlock } from "../core/run-folds.js";
import type { MarkerBoundaries } from "../core/transcript-rows.js";
import { settledQuestionsReceiptOfCard } from "../core/question-receipt.js";
import { QuestionSetReceiptRow } from "./elicitation-receipt-row.js";
import { Row } from "./message-list-row.js";
import type {
  MessageListSource,
  MessageViewSlot,
  ToolRowSlot,
  TranscriptMarkerProps,
} from "./message-list-slots.js";
import { TfButton } from "./primitives/button.js";
import { ScrollFollowGuards } from "./scroll-follow-guards.js";
import { HostSlotBoundary } from "./slot-boundary.js";
import { ShimmerText, TypingIndicator } from "./streaming-states.js";
import {
  useMessageListDerivations,
  type DisplayRow,
  type TrailingLivenessClaimant,
} from "./use-transcript-folds.js";

export type {
  MessageListSource,
  MessageViewSlot,
  ToolRowSlot,
  ToolRowSlotProps,
  TranscriptMarkerProps,
  TranscriptSlotRow,
} from "./message-list-slots.js";

// The owned message viewport: use-stick-to-bottom pins the conversation
// to its newest content and lets go when the visitor scrolls up. Both
// growth and initial replay land instantly — an approval card can add
// more than a viewport in one tick, and spring-chasing that jump leaves
// its footer below the apparent bottom; instant controls HOW a followed
// resize lands, not WHETHER. ScrollFollowGuards re-follows when the
// composer sibling shrinks this viewport and restores the wheel and
// scrollbar escapes the library swallows while streaming.

/** MessageList's contract beyond the row source: the host's
 *  declarations. Each member's doc is its contract. */
interface MessageListOptions {
  cards: readonly ApprovalCardModel[];
  /** True when the host renders the actionable decision surfaces through the
   *  activity shelf's suspension slot: pending cards then do NOT mount inline,
   *  and a settled decision renders no transcript prose (no meta-receipt rows)
   *  — only an answered ask keeps its Q→A receipt. Shelf-less hosts (bench,
   *  probes, child previews) keep inline mounting. */
  decisionSurfacesInShelf?: boolean;
  /** The silence-gap dot. The Transcript composition does NOT pass it
   *  (chrome makes no run-state claims); the child transcript preview
   *  still does. Exactly one trailing liveness element renders
   *  (_trailingLivenessClaimantOf); a host that passes typing elects the
   *  dot for its silence gap, never the standalone headline. */
  typing?: boolean;
  /** The identity token this transcript's assistant prose wears (law
   *  10). The SURFACE supplies it, never a constant baked into the row:
   *  this component also renders subagent drill-in/preview transcripts
   *  (child-transcript.tsx), where the prose is the COWORKER's and must
   *  wear its subagent token, not the primary agent's. Defaults to the
   *  primary token for the main transcript. */
  identityToken?: string;
  /** True while the run is the machine's time — queued or working, or a
   *  non-terminal pause with no live decision surface (run-status.ts's
   *  runReadsAsWorking) — OR a send POST still in flight (pendingSend).
   *  Read by the trailing fold's headline (so back-to-back calls never
   *  blink to "Worked"), the standalone "Working…" headline, and the jump
   *  affordance's activity treatment. */
  live?: boolean;
  /** True while the newest turn is still open — non-terminal, i.e.
   *  queued/working AND the HITL pauses. The open tail turn keeps live
   *  per-cluster folding; settled turns unify into completed episode
   *  folds. Keys on the turn's OWN terminality, never on
   *  stream/tail/lease liveness: a host can be mid-turn without a live
   *  stream, and unifying there presents an intermediate paragraph as
   *  the final response only to pop it apart on reconnect. The `live`
   *  default covers only hosts whose rows never outlive their liveness
   *  fact; the call-site audit is the episode-fold audit record. */
  turnOpen?: boolean;
  /** The host's marker composite, blocks mode only: invoked before and
   *  after every block, inside the slot boundary. */
  markers?: ComponentType<TranscriptMarkerProps>;
  /** Where the host's markers render — a visible marker splits folds and
   *  delegation groups exactly as a visible row would (blocks mode). */
  markerBoundaries?: MarkerBoundaries;
  /** Message ids that begin a turn without a user message (the
   *  machine-initiated delivery turns), blocks mode only: agent-mode
   *  hosts ride the delivery anchors in empty — no delivery row is ever
   *  projected — so the fold pass needs the turn starts declared, or the
   *  open tail window falls back to the previous member turn and
   *  re-clusters its settled episode. */
  turnStartIds?: ReadonlySet<string>;
  /** THE LIVENESS-OWNERSHIP RULE: the host declares whether its own frame
   *  already states the run's liveness for the whole live window (the run
   *  viewer's live line does). Declared, the package's standalone trailing
   *  claimants — the Working… headline and the silence dot — yield in
   *  EVERY state; content liveness (fold headlines, streaming shimmer) is
   *  unaffected, being the rows' own words. Undeclared, the package owns
   *  the claim. One rule, one bypass, both states. */
  frameClaimsLiveness?: boolean;
  /** Rendered in place of the row list when the host says the log is
   *  genuinely empty — the HOST owns the gate (AssistantTranscript's
   *  agent mode withholds it until the first snapshot, so a settled
   *  run's "recorded no activity" fact never flashes during the connect
   *  window). */
  emptyFallback?: ReactNode;
  /** Styles the library's scroll element. A height-capped host puts its
   *  max-h HERE: the scroll element's inline height:100% cannot resolve
   *  through an indefinite flex chain, so a cap on any wrapper clips
   *  instead of scrolling. */
  scrollClassName?: string;
  /** The host row fill — content only: the package keeps each row's
   *  wrapper (spacing, identity stamp, pending-echo a11y) and the
   *  provenance footer outside the slot boundary. */
  messageView?: MessageViewSlot;
  /** The host tool-row fill — replaces exactly the package ToolRow; the
   *  settled-ask receipt collapse, the anchored decision surfaces, and
   *  the frame's status word stay package-owned outside it. */
  toolRow?: ToolRowSlot;
  /** The placement holds' master switch: false releases every
   *  view/decision hold to native <details>. The default (true) is right
   *  wherever history carries turn boundaries, because the last
   *  user/subagent-delivery row bounds the hold window. A CHILD
   *  transcript is one turn by construction, so ChildTranscript passes
   *  its dispatch's own running fact instead — a live coworker's calls
   *  hold open like a live parent turn; a settled drill-in reads as the
   *  inspection surface it is. */
  placementHolds?: boolean;
}

export function MessageList({
  cards,
  typing = false,
  live = false,
  turnOpen,
  identityToken = PRIMARY_AGENT_IDENTITY_TOKEN,
  decisionSurfacesInShelf = false,
  markers: Markers,
  markerBoundaries,
  turnStartIds,
  frameClaimsLiveness = false,
  emptyFallback,
  scrollClassName,
  messageView,
  toolRow,
  placementHolds = true,
  ...source
}: MessageListSource & MessageListOptions) {
  const {
    foldedBlocks,
    displayRows,
    currentTurnStart,
    blockStarts,
    unrowedAnsweredAsks,
    liveIndex,
    hostEmptySurfaceShown,
    livenessClaimant,
  } = useMessageListDerivations(source, {
    live,
    typing,
    turnOpen,
    markerBoundaries,
    turnStartIds,
    decisionSurfacesInShelf,
    frameClaimsLiveness,
    emptyFallback,
  });
  const rowAt = (row: DisplayRow, flatIndex: number) => (
    <Row
      key={row.key}
      row={row}
      cards={cards}
      turnLive={live && flatIndex === liveIndex}
      inCurrentTurn={placementHolds && flatIndex >= currentTurnStart}
      identityToken={identityToken}
      decisionSurfacesInShelf={decisionSurfacesInShelf}
      messageView={messageView}
      toolRow={toolRow}
    />
  );
  return (
    // No overflow class here: the scroll element is the div
    // StickToBottom.Content renders around the rows; scrolling this
    // wrapper too would stack a second scroll container over the same region.
    <StickToBottom
      data-tf-message-list=""
      className="tf:relative tf:min-h-0 tf:flex-1"
      resize="instant"
      initial="instant"
      role="log"
    >
      <StickToBottom.Content
        scrollClassName={scrollClassName}
        className="tf:mx-auto tf:flex tf:w-full tf:max-w-3xl tf:flex-col tf:px-4 tf:py-4"
      >
        {/* The doc's condition IS the render site's:
            one predicate, shared with the liveness arbiter's empty-frame
            yield, so what is on screen and who owns the claim can never
            disagree. */}
        {hostEmptySurfaceShown ? emptyFallback : null}
        {foldedBlocks !== null ? (
          <MarkedBlocks
            blocks={foldedBlocks}
            blockStarts={blockStarts}
            markers={Markers}
            rowAt={rowAt}
          />
        ) : (
          displayRows.map((row, index) => rowAt(row, index))
        )}
        <TranscriptTail
          unrowedAnsweredAsks={unrowedAnsweredAsks}
          livenessClaimant={livenessClaimant}
        />
      </StickToBottom.Content>
      <ScrollFollowGuards />
      <ScrollToBottom live={live} />
    </StickToBottom>
  );
}

/** Blocks mode's rows: each block's rows at their flat display offsets,
 *  bracketed by the host's marker composite inside the slot boundary. */
function MarkedBlocks({
  blocks,
  blockStarts,
  markers: Markers,
  rowAt,
}: {
  blocks: readonly FoldedBlock[];
  blockStarts: readonly number[];
  markers: ComponentType<TranscriptMarkerProps> | undefined;
  rowAt: (row: DisplayRow, flatIndex: number) => ReactNode;
}) {
  return blocks.map((block, blockIndex) => (
    <Fragment key={block.messageId}>
      {Markers !== undefined ? (
        <HostSlotBoundary slot="markers" fallback={null}>
          <Markers message={{ id: block.messageId }} position="before" />
        </HostSlotBoundary>
      ) : null}
      {block.rows.map((row, index) =>
        rowAt(row, blockStarts[blockIndex] + index),
      )}
      {Markers !== undefined ? (
        <HostSlotBoundary slot="markers" fallback={null}>
          <Markers message={{ id: block.messageId }} position="after" />
        </HostSlotBoundary>
      ) : null}
    </Fragment>
  ));
}

/** The transcript tail after the rows: the unrowed answered asks'
 *  receipts, the elected standalone liveness claimant, and the activity
 *  tail sentinel. */
function TranscriptTail({
  unrowedAnsweredAsks,
  livenessClaimant,
}: {
  unrowedAnsweredAsks: readonly ElicitationCardModel[];
  livenessClaimant: TrailingLivenessClaimant;
}) {
  return (
    <>
      {unrowedAnsweredAsks.map((card) => {
        // The set's own receipt — or nothing for a dismissal: a decision with
        // no answers and no transcript prose (no meta-receipt row).
        const receipt = settledQuestionsReceiptOfCard(
          card.questions,
          card.answered,
        );
        return receipt === null ? null : (
          <QuestionSetReceiptRow key={card.interruptId} receipt={receipt} />
        );
      })}
      {/* The standalone liveness headline: from the instant of send
            something must say "Working…", but during the POST round trip no
            fold exists yet — and between a settled answer and the next row
            nothing claims the beat either. Same typography and
            shimmer as the fold summary. Rendered only
            when the arbiter above elected it, so the label moves surfaces
            without a frame holding two or neither. */}
      {livenessClaimant === "standalone-headline" ? (
        <div
          data-tf-working-headline=""
          className="tf:py-1.5 tf:text-tf-label tf:text-tf-muted-foreground"
        >
          <ShimmerText>Working…</ShimmerText>
        </div>
      ) : null}
      {livenessClaimant === "typing-dot" ? (
        <div className="tf:py-2">
          <TypingIndicator />
        </div>
      ) : null}
      <div data-tf-activity-tail="" aria-hidden className="tf:shrink-0" />
    </>
  );
}

function ScrollToBottom({ live = false }: { live?: boolean }) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  // The yield-time focus rescue: the moment this affordance renders, the
  // compact-activity overlay goes visibility:hidden (the styles.css
  // yield rule), and a focused pill trigger inside it would be BLURRED
  // to <body> by the browser's next rendering update. A layout effect
  // runs after this button reaches the DOM but before that update, so
  // the trigger still holds focus here — hand it to the one control that
  // replaced the pill. Root-aware: the script-tag build runs in a shadow
  // root, where document.activeElement is the host.
  useLayoutEffect(() => {
    const button = buttonRef.current;
    if (isAtBottom || button === null) {
      return;
    }
    const root = button.getRootNode();
    if (!(root instanceof Document || root instanceof ShadowRoot)) {
      return;
    }
    const active = root.activeElement;
    if (
      active instanceof HTMLElement &&
      active.closest("[data-tf-activity-slot]") !== null
    ) {
      button.focus();
    }
  }, [isAtBottom]);
  if (isAtBottom) {
    return null;
  }
  return (
    // The jump arrow replaces the activity pill during scrollback.
    // Neither control takes space from the transcript.
    <div
      data-tf-scroll-away-jump=""
      className="tf:pointer-events-none tf:absolute tf:inset-x-0 tf:bottom-3 tf:flex tf:justify-center"
    >
      <TfButton
        ref={buttonRef}
        variant="iconFloating"
        // The scroll-away activity treatment: while the run is live and
        // the reader is in scrollback, the same jump affordance wears a
        // pulsing badge dot and says so in its name — one merged
        // control, never a second float, and never an auto-scroll (the
        // only scroll is still this click, which re-engages the follow).
        // The dot is the package's existing working-dot idiom, so both
        // reduced-motion switches (the OS utility and the host kill
        // switch, styles.css) already leave it as a static visible mark.
        data-tf-scroll-away-activity={live ? "" : undefined}
        aria-label={
          live ? "New activity below — scroll to bottom" : "Scroll to bottom"
        }
        className="tf:pointer-events-auto tf:relative tf:size-9"
        onClick={() => {
          void scrollToBottom();
        }}
      >
        <ArrowDownIcon aria-hidden className="tf:size-4" />
        {live ? (
          <span
            aria-hidden
            data-tf-working-dot=""
            className="tf:absolute tf:-end-0.5 tf:-top-0.5 tf:size-2 tf:animate-tf-pulse tf:rounded-full tf:border tf:border-tf-background tf:bg-tf-muted-foreground tf:motion-reduce:animate-none"
          />
        ) : null}
      </TfButton>
    </div>
  );
}
