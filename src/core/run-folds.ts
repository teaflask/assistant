// Run folds: the pure grouping pass between the
// row projection and the rendered transcript. Open turn: consecutive
// reasoning/tool rows are one fold, and any other row splits at its exact
// position. Settled turn: each work span unifies around its LAST maximal
// prose run, which stays outside — collapse the work, never the answer.
// Structural only: position and row kinds decide, never content and never
// which views a tool row resolves — a view is inspected at its
// own row inside the fold. Each fold's duration reduces over ITS OWN
// members' server timing. The premises in full:
// docs/transcript-rows-and-folds.md, "Fold premises".

import {
  REASONING_SETTLED_LABEL,
  REASONING_STREAMING_LABEL,
} from "./reasoning-copy.js";
import {
  durationLabelOf,
  settledFoldDurationOf,
  type BlockTiming,
  type SegmentDuration,
} from "./segment-timing.js";
import { toolRowHeadlineOf } from "./tool-call-display.js";
import {
  EMPTY_MARKER_BOUNDARIES,
  type AssistantTextRow,
  type MarkerBoundaries,
  type ReasoningRow,
  type ToolCallRow,
  type TranscriptBlock,
  type TranscriptRow,
} from "./transcript-rows.js";

export type RunFoldMember = ReasoningRow | ToolCallRow | AssistantTextRow;

/** The fold's steps in transcript order: tool calls verbatim, narration
 *  verbatim at its own position, and each CONTIGUOUS run of reasoning rows
 *  merged into one thinking block at the run's position — adjacent deltas
 *  read as one thought; thinking after a tool call stays below it. */
export type RunFoldStep =
  | { kind: "reasoning"; view: ReasoningRow }
  | { kind: "tool-call"; row: ToolCallRow }
  | { kind: "narration"; view: AssistantTextRow };

export interface RunFoldRow {
  kind: "run-fold";
  /** Derived from the first WORK member (reasoning or tool call, never
   *  narration), so stable across the running→settled flip AND episode
   *  unification: a settled episode's key equals the key of the live cluster
   *  it starts with, so a surviving fold's <details> never remounts
   *  mid-conversation (TVC-014 element identity; TVC-084 key continuity). */
  key: string;
  /** The raw member rows — liveness and pending-decision derivations
   *  read these, and each work member still carries its own timing. */
  members: readonly RunFoldMember[];
  steps: readonly RunFoldStep[];
  /** This fold's own span, reduced over its members' timing evidence —
   *  unknown when no member carries any (an old history), never zero. */
  duration: SegmentDuration;
}

/** Reasoning is structurally excluded from the folded list: it only ever
 *  renders inside a run fold. */
export type FoldedTranscriptRow =
  Exclude<TranscriptRow, ReasoningRow> | RunFoldRow;

export interface RunFoldsOptions {
  /** True while the newest turn is non-terminal (queued, working,
   *  awaiting_input, parked — isTerminalTurnStatus's complement): the
   *  trailing turn then keeps the per-cluster live folding so nothing
   *  moves mid-turn and no intermediate paragraph is prematurely read as
   *  the final answer. Settled turns always unify into episodes. */
  openTailTurn?: boolean;
  /** The tail turn's start index, pre-computed by the caller: foldedBlocksOf
   *  derives it ONCE over the whole flat list and hands each segment its
   *  clamped offset, so a mid-open-turn boundary never prematurely
   *  episode-folds the open turn. Outranks openTailTurn; clamped to the list. */
  tailStart?: number;
}

/** Fold the projected rows. Rows before the tail turn (and the whole list
 *  once the newest turn settles) fold as completed episodes; the open tail
 *  turn — from the last user or subagent-delivery row on — keeps the live
 *  per-cluster folding. */
