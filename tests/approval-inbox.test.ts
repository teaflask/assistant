import { describe, expect, it } from "vitest";

import type { ApprovalRequestedPayload } from "../src/contract/events";
import type { ServingAssistantTurn } from "../src/contract/threads";
import {
  ApprovalInbox,
  approvalRequestedPayloadOf,
  coworkerApprovalRequestOf,
  reconcileApprovalsWithTurns,
  SERVING_APPROVAL_CAPABILITIES,
  type ApprovalTurnRecord,
} from "../src/core/approval-inbox";

const RUN_ID = "run-1";
const TOOL_CALL_ID = "run-1-a1-t1";

function turnOf(
  overrides: Partial<ServingAssistantTurn> = {},
): ServingAssistantTurn {
  return {
    id: "turn-1",
    thread_id: "thread-1",
    user_message: "Please save that.",
    kind: null,
    status: "awaiting_input",
    error: null,
    run_id: RUN_ID,
    pending_interrupt_ids: [payloadOf().interrupt_id],
    awaiting_round: 0,
    pending_approvals: [],
    created_at: "2026-08-29T00:00:00Z",
    updated_at: "2026-08-29T00:00:00Z",
    ...overrides,
  };
}

function payloadOf(
  overrides: Partial<ApprovalRequestedPayload> = {},
): ApprovalRequestedPayload {
  return {
    interrupt_id: "v1:before_tool_call:t1:handler",
    tool_name: "add_memory",
    tool_args: { entries: ["The visitor prefers oolong."] },
    tool_input_schema: null,
    tool_output_schema: null,
    prompt: "The assistant wants to save a memory. Allow it?",
    tool_call_id: TOOL_CALL_ID,
    round: 0,
    gated: false,
    trust_available: false,
    ...overrides,
  };
}

// The serving door's shape — every capability on. The capabilities
// describe below poses the default-off host.
function pausedInbox(): ApprovalInbox {
  const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
  inbox.noteRunStarted(RUN_ID);
  inbox.noteToolCallStart(TOOL_CALL_ID);
  inbox.noteApprovalRequested(payloadOf());
  return inbox;
}

describe("approvalRequestedPayloadOf", () => {
  it("accepts the contract payload verbatim", () => {
    const narrowed = approvalRequestedPayloadOf(payloadOf());
    expect(narrowed).toEqual(payloadOf());
  });

  it("strips the protocol-reserved caption from tool_args — the label is never an argument", () => {
    const narrowed = approvalRequestedPayloadOf({
      ...payloadOf(),
      tool_args: {
        caption: "Saving what the visitor prefers",
        entries: ["The visitor prefers oolong."],
      },
    });
    expect(narrowed?.tool_args).toEqual({
      entries: ["The visitor prefers oolong."],
    });
    const plain = payloadOf();
    expect(approvalRequestedPayloadOf(plain)?.tool_args).toBe(plain.tool_args);
  });

  it("rejects payloads that are not objects or lack the required fields", () => {
    expect(approvalRequestedPayloadOf(null)).toBeNull();
    expect(approvalRequestedPayloadOf("interrupt")).toBeNull();
    expect(approvalRequestedPayloadOf({ prompt: "Allow?" })).toBeNull();
    expect(approvalRequestedPayloadOf({ interrupt_id: "" })).toBeNull();
    expect(
      approvalRequestedPayloadOf({ interrupt_id: "id", prompt: 7 }),
    ).toBeNull();
  });

  it("normalizes the optional fields the contract lets vary", () => {
    const narrowed = approvalRequestedPayloadOf({
      interrupt_id: "id",
      prompt: "Allow?",
      tool_args: "not-a-record",
      round: "not-a-number",
    });
    expect(narrowed).toEqual({
      interrupt_id: "id",
      prompt: "Allow?",
      tool_name: null,
      tool_args: {},
      tool_input_schema: null,
      tool_output_schema: null,
      tool_call_id: null,
      round: 0,
      gated: false,
      trust_available: false,
    });
  });

  it("carries the tool schemas and fails safe when an older wire omits them", () => {
    const schema = {
      type: "object",
      properties: { query: { type: "string" } },
    };
    const carried = approvalRequestedPayloadOf(
      payloadOf({ tool_input_schema: schema, tool_output_schema: schema }),
    );
    expect(carried?.tool_input_schema).toEqual(schema);
    expect(carried?.tool_output_schema).toEqual(schema);

    const legacy = approvalRequestedPayloadOf({
      interrupt_id: "id",
      prompt: "Allow?",
    });
    expect(legacy?.tool_input_schema).toBeNull();
    expect(legacy?.tool_output_schema).toBeNull();

    const malformed = approvalRequestedPayloadOf(
      payloadOf({
        tool_input_schema: "not-a-record" as unknown as Record<string, unknown>,
      }),
    );
    expect(malformed?.tool_input_schema).toBeNull();
  });

  it("carries the approval-wire flags and fails safe when an older wire omits them", () => {
    const flagged = approvalRequestedPayloadOf(
      payloadOf({ gated: true, trust_available: true }),
    );
    expect(flagged?.gated).toBe(true);
    expect(flagged?.trust_available).toBe(true);

    const legacy = approvalRequestedPayloadOf({
      interrupt_id: "id",
      prompt: "Allow?",
    });
    expect(legacy?.gated).toBe(false);
    expect(legacy?.trust_available).toBe(false);
  });
});

