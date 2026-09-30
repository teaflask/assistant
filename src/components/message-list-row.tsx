"use client";

import type { ReactNode } from "react";

import type { ApprovalCardModel } from "../core/approval-inbox.js";
import type { AssistantTextRow } from "../core/transcript-rows.js";
import { ActivityRail } from "./activity-rail.js";
import { CopyTextButton } from "./copy-text-button.js";
import { PacedAssistantMarkdown } from "./markdown/paced-assistant-markdown.js";
import { MemoryUpdatedFooter } from "./memory-updated-footer.js";
import type {
  MessageViewSlot,
  ToolRowSlot,
  TranscriptSlotRow,
} from "./message-list-slots.js";
import { TurnFailedReceiptRows } from "./receipt-rows.js";
import { HostSlotBoundary, SlotOrDefault } from "./slot-boundary.js";
import { SubagentDeliveryDivider } from "./subagent-delivery-divider.js";
import { SubagentGroupRow } from "./subagent-group-row.js";
import { SurfaceBoundary } from "./surface-boundary.js";
import { ToolCallRows } from "./tool-call-rows.js";
import type { DisplayRow } from "./use-transcript-folds.js";
import { UserMessage } from "./user-message.js";

/** THE one slot-fill shape, enforced by construction: every
 *  messageView-eligible arm renders through this helper, whose `children`
 *  IS the package default — one node, used verbatim as the unfilled
 *  rendering, the null-fallthrough, and the boundary's throw fallback. A duplicated
 *  default cannot be written through this seam; writing around it means
 *  spelling HostSlotBoundary + SlotOrDefault by hand, which the slots
 *  suite's byte-parity case (null-filled ≡ unfilled, every kind) catches once the copies diverge. */
function SwappedContent({
  messageView,
  row,
  children,
}: {
  messageView: MessageViewSlot | undefined;
  row: TranscriptSlotRow;
  children: ReactNode;
}) {
  if (messageView === undefined) {
    return <>{children}</>;
  }
  return (
    <HostSlotBoundary slot="messageView" fallback={children}>
      <SlotOrDefault render={() => messageView(row)} fallback={children} />
    </HostSlotBoundary>
  );
}

