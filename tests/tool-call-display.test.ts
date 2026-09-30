import { describe, expect, it } from "vitest";

import {
  humanizedToolName,
  toolRowHeadlineOf,
  type ToolCallState,
  type ToolCallViewModel,
} from "../src/core/tool-call-display";

function viewOf(overrides: Partial<ToolCallViewModel>): ToolCallViewModel {
  return {
    toolName: "action__create-support-ticket",
    state: "input-available",
    input: "{}",
    ...overrides,
  };
}

describe("toolRowHeadlineOf — the fallback ladder", () => {
  it("prefers the backend's progress text while the call runs", () => {
    const headline = toolRowHeadlineOf(
      viewOf({
        state: "input-available",
        display: {
          progressText: "Creating a support ticket…",
          completeText: "Created a support ticket",
        },
      }),
    );
    expect(headline).toBe("Creating a support ticket…");
  });

  it("prefers the backend's complete text once the call settles", () => {
    const headline = toolRowHeadlineOf(
      viewOf({
        state: "output-available",
        output: "ok",
        display: {
          progressText: "Creating a support ticket…",
          completeText: "Created a support ticket",
        },
      }),
    );
    expect(headline).toBe("Created a support ticket");
  });

  it("falls back to the humanized tool name in a protocol-state verb frame", () => {
    expect(toolRowHeadlineOf(viewOf({ state: "input-available" }))).toBe(
      "Running action create support ticket…",
    );
    expect(
      toolRowHeadlineOf(viewOf({ state: "output-available", output: "ok" })),
    ).toBe("Ran action create support ticket");
    expect(toolRowHeadlineOf(viewOf({ state: "output-error" }))).toBe(
      "action create support ticket failed",
    );
    expect(toolRowHeadlineOf(viewOf({ state: "cancelled" }))).toBe(
      "Didn't run action create support ticket",
    );
    // A pending call (no result, run not streaming) states only the name —
    // the receipt or card alongside owns the explanation.
    expect(toolRowHeadlineOf(viewOf({ state: "input-streaming" }))).toBe(
      "action create support ticket",
    );
  });

  it("falls back per PHASE: a display with only completeText stays generic while running", () => {
    const headline = toolRowHeadlineOf(
      viewOf({
        state: "input-streaming",
        display: { completeText: "Created a support ticket" },
      }),
    );
    expect(headline).toBe("action create support ticket");
  });

  it("never lets a failed call wear the success sentence", () => {
    const headline = toolRowHeadlineOf(
      viewOf({
        state: "output-error",
        errorText: "The ticket API rejected the request.",
        display: {
          progressText: "Creating a support ticket…",
          completeText: "Created a support ticket",
        },
      }),
    );
    expect(headline).toBe("action create support ticket failed");
  });

  it("never lets a cancelled call wear display copy — its progress sentence predates the cancel", () => {
    const headline = toolRowHeadlineOf(
      viewOf({
        state: "cancelled",
        display: {
          progressText: "Creating a support ticket…",
          completeText: "Created a support ticket",
        },
      }),
    );
    expect(headline).toBe("Didn't run action create support ticket");
  });

  it("frames a refused call as Didn't <name>, and never lets it wear display copy", () => {
    const bare = toolRowHeadlineOf(
      viewOf({ toolName: "wait_for_subagents", state: "refused" }),
    );
    expect(bare).toBe("Didn't wait for subagents");
    // The door answered and declined: the progress sentence predates the
    // decision, and no outcome landed to describe — the reason line, not
    // the headline, carries the door's sentence.
    const annotated = toolRowHeadlineOf(
      viewOf({
        toolName: "query_subagent",
        state: "refused",
        refusalText: "No subagent with that id belongs to this conversation.",
        display: {
          progressText: "Checking on the coworker…",
          completeText: "Checked on the coworker",
          errorText: "Couldn't check on the coworker",
        },
      }),
    );
    expect(annotated).toBe("Didn't query subagent");
  });

  it("prefers authored error copy on a failed call — error copy, never success copy", () => {
    const headline = toolRowHeadlineOf(
      viewOf({
        state: "output-error",
        errorText: "The ticket API rejected the request.",
        display: {
          progressText: "Creating a support ticket…",
          completeText: "Created a support ticket",
          errorText: "Couldn't create the support ticket",
        },
      }),
    );
    expect(headline).toBe("Couldn't create the support ticket");
  });

  it("never lets a cancelled call wear authored error copy either", () => {
    const headline = toolRowHeadlineOf(
      viewOf({
        state: "cancelled",
        display: {
          errorText: "Couldn't create the support ticket",
        },
      }),
    );
    expect(headline).toBe("Didn't run action create support ticket");
  });
});

