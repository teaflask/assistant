"use client";

import { useContext } from "react";

import type { ApprovalCardModel } from "../core/approval-inbox.js";
import type { ElicitationCardModel } from "../core/elicitation-cards.js";
import {
  approvalAwaitsMember,
  elicitationAwaitsMember,
} from "../core/suspension-queue.js";
import type { ToolCallViewModel } from "../core/tool-call-display.js";
import type { ToolCallRow } from "../core/transcript-rows.js";
import { ApprovalCard } from "./approval-card.js";
import { anchoredCardsFor } from "./approval-context.js";
import {
  anchoredElicitationsFor,
  ElicitationsContext,
} from "./elicitation-context.js";
import { settledQuestionsReceiptOf } from "../core/question-receipt.js";
import type { ToolRowSlot } from "./message-list-slots.js";
import { prettyPrintParameters } from "./pretty-print.js";
import { QuestionPanel } from "./question-panel.js";
import { HostSlotBoundary, SlotOrDefault } from "./slot-boundary.js";
import { SurfaceBoundary } from "./surface-boundary.js";
import { ToolRow } from "./tool-row.js";

// A HITL-gated call pauses the turn right here. In the shipping shelf
// composition the actionable card lives in the suspension slot and this
// row keeps the compact chronology: the "Needs input" pill while the
// decision pends, then only the row's own state — no settled prose line
// renders (no meta-receipt rows; the card's footer is the outcome's other
// surface). Shelf-less hosts mount the cards inline beneath the row
// (anchored via tool_call_id). An answered ask collapses further either
// way: once its result carries a settled answer its tool view becomes the
// Q&A record.
export function ToolCallRows({
  row,
  cards,
  inCurrentTurn = false,
  decisionSurfacesInShelf = false,
  toolRow,
}: {
  row: ToolCallRow;
  cards: readonly ApprovalCardModel[];
  /** The row-level hold window, forwarded to ToolRow. */
  inCurrentTurn?: boolean;
  decisionSurfacesInShelf?: boolean;
  toolRow?: ToolRowSlot;
}) {
  const { cards: elicitationCards } = useContext(ElicitationsContext);
  // Answers stay inspectable in the normal tool view. The durable
  // result also suppresses the temporary inline question panel.
  const settledQuestions = settledQuestionsReceiptOf(
    row.toolName,
    row.argsText,
    row.result,
  );
  // Which decisions belong to THIS row: in the shelf composition the
  // join keys on the RENDERED ROW (tool call id), never the marker-time
  // `anchored` flag — after a page reload during a pause every card is
  // a marker-time orphan (no TOOL_CALL_START replayed) while its call's
  // row is right here, and its settled state must land on it, never
  // silently vanish (approval-inbox.ts's own rule). The shelf-less mode
  // keeps the historical anchored selection, which also decides card
  // MOUNTING there.
  const anchoredApprovals = decisionSurfacesInShelf
    ? cards.filter((card) => card.toolCallId === row.toolCallId)
    : anchoredCardsFor(cards, row.toolCallId);
  const anchoredElicitations = decisionSurfacesInShelf
    ? elicitationCards.filter((card) => card.toolCallId === row.toolCallId)
    : anchoredElicitationsFor(elicitationCards, row.toolCallId);
  // The row itself says it is the one waiting (state on the affected
  // operation); answered and stale cards are receipts and mark nothing.
  // The pill keeps the AWAITING spelling and deliberately does NOT share
  // the hold's predicate: waiting ends with the decision, the hold with the turn.
  const awaitingInput =
    settledQuestions === null &&
    _awaitsMemberDecision(anchoredApprovals, anchoredElicitations);
  const stateWord = _mandatoryStateWordOf(row.state, awaitingInput);
  // The row's hold arm (the durable re-derivation): the row model's
  // decisionBearing — the replayed marker anchor — is the arm that
  // survives the card stores' pruning (the gated call's
  // result, RUN_ERROR, the turn's settle) and a reload; the live
  // anchored cards are the complement for a REST-hydrated pause whose
  // stream never ran and for fixture scenes that pose cards without
  // histories. Never state: both arms are derivations.
  const decisionBearing =
    row.decisionBearing === true ||
    anchoredApprovals.length > 0 ||
    anchoredElicitations.length > 0;
  // NOTE: no settled decision statements render here or anywhere else in
  // the transcript (the meta-receipt rows, the audit-visibility lines among
  // them, are deleted): a consent outcome's surfaces are the decision
  // card's own footer and this row's state pill. Do not restore the prose
  // lines as a bug fix.
  const view = _toolViewOf(row);
  // Stored asks predate the registered question view. Upgrade their
  // presentation without rewriting history or overriding an authored view.
  if (settledQuestions !== null && view.display?.view === undefined) {
    view.display = {
      ...view.display,
      icon: "question",
      view: { key: "teaflask.questions", version: 1 },
    };
  }
  const packageToolRow = (
    <ToolRow
      view={view}
      awaitingInput={awaitingInput}
      decisionBearing={decisionBearing}
      inCurrentTurn={inCurrentTurn}
    />
  );
  return (
    <>
      {toolRow === undefined ? (
        packageToolRow
      ) : (
        <HostSlotBoundary slot="toolRow" fallback={packageToolRow}>
          <SlotOrDefault
            render={() => toolRow({ row, view, awaitingInput })}
            fallback={packageToolRow}
            // Mandatory status (non-negotiable): a filled toolRow
            // cannot mute an error, an interruption, a refusal, a
            // member's denial, or a pending decision — package-rendered
            // beside the fill, a sibling the fill cannot reach. Keyed
            // on the fill having RENDERED, never on the prop being
            // supplied: on both fallback routes — a null return, a
            // throw — the package ToolRow's own state pill carries the
            // status, and this word beside it would make a screen
            // reader hear the state twice.
            filledAnnex={
              stateWord !== null ? (
                <span className="tf:sr-only" data-tf-tool-state={row.state}>
                  {stateWord}
                </span>
              ) : undefined
            }
          />
        </HostSlotBoundary>
      )}
      {decisionSurfacesInShelf || settledQuestions !== null ? null : (
        <>
          {anchoredApprovals.map((card) => (
            // Adjacency PLACES the banner under its call's row on this
            // shelf-less path; the banner reads only the card model.
            // Per-card boundary: a poisoned card degrades one banner.
            <SurfaceBoundary key={card.interruptId} surface="approval-card">
              <ApprovalCard card={card} />
            </SurfaceBoundary>
          ))}
          {anchoredElicitations.map((card) => (
            <SurfaceBoundary key={card.interruptId} surface="question-panel">
              <QuestionPanel card={card} />
            </SurfaceBoundary>
          ))}
        </>
      )}
    </>
  );
}