describe("a pause opening cards", () => {
  it("renders one actionable card per marker, anchored to its streamed tool call", () => {
    const inbox = pausedInbox();
    expect(inbox.cards()).toEqual([
      expect.objectContaining({
        interruptId: payloadOf().interrupt_id,
        toolName: "add_memory",
        prompt: payloadOf().prompt,
        toolCallId: TOOL_CALL_ID,
        anchored: true,
        round: 0,
        runId: RUN_ID,
        status: { kind: "actionable", errorSentence: null },
      }),
    ]);
  });

  it("carries the tool schemas onto the card", () => {
    const schema = {
      type: "object",
      properties: { query: { type: "string" } },
    };
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    inbox.noteRunStarted(RUN_ID);
    inbox.noteApprovalRequested(payloadOf({ tool_input_schema: schema }));
    expect(inbox.cards()).toEqual([
      expect.objectContaining({
        toolInputSchema: schema,
        toolOutputSchema: null,
      }),
    ]);
  });

  it("classifies a card as an orphan when its tool call never streamed", () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    inbox.noteRunStarted(RUN_ID);
    inbox.noteApprovalRequested(payloadOf({ tool_call_id: "never-streamed" }));
    inbox.noteApprovalRequested(
      payloadOf({ interrupt_id: "detached", tool_call_id: null }),
    );
    expect(inbox.cards().map((card) => card.anchored)).toEqual([false, false]);
  });

  it("ignores a marker arriving outside any run segment", () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    expect(inbox.noteApprovalRequested(payloadOf())).toBe(false);
    expect(inbox.cards()).toEqual([]);
  });

  it("holds a replayed marker to one card (replay and StrictMode idempotence)", () => {
    const inbox = pausedInbox();
    expect(inbox.noteApprovalRequested(payloadOf())).toBe(false);
    expect(inbox.cards()).toHaveLength(1);
  });

  it("re-stamps a carried card's stream coordinates from its replayed marker, keeping its status — and reports the move", () => {
    const inbox = pausedInbox();
    // A reconnect replays the pause under whatever run now serves it;
    // the carried card must follow that run so its closing evidence
    // (result, the settled word) still finds it — and the move must publish, or
    // the rendered card keeps the old runId the submit path reads.
    inbox.noteRunStarted("run-2");
    inbox.noteToolCallStart("run-2-a1-t1");
    expect(
      inbox.noteApprovalRequested(payloadOf({ tool_call_id: "run-2-a1-t1" })),
    ).toBe(true);
    expect(inbox.cards()).toEqual([
      expect.objectContaining({
        runId: "run-2",
        toolCallId: "run-2-a1-t1",
        anchored: true,
        status: { kind: "actionable", errorSentence: null },
      }),
    ]);
    // The card followed run-2: run-1's settled word misses it, no
    // RUN_FINISHED closes it, and run-2's settled word finds it.
    expect(
      inbox.reconcileWithTurns([{ run_id: RUN_ID, status: "succeeded" }]),
    ).toBe(false);
    expect(inbox.noteRunFinished()).toBe(false);
    expect(
      inbox.reconcileWithTurns([{ run_id: "run-2", status: "succeeded" }]),
    ).toBe(true);
    expect(inbox.cards()).toEqual([]);
  });

  it("keeps an answered card answered through a park-restart replay", () => {
    const inbox = pausedInbox();
    inbox.noteStreamClosedWithoutTerminal();
    const interruptId = payloadOf().interrupt_id;
    inbox.beginSubmit(interruptId);
    inbox.settleSubmitAnswered(interruptId, true);
    // The post-restart reconnect: the old run replays its marker, then
    // the restarted workflow's fresh run streams the resumed work.
    inbox.noteRunStarted(RUN_ID);
    inbox.noteToolCallStart(TOOL_CALL_ID);
    expect(inbox.noteApprovalRequested(payloadOf())).toBe(false);
    inbox.noteRunStarted("run-2");
    expect(inbox.cards()).toEqual([
      expect.objectContaining({
        status: { kind: "answered", approved: true, trusted: false },
      }),
    ]);
    // No RUN_FINISHED closes it; the settled turn record is what finally
    // clears it.
    expect(inbox.noteRunFinished()).toBe(false);
    expect(inbox.reconcileWithTurn(turnOf({ status: "succeeded" }))).toBe(true);
    expect(inbox.cards()).toEqual([]);
  });
});

describe("the stream closing cards", () => {
  it("removes a card when its tool call produces a result — the resume made visible", () => {
    const inbox = pausedInbox();
    expect(inbox.noteToolCallResult(TOOL_CALL_ID)).toBe(true);
    expect(inbox.cards()).toEqual([]);
  });

  it("a RUN_FINISHED alone closes nothing — the settled turn's word does (a synthesized close is indistinguishable from a real one)", () => {
    const inbox = pausedInbox();
    expect(inbox.noteRunFinished()).toBe(false);
    expect(inbox.cards()).toHaveLength(1);
    expect(
      inbox.reconcileWithTurns([{ run_id: RUN_ID, status: "succeeded" }]),
    ).toBe(true);
    expect(inbox.cards()).toEqual([]);
  });

  it("the settled word closes only SETTLED turns' runs, only the assistant's cards, spares an in-flight submit, and reads a lost capture as nothing", () => {
    const live = pausedInbox();
    for (const status of [
      "queued",
      "working",
      "awaiting_input",
      "parked",
    ] as const) {
      expect(live.reconcileWithTurns([{ run_id: RUN_ID, status }])).toBe(false);
      expect(live.cards()).toHaveLength(1);
    }
    expect(
      live.reconcileWithTurns([{ run_id: null, status: "succeeded" }]),
    ).toBe(false);
    expect(live.cards()).toHaveLength(1);
    for (const status of [
      "succeeded",
      "failed",
      "superseded",
      "stopped",
    ] as const) {
      const settled = pausedInbox();
      expect(settled.reconcileWithTurns([{ run_id: RUN_ID, status }])).toBe(
        true,
      );
      expect(settled.cards()).toEqual([]);
    }
    const submitting = pausedInbox();
    submitting.beginSubmit(payloadOf().interrupt_id);
    expect(
      submitting.reconcileWithTurns([{ run_id: RUN_ID, status: "succeeded" }]),
    ).toBe(false);
    expect(submitting.statusOf(payloadOf().interrupt_id)).toBe("submitting");
  });

  it("the streamer's synthesized close around a late row keeps the live pause's card actionable; the next read confirms it; the answer and the settled turn's word close it", () => {
    // ENTERED, not built: run-a settled earlier, run-b is live and pauses.
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    inbox.noteRunStarted("run-a");
    inbox.noteRunStarted("run-b");
    inbox.noteToolCallStart(TOOL_CALL_ID);
    expect(inbox.noteApprovalRequested(payloadOf())).toBe(true);
    // A coworker's late row lands under run-a: the streamer closes the
    // LIVE run, re-enters run-a for the row, closes it, re-opens run-b.
    // Only the late row replays — never the live pause's marker.
    expect(inbox.noteRunFinished()).toBe(false);
    expect(inbox.noteRunStarted("run-a")).toBe(false);
    expect(inbox.noteRunFinished()).toBe(false);
    expect(inbox.noteRunStarted("run-b")).toBe(false);
    expect(inbox.cards()).toEqual([
      expect.objectContaining({
        runId: "run-b",
        parked: false,
        status: { kind: "actionable", errorSentence: null },
      }),
    ]);
    // The confirming REST read: run-a's turn settled long ago, run-b's
    // still holds the pause. Nothing duplicates, nothing vanishes.
    const settledA = turnOf({
      id: "turn-a",
      run_id: "run-a",
      status: "succeeded",
      pending_interrupt_ids: [],
      awaiting_round: null,
    });
    const pausedB = turnOf({
      id: "turn-b",
      run_id: "run-b",
      pending_approvals: [payloadOf()],
    });
    expect(reconcileApprovalsWithTurns(inbox, [settledA, pausedB])).toBe(false);
    expect(inbox.cards()).toHaveLength(1);
    expect(inbox.statusOf(payloadOf().interrupt_id)).toBe("actionable");
    // The member answers; run-b's turn settles; the word closes it for
    // good — by monotonic evidence this time.
    inbox.beginSubmit(payloadOf().interrupt_id);
    inbox.settleSubmitAnswered(payloadOf().interrupt_id, true);
    expect(
      reconcileApprovalsWithTurns(inbox, [
        settledA,
        { ...pausedB, status: "succeeded", pending_interrupt_ids: [] },
      ]),
    ).toBe(true);
    expect(inbox.cards()).toEqual([]);
    expect(inbox.hydratePendingApprovals(pausedB)).toBe(false);
    expect(inbox.cards()).toEqual([]);
  });

  it("a replayed older run's real terminal closes nothing on the stream; the settled-runs arm closes it on the next read while a newer turn still works", () => {
    const inbox = pausedInbox();
    expect(inbox.noteRunFinished()).toBe(false);
    expect(inbox.noteRunStarted("run-2")).toBe(false);
    expect(inbox.cards()).toHaveLength(1);
    const working = turnOf({
      id: "turn-2",
      run_id: "run-2",
      status: "working",
      pending_interrupt_ids: [],
      awaiting_round: null,
    });
    // The gap the settled-runs arm exists for: the newest row alone
    // cannot close a card whose turn is not the newest.
    expect(inbox.reconcileWithTurn(working)).toBe(false);
    expect(inbox.cards()).toHaveLength(1);
    expect(
      reconcileApprovalsWithTurns(inbox, [
        turnOf({ status: "superseded", pending_interrupt_ids: [] }),
        working,
      ]),
    ).toBe(true);
    expect(inbox.cards()).toEqual([]);
  });

  it("a marker replayed under a remembered settled run opens nothing; the same marker under a live run still opens", () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    expect(
      inbox.reconcileWithTurns([
        { run_id: RUN_ID, status: "superseded" },
        { run_id: "run-2", status: "working" },
      ]),
    ).toBe(false);
    inbox.noteRunStarted(RUN_ID);
    expect(inbox.noteApprovalRequested(payloadOf())).toBe(false);
    expect(inbox.cards()).toEqual([]);
    inbox.noteRunStarted("run-2");
    expect(
      inbox.noteApprovalRequested(payloadOf({ interrupt_id: "own-2" })),
    ).toBe(true);
    expect(inbox.cards()).toHaveLength(1);
  });

  it("removes the narrated run's cards on RUN_ERROR", () => {
    const inbox = pausedInbox();
    expect(inbox.noteRunError()).toBe(true);
    expect(inbox.cards()).toEqual([]);
  });

  it("leaves a carried live card standing when a replayed historical run errors", () => {
    const inbox = pausedInbox();
    // The replay narrates an OLDER run before reaching the pausing one:
    // its recorded error must not wipe the newer pause's card.
    inbox.noteRunStarted("run-0");
    expect(inbox.noteRunError()).toBe(false);
    expect(inbox.cards()).toHaveLength(1);
  });

  it("leaves other runs' cards standing when a new run starts — a park-restarted workflow's fresh run must not purge the pause it answers", () => {
    const inbox = pausedInbox();
    expect(inbox.noteRunStarted("run-2")).toBe(false);
    expect(inbox.cards()).toHaveLength(1);
  });

  it("ends empty after a reload replays an already-resumed pause", () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    inbox.noteRunStarted(RUN_ID);
    inbox.noteToolCallStart(TOOL_CALL_ID);
    inbox.noteApprovalRequested(payloadOf());
    inbox.noteToolCallResult(TOOL_CALL_ID);
    inbox.noteRunFinished();
    expect(inbox.cards()).toEqual([]);
  });
});

