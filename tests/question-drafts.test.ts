/**
 * The question-set draft store: the member's staged answers live
 * outside every component, keyed by interrupt id then question id. Laws
 * under test: the active choice is explicit (an option OR the custom
 * row — selecting an option keeps the custom text, typing makes custom
 * active); the cursor rides the draft so paging survives a remount; two
 * sets never bleed; a set is released only by an explicit clear (the
 * owner's present-and-settled evidence), never by absence; and the
 * derived answer set is complete-or-null with the custom text verbatim
 * (trim decides emptiness, never the payload).
 */
import { describe, expect, it, vi } from "vitest";

import {
  answersOf,
  MAX_ANSWER_TEXT_CHARS,
  overLimitOf,
  QuestionDraftStore,
} from "../src/core/question-drafts";

const SET = "v1:tool_call:q1:member-answers";
const OTHER_SET = "v1:tool_call:q2:member-answers";
const QUESTIONS = [{ id: "fruit" }, { id: "color" }, { id: "drink" }];
const PARAGRAPH =
  "None of these exactly — I want:\n\n1. A quickstart\n2. Reference pages";

describe("the active choice", () => {
  it("starts empty: no choice, no text, cursor at the first question", () => {
    const store = new QuestionDraftStore();
    expect(store.get(SET)).toEqual({ cursor: 0, answers: new Map() });
    expect(store.hasContent(SET)).toBe(false);
    expect(answersOf(QUESTIONS, store.get(SET))).toBeNull();
  });

  it("selecting an option keeps the custom text; typing makes custom active again", () => {
    const store = new QuestionDraftStore();
    store.setCustomText(SET, "fruit", "Durian, honestly");
    expect(store.get(SET).answers.get("fruit")).toEqual({
      active: { kind: "custom" },
      customText: "Durian, honestly",
    });
    store.selectOption(SET, "fruit", "Mango");
    // The draft text survives the switch — nothing is silently destroyed.
    expect(store.get(SET).answers.get("fruit")).toEqual({
      active: { kind: "option", text: "Mango" },
      customText: "Durian, honestly",
    });
    store.setCustomText(SET, "fruit", "Durian, honestly!");
    expect(store.get(SET).answers.get("fruit")?.active).toEqual({
      kind: "custom",
    });
    store.selectOption(SET, "fruit", "Apple");
    store.selectCustom(SET, "fruit");
    expect(store.get(SET).answers.get("fruit")).toEqual({
      active: { kind: "custom" },
      customText: "Durian, honestly!",
    });
  });

  it("never applies a hidden typed-text-wins rule: the answer is the ACTIVE choice", () => {
    const store = new QuestionDraftStore();
    store.setCustomText(SET, "fruit", "Durian");
    store.selectOption(SET, "fruit", "Mango");
    store.selectOption(SET, "color", "Blue");
    store.setCustomText(SET, "drink", PARAGRAPH);
    expect(answersOf(QUESTIONS, store.get(SET))).toEqual([
      { id: "fruit", text: "Mango" },
      { id: "color", text: "Blue" },
      { id: "drink", text: PARAGRAPH },
    ]);
  });
});

describe("the derived answer set", () => {
  it("is null while any question is unanswered, in question order once complete", () => {
    const store = new QuestionDraftStore();
    store.selectOption(SET, "drink", "Tea");
    store.selectOption(SET, "fruit", "Mango");
    expect(answersOf(QUESTIONS, store.get(SET))).toBeNull();
    store.setCustomText(SET, "color", "  teal  ");
    expect(answersOf(QUESTIONS, store.get(SET))).toEqual([
      { id: "fruit", text: "Mango" },
      // Verbatim: the trim decides emptiness only, never the payload.
      { id: "color", text: "  teal  " },
      { id: "drink", text: "Tea" },
    ]);
  });

  it("treats a blank custom answer as unanswered, not as an empty string", () => {
    const store = new QuestionDraftStore();
    store.selectOption(SET, "fruit", "Mango");
    store.selectOption(SET, "color", "Blue");
    store.setCustomText(SET, "drink", "   \n ");
    expect(answersOf(QUESTIONS, store.get(SET))).toBeNull();
    expect(store.hasContent(SET)).toBe(true);
  });

  it("names the questions whose custom text exceeds the transport bound — never clips", () => {
    const store = new QuestionDraftStore();
    store.setCustomText(SET, "drink", "x".repeat(MAX_ANSWER_TEXT_CHARS + 1));
    store.selectOption(SET, "fruit", "y".repeat(MAX_ANSWER_TEXT_CHARS + 1));
    expect(
      overLimitOf(QUESTIONS, store.get(SET), MAX_ANSWER_TEXT_CHARS),
    ).toEqual(["drink"]);
    expect(store.get(SET).answers.get("drink")?.customText).toHaveLength(
      MAX_ANSWER_TEXT_CHARS + 1,
    );
  });
});

