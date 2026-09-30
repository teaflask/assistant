import type { BaseEvent } from "@ag-ui/core";
import { describe, expect, it, vi } from "vitest";

import {
  toolCallErrorOf,
  toolErrorRecorder,
  wellFormedToolErrorAnchorsOf,
  withToolErrorAnchored,
} from "../src/core/tool-error-anchors";
import { withToolOutcomeLifted } from "../src/core/tool-outcome";
import { StreamResumeStore } from "../src/transport/stream-resume";

const A_SENTENCE = "The page took too long to respond.";

// The wire's shape, then the transport's lift: the reader sees only what
// the 1.0 pipeline delivers.
function resultEvent(fields: Record<string, unknown>) {
  return withToolOutcomeLifted({
    type: "TOOL_CALL_RESULT",
    messageId: "t1-result",
    toolCallId: "t1",
    content: '{"ok": false}',
    role: "tool",
    ...fields,
  } as unknown as BaseEvent);
}

describe("toolCallErrorOf", () => {
  it("accepts the wire's error sentence verbatim", () => {
    expect(toolCallErrorOf(resultEvent({ error: A_SENTENCE }))).toBe(
      A_SENTENCE,
    );
  });

  it("accepts the empty string — presence is the failure signal", () => {
    expect(toolCallErrorOf(resultEvent({ error: "" }))).toBe("");
  });

  it("rejects absent or non-string error fields instead of throwing", () => {
    expect(toolCallErrorOf(resultEvent({}))).toBeNull();
    expect(toolCallErrorOf(resultEvent({ error: 7 }))).toBeNull();
    expect(
      toolCallErrorOf(resultEvent({ error: { message: "x" } })),
    ).toBeNull();
    expect(toolCallErrorOf(null)).toBeNull();
    expect(toolCallErrorOf("error")).toBeNull();
  });

  it("caps a runaway sentence instead of retaining it unbounded", () => {
    expect(
      toolCallErrorOf(resultEvent({ error: "n".repeat(50_000) }))?.length,
    ).toBe(2000);
  });
});

describe("withToolErrorAnchored", () => {
  it("is idempotent under replay: first anchor wins, identity unchanged", () => {
    const once = withToolErrorAnchored(new Map(), "t1", A_SENTENCE);
    const twice = withToolErrorAnchored(once, "t1", "a different sentence");
    expect(twice).toBe(once);
    expect(once.get("t1")).toBe(A_SENTENCE);
  });

  it("keeps distinct calls' errors apart", () => {
    let anchors: ReadonlyMap<string, string> = new Map();
    anchors = withToolErrorAnchored(anchors, "t1", A_SENTENCE);
    anchors = withToolErrorAnchored(anchors, "t2", "It broke.");
    expect(anchors.get("t1")).toBe(A_SENTENCE);
    expect(anchors.get("t2")).toBe("It broke.");
  });
});

describe("wellFormedToolErrorAnchorsOf", () => {
  it("drops malformed entries rather than rendering (or crashing on) them", () => {
    const stored = new Map<unknown, unknown>([
      ["t1", A_SENTENCE],
      ["t2", 7],
      [3, "not a string key"],
    ]) as unknown as ReadonlyMap<string, string>;

    const seeded = wellFormedToolErrorAnchorsOf(stored);

    expect(seeded.size).toBe(1);
    expect(seeded.get("t1")).toBe(A_SENTENCE);
  });
});

describe("toolErrorRecorder", () => {
  it("records an errored result's toolCallId and sentence", () => {
    const onErrorAnchored = vi.fn();
    const recorder = toolErrorRecorder(onErrorAnchored);

    void recorder.onToolCallResultEvent?.({
      event: resultEvent({ error: A_SENTENCE }),
    } as never);

    expect(onErrorAnchored).toHaveBeenCalledWith("t1", A_SENTENCE);
  });

  it("ignores results without the error field — successes and cancels", () => {
    const onErrorAnchored = vi.fn();
    const recorder = toolErrorRecorder(onErrorAnchored);

    void recorder.onToolCallResultEvent?.({
      event: resultEvent({}),
    } as never);

    expect(onErrorAnchored).not.toHaveBeenCalled();
  });
});

describe("the resume store's tool-error map", () => {
  it("survives across records and keeps the first sentence per call", () => {
    const store = new StreamResumeStore();
    store.recordToolError("t1", A_SENTENCE);
    const afterFirst = store.toolErrorAnchors;
    store.recordToolError("t1", "a replayed copy");

    expect(store.toolErrorAnchors).toBe(afterFirst);
    expect(store.toolErrorAnchors.get("t1")).toBe(A_SENTENCE);
  });
});