describe("multi-round pauses", () => {
  it("supersedes the run's earlier round when a later round pauses", () => {
    const inbox = pausedInbox();
    inbox.noteToolCallResult(TOOL_CALL_ID);
    inbox.noteApprovalRequested(
      payloadOf({
        interrupt_id: "v1:before_tool_call:t2:handler",
        tool_call_id: "run-1-a1-r1-t2",
        round: 1,
      }),
    );
    expect(inbox.cards()).toEqual([
      expect.objectContaining({
        interruptId: "v1:before_tool_call:t2:handler",
        round: 1,
      }),
    ]);
  });

  it("demotes lingering lower-round cards the resume never closed", () => {
    const inbox = pausedInbox();
    inbox.noteApprovalRequested(
      payloadOf({ interrupt_id: "round-1-ask", round: 1 }),
    );
    expect(inbox.cards().map((card) => card.interruptId)).toEqual([
      "round-1-ask",
    ]);
  });

  it("treats a lower round replaying after a later pause as history", () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    inbox.noteRunStarted(RUN_ID);
    inbox.noteApprovalRequested(payloadOf({ interrupt_id: "late", round: 1 }));
    expect(
      inbox.noteApprovalRequested(
        payloadOf({ interrupt_id: "early", round: 0 }),
      ),
    ).toBe(false);
    expect(inbox.cards().map((card) => card.interruptId)).toEqual(["late"]);
  });
});

describe("the parked lifecycle (a stream ending without a terminal)", () => {
  it("keeps the card answerable and flags it parked", () => {
    const inbox = pausedInbox();
    expect(inbox.noteStreamClosedWithoutTerminal()).toBe(true);
    expect(inbox.cards()).toEqual([
      expect.objectContaining({
        parked: true,
        status: { kind: "actionable", errorSentence: null },
      }),
    ]);
    expect(inbox.beginSubmit(payloadOf().interrupt_id)).toBe(true);
  });

  it("reports no visible change when nothing was left open", () => {
    const inbox = pausedInbox();
    inbox.beginSubmit(payloadOf().interrupt_id);
    inbox.settleSubmitAnswered(payloadOf().interrupt_id, true);
    expect(inbox.noteStreamClosedWithoutTerminal()).toBe(false);
    expect(inbox.cards()[0]?.parked).toBe(false);
  });

  it("answers a parked card late through the normal submit transitions", () => {
    const inbox = pausedInbox();
    inbox.noteStreamClosedWithoutTerminal();
    const interruptId = payloadOf().interrupt_id;
    expect(inbox.beginSubmit(interruptId)).toBe(true);
    expect(inbox.settleSubmitAnswered(interruptId, true)).toBe(true);
    expect(inbox.cards()[0]?.status).toEqual({
      kind: "answered",
      approved: true,
      trusted: false,
    });
  });

  it("the void's paired RUN_FINISHED alone closes nothing; the voided turn's settled word does — the turn_voided marker itself never feeds the inbox", () => {
    const inbox = pausedInbox();
    inbox.noteStreamClosedWithoutTerminal();
    expect(inbox.noteRunFinished()).toBe(false);
    expect(inbox.cards()).toEqual([
      expect.objectContaining({
        parked: true,
        status: { kind: "actionable", errorSentence: null },
      }),
    ]);
    expect(
      inbox.reconcileWithTurns([{ run_id: RUN_ID, status: "superseded" }]),
    ).toBe(true);
    expect(inbox.cards()).toEqual([]);
  });
});

describe("approval_resolved receipts as answered evidence", () => {
  it("flips a replayed marker's card straight to answered — buttons never resurrect", () => {
    const inbox = pausedInbox();
    expect(inbox.noteApprovalResolved(payloadOf().interrupt_id, true)).toBe(
      true,
    );
    expect(inbox.cards()).toEqual([
      expect.objectContaining({
        status: { kind: "answered", approved: true, trusted: false },
      }),
    ]);
    expect(inbox.beginSubmit(payloadOf().interrupt_id)).toBe(false);
  });

  it("still closes the answered card on the resume's own evidence", () => {
    const inbox = pausedInbox();
    inbox.noteApprovalResolved(payloadOf().interrupt_id, false);
    expect(inbox.noteToolCallResult(TOOL_CALL_ID)).toBe(true);
    expect(inbox.cards()).toEqual([]);
  });

  it("ignores receipts for cards it does not hold, and leaves settled notes alone", () => {
    const inbox = pausedInbox();
    expect(inbox.noteApprovalResolved("never-asked", true)).toBe(false);
    inbox.markPauseStale();
    expect(inbox.noteApprovalResolved(payloadOf().interrupt_id, true)).toBe(
      false,
    );
    expect(inbox.cards()[0]?.status).toEqual({ kind: "stale" });
  });
});

