"use client";

import {
  Fragment,
  useContext,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import type { QuestionSetCardModel } from "../core/elicitation-cards.js";
import { ElicitationsContext } from "./elicitation-context.js";
import { TfButton } from "./primitives/button.js";
import { Spinner } from "./streaming-states.js";

/** The footer's three states: sending, the discard confirm, or the
 *  actions (the gate's reason, Cancel, and the one continue). */
export function QuestionPanelFooter({
  card,
  cursor,
  gateReason,
  disabled,
  submitGated,
  onProceed,
}: {
  card: QuestionSetCardModel;
  cursor: number;
  gateReason: string | null;
  disabled: boolean;
  submitGated: boolean;
  onProceed: () => void;
}) {
  const total = card.questions.length;
  const isLast = cursor === total - 1;
  const {
    confirming,
    cancelRef,
    keepEditingRef,
    requestCancel,
    keepEditing,
    discard,
  } = useCancelConfirm(card);
  return (
    <div
      data-tf-question-footer=""
      className="tf:mt-3 tf:flex tf:flex-wrap tf:items-center tf:justify-end tf:gap-2"
    >
      {card.status === "submitting" ? (
        <p className="tf:flex tf:items-center tf:gap-2 tf:text-tf-label tf:text-tf-muted-foreground">
          <Spinner label="Sending…" />
        </p>
      ) : confirming ? (
        <Fragment key="confirm">
          <span className="tf:text-tf-label tf:text-tf-muted-foreground">
            Discard answers?
          </span>
          <TfButton ref={keepEditingRef} variant="ghost" onClick={keepEditing}>
            Keep editing
          </TfButton>
          <TfButton variant="outline" onClick={discard}>
            Discard
          </TfButton>
        </Fragment>
      ) : (
        <Fragment key="actions">
          {gateReason !== null ? (
            <span
              data-tf-question-gate=""
              className="tf:me-auto tf:text-tf-label tf:text-tf-muted-foreground"
            >
              {gateReason}
            </span>
          ) : null}
          <TfButton
            ref={cancelRef}
            variant="ghost"
            disabled={disabled}
            onClick={requestCancel}
          >
            Cancel
          </TfButton>
          <TfButton
            variant="primary"
            disabled={disabled || submitGated}
            onClick={onProceed}
          >
            {isLast
              ? total === 1
                ? "Submit answer"
                : "Submit answers"
              : "Next question"}
          </TfButton>
        </Fragment>
      )}
    </div>
  );
}

// The Cancel confirm: entering and leaving it hands focus to the control
// that replaced the one under the pointer.
function useCancelConfirm(card: QuestionSetCardModel): {
  confirming: boolean;
  cancelRef: RefObject<HTMLButtonElement | null>;
  keepEditingRef: RefObject<HTMLButtonElement | null>;
  /** Cancel: straight to dismissal when nothing is drafted, else the
   *  confirm. */
  requestCancel: () => void;
  keepEditing: () => void;
  discard: () => void;
} {
  const { drafts, cancelQuestionSet } = useContext(ElicitationsContext);
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const wasConfirmingRef = useRef(false);

  // The Cancel confirm swaps the footer's controls out from under the
  // pointer and the keyboard alike; hand focus to the control that took
  // the place (Keep editing on the way in, Cancel on the way back) so a
  // keyboard member never lands on <body>.
  useEffect(() => {
    if (confirming) {
      keepEditingRef.current?.focus();
    } else if (wasConfirmingRef.current) {
      cancelRef.current?.focus();
    }
    wasConfirmingRef.current = confirming;
  }, [confirming]);

  return {
    confirming,
    cancelRef,
    keepEditingRef,
    requestCancel: () => {
      if (drafts.hasContent(card.interruptId)) {
        setConfirming(true);
        return;
      }
      void cancelQuestionSet(card);
    },
    keepEditing: () => {
      setConfirming(false);
    },
    discard: () => {
      setConfirming(false);
      void cancelQuestionSet(card);
    },
  };
}
