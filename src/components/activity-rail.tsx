"use client";

import { useContext } from "react";

import { activityTitleOf } from "../core/activity-title.js";
import type { ApprovalCardModel } from "../core/approval-inbox.js";
import type { ElicitationCardModel } from "../core/elicitation-cards.js";
import {
  liveFoldHeadlineOf,
  settledFoldHeadlineOf,
  type RunFoldMember,
  type RunFoldRow,
  type RunFoldStep,
} from "../core/run-folds.js";

import {
  approvalAwaitsMember,
  elicitationAwaitsMember,
} from "../core/suspension-queue.js";
import { anchoredCardsFor } from "./approval-context.js";
import {
  anchoredElicitationsFor,
  ElicitationsContext,
} from "./elicitation-context.js";
import { AssistantMarkdown } from "./markdown/assistant-markdown.js";
import { MemoryUpdatedFooter } from "./memory-updated-footer.js";
import type { ToolRowSlot } from "./message-list-slots.js";
import {
  Disclosure,
  DisclosureChevron,
  useDisclosureVisualState,
} from "./primitives/disclosure.js";
import { ReasoningRow } from "./reasoning-row.js";
import { ShimmerText } from "./streaming-states.js";
import { SurfaceBoundary } from "./surface-boundary.js";
import { ToolCallRows } from "./tool-call-rows.js";
import { useMemberToggleOutrank } from "./use-member-toggle-outrank.js";
import { _foldClaimsLiveness } from "./use-transcript-folds.js";

export function ActivityRail({
  fold,
  cards,
  turnLive,
  inCurrentTurn,
  identityToken,
  decisionSurfacesInShelf,
  toolRow,
}: {
  fold: RunFoldRow;
  cards: readonly ApprovalCardModel[];
  turnLive: boolean;
  /** True while this fold belongs to the transcript's current turn — no
   *  user or subagent-delivery row follows it. Read by the member rows'
   *  own hold (a resolved view or a decision keeps the ROW open for its
   *  turn); the fold itself opens on liveness alone. */
  inCurrentTurn: boolean;
  /** The surface's provenance token — folded narration is assistant
   *  prose and must wear it exactly as the top-level row does (law 10). */
  identityToken: string;
  decisionSurfacesInShelf: boolean;
  toolRow?: ToolRowSlot;
}) {
  const { cards: elicitationCards } = useContext(ElicitationsContext);
  const rows = fold.members;
  // The one shared spelling (see _foldClaimsLiveness): the trailing
  // arbiter must judge this fold exactly as this headline renders it.
  const running = _foldClaimsLiveness(rows, turnLive);
  // The fold's default openness: the section that is WORKING is the one
  // expanded — a fold claiming liveness, or one whose member awaits the
  // member's decision (the row it holds open is the consent reading).
  // Once the work settles the prop releases (true→undefined) and the
  // fold collapses, so a finished section reads as one "Worked for …"
  // line and the transcript stays scannable. A settled member's view,
  // a settled decision and a failed step no longer hold a fold open:
  // the failed step's own row pill names the failure (the headline
  // carries no tally), and the member's explicit toggle outranks every
  // arm, permanently for the fold.
  const awaitingDecision = _groupAwaitsDecision(
    rows,
    cards,
    elicitationCards,
    decisionSurfacesInShelf,
  );
  const foldOpenByDefault = running || awaitingDecision;
  const { groupRef, memberToggled, onGroupActivation } =
    useMemberToggleOutrank();
  const steps = fold.steps.map((step) => (
    <ActivityRailStep
      key={step.kind === "tool-call" ? step.row.key : step.view.key}
      step={step}
      cards={cards}
      inCurrentTurn={inCurrentTurn}
      identityToken={identityToken}
      decisionSurfacesInShelf={decisionSurfacesInShelf}
      toolRow={toolRow}
    />
  ));
  return (
    // Every protocol sequence is ONE piece of work in the transcript,
    // including a one-step run. A stable outer level prevents the visual
    // model from changing based on how many calls the model happened to
    // choose. Its children keep their own disclosures, so expanding the
    // group reveals the timeline and expanding a tool reveals its evidence.
    <div
      data-tf-activity-group=""
      className="tf:my-2"
      ref={groupRef}
      onClickCapture={onGroupActivation}
    >
      <Disclosure
        variant="bare"
        // Open while working or awaiting a decision, released to native
        // once settled (true→undefined collapses once, never remounting
        // this <details>). The member's own toggle outranks it, permanently.
        open={memberToggled ? undefined : foldOpenByDefault || undefined}
        summaryClassName="tf:flex tf:w-fit tf:items-center tf:gap-1.5 tf:py-1.5 tf:text-tf-label tf:text-tf-muted-foreground tf:hover:text-tf-foreground"
        bodyClassName="tf:pt-1"
        summary={
          <>
            <FoldHeadline fold={fold} running={running} />
            <DisclosureChevron revealOnInteraction />
          </>
        }
      >
        {/* The rail grows to its content: an open fold shows every step in
            the transcript's own flow — no inner scroller, no height cap, so
            a tool view inside it is never clipped or scrolled twice. */}
        <div data-tf-activity-rail="">
          <div>{steps}</div>
        </div>
      </Disclosure>
      {/* No settled decision lines render here — the meta-receipt rows were
          deleted: a consent outcome's surfaces are the decision card's own
          footer and the operation row's state pill. Do not restore the lines
          as a bug fix. */}
    </div>
  );
}

/** One step of the rail, in transcript order: a reasoning view, the
 *  narration a completed episode folded, or a tool call inside its own
 *  boundary. */
