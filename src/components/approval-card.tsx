"use client";

import { useContext, useRef, useState } from "react";

import { activityTitleOf } from "../core/activity-title.js";
import type {
  ApprovalAsker,
  ApprovalCardModel,
} from "../core/approval-inbox.js";
import { humanizedToolName } from "../core/tool-call-display.js";
import { ApprovalsContext } from "./approval-context.js";
import { TfButton } from "./primitives/button.js";
import { TfTextarea } from "./primitives/textarea.js";
import { Spinner } from "./streaming-states.js";

export const APPROVED_NOTE = "Approved";
export const TRUSTED_NOTE =
  "Approved — the assistant won't ask about this again in this conversation.";
// The coworker's twin: the grant is its own session's, so the note names
// the actor and the scope the button promised.
const COWORKER_TRUSTED_NOTE =
  "Approved — the coworker won't ask about this again in this task.";
// "Not approved", not "Denied": the row this decision settles into
// wears the same word on its pill and headline, so the banner's footer
// — the decision's only other rendered home — says one word for one
// fact. "Declined" stays the door's (TVC-038).
export const DENIED_NOTE = "Not approved — the assistant has been told.";
// A coworker's card speaks of the coworker: who asked is who
// hears the answer.
const COWORKER_DENIED_NOTE = "Not approved — the coworker has been told.";
const STALE_NOTE = "This request was already answered or expired.";
// The gate's asks are strictly per-call; saying so is what makes the
// third ask read as policy instead of amnesia (and explains why the
// approve-and-stop-asking control is missing).
const GATED_NOTE = "This action asks every time.";

// Module-private: the transcript's settled decision lines that shared
// this spelling went with the meta-receipt rows; the card's own footer
// below is the note's one rendered home.
function approvalSettledNoteOf(
  status: ApprovalCardModel["status"],
  asker: ApprovalAsker,
): string | null {
  switch (status.kind) {
    case "answered":
      return status.approved
        ? status.trusted
          ? asker.kind === "coworker"
            ? COWORKER_TRUSTED_NOTE
            : TRUSTED_NOTE
          : APPROVED_NOTE
        : asker.kind === "coworker"
          ? COWORKER_DENIED_NOTE
          : DENIED_NOTE;
    case "stale":
      return STALE_NOTE;
    case "actionable":
    case "submitting":
      return null;
  }
}

/**
 * One approval entry point: the package's generic banner. It asks one
 * question — the backend-authored consent sentence over a mechanically
 * spelled tool label — and no longer presents the tool call.
 *
 * The consent doctrine: informed consent is carried by the TRANSCRIPT
 * ROW, which a pending decision always opens — the placement guarantee:
 * `heldRowOpen` in tool-row.tsx holds the affected row and its fold open
 * from the durable decision arm that core/tool-decision-anchors.ts folds
 * out of the event history, so the arguments are on screen
 * (replay-identically, reload included) without this banner carrying
 * them.
 *
 * Moving the arguments off this surface weakens no enforcement, because
 * the re-ask rule — "ask again iff the card would render differently" —
 * was doctrine in a comment, never a mechanism: trust is recorded and
 * looked up by EXACT tool name (the serving side's interventions module;
 * the vended SDK's ledger is `hitl:trusted_tools`, a plain list of
 * tool-name strings in agent state), and no argument digest exists
 * anywhere in the codebase (no trust key, storage column or inbox key
 * anywhere derives from a call's arguments). Nothing mechanical ever
 * depended on this surface's fidelity to the arguments.
 *
 * Everything rendered stays a pure function of the card model: stable
 * ordering, no clocks, no locale — two identical requests render
 * byte-identical banners.
 *
 * The durable status (submitting, answered, stale) lives in the inbox so
 * a transcript remount can never resurrect the buttons; the local state
 * is the deny-reveals-textarea step and the synchronous double-click
 * guard — and local state may only ever ADD dead-ness: the buttons'
 * existence stays the inbox's call, the guard merely disables them in
 * the same tick the click lands, before any store round-trip.
 */
