import type { BaseEvent } from "@ag-ui/core";
import { describe, expect, it, vi } from "vitest";

import {
  toolCallCancelledOf,
  toolCancelRecorder,
  wellFormedToolCancelAnchorsOf,
  withToolCancelAnchored,
} from "../src/core/tool-cancel-anchors";
import { withToolOutcomeLifted } from "../src/core/tool-outcome";
import { StreamResumeStore } from "../src/transport/stream-resume";

// The wire's shape, then the transport's lift: the reader sees only what
// the 1.0 pipeline delivers.
function resultEvent(fields: Record<string, unknown>) {
  return withToolOutcomeLifted({
    type: "TOOL_CALL_RESULT",
    messageId: "t1-result",
    toolCallId: "t1",
    content: "CONFIRMATION_FAILED: May I?",
    role: "tool",
    ...fields,
  } as unknown as BaseEvent);
}

describe("toolCallCancelledOf", () => {
  it("accepts only the literal true", () => {
    expect(toolCallCancelledOf(resultEvent({ cancelled: true }))).toBe(true);
  });

  it("rejects everything else instead of throwing", () => {
    expect(toolCallCancelledOf(resultEvent({}))).toBe(false);
    expect(toolCallCancelledOf(resultEvent({ cancelled: "true" }))).toBe(false);
    expect(toolCallCancelledOf(resultEvent({ cancelled: 1 }))).toBe(false);
    expect(toolCallCancelledOf(resultEvent({ cancelled: false }))).toBe(false);
    expect(toolCallCancelledOf(null)).toBe(false);
    expect(toolCallCancelledOf("cancelled")).toBe(false);
  });
});

describe("withToolCancelAnchored", () => {
  it("is idempotent under replay: a repeat keeps the set's identity", () => {
    const once = withToolCancelAnchored(new Set(), "t1");
    const twice = withToolCancelAnchored(once, "t1");
    expect(twice).toBe(once);
    expect(once.has("t1")).toBe(true);
  });

  it("keeps distinct calls apart", () => {
    let anchors: ReadonlySet<string> = new Set();
    anchors = withToolCancelAnchored(anchors, "t1");
    anchors = withToolCancelAnchored(anchors, "t2");
    expect(anchors.has("t1")).toBe(true);
    expect(anchors.has("t2")).toBe(true);
  });
});

describe("wellFormedToolCancelAnchorsOf", () => {
  it("drops malformed entries rather than rendering (or crashing on) them", () => {
    const stored = new Set<unknown>([
      "t1",
      7,
      { toolCallId: "t2" },
    ]) as unknown as ReadonlySet<string>;

    const seeded = wellFormedToolCancelAnchorsOf(stored);

    expect(seeded.size).toBe(1);
    expect(seeded.has("t1")).toBe(true);
  });
});

describe("toolCancelRecorder", () => {
  it("records a cancelled result's toolCallId", () => {
    const onCancelAnchored = vi.fn();
    const recorder = toolCancelRecorder(onCancelAnchored);

    void recorder.onToolCallResultEvent?.({
      event: resultEvent({ cancelled: true }),
    } as never);

    expect(onCancelAnchored).toHaveBeenCalledWith("t1");
  });

  it("ignores results without the cancelled stamp — successes and failures", () => {
    const onCancelAnchored = vi.fn();
    const recorder = toolCancelRecorder(onCancelAnchored);

    void recorder.onToolCallResultEvent?.({
      event: resultEvent({}),
    } as never);
    void recorder.onToolCallResultEvent?.({
      event: resultEvent({ error: "It broke." }),
    } as never);

    expect(onCancelAnchored).not.toHaveBeenCalled();
  });
});

describe("the resume store's tool-cancel set", () => {
  it("survives across records and keeps identity under replay", () => {
    const store = new StreamResumeStore();
    store.recordToolCancel("t1");
    const afterFirst = store.toolCancelAnchors;
    store.recordToolCancel("t1");

    expect(store.toolCancelAnchors).toBe(afterFirst);
    expect(store.toolCancelAnchors.has("t1")).toBe(true);
  });
});
