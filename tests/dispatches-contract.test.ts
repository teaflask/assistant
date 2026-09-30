import { describe, expect, it } from "vitest";

import {
  dispatchFailed,
  dispatchHasSettled,
  dispatchIsRunning,
  type ThreadDispatchStatus,
} from "../src/contract/dispatches";

// The ledger predicates over EVERY state a stream-end judge can meet —
// every status — paused included — and the unread row. The judge asks
// one affirmative question, dispatchHasSettled, and only a yes may read
// clean: an unread ledger is not a settled one.
const STATES: ThreadDispatchStatus[] = [
  "dispatched",
  "paused",
  "succeeded",
  "failed",
];

describe("dispatchHasSettled", () => {
  it("answers yes only for a row the ledger settled", () => {
    expect(dispatchHasSettled({ status: "succeeded" })).toBe(true);
    expect(dispatchHasSettled({ status: "failed" })).toBe(true);
    expect(dispatchHasSettled({ status: "dispatched" })).toBe(false);
    // Paused is open, not settled: the child still owns its row.
    expect(dispatchHasSettled({ status: "paused" })).toBe(false);
    expect(dispatchIsRunning({ status: "paused" })).toBe(true);
  });

  it("an unread ledger is not a settled one", () => {
    expect(dispatchHasSettled(undefined)).toBe(false);
  });

  it("partitions every status with the running predicate", () => {
    for (const status of STATES) {
      expect(dispatchHasSettled({ status })).toBe(
        !dispatchIsRunning({ status }),
      );
    }
    // failed is settled AND failed: the failure sentence outranks a banner.
    expect(dispatchFailed({ status: "failed" })).toBe(true);
    expect(dispatchFailed({ status: "succeeded" })).toBe(false);
  });
});