function ActivityRailStep({
  step,
  cards,
  inCurrentTurn,
  identityToken,
  decisionSurfacesInShelf,
  toolRow,
}: {
  step: RunFoldStep;
  cards: readonly ApprovalCardModel[];
  inCurrentTurn: boolean;
  identityToken: string;
  decisionSurfacesInShelf: boolean;
  toolRow?: ToolRowSlot;
}) {
  if (step.kind === "reasoning") {
    return (
      <div data-tf-activity-step="">
        <ReasoningRow view={step.view} />
      </div>
    );
  }
  if (step.kind === "narration") {
    // Narration that folded into a completed episode: the same prose the
    // top-level assistant-text case renders, in a second home. Carried:
    // the identity token (law 10) and MemoryUpdatedFooter. Deliberately
    // not: the paced reveal (a narration step is settled by construction),
    // the py-2 wrapper (py-1 here is rail geometry, not message padding),
    // the rows' ps-7 label gutter (prose sits flush with the fold's
    // headline, as top-level prose sits flush with the marks — law 5:
    // disclosure adds detail, never indentation), and the copy affordance
    // (that belongs to top-level messages). Item by item: the episode-fold
    // audit record.
    return (
      <div
        data-tf-activity-step=""
        data-tf-activity-narration=""
        data-tf-agent-identity={identityToken}
        className="tf:py-1"
      >
        <AssistantMarkdown>{step.view.text}</AssistantMarkdown>
        {step.view.memoryUpdates !== undefined ? (
          <MemoryUpdatedFooter updates={step.view.memoryUpdates} />
        ) : null}
      </div>
    );
  }
  return (
    <div data-tf-activity-step="">
      {/* Per-row boundary, same contract as the top-level tool-call
          case: the projection runs inside ToolCallRows, inside this
          boundary. */}
      <SurfaceBoundary surface="tool-row">
        <ToolCallRows
          row={step.row}
          cards={cards}
          inCurrentTurn={inCurrentTurn}
          decisionSurfacesInShelf={decisionSurfacesInShelf}
          toolRow={toolRow}
        />
      </SurfaceBoundary>
    </div>
  );
}

/** The fold summary's words. Live, the one shimmered label tracks the work
 *  by disclosure state (TVC-010): COLLAPSED reads the latest step's own
 *  label (liveFoldHeadlineOf); EXPANDED reads the generic "Working…",
 *  because the rail below says what the steps are. The open bit is the
 *  DOM-backed disclosure mirror (useDisclosureVisualState), never the open
 *  prop. Settled, the label is the work's cost ("Worked for 4m 49s",
 *  degrading to "Worked"), NEVER a step label and never an outcome tally: a
 *  step that failed, was interrupted, declined or not approved wears that
 *  word on its own row's pill, where the member who opens the fold reads
 *  it. */
function FoldHeadline({
  fold,
  running,
}: {
  fold: RunFoldRow;
  running: boolean;
}) {
  const open = useDisclosureVisualState()?.open ?? false;
  if (running) {
    const rawLabel = open ? "Working…" : liveFoldHeadlineOf(fold.steps);
    const label = open ? rawLabel : activityTitleOf(rawLabel);
    return (
      // The measured truncation shape (subagent-group-row's idiom): the
      // shimmer root is an atomic inline-grid, so the ellipsis lives on the
      // blockified span inside and grid-cols-1 + max-w-full + min-w-0 make
      // the track shrinkable — one line, never overflowing the 390px
      // contract. The RAW step label rides the wrapper's title (never the
      // inner span: ShimmerText duplicates its children).
      <span className="tf:min-w-0" title={open ? undefined : rawLabel}>
        <ShimmerText className="tf:max-w-full tf:grid-cols-1">
          <span className="tf:block tf:truncate">{label}</span>
        </ShimmerText>
      </span>
    );
  }
  return <span>{settledFoldHeadlineOf(fold.duration)}</span>;
}

/** The fold's decision arm: LIVE pendency only — a member row whose
 *  anchored approval or elicitation card is still actionable or
 *  submitting (approvalAwaitsMember / elicitationAwaitsMember, the one
 *  spelling of "waiting on the human"). The durable `row.decisionBearing`
 *  anchor is the ROW's hold (tool-call-rows.tsx, its decisionBearing
 *  derivation), never the fold's: an answered decision is finished work,
 *  and finished work folds. The cards are read through the same join the
 *  row uses — the shelf tenant's by toolCallId, else the anchored join —
 *  so fold and row agree on which cards are this call's. Every card-store
 *  consumer, classified: docs/transcript-surfaces.md. */
function _groupAwaitsDecision(
  rows: readonly RunFoldMember[],
  approvalCards: readonly ApprovalCardModel[],
  elicitationCards: readonly ElicitationCardModel[],
  decisionSurfacesInShelf: boolean,
): boolean {
  return rows.some((row) => {
    if (row.kind !== "tool-call") {
      return false;
    }
    const approvals = decisionSurfacesInShelf
      ? approvalCards.filter((card) => card.toolCallId === row.toolCallId)
      : anchoredCardsFor(approvalCards, row.toolCallId);
    const elicitations = decisionSurfacesInShelf
      ? elicitationCards.filter((card) => card.toolCallId === row.toolCallId)
      : anchoredElicitationsFor(elicitationCards, row.toolCallId);
    return (
      approvals.some(approvalAwaitsMember) ||
      elicitations.some(elicitationAwaitsMember)
    );
  });
}
