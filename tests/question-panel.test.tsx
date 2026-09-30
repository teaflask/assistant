// @vitest-environment jsdom
/**
 * The question panel: one pending question SET as one surface — heading,
 * ‹ n/N › pager, the question, full-width numbered answer rows, a
 * directly editable multiline Custom answer row, Cancel and Next/Submit.
 * Under test: navigation is local (nothing posts until the one Submit),
 * the active choice is explicit, drafts live in the store and survive a
 * remount, Enter in the custom row is a newline while ⌘/Ctrl+Enter
 * continues, Submit waits for every answer, Cancel discards (two-step
 * only when a draft exists), and the panel never steals focus. The a11y
 * bar: radiogroup + roving radios, keyboard-reachable descriptions, a
 * 44px floor on every answer row.
 *
 * This is the one edition: the dashboard playground mounts this same
 * component.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ElicitationsContext } from "../src/components/elicitation-context";
import { QuestionPanel } from "../src/components/question-panel";
import type { QuestionSetCardModel } from "../src/core/elicitation-cards";
import {
  MAX_ANSWER_TEXT_CHARS,
  QuestionDraftStore,
} from "../src/core/question-drafts";
import { PASTED_DOCS_PARAGRAPH } from "./fixtures/production-paragraph";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let drafts: QuestionDraftStore;
const submitQuestionAnswers = vi.fn().mockResolvedValue(undefined);
const cancelQuestionSet = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  drafts = new QuestionDraftStore();
  submitQuestionAnswers.mockClear();
  cancelQuestionSet.mockClear();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
});

function cardOf(
  overrides: Partial<QuestionSetCardModel> = {},
): QuestionSetCardModel {
  return {
    interruptId: "v1:tool_call:q1:member-answers",
    runId: "run-1",
    toolCallId: "run-1-q1",
    anchored: true,
    round: 0,
    status: "actionable",
    errorSentence: null,
    answered: null,
    questions: [
      {
        id: "fruit",
        heading: "Favorite fruit",
        prompt: "What's your favorite fruit?",
        options: [
          { text: "Mango", description: "Sweet, tropical" },
          { text: "Apple", description: null },
          { text: "Strawberry", description: null },
        ],
      },
      {
        id: "color",
        heading: "Favorite color",
        prompt: "What's your favorite color?",
        options: [
          { text: "Blue", description: null },
          { text: "Green", description: null },
        ],
      },
      {
        id: "drink",
        heading: "Favorite drink",
        prompt: "What's your favorite drink?",
        options: [],
      },
    ],
    ...overrides,
  };
}

function render(card: QuestionSetCardModel) {
  act(() => {
    root.render(
      <ElicitationsContext.Provider
        value={{
          cards: [card],
          submitQuestionAnswers,
          cancelQuestionSet,
          drafts,
        }}
      >
        <QuestionPanel card={card} />
      </ElicitationsContext.Provider>,
    );
  });
}

function click(element: Element | null) {
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function press(
  element: Element | null,
  key: string,
  init: KeyboardEventInit = {},
) {
  act(() => {
    element?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}

function typeInto(element: HTMLTextAreaElement | null, text: string) {
  act(() => {
    if (element === null) {
      return;
    }
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set?.call(element, text);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const rowNamed = (text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("[role=radio]")].find((row) =>
    row.textContent.includes(text),
  ) ?? null;
// By visible text, or by accessible name for the icon-only chevrons.
const buttonNamed = (name: string) =>
  [...host.querySelectorAll("button")].find(
    (button) =>
      button.textContent.trim() === name ||
      button.getAttribute("aria-label") === name,
  ) ?? null;
const customTextarea = () =>
  host.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Custom answer"]',
  );
const pagerText = () =>
  host.querySelector("[data-tf-question-pager]")?.textContent ?? "";

describe("the panel's anatomy", () => {
  it("renders the heading, the counter, the question, numbered full-width rows and the custom row — never the wire", () => {
    render(cardOf());
    expect(host.querySelector("[data-tf-question-heading]")?.textContent).toBe(
      "Favorite fruit",
    );
    expect(pagerText()).toContain("1/3");
    expect(host.querySelector("[data-tf-question-prompt]")?.textContent).toBe(
      "What's your favorite fruit?",
    );
    const rows = [...host.querySelectorAll("[data-tf-answer-row]")];
    expect(rows.map((row) => row.textContent)).toEqual([
      "1.Mango",
      "2.Apple",
      "3.Strawberry",
    ]);
    for (const row of rows) {
      expect(row.className).toContain("tf:w-full");
      expect(row.className).toContain("tf:min-h-11");
    }
    expect(
      host.querySelector("[data-tf-custom-answer-row]")?.textContent,
    ).toContain("4.");
    expect(customTextarea()).not.toBeNull();
    expect(host.textContent).not.toContain('"id"');
    expect(host.textContent).not.toContain('"options"');
    expect(buttonNamed("Next question")).not.toBeNull();
    expect(buttonNamed("Cancel")).not.toBeNull();
    // The panel keeps the elicitation frame hook (TVC-061's geometry).
    expect(
      host.querySelector("[data-tf-elicitation-card][data-tf-question-panel]"),
    ).not.toBeNull();
  });

  it("a single question shows no pager and one final Submit answer", () => {
    render(cardOf({ questions: [cardOf().questions[2]] }));
    expect(host.querySelector("[data-tf-question-pager]")).toBeNull();
    expect(buttonNamed("Submit answer")).not.toBeNull();
    expect(buttonNamed("Next question")).toBeNull();
  });

  it("never steals focus on arrival", () => {
    render(cardOf());
    expect(document.activeElement).toBe(document.body);
  });
});

describe("the active choice", () => {
  it("selecting a row wears the emphasis wash and the keyboard hints — on that row only", () => {
    render(cardOf());
    click(rowNamed("Mango"));
    const mango = rowNamed("Mango");
    expect(mango?.getAttribute("aria-checked")).toBe("true");
    expect(mango?.className).toContain("tf:aria-checked:bg-tf-emphasis");
    expect(host.querySelectorAll("[data-tf-key-hints]")).toHaveLength(1);
    expect(mango?.querySelector("[data-tf-key-hints]")).not.toBeNull();
    expect(rowNamed("Apple")?.getAttribute("aria-checked")).toBe("false");
  });

  it("typing in the custom row makes it active; picking a row afterwards keeps the text", () => {
    render(cardOf());
    typeInto(customTextarea(), "Durian, honestly");
    expect(
      host
        .querySelector("[data-tf-custom-answer-row]")
        ?.hasAttribute("data-tf-answer-active"),
    ).toBe(true);
    expect(rowNamed("Mango")?.getAttribute("aria-checked")).toBe("false");
    click(rowNamed("Mango"));
    expect(rowNamed("Mango")?.getAttribute("aria-checked")).toBe("true");
    expect(
      host
        .querySelector("[data-tf-custom-answer-row]")
        ?.hasAttribute("data-tf-answer-active"),
    ).toBe(false);
    // The draft is not destroyed by the switch.
    expect(customTextarea()?.value).toBe("Durian, honestly");
  });

  it("a description opens from its (i) button by keyboard and pointer, never hover-only", () => {
    render(cardOf());
    const about = host.querySelector<HTMLButtonElement>(
      "button[aria-label='About \"Mango\"']",
    );
    expect(about?.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector("[data-tf-answer-description]")).toBeNull();
    click(about);
    expect(about?.getAttribute("aria-expanded")).toBe("true");
    expect(
      host.querySelector("[data-tf-answer-description]")?.textContent,
    ).toBe("Sweet, tropical");
    expect(about?.getAttribute("aria-controls")).toBe(
      host.querySelector("[data-tf-answer-description]")?.id,
    );
  });
});

describe("keyboard", () => {
  it("arrows move focus and selection through the radiogroup; the last ↓ lands in the custom row", () => {
    render(cardOf());
    const mango = rowNamed("Mango");
    mango?.focus();
    press(mango, "ArrowDown");
    expect(rowNamed("Apple")?.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(rowNamed("Apple"));
    press(rowNamed("Apple"), "ArrowDown");
    press(rowNamed("Strawberry"), "ArrowDown");
    expect(document.activeElement).toBe(customTextarea());
    // Only the active row is a tab stop.
    expect(rowNamed("Strawberry")?.tabIndex).toBe(0);
    expect(rowNamed("Mango")?.tabIndex).toBe(-1);
  });

  it("Enter on a row selects it and continues to the next question", () => {
    render(cardOf());
    press(rowNamed("Apple"), "Enter");
    expect(pagerText()).toContain("2/3");
    expect(submitQuestionAnswers).not.toHaveBeenCalled();
    click(buttonNamed("Previous question"));
    expect(rowNamed("Apple")?.getAttribute("aria-checked")).toBe("true");
  });

  it("Enter in the custom row is a newline, never a send; ⌘/Ctrl+Enter continues", () => {
    render(cardOf());
    const textarea = customTextarea();
    typeInto(textarea, "line one");
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      textarea?.dispatchEvent(enter);
    });
    expect(enter.defaultPrevented).toBe(false);
    expect(pagerText()).toContain("1/3");
    expect(submitQuestionAnswers).not.toHaveBeenCalled();
    press(textarea, "Enter", { ctrlKey: true });
    expect(pagerText()).toContain("2/3");
    expect(submitQuestionAnswers).not.toHaveBeenCalled();
  });

  it("↑ at the start of an empty custom row returns to the last suggestion", () => {
    render(cardOf());
    const textarea = customTextarea();
    textarea?.focus();
    press(textarea, "ArrowUp");
    expect(document.activeElement).toBe(rowNamed("Strawberry"));
  });
});

describe("navigation, drafts and the one Submit", () => {
  it("navigation is local and preserves every answer; an earlier edit lands in the one associated result", () => {
    render(cardOf());
    click(rowNamed("Mango"));
    click(buttonNamed("Next question"));
    expect(pagerText()).toContain("2/3");
    click(rowNamed("Blue"));
    click(buttonNamed("Previous question"));
    expect(pagerText()).toContain("1/3");
    expect(rowNamed("Mango")?.getAttribute("aria-checked")).toBe("true");
    click(rowNamed("Apple")); // the edit
    click(buttonNamed("Next question"));
    click(buttonNamed("Next question"));
    expect(pagerText()).toContain("3/3");
    // Submit waits for the unanswered question.
    expect(buttonNamed("Submit answers")?.disabled).toBe(true);
    expect(submitQuestionAnswers).not.toHaveBeenCalled();
    typeInto(customTextarea(), PASTED_DOCS_PARAGRAPH);
    expect(buttonNamed("Submit answers")?.disabled).toBe(false);
    click(buttonNamed("Submit answers"));
    expect(submitQuestionAnswers).toHaveBeenCalledTimes(1);
    expect(submitQuestionAnswers).toHaveBeenCalledWith(expect.anything(), [
      { id: "fruit", text: "Apple" },
      { id: "color", text: "Blue" },
      { id: "drink", text: PASTED_DOCS_PARAGRAPH },
    ]);
  });

  it("the draft survives a remount — the store, not the component, owns it", () => {
    render(cardOf());
    click(rowNamed("Mango"));
    click(buttonNamed("Next question"));
    typeInto(customTextarea(), "teal-ish");
    act(() => {
      root.unmount();
    });
    root = createRoot(host);
    render(cardOf());
    expect(pagerText()).toContain("2/3");
    expect(customTextarea()?.value).toBe("teal-ish");
    click(buttonNamed("Previous question"));
    expect(rowNamed("Mango")?.getAttribute("aria-checked")).toBe("true");
  });

  it("an over-bound custom answer is named, never clipped, and blocks Submit", () => {
    render(cardOf({ questions: [cardOf().questions[2]] }));
    typeInto(customTextarea(), "x".repeat(MAX_ANSWER_TEXT_CHARS + 1));
    expect(customTextarea()?.value).toHaveLength(MAX_ANSWER_TEXT_CHARS + 1);
    expect(host.querySelector("[role=status]")?.textContent).toContain("1,900");
    expect(buttonNamed("Submit answer")?.disabled).toBe(true);
  });

  it("submitting disables the controls and says so; a failure sentence is an alert", () => {
    render(cardOf({ status: "submitting" }));
    expect(host.textContent).toContain("Sending…");
    expect(buttonNamed("Submit answers")).toBeNull();
    expect(rowNamed("Mango")?.disabled).toBe(true);
    expect(customTextarea()?.disabled).toBe(true);
    render(cardOf({ errorSentence: "That couldn't be sent." }));
    expect(host.querySelector("[role=alert]")?.textContent).toBe(
      "That couldn't be sent.",
    );
    expect(rowNamed("Mango")?.disabled).toBe(false);
  });
});

describe("Cancel", () => {
  it("dismisses the whole set at once when nothing is drafted", () => {
    render(cardOf());
    click(buttonNamed("Cancel"));
    expect(cancelQuestionSet).toHaveBeenCalledTimes(1);
    expect(submitQuestionAnswers).not.toHaveBeenCalled();
  });

  it("asks before discarding a draft, and Keep editing keeps it", () => {
    render(cardOf());
    click(rowNamed("Mango"));
    click(buttonNamed("Cancel"));
    expect(cancelQuestionSet).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Discard answers?");
    click(buttonNamed("Keep editing"));
    expect(rowNamed("Mango")?.getAttribute("aria-checked")).toBe("true");
    click(buttonNamed("Cancel"));
    click(buttonNamed("Discard"));
    expect(cancelQuestionSet).toHaveBeenCalledTimes(1);
    // No partial answers ride along with a cancellation.
    expect(submitQuestionAnswers).not.toHaveBeenCalled();
  });
});

describe("the whole-set state (design review round 1)", () => {
  it("names the first unanswered question while Submit is gated, and a continue from the last question jumps to it", () => {
    render(cardOf());
    click(rowNamed("Mango"));
    click(buttonNamed("Next question"));
    click(buttonNamed("Next question"));
    expect(pagerText()).toContain("3/3");
    // Question 2 was skipped: the footer says so instead of a mute dim.
    expect(host.querySelector("[data-tf-question-gate]")?.textContent).toBe(
      "Question 2 needs an answer",
    );
    expect(buttonNamed("Submit answers")?.disabled).toBe(true);
    // ⌘/Ctrl+Enter from the open last question goes to the gap, never a
    // silent no-op.
    press(customTextarea(), "Enter", { ctrlKey: true });
    expect(pagerText()).toContain("2/3");
    expect(submitQuestionAnswers).not.toHaveBeenCalled();
  });

  it("names the first over-bound question while Submit is gated — two questions back — and a continue jumps to it", () => {
    render(cardOf());
    typeInto(customTextarea(), "x".repeat(MAX_ANSWER_TEXT_CHARS + 1));
    click(buttonNamed("Next question"));
    click(rowNamed("Blue"));
    click(buttonNamed("Next question"));
    typeInto(customTextarea(), "Tea");
    expect(pagerText()).toContain("3/3");
    // Every question is answered, so the unanswered arm is silent; the
    // over-bound one two pages back must be named instead of a mute dim.
    expect(buttonNamed("Submit answers")?.disabled).toBe(true);
    expect(host.querySelector("[data-tf-question-gate]")?.textContent).toBe(
      "Question 1's custom answer is over 1,900 characters",
    );
    press(customTextarea(), "Enter", { ctrlKey: true });
    expect(pagerText()).toContain("1/3");
    expect(submitQuestionAnswers).not.toHaveBeenCalled();
  });

  it("rows stay one width when any suggestion has a description — the (i) column is reserved", () => {
    render(cardOf());
    // Question 1: only Mango has a description; the other two rows get a
    // reserved spacer so their right edges align with Mango's.
    const rowWraps = [...host.querySelectorAll("[data-tf-answer-row]")].map(
      (row) => row.parentElement,
    );
    expect(
      rowWraps[0]?.querySelector('button[aria-label^="About"]'),
    ).not.toBeNull();
    expect(rowWraps[1]?.children).toHaveLength(2);
    expect(rowWraps[2]?.children).toHaveLength(2);
    // Question 3 has no descriptions at all: nothing is reserved.
    click(buttonNamed("Next question"));
    click(buttonNamed("Next question"));
    expect(host.querySelectorAll("[data-tf-answer-row]")).toHaveLength(0);
    // A lone custom row carries no numeral — there is nothing to number.
    expect(host.querySelector("[data-tf-custom-answer-row] label")).toBeNull();
  });

  it("hands focus to Keep editing when the confirm opens and back to Cancel when it closes", () => {
    render(cardOf());
    click(rowNamed("Mango"));
    click(buttonNamed("Cancel"));
    expect(document.activeElement).toBe(buttonNamed("Keep editing"));
    click(buttonNamed("Keep editing"));
    expect(document.activeElement).toBe(buttonNamed("Cancel"));
  });

  it("the key caps are icons, never glyph text a host font could drop", () => {
    render(cardOf());
    click(rowNamed("Mango"));
    const hints = host.querySelector("[data-tf-key-hints]");
    expect(hints?.querySelectorAll("svg")).toHaveLength(3);
    expect(hints?.textContent).toBe("");
  });
});

describe("the active choice by pointer and by keyboard agree (review round 3)", () => {
  const pointerDown = (element: Element | null) => {
    act(() => {
      element?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
  };

  it("pointer down on an EMPTY custom row never un-answers the question — the option stays chosen", () => {
    render(cardOf());
    click(rowNamed("Mango"));
    pointerDown(customTextarea());
    expect(rowNamed("Mango")?.getAttribute("aria-checked")).toBe("true");
    expect(
      host
        .querySelector("[data-tf-custom-answer-row]")
        ?.hasAttribute("data-tf-answer-active"),
    ).toBe(false);
    // Nor does the same arrival by keyboard.
    click(rowNamed("Strawberry"));
    press(rowNamed("Strawberry"), "ArrowDown");
    expect(document.activeElement).toBe(customTextarea());
    expect(rowNamed("Strawberry")?.getAttribute("aria-checked")).toBe("true");
    // Still answered: the footer names no gap on the last question.
    expect(host.querySelector("[data-tf-question-gate]")).toBeNull();
  });

  it("pointer down or ↓ onto a DRAFTED custom row re-activates it, and the text is intact", () => {
    render(cardOf());
    typeInto(customTextarea(), "Durian, honestly");
    click(rowNamed("Mango"));
    expect(rowNamed("Mango")?.getAttribute("aria-checked")).toBe("true");
    pointerDown(customTextarea());
    expect(
      host
        .querySelector("[data-tf-custom-answer-row]")
        ?.hasAttribute("data-tf-answer-active"),
    ).toBe(true);
    expect(rowNamed("Mango")?.getAttribute("aria-checked")).toBe("false");
    expect(customTextarea()?.value).toBe("Durian, honestly");
    click(rowNamed("Apple"));
    press(rowNamed("Strawberry"), "ArrowDown");
    expect(
      host
        .querySelector("[data-tf-custom-answer-row]")
        ?.hasAttribute("data-tf-answer-active"),
    ).toBe(true);
    expect(customTextarea()?.value).toBe("Durian, honestly");
  });

  it("↑ from the custom row's start chooses the last option, as an arrow does between rows", () => {
    render(cardOf());
    typeInto(customTextarea(), "Durian");
    const textarea = customTextarea();
    textarea?.setSelectionRange(0, 0);
    press(textarea, "ArrowUp");
    expect(document.activeElement).toBe(rowNamed("Strawberry"));
    expect(rowNamed("Strawberry")?.getAttribute("aria-checked")).toBe("true");
    expect(customTextarea()?.value).toBe("Durian");
  });
});

describe("the settled forms (on the panel, never transcript prose)", () => {
  it("an answered set collapses to its Q→A receipt — controls gone", async () => {
    render(
      cardOf({
        status: "answered",
        answered: {
          kind: "answers",
          answers: [
            { id: "fruit", text: "Mango" },
            { id: "color", text: "Blue" },
            { id: "drink", text: "Line one\nline two" },
          ],
        },
      }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector("[data-tf-question-panel]")).toBeNull();
    expect(host.querySelector("[data-tf-questions-receipt]")).not.toBeNull();
    expect(host.textContent).toContain("What's your favorite fruit?");
    expect(host.textContent).toContain("Line one\nline two");
    expect(host.querySelector("button, textarea")).toBeNull();
  });

  it("a set answered elsewhere states the plain fact per question", async () => {
    render(cardOf({ status: "answered", answered: null }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      [...host.querySelectorAll("[data-tf-elicitation-receipt-answer]")].map(
        (element) => element.textContent,
      ),
    ).toEqual([
      "Answered: Answered.",
      "Answered: Answered.",
      "Answered: Answered.",
    ]);
  });

  it("a dismissed set keeps its heading over the dismissed sentence, and a stale set over the stale sentence — controls gone, no motion", () => {
    render(cardOf({ status: "answered", answered: { kind: "cancelled" } }));
    let panel = host.querySelector("[data-tf-question-panel]");
    expect(panel?.getAttribute("data-tf-question-panel-settled")).toBe(
      "cancelled",
    );
    expect(
      panel?.querySelector("[data-tf-question-heading]")?.textContent,
    ).toBe("Favorite fruit");
    expect(panel?.textContent).toContain("questions were dismissed.");
    expect(panel?.querySelector("button, textarea")).toBeNull();
    render(cardOf({ status: "stale" }));
    panel = host.querySelector("[data-tf-question-panel]");
    expect(panel?.getAttribute("data-tf-question-panel-settled")).toBe("stale");
    expect(panel?.textContent).toContain(
      "These questions were already answered or expired.",
    );
    expect(panel?.querySelector("button, textarea")).toBeNull();
    expect(panel?.querySelector("[data-tf-spinner]")).toBeNull();
  });
});

describe("package conventions the panel follows (review round 4)", () => {
  it("aria-controls names the description only while it is rendered — never a dangling id", () => {
    render(cardOf());
    const about = buttonNamed('About "Mango"');
    expect(about?.getAttribute("aria-expanded")).toBe("false");
    expect(about?.hasAttribute("aria-controls")).toBe(false);
    click(about);
    const id = about?.getAttribute("aria-controls");
    expect(id).toBeTruthy();
    expect(host.querySelector(`[id="${String(id)}"]`)?.textContent).toBe(
      "Sweet, tropical",
    );
  });

  it("the ONE status live region is mounted for the panel's whole life, empty until it has a fact to speak", () => {
    render(cardOf());
    const statuses = host.querySelectorAll("[role=status]");
    expect(statuses).toHaveLength(1);
    const status = host.querySelector("[data-tf-question-status]");
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.textContent).toBe("");
    // The visible copies are plain text: the gate names its reason on the
    // last question without a second live region.
    click(buttonNamed("Next question"));
    click(buttonNamed("Next question"));
    expect(host.querySelectorAll("[role=status]")).toHaveLength(1);
    expect(
      host.querySelector("[data-tf-question-gate]")?.getAttribute("role"),
    ).toBeNull();
    expect(host.querySelector("[data-tf-question-status]")?.textContent).toBe(
      "Question 1 needs an answer",
    );
    // The over-limit sentence outranks the gate for the question under the
    // member's hands, and rides the same region.
    click(buttonNamed("Previous question"));
    click(buttonNamed("Previous question"));
    typeInto(customTextarea(), "x".repeat(MAX_ANSWER_TEXT_CHARS + 1));
    expect(host.querySelectorAll("[role=status]")).toHaveLength(1);
    expect(
      host.querySelector("[data-tf-question-over-limit]")?.getAttribute("role"),
    ).toBeNull();
    expect(host.querySelector("[data-tf-question-status]")?.textContent).toBe(
      `Custom answers are limited to 1,900 characters (this one is ${(MAX_ANSWER_TEXT_CHARS + 1).toLocaleString("en-US")}).`,
    );
  });

  it("the radiogroup is named by the question itself, and no pager count is a live region", () => {
    render(cardOf());
    const group = host.querySelector("[role=radiogroup]");
    const promptId = host.querySelector("[data-tf-question-prompt]")?.id;
    expect(promptId).toBeTruthy();
    expect(group?.getAttribute("aria-labelledby")).toBe(promptId);
    expect(host.querySelector("[aria-live]")).toBeNull();
  });

  it("counts read en-US digits and grouping regardless of the host locale", () => {
    render(cardOf());
    typeInto(customTextarea(), "x".repeat(MAX_ANSWER_TEXT_CHARS + 1));
    // Pinned with toLocaleString("en-US") (tool-arguments-summary's
    // rule): a de-DE host would otherwise render "1.900".
    expect(
      host.querySelector("[data-tf-question-over-limit]")?.textContent,
    ).toContain("1,900 characters (this one is 1,901)");
  });

  it("the Sending… spinner rides the muted label wrapper the other cards use", () => {
    render(cardOf({ status: "submitting" }));
    const spinner = host.querySelector("[data-tf-spinner]");
    expect(spinner).not.toBeNull();
    const wrapper = spinner?.closest("p");
    expect(wrapper?.className).toContain("tf:flex tf:items-center tf:gap-2");
    expect(wrapper?.className).toContain(
      "tf:text-tf-label tf:text-tf-muted-foreground",
    );
  });

  it("the answer list's floor follows its content: two rows with suggestions, one row without", () => {
    render(cardOf());
    expect(
      host
        .querySelector("[data-tf-question-answers]")
        ?.hasAttribute("data-tf-has-options"),
    ).toBe(true);
    render(
      cardOf({
        questions: [
          {
            id: "notes",
            heading: "Notes",
            prompt: "Anything else?",
            options: [],
          },
        ],
      }),
    );
    expect(
      host
        .querySelector("[data-tf-question-answers]")
        ?.hasAttribute("data-tf-has-options"),
    ).toBe(false);
  });
});
