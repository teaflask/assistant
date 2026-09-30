/**
 * REST recovery of pending approvals over the ApprovalTurnRecord seam:
 * reconcileApprovalsWithTurns — hydrate from the answerable pause,
 * reconcile with the newest row. The cases are posed over the lenient
 * record shape (every pause field optional — the dashboard's internal
 * turn carries them optional-by-default), so both doors' turns satisfy
 * the seam structurally. The two properties likeliest to be lost in a
 * merge stay pinned: a stale REST read can never rebuild live controls
 * for an ask the stream already closed (the closed-interrupt ledger),
 * and a remount — a fresh recorder over the SAME inbox — can never
 * resurrect an answered decision.
 */
import { describe, expect, it } from "vitest";

import {
  answerablePauseOf,
  ApprovalInbox,
  reconcileApprovalsWithTurns,
  type ApprovalTurnRecord,
} from "../src/core/approval-inbox";

const RUN_ID = "run-1";
const TOOL_CALL_ID = "run-1-a1-t1";
const INTERRUPT_ID = "v1:before_tool_call:t1:handler";

// The record seam plus the id the pause assertions name — structural, the
// way both doors' generated turn types satisfy it.
interface RecordTurn extends ApprovalTurnRecord {
  id: string;
}

function markerOf(overrides: Record<string, unknown> = {}) {
  return {
    interrupt_id: INTERRUPT_ID,
    tool_name: "action__send-email",
    tool_args: { to: "casey@brightloom.example" },
    tool_input_schema: null,
    tool_output_schema: null,
    prompt: "Send this email?",
    tool_call_id: TOOL_CALL_ID,
    round: 0,
    gated: false,
    trust_available: false,
    ...overrides,
  };
}

function turnOf(overrides: Partial<RecordTurn> = {}): RecordTurn {
  return {
    id: "turn-1",
    status: "awaiting_input",
    run_id: RUN_ID,
    pending_interrupt_ids: [INTERRUPT_ID],
    awaiting_round: 0,
    pending_approvals: [markerOf()],
    ...overrides,
  };
}

// The stream delivered the pause on this connection.
function streamedPause(inbox: ApprovalInbox): void {
  inbox.noteRunStarted(RUN_ID);
  inbox.noteToolCallStart(TOOL_CALL_ID);
  const marker = markerOf();
  inbox.noteApprovalRequested({
    interrupt_id: marker.interrupt_id,
    prompt: marker.prompt,
    tool_name: marker.tool_name,
    tool_args: marker.tool_args,
    tool_input_schema: null,
    tool_output_schema: null,
    tool_call_id: marker.tool_call_id,
    round: 0,
    gated: false,
    trust_available: false,
  });
}

