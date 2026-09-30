// @vitest-environment jsdom
/**
 * The delivery turn's cause marker: the anchors module narrows the
 * subagent_results_delivered payload off the distrusted wire, the
 * recorder anchors it to the delivery run's first message — an assistant
 * message, since a delivery turn has no user bubble — and the divider
 * names the settled dispatches.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SubagentDeliveryDivider,
  deliveryDividerLabelOf,
} from "../src/components/subagent-delivery-divider";
import {
  deliveredResultsOf,
  subagentDeliveryMarkerRecorder,
  wellFormedDeliveryAnchorsOf,
  withSubagentDeliveryAnchored,
  type DeliveredResult,
} from "../src/core/subagent-delivery-anchors";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const A_RESULT: DeliveredResult = {
  ordinal: 0,
  label: "Audit the billing exports",
  succeeded: true,
};

describe("deliveredResultsOf", () => {
  it("accepts the wire payload and defaults the wire's own defaults", () => {
    expect(
      deliveredResultsOf({
        results: [
          { ordinal: 0, label: "Audit the billing exports", succeeded: true },
          { ordinal: 3 },
        ],
      }),
    ).toEqual([
      A_RESULT,
      // A missing label degrades to ""; succeeded defaults true.
      { ordinal: 3, label: "", succeeded: true },
    ]);
  });

  it("rejects malformed payloads instead of throwing", () => {
    expect(deliveredResultsOf(null)).toBeNull();
    expect(deliveredResultsOf("delivered")).toBeNull();
    expect(deliveredResultsOf({})).toBeNull();
    expect(deliveredResultsOf({ results: "three of them" })).toBeNull();
    expect(deliveredResultsOf({ results: [] })).toBeNull();
    // Entries without a numeric ordinal drop; nothing surviving is null.
    expect(
      deliveredResultsOf({ results: [{ label: "no identity" }, null, 7] }),
    ).toBeNull();
  });

  it("caps a runaway label instead of retaining it unbounded", () => {
    const results = deliveredResultsOf({
      results: [{ ordinal: 0, label: "n".repeat(50_000) }],
    });
    expect(results?.[0].label.length).toBe(200);
  });
});

describe("withSubagentDeliveryAnchored", () => {
  it("first anchor wins, ever — a re-delivery changes nothing", () => {
    const once = withSubagentDeliveryAnchored(new Map(), "m-1", [A_RESULT]);
    const twice = withSubagentDeliveryAnchored(once, "m-1", [
      { ordinal: 9, label: "a drifted replay", succeeded: false },
    ]);
    expect(twice).toBe(once);
    expect(once.get("m-1")).toEqual([A_RESULT]);
  });
});

describe("wellFormedDeliveryAnchorsOf", () => {
  it("drops malformed entries instead of rendering or crashing on them", () => {
    const stored = new Map<string, unknown>([
      ["m-1", [A_RESULT]],
      ["m-2", "not an array"],
      ["m-3", [{ ordinal: "0", label: "wrong types", succeeded: true }]],
      ["m-4", []],
    ]) as unknown as ReadonlyMap<string, DeliveredResult[]>;

    const seeded = wellFormedDeliveryAnchorsOf(stored);

    expect([...seeded.keys()]).toEqual(["m-1"]);
    expect(seeded.get("m-1")).toEqual([A_RESULT]);
  });
});

describe("subagentDeliveryMarkerRecorder", () => {
  const MARKER_EVENT = {
    type: "CUSTOM",
    name: "subagent_results_delivered",
    value: { results: [A_RESULT] },
  };

  it("anchors the marker to the run's first message — assistant, no user bubble", () => {
    const onDeliveryAnchored = vi.fn();
    const recorder = subagentDeliveryMarkerRecorder(onDeliveryAnchored);

    void recorder.onRunInitialized?.({} as never);
    void recorder.onRunStartedEvent?.({
      event: { type: "RUN_STARTED", threadId: "t-1", runId: "run-1" },
    } as never);
    void recorder.onCustomEvent?.({ event: MARKER_EVENT } as never);
    void recorder.onMessagesChanged?.({
      messages: [{ id: "a-1", role: "assistant", content: "Reporting back." }],
    } as never);

    expect(onDeliveryAnchored).toHaveBeenCalledExactlyOnceWith("run-1", "a-1", [
      A_RESULT,
    ]);

    // The flush consumed the pending marker: later message growth must
    // not re-anchor it.
    void recorder.onMessagesChanged?.({
      messages: [{ id: "a-2", role: "assistant", content: "More prose." }],
    } as never);
    expect(onDeliveryAnchored).toHaveBeenCalledTimes(1);
  });

  it("ignores other markers and malformed values", () => {
    const onDeliveryAnchored = vi.fn();
    const recorder = subagentDeliveryMarkerRecorder(onDeliveryAnchored);

    void recorder.onRunStartedEvent?.({
      event: { type: "RUN_STARTED", threadId: "t-1", runId: "run-1" },
    } as never);
    void recorder.onCustomEvent?.({
      event: { type: "CUSTOM", name: "run_resumed", value: { attempt: 2 } },
    } as never);
    void recorder.onCustomEvent?.({
      event: {
        type: "CUSTOM",
        name: "subagent_results_delivered",
        value: { results: [] },
      },
    } as never);
    void recorder.onMessagesChanged?.({
      messages: [{ id: "a-1", role: "assistant", content: "Prose." }],
    } as never);

    expect(onDeliveryAnchored).not.toHaveBeenCalled();
  });

  it("is run-bounded: a message-less run's marker never leaks forward", () => {
    const onDeliveryAnchored = vi.fn();
    const recorder = subagentDeliveryMarkerRecorder(onDeliveryAnchored);

    void recorder.onRunStartedEvent?.({
      event: { type: "RUN_STARTED", threadId: "t-1", runId: "run-1" },
    } as never);
    void recorder.onCustomEvent?.({ event: MARKER_EVENT } as never);
    void recorder.onRunFinishedEvent?.({
      event: { type: "RUN_FINISHED", threadId: "t-1", runId: "run-1" },
    } as never);
    void recorder.onMessagesChanged?.({
      messages: [{ id: "a-next", role: "assistant", content: "A later run." }],
    } as never);

    expect(onDeliveryAnchored).not.toHaveBeenCalled();
  });

  it("resets a dead connection's pending marker on the next run", () => {
    // StrictMode detaches the first run terminal-free and starts over: a
    // marker it collected but never flushed must not ride the replacement.
    const onDeliveryAnchored = vi.fn();
    const recorder = subagentDeliveryMarkerRecorder(onDeliveryAnchored);

    void recorder.onRunStartedEvent?.({
      event: { type: "RUN_STARTED", threadId: "t-1", runId: "run-1" },
    } as never);
    void recorder.onCustomEvent?.({ event: MARKER_EVENT } as never);
    void recorder.onRunInitialized?.({} as never);
    void recorder.onMessagesChanged?.({
      messages: [{ id: "a-1", role: "assistant", content: "Prose." }],
    } as never);

    expect(onDeliveryAnchored).not.toHaveBeenCalled();
  });
});

describe("the delivery divider's label", () => {
  it("names a lone dispatch", () => {
    expect(deliveryDividerLabelOf([A_RESULT])).toBe(
      "Subagent Audit the billing exports done",
    );
  });

  it("drops the title's own full stop so the verb reads on one line", () => {
    const punctuated = {
      ...A_RESULT,
      label: "Audit the billing exports. Read every invoice.",
    };
    expect(deliveryDividerLabelOf([punctuated])).toBe(
      "Subagent Audit the billing exports. Read every invoice done",
    );
    expect(deliveryDividerLabelOf([{ ...punctuated, succeeded: false }])).toBe(
      "Subagent Audit the billing exports. Read every invoice failed",
    );
  });

  it("says so when the lone dispatch failed", () => {
    expect(deliveryDividerLabelOf([{ ...A_RESULT, succeeded: false }])).toBe(
      "Subagent Audit the billing exports failed",
    );
  });

  it("counts the rest of a batch, failures included", () => {
    const batch = [
      A_RESULT,
      { ordinal: 1, label: "Summarize the churn thread", succeeded: true },
      { ordinal: 2, label: "Draft the renewal email", succeeded: false },
    ];
    expect(deliveryDividerLabelOf(batch)).toBe(
      "3 subagents · 2 done · 1 failed",
    );
  });

  it("degrades to neutral copy when no entry carries a label", () => {
    expect(
      deliveryDividerLabelOf([{ ordinal: 0, label: "", succeeded: true }]),
    ).toBe("1 subagent done");
  });

  it("clips a long excerpt to one quiet line", () => {
    const label = deliveryDividerLabelOf([
      { ordinal: 0, label: "n".repeat(200), succeeded: true },
    ]);
    expect(label).toBe(`Subagent ${"n".repeat(63)}… done`);
  });
});

describe("SubagentDeliveryDivider", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders the label as a quiet divider", () => {
    act(() => {
      root.render(<SubagentDeliveryDivider results={[A_RESULT]} />);
    });
    expect(container.textContent).toContain(
      "Subagent Audit the billing exports done",
    );
  });
});
