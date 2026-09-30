"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from "react";

import type { QuestionSetCardModel } from "../core/elicitation-cards.js";
import type { QuestionModel } from "../core/elicitation-pickers.js";
import {
  answersOf,
  firstUnansweredIndexOf,
  MAX_ANSWER_TEXT_CHARS,
  overLimitOf,
  type QuestionAnswerDraft,
  type QuestionDraftStore,
} from "../core/question-drafts.js";
import type { ElicitationSurface } from "./elicitation-context.js";

// Keyboard (the a11y bar of the decision-surface coverage record):
// the suggestions are a radiogroup with APG roving focus — arrows move
// focus and selection, Space selects, Enter selects and continues; the
// custom textarea takes Enter as a newline (never a send) and ⌘/Ctrl+Enter
// to continue, ↑ at its start returns to the last suggestion, and its
// row wears the focus ring while the caret is inside (focus is always
// visible, even before the row is the active choice). The panel never
// steals focus on arrival (the suspension surface's premise); after the
// member pages, focus follows to the shown question's row.

const CUSTOM_TEXTAREA_MAX_HEIGHT_PX = 192;

type ActiveChoice = QuestionAnswerDraft["active"];

interface QuestionPanelKeysInput {
  card: QuestionSetCardModel;
  drafts: QuestionDraftStore;
  submitQuestionAnswers: ElicitationSurface["submitQuestionAnswers"];
  cursor: number;
  question: QuestionModel;
  active: ActiveChoice;
  customText: string;
  answerable: boolean;
  /** Paging closes any open suggestion description. */
  closeDescription: () => void;
}

/** The draft writes the rows make: an option chosen, the custom row
 *  re-activated, the custom text typed. */
interface ActiveChoiceWriters {
  selectOption: (text: string) => void;
  activateCustomIfDrafted: () => void;
  setCustomText: (text: string) => void;
}

interface QuestionPanelKeys extends ActiveChoiceWriters {
  rowsRef: RefObject<HTMLDivElement | null>;
  customRef: RefObject<HTMLTextAreaElement | null>;
  goTo: (next: number) => void;
  proceed: () => void;
  optionKeys: (index: number) => (event: KeyboardEvent<HTMLElement>) => void;
  customKeys: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}

export function useQuestionPanelKeys(
  input: QuestionPanelKeysInput,
): QuestionPanelKeys {
  const { card, drafts, cursor, active, customText, closeDescription } = input;
  const rowsRef = useRef<HTMLDivElement>(null);
  const customRef = useRef<HTMLTextAreaElement>(null);
  // Focus follows a member's own paging, never an arrival: the flag is
  // set by the Prev/Next handlers alone and consumed once.
  const focusAfterPageRef = useRef(false);

  useEffect(() => {
    if (!focusAfterPageRef.current) {
      return;
    }
    focusAfterPageRef.current = false;
    if (active?.kind === "custom") {
      customRef.current?.focus();
      return;
    }
    const rows = rowsRef.current?.querySelectorAll<HTMLElement>("[role=radio]");
    if (rows === undefined || rows.length === 0) {
      customRef.current?.focus();
      return;
    }
    const checked = [...rows].find(
      (row) => row.getAttribute("aria-checked") === "true",
    );
    (checked ?? rows[0]).focus();
  }, [cursor, active]);

  // Autosize the custom row: one line at rest, growing with a pasted
  // paragraph to a cap, then scrolling inside (the composer's own
  // pattern). Layout-effect timing keeps it in step with the keystroke.
  useLayoutEffect(() => {
    const textarea = customRef.current;
    if (textarea === null) {
      return;
    }
    textarea.style.height = "auto";
    if (textarea.scrollHeight === 0) {
      return;
    }
    textarea.style.height = `${String(
      Math.min(textarea.scrollHeight, CUSTOM_TEXTAREA_MAX_HEIGHT_PX),
    )}px`;
  }, [customText, cursor]);

  const goTo = (next: number) => {
    if (next < 0 || next >= card.questions.length) {
      return;
    }
    focusAfterPageRef.current = true;
    closeDescription();
    drafts.setCursor(card.interruptId, next);
  };

  const writers = activeChoiceWritersOf(input);

  const focusRow = (index: number) => {
    const rows = rowsRef.current?.querySelectorAll<HTMLElement>("[role=radio]");
    if (rows === undefined) {
      return;
    }
    if (index >= rows.length) {
      writers.activateCustomIfDrafted();
      customRef.current?.focus();
      return;
    }
    rows[Math.max(index, 0)].focus();
  };

  const proceed = () => {
    proceedFrom(input, goTo);
  };

  const gestures: RowGestures = {
    question: input.question,
    selectOption: writers.selectOption,
    focusRow,
    proceed,
  };

  return {
    rowsRef,
    customRef,
    goTo,
    proceed,
    ...writers,
    optionKeys: (index) => (event) => {
      optionRowKey(gestures, index, event);
    },
    customKeys: (event) => {
      customRowKey(gestures, event);
    },
  };
}