describe("cursor, isolation, and lifetime", () => {
  it("keeps the cursor with the draft so paging survives whoever reads it next", () => {
    const store = new QuestionDraftStore();
    store.setCursor(SET, 2);
    store.selectOption(SET, "fruit", "Mango");
    expect(store.get(SET).cursor).toBe(2);
    expect(store.get(SET).answers.get("fruit")?.active).toEqual({
      kind: "option",
      text: "Mango",
    });
  });

  it("isolates sets by interrupt id — one set's answers never bleed into another", () => {
    const store = new QuestionDraftStore();
    store.selectOption(SET, "fruit", "Mango");
    store.setCursor(SET, 1);
    expect(store.get(OTHER_SET)).toEqual({ cursor: 0, answers: new Map() });
    store.setCustomText(OTHER_SET, "fruit", "Kiwi");
    expect(store.get(SET).answers.get("fruit")?.active).toEqual({
      kind: "option",
      text: "Mango",
    });
    store.clear(OTHER_SET);
    expect(store.get(SET).cursor).toBe(1);
  });

  it("releases a set only on an explicit clear; clearAll drops every set", () => {
    const store = new QuestionDraftStore();
    store.selectOption(SET, "fruit", "Mango");
    store.selectOption(OTHER_SET, "fruit", "Apple");
    store.clear(SET);
    expect(store.hasContent(SET)).toBe(false);
    expect(store.hasContent(OTHER_SET)).toBe(true);
    store.clearAll();
    expect(store.hasContent(OTHER_SET)).toBe(false);
  });

  it("notifies subscribers on every change and only on change — the useSyncExternalStore contract", () => {
    const store = new QuestionDraftStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.selectOption(SET, "fruit", "Mango");
    store.selectOption(SET, "fruit", "Mango"); // same choice: no notify
    store.setCursor(SET, 0); // same cursor: no notify
    store.clear(OTHER_SET); // nothing to clear: no notify
    expect(listener).toHaveBeenCalledTimes(1);
    const before = store.get(SET);
    store.setCustomText(SET, "fruit", "D");
    expect(listener).toHaveBeenCalledTimes(2);
    // A fresh snapshot per change, so React compares by reference.
    expect(store.get(SET)).not.toBe(before);
    unsubscribe();
    store.clearAll();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("the control-character rule, mirrored at the draft write (review round 2)", () => {
  it("turns a pasted soft break (VT) or page break (FF) into a newline and drops the rest of C0", () => {
    // Word and Google Docs emit U+000B for Shift+Enter; a textarea passes
    // it through. The break must survive as a break, never as a lost line.
    const store = new QuestionDraftStore();
    store.setCustomText(SET, "fruit", "line one\u000bline two\u000cline three");
    expect(store.get(SET).answers.get("fruit")?.customText).toBe(
      "line one\nline two\nline three",
    );
    store.setCustomText(
      SET,
      "fruit",
      "bell\u0007 back\u0008 esc\u001b nul\u0000",
    );
    expect(store.get(SET).answers.get("fruit")?.customText).toBe(
      "bell back esc nul",
    );
  });

  it("leaves what the door accepts untouched — tab, newline, CR, and every printable character", () => {
    const store = new QuestionDraftStore();
    const kept = "tab\tnewline\nreturn\r日本語 — “quoted” 😀";
    store.setCustomText(SET, "fruit", kept);
    expect(store.get(SET).answers.get("fruit")?.customText).toBe(kept);
    expect(answersOf([{ id: "fruit" }], store.get(SET))).toEqual([
      { id: "fruit", text: kept },
    ]);
  });
});