/** The pending-decision judgement over one row's anchored cards. The
 *  SPELLING of "still waiting on the human" lives in ONE place
 *  (approvalAwaitsMember/elicitationAwaitsMember, core/suspension-queue.ts)
 *  because the row's "Needs input" pill (TVC-036) and the suspension
 *  queue must agree — and the fold's default openness
 *  (_groupAwaitsDecision, activity-rail.tsx) reads the same live
 *  pendency. The ROW's placement hold deliberately keys on ANCHORING,
 *  not awaiting (the decisionBearing derivation above): TVC-014's hold
 *  window is the turn, which outlives the pendency. */
function _awaitsMemberDecision(
  anchoredApprovals: readonly ApprovalCardModel[],
  anchoredElicitations: readonly ElicitationCardModel[],
): boolean {
  return (
    anchoredApprovals.some(approvalAwaitsMember) ||
    anchoredElicitations.some(elicitationAwaitsMember)
  );
}

/** The frame's status word beside a host-filled toolRow — the same
 *  vocabulary the package pills wear (Failed; Not approved; Interrupted
 *  for cancelled and superseded alike; Declined; Needs input, TVC-036).
 *  Null for the quiet states: running and settled-clean carry no
 *  mandatory word. */
function _mandatoryStateWordOf(
  state: ToolCallRow["state"],
  awaitingInput: boolean,
): string | null {
  if (state === "output-error") {
    return "Failed";
  }
  if (state === "denied") {
    return "Not approved";
  }
  if (state === "cancelled" || state === "superseded") {
    return "Interrupted";
  }
  if (state === "refused") {
    return "Declined";
  }
  if (awaitingInput) {
    return "Needs input";
  }
  return null;
}

function _toolViewOf(row: ToolCallRow): ToolCallViewModel {
  // An offloaded call's "result" is the context offloader's model-facing
  // replacement — retrieval guidance addressed to the model, storage
  // reference lines — not the tool's output, so it is suppressed like the
  // cancelled sentinel and the row renders the quiet shortened-result
  // line instead. Errored and cancelled rows keep their existing stories:
  // those states already suppress the output, and their panes win.
  const offloaded =
    row.offloaded &&
    row.errorText === undefined &&
    row.state !== "denied" &&
    row.state !== "cancelled" &&
    row.state !== "refused";
  return {
    toolName: row.toolName,
    state: row.state,
    toolCallId: row.toolCallId,
    input: _prettyArgsOf(row.argsText),
    // The raw argument text rides beside the pretty print: the
    // presenter parses it into the tool-view call's `args`.
    argsText: row.argsText,
    // A failed call shows its Error pane, not a Result pane. A cancelled
    // call shows neither: its "result" is the model-facing cancellation
    // text, and the row's own Interrupted pill carries the story (the
    // meta-receipt rows beside it are deleted). A refused call likewise:
    // the refusal envelope; the reason line carries the story. A denied
    // call likewise: the same cancellation sentinel a cancel carries —
    // the wire's stamp this state outranks — and the pill carries the
    // story.
    output:
      row.errorText !== undefined ||
      row.state === "denied" ||
      row.state === "cancelled" ||
      row.state === "refused" ||
      offloaded
        ? undefined
        : row.result,
    offloaded: offloaded || undefined,
    errorText: row.errorText,
    ...(row.refusalText !== undefined ? { refusalText: row.refusalText } : {}),
    display: row.display,
    // The anchored schema REFERENCES ride through unwrapped: the
    // presenter's identity law needs the same object per source, and the
    // anchors map's first-wins merge already guarantees it.
    ...(row.schemas?.argsSchema !== undefined
      ? { argsSchema: row.schemas.argsSchema }
      : {}),
    ...(row.schemas?.resultSchema !== undefined
      ? { resultSchema: row.schemas.resultSchema }
      : {}),
  };
}

// The streamed arguments are JSON text, possibly mid-stream: parse when
// whole (for the stable two-space print), pass through verbatim while
// the tail is still arriving.
function _prettyArgsOf(argsText: string): string {
  if (argsText === "") {
    return "";
  }
  try {
    return prettyPrintParameters(JSON.parse(argsText));
  } catch {
    return argsText;
  }
}
