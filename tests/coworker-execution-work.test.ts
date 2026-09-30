import { describe, expect, it } from "vitest";

import type {
  ApprovalCardModel,
  ApprovalCardStatus,
} from "../src/core/approval-inbox";
import {
  coworkerExecutionWorkOf,
  sameCoworkerExecutionWork,
} from "../src/core/coworker-execution-work";
import type {
  ExecutionEntryModel,
  ExecutionEntryStatus,
} from "../src/core/execution-inbox";

function entryOf(
  interruptId: string,
  status: ExecutionEntryStatus,
  ordinal: number | null,
): ExecutionEntryModel {
  return {
    interruptId,
    toolName: "action__refund",
    toolCallId: null,
    anchored: false,
    kind: "http_intent",
    action: null,
    intent: null,
    round: 0,
    runId: "run-1",
    status,
    asker:
      ordinal === null ? { kind: "assistant" } : { kind: "coworker", ordinal },
    turnId: ordinal === null ? null : "turn-dispatching",
  };
}

describe("coworkerExecutionWorkOf", () => {
  it("folds coworker entries per ordinal and ignores the assistant's own", () => {
    const work = coworkerExecutionWorkOf([
      entryOf("a", { kind: "pending" }, null),
      entryOf("b", { kind: "pending" }, 3),
      entryOf("c", { kind: "reported", ok: false }, 4),
    ]);
    expect([...work.keys()]).toEqual([3, 4]);
    expect(work.get(3)).toEqual({
      toolName: "action__refund",
      status: "pending",
      ok: null,
      via: "browser",
    });
    expect(work.get(4)).toEqual({
      toolName: "action__refund",
      status: "reported",
      ok: false,
      via: "browser",
    });
  });

  it("shows live work over an open ask, and either over what was reported or went stale", () => {
    const work = coworkerExecutionWorkOf([
      entryOf("stale", { kind: "stale" }, 3),
      entryOf("done", { kind: "reported", ok: true }, 3),
      entryOf("open", { kind: "pending" }, 3),
      entryOf("live", { kind: "executing" }, 3),
    ]);
    expect(work.get(3)?.status).toBe("executing");
  });
});

function cardOf(
  interruptId: string,
  status: ApprovalCardStatus,
  ordinal: number | null,
): ApprovalCardModel {
  return {
    interruptId,
    toolName: "action__cancel",
    toolArgs: {},
    toolInputSchema: null,
    toolOutputSchema: null,
    prompt: "A coworker wants to use it.",
    toolCallId: null,
    anchored: false,
    round: 0,
    runId: "run-dispatching",
    parked: false,
    gated: true,
    trustAvailable: false,
    status,
    asker:
      ordinal === null
        ? { kind: "assistant" }
        : { kind: "coworker", ordinal, label: "Cancel 41." },
    turnId: ordinal === null ? null : "turn-dispatching",
  };
}

describe("coworkerExecutionWorkOf — a coworker's approval card", () => {
  it("folds coworker cards per ordinal as approval work and ignores the assistant's own", () => {
    const work = coworkerExecutionWorkOf(
      [],
      [
        cardOf("own", { kind: "actionable", errorSentence: null }, null),
        cardOf("cw-3", { kind: "actionable", errorSentence: null }, 3),
        cardOf(
          "cw-4",
          { kind: "answered", approved: false, trusted: false },
          4,
        ),
        cardOf("cw-5", { kind: "stale" }, 5),
        cardOf("cw-6", { kind: "submitting" }, 6),
      ],
    );
    expect([...work.keys()]).toEqual([3, 4, 5, 6]);
    expect(work.get(3)).toEqual({
      toolName: "action__cancel",
      status: "pending",
      ok: null,
      via: "approval",
    });
    expect(work.get(4)).toEqual({
      toolName: "action__cancel",
      status: "reported",
      ok: false,
      via: "approval",
    });
    expect(work.get(5)?.status).toBe("stale");
    expect(work.get(6)?.status).toBe("pending");
  });

  it("keeps a null tool name null — the card's tool fields are best-effort, and the row decides the copy", () => {
    const work = coworkerExecutionWorkOf(
      [],
      [
        {
          ...cardOf("cw-3", { kind: "actionable", errorSentence: null }, 3),
          toolName: null,
        },
      ],
    );
    expect(work.get(3)).toEqual({
      toolName: null,
      status: "pending",
      ok: null,
      via: "approval",
    });
  });

  it("an open approval outranks an open execution of the same coworker; live browser work still outranks both", () => {
    const openBoth = coworkerExecutionWorkOf(
      [entryOf("b", { kind: "pending" }, 3)],
      [cardOf("cw-3", { kind: "actionable", errorSentence: null }, 3)],
    );
    expect(openBoth.get(3)?.via).toBe("approval");
    const running = coworkerExecutionWorkOf(
      [entryOf("b", { kind: "executing" }, 3)],
      [cardOf("cw-3", { kind: "actionable", errorSentence: null }, 3)],
    );
    expect(running.get(3)?.via).toBe("browser");
    // A settled decision yields to the open browser ask it unblocked.
    const decided = coworkerExecutionWorkOf(
      [entryOf("b", { kind: "pending" }, 3)],
      [cardOf("cw-3", { kind: "answered", approved: true, trusted: false }, 3)],
    );
    expect(decided.get(3)?.via).toBe("browser");
  });
});

describe("sameCoworkerExecutionWork", () => {
  it("is equality by content, so an unchanged fold never republishes", () => {
    const a = coworkerExecutionWorkOf([entryOf("b", { kind: "pending" }, 3)]);
    const b = coworkerExecutionWorkOf([entryOf("b", { kind: "pending" }, 3)]);
    const c = coworkerExecutionWorkOf([entryOf("b", { kind: "executing" }, 3)]);
    expect(sameCoworkerExecutionWork(a, b)).toBe(true);
    expect(sameCoworkerExecutionWork(a, c)).toBe(false);
    expect(sameCoworkerExecutionWork(a, new Map())).toBe(false);
  });
});
