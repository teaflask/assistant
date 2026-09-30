// The durable decision-anchor family: the narrower's arms, the
// idempotent merge, and the defensive seed — the pure half of the
// hold's durable arm. The integration half (the real inbox pruning
// racing the hold) lives in
// tests/message-list-activity-group.test.tsx.
import { describe, expect, it } from "vitest";

import {
  EMPTY_TOOL_DECISION_ANCHORS,
  toolDecisionAnchorOf,
  toolDecisionRecorder,
  wellFormedToolDecisionAnchorsOf,
  withToolDecisionAnchored,
} from "../src/core/tool-decision-anchors";

describe("toolDecisionAnchorOf", () => {
  it("marks an approval_requested's tool call", () => {
    expect(
      toolDecisionAnchorOf("approval_requested", {
        interrupt_id: "i1",
        prompt: "?",
        tool_call_id: "t1",
      }),
    ).toBe("t1");
  });

  it("an unanchored ask marks nothing — there is no row to hold", () => {
    expect(
      toolDecisionAnchorOf("approval_requested", {
        interrupt_id: "i1",
        prompt: "?",
        tool_call_id: null,
      }),
    ).toBeNull();
    expect(
      toolDecisionAnchorOf("approval_requested", {
        interrupt_id: "i1",
        prompt: "?",
        tool_call_id: "",
      }),
    ).toBeNull();
  });

  it("marks a member-answerable execution request and ignores machine kinds", () => {
    expect(
      toolDecisionAnchorOf("tool_execution_requested", {
        interrupt_id: "i2",
        tool_call_id: "t2",
        request: { kind: "builtin.ask_questions" },
      }),
    ).toBe("t2");
    // The machine-executed kinds are not member decisions.
    expect(
      toolDecisionAnchorOf("tool_execution_requested", {
        interrupt_id: "i3",
        tool_call_id: "t3",
        request: { kind: "builtin.navigate" },
      }),
    ).toBeNull();
  });

  it("ignores other markers and malformed payloads whole", () => {
    expect(toolDecisionAnchorOf("run_resumed", { tool_call_id: "t9" })).toBe(
      null,
    );
    expect(toolDecisionAnchorOf("approval_requested", "not-an-object")).toBe(
      null,
    );
    expect(
      toolDecisionAnchorOf("tool_execution_requested", {
        tool_call_id: "t4",
        request: "not-an-object",
      }),
    ).toBeNull();
  });
});

describe("the merge and the seed", () => {
  it("is idempotent — a replayed marker returns the identical set (identity is the publish gate)", () => {
    const once = withToolDecisionAnchored(EMPTY_TOOL_DECISION_ANCHORS, "t1");
    expect(withToolDecisionAnchored(once, "t1")).toBe(once);
    expect([...withToolDecisionAnchored(once, "t2")].sort()).toEqual([
      "t1",
      "t2",
    ]);
  });

  it("drops non-string members from a stored seed rather than rendering them", () => {
    const dirty = new Set(["t1", 7, null] as unknown as string[]);
    expect([...wellFormedToolDecisionAnchorsOf(dirty)]).toEqual(["t1"]);
  });
});

describe("toolDecisionRecorder", () => {
  it("anchors from CUSTOM events only, through the narrower", () => {
    const seen: string[] = [];
    const recorder = toolDecisionRecorder((toolCallId) => {
      seen.push(toolCallId);
    });
    void recorder.onCustomEvent?.({
      event: {
        name: "approval_requested",
        value: { interrupt_id: "i1", prompt: "?", tool_call_id: "t1" },
      },
    } as never);
    void recorder.onCustomEvent?.({
      event: {
        name: "tool_execution_requested",
        value: {
          interrupt_id: "i2",
          tool_call_id: "t2",
          request: { kind: "builtin.ask_questions" },
        },
      },
    } as never);
    void recorder.onCustomEvent?.({
      event: { name: "tool_call_annotated", value: { tool_call_id: "t3" } },
    } as never);
    expect(seen).toEqual(["t1", "t2"]);
  });
});