describe("stream-loss recovery from the turn record", () => {
  it("rebuilds the card from REST when the stream never delivered the marker", () => {
    // A killed stream mid-approval — or one that died before the marker
    // — leaves an empty inbox; the settle re-read's record carries the
    // snapshot and the card comes back actionable, stamped with the
    // record's run.
    const inbox = new ApprovalInbox();
    expect(reconcileApprovalsWithTurns(inbox, [turnOf()])).toBe(true);
    expect(inbox.cards()).toEqual([
      expect.objectContaining({
        interruptId: INTERRUPT_ID,
        runId: RUN_ID,
        prompt: "Send this email?",
        toolCallId: TOOL_CALL_ID,
        anchored: false,
        status: { kind: "actionable", errorSentence: null },
      }),
    ]);
    // Idempotent: the next refresh reports no change.
    expect(reconcileApprovalsWithTurns(inbox, [turnOf()])).toBe(false);
  });

  it("hydrates from the answerable pause behind a queued row, and reconciles with the newest row", () => {
    // A queued message sits newer than the pause. Hydrating from the
    // queued row would disable the rebuild exactly when the operator must
    // answer to unblock the queue; reconcile still judges by the newest
    // row, which is not terminal here.
    const paused = turnOf();
    const queued = turnOf({
      id: "turn-2",
      status: "queued",
      run_id: null,
      pending_interrupt_ids: [],
      awaiting_round: null,
      pending_approvals: [],
    });
    expect(answerablePauseOf([paused, queued])).toBe(paused);
    const inbox = new ApprovalInbox();
    expect(reconcileApprovalsWithTurns(inbox, [paused, queued])).toBe(true);
    expect(inbox.cards()[0]?.status.kind).toBe("actionable");
  });

  it("a stale REST read can never rebuild live controls for an ask the stream already closed (the closed-interrupt ledger)", () => {
    // The race: a fire-and-forget refresh fired while the pause was live
    // resolves AFTER the stream delivered the gated call's result — its
    // record still says awaiting_input and still names the id. Rebuilding
    // the card would put live Approve/Deny on an ask that already ran.
    const inbox = new ApprovalInbox();
    streamedPause(inbox);
    inbox.noteApprovalResolved(INTERRUPT_ID, true);
    inbox.noteToolCallResult(TOOL_CALL_ID);
    expect(inbox.cards()).toEqual([]);

    expect(reconcileApprovalsWithTurns(inbox, [turnOf()])).toBe(false);
    expect(inbox.cards()).toEqual([]);
  });

  it("a RUN_FINISHED alone leaves the card held — the read confirms it rather than resurrecting anything; after the settled turn's word the same stale read is refused", () => {
    const inbox = new ApprovalInbox();
    streamedPause(inbox);
    expect(inbox.noteRunFinished()).toBe(false);
    expect(reconcileApprovalsWithTurns(inbox, [turnOf()])).toBe(false);
    expect(inbox.cards()).toEqual([
      expect.objectContaining({ interruptId: INTERRUPT_ID }),
    ]);
    expect(inbox.statusOf(INTERRUPT_ID)).toBe("actionable");
    expect(
      reconcileApprovalsWithTurns(inbox, [turnOf({ status: "succeeded" })]),
    ).toBe(true);
    expect(inbox.cards()).toEqual([]);
    expect(reconcileApprovalsWithTurns(inbox, [turnOf()])).toBe(false);
    expect(inbox.cards()).toEqual([]);
  });

  it("a pause the record no longer holds goes visibly stale — never a silent vanish", () => {
    const inbox = new ApprovalInbox();
    streamedPause(inbox);
    expect(
      reconcileApprovalsWithTurns(inbox, [
        turnOf({ pending_interrupt_ids: ["other-ask"], pending_approvals: [] }),
      ]),
    ).toBe(true);
    expect(inbox.cards()[0]?.status).toEqual({ kind: "stale" });
  });

  it("a settled newest turn closes the cards; a parked one stamps the flag", () => {
    const parkedInbox = new ApprovalInbox();
    streamedPause(parkedInbox);
    expect(
      reconcileApprovalsWithTurns(parkedInbox, [turnOf({ status: "parked" })]),
    ).toBe(true);
    expect(parkedInbox.cards()[0]?.parked).toBe(true);

    const settledInbox = new ApprovalInbox();
    streamedPause(settledInbox);
    expect(
      reconcileApprovalsWithTurns(settledInbox, [
        turnOf({
          status: "succeeded",
          pending_interrupt_ids: [],
          awaiting_round: null,
          pending_approvals: [],
        }),
      ]),
    ).toBe(true);
    expect(settledInbox.cards()).toEqual([]);
  });

  it("an older door's record — no pause fields at all — changes nothing and throws nothing", () => {
    // The pause fields are optional on the seam (an additive wire): a
    // server predating them sends none, and absent must never read as
    // "no pause".
    const inbox = new ApprovalInbox();
    streamedPause(inbox);
    const legacy = turnOf();
    delete legacy.pending_interrupt_ids;
    delete legacy.awaiting_round;
    delete legacy.pending_approvals;
    expect(reconcileApprovalsWithTurns(inbox, [legacy])).toBe(false);
    expect(inbox.cards()[0]?.status.kind).toBe("actionable");
    expect(reconcileApprovalsWithTurns(new ApprovalInbox(), [legacy])).toBe(
      false,
    );
  });

  it("a remount cannot resurrect an answered decision: the replayed marker dedupes into the held card", () => {
    // The inbox is the conversation's; a reconnect (a fresh recorder over
    // the same inbox) replays the pause. The durable status lives here,
    // not in the transcript that remounted.
    const inbox = new ApprovalInbox();
    streamedPause(inbox);
    expect(inbox.beginSubmit(INTERRUPT_ID)).toBe(true);
    expect(inbox.settleSubmitAnswered(INTERRUPT_ID, false)).toBe(true);

    streamedPause(inbox);
    expect(inbox.cards()).toEqual([
      expect.objectContaining({
        interruptId: INTERRUPT_ID,
        status: { kind: "answered", approved: false, trusted: false },
      }),
    ]);
    expect(inbox.beginSubmit(INTERRUPT_ID)).toBe(false);
    // And the record's snapshot, still naming the id, adds nothing.
    expect(reconcileApprovalsWithTurns(inbox, [turnOf()])).toBe(false);
    expect(inbox.cards()).toHaveLength(1);
  });

  it("no cards, no turns: nothing happens", () => {
    const inbox = new ApprovalInbox();
    expect(reconcileApprovalsWithTurns(inbox, [])).toBe(false);
    expect(answerablePauseOf([])).toBeNull();
  });
});
