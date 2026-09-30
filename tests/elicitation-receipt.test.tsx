// @vitest-environment jsdom
/**
 * The answered ask's transcript collapse: once an ask_user tool result
 * carries the set's settled answers, its registered tool view presents
 * the Q→A record. The fact is recovered from the durable row alone
 * (the ask_user name, the stored question set, the tool's answered
 * return), narrowed with own-key checks: a cancelled return, a failure
 * envelope or the chat fallback keeps the ordinary tool row.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ElicitationsContext } from "../src/components/elicitation-context";
import { settledQuestionsReceiptOf } from "../src/core/question-receipt";
import { MessageList } from "../src/components/message-list";
import type { ElicitationCardModel } from "../src/core/elicitation-cards";
import type { ToolCallRow, TranscriptRow } from "../src/core/transcript-rows";
import { QuestionDraftStore } from "../src/core/question-drafts";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no ResizeObserver, and these tests only read the rendered
// rows — the sticky viewport's measurements are irrelevant here.
class ResizeObserverStub {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
  ResizeObserverStub;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
});

function render(
  rows: readonly TranscriptRow[],
  cards: readonly ElicitationCardModel[],
  source: "rows" | "blocks" = "rows",
  decisionSurfacesInShelf = false,
) {
  act(() => {
    root.render(
      <ElicitationsContext.Provider
        value={{
          cards,
          submitQuestionAnswers: () => Promise.resolve(),
          cancelQuestionSet: () => Promise.resolve(),
          drafts: new QuestionDraftStore(),
        }}
      >
        <MessageList
          {...(source === "rows"
            ? { rows }
            : { blocks: [{ messageId: "message-1", rows: [...rows] }] })}
          cards={[]}
          decisionSurfacesInShelf={decisionSurfacesInShelf}
        />
      </ElicitationsContext.Provider>,
    );
  });
}

describe("the settled question set's row collapses to the Q→A receipt", () => {
  const QUESTIONS_ARGS = JSON.stringify({
    questions: [
      {
        id: "fruit",
        heading: "Favorite fruit",
        prompt: "What's your favorite fruit?",
        options: [{ text: "Mango" }, { text: "Apple" }],
      },
      { id: "notes", heading: "Notes", prompt: "Anything else?" },
    ],
  });
  const PARAGRAPH = "Line one — with an em dash.\nLine two, “quoted”.";
  const questionsRow = (result: string | undefined): ToolCallRow => ({
    kind: "tool-call",
    key: "run-1-q1",
    toolCallId: "run-1-q1",
    toolName: "ask_user",
    state: "output-available",
    argsText: QUESTIONS_ARGS,
    offloaded: false,
    display: {
      progressText: "Asking for your input…",
      completeText: "Asked for your input",
    },
    ...(result === undefined ? {} : { result }),
  });

  it("durable arguments + the tool's settled answers → every question with its answer, line breaks kept inside the tool view", async () => {
    render(
      [
        questionsRow(
          JSON.stringify({
            answers: [
              { id: "fruit", text: "Mango" },
              { id: "notes", text: PARAGRAPH },
            ],
          }),
        ),
      ],
      [],
    );
    await act(async () => {
      await Promise.resolve();
    });
    const receipt = host.querySelector("[data-tf-questions-receipt]");
    expect(receipt).not.toBeNull();
    const questions = [
      ...host.querySelectorAll("[data-tf-elicitation-receipt-question]"),
    ].map((element) => element.textContent);
    expect(questions).toEqual([
      "What's your favorite fruit?",
      "Anything else?",
    ]);
    const answers = [
      ...host.querySelectorAll("[data-tf-elicitation-receipt-answer]"),
    ].map((element) => element.textContent);
    expect(answers[0]).toContain("Mango");
    expect(answers[1]).toContain(PARAGRAPH);
    expect(
      host.querySelector("[data-tf-tool-call-id] > summary")?.textContent,
    ).toContain("Asked for your input");
    const fold = host.querySelector("[data-tf-activity-group] details");
    const disclosure = host.querySelector<HTMLDetailsElement>(
      "[data-tf-tool-call-id]",
    );
    expect(fold?.contains(disclosure)).toBe(true);
    expect(disclosure).not.toBeNull();
    expect(disclosure?.open).toBe(false);
    act(() => {
      host
        .querySelector<HTMLElement>("[data-tf-tool-call-id] > summary")
        ?.click();
    });
    expect(disclosure?.open).toBe(true);
    expect(
      host.querySelector("[data-tf-questions-view] dt")?.textContent,
    ).toContain("Favorite fruit");
  });

  it.each(["rows", "blocks"] as const)(
    "keeps the ask under Worked from needs-input through answer and replay (%s)",
    async (source) => {
      const pending: ToolCallRow = {
        ...questionsRow(undefined),
        state: "input-available",
        decisionBearing: true,
        display: {
          ...questionsRow(undefined).display,
          view: { key: "teaflask.questions", version: 1 },
        },
      };
      const card: ElicitationCardModel = {
        interruptId: "questions",
        runId: "run-1",
        toolCallId: pending.toolCallId,
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
            options: [],
          },
        ],
      };
      render([pending], [card], source, true);
      await act(async () => {
        await Promise.resolve();
      });
      const fold = host.querySelector("[data-tf-activity-group]");
      const tool = host.querySelector("[data-tf-tool-call-id]");
      expect(fold?.contains(tool)).toBe(true);
      expect(tool?.textContent).toContain("Needs input");
      expect(tool?.querySelector("[data-tf-questions-view]")?.textContent).toBe(
        "",
      );
      expect(host.textContent).not.toContain("What's your favorite fruit?");

      const answered = {
        ...pending,
        state: "output-available" as const,
        result: JSON.stringify({ answers: [{ id: "fruit", text: "Mango" }] }),
      };
      render([answered], [], source, true);
      await act(async () => {
        await Promise.resolve();
      });
      expect(host.querySelector("[data-tf-activity-group]")).toBe(fold);
      expect(host.querySelector("[data-tf-tool-call-id]")).toBe(tool);
      expect(tool?.textContent).not.toContain("Needs input");
      expect(
        tool?.querySelector("[data-tf-questions-receipt]")?.textContent,
      ).toContain("Mango");

      // A fresh render with only durable rows keeps the same grouping and receipt.
      render([], [], source, true);
      render([answered], [], source, true);
      await act(async () => {
        await Promise.resolve();
      });
      expect(host.querySelectorAll("[data-tf-activity-group]")).toHaveLength(1);
      expect(
        host.querySelector(
          "[data-tf-activity-group] [data-tf-questions-receipt]",
        )?.textContent,
      ).toContain("Mango");
    },
  );

  it("a durable answer clears a pending form even before its card store settles", async () => {
    const row = questionsRow(
      JSON.stringify({ answers: [{ id: "fruit", text: "Mango" }] }),
    );
    render(
      [row],
      [
        {
          interruptId: "questions",
          runId: "run-1",
          toolCallId: row.toolCallId,
          anchored: true,
          round: 0,
          status: "actionable",
          errorSentence: null,
          answered: null,
          questions: [
            {
              id: "fruit",
              heading: "Fruit",
              prompt: "Which fruit?",
              options: [],
            },
          ],
        },
      ],
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector("[data-tf-questions-view]")).not.toBeNull();
    expect(host.querySelector("[data-tf-question-panel]")).toBeNull();
    expect(host.textContent).not.toContain("Needs input");
  });

  it("a cancelled set keeps its tool row — a dismissal is a decision with no answers, and no transcript prose", () => {
    render([questionsRow(JSON.stringify({ cancelled: true }))], []);
    expect(host.querySelector("[data-tf-questions-receipt]")).toBeNull();
    expect(host.textContent).not.toContain("dismissed");
    expect(host.querySelector("details")).not.toBeNull();
  });

  it("only the tool's settled return qualifies — a failure envelope or the chat fallback keeps the tool row", () => {
    render(
      [
        questionsRow(
          JSON.stringify({ ok: false, error: {}, instruction: "ask in chat" }),
        ),
      ],
      [],
    );
    expect(host.querySelector("[data-tf-questions-receipt]")).toBeNull();
    expect(host.querySelector("details")).not.toBeNull();
    // And the narrowing itself, at the seam:
    expect(
      settledQuestionsReceiptOf(
        "ask_user",
        QUESTIONS_ARGS,
        '{"answers":[{"id":"fruit"}]}',
      ),
    ).toBeNull();
    expect(
      settledQuestionsReceiptOf(
        "customer_tool",
        QUESTIONS_ARGS,
        '{"answers":[]}',
      ),
    ).toBeNull();
    expect(
      settledQuestionsReceiptOf(
        "ask_user",
        QUESTIONS_ARGS,
        '{"cancelled":true}',
      ),
    ).toBeNull();
  });
});