export function ApprovalCard({ card }: { card: ApprovalCardModel }) {
  const { submitDecision } = useContext(ApprovalsContext);
  const [denying, setDenying] = useState(false);
  const [feedback, setFeedback] = useState("");
  const submittedForStatusRef = useRef<ApprovalCardModel["status"] | null>(
    null,
  );
  const [submittedForStatus, setSubmittedForStatus] = useState<
    ApprovalCardModel["status"] | null
  >(null);
  const submitted = submittedForStatus === card.status;

  const submitOnce = (decision: Parameters<typeof submitDecision>[1]) => {
    if (
      card.status.kind !== "actionable" ||
      submittedForStatusRef.current === card.status
    ) {
      return;
    }
    submittedForStatusRef.current = card.status;
    setSubmittedForStatus(card.status);
    void submitDecision(card, decision);
  };

  return (
    <div
      data-tf-approval-card=""
      className="tf:my-2 tf:rounded-2xl tf:border tf:border-tf-border tf:bg-tf-card tf:p-4"
      role="group"
      aria-label="Approval request"
    >
      <CardHeader card={card} />
      <p
        data-tf-approval-prompt=""
        className="tf:mt-3 tf:m-0 tf:text-tf-label tf:leading-relaxed tf:text-tf-muted-foreground"
      >
        {card.prompt.trim() === ""
          ? "This tool needs your approval before it can run."
          : card.prompt}
      </p>
      {/* Identity hook, not layout: the package's data-tf-* posture
          names each surface region for tests and host CSS;
          approval-card.test.tsx selects it. */}
      <div data-tf-approval-footer="">
        <CardFooter
          card={card}
          denying={denying}
          submitted={submitted}
          feedback={feedback}
          onFeedbackChange={setFeedback}
          onApprove={() => {
            submitOnce({ approved: true });
          }}
          onApproveAndTrust={() => {
            submitOnce({ approved: true, trust: true });
          }}
          onStartDenying={() => {
            setDenying(true);
          }}
          onStopDenying={() => {
            setDenying(false);
          }}
          onSendDenial={() => {
            const trimmed = feedback.trim();
            submitOnce({
              approved: false,
              ...(trimmed === "" ? {} : { feedback: trimmed }),
            });
          }}
        />
      </div>
    </div>
  );
}

function CardHeader({ card }: { card: ApprovalCardModel }) {
  return (
    <div className="tf:min-w-0">
      <p
        data-tf-approval-title=""
        className="tf:m-0 tf:text-tf-heading tf:font-semibold"
      >
        Approval required
      </p>
      {/* The operation headline: the mechanical spelling is the ONE
          pure reading of the tool this surface owns — the row's
          richer display-authored headline stays on the row. */}
      <p className="tf:mt-0.5 tf:m-0 tf:truncate tf:font-mono tf:text-xs tf:text-tf-muted-foreground">
        {_toolDisplayNameOf(card.toolName)}
      </p>
      {/* WHO is asking, never WHAT: the sentence below stays the one
          description of the request. The label is the coworker's brief
          excerpt, spelled as the group row spells it; a brief of only
          whitespace excerpts to nothing, so the row's own fallback
          noun stands in. */}
      {card.asker.kind === "coworker" ? (
        <p
          data-tf-approval-asker=""
          className="tf:mt-1 tf:m-0 tf:truncate tf:text-xs tf:text-tf-muted-foreground"
        >
          Asked by a coworker — {_coworkerLabelOf(card.asker.label)}
        </p>
      ) : null}
    </div>
  );
}