export function runFoldsOf(
  rows: readonly TranscriptRow[],
  options: RunFoldsOptions = {},
): FoldedTranscriptRow[] {
  const folded: FoldedTranscriptRow[] = [];
  const tailStart =
    options.tailStart !== undefined
      ? Math.max(0, Math.min(options.tailStart, rows.length))
      : options.openTailTurn
        ? _tailTurnStartOf(rows)
        : rows.length;
  _pushEpisodeFolds(rows.slice(0, tailStart), folded);
  _pushClusterFolds(rows.slice(tailStart), folded);
  return folded;
}

/** A row either turn-boundary scan may read: the projection's raw rows or
 *  the fold pass's display rows. The union keeps the boundary kinds below as
 *  checked literals — a renamed row kind fails the build here. */
type TurnBoundaryRow = TranscriptRow | FoldedTranscriptRow;

/** The open tail turn starts at the last turn-boundary row — a user message
 *  or a subagent delivery (the projection's severance scan's two kinds). A
 *  list with neither (a bare fixture) is one turn, as is a child transcript,
 *  whose only boundary is its opening brief at index 0. */
function _tailTurnStartOf(rows: readonly TurnBoundaryRow[]): number {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const kind = rows[index].kind;
    if (kind === "user" || kind === "subagent-delivery") {
      return index;
    }
  }
  return 0;
}

const NO_TURN_START_IDS: ReadonlySet<string> = new Set();

/** A block whose rows the declared-start scan counts: the projection's
 *  TranscriptBlock and the fold pass's own FoldedBlock both qualify. */
interface CountableBlock {
  messageId: string;
  rows: readonly TurnBoundaryRow[];
}

/** The newest DECLARED turn start, in flat coordinates over the blocks'
 *  rows — a declared turn-start block marks the boundary at the position
 *  its rows occupy (or would occupy, for a row-less block). */
function _declaredTurnStartOf(
  blocks: readonly CountableBlock[],
  turnStartIds: ReadonlySet<string>,
): number {
  let declaredTurnStart = 0;
  let flatIndex = 0;
  for (const block of blocks) {
    if (turnStartIds.has(block.messageId)) {
      declaredTurnStart = flatIndex;
    }
    flatIndex += block.rows.length;
  }
  return declaredTurnStart;
}

/**
 * Where the current turn starts, as a flat index into `rows`: the LAST
 * boundary of either kind — the newest row the tail scan recognizes or the
 * newest declared turn-start block — whichever is later. `null` blocks
 * means only the row scan applies. The fold pass and the row list's
 * placement hold both read this spelling, so the two windows never disagree.
 */
export function currentTurnStartOf(
  rows: readonly TurnBoundaryRow[],
  blocks: readonly CountableBlock[] | null,
  turnStartIds: ReadonlySet<string> = NO_TURN_START_IDS,
): number {
  return Math.max(
    _declaredTurnStartOf(blocks ?? [], turnStartIds),
    _tailTurnStartOf(rows),
  );
}

/** Completed-episode folding. Within each span between hard
 *  boundaries, the LAST maximal run of prose rows stays top-level — the
 *  turn's last words. Everything before it is ONE episode fold, keyed on
 *  its first work member (the live cluster it started as, so the settled
 *  <details> is the same element); work rows after it (the cut-off tail)
 *  are one trailing fold, so a stopped/failed turn never buries all its
 *  prose. No work row → nothing folds; no prose → the span folds whole.
 *  Position alone decides. */
