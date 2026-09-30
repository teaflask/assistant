import type { BaseEvent } from "@ag-ui/core";
import { describe, expect, it, vi } from "vitest";

import {
  toolCallRefusalOf,
  toolRefusalRecorder,
  wellFormedToolRefusalAnchorsOf,
  withToolRefusalAnchored,
} from "../src/core/tool-refusal-anchors";
import { withToolOutcomeLifted } from "../src/core/tool-outcome";
import { StreamResumeStore } from "../src/transport/stream-resume";

// The refusal anchors: the twin of the error anchors for the wire's
// `refused` sentence — a door that answered and declined. The content of
// such a result is the refusal envelope the model read, so the map is the
// client's only source for the row's state AND its reason.

const A_SENTENCE =
  "New subagent results have already arrived and are handed to you at your next step.";

// The wire's shape, then the transport's lift: the reader sees only what
// the 1.0 pipeline delivers.
function resultEvent(fields: Record<string, unknown>) {
  return withToolOutcomeLifted({
    type: "TOOL_CALL_RESULT",
    messageId: "t1-result",
    toolCallId: "t1",
    content: '{"ok": false, "refused": true, "error": {"message": "…"}}',
    role: "tool",
    ...fields,
  } as unknown as BaseEvent);
}

describe("toolCallRefusalOf", () => {
  it("accepts the wire's refusal sentence verbatim", () => {
    expect(toolCallRefusalOf(resultEvent({ refused: A_SENTENCE }))).toBe(
      A_SENTENCE,
    );
  });

  it("rejects absent, empty, boolean, and non-string fields instead of throwing", () => {
    // Unlike `error`, presence alone is not the signal: the sentence IS
    // the reason the row shows, and the mapper never stamps an empty one.
    expect(toolCallRefusalOf(resultEvent({}))).toBeNull();
    expect(toolCallRefusalOf(resultEvent({ refused: "" }))).toBeNull();
    expect(toolCallRefusalOf(resultEvent({ refused: true }))).toBeNull();
    expect(toolCallRefusalOf(resultEvent({ refused: 7 }))).toBeNull();
    expect(
      toolCallRefusalOf(resultEvent({ refused: { message: "x" } })),
    ).toBeNull();
    expect(toolCallRefusalOf(null)).toBeNull();
    expect(toolCallRefusalOf("refused")).toBeNull();
  });

  it("caps a runaway sentence instead of retaining it unbounded", () => {
    const sentence = toolCallRefusalOf(
      resultEvent({ refused: "x".repeat(5000) }),
    );
    expect(sentence?.length).toBe(2000);
  });
});

describe("withToolRefusalAnchored", () => {
  it("is idempotent under replay: first anchor wins, identity unchanged", () => {
    const once = withToolRefusalAnchored(new Map(), "t1", A_SENTENCE);
    const twice = withToolRefusalAnchored(once, "t1", "a later sentence");
    expect(twice).toBe(once);
    expect(once.get("t1")).toBe(A_SENTENCE);
  });

  it("keeps distinct calls' sentences apart", () => {
    let anchors: ReadonlyMap<string, string> = new Map();
    anchors = withToolRefusalAnchored(anchors, "t1", "one");
    anchors = withToolRefusalAnchored(anchors, "t2", "two");
    expect(anchors.get("t1")).toBe("one");
    expect(anchors.get("t2")).toBe("two");
  });
});

describe("wellFormedToolRefusalAnchorsOf", () => {
  it("drops malformed entries rather than rendering (or crashing on) them", () => {
    const stored = new Map<unknown, unknown>([
      ["t1", A_SENTENCE],
      ["t2", 7],
      [3, "three"],
    ]) as unknown as ReadonlyMap<string, string>;

    const seeded = wellFormedToolRefusalAnchorsOf(stored);

    expect(seeded.size).toBe(1);
    expect(seeded.get("t1")).toBe(A_SENTENCE);
  });
});

describe("toolRefusalRecorder", () => {
  it("records a refused result's toolCallId and sentence", () => {
    const onRefusalAnchored = vi.fn();
    const recorder = toolRefusalRecorder(onRefusalAnchored);

    void recorder.onToolCallResultEvent?.({
      event: resultEvent({ refused: A_SENTENCE }),
    } as never);

    expect(onRefusalAnchored).toHaveBeenCalledWith("t1", A_SENTENCE);
  });

  it("ignores results without the refused sentence — successes, failures, and cancels", () => {
    const onRefusalAnchored = vi.fn();
    const recorder = toolRefusalRecorder(onRefusalAnchored);

    for (const fields of [{}, { error: "It broke." }, { cancelled: true }]) {
      void recorder.onToolCallResultEvent?.({
        event: resultEvent(fields),
      } as never);
    }

    expect(onRefusalAnchored).not.toHaveBeenCalled();
  });
});

describe("the resume store's tool-refusal map", () => {
  it("survives across records and keeps the first sentence per call", () => {
    const store = new StreamResumeStore();
    store.recordToolRefusal("t1", A_SENTENCE);
    const afterFirst = store.toolRefusalAnchors;
    store.recordToolRefusal("t1", "a later sentence");

    expect(store.toolRefusalAnchors).toBe(afterFirst);
    expect(store.toolRefusalAnchors.get("t1")).toBe(A_SENTENCE);
  });
});
