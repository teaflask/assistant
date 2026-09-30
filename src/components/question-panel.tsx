"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useContext, useId, useState, useSyncExternalStore } from "react";

import type { QuestionSetCardModel } from "../core/elicitation-cards.js";
import type { QuestionModel } from "../core/elicitation-pickers.js";
import {
  answersOf,
  firstUnansweredIndexOf,
  MAX_ANSWER_TEXT_CHARS,
  overLimitOf,
  type QuestionSetDraft,
} from "../core/question-drafts.js";
import { ElicitationsContext } from "./elicitation-context.js";
import { settledQuestionsReceiptOfCard } from "../core/question-receipt.js";
import { QuestionSetReceiptRow } from "./elicitation-receipt-row.js";
import { TfButton } from "./primitives/button.js";
import {
  QuestionPanelAnswers,
  type QuestionPanelIds,
} from "./question-panel-answers.js";
import { QuestionPanelFooter } from "./question-panel-footer.js";
import { useAnswerListFold } from "./use-answer-list-fold.js";
import { useQuestionPanelKeys } from "./use-question-panel-keys.js";

// The question panel: one pending question SET as one surface in the
// suspension slot. Heading top-left, the pager (‹ n/N ›) top-right, the
// question, then the suggested answers as full-width numbered rows with a
// directly editable "Custom answer" row last, and a footer of Cancel +
// Next question / Submit answers. Navigation is LOCAL — it moves a cursor
// in the store's draft, never a byte over the wire — and the one Submit
// posts the whole set at once. Every draft (choice, custom text, cursor)
// lives in the store's QuestionDraftStore, so the pager's keyed remount, a
// reconnect and a workflow restart all return the member to exactly where
// they were.
//
// The active choice is explicit — a suggestion OR the custom row. Picking
// a suggestion keeps the custom text (the member may return to it);
// typing in the custom row makes it active, and reaching the custom row
// by pointer or arrow re-activates it only once it holds an answer (the
// table beside activateCustomIfDrafted). Nothing is ever judged about
// the text: Submit is gated only on "every question has an answer" and
// the transport bound, and the answer posted is the suggestion's visible
// text or the member's words verbatim. While Submit is gated the footer
// names the first unanswered question, and a continue from the last
// question jumps there instead of doing nothing.

// The settled forms, on the panel itself (the meta-receipt rule: a settled
// decision's surfaces are the card's own footer and the operation row's
// state, never transcript prose). Module-private: an expired set keeps
// its heading with controls gone and one muted sentence; a set the
// member dismissed, the same shape with the dismissed sentence — stated
// once, never a failure. Both render only where the panel mounts inline
// (shelf-less hosts); in the shipping shelf composition a settled set
// leaves the slot (TVC-064).
const STALE_NOTE = "These questions were already answered or expired.";
const CANCELLED_NOTE = "The assistant's questions were dismissed.";

export function QuestionPanel({ card }: { card: QuestionSetCardModel }) {
  if (card.status === "answered" || card.status === "stale") {
    return <SettledQuestionPanel card={card} />;
  }
  return <PendingQuestionPanel card={card} />;
}

/** The settled set where the panel stood: the Q→A receipt (this tab's
 *  own answers, or the plain answered fact per question when another
 *  client answered), or the heading over one muted sentence for a
 *  dismissed or expired set. */
function SettledQuestionPanel({ card }: { card: QuestionSetCardModel }) {
  if (card.status === "answered") {
    const receipt = settledQuestionsReceiptOfCard(
      card.questions,
      card.answered,
    );
    if (receipt !== null) {
      return <QuestionSetReceiptRow receipt={receipt} />;
    }
  }
  return (
    <div
      data-tf-elicitation-card=""
      data-tf-question-panel=""
      data-tf-question-panel-settled={
        card.status === "stale" ? "stale" : "cancelled"
      }
      role="group"
      aria-label="The assistant asked questions"
      className="tf:my-1 tf:rounded-xl tf:border tf:p-4"
    >
      <p
        className="tf:min-w-0 tf:truncate tf:text-tf-label tf:text-tf-muted-foreground"
        data-tf-question-heading=""
      >
        {card.questions[0].heading}
      </p>
      <p className="tf:mt-2 tf:text-tf-label tf:text-tf-muted-foreground">
        {card.status === "stale" ? STALE_NOTE : CANCELLED_NOTE}
      </p>
    </div>
  );
}