function _pushEpisodeFolds(
  rows: readonly TranscriptRow[],
  folded: FoldedTranscriptRow[],
): void {
  let pending: RunFoldMember[] = [];
  const flush = () => {
    // The last maximal prose run: [proseStart, proseEnd] inclusive.
    let proseEnd = -1;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      if (pending[index].kind === "assistant-text") {
        proseEnd = index;
        break;
      }
    }
    let proseStart = proseEnd;
    while (
      proseStart > 0 &&
      pending[proseStart - 1].kind === "assistant-text"
    ) {
      proseStart -= 1;
    }
    // Before the run: one episode fold. Maximality guarantees the prefix
    // is empty or ends on a work row, so the fold has its anchor.
    if (proseStart > 0) {
      folded.push(_foldOf(pending.slice(0, proseStart)));
    } else if (proseEnd < 0 && pending.length > 0) {
      // No prose anywhere: the whole span folds.
      folded.push(_foldOf(pending));
    }
    // The run itself, top-level.
    for (let index = Math.max(proseStart, 0); index <= proseEnd; index += 1) {
      folded.push(pending[index] as AssistantTextRow);
    }
    // After the run: work only (maximality again) — the cut-off tail.
    if (proseEnd >= 0 && proseEnd + 1 < pending.length) {
      folded.push(_foldOf(pending.slice(proseEnd + 1)));
    }
    pending = [];
  };
  for (const row of rows) {
    if (
      row.kind === "reasoning" ||
      row.kind === "assistant-text" ||
      row.kind === "tool-call"
    ) {
      pending.push(row);
      continue;
    }
    flush();
    folded.push(row);
  }
  flush();
}

/** Live per-cluster folding: consecutive reasoning/tool rows
 *  are one fold; ANY other row — prose included — splits at its exact
 *  transcript position, so the open turn reads in true chronology. */
function _pushClusterFolds(
  rows: readonly TranscriptRow[],
  folded: FoldedTranscriptRow[],
): void {
  let members: RunFoldMember[] = [];
  const flush = () => {
    if (members.length === 0) {
      return;
    }
    folded.push(_foldOf(members));
    members = [];
  };
  for (const row of rows) {
    if (row.kind === "reasoning") {
      members.push(row);
      continue;
    }
    if (row.kind === "tool-call") {
      members.push(row);
      continue;
    }
    flush();
    folded.push(row);
  }
  flush();
}

/** The settled fold headline. The duration is the member-relevant cost —
 *  never a step count (TVC-011) — and the register is honest about its
 *  evidence: a measured sub-second span reads "<1s", never "Worked for 0s";
 *  an unknown span degrades to the neutral "Worked", never an invented
 *  duration (docs/replay-metadata-contract.md, "Unknown vs sub-second"). */
export function settledFoldHeadlineOf(duration: SegmentDuration): string {
  if (duration.kind === "unknown") {
    return "Worked";
  }
  return `Worked for ${durationLabelOf(duration.durationMs)}`;
}

/**
 * A COLLAPSED live fold's headline: the latest step's own label, so the
 * member tracks the work without expanding (the expanded fold keeps the
 * generic "Working…"). Each label is the one the step's own row wears: a
 * tool call reads toolRowHeadlineOf on its OWN state, a reasoning step the
 * ReasoningRow labels; narration is skipped (prose is not a work step); no
 * usable step → "Working…". Returned RAW: the renderer (FoldHeadline)
 * truncates for display and carries this text as its wrapper's title.
 */
export function liveFoldHeadlineOf(steps: readonly RunFoldStep[]): string {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.kind === "tool-call") {
      return toolRowHeadlineOf({
        toolName: step.row.toolName,
        state: step.row.state,
        input: step.row.argsText,
        display: step.row.display,
      });
    }
    if (step.kind === "reasoning") {
      return step.view.streaming
        ? REASONING_STREAMING_LABEL
        : REASONING_SETTLED_LABEL;
    }
  }
  return "Working…";
}

function _foldOf(members: readonly RunFoldMember[]): RunFoldRow {
  const timings: BlockTiming[] = [];
  for (const member of members) {
    if (member.kind !== "assistant-text" && member.timing !== undefined) {
      timings.push(member.timing);
    }
  }
  // Both fold passes construct a fold only around at least one work row,
  // so the anchor always exists; the fallback merely satisfies the type.
  const anchor =
    members.find((member) => member.kind !== "assistant-text") ?? members[0];
  return {
    kind: "run-fold",
    key: `activity:${anchor.key}`,
    members,
    steps: _stepsInTranscriptOrder(members),
    duration: settledFoldDurationOf(timings),
  };
}

