"use client";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  CornerDownLeftIcon,
  InfoIcon,
} from "lucide-react";
import type { KeyboardEvent, RefObject } from "react";

import type {
  QuestionModel,
  QuestionOptionModel,
} from "../core/elicitation-pickers.js";
import type { QuestionAnswerDraft } from "../core/question-drafts.js";
import { Kbd } from "./primitives/kbd.js";
import { TfButton } from "./primitives/button.js";
import { TfTextarea } from "./primitives/textarea.js";

const CUSTOM_ANSWER_PLACEHOLDER = "Custom answer";

type KeyHint = "up" | "down" | "enter" | "modifier";

/** The panel's element ids, minted once by the shell: the prompt and
 *  the hint name and describe the rows; the custom row and each
 *  description carry their own. */
export interface QuestionPanelIds {
  hint: string;
  prompt: string;
  descriptionBase: string;
  custom: string;
}

/** The answer list: the suggested answers as a radiogroup of numbered
 *  rows, the custom row last, and the over-limit sentence under them. */
export function QuestionPanelAnswers({
  question,
  active,
  customText,
  disabled,
  ids,
  openDescription,
  onToggleDescription,
  overLimitSentence,
  answersRef,
  foldBelow,
  onScroll,
  rowsRef,
  customRef,
  selectOption,
  activateCustomIfDrafted,
  setCustomText,
  optionKeys,
  customKeys,
}: {
  question: QuestionModel;
  active: QuestionAnswerDraft["active"];
  customText: string;
  disabled: boolean;
  ids: QuestionPanelIds;
  openDescription: string | null;
  onToggleDescription: (open: string | null) => void;
  overLimitSentence: string | null;
  answersRef: RefObject<HTMLDivElement | null>;
  foldBelow: boolean;
  onScroll: () => void;
  rowsRef: RefObject<HTMLDivElement | null>;
  customRef: RefObject<HTMLTextAreaElement | null>;
  selectOption: (text: string) => void;
  activateCustomIfDrafted: () => void;
  setCustomText: (text: string) => void;
  optionKeys: (index: number) => (event: KeyboardEvent<HTMLElement>) => void;
  customKeys: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const tabStopIndex = tabStopIndexOf(question, active);
  const customActive = active?.kind === "custom";
  const reserveInfoColumn = reserveInfoColumnOf(question);
  return (
    <div
      ref={answersRef}
      className="tf:mt-3 tf:flex tf:flex-col tf:gap-1"
      data-tf-question-answers=""
      // The list's floor follows its content (styles.css): two rows
      // with suggestions, one row without.
      data-tf-has-options={question.options.length > 0 ? "" : undefined}
      data-tf-fold-below={foldBelow ? "" : undefined}
      onScroll={onScroll}
    >
      <div
        ref={rowsRef}
        role="radiogroup"
        // Labelled by the question itself: after a page the focus lands
        // on a row, and the group's name is what a reader speaks first
        // — the question, not a generic "Suggested answers".
        aria-labelledby={ids.prompt}
        aria-describedby={ids.hint}
        className="tf:flex tf:flex-col tf:gap-0.5"
      >
        {question.options.map((option, index) => (
          <AnswerOptionRow
            key={option.text}
            option={option}
            index={index}
            checked={active?.kind === "option" && active.text === option.text}
            tabStop={index === tabStopIndex}
            disabled={disabled}
            reserveInfoColumn={reserveInfoColumn}
            descriptionId={`${ids.descriptionBase}-${String(index)}`}
            descriptionOpen={openDescription === option.text}
            onToggleDescription={onToggleDescription}
            onSelect={selectOption}
            onKeyDown={optionKeys(index)}
          />
        ))}
      </div>
      <CustomAnswerRow
        optionCount={question.options.length}
        customText={customText}
        customActive={customActive}
        disabled={disabled}
        ids={ids}
        reserveInfoColumn={reserveInfoColumn}
        customRef={customRef}
        onTextChange={setCustomText}
        onPointerDown={activateCustomIfDrafted}
        onKeyDown={customKeys}
      />
      {overLimitSentence !== null ? (
        <p
          className="tf:px-3 tf:text-tf-label tf:text-tf-destructive"
          data-tf-question-over-limit=""
        >
          {overLimitSentence}
        </p>
      ) : null}
    </div>
  );
}

/** The radiogroup's one tab stop: the chosen option's row, else the
 *  first row. */
function tabStopIndexOf(
  question: QuestionModel,
  active: QuestionAnswerDraft["active"],
): number {
  return active?.kind === "option"
    ? Math.max(
        question.options.findIndex((option) => option.text === active.text),
        0,
      )
    : 0;
}

// Rows stay full width: when any suggestion carries a description the
// (i) column is reserved on every row, so the active row's key caps
// never jump as the member arrows through.
function reserveInfoColumnOf(question: QuestionModel): boolean {
  return question.options.some((option) => option.description !== null);
}

function AnswerOptionRow({
  option,
  index,
  checked,
  tabStop,
  disabled,
  reserveInfoColumn,
  descriptionId,
  descriptionOpen,
  onToggleDescription,
  onSelect,
  onKeyDown,
}: {
  option: QuestionOptionModel;
  index: number;
  checked: boolean;
  tabStop: boolean;
  disabled: boolean;
  reserveInfoColumn: boolean;
  descriptionId: string;
  descriptionOpen: boolean;
  onToggleDescription: (open: string | null) => void;
  onSelect: (text: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  return (
    <div className="tf:flex tf:flex-col">
      <div className="tf:flex tf:items-start tf:gap-1">
        <TfButton
          variant="answerRow"
          role="radio"
          aria-checked={checked}
          data-tf-answer-row=""
          data-tf-answer-index={index}
          tabIndex={tabStop ? 0 : -1}
          disabled={disabled}
          onClick={() => {
            onSelect(option.text);
          }}
          onKeyDown={onKeyDown}
        >
          <span
            aria-hidden
            className="tf:w-5 tf:shrink-0 tf:tabular-nums tf:text-tf-muted-foreground"
          >
            {`${String(index + 1)}.`}
          </span>
          <span className="tf:min-w-0 tf:flex-1">{option.text}</span>
          {checked ? <KeyHints hints={["up", "down", "enter"]} /> : null}
        </TfButton>
        {option.description !== null ? (
          <TfButton
            variant="icon"
            className="tf:mt-2"
            aria-label={`About "${option.text}"`}
            aria-expanded={descriptionOpen}
            // Points at the description only while it is in
            // the DOM (memory-updated-footer's and the count
            // pill's idiom): a dangling id reference is an
            // ARIA error, not a hint.
            aria-controls={descriptionOpen ? descriptionId : undefined}
            onClick={() => {
              onToggleDescription(descriptionOpen ? null : option.text);
            }}
          >
            <InfoIcon aria-hidden className="tf:size-4" />
          </TfButton>
        ) : reserveInfoColumn ? (
          <span aria-hidden className="tf:mt-2 tf:size-7 tf:shrink-0" />
        ) : null}
      </div>
      {option.description !== null && descriptionOpen ? (
        <p
          id={descriptionId}
          data-tf-answer-description=""
          className="tf:ps-11 tf:pe-3 tf:pb-2 tf:text-tf-label tf:text-tf-muted-foreground"
        >
          {option.description}
        </p>
      ) : null}
    </div>
  );
}

function CustomAnswerRow({
  optionCount,
  customText,
  customActive,
  disabled,
  ids,
  reserveInfoColumn,
  customRef,
  onTextChange,
  onPointerDown,
  onKeyDown,
}: {
  optionCount: number;
  customText: string;
  customActive: boolean;
  disabled: boolean;
  ids: QuestionPanelIds;
  reserveInfoColumn: boolean;
  customRef: RefObject<HTMLTextAreaElement | null>;
  onTextChange: (text: string) => void;
  onPointerDown: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <div
      data-tf-custom-answer-row=""
      data-tf-answer-active={customActive ? "" : undefined}
      className={
        "tf:flex tf:min-h-11 tf:items-start tf:gap-3 tf:rounded-tf tf:px-3 tf:py-1 " +
        "tf:focus-within:outline-2 tf:focus-within:-outline-offset-2 tf:focus-within:outline-tf-ring " +
        (customActive ? "tf:bg-tf-emphasis" : "")
      }
    >
      {optionCount > 0 ? (
        <label
          htmlFor={ids.custom}
          aria-hidden
          className="tf:w-5 tf:shrink-0 tf:cursor-text tf:pt-1.5 tf:text-tf-label tf:tabular-nums tf:text-tf-muted-foreground"
        >
          {`${String(optionCount + 1)}.`}
        </label>
      ) : null}
      <TfTextarea
        id={ids.custom}
        ref={customRef}
        variant="bare"
        rows={1}
        className="tf:min-w-0 tf:flex-1 tf:px-0 tf:py-1.5 tf:text-tf-label"
        aria-label={CUSTOM_ANSWER_PLACEHOLDER}
        aria-describedby={ids.hint}
        placeholder={CUSTOM_ANSWER_PLACEHOLDER}
        value={customText}
        disabled={disabled}
        onChange={(event) => {
          onTextChange(event.target.value);
        }}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
      {customActive ? (
        <KeyHints className="tf:pt-1.5" hints={["up", "down", "modifier"]} />
      ) : null}
      {reserveInfoColumn ? (
        <span aria-hidden className="tf:mt-1 tf:size-7 tf:shrink-0" />
      ) : null}
    </div>
  );
}

// Icons, not glyph text: the widget is embedded in arbitrary hosts, and a
// host font cannot be trusted to carry U+21B5 or the arrows.
function KeyHints({
  hints,
  className,
}: {
  hints: readonly KeyHint[];
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-tf-key-hints=""
      className={
        "tf:flex tf:shrink-0 tf:items-center tf:gap-1 " + (className ?? "")
      }
    >
      {hints.map((hint) => (
        <Kbd key={hint}>
          {hint === "up" ? (
            <ArrowUpIcon className="tf:size-3" />
          ) : hint === "down" ? (
            <ArrowDownIcon className="tf:size-3" />
          ) : hint === "enter" ? (
            <CornerDownLeftIcon className="tf:size-3" />
          ) : (
            <>
              <span>{modifierLabel()}</span>
              <CornerDownLeftIcon className="tf:size-3" />
            </>
          )}
        </Kbd>
      ))}
    </span>
  );
}

// Detected from the platform, never a clock or locale: the custom row's
// continue gesture reads ⌘↵ on Apple hardware and Ctrl↵ everywhere else.
function modifierLabel(): string {
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return /Mac|iPhone|iPad|iPod/.test(agent) ? "⌘" : "Ctrl";
}
