import type { BaseEvent } from "@ag-ui/core";
import { describe, expect, it, vi } from "vitest";

import {
  toolCallOffloadedOf,
  toolOffloadRecorder,
  wellFormedToolOffloadAnchorsOf,
  withToolOffloadAnchored,
} from "../src/core/tool-offload-anchors";
import { withToolOutcomeLifted } from "../src/core/tool-outcome";
import { StreamResumeStore } from "../src/transport/stream-resume";

// The wire's shape, then the transport's lift: the reader sees only what
// the 1.0 pipeline delivers.
function resultEvent(fields: Record<string, unknown>) {
  return withToolOutcomeLifted({
    type: "TOOL_CALL_RESULT",
    messageId: "t1-result",
    toolCallId: "t1",
    content: "[Offloaded: 3 blocks, ~9,420 tokens]\n…",
    role: "tool",
    ...fields,
  } as unknown as BaseEvent);
}

describe("toolCallOffloadedOf", () => {
  it("accepts only the literal true", () => {
    expect(toolCallOffloadedOf(resultEvent({ offloaded: true }))).toBe(true);
  });

  it("rejects everything else instead of throwing", () => {
    expect(toolCallOffloadedOf(resultEvent({}))).toBe(false);
    expect(toolCallOffloadedOf(resultEvent({ offloaded: "true" }))).toBe(false);
    expect(toolCallOffloadedOf(resultEvent({ offloaded: 1 }))).toBe(false);
    expect(toolCallOffloadedOf(resultEvent({ offloaded: false }))).toBe(false);
    expect(toolCallOffloadedOf(null)).toBe(false);
    expect(toolCallOffloadedOf("offloaded")).toBe(false);
  });
});

describe("withToolOffloadAnchored", () => {
  it("is idempotent under replay: a repeat keeps the set's identity", () => {
    const once = withToolOffloadAnchored(new Set(), "t1");
    const twice = withToolOffloadAnchored(once, "t1");
    expect(twice).toBe(once);
    expect(once.has("t1")).toBe(true);
  });

  it("keeps distinct calls apart", () => {
    let anchors: ReadonlySet<string> = new Set();
    anchors = withToolOffloadAnchored(anchors, "t1");
    anchors = withToolOffloadAnchored(anchors, "t2");
    expect(anchors.has("t1")).toBe(true);
    expect(anchors.has("t2")).toBe(true);
  });
});

describe("wellFormedToolOffloadAnchorsOf", () => {
  it("drops malformed entries rather than rendering (or crashing on) them", () => {
    const stored = new Set<unknown>([
      "t1",
      7,
      { toolCallId: "t2" },
    ]) as unknown as ReadonlySet<string>;

    const seeded = wellFormedToolOffloadAnchorsOf(stored);

    expect(seeded.size).toBe(1);
    expect(seeded.has("t1")).toBe(true);
  });
});

describe("toolOffloadRecorder", () => {
  it("records an offloaded result's toolCallId", () => {
    const onOffloadAnchored = vi.fn();
    const recorder = toolOffloadRecorder(onOffloadAnchored);

    void recorder.onToolCallResultEvent?.({
      event: resultEvent({ offloaded: true }),
    } as never);

    expect(onOffloadAnchored).toHaveBeenCalledWith("t1");
  });

  it("ignores results without the offloaded stamp — successes, failures, cancels", () => {
    const onOffloadAnchored = vi.fn();
    const recorder = toolOffloadRecorder(onOffloadAnchored);

    void recorder.onToolCallResultEvent?.({
      event: resultEvent({}),
    } as never);
    void recorder.onToolCallResultEvent?.({
      event: resultEvent({ error: "It broke." }),
    } as never);
    void recorder.onToolCallResultEvent?.({
      event: resultEvent({ cancelled: true }),
    } as never);

    expect(onOffloadAnchored).not.toHaveBeenCalled();
  });
});

describe("the resume store's tool-offload set", () => {
  it("survives across records and keeps identity under replay", () => {
    const store = new StreamResumeStore();
    store.recordToolOffload("t1");
    const afterFirst = store.toolOffloadAnchors;
    store.recordToolOffload("t1");

    expect(store.toolOffloadAnchors).toBe(afterFirst);
    expect(store.toolOffloadAnchors.has("t1")).toBe(true);
  });
});