describe("answering", () => {
  it("keeps sibling cards of the same round individually answerable", () => {
    const inbox = pausedInbox();
    inbox.noteApprovalRequested(payloadOf({ interrupt_id: "sibling" }));
    inbox.beginSubmit(payloadOf().interrupt_id);
    inbox.settleSubmitAnswered(payloadOf().interrupt_id, true);
    expect(inbox.cards().map((card) => card.status)).toEqual([
      { kind: "answered", approved: true, trusted: false },
      { kind: "actionable", errorSentence: null },
    ]);
  });

  it("never resurrects an answered card from a replayed marker", () => {
    const inbox = pausedInbox();
    inbox.beginSubmit(payloadOf().interrupt_id);
    inbox.settleSubmitAnswered(payloadOf().interrupt_id, false);
    inbox.noteApprovalRequested(payloadOf());
    expect(inbox.cards().map((card) => card.status)).toEqual([
      { kind: "answered", approved: false, trusted: false },
    ]);
  });

  it("returns a failed submit to actionable with the sentence, ready to retry", () => {
    const inbox = pausedInbox();
    const interruptId = payloadOf().interrupt_id;
    inbox.beginSubmit(interruptId);
    inbox.settleSubmitError(interruptId, "Please try again in a moment.");
    expect(inbox.cards()[0]?.status).toEqual({
      kind: "actionable",
      errorSentence: "Please try again in a moment.",
    });
    expect(inbox.beginSubmit(interruptId)).toBe(true);
  });

  it("marks every open ask stale on a pause-wide 409, whatever run stamped it", () => {
    const inbox = pausedInbox();
    inbox.noteRunStarted("run-2");
    inbox.noteApprovalRequested(
      payloadOf({ interrupt_id: "open-ask", round: 0 }),
    );
    inbox.beginSubmit(payloadOf().interrupt_id);
    inbox.settleSubmitAnswered(payloadOf().interrupt_id, true);
    expect(inbox.markPauseStale()).toBe(true);
    expect(inbox.cards().map((card) => card.status)).toEqual([
      { kind: "answered", approved: true, trusted: false },
      { kind: "stale" },
    ]);
    expect(inbox.markPauseStale()).toBe(false);
  });

  it("reads a card's status kind by interrupt id", () => {
    const inbox = pausedInbox();
    const interruptId = payloadOf().interrupt_id;
    expect(inbox.statusOf(interruptId)).toBe("actionable");
    inbox.beginSubmit(interruptId);
    expect(inbox.statusOf(interruptId)).toBe("submitting");
    expect(inbox.statusOf("never-asked")).toBeNull();
  });
});

describe("reconcileWithTurn — the durable turn record as lifetime authority", () => {
  it("stales an actionable card the pause no longer holds", () => {
    const inbox = pausedInbox();
    expect(
      inbox.reconcileWithTurn(turnOf({ pending_interrupt_ids: ["other-ask"] })),
    ).toBe(true);
    expect(inbox.cards()[0]?.status).toEqual({ kind: "stale" });
  });

  it("keeps an actionable card the pause still holds", () => {
    const inbox = pausedInbox();
    expect(inbox.reconcileWithTurn(turnOf())).toBe(false);
    expect(inbox.cards()[0]?.status).toEqual({
      kind: "actionable",
      errorSentence: null,
    });
  });

  it("never judges membership when the wire omits the array — absent must not read as empty", () => {
    const inbox = pausedInbox();
    const legacyTurn = turnOf();
    (legacyTurn as unknown as Record<string, unknown>).pending_interrupt_ids =
      undefined;
    expect(inbox.reconcileWithTurn(legacyTurn)).toBe(false);
    expect(inbox.cards()[0]?.status.kind).toBe("actionable");
  });

  it("never judges membership on a lost capture — a null run_id hides the cards server-side", () => {
    const inbox = pausedInbox();
    expect(
      inbox.reconcileWithTurn(
        turnOf({ run_id: null, pending_interrupt_ids: [] }),
      ),
    ).toBe(false);
    expect(inbox.cards()[0]?.status.kind).toBe("actionable");
  });

  it("never judges membership under queued or working — the set is contractually empty there", () => {
    const inbox = pausedInbox();
    expect(
      inbox.reconcileWithTurn(
        turnOf({ status: "working", pending_interrupt_ids: [] }),
      ),
    ).toBe(false);
    expect(inbox.cards()[0]?.status.kind).toBe("actionable");
  });

  it("never judges a card newer than the record's awaiting_round — a stale read must not kill it", () => {
    const inbox = pausedInbox();
    inbox.noteApprovalRequested(
      payloadOf({ interrupt_id: "round-1-ask", round: 1 }),
    );
    expect(
      inbox.reconcileWithTurn(
        turnOf({ pending_interrupt_ids: ["settled-ask"], awaiting_round: 0 }),
      ),
    ).toBe(false);
    expect(inbox.cards().map((card) => card.status.kind)).toEqual([
      "actionable",
    ]);
  });

  it("sets parked from the turn record and clears it after a restart reclaim", () => {
    const inbox = pausedInbox();
    expect(inbox.reconcileWithTurn(turnOf({ status: "parked" }))).toBe(true);
    expect(inbox.cards()[0]?.parked).toBe(true);
    expect(inbox.reconcileWithTurn(turnOf({ status: "awaiting_input" }))).toBe(
      true,
    );
    expect(inbox.cards()[0]?.parked).toBe(false);
  });

  it("removes everything but an in-flight submit once the turn settles", () => {
    const inbox = pausedInbox();
    inbox.noteApprovalRequested(payloadOf({ interrupt_id: "mid-submit" }));
    inbox.noteApprovalRequested(payloadOf({ interrupt_id: "answered-ask" }));
    inbox.beginSubmit("mid-submit");
    inbox.beginSubmit("answered-ask");
    inbox.settleSubmitAnswered("answered-ask", true);
    expect(inbox.reconcileWithTurn(turnOf({ status: "superseded" }))).toBe(
      true,
    );
    expect(inbox.cards().map((card) => card.interruptId)).toEqual([
      "mid-submit",
    ]);
  });

  it("never stales a submitting card by membership — the POST settles itself", () => {
    const inbox = pausedInbox();
    inbox.beginSubmit(payloadOf().interrupt_id);
    expect(inbox.reconcileWithTurn(turnOf({ pending_interrupt_ids: [] }))).toBe(
      false,
    );
    expect(inbox.cards()[0]?.status).toEqual({ kind: "submitting" });
  });

  it("never resurrects an answered or stale card", () => {
    const inbox = pausedInbox();
    inbox.noteApprovalResolved(payloadOf().interrupt_id, true);
    expect(inbox.reconcileWithTurn(turnOf())).toBe(false);
    expect(inbox.cards()[0]?.status).toEqual({
      kind: "answered",
      approved: true,
      trusted: false,
    });
  });

  it("does nothing without a turn record", () => {
    const inbox = pausedInbox();
    expect(inbox.reconcileWithTurn(null)).toBe(false);
    expect(inbox.cards()).toHaveLength(1);
  });
});