// "Continue" — the footer primary and the Enter/⌘Enter gesture share
// one meaning: advance locally; from the last question, submit the
// complete set — or, when a question is still open, go to it.
function proceedFrom(
  input: QuestionPanelKeysInput,
  goTo: (next: number) => void,
): void {
  const { card, drafts, cursor, answerable, submitQuestionAnswers } = input;
  if (cursor !== card.questions.length - 1) {
    goTo(cursor + 1);
    return;
  }
  const current = drafts.get(card.interruptId);
  const over = overLimitOf(card.questions, current, MAX_ANSWER_TEXT_CHARS);
  if (over.length > 0) {
    // Never a silent no-op: go to the over-bound question so the member
    // can shorten it.
    const at = card.questions.findIndex((entry) => entry.id === over[0]);
    if (at >= 0 && at !== cursor) {
      goTo(at);
    }
    return;
  }
  const complete = answersOf(card.questions, current);
  if (complete === null) {
    const open = firstUnansweredIndexOf(card.questions, current);
    if (open >= 0 && open !== cursor) {
      goTo(open);
    }
    return;
  }
  if (!answerable) {
    return;
  }
  void submitQuestionAnswers(card, complete);
}

// THE ACTIVE CHOICE, EVERY WAY IT CAN CHANGE — pointer and keyboard
// agree at every row:
//   pointer down on an option row / Space / Enter on it → that option;
//     the custom text is kept.
//   ↑ / ↓ between option rows → the row arrived at; text kept.
//   ↓ from the last option onto the custom row, or pointer down on the
//     custom row or its textarea → custom ONLY IF it already holds a
//     usable (non-blank) answer; an EMPTY custom row is not an answer,
//     so reaching it never un-answers the question — focus moves, the
//     option stays chosen. (The defect this closes: a click on the empty
//     row flipped the question to unanswered while ↓ did not.)
//   ↑ from the custom row's start → the last option, chosen (an arrow
//     always chooses the row it lands on); text kept.
//   Tab / focus arriving from the pager or a remount → focus only,
//     never a choice: navigation is not intent.
//   typing or pasting in the custom row → custom (the one implicit
//     switch, and it is the member's own content).
//   Nothing in this table ever discards custom text or a chosen option:
//   both live in the draft until the member changes them.
function activeChoiceWritersOf(
  input: QuestionPanelKeysInput,
): ActiveChoiceWriters {
  const { card, drafts, question, customText, answerable } = input;
  const customIsDrafted = customText.trim() !== "";
  return {
    selectOption: (text) => {
      if (!answerable) {
        return;
      }
      drafts.selectOption(card.interruptId, question.id, text);
    },
    activateCustomIfDrafted: () => {
      if (answerable && customIsDrafted) {
        drafts.selectCustom(card.interruptId, question.id);
      }
    },
    setCustomText: (text) => {
      drafts.setCustomText(card.interruptId, question.id, text);
    },
  };
}

/** What a row's key handler reaches: the shown question's options, the
 *  choice writer, roving focus, and the continue gesture. */
interface RowGestures {
  question: QuestionModel;
  selectOption: (text: string) => void;
  focusRow: (index: number) => void;
  proceed: () => void;
}

function optionRowKey(
  { question, selectOption, focusRow, proceed }: RowGestures,
  index: number,
  event: KeyboardEvent<HTMLElement>,
): void {
  switch (event.key) {
    case "ArrowDown":
    case "ArrowRight": {
      event.preventDefault();
      const next = index + 1;
      if (next < question.options.length) {
        selectOption(question.options[next].text);
      }
      focusRow(next);
      return;
    }
    case "ArrowUp":
    case "ArrowLeft": {
      event.preventDefault();
      const previous = index - 1;
      if (previous >= 0) {
        selectOption(question.options[previous].text);
        focusRow(previous);
      }
      return;
    }
    case " ":
      event.preventDefault();
      selectOption(question.options[index].text);
      return;
    case "Enter":
      event.preventDefault();
      // The selection lands in the store synchronously; the continue
      // reads the updated draft itself.
      selectOption(question.options[index].text);
      proceed();
      return;
    default:
      return;
  }
}

function customRowKey(
  { question, selectOption, focusRow, proceed }: RowGestures,
  event: KeyboardEvent<HTMLTextAreaElement>,
): void {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    proceed();
    return;
  }
  if (
    event.key === "ArrowUp" &&
    event.currentTarget.selectionStart === 0 &&
    event.currentTarget.selectionEnd === 0 &&
    question.options.length > 0
  ) {
    event.preventDefault();
    // An arrow chooses the row it lands on, as between option rows.
    selectOption(question.options[question.options.length - 1].text);
    focusRow(question.options.length - 1);
  }
  // A plain Enter stays a newline — a pasted explanation is multi-line
  // by nature and must never send by accident.
}
