// The block-timing anchor laws: the recorder reads the per-event server
// timestamp off block-boundary events only, the fold is idempotent
// min/max (replay re-delivery changes nothing), and absent timestamps
// record nothing — unknown, never zero.

import type { BaseEvent } from "@ag-ui/core";
import { EventType } from "@ag-ui/core";
import { describe, expect, it } from "vitest";

import {
  blockTimingRecorder,
  foldBlockTimingObserved,
  wellFormedBlockTimingAnchorsOf,
} from "../src/core/block-timing-anchors";
import type { BlockTiming } from "../src/core/segment-timing";

function _recorded(
  events: object[],
): { blockId: string; observedAtMs: number }[] {
  const observed: { blockId: string; observedAtMs: number }[] = [];
  const recorder = blockTimingRecorder((blockId, observedAtMs) => {
    observed.push({ blockId, observedAtMs });
  });
  for (const event of events) {
    void recorder.onEvent?.({ event: event as BaseEvent } as never);
  }
  return observed;
}

describe("blockTimingRecorder", () => {
  it("records boundary events against their durable block id", () => {
    const observed = _recorded([
      { type: EventType.TEXT_MESSAGE_START, messageId: "m1", timestamp: 100 },
      { type: EventType.TEXT_MESSAGE_END, messageId: "m1", timestamp: 400 },
      { type: EventType.TOOL_CALL_START, toolCallId: "t1", timestamp: 200 },
      { type: EventType.TOOL_CALL_RESULT, toolCallId: "t1", timestamp: 900 },
    ]);
    expect(observed).toEqual([
      { blockId: "m1", observedAtMs: 100 },
      { blockId: "m1", observedAtMs: 400 },
      { blockId: "t1", observedAtMs: 200 },
      { blockId: "t1", observedAtMs: 900 },
    ]);
  });

  it("ignores deltas, lifecycle frames, and timestampless events", () => {
    const observed = _recorded([
      // A delta tightens nothing the boundaries don't already bound.
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "m1",
        delta: "hi",
        timestamp: 150,
      },
      // Lifecycle frames name no block — a fold joins by member ids.
      { type: EventType.RUN_FINISHED, timestamp: 500 },
      // The synthesized/old-history case: no timestamp, no evidence.
      { type: EventType.TEXT_MESSAGE_START, messageId: "m2" },
      // A malformed timestamp is not evidence either.
      {
        type: EventType.TEXT_MESSAGE_END,
        messageId: "m2",
        timestamp: "soon",
      },
    ]);
    expect(observed).toEqual([]);
  });
});

describe("foldBlockTimingObserved", () => {
  it("folds min-start/max-settle in place and is idempotent under replay", () => {
    const anchors = new Map<string, BlockTiming>();
    expect(foldBlockTimingObserved(anchors, "t1", 300)).toBe(true);
    expect(foldBlockTimingObserved(anchors, "t1", 100)).toBe(true);
    expect(foldBlockTimingObserved(anchors, "t1", 900)).toBe(true);
    expect(anchors.get("t1")).toEqual({ startedAtMs: 100, settledAtMs: 900 });

    // Replay re-delivery: the identical instant changes nothing and
    // answers false — the store's revision counter (identity cannot be
    // the gate for a mutating map) never bumps on a no-op.
    expect(foldBlockTimingObserved(anchors, "t1", 300)).toBe(false);
    expect(anchors.get("t1")).toEqual({ startedAtMs: 100, settledAtMs: 900 });
  });

  it("replaces the pair object on movement — a snapshot's held entry never mutates", () => {
    const anchors = new Map<string, BlockTiming>();
    foldBlockTimingObserved(anchors, "t1", 100);
    const snapshotted = anchors.get("t1");
    foldBlockTimingObserved(anchors, "t1", 900);
    expect(snapshotted).toEqual({ startedAtMs: 100, settledAtMs: 100 });
    expect(anchors.get("t1")).toEqual({ startedAtMs: 100, settledAtMs: 900 });
  });
});

describe("wellFormedBlockTimingAnchorsOf", () => {
  it("drops malformed entries rather than crashing the seed", () => {
    const stored = new Map<string, BlockTiming>([
      ["good", { startedAtMs: 100, settledAtMs: 200 }],
      ["half", { startedAtMs: null, settledAtMs: 200 }],
      ["bad", { startedAtMs: "soon", settledAtMs: 200 } as never],
    ]);
    const seeded = wellFormedBlockTimingAnchorsOf(stored);
    expect([...seeded.keys()]).toEqual(["good", "half"]);
  });
});
