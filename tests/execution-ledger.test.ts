import { describe, expect, it } from "vitest";

import type { ExecutionOutcome } from "../src/core/execution-handlers";
import {
  readExecutedOutcome,
  recordExecutedOutcome,
  recordExecutionClaimed,
  UNKNOWN_OUTCOME,
} from "../src/persistence/execution-ledger";

// Node has no window, so the ledger runs on its module-memory layer here —
// the same code path a storage-blocked embed exercises. Unique thread ids
// keep the tests isolated.
let threadCounter = 0;
function freshThreadId(): string {
  threadCounter += 1;
  return `thread-${String(threadCounter)}`;
}

const NAVIGATED: ExecutionOutcome = {
  ok: true,
  result: { navigated: true, path: "/memory" },
};

describe("the executed-outcome ledger", () => {
  it("round-trips an outcome and answers null for interrupts never claimed here", () => {
    const threadId = freshThreadId();
    expect(readExecutedOutcome(threadId, "int-1")).toBeNull();
    recordExecutionClaimed(threadId, "int-1");
    recordExecutedOutcome(threadId, "int-1", NAVIGATED);
    expect(readExecutedOutcome(threadId, "int-1")).toEqual(NAVIGATED);
    expect(readExecutedOutcome(threadId, "int-2")).toBeNull();
  });

  it("reads a claim that never settled as the unknown-outcome failure — never a license to re-execute", () => {
    const threadId = freshThreadId();
    recordExecutionClaimed(threadId, "int-1");
    expect(readExecutedOutcome(threadId, "int-1")).toEqual(UNKNOWN_OUTCOME);
    expect(UNKNOWN_OUTCOME.ok).toBe(false);
  });

  it("keeps threads apart", () => {
    const first = freshThreadId();
    const second = freshThreadId();
    recordExecutedOutcome(first, "int-1", NAVIGATED);
    expect(readExecutedOutcome(second, "int-1")).toBeNull();
  });

  it("claims idempotently — a re-claim never wipes a settled outcome", () => {
    const threadId = freshThreadId();
    recordExecutionClaimed(threadId, "int-1");
    recordExecutedOutcome(threadId, "int-1", NAVIGATED);
    recordExecutionClaimed(threadId, "int-1");
    expect(readExecutedOutcome(threadId, "int-1")).toEqual(NAVIGATED);
  });

  it("bounds a pathological session with a FIFO cap", () => {
    const threadId = freshThreadId();
    for (let i = 0; i < 45; i += 1) {
      recordExecutedOutcome(threadId, `int-${String(i)}`, NAVIGATED);
    }
    expect(readExecutedOutcome(threadId, "int-0")).toBeNull();
    expect(readExecutedOutcome(threadId, "int-44")).toEqual(NAVIGATED);
  });
});
