// The suspension queue's determinism: which decisions enter, and in
// exactly what order — the "every simultaneously actionable decision
// stays reachable through a deterministic queue" half of the ticket,
// pure of React.

import { describe, expect, it } from "vitest";

import type {
  ApprovalCardModel,
  ApprovalCardStatus,
} from "../src/core/approval-inbox";
import type { ElicitationCardModel } from "../src/core/elicitation-cards";
import {
  clampedCursorOf,
  decisionKeyOf,
  suspensionQueueOf,
} from "../src/core/suspension-queue";

function approvalOf(
  interruptId: string,
  toolCallId: string | null,
  status: ApprovalCardStatus = { kind: "actionable", errorSentence: null },
  parked = false,
): ApprovalCardModel {
  return {
    interruptId,
    toolName: "action__create-support-ticket",
    toolArgs: { path: "/tickets" },
    toolInputSchema: null,
    toolOutputSchema: null,
    prompt: "The assistant wants to create a support ticket.",
    toolCallId,
    anchored: toolCallId !== null,
    round: 0,
    runId: "run-1",
    parked,
    gated: false,
    trustAvailable: false,
    asker: { kind: "assistant" },
    turnId: null,
    status,
  };
}

function askOf(
  interruptId: string,
  toolCallId: string | null,
  status: ElicitationCardModel["status"] = "actionable",
): ElicitationCardModel {
  return {
    interruptId,
    runId: "run-1",
    toolCallId,
    anchored: toolCallId !== null,
    round: 0,
    questions: [
      {
        id: "plan",
        heading: "Plan",
        prompt: "Which plan?",
        options: [
          { text: "Yes", description: null },
          { text: "No", description: null },
        ],
      },
    ],
    status,
    errorSentence: null,
    answered: null,
  };
}

const ROW_INDEX = new Map([
  ["t-first", 2],
  ["t-second", 5],
]);

describe("suspensionQueueOf", () => {
  it("admits only actionable and in-flight decisions — answered and stale never enter", () => {
    const queue = suspensionQueueOf(
      [
        approvalOf("a-actionable", null),
        approvalOf("a-submitting", null, { kind: "submitting" }),
        approvalOf("a-answered", null, {
          kind: "answered",
          approved: true,
          trusted: false,
        }),
        approvalOf("a-stale", null, { kind: "stale" }),
      ],
      [
        askOf("e-actionable", null),
        askOf("e-submitting", null, "submitting"),
        askOf("e-answered", null, "answered"),
        askOf("e-stale", null, "stale"),
      ],
      ROW_INDEX,
    );
    expect(queue.map(decisionKeyOf)).toEqual([
      "approval:a-actionable",
      "approval:a-submitting",
      "elicitation:e-actionable",
      "elicitation:e-submitting",
    ]);
  });

  it("a parked decision stays queued — a late answer is the designed restart path", () => {
    const queue = suspensionQueueOf(
      [
        approvalOf(
          "a-parked",
          null,
          { kind: "actionable", errorSentence: null },
          true,
        ),
      ],
      [],
      ROW_INDEX,
    );
    expect(queue.map(decisionKeyOf)).toEqual(["approval:a-parked"]);
  });

  it("orders by the operation's transcript position, orphans last", () => {
    const queue = suspensionQueueOf(
      [approvalOf("a-orphan", null), approvalOf("a-late", "t-second")],
      [askOf("e-early", "t-first")],
      ROW_INDEX,
    );
    expect(queue.map(decisionKeyOf)).toEqual([
      "elicitation:e-early",
      "approval:a-late",
      "approval:a-orphan",
    ]);
  });

  it("a call the transcript never rendered orders with the orphans", () => {
    const queue = suspensionQueueOf(
      [approvalOf("a-unrendered", "t-unknown")],
      [askOf("e-rendered", "t-first")],
      ROW_INDEX,
    );
    expect(queue.map(decisionKeyOf)).toEqual([
      "elicitation:e-rendered",
      "approval:a-unrendered",
    ]);
  });

  it("breaks an exact positional tie approvals-first, then by arrival within a family", () => {
    const queue = suspensionQueueOf(
      [approvalOf("a-one", "t-first"), approvalOf("a-two", "t-first")],
      [askOf("e-one", "t-first"), askOf("e-two", "t-first")],
      ROW_INDEX,
    );
    expect(queue.map(decisionKeyOf)).toEqual([
      "approval:a-one",
      "approval:a-two",
      "elicitation:e-one",
      "elicitation:e-two",
    ]);
  });
});

describe("clampedCursorOf", () => {
  it("clamps into the live queue and holds position when the current item resolves", () => {
    // Three decisions, cursor on the middle one; the queue shrinks to
    // two — the cursor keeps its index, so the NEXT decision becomes
    // current rather than jumping back to the first.
    expect(clampedCursorOf(1, 3)).toBe(1);
    expect(clampedCursorOf(1, 2)).toBe(1);
    // The tail resolves under the cursor: clamp to the new end.
    expect(clampedCursorOf(2, 2)).toBe(1);
    expect(clampedCursorOf(5, 1)).toBe(0);
    expect(clampedCursorOf(-2, 4)).toBe(0);
    expect(clampedCursorOf(3, 0)).toBe(0);
  });
});