describe("toolRowHeadlineOf — the not-approved frame", () => {
  it("frames a denied call in the second person and refuses authored copy", () => {
    expect(toolRowHeadlineOf(viewOf({ state: "denied" }))).toBe(
      "You didn't approve action create support ticket",
    );
    // Neither the progress nor the completion sentence may dress a call
    // the member declined: both predate the decision.
    expect(
      toolRowHeadlineOf(
        viewOf({
          state: "denied",
          display: {
            progressText: "Creating a support ticket…",
            completeText: "Created a support ticket",
            errorText: "Couldn't create the ticket",
          },
        }),
      ),
    ).toBe("You didn't approve action create support ticket");
    // Distinct from the cancelled and refused frames on the same tool.
    expect(toolRowHeadlineOf(viewOf({ state: "cancelled" }))).toBe(
      "Didn't run action create support ticket",
    );
    expect(toolRowHeadlineOf(viewOf({ state: "refused" }))).toBe(
      "Didn't action create support ticket",
    );
  });
});

describe("the protocol vocabulary", () => {
  it("humanizes spelling only — separators, never meaning", () => {
    expect(humanizedToolName("create-support-ticket")).toBe(
      "create support ticket",
    );
    expect(humanizedToolName("docs_search")).toBe("docs search");
  });
});

describe("the model's caption — one label, every state", () => {
  const CAPTION = "Checking for an existing install";
  const EVERY_TEXT = {
    progressText: "Creating a support ticket…",
    completeText: "Created a support ticket",
    errorText: "Couldn't create the ticket",
  };
  const CAPTIONED: Record<ToolCallState, string> = {
    "input-streaming": CAPTION,
    "input-available": CAPTION,
    "output-available": CAPTION,
    "output-error": `${CAPTION} · failed`,
    denied: `${CAPTION} · not approved`,
    cancelled: `${CAPTION} · didn't run`,
    refused: `${CAPTION} · declined`,
    superseded: `${CAPTION} · didn't finish`,
  };
  const UNCAPTIONED: Record<ToolCallState, string> = {
    "input-streaming": "Creating a support ticket…",
    "input-available": "Creating a support ticket…",
    "output-available": "Created a support ticket",
    "output-error": "Couldn't create the ticket",
    denied: "You didn't approve action create support ticket",
    cancelled: "Didn't run action create support ticket",
    refused: "Didn't action create support ticket",
    superseded: "Didn't finish action create support ticket",
  };
  const STATES = Object.keys(CAPTIONED) as ToolCallState[];

  it.each(STATES)(
    "%s: the caption is the label; the state rides as a quiet word off the running/done path",
    (state) => {
      const headline = toolRowHeadlineOf(
        viewOf({ state, display: { caption: CAPTION, ...EVERY_TEXT } }),
      );
      expect(headline).toBe(CAPTIONED[state]);
      // No ellipsis, no tense change: the caption's own bytes lead.
      expect(headline).not.toContain("…");
      expect(headline.startsWith(CAPTION)).toBe(true);
    },
  );

  it.each(STATES)("%s: without a caption the ladder is untouched", (state) => {
    expect(toolRowHeadlineOf(viewOf({ state, display: EVERY_TEXT }))).toBe(
      UNCAPTIONED[state],
    );
  });

  it("a caption with no authored sentences still labels every state", () => {
    for (const state of STATES) {
      expect(
        toolRowHeadlineOf(viewOf({ state, display: { caption: CAPTION } })),
      ).toBe(CAPTIONED[state]);
    }
  });
});
