// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { questionsToolView } from "../src/components/tool-views/questions-view";
import type { ToolViewCall, ToolViewProps } from "../src/core/tool-view";

const answer = "First line\n<script>keep this as text</script>\nLast line";
function props(overrides: Partial<ToolViewCall> = {}): ToolViewProps {
  return {
    call: {
      toolName: "ask_user",
      toolCallId: "q1",
      status: "output-available",
      awaitingDecision: false,
      args: {
        questions: [
          { id: "scope", heading: "Scope", prompt: "What should we include?" },
        ],
      },
      resultText: JSON.stringify({ answers: [{ id: "scope", text: answer }] }),
      ...overrides,
    },
    context: { themeMode: "light" },
  };
}

describe("questions tool view", () => {
  it("updates from pending questions to verbatim answers and cleans up on unmount", () => {
    const container = document.createElement("div");
    const instance = questionsToolView.mount(
      container,
      props({ status: "input-available", awaitingDecision: true }),
    );
    expect(container.textContent).toBe("");
    expect(
      container.querySelector("[data-tf-elicitation-receipt-answer]"),
    ).toBeNull();
    instance.update(props());
    expect(
      container.querySelector("[data-tf-elicitation-receipt-answer]")
        ?.textContent,
    ).toBe(`Answered: ${answer}`);
    expect(container.querySelector("script")).toBeNull();
    instance.destroy();
    expect(container.childElementCount).toBe(0);
  });

  it.each<Partial<ToolViewCall>>([
    { status: "input-streaming", resultText: undefined },
    { status: "input-available", resultText: undefined },
    { status: "input-available", awaitingDecision: true },
    { status: "output-error" },
    { status: "cancelled" },
    { status: "denied" },
    { status: "refused" },
    { status: "superseded" },
    { offloaded: true },
    { truncated: true },
    { resultText: '{"cancelled":true}' },
    { resultText: '{"answers":[{"id":"scope"}]}' },
  ])(
    "does not present answers for an incomplete or unsuccessful record: %j",
    (overrides) => {
      const container = document.createElement("div");
      questionsToolView.mount(container, props(overrides));
      expect(container.querySelector("[data-tf-questions-receipt]")).toBeNull();
      expect(container.textContent).not.toContain(answer);
      expect(container.textContent).not.toContain("What should we include?");
      expect(container.querySelector("[data-tf-tool-view-card]")).toBeNull();
    },
  );
});