describe("hydratePendingApprovals — the REST recovery path", () => {
  it("builds an actionable card into an empty inbox from the turn snapshot", () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    const turn = turnOf({ pending_approvals: [payloadOf()] });
    expect(inbox.hydratePendingApprovals(turn)).toBe(true);
    const [card] = inbox.cards();
    expect(card.status).toEqual({ kind: "actionable", errorSentence: null });
    expect(card.runId).toBe(RUN_ID);
    expect(card.prompt).toBe(payloadOf().prompt);
    expect(card.toolArgs).toEqual(payloadOf().tool_args);
    expect(card.gated).toBe(false);
    // No stream delivered a TOOL_CALL_START, so the recovered card is an
    // orphan — rendered in the composer block, visible and actionable.
    expect(card.anchored).toBe(false);
  });

  it("is idempotent — a second identical hydrate reports no change", () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    const turn = turnOf({ pending_approvals: [payloadOf()] });
    expect(inbox.hydratePendingApprovals(turn)).toBe(true);
    expect(inbox.hydratePendingApprovals(turn)).toBe(false);
    expect(inbox.cards()).toHaveLength(1);
  });

  it("a later stream replay dedupes into the hydrated card by interrupt id", () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    inbox.hydratePendingApprovals(turnOf({ pending_approvals: [payloadOf()] }));
    inbox.noteRunStarted(RUN_ID);
    inbox.noteToolCallStart(TOOL_CALL_ID);
    inbox.noteApprovalRequested(payloadOf());
    const [card] = inbox.cards();
    expect(inbox.cards()).toHaveLength(1);
    // The replay re-stamped the stream coordinates: the tool call is now
    // seen, so the card anchors to its row.
    expect(card.anchored).toBe(true);
    expect(card.status.kind).toBe("actionable");
  });

  it("never duplicates or resurrects a card the stream already settled", () => {
    const inbox = pausedInbox();
    inbox.noteApprovalResolved(payloadOf().interrupt_id, true);
    expect(
      inbox.hydratePendingApprovals(
        turnOf({ pending_approvals: [payloadOf()] }),
      ),
    ).toBe(false);
    expect(inbox.cards()).toHaveLength(1);
    expect(inbox.cards()[0]?.status.kind).toBe("answered");
  });

  it("hydrates a parked turn actionable; reconcile stamps the parked label from the record", () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    const turn = turnOf({
      status: "parked",
      pending_approvals: [payloadOf()],
    });
    expect(inbox.hydratePendingApprovals(turn)).toBe(true);
    expect(inbox.reconcileWithTurn(turn)).toBe(true);
    const [card] = inbox.cards();
    expect(card.parked).toBe(true);
    expect(card.status.kind).toBe("actionable");
  });

  it("a hydrated card the id set no longer holds goes visibly stale, never vanishes", () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    const turn = turnOf({
      pending_interrupt_ids: ["a-different-ask"],
      pending_approvals: [payloadOf()],
    });
    expect(inbox.hydratePendingApprovals(turn)).toBe(true);
    expect(inbox.reconcileWithTurn(turn)).toBe(true);
    expect(inbox.cards()).toHaveLength(1);
    expect(inbox.cards()[0]?.status).toEqual({ kind: "stale" });
  });

  it("skips snapshot rounds below the run's newest — history must not resurrect", () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    inbox.noteRunStarted(RUN_ID);
    inbox.noteApprovalRequested(
      payloadOf({ interrupt_id: "round-1-ask", round: 1 }),
    );
    expect(
      inbox.hydratePendingApprovals(
        turnOf({ pending_approvals: [payloadOf({ round: 0 })] }),
      ),
    ).toBe(false);
    expect(inbox.cards().map((card) => card.interruptId)).toEqual([
      "round-1-ask",
    ]);
  });

  it("never hydrates a settled or working turn, a lost capture, or an absent snapshot", () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    expect(inbox.hydratePendingApprovals(null)).toBe(false);
    expect(
      inbox.hydratePendingApprovals(
        turnOf({ status: "working", pending_approvals: [payloadOf()] }),
      ),
    ).toBe(false);
    expect(
      inbox.hydratePendingApprovals(
        turnOf({ run_id: null, pending_approvals: [payloadOf()] }),
      ),
    ).toBe(false);
    // A server predating the field sends no array at all — old wire,
    // never an empty pause.
    const legacyTurn = turnOf();
    (legacyTurn as unknown as Record<string, unknown>).pending_approvals =
      undefined;
    expect(inbox.hydratePendingApprovals(legacyTurn)).toBe(false);
    expect(inbox.cards()).toHaveLength(0);
  });

  it("never resurrects a card the stream's tool result already closed", () => {
    // The race: a fire-and-forget REST read fired while the pause was
    // live resolves AFTER the stream delivered the gated call's result —
    // its record still says awaiting_input and still names the id.
    // Rebuilding the card would put live Approve/Deny on an ask that
    // already executed.
    const inbox = pausedInbox();
    inbox.noteApprovalResolved(payloadOf().interrupt_id, true);
    expect(inbox.noteToolCallResult(TOOL_CALL_ID)).toBe(true);
    expect(inbox.cards()).toHaveLength(0);

    expect(
      inbox.hydratePendingApprovals(
        turnOf({ pending_approvals: [payloadOf()] }),
      ),
    ).toBe(false);
    expect(inbox.cards()).toHaveLength(0);
  });

  it("a stale read that still shows the pause rebuilds nothing under a run already known settled — the card was never held, so no id was spent", () => {
    // ENTERED: the stream never delivered the marker (nothing held, no id
    // closed); the settled word landed; then an out-of-order REST
    // response still shows the turn paused with the ask in its snapshot.
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    expect(
      inbox.reconcileWithTurns([{ run_id: RUN_ID, status: "succeeded" }]),
    ).toBe(false);
    reconcileApprovalsWithTurns(inbox, [
      turnOf({ pending_approvals: [payloadOf()] }),
    ]);
    expect(inbox.cards()).toEqual([]);
    // The stale read spent the id: a second one changes nothing.
    expect(
      inbox.hydratePendingApprovals(
        turnOf({ pending_approvals: [payloadOf()] }),
      ),
    ).toBe(false);
    expect(inbox.cards()).toEqual([]);
  });

  it("never resurrects a card the settled-runs arm already closed", () => {
    const inbox = pausedInbox();
    expect(
      inbox.reconcileWithTurns([{ run_id: RUN_ID, status: "succeeded" }]),
    ).toBe(true);

    expect(
      inbox.hydratePendingApprovals(
        turnOf({ pending_approvals: [payloadOf()] }),
      ),
    ).toBe(false);
    expect(inbox.cards()).toHaveLength(0);
  });

  it("never resurrects a card the settled turn record already closed", () => {
    const inbox = pausedInbox();
    expect(inbox.reconcileWithTurn(turnOf({ status: "succeeded" }))).toBe(true);

    expect(
      inbox.hydratePendingApprovals(
        turnOf({ pending_approvals: [payloadOf()] }),
      ),
    ).toBe(false);
    expect(inbox.cards()).toHaveLength(0);
  });

  it("skips malformed snapshot entries and hydrates the rest", () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    const promptless = { interrupt_id: "no-prompt", round: 0 };
    const turn = turnOf({
      pending_approvals: [
        promptless as unknown as ApprovalRequestedPayload,
        payloadOf(),
      ],
    });
    expect(inbox.hydratePendingApprovals(turn)).toBe(true);
    expect(inbox.cards().map((card) => card.interruptId)).toEqual([
      payloadOf().interrupt_id,
    ]);
  });
});

