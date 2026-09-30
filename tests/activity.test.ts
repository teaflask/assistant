import { describe, expect, it } from "vitest";

import type { ServingAssistantTurn } from "../src/contract/threads";
import {
  activitySnapshotOf,
  sameActivitySnapshot,
  settledResultOf,
  type AssistantActivityResult,
} from "../src/core/activity";
import { ApprovalInbox } from "../src/core/approval-inbox";

function turnOf(
  overrides: Partial<ServingAssistantTurn> = {},
): ServingAssistantTurn {
  return {
    id: "turn-1",
    thread_id: "thread-1",
    user_message: "hello",
    kind: null,
    status: "working",
    error: null,
    run_id: "run-1",
    pending_interrupt_ids: [],
    awaiting_round: 0,
    pending_approvals: [],
    created_at: "2026-07-29T00:00:00Z",
    updated_at: "2026-07-29T00:00:00Z",
    ...overrides,
  };
}

function aPausedInboxWithOneActionableCard(): ApprovalInbox {
  const inbox = new ApprovalInbox();
  inbox.noteRunStarted("run-1");
  inbox.noteApprovalRequested({
    interrupt_id: "v1:before_tool_call:t1:handler",
    tool_name: "delete_doc",
    tool_args: { doc_id: "doc-1" },
    tool_input_schema: null,
    tool_output_schema: null,
    prompt: "The assistant wants to delete a doc. Allow it?",
    tool_call_id: "run-1-a1-t1",
    round: 0,
    gated: false,
    trust_available: false,
  });
  return inbox;
}

describe("settledResultOf", () => {
  it("captures a terminal turn with its identity", () => {
    const result = settledResultOf(
      turnOf({ id: "turn-9", status: "failed", error: "It broke." }),
    );

    expect(result).toEqual({
      turnId: "turn-9",
      status: "failed",
      failureSentence: "It broke.",
    });
  });

  it.each(["queued", "working", "awaiting_input", "parked"] as const)(
    "leaves the previous result standing while a turn is %s",
    (status) => {
      expect(settledResultOf(turnOf({ status }))).toBeNull();
    },
  );

  it("carries no failure sentence for a success or a supersede", () => {
    expect(
      settledResultOf(turnOf({ status: "succeeded" }))?.failureSentence,
    ).toBeNull();
    expect(
      settledResultOf(turnOf({ status: "superseded" }))?.failureSentence,
    ).toBeNull();
  });
});

describe("activitySnapshotOf", () => {
  it("counts only cards a human can still act on", () => {
    const inbox = aPausedInboxWithOneActionableCard();

    const snapshot = activitySnapshotOf({
      busy: true,
      newestTurn: turnOf({ status: "parked" }),
      approvalCards: inbox.cards(),
      pendingDecisionGap: null,
      lastResult: null,
    });

    expect(snapshot.pendingApprovalCount).toBe(1);
    expect(snapshot.newestTurnStatus).toBe("parked");
    expect(snapshot.newestTurnId).toBe("turn-1");
    expect(snapshot.busy).toBe(true);
  });

  it("carries no turn identity when nothing has run", () => {
    const snapshot = activitySnapshotOf({
      busy: false,
      newestTurn: null,
      approvalCards: [],
      pendingDecisionGap: null,
      lastResult: null,
    });

    expect(snapshot.newestTurnId).toBeNull();
    expect(snapshot.newestTurnStatus).toBeNull();
  });

  it("stops counting a card once it is answered", () => {
    const inbox = aPausedInboxWithOneActionableCard();
    inbox.beginSubmit("v1:before_tool_call:t1:handler");
    inbox.settleSubmitAnswered("v1:before_tool_call:t1:handler", true);

    const snapshot = activitySnapshotOf({
      busy: false,
      newestTurn: turnOf({ status: "working" }),
      approvalCards: inbox.cards(),
      pendingDecisionGap: null,
      lastResult: null,
    });

    expect(snapshot.pendingApprovalCount).toBe(0);
  });
});

describe("sameActivitySnapshot", () => {
  const A_FAILURE: AssistantActivityResult = {
    turnId: "turn-1",
    status: "failed",
    failureSentence: "It broke.",
  };

  it("treats identical content as the same feed", () => {
    const inputs = {
      busy: false,
      newestTurn: turnOf({ status: "failed", error: "It broke." }),
      approvalCards: [],
      pendingDecisionGap: null,
      lastResult: A_FAILURE,
    };

    expect(
      sameActivitySnapshot(
        activitySnapshotOf(inputs),
        activitySnapshotOf(inputs),
      ),
    ).toBe(true);
  });

  it("tells two consecutive identical failures apart by turn id", () => {
    const first = activitySnapshotOf({
      busy: false,
      newestTurn: turnOf({
        id: "turn-1",
        status: "failed",
        error: "It broke.",
      }),
      approvalCards: [],
      pendingDecisionGap: null,
      lastResult: A_FAILURE,
    });
    const second = activitySnapshotOf({
      busy: false,
      newestTurn: turnOf({
        id: "turn-2",
        status: "failed",
        error: "It broke.",
      }),
      approvalCards: [],
      pendingDecisionGap: null,
      lastResult: { ...A_FAILURE, turnId: "turn-2" },
    });

    // A doorbell must ring again for the second failure even though the
    // sentence is identical.
    expect(sameActivitySnapshot(first, second)).toBe(false);
  });

  it("tells two live turns with the same status apart by turn id", () => {
    const inputsFor = (id: string) => ({
      busy: true,
      newestTurn: turnOf({ id, status: "awaiting_input" as const }),
      approvalCards: [],
      pendingDecisionGap: null,
      lastResult: null,
    });

    // A thread switch onto a different waiting turn must publish: a host
    // presence consumer keying on the live turn's id must see it change.
    expect(
      sameActivitySnapshot(
        activitySnapshotOf(inputsFor("turn-1")),
        activitySnapshotOf(inputsFor("turn-2")),
      ),
    ).toBe(false);
  });
});