// --- the segmented fold over message blocks --------------------------
//
// The fold pass for hosts that render marker rows around each message block
// (AssistantTranscript's agent mode): the same two regimes over the
// flattened block rows, segmented at the host's declared marker boundaries
// — a visible host marker splits a fold exactly as a visible row would —
// with the tail-turn start computed ONCE globally. Each folded row is
// attributed back to the block containing its first member.

export interface FoldedBlock {
  messageId: string;
  rows: FoldedTranscriptRow[];
}

export function foldedBlocksOf(
  blocks: readonly TranscriptBlock[],
  // tailStart is Omit-ed on purpose: it is the offset THIS function
  // computes and hands down per segment — accepting it here would
  // type-check and silently do nothing.
  options: Omit<RunFoldsOptions, "tailStart"> & {
    markerBoundaries?: MarkerBoundaries;
    /** Message ids that BEGIN a turn without a user message — the
     *  machine-initiated delivery turns. A host that draws its own delivery
     *  marker (agent mode rides the delivery anchors in EMPTY, so no row is
     *  projected) must hand the turn starts in here, or the open tail window
     *  falls back to the previous member turn's user row. */
    turnStartIds?: ReadonlySet<string>;
  } = {},
): FoldedBlock[] {
  const boundaries = options.markerBoundaries ?? EMPTY_MARKER_BOUNDARIES;
  const turnStartIds = options.turnStartIds ?? NO_TURN_START_IDS;
  // Flatten, remembering each row's block by its key (keys are unique
  // across the projection: message ids, `${messageId}:${toolCallId}`,
  // marker keys, `subagents:` group keys).
  const flat: TranscriptRow[] = [];
  const blockIndexByKey = new Map<string, number>();
  // Segment cuts in flat coordinates: a before-boundary cuts ahead of its
  // block's rows, an after-boundary behind them. 0 and length are cuts by
  // construction.
  const cuts = new Set<number>([0]);
  for (const [index, block] of blocks.entries()) {
    if (boundaries.before.has(block.messageId)) {
      cuts.add(flat.length);
    }
    for (const row of block.rows) {
      blockIndexByKey.set(row.key, index);
      flat.push(row);
    }
    if (boundaries.after.has(block.messageId)) {
      cuts.add(flat.length);
    }
  }
  cuts.add(flat.length);
  // The open tail turn starts where the current turn starts (the row
  // scan or the declared start, whichever is later in the flat order).
  const tailStart = options.openTailTurn
    ? currentTurnStartOf(flat, blocks, turnStartIds)
    : flat.length;
  const ordered = [...cuts].sort((a, b) => a - b);
  const foldedBlocks: FoldedBlock[] = blocks.map((block) => ({
    messageId: block.messageId,
    rows: [],
  }));
  for (let cut = 0; cut + 1 < ordered.length; cut += 1) {
    const [start, end] = [ordered[cut], ordered[cut + 1]];
    const folded = runFoldsOf(flat.slice(start, end), {
      tailStart: tailStart - start,
    });
    for (const row of folded) {
      const firstKey = row.kind === "run-fold" ? row.members[0].key : row.key;
      // The key map covers every input row; a fold's first member is one
      // of them. The fallback merely satisfies the type.
      const blockIndex = blockIndexByKey.get(firstKey) ?? 0;
      foldedBlocks[blockIndex].rows.push(row);
    }
  }
  return foldedBlocks;
}

function _stepsInTranscriptOrder(
  members: readonly RunFoldMember[],
): RunFoldStep[] {
  const steps: RunFoldStep[] = [];
  for (const row of members) {
    if (row.kind === "tool-call") {
      steps.push({ kind: "tool-call", row });
      continue;
    }
    if (row.kind === "assistant-text") {
      steps.push({ kind: "narration", view: row });
      continue;
    }
    const previous = steps.at(-1);
    if (previous?.kind === "reasoning") {
      previous.view = {
        ...previous.view,
        text: `${previous.view.text}\n\n${row.text}`,
        streaming: previous.view.streaming || row.streaming,
      };
      continue;
    }
    steps.push({
      kind: "reasoning",
      view: { ...row, key: `reasoning:${row.key}` },
    });
  }
  return steps;
}
