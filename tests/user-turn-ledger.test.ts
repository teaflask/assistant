// The ledger's attachment side table: turns carry their attachments into
// the map keyed by the injected user message's stable id, and the version
// counter moves only when a new turn lands — the store's dirty check.

import { describe, expect, it } from "vitest";

import type { ServingAssistantTurn } from "../src/contract/threads";
import { UserTurnLedger, userMessageIdFor } from "../src/core/user-turn-ledger";

function turnOf(
  overrides: Partial<ServingAssistantTurn>,
): ServingAssistantTurn {
  return {
    id: "t1",
    thread_id: "th1",
    user_message: "hello",
    kind: null,
    attachments: [],
    status: "succeeded",
    error: null,
    run_id: "run-1",
    pending_interrupt_ids: [],
    awaiting_round: null,
    pending_approvals: [],
    created_at: "2026-08-16T00:00:00Z",
    updated_at: "2026-08-16T00:00:00Z",
    ...overrides,
  };
}

const AN_IMAGE = {
  id: "att-1",
  kind: "image" as const,
  format: "png",
  filename: "cat.png",
  byte_size: 72,
};

describe("the ledger's turn-meta side table", () => {
  it("keys each turn's attachments and created_at by its injected message id", () => {
    const ledger = new UserTurnLedger([
      turnOf({ id: "t1", attachments: [AN_IMAGE] }),
      turnOf({ id: "t2", run_id: "run-2" }),
    ]);
    const map = ledger.metaByMessageId();
    expect(map.get(userMessageIdFor("t1"))).toEqual({
      attachments: [AN_IMAGE],
      createdAt: "2026-08-16T00:00:00Z",
    });
    // Attachment-less turns still carry their stamp: the timestamp is
    // every bubble's fact, not the attachments'.
    expect(map.get(userMessageIdFor("t2"))?.attachments).toEqual([]);
    expect(map.get(userMessageIdFor("t2"))?.createdAt).toBe(
      "2026-08-16T00:00:00Z",
    );
  });

  it("createdAt is write-once: a re-record updates only the late run id", () => {
    const ledger = new UserTurnLedger([turnOf({ id: "t1" })]);
    ledger.record(
      turnOf({
        id: "t1",
        run_id: "run-1b",
        created_at: "2027-01-01T00:00:00Z",
      }),
    );
    expect(
      ledger.metaByMessageId().get(userMessageIdFor("t1"))?.createdAt,
    ).toBe("2026-08-16T00:00:00Z");
    expect(ledger.newestTurn()?.runId).toBe("run-1b");
  });

  it("moves the version only when a new turn lands", () => {
    const ledger = new UserTurnLedger([turnOf({ id: "t1" })]);
    const before = ledger.version;
    // A re-record of a known turn (the late run-id capture) is not new.
    ledger.record(turnOf({ id: "t1", run_id: "run-1b" }));
    expect(ledger.version).toBe(before);
    ledger.record(turnOf({ id: "t2", run_id: "run-2" }));
    expect(ledger.version).toBe(before + 1);
  });

  it("tolerates a wire turn without the attachments field", () => {
    const bare = turnOf({ id: "t3" });
    delete (bare as { attachments?: unknown }).attachments;
    const ledger = new UserTurnLedger([bare]);
    expect(ledger.newestTurn()?.attachments).toEqual([]);
  });
});

describe("machine-initiated turns and the additive kind rule", () => {
  it("never offers a delivery turn as the uninjected fallback", () => {
    const ledger = new UserTurnLedger([
      turnOf({ id: "t1", kind: "delivery", user_message: "", run_id: null }),
      turnOf({ id: "t2", run_id: null, user_message: "a real ask" }),
    ]);
    // Neither turn's run id is known, so the fallback walks in order —
    // and must skip the delivery turn or its empty message would splice
    // in front of someone else's run.
    expect(ledger.nextUninjectedTurn([])?.turnId).toBe("t2");
  });

  it("treats an unknown kind like delivery — no bubble, per the contract", () => {
    const ledger = new UserTurnLedger([
      turnOf({
        id: "t1",
        // The wire may carry kinds newer than this bundle's generated
        // union — the widening below is exactly the situation the
        // contract's additive rule exists for.
        kind: "escalation" as unknown as ServingAssistantTurn["kind"],
        user_message: "",
        run_id: null,
      }),
    ]);
    // The contract's additive vocabulary rule: any non-null kind is a
    // machine-initiated turn, so it is never the uninjected fallback.
    expect(ledger.nextUninjectedTurn([])).toBeNull();
  });
});
