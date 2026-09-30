/**
 * The pending-decision gap GATE — the quiet→loud grace window whose
 * transition table is enumerated in the class docblock. These cases
 * arrived with the playground fork's collapse (they pinned the frontend
 * copy before the gate moved here); the widget store's wiring of the same
 * gate is pinned by conversation-store.test.ts's gap describes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GAP_PROBE_SETTLE_MS,
  PendingDecisionGapGate,
  type PendingDecisionGap,
} from "../src/core/pending-decision-gap";

const INTERRUPT_ID = "v1:tool_call:t1:member-answers";

describe("PendingDecisionGapGate — the grace window over the evidence predicate", () => {
  const GAP: PendingDecisionGap = {
    turnId: "turn-1",
    missingInterruptIds: [INTERRUPT_ID],
  };

  let published: (PendingDecisionGap | null)[];
  let probes: number;
  let evidenceSettled: boolean;
  let gate: PendingDecisionGapGate;

  const gateOf = () =>
    new PendingDecisionGapGate({
      publish: (gap) => published.push(gap),
      probe: () => {
        probes += 1;
      },
      evidenceSettled: () => evidenceSettled,
    });

  beforeEach(() => {
    vi.useFakeTimers();
    published = [];
    probes = 0;
    evidenceSettled = false;
    gate = gateOf();
  });

  afterEach(() => {
    gate.dispose();
    vi.useRealTimers();
  });

  it("a gap that survives the window on settled evidence goes loud, with exactly one probe per signature", () => {
    evidenceSettled = true;
    gate.judge(GAP);
    expect(published).toEqual([]);
    expect(probes).toBe(1);
    // Re-judging the same signature mid-window neither re-arms nor
    // re-probes — one read per signature.
    vi.advanceTimersByTime(GAP_PROBE_SETTLE_MS - 1);
    gate.judge(GAP);
    expect(probes).toBe(1);
    expect(published).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(published).toEqual([GAP]);
  });

  it("unsettled evidence holds the alarm as a quiet heartbeat — evidence that settles late alarms within one window", () => {
    // The wall clock alone must never alarm: a replay slower than the
    // window (long transcript, cold worker) is a healthy paused ask until
    // the evidence channel has had its chance.
    gate.judge(GAP);
    vi.advanceTimersByTime(GAP_PROBE_SETTLE_MS * 3);
    expect(published).toEqual([]);
    expect(probes).toBe(1);
    evidenceSettled = true;
    vi.advanceTimersByTime(GAP_PROBE_SETTLE_MS);
    expect(published).toEqual([GAP]);
  });

  it("the slow-evidence case: the card lands after two quiet windows and the alarm never fires", () => {
    gate.judge(GAP);
    vi.advanceTimersByTime(GAP_PROBE_SETTLE_MS * 2);
    // The evidence finally opens the card; the derivation clears BEFORE
    // the evidence settles — the exact false alarm the heartbeat absorbs.
    gate.judge(null);
    evidenceSettled = true;
    vi.advanceTimersByTime(GAP_PROBE_SETTLE_MS * 2);
    expect(published).toEqual([]);
  });

  it("a gap that clears inside the window never publishes — the reconnect false alarm, absorbed", () => {
    evidenceSettled = true;
    gate.judge(GAP);
    vi.advanceTimersByTime(GAP_PROBE_SETTLE_MS - 1);
    gate.judge(null);
    vi.advanceTimersByTime(GAP_PROBE_SETTLE_MS * 2);
    expect(published).toEqual([]);
  });

  it("once loud, tracks the live derivation without a new grace, and clears on null", () => {
    evidenceSettled = true;
    gate.judge(GAP);
    vi.advanceTimersByTime(GAP_PROBE_SETTLE_MS);
    expect(published).toEqual([GAP]);
    const shifted: PendingDecisionGap = {
      turnId: "turn-1",
      missingInterruptIds: [INTERRUPT_ID, "v1:tool_call:t2:member-answers"],
    };
    gate.judge(shifted);
    expect(published).toEqual([GAP, shifted]);
    expect(probes).toBe(1);
    gate.judge(null);
    expect(published).toEqual([GAP, shifted, null]);
  });

  it("once loud, reference churn with the same signature never re-publishes", () => {
    evidenceSettled = true;
    gate.judge(GAP);
    vi.advanceTimersByTime(GAP_PROBE_SETTLE_MS);
    gate.judge({ ...GAP, missingInterruptIds: [...GAP.missingInterruptIds] });
    expect(published).toEqual([GAP]);
  });

  it("a new signature after a cleared one re-arms with its own probe", () => {
    evidenceSettled = true;
    gate.judge(GAP);
    gate.judge(null);
    const other: PendingDecisionGap = {
      turnId: "turn-2",
      missingInterruptIds: ["v1:tool_call:t3:member-answers"],
    };
    gate.judge(other);
    expect(probes).toBe(2);
    vi.advanceTimersByTime(GAP_PROBE_SETTLE_MS);
    expect(published).toEqual([other]);
  });

  it("a successor gate handed the current truth inherits a loud alarm and can retract it", () => {
    // An owner's construction ritual, posed here: the evidence predicate,
    // then the newest derivation, immediately after construction. Without
    // the inherited judge, a recreated gate's judge(null) would take the
    // quiet branch and the published notice could never clear.
    evidenceSettled = true;
    gate.judge(GAP);
    vi.advanceTimersByTime(GAP_PROBE_SETTLE_MS);
    expect(published).toEqual([GAP]);
    gate.dispose();
    const successor = gateOf();
    successor.judge(GAP);
    // The successor re-arms its own grace for the inherited signature (it
    // was never loud itself); the owner's published state is refreshed by
    // the successor's window-elapse publish, and a later clear retracts.
    vi.advanceTimersByTime(GAP_PROBE_SETTLE_MS);
    expect(published).toEqual([GAP, GAP]);
    successor.judge(null);
    expect(published).toEqual([GAP, GAP, null]);
    successor.dispose();
  });

  it("dispose cancels the armed window — nothing publishes after teardown", () => {
    evidenceSettled = true;
    gate.judge(GAP);
    gate.dispose();
    vi.advanceTimersByTime(GAP_PROBE_SETTLE_MS * 2);
    expect(published).toEqual([]);
  });
});
