"use client";

// The universal process-row grammar: a semantic operation mark
// (operation-icons.tsx — identity stays visible in every state; completion
// is quiet, never a universal tick), the headline in muted ink with a
// shimmer sweep while running, an inline state pill for failure /
// interruption / the door's refusal / a member's denial / awaiting-input,
// a chevron; expanding indents the panes under the label column, no card
// chrome. The row reads the RESOLVED presentation, never the raw display envelope.

import { type ToolCallViewModel } from "../core/tool-call-display.js";
import { toolCallPresentationOf } from "../core/tool-call-presentation.js";
import type { ToolViewResolution } from "../core/tool-view.js";
import { OperationMark, StatePill } from "./operation-icons.js";
import { Disclosure, DisclosureChevron } from "./primitives/disclosure.js";
import { ShimmerText } from "./streaming-states.js";
import { useToolViewRegistry } from "./tool-view-registry-context.js";
import { ToolViewIconSlot, ToolViewSlot } from "./tool-view-slot.js";
import { humanFailureSentenceOf } from "./tool-views/view-dom.js";

// Tool rows share the activity rail geometry (gap-3, ps-7 body). Answered
// asks use the same geometry inside their work fold. Summary child positions
// are contract: mark first, label second (TVC-050/051 measure exactly those
// children); the pill and chevron follow. Row placement: a HOST-authored
// view (rungs 1–2) or a decision holds the row open while its turn is
// current and the call is running or settled clean; released to native at
// the next user turn. A package built-in or the default reading never opens
// a row — the host decided the tool was worth a view, the package did not —
// and a failed, not-run or degraded (truncated, offloaded) row is closed
// whatever it resolved: the pill names the state, the body is for the member
// who asks.
function heldOpenOf(
  view: ToolCallViewModel,
  toolView: ToolViewResolution,
  decision: boolean,
): boolean {
  const hostViewBearing = toolView.views.some(
    (candidate) => candidate.rung <= 2,
  );
  return (
    isCleanState(view.state) &&
    view.offloaded !== true &&
    (hostViewBearing || decision) &&
    toolView.call.truncated !== true
  );
}

function isCleanState(state: ToolCallViewModel["state"]): boolean {
  return (
    state === "input-streaming" ||
    state === "input-available" ||
    state === "output-available"
  );
}

export function ToolRow({
  view,
  awaitingInput = false,
  decisionBearing,
  inCurrentTurn = false,
}: {
  view: ToolCallViewModel;
  /** True when a pending approval or elicitation is anchored to this
   *  call — the card below owns the decision; the row says in text that
   *  it is the one waiting (state on the affected operation, law 4). */
  awaitingInput?: boolean;
  /** True when ANY approval or elicitation — pending or settled — is
   *  anchored to this call: the decision arm of the placement hold, which
   *  TVC-014 latches for the TURN, not the pendency (approving must not
   *  snap the pane shut under the member's pointer). Derived from the
   *  anchored cards, which replay rebuilds, so the latch is replay-identical. */
  decisionBearing?: boolean;
  /** True while this row belongs to the transcript's current turn — no
   *  user or subagent-delivery row follows it (the caller derives it
   *  positionally, never from a clock). The hold window for the
   *  open-on-arrival behaviour below; defaults to false so narrow
   *  callers and receipts stay native-manual. */
  inCurrentTurn?: boolean;
}) {
  // The resolved presentation: the single resolution point — this row
  // reads slots, never the raw display envelope. The tool-view ladder's
  // answer (tool-views.md) arrives as the toolView slot: the rung 1–3
  // candidates plus the assembled call.
  const presentation = toolCallPresentationOf(view, useToolViewRegistry(), {
    awaitingDecision: awaitingInput,
  });
  const toolView = presentation.toolView;
  const heldRowOpen =
    inCurrentTurn &&
    heldOpenOf(view, toolView, decisionBearing ?? awaitingInput);
  return (
    <Disclosure
      variant="bare"
      open={heldRowOpen || undefined}
      // The row's call identity, on the disclosure root: the approval
      // banner's Show-request affordance resolves this hook to scroll
      // the pending call's row into view (approval-card.tsx). Stamped
      // only when the id exists — fixture rows without ids stay bare.
      {...(view.toolCallId !== undefined && view.toolCallId !== ""
        ? { rootDataAttributes: { "data-tf-tool-call-id": view.toolCallId } }
        : {})}
      className="tf:w-full"
      summaryClassName="tf:flex tf:w-fit tf:items-center tf:gap-3 tf:py-1.5 tf:text-tf-label tf:text-tf-muted-foreground tf:hover:text-tf-foreground"
      bodyClassName="tf:flex tf:flex-col tf:gap-2 tf:pt-1 tf:pb-2 tf:ps-7"
      summary={
        <>
          {toolView.icons.length === 0 ? (
            <OperationMark
              icon={presentation.icon}
              status={presentation.status}
            />
          ) : (
            // A registered icon (tool-views.md: one registration, two
            // roles) replaces the mark's glyph and nothing else — the
            // slot keeps the package chrome and this first-child
            // position stays the TVC-050 contract.
            <ToolViewIconSlot
              icons={toolView.icons}
              call={toolView.call}
              icon={presentation.icon}
            />
          )}
          {presentation.status === "input-available" ? (
            <ShimmerText className="tf:leading-none">
              {presentation.headline}
            </ShimmerText>
          ) : (
            <span className="tf:leading-none">{presentation.headline}</span>
          )}
          {presentation.status === "output-error" ? (
            <StatePill destructive>Failed</StatePill>
          ) : presentation.status === "denied" ? (
            // The member's own decision: its own word, plain ink —
            // never "Interrupted" (the wire's cancel stamp, which this
            // state outranks) and never the door's "Declined".
            <StatePill>Not approved</StatePill>
          ) : presentation.status === "cancelled" ||
            presentation.status === "superseded" ? (
            <StatePill>Interrupted</StatePill>
          ) : presentation.status === "refused" ? (
            <StatePill>Declined</StatePill>
          ) : awaitingInput ? (
            <StatePill>Needs input</StatePill>
          ) : null}
          <DisclosureChevron revealOnInteraction />
        </>
      }
    >
      {/* The body is the tool-view slot: a rung 1–3 view, else the rung-4
          bounded argument reading. No raw wire panes anywhere. */}
      <div data-tf-semantic-view="" className="tf:mt-1">
        <ToolViewSlot views={toolView.views} call={toolView.call} />
      </div>
      {view.offloaded === true && (
        // The offloaded settle: the wire holds the offloader's model-facing
        // replacement (withheld by the view model); this quiet line is the story.
        <p className="tf:text-xs tf:text-tf-muted-foreground">
          This result was too long to show in full, so the assistant worked from
          a shortened preview.
        </p>
      )}
      {view.refusalText !== undefined && (
        // The declined reason: the door's own sentence, in the same quiet
        // register as the offloaded line — never destructive ink.
        <p
          data-tf-refusal-reason=""
          className="tf:text-xs tf:text-tf-muted-foreground"
        >
          {view.refusalText}
        </p>
      )}
      {view.errorText !== undefined && (
        // The failure's one sentence: the pill already says "Failed", so
        // the reason reads quietly, with no label and never the wire JSON.
        <p
          data-tf-error-reason=""
          className="tf:text-xs tf:text-tf-muted-foreground"
        >
          {humanFailureSentenceOf(view.errorText)}
        </p>
      )}
    </Disclosure>
  );
}
