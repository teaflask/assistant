"use client";

import { useContext, type ReactNode } from "react";

import type { ElicitationCardModel } from "../core/elicitation-cards.js";
import { hostFillDeclines } from "../core/host-fill.js";
import {
  currentTurnStartOf,
  foldedBlocksOf,
  runFoldsOf,
  type FoldedBlock,
  type FoldedTranscriptRow,
  type RunFoldMember,
} from "../core/run-folds.js";
import { subagentOutcomeCountsOf } from "../core/subagent-rows.js";
import type {
  MarkerBoundaries,
  TranscriptRow,
} from "../core/transcript-rows.js";
import { ElicitationsContext } from "./elicitation-context.js";
import type { MessageListSource } from "./message-list-slots.js";
import {
  resolvedSubagentEntryOf,
  SubagentDispatchesContext,
  type SubagentDispatchesJoin,
} from "./subagent-group-row.js";

// Reasoning is structurally excluded: it only ever renders inside a run
// fold, so Row carries no case for it. The fold derivation itself is the
// pure runFoldsOf pass in core/run-folds.ts.
export type DisplayRow = FoldedTranscriptRow;

/** MessageList's per-render derivations, read in one place: the fold
 *  pass, the hold window, the blocks-mode offsets, the tail receipts and
 *  the trailing-liveness election. */
export function useMessageListDerivations(
  source: MessageListSource,
  {
    live,
    typing,
    turnOpen,
    markerBoundaries,
    turnStartIds,
    decisionSurfacesInShelf,
    frameClaimsLiveness,
    emptyFallback,
  }: {
    live: boolean;
    typing: boolean;
    turnOpen: boolean | undefined;
    markerBoundaries?: MarkerBoundaries;
    turnStartIds?: ReadonlySet<string>;
    decisionSurfacesInShelf: boolean;
    frameClaimsLiveness: boolean;
    emptyFallback: ReactNode;
  },
) {
  const { cards: elicitationCards } = useContext(ElicitationsContext);
  const { foldedBlocks, flatRows, displayRows } = useTranscriptFolds(source, {
    live,
    turnOpen,
    markerBoundaries,
    turnStartIds,
  });
  // The current turn's start (the hold window) is the fold pass's own
  // boundary (core/run-folds.ts): the last user or subagent-delivery row,
  // or a later DECLARED turn start (agent-mode delivery turns project no
  // row), so the hold window and the fold window read the same boundaries.
  // Positional on purpose, never a clock: the optimistic echo is a user
  // row, so decay fires at send, and a replay renders identically every
  // time.
  const currentTurnStart = currentTurnStartOf(
    displayRows,
    foldedBlocks,
    turnStartIds,
  );
  // Blocks mode renders per block, so each row's flat display index —
  // what the hold window is measured in — is its block's offset plus
  // its position in the block.
  const blockStarts = _blockStartsOf(foldedBlocks ?? []);
  // An ANSWERED ask whose call never rendered a row (a wire that named
  // no tool_call_id, a history whose call never reached the messages)
  // still renders its Q→A receipt at the tail: the member answered, and
  // that is content. It is the ONE settled-decision tail render left —
  // the meta-receipt lines were deleted as a product decision.
  const unrowedAnsweredAsks = decisionSurfacesInShelf
    ? _unrowedAnsweredAsksOf(flatRows, elicitationCards)
    : NO_UNROWED_ASKS;
  // The liveness anchor is simply the last display row: the only trailing
  // marker row (turn-failed receipts) trails once the run settled.
  const liveIndex = displayRows.length - 1;
  // The one trailing-liveness arbiter (a seam, closed at its
  // mechanism): every element that can claim the beat is decided HERE,
  // from the same facts its renderer reads, so no host and no tail kind
  // can double-claim or drop the claim.
  const dispatchesJoin = useContext(SubagentDispatchesContext);
  // The host's empty surface owns the empty frame: when the host said
  // "the log is genuinely empty" AND gave the words for it, a package
  // "Working…" (or the dot) beside those words is a second liveness
  // claim in one frame — the run viewer's empty streaming state stacked
  // "No activity yet." over "Working…". The host surface is the claimant
  // then; the arbiter yields. An empty live log with NO host surface
  // keeps the standalone headline — one claim either way.
  const hostEmptySurfaceShown =
    !hostFillDeclines(emptyFallback) && displayRows.length === 0;
  // One yield rule: the host's empty surface showing, or
  // the host's declared frame claim, each means the frame already
  // carries the words — the standalone claimants stand down.
  const livenessClaimant =
    hostEmptySurfaceShown || frameClaimsLiveness
      ? "none"
      : _trailingLivenessClaimantOf(displayRows, live, typing, dispatchesJoin);
  return {
    foldedBlocks,
    displayRows,
    currentTurnStart,
    blockStarts,
    unrowedAnsweredAsks,
    liveIndex,
    hostEmptySurfaceShown,
    livenessClaimant,
  };
}

const NO_UNROWED_ASKS: ElicitationCardModel[] = [];

/** The fold derivation, pure per render: blocks mode's segmented pass
 *  or rows mode's flat one. All tool calls stay inside their work fold. */