// THE SLOT-FILL SHAPE, per messageView-eligible kind (the committed
// enumeration): every kind is shared-frame-with-swapped-content through
// SwappedContent above.
//   user              — frame: the py-2 wrapper + pending-echo a11y;
//                       swapped content: the UserMessage bubble.
//   assistant-text    — frame: the group wrapper + identity stamp +
//                       provenance footer + copy affordance (canonical
//                       order prose → footer → copy on BOTH paths);
//                       swapped content: the paced markdown.
//   subagent-group    — no frame element; swapped content: the whole
//                       package group row.
//   subagent-delivery — no frame element; swapped content: the whole
//                       package divider.
export function Row({
  row,
  cards,
  turnLive,
  inCurrentTurn,
  identityToken,
  decisionSurfacesInShelf,
  messageView,
  toolRow,
}: {
  row: DisplayRow;
  cards: readonly ApprovalCardModel[];
  turnLive: boolean;
  inCurrentTurn: boolean;
  identityToken: string;
  decisionSurfacesInShelf: boolean;
  messageView?: MessageViewSlot;
  toolRow?: ToolRowSlot;
}) {
  switch (row.kind) {
    case "run-fold":
      // Not offered to messageView: the fold geometry is package-owned
      // structure (non-negotiable). The tool rows inside keep their
      // own toolRow seam.
      return (
        <ActivityRail
          fold={row}
          cards={cards}
          turnLive={turnLive}
          inCurrentTurn={inCurrentTurn}
          identityToken={identityToken}
          decisionSurfacesInShelf={decisionSurfacesInShelf}
          toolRow={toolRow}
        />
      );
    case "user":
      return (
        // The wrapper is the frame's: its spacing and the pending-echo
        // a11y facts are not a slot's to remove.
        <div
          className="tf:py-2"
          {...(row.optimistic === true
            ? {
                "data-tf-pending-echo": "",
                role: "status",
                "aria-label": "Message sent, waiting for transcript",
              }
            : {})}
        >
          <SwappedContent messageView={messageView} row={row}>
            <UserMessage
              attachments={row.attachments}
              createdAt={row.createdAt}
            >
              {row.text}
            </UserMessage>
          </SwappedContent>
        </div>
      );
    case "assistant-text":
      return (
        <AssistantProseRow
          row={row}
          identityToken={identityToken}
          messageView={messageView}
        />
      );
    // No "reasoning" case: DisplayRow excludes it — every reasoning row
    // is folded into a run fold by runFoldsOf.
    case "tool-call":
      // Defensive support for a directly supplied tool row; the fold
      // pass groups all tool calls, including answered asks.
      return (
        // Per-row boundary: one poisoned tool row degrades one row; the
        // list-level boundary stays the backstop. The projection
        // (_toolViewOf) runs INSIDE ToolCallRows, which this boundary
        // wraps whole.
        <SurfaceBoundary surface="tool-row">
          <ToolCallRows
            row={row}
            cards={cards}
            decisionSurfacesInShelf={decisionSurfacesInShelf}
            toolRow={toolRow}
          />
        </SurfaceBoundary>
      );
    case "subagent-group":
      return (
        <SwappedContent messageView={messageView} row={row}>
          <SubagentGroupRow row={row} />
        </SwappedContent>
      );
    case "subagent-delivery":
      return (
        <SwappedContent messageView={messageView} row={row}>
          <SubagentDeliveryDivider results={row.results} />
        </SwappedContent>
      );
    case "turn-failed-receipts":
      // The turn-level terminal state, the ONE standalone receipt row left
      // after the meta-receipt deletion: a turn that dies mid-way must
      // still explain itself. Distinct from any single operation's in-row
      // failure pill.
      return <TurnFailedReceiptRows receipts={row.receipts} />;
  }
}

// The slot swaps only the PROSE; everything else is the frame's, in the one
// canonical order — prose, provenance, copy.
function AssistantProseRow({
  row,
  identityToken,
  messageView,
}: {
  row: AssistantTextRow;
  identityToken: string;
  messageView?: MessageViewSlot;
}) {
  return (
    // Keep the surface identity token for provenance/reconciliation,
    // but do not stamp a logo above ordinary prose. Identity belongs
    // to agent chrome (subagent rows, roster, drill-in), not every
    // authored paragraph.
    <div
      className="tf:group/assistant-message tf:py-2"
      data-tf-agent-identity={identityToken}
    >
      <SwappedContent messageView={messageView} row={row}>
        <PacedAssistantMarkdown text={row.text} streaming={row.streaming} />
      </SwappedContent>
      {/* Message provenance renders on the message it explains —
              inside this row's own block, never a detached row,
              directly under the prose whether or not a host
              filled it — never a slot's to suppress or reorder. Absent
              unless the run's writes attributed here. */}
      {row.memoryUpdates !== undefined ? (
        <MemoryUpdatedFooter updates={row.memoryUpdates} />
      ) : null}
      {/* The hover/focus copy affordance: the raw markdown source,
              verbatim. Only once the row settles — the paced reveal shows a
              prefix while streaming, and offering to copy text the reader
              cannot yet see would be dishonest. Reserved height so the reveal
              never moves the prose; always visible on coarse pointers.
              Frame-owned like the footer: it copies the durable row text
              whatever a fill drew. */}
      {!row.streaming ? (
        <div className="tf:flex tf:h-7 tf:items-center">
          <CopyTextButton
            text={row.text}
            label="Copy message"
            className="tf:opacity-0 tf:transition-opacity tf:group-hover/assistant-message:opacity-100 tf:group-focus-within/assistant-message:opacity-100 tf:focus-visible:opacity-100 tf:pointer-coarse:opacity-100"
          />
        </div>
      ) : null}
    </div>
  );
}