describe("capabilities — every stamped flag is a host opt-in", () => {
  it("a default inbox stamps anchored, gated and trustAvailable false even when the stream and the wire say otherwise", () => {
    const inbox = new ApprovalInbox();
    inbox.noteRunStarted(RUN_ID);
    inbox.noteToolCallStart(TOOL_CALL_ID);
    expect(
      inbox.noteApprovalRequested(
        payloadOf({ gated: true, trust_available: true }),
      ),
    ).toBe(true);
    expect(inbox.cards()).toEqual([
      expect.objectContaining({
        toolCallId: TOOL_CALL_ID,
        anchored: false,
        gated: false,
        trustAvailable: false,
        status: { kind: "actionable", errorSentence: null },
      }),
    ]);
    // A replayed marker re-stamps coordinates under the same gate: the
    // flat-block host never grows an anchor it did not ask for.
    expect(
      inbox.noteApprovalRequested(
        payloadOf({ gated: true, trust_available: true }),
      ),
    ).toBe(false);
    expect(inbox.cards()[0]?.anchored).toBe(false);
  });

  it("each capability stamps only its own flag", () => {
    const flagged = payloadOf({ gated: true, trust_available: true });
    const stamped = (
      capabilities: ConstructorParameters<typeof ApprovalInbox>[0],
    ) => {
      const inbox = new ApprovalInbox(capabilities);
      inbox.noteRunStarted(RUN_ID);
      inbox.noteToolCallStart(TOOL_CALL_ID);
      inbox.noteApprovalRequested(flagged);
      const [card] = inbox.cards();
      return {
        anchored: card.anchored,
        gated: card.gated,
        trustAvailable: card.trustAvailable,
      };
    };
    expect(stamped({ anchoring: true })).toEqual({
      anchored: true,
      gated: false,
      trustAvailable: false,
    });
    expect(stamped({ gate: true })).toEqual({
      anchored: false,
      gated: true,
      trustAvailable: false,
    });
    expect(stamped({ trust: true })).toEqual({
      anchored: false,
      gated: false,
      trustAvailable: true,
    });
  });

  it("the turn-record arm takes a record with every pause field absent — no judgement, no throw", () => {
    const inbox = new ApprovalInbox();
    inbox.noteRunStarted(RUN_ID);
    inbox.noteApprovalRequested(payloadOf());
    // An older or partial door: status and run only. Neither arm reads
    // a field that is not there, and neither invents an empty set.
    const bare: ApprovalTurnRecord = {
      status: "awaiting_input",
      run_id: RUN_ID,
    };
    expect(inbox.hydratePendingApprovals(bare)).toBe(false);
    expect(inbox.reconcileWithTurn(bare)).toBe(false);
    expect(inbox.cards()[0]?.status.kind).toBe("actionable");
    // The record still speaks where it can: a parked status stamps the
    // flag, a terminal status closes the card.
    expect(inbox.reconcileWithTurn({ status: "parked", run_id: RUN_ID })).toBe(
      true,
    );
    expect(inbox.cards()[0]?.parked).toBe(true);
    expect(
      inbox.reconcileWithTurn({ status: "succeeded", run_id: RUN_ID }),
    ).toBe(true);
    expect(inbox.cards()).toEqual([]);
  });

  it("the dashboard's internal turn shape (optional pause fields) hydrates and reconciles like the serving one", () => {
    const inbox = new ApprovalInbox();
    const internalTurn: ApprovalTurnRecord = {
      status: "awaiting_input",
      run_id: RUN_ID,
      pending_interrupt_ids: [payloadOf().interrupt_id],
      awaiting_round: 0,
      pending_approvals: [payloadOf()],
    };
    expect(inbox.hydratePendingApprovals(internalTurn)).toBe(true);
    expect(inbox.cards()).toEqual([
      expect.objectContaining({
        interruptId: payloadOf().interrupt_id,
        runId: RUN_ID,
        anchored: false,
        status: { kind: "actionable", errorSentence: null },
      }),
    ]);
    expect(
      inbox.reconcileWithTurn({ ...internalTurn, pending_interrupt_ids: [] }),
    ).toBe(true);
    expect(inbox.cards()[0]?.status).toEqual({ kind: "stale" });
  });
});

// --- a coworker's card -------------------------------------------------------

const DISPATCHING_TURN = "turn-dispatching";
const DISPATCHING_RUN = "run-dispatching";
const COWORKER_INTERRUPT = "v1:before_tool_call:cw-cancel:gate-hash";

function coworkerApprovalOf(
  overrides: Partial<{
    ordinal: number;
    label: string;
    parked: boolean;
    card: Partial<ApprovalRequestedPayload>;
  }> = {},
) {
  return {
    ordinal: overrides.ordinal ?? 3,
    label: overrides.label ?? "Cancel subscription 41.",
    child_session_id: "subagent-thread-3",
    round: 7,
    expires_at: "2026-09-16T00:05:00Z",
    parked: overrides.parked ?? false,
    card: payloadOf({
      interrupt_id: COWORKER_INTERRUPT,
      tool_name: "action__cancel",
      tool_call_id: "cw-run-a1-t1",
      prompt: 'A coworker wants to use "Cancel subscription".',
      round: 7,
      gated: true,
      ...overrides.card,
    }),
  };
}

function dispatchingTurnOf(
  approvals: ReturnType<typeof coworkerApprovalOf>[],
  overrides: Partial<ServingAssistantTurn> = {},
): ServingAssistantTurn {
  return turnOf({
    id: DISPATCHING_TURN,
    status: "succeeded",
    run_id: DISPATCHING_RUN,
    pending_interrupt_ids: [],
    awaiting_round: null,
    pending_approvals: [],
    pending_coworker_approvals: approvals,
    ...overrides,
  });
}

function coworkerCardOf(inbox: ApprovalInbox) {
  const card = inbox.cards().find((c) => c.interruptId === COWORKER_INTERRUPT);
  if (card === undefined) {
    throw new Error("no coworker card held");
  }
  return card;
}

