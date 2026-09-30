import type { ReactNode } from "react";

import type { SubagentGroupRow as SubagentGroupRowModel } from "../core/subagent-rows.js";
import type { ToolCallViewModel } from "../core/tool-call-display.js";
import type {
  AssistantTextRow,
  SubagentDeliveryRow,
  ToolCallRow,
  TranscriptBlock,
  TranscriptRow,
  UserMessageRow,
} from "../core/transcript-rows.js";

// --- the host slot contracts ------------------------------------------

/** The marker contract AssistantTranscript's agent mode renders under:
 *  the host composite is invoked twice per message block, before and
 *  after, and self-selects by anchor — the chassis' custom-renderer walk,
 *  owned. */
export interface TranscriptMarkerProps {
  message: { id: string };
  position: "before" | "after";
}

/** The row kinds a host messageView may fill. `run-fold`,
 *  `turn-failed-receipts` and `tool-call` rows are deliberately not
 *  offered: the fold geometry and the turn-level failure record are
 *  package-owned structure, and a tool row's seam is the toolRow slot. */
export type TranscriptSlotRow =
  | UserMessageRow
  | AssistantTextRow
  | SubagentGroupRowModel
  | SubagentDeliveryRow;

/** What a host toolRow fill receives: the durable projection row (raw
 *  arguments, raw result, the state ladder's answer), the resolved view
 *  the package ToolRow renders from (its output carries the MEMBER
 *  suppressions), and the pending-decision bit. The row rides beside the
 *  view so an operator binder can show the wire evidence the member
 *  surface suppresses — the TVC suppression laws are scoped to the
 *  package rendering. A whole-row seam, never a second view system:
 *  per-tool presentation is the tool-view registry's (tool-views.md). */
export interface ToolRowSlotProps {
  row: ToolCallRow;
  view: ToolCallViewModel;
  awaitingInput: boolean;
}

/** Fill contracts: returning null, undefined, or either boolean falls
 *  through to the package rendering (SlotOrDefault's fall-through rule —
 *  the values React renders as nothing regardless of content, so
 *  `cond && <X/>` declines on the false arm); renderable emptiness
 *  ("", 0, []) counts as a fill. */
export type MessageViewSlot = (row: TranscriptSlotRow) => ReactNode;
export type ToolRowSlot = (props: ToolRowSlotProps) => ReactNode;

/** Exactly one row source — the same discriminated-union shape
 *  AssistantTranscriptProps uses, so a source-less (or double-sourced)
 *  mount is a type error rather than a silently empty log. */
export type MessageListSource =
  | { rows: readonly TranscriptRow[]; blocks?: never }
  | { blocks: readonly TranscriptBlock[]; rows?: never };