function PendingQuestionPanel({ card }: { card: QuestionSetCardModel }) {
  const { drafts, submitQuestionAnswers } = useContext(ElicitationsContext);
  const draft = useSyncExternalStore(
    drafts.subscribe,
    () => drafts.get(card.interruptId),
    () => drafts.get(card.interruptId),
  );
  const total = card.questions.length;
  const cursor = Math.min(Math.max(draft.cursor, 0), total - 1);
  const question = card.questions[cursor];
  const answerDraft = draft.answers.get(question.id);
  const active = answerDraft?.active ?? null;
  const customText = answerDraft?.customText ?? "";
  const answerable = card.status === "actionable";
  const ids: QuestionPanelIds = {
    hint: useId(),
    prompt: useId(),
    descriptionBase: useId(),
    custom: useId(),
  };
  const [openDescription, setOpenDescription] = useState<string | null>(null);
  const {
    rowsRef,
    customRef,
    goTo,
    proceed,
    selectOption,
    activateCustomIfDrafted,
    setCustomText,
    optionKeys,
    customKeys,
  } = useQuestionPanelKeys({
    card,
    drafts,
    submitQuestionAnswers,
    cursor,
    question,
    active,
    customText,
    answerable,
    closeDescription: () => {
      setOpenDescription(null);
    },
  });
  const { answersRef, foldBelow, declareFold } = useAnswerListFold(
    cursor,
    openDescription,
    customText,
  );

  const gate = submitGateOf(card.questions, draft, cursor, customText);
  // The one announced fact: the question under the member's hands first
  // (its own over-limit sentence), else the Submit gate's reason.
  const statusSentence = gate.overLimitSentence ?? gate.gateReason ?? "";

  return (
    <div
      data-tf-elicitation-card=""
      data-tf-question-panel=""
      role="group"
      aria-label="The assistant asked questions"
      className="tf:my-1 tf:rounded-xl tf:border tf:p-4"
    >
      <QuestionPanelHeader card={card} cursor={cursor} goTo={goTo} />
      <QuestionPanelPrompt card={card} question={question} ids={ids} />
      {/* The panel's ONE status live region, mounted for the panel's
          whole life (RunStatusAnnouncer's rule: readers announce
          mutations of an existing region, never a node that arrives
          already carrying its text): it speaks the current over-limit
          sentence or the Submit gate's reason, and empties when neither
          applies. The visible copies below are plain text — one
          announcement per fact. */}
      <span role="status" className="tf:sr-only" data-tf-question-status="">
        {statusSentence}
      </span>
      <QuestionPanelAnswers
        question={question}
        active={active}
        customText={customText}
        disabled={!answerable}
        ids={ids}
        openDescription={openDescription}
        onToggleDescription={setOpenDescription}
        overLimitSentence={gate.overLimitSentence}
        answersRef={answersRef}
        foldBelow={foldBelow}
        onScroll={declareFold}
        rowsRef={rowsRef}
        customRef={customRef}
        selectOption={selectOption}
        activateCustomIfDrafted={activateCustomIfDrafted}
        setCustomText={setCustomText}
        optionKeys={optionKeys}
        customKeys={customKeys}
      />
      <QuestionPanelFooter
        card={card}
        cursor={cursor}
        gateReason={gate.gateReason}
        disabled={!answerable}
        submitGated={gate.submitGated}
        onProceed={proceed}
      />
    </div>
  );
}

/** Heading top-left, the pager (‹ n/N ›) top-right — the pager only
 *  when the set has more than one question. */