function CardFooter({
  card,
  denying,
  submitted,
  feedback,
  onFeedbackChange,
  onApprove,
  onApproveAndTrust,
  onStartDenying,
  onStopDenying,
  onSendDenial,
}: {
  card: ApprovalCardModel;
  denying: boolean;
  submitted: boolean;
  feedback: string;
  onFeedbackChange: (feedback: string) => void;
  onApprove: () => void;
  onApproveAndTrust: () => void;
  onStartDenying: () => void;
  onStopDenying: () => void;
  onSendDenial: () => void;
}) {
  switch (card.status.kind) {
    case "submitting":
      return (
        <p className="tf:mt-3 tf:flex tf:items-center tf:gap-2 tf:text-tf-label tf:text-tf-muted-foreground">
          <Spinner label="Sending…" />
        </p>
      );
    case "answered":
    case "stale":
      return (
        <p className="tf:mt-3 tf:text-tf-label tf:text-tf-muted-foreground">
          {approvalSettledNoteOf(card.status, card.asker)}
        </p>
      );
    case "actionable":
      return (
        <div className="tf:mt-3 tf:space-y-3" aria-busy={submitted}>
          {card.status.errorSentence !== null ? (
            <p
              role="alert"
              className="tf:m-0 tf:text-tf-label tf:text-tf-destructive"
            >
              {card.status.errorSentence}
            </p>
          ) : null}
          {denying ? (
            <DenialForm
              asker={card.asker}
              feedback={feedback}
              submitted={submitted}
              onFeedbackChange={onFeedbackChange}
              onSend={onSendDenial}
              onBack={onStopDenying}
            />
          ) : (
            <DecisionButtons
              card={card}
              submitted={submitted}
              onApprove={onApprove}
              onApproveAndTrust={onApproveAndTrust}
              onStartDenying={onStartDenying}
            />
          )}
        </div>
      );
  }
}

function DenialForm({
  asker,
  feedback,
  submitted,
  onFeedbackChange,
  onSend,
  onBack,
}: {
  asker: ApprovalAsker;
  feedback: string;
  submitted: boolean;
  onFeedbackChange: (feedback: string) => void;
  onSend: () => void;
  onBack: () => void;
}) {
  return (
    <>
      <TfTextarea
        rows={2}
        value={feedback}
        placeholder={
          asker.kind === "coworker"
            ? "Tell the coworker why (optional)"
            : "Tell the assistant why (optional)"
        }
        aria-label="Reason for denying"
        onChange={(event) => {
          onFeedbackChange(event.target.value);
        }}
      />
      <div className="tf:flex tf:gap-2">
        <TfButton disabled={submitted} onClick={onSend}>
          Send denial
        </TfButton>
        <TfButton variant="ghost" disabled={submitted} onClick={onBack}>
          Back
        </TfButton>
      </div>
    </>
  );
}

function DecisionButtons({
  card,
  submitted,
  onApprove,
  onApproveAndTrust,
  onStartDenying,
}: {
  card: ApprovalCardModel;
  submitted: boolean;
  onApprove: () => void;
  onApproveAndTrust: () => void;
  onStartDenying: () => void;
}) {
  return (
    <>
      <div className="tf:flex tf:flex-wrap tf:gap-2">
        <TfButton disabled={submitted} onClick={onApprove}>
          Approve
        </TfButton>
        {_cardOffersTrust(card) ? (
          <TfButton
            variant="ghost"
            disabled={submitted}
            onClick={onApproveAndTrust}
          >
            {_trustLabelOf(card.asker)}
          </TfButton>
        ) : null}
        <TfButton variant="ghost" disabled={submitted} onClick={onStartDenying}>
          Deny
        </TfButton>
      </div>
      {card.gated ? (
        <p className="tf:m-0 tf:text-xs tf:text-tf-muted-foreground">
          {GATED_NOTE}
        </p>
      ) : null}
    </>
  );
}

function _cardOffersTrust(card: ApprovalCardModel): boolean {
  // Off the wire for either asker; the locked gate never offers it.
  return !card.gated && card.trustAvailable;
}

// The consent sentence names the grant's scope, which is the asker's
// session: the thread for the assistant, the task for a coworker.
function _trustLabelOf(asker: ApprovalAsker): string {
  return asker.kind === "coworker"
    ? "Approve for this task"
    : "Approve for this conversation";
}

function _coworkerLabelOf(label: string): string {
  const title = activityTitleOf(label);
  return title === "" ? "Delegated task" : title;
}

function _toolDisplayNameOf(toolName: string | null): string {
  if (toolName === null || toolName.trim() === "") {
    return "Tool request";
  }
  const leaf = toolName.includes("__")
    ? (toolName.split("__").at(-1) ?? toolName)
    : toolName;
  const humanized = humanizedToolName(leaf);
  return humanized === ""
    ? toolName
    : humanized[0].toUpperCase() + humanized.slice(1);
}