function useTranscriptFolds(
  source: MessageListSource,
  {
    live,
    turnOpen,
    markerBoundaries,
    turnStartIds,
  }: {
    live: boolean;
    turnOpen: boolean | undefined;
    markerBoundaries?: MarkerBoundaries;
    turnStartIds?: ReadonlySet<string>;
  },
): {
  foldedBlocks: FoldedBlock[] | null;
  flatRows: readonly TranscriptRow[];
  displayRows: readonly DisplayRow[];
} {
  const { rows, blocks } = source;
  // Blocks mode: the segmented fold pass, so a host marker
  // splits folds exactly as a visible row would. Rows mode takes the
  // branch below it always took — the store surfaces' rendering is
  // pinned by the pixel suite and the store-composition suites
  // (the invariant-comment ledger, row 13).
  const foldedBlocks =
    blocks !== undefined
      ? foldedBlocksOf(blocks, {
          openTailTurn: turnOpen ?? live,
          markerBoundaries,
          turnStartIds,
        })
      : null;
  const flatRows = rows ?? blocks.flatMap((block) => block.rows);
  const displayRows =
    foldedBlocks !== null
      ? foldedBlocks.flatMap((block) => block.rows)
      : runFoldsOf(flatRows, {
          openTailTurn: turnOpen ?? live,
        });
  return { foldedBlocks, flatRows, displayRows };
}

/** Each block's offset in the flat display order (blocks mode). */
function _blockStartsOf(blocks: readonly FoldedBlock[]): number[] {
  const starts: number[] = [];
  let next = 0;
  for (const block of blocks) {
    starts.push(next);
    next += block.rows.length;
  }
  return starts;
}

/** The answered asks with no rendered row to settle on (shelf
 *  composition): a wire that named no tool_call_id, or a history whose
 *  call never reached the messages. Their Q→A receipts render
 *  at the transcript tail — content, never meta-narration. Stale asks
 *  render nothing: the meta-receipt rows were deleted, the quiet
 *  stale line with them. */
function _unrowedAnsweredAsksOf(
  rows: readonly TranscriptRow[],
  elicitationCards: readonly ElicitationCardModel[],
): ElicitationCardModel[] {
  const renderedCallIds = new Set<string>();
  for (const row of rows) {
    if (row.kind === "tool-call") {
      renderedCallIds.add(row.toolCallId);
    }
  }
  return elicitationCards.filter(
    (card) =>
      (card.toolCallId === null || !renderedCallIds.has(card.toolCallId)) &&
      card.status === "answered",
  );
}

export type TrailingLivenessClaimant =
  "tail-row" | "standalone-headline" | "typing-dot" | "none";

/** WHO claims the trailing liveness beat — the one arbiter. Exactly one
 *  element may say "work is live" at the transcript tail, across every
 *  host and every tail row kind. Precedence: a claiming tail row (a live
 *  fold, streaming prose, a delegation group with a running member —
 *  resolved through the SAME join the group row renders from); else
 *  `typing` elects the silence-gap dot; else `live` elects the standalone
 *  Working… headline; else none. The full table is in
 *  docs/transcript-surfaces.md and tests/liveness-claimants.test.tsx
 *  executes it. A host-provided empty surface on an empty log outranks
 *  everything here at the call site. The dot OUTRANKS the headline
 *  deliberately: the drill-in preview passes typing alongside live and
 *  keeps its dot; Transcript never passes typing. */
function _trailingLivenessClaimantOf(
  displayRows: readonly DisplayRow[],
  live: boolean,
  typing: boolean,
  dispatches: SubagentDispatchesJoin,
): TrailingLivenessClaimant {
  const last = displayRows.at(-1);
  const tailClaims =
    last !== undefined &&
    ((last.kind === "run-fold" && _foldClaimsLiveness(last.members, live)) ||
      (last.kind === "assistant-text" && last.streaming) ||
      // The group's own headline shimmers exactly when its resolved
      // counts say a member runs — resolved through the SAME exported
      // join the group row renders from (never a respelled predicate),
      // so the arbiter and the row cannot drift.
      (last.kind === "subagent-group" &&
        subagentOutcomeCountsOf(
          last.entries.map((entry) =>
            resolvedSubagentEntryOf(entry, dispatches.byOrdinal),
          ),
        ).running > 0));
  if (tailClaims) {
    return "tail-row";
  }
  if (typing) {
    return "typing-dot";
  }
  if (live) {
    return "standalone-headline";
  }
  return "none";
}

/** One live spelling of "this fold reads as running" — ActivityRail's
 *  headline and the trailing-liveness arbiter both read it. The trailing
 *  fold's turnLive bridges the quiet beat between one call's result and
 *  the next call's start, so back-to-back calls don't blink the headline. */
export function _foldClaimsLiveness(
  members: readonly RunFoldMember[],
  turnLive: boolean,
): boolean {
  return (
    turnLive ||
    members.some(
      (row) =>
        (row.kind === "reasoning" && row.streaming) ||
        (row.kind === "tool-call" && row.state === "input-available"),
    )
  );
}