describe("adoptCoworkerApprovals — a coworker's card from the dispatching turn's snapshot", () => {
  it("a fresh inbox fed only the snapshot holds an actionable card that names the coworker and its dispatching turn (the reload path)", () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    expect(
      inbox.adoptCoworkerApprovals([dispatchingTurnOf([coworkerApprovalOf()])]),
    ).toBe(true);
    const card = coworkerCardOf(inbox);
    expect(card.asker).toEqual({
      kind: "coworker",
      ordinal: 3,
      label: "Cancel subscription 41.",
    });
    expect(card.turnId).toBe(DISPATCHING_TURN);
    expect(card.runId).toBe(DISPATCHING_RUN);
    expect(card.round).toBe(7);
    expect(card.parked).toBe(false);
    expect(card.gated).toBe(true);
    expect(card.anchored).toBe(false);
    expect(card.status).toEqual({ kind: "actionable", errorSentence: null });
  });

  it("re-reading the same snapshot changes nothing; a turn with no id lists nothing", () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    const turn = dispatchingTurnOf([coworkerApprovalOf()]);
    inbox.adoptCoworkerApprovals([turn]);
    expect(inbox.adoptCoworkerApprovals([turn])).toBe(false);
    expect(inbox.cards()).toHaveLength(1);
    const bare = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    const { id: droppedId, ...withoutId } = dispatchingTurnOf([
      coworkerApprovalOf(),
    ]);
    expect(droppedId).toBe(DISPATCHING_TURN);
    expect(
      bare.adoptCoworkerApprovals([withoutId as unknown as ApprovalTurnRecord]),
    ).toBe(false);
    expect(bare.cards()).toEqual([]);
  });

  it("carries the wire's trust flag under the trust capability, like the assistant's card", () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    inbox.adoptCoworkerApprovals([
      dispatchingTurnOf([
        coworkerApprovalOf({ card: { gated: false, trust_available: true } }),
      ]),
    ]);
    expect(coworkerCardOf(inbox).trustAvailable).toBe(true);
    expect(coworkerCardOf(inbox).gated).toBe(false);
  });

  it("reads trustAvailable false without the trust capability, and gated stays the wire's under the gate capability", () => {
    const capabilityless = new ApprovalInbox({ anchoring: true, gate: true });
    capabilityless.adoptCoworkerApprovals([
      dispatchingTurnOf([
        coworkerApprovalOf({ card: { gated: false, trust_available: true } }),
      ]),
    ]);
    expect(coworkerCardOf(capabilityless).trustAvailable).toBe(false);
    const gated = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    gated.adoptCoworkerApprovals([
      dispatchingTurnOf([
        coworkerApprovalOf({ card: { gated: true, trust_available: true } }),
      ]),
    ]);
    expect(coworkerCardOf(gated).gated).toBe(true);
    expect(coworkerCardOf(gated).trustAvailable).toBe(true);
  });

  it("parked is the COWORKER's, read off the snapshot and re-read on every adoption — never the parent turn's", () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    inbox.adoptCoworkerApprovals([
      dispatchingTurnOf([coworkerApprovalOf({ parked: true })]),
    ]);
    expect(coworkerCardOf(inbox).parked).toBe(true);
    // The parent turn is working, not parked: the card keeps the
    // coworker's own flag — a parked coworker under an unparked parent is
    // one coherent state, not a contradiction.
    expect(
      inbox.reconcileWithTurn(turnOf({ id: "turn-2", status: "working" })),
    ).toBe(false);
    expect(coworkerCardOf(inbox).parked).toBe(true);
    // The parent's quiet close says nothing about the coworker either.
    const unparked = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    unparked.adoptCoworkerApprovals([
      dispatchingTurnOf([coworkerApprovalOf()]),
    ]);
    expect(unparked.noteStreamClosedWithoutTerminal()).toBe(false);
    expect(coworkerCardOf(unparked).parked).toBe(false);
    expect(unparked.reconcileWithTurn(turnOf({ status: "parked" }))).toBe(
      false,
    );
    expect(coworkerCardOf(unparked).parked).toBe(false);
    // A later read that parks the coworker moves the card.
    expect(
      unparked.adoptCoworkerApprovals([
        dispatchingTurnOf([coworkerApprovalOf({ parked: true })]),
      ]),
    ).toBe(true);
    expect(coworkerCardOf(unparked).parked).toBe(true);
  });

  it("a snapshot that no longer lists the card removes it, and a later read may re-adopt it (delisting is not remembered)", () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    inbox.adoptCoworkerApprovals([dispatchingTurnOf([coworkerApprovalOf()])]);
    expect(inbox.adoptCoworkerApprovals([dispatchingTurnOf([])])).toBe(true);
    expect(inbox.cards()).toEqual([]);
    expect(
      inbox.adoptCoworkerApprovals([dispatchingTurnOf([coworkerApprovalOf()])]),
    ).toBe(true);
    expect(coworkerCardOf(inbox).status.kind).toBe("actionable");
    // An empty window (no turns read) judges nothing.
    expect(inbox.adoptCoworkerApprovals([])).toBe(false);
    expect(inbox.cards()).toHaveLength(1);
  });

  it("is exempt from every parent-turn judgement: a settled newest turn, its membership set and its round leave the card alone", () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    inbox.adoptCoworkerApprovals([dispatchingTurnOf([coworkerApprovalOf()])]);
    expect(inbox.reconcileWithTurn(turnOf({ status: "succeeded" }))).toBe(
      false,
    );
    expect(
      inbox.reconcileWithTurn(
        turnOf({
          status: "awaiting_input",
          run_id: DISPATCHING_RUN,
          pending_interrupt_ids: [],
          awaiting_round: 0,
        }),
      ),
    ).toBe(false);
    expect(coworkerCardOf(inbox).status.kind).toBe("actionable");
  });

  it("the parent stream's run lifecycle is never closing evidence for it: the dispatching turn's settled word and RUN_ERROR remove only the assistant's cards", () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    inbox.adoptCoworkerApprovals([dispatchingTurnOf([coworkerApprovalOf()])]);
    // The assistant's own card under the SAME run id — the synthesized
    // re-entry of the dispatching run's segment is exactly this shape.
    inbox.noteRunStarted(DISPATCHING_RUN);
    inbox.noteApprovalRequested(payloadOf({ round: 0 }));
    expect(inbox.cards()).toHaveLength(2);
    expect(inbox.noteRunFinished()).toBe(false);
    expect(inbox.cards()).toHaveLength(2);
    expect(
      inbox.reconcileWithTurns([
        { run_id: DISPATCHING_RUN, status: "succeeded" },
      ]),
    ).toBe(true);
    expect(inbox.cards().map((c) => c.interruptId)).toEqual([
      COWORKER_INTERRUPT,
    ]);
    // The RUN_ERROR arm on an inbox that never heard the dispatching
    // run settle (a marker under a remembered settled run opens nothing).
    const errored = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    errored.adoptCoworkerApprovals([dispatchingTurnOf([coworkerApprovalOf()])]);
    errored.noteRunStarted(DISPATCHING_RUN);
    expect(
      errored.noteApprovalRequested(
        payloadOf({ interrupt_id: "own-2", round: 1 }),
      ),
    ).toBe(true);
    expect(errored.noteRunError()).toBe(true);
    expect(errored.cards().map((c) => c.interruptId)).toEqual([
      COWORKER_INTERRUPT,
    ]);
  });

  it("round arbitration is the assistant's alone: the coworker's higher round neither hides the assistant's marker nor is superseded by it", () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    inbox.adoptCoworkerApprovals([dispatchingTurnOf([coworkerApprovalOf()])]);
    inbox.noteRunStarted(DISPATCHING_RUN);
    // Round 0 < the coworker's 7: an asker-blind newest-round read would
    // discard this marker as history.
    expect(inbox.noteApprovalRequested(payloadOf({ round: 0 }))).toBe(true);
    // Round 1 supersedes the assistant's round 0, never the coworker's 7.
    expect(
      inbox.noteApprovalRequested(
        payloadOf({ interrupt_id: "own-2", round: 1 }),
      ),
    ).toBe(true);
    expect(inbox.cards().map((c) => c.interruptId)).toEqual([
      COWORKER_INTERRUPT,
      "own-2",
    ]);
    // A replayed marker for the coworker's id re-stamps nothing.
    expect(
      inbox.noteApprovalRequested(
        payloadOf({ interrupt_id: COWORKER_INTERRUPT, round: 0 }),
      ),
    ).toBe(false);
    expect(coworkerCardOf(inbox).round).toBe(7);
    expect(coworkerCardOf(inbox).runId).toBe(DISPATCHING_RUN);
  });

  it("the REST rebuild's round guard is asker-aware too: a coworker's higher round never makes the turn's own lower-round card 'history'", () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    inbox.adoptCoworkerApprovals([
      dispatchingTurnOf([coworkerApprovalOf({ card: { round: 7 } })]),
    ]);
    // The turn's own pause, round 0, under the dispatching run's id — the
    // shape a settled dispatching turn that pauses again would take.
    expect(
      inbox.hydratePendingApprovals(
        turnOf({
          id: DISPATCHING_TURN,
          run_id: DISPATCHING_RUN,
          status: "awaiting_input",
          pending_approvals: [payloadOf({ round: 0 })],
        }),
      ),
    ).toBe(true);
    expect(inbox.cards().map((c) => c.interruptId)).toEqual([
      COWORKER_INTERRUPT,
      payloadOf().interrupt_id,
    ]);
  });

  it("the assistant's supersede never removes a coworker card whose round is LOWER than the superseding round", () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    inbox.adoptCoworkerApprovals([
      dispatchingTurnOf([coworkerApprovalOf({ card: { round: 0 } })]),
    ]);
    inbox.noteRunStarted(DISPATCHING_RUN);
    inbox.noteApprovalRequested(payloadOf({ round: 0 }));
    // Round 1 supersedes the assistant's round 0 under this run; the
    // coworker's round-0 card shares the run id by construction and must
    // survive — its round is the child's, not this run's.
    inbox.noteApprovalRequested(payloadOf({ interrupt_id: "own-2", round: 1 }));
    expect(inbox.cards().map((c) => c.interruptId)).toEqual([
      COWORKER_INTERRUPT,
      "own-2",
    ]);
    expect(coworkerCardOf(inbox).round).toBe(0);
  });

  it("a 409 stales that card alone; the send stales every coworker card and no assistant card; the turn's 409 spares coworker cards", () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    inbox.adoptCoworkerApprovals([
      dispatchingTurnOf([
        coworkerApprovalOf(),
        coworkerApprovalOf({
          ordinal: 4,
          card: { interrupt_id: "cw-4", tool_name: "action__refund" },
        }),
      ]),
    ]);
    inbox.noteRunStarted(RUN_ID);
    inbox.noteApprovalRequested(payloadOf());
    expect(inbox.markCoworkerCardStale(COWORKER_INTERRUPT)).toBe(true);
    expect(inbox.statusOf(COWORKER_INTERRUPT)).toBe("stale");
    expect(inbox.statusOf("cw-4")).toBe("actionable");
    expect(inbox.statusOf(payloadOf().interrupt_id)).toBe("actionable");
    expect(inbox.markPauseStale()).toBe(true);
    expect(inbox.statusOf("cw-4")).toBe("actionable");
    expect(inbox.statusOf(payloadOf().interrupt_id)).toBe("stale");
    expect(inbox.markCoworkerCardsStale()).toBe(true);
    expect(inbox.statusOf("cw-4")).toBe("stale");
    expect(inbox.markCoworkerCardsStale()).toBe(false);
  });

  it("submits like any card: beginSubmit → settleSubmitAnswered, and the delist after the resume closes it", () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    inbox.adoptCoworkerApprovals([dispatchingTurnOf([coworkerApprovalOf()])]);
    expect(inbox.beginSubmit(COWORKER_INTERRUPT)).toBe(true);
    expect(inbox.settleSubmitAnswered(COWORKER_INTERRUPT, true)).toBe(true);
    expect(coworkerCardOf(inbox).status).toEqual({
      kind: "answered",
      approved: true,
      trusted: false,
    });
    // Still listed while the row is paused: the answered note stays.
    expect(
      inbox.adoptCoworkerApprovals([dispatchingTurnOf([coworkerApprovalOf()])]),
    ).toBe(false);
    expect(inbox.adoptCoworkerApprovals([dispatchingTurnOf([])])).toBe(true);
    expect(inbox.cards()).toEqual([]);
  });

  it("reconcileApprovalsWithTurns adopts from every turn in the window while hydrating the turn's own pause", () => {
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    const changed = reconcileApprovalsWithTurns(inbox, [
      dispatchingTurnOf([coworkerApprovalOf()]),
      turnOf({
        id: "turn-2",
        run_id: "run-2",
        status: "awaiting_input",
        pending_approvals: [payloadOf()],
      }),
    ]);
    expect(changed).toBe(true);
    expect(
      inbox.cards().map((card) => [card.interruptId, card.asker.kind]),
    ).toEqual([
      [payloadOf().interrupt_id, "assistant"],
      [COWORKER_INTERRUPT, "coworker"],
    ]);
  });
});

describe("coworkerApprovalRequestOf", () => {
  it("narrows the snapshot item and rejects a malformed one", () => {
    const item = coworkerApprovalOf({ parked: true });
    expect(coworkerApprovalRequestOf(item)).toEqual({
      ordinal: 3,
      label: "Cancel subscription 41.",
      childSessionId: "subagent-thread-3",
      parked: true,
      card: item.card,
    });
    expect(coworkerApprovalRequestOf(null)).toBeNull();
    expect(coworkerApprovalRequestOf({ ...item, ordinal: "3" })).toBeNull();
    expect(
      coworkerApprovalRequestOf({ ...item, card: { prompt: 1 } }),
    ).toBeNull();
    // parked absent on an older wire reads false, never a parked coworker.
    const { parked: planted, ...older } = item;
    expect(planted).toBe(true);
    expect(coworkerApprovalRequestOf(older)?.parked).toBe(false);
  });
});
