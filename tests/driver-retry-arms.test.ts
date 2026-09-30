// The driver's retry arms: every arm in the execution driver that returns
// an entry to PENDING without completing a delivery must count a delivery
// attempt first. THE GENERATING MECHANISM: the driver re-arms a pass on
// every entries publish, at the quiet delay unless some eligible entry
// has an attempt on record, and the cap is what parks an entry for the
// next connection — so an arm that flips an entry back to pending without
// counting re-arms the pass at 400 ms forever, a full thread-detail read
// each time. The round-1 fix opened exactly that arm (a coworker's stored
// outcome with its dispatching turn off the fetched window). The
// playground's refusal inbox bounds itself on the same shape by counting
// inside settlePostFailed itself.
//
// Derived from the source, held to the table, nothing counted: every
// `settlePostFailed(` call site in execution-driver.ts is an arm; each
// must have `_countDeliveryAttempt(` in the statements immediately before
// it within the same block.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  path.resolve(import.meta.dirname, "../src/core/execution-driver.ts"),
  "utf8",
);

/** The arms, keyed by the enclosing function, with what bounds each. */
const RETRY_ARMS: Record<string, string> = {
  _serveEntry:
    "a coworker's stored outcome whose dispatching turn is off the fetched " +
    "window: the attempt is counted, the entry returns to pending, the next " +
    "pass rides the retry cadence and MAX_DELIVERY_ATTEMPTS parks it",
  _reportOutcome:
    "a POST that failed for a reason other than the pause being over: the " +
    "attempt is counted, the stored outcome re-POSTs on the retry cadence " +
    "and MAX_DELIVERY_ATTEMPTS parks it",
};

function enclosingFunctionOf(index: number): string {
  const before = SOURCE.slice(0, index);
  const names = [...before.matchAll(/^(?:async )?function (\w+)\(/gm)].map(
    (match) => match[1],
  );
  const last = names.at(-1);
  if (last === undefined) {
    throw new Error("a settlePostFailed call outside any function");
  }
  return last;
}

describe("every arm that returns an entry to pending counts an attempt", () => {
  const arms = [...SOURCE.matchAll(/settlePostFailed\(/g)].map((match) => ({
    index: match.index,
    fn: enclosingFunctionOf(match.index),
  }));

  it("the arms are exactly the enumerated ones", () => {
    expect(arms.map((arm) => arm.fn).sort()).toEqual(
      Object.keys(RETRY_ARMS).sort(),
    );
  });

  it("each arm counts a delivery attempt in the statements before it", () => {
    for (const arm of arms) {
      // The arm's own block: back to the nearest `{` that opens it.
      const blockStart = SOURCE.lastIndexOf("{", arm.index);
      const preamble = SOURCE.slice(blockStart, arm.index);
      expect(
        preamble.includes("_countDeliveryAttempt("),
        `${arm.fn}: settlePostFailed without a counted attempt`,
      ).toBe(true);
    }
  });
});
