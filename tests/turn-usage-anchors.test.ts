// The turn-usage anchor laws: the narrower distrusts the wire, the
// merge reconciles by turn id (a delayed marker updates the row,
// never appends), a final entry is never demoted, and absence means
// UNKNOWN — no client-side estimate exists anywhere in this module.

import { describe, expect, it } from "vitest";

import {
  EMPTY_TURN_USAGE_ANCHORS,
  turnUsageAnchorOf,
  usageIsFinal,
  wellFormedTurnUsageAnchorsOf,
  withTurnUsageAnchored,
  type TurnUsage,
} from "../src/core/turn-usage-anchors";

const A_WIRE_VALUE = {
  turn_id: "turn-1",
  finality: "final",
  input_tokens: 300,
  output_tokens: 30,
  cache_read_tokens: 10,
  cache_write_tokens: 2,
  total_tokens: 342,
};

const NARROWED: TurnUsage = {
  turnId: "turn-1",
  finality: "final",
  inputTokens: 300,
  outputTokens: 30,
  cacheReadTokens: 10,
  cacheWriteTokens: 2,
  totalTokens: 342,
};

describe("turnUsageAnchorOf", () => {
  it("narrows the wire payload to the typed usage record", () => {
    expect(turnUsageAnchorOf(A_WIRE_VALUE)).toEqual(NARROWED);
  });

  it("ignores payloads without the durable join or with dishonest counts", () => {
    expect(turnUsageAnchorOf(null)).toBeNull();
    expect(turnUsageAnchorOf({ ...A_WIRE_VALUE, turn_id: "" })).toBeNull();
    expect(turnUsageAnchorOf({ ...A_WIRE_VALUE, input_tokens: -1 })).toBeNull();
    expect(
      turnUsageAnchorOf({ ...A_WIRE_VALUE, total_tokens: "342" }),
    ).toBeNull();
    expect(turnUsageAnchorOf({ ...A_WIRE_VALUE, finality: "" })).toBeNull();
  });

  it("resolves an ABSENT finality to the schema's declared default, keeping the counts", () => {
    // The wire schema types finality optional with a server default of
    // "final"; a producer that leans on the default must not lose its
    // whole usage row. Only a PRESENT-but-malformed value drops it.
    const withoutFinality: Record<string, unknown> = { ...A_WIRE_VALUE };
    delete withoutFinality.finality;
    expect(turnUsageAnchorOf(withoutFinality)).toEqual(NARROWED);
    expect(turnUsageAnchorOf({ ...A_WIRE_VALUE, finality: 7 })).toBeNull();
  });

  it("keeps unknown finality tokens verbatim — they read as not-final", () => {
    const partial = turnUsageAnchorOf({
      ...A_WIRE_VALUE,
      finality: "partial",
    });
    expect(partial?.finality).toBe("partial");
    expect(partial !== null && usageIsFinal(partial)).toBe(false);
    const stopped = turnUsageAnchorOf({
      ...A_WIRE_VALUE,
      finality: "stopped",
    });
    expect(stopped?.finality).toBe("stopped");
    expect(stopped !== null && usageIsFinal(stopped)).toBe(false);
    expect(usageIsFinal(NARROWED)).toBe(true);
  });
});

describe("withTurnUsageAnchored", () => {
  it("reconciles by turn id — a delayed update replaces, never duplicates", () => {
    const partial: TurnUsage = {
      ...NARROWED,
      finality: "partial",
      totalTokens: 100,
    };
    let anchors = withTurnUsageAnchored(EMPTY_TURN_USAGE_ANCHORS, partial);
    anchors = withTurnUsageAnchored(anchors, NARROWED);
    expect(anchors.size).toBe(1);
    expect(anchors.get("turn-1")).toEqual(NARROWED);
  });

  it("never demotes a final entry to a non-final one", () => {
    const anchors = withTurnUsageAnchored(EMPTY_TURN_USAGE_ANCHORS, NARROWED);
    const demoted = withTurnUsageAnchored(anchors, {
      ...NARROWED,
      finality: "partial",
      totalTokens: 1,
    });
    expect(demoted).toBe(anchors);
  });

  it("is idempotent under replay re-delivery — identity is the publish gate", () => {
    const anchors = withTurnUsageAnchored(EMPTY_TURN_USAGE_ANCHORS, NARROWED);
    expect(withTurnUsageAnchored(anchors, { ...NARROWED })).toBe(anchors);
  });
});

describe("wellFormedTurnUsageAnchorsOf", () => {
  it("drops malformed entries rather than crashing the seed", () => {
    const stored = new Map<string, TurnUsage>([
      ["turn-1", NARROWED],
      ["turn-2", { ...NARROWED, totalTokens: "342" } as never],
    ]);
    const seeded = wellFormedTurnUsageAnchorsOf(stored);
    expect([...seeded.keys()]).toEqual(["turn-1"]);
  });
});