function QuestionPanelHeader({
  card,
  cursor,
  goTo,
}: {
  card: QuestionSetCardModel;
  cursor: number;
  goTo: (next: number) => void;
}) {
  const total = card.questions.length;
  return (
    <div className="tf:flex tf:items-center tf:justify-between tf:gap-3">
      <p
        className="tf:min-w-0 tf:truncate tf:text-tf-label tf:text-tf-muted-foreground"
        data-tf-question-heading=""
      >
        {card.questions[cursor].heading}
      </p>
      {total > 1 ? (
        <div
          className="tf:flex tf:shrink-0 tf:items-center tf:gap-1"
          data-tf-question-pager=""
        >
          <TfButton
            variant="icon"
            aria-label="Previous question"
            disabled={cursor === 0}
            onClick={() => {
              goTo(cursor - 1);
            }}
          >
            <ChevronLeftIcon aria-hidden className="tf:size-4" />
          </TfButton>
          <span className="tf:text-tf-label tf:tabular-nums tf:text-tf-muted-foreground">
            {`${String(cursor + 1)}/${String(total)}`}
          </span>
          <TfButton
            variant="icon"
            aria-label="Next question"
            disabled={cursor === total - 1}
            onClick={() => {
              goTo(cursor + 1);
            }}
          >
            <ChevronRightIcon aria-hidden className="tf:size-4" />
          </TfButton>
        </div>
      ) : null}
    </div>
  );
}

/** The question, the parked note and the error alert when the card
 *  carries them, and the screen-reader-only keyboard hint. */
function QuestionPanelPrompt({
  card,
  question,
  ids,
}: {
  card: QuestionSetCardModel;
  question: QuestionModel;
  ids: QuestionPanelIds;
}) {
  return (
    <>
      <p
        id={ids.prompt}
        className="tf:mt-1 tf:text-tf-heading tf:font-medium tf:text-tf-foreground"
        data-tf-question-prompt=""
      >
        {question.prompt}
      </p>
      {card.errorSentence !== null ? (
        <p
          role="alert"
          className="tf:mt-2 tf:text-tf-label tf:text-tf-destructive"
        >
          {card.errorSentence}
        </p>
      ) : null}
      <p id={ids.hint} className="tf:sr-only">
        Use the up and down arrow keys to choose a suggested answer and Enter to
        continue. In the custom answer, Enter adds a line and Command or Control
        with Enter continues.
      </p>
    </>
  );
}

// EVERY gate names its reason: an over-bound custom
// answer — possibly two questions back — outranks an unanswered one,
// because it is the harder gap to find.
function submitGateOf(
  questions: QuestionSetCardModel["questions"],
  draft: QuestionSetDraft,
  cursor: number,
  customText: string,
): {
  submitGated: boolean;
  gateReason: string | null;
  overLimitSentence: string | null;
} {
  const answers = answersOf(questions, draft);
  const firstUnanswered = firstUnansweredIndexOf(questions, draft);
  const overLimit = overLimitOf(questions, draft, MAX_ANSWER_TEXT_CHARS);
  const isLast = cursor === questions.length - 1;
  const currentOverLimit = overLimit.includes(questions[cursor].id);
  const submitGated = isLast && (answers === null || overLimit.length > 0);
  const firstOverLimit =
    overLimit.length > 0
      ? questions.findIndex((entry) => entry.id === overLimit[0])
      : -1;
  // Every count the member reads is pinned to en-US digits and grouping
  // (tool-arguments-summary's rule): the widget embeds in arbitrary
  // host pages, and a host locale must not reshape "1,900".
  const gateReason = !isLast
    ? null
    : firstOverLimit >= 0
      ? `Question ${String(firstOverLimit + 1)}'s custom answer is over ${MAX_ANSWER_TEXT_CHARS.toLocaleString("en-US")} characters`
      : answers === null && firstUnanswered >= 0
        ? `Question ${String(firstUnanswered + 1)} needs an answer`
        : null;
  const overLimitSentence = currentOverLimit
    ? `Custom answers are limited to ${MAX_ANSWER_TEXT_CHARS.toLocaleString("en-US")} characters (this one is ${customText.length.toLocaleString("en-US")}).`
    : null;
  return { submitGated, gateReason, overLimitSentence };
}
