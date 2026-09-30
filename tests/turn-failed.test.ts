import { describe, expect, it } from "vitest";

import type { AgentSubscriber } from "@ag-ui/client";

import type { ServingAssistantTurn } from "../src/contract/threads";
import { settledResultOf } from "../src/core/activity";
import {
  bannerFailureSentenceOf,
  failureSentenceOf,
} from "../src/core/turn-failure-copy";
import {
  turnFailedMarkerRecorder,
  turnFailedReceiptOf,
  wellFormedFailAnchorsOf,
  withTurnFailedAnchored,
  type AnchoredTurnFailReceipts,
} from "../src/core/turn-failed-anchors";
import { StreamResumeStore } from "../src/transport/stream-resume";

const A_RECEIPT = "Something went wrong while answering. Please try again.";

describe("turnFailedReceiptOf", () => {
  it("accepts the wire payload's sentence verbatim", () => {
    expect(turnFailedReceiptOf({ receipt: A_RECEIPT })).toBe(A_RECEIPT);
  });

  it("rejects malformed payloads instead of throwing", () => {
    expect(turnFailedReceiptOf(null)).toBeNull();
    expect(turnFailedReceiptOf("failed")).toBeNull();
    expect(turnFailedReceiptOf({})).toBeNull();
    expect(turnFailedReceiptOf({ receipt: "" })).toBeNull();
    expect(turnFailedReceiptOf({ receipt: 7 })).toBeNull();
  });

  it("caps a runaway sentence instead of retaining it unbounded", () => {
    expect(turnFailedReceiptOf({ receipt: "n".repeat(50_000) })?.length).toBe(
      2000,
    );
  });
});

describe("withTurnFailedAnchored", () => {
  it("is idempotent under replay: the same receipt anchors once", () => {
    const once = withTurnFailedAnchored(new Map(), "msg-1", "after", [
      A_RECEIPT,
    ]);
    const twice = withTurnFailedAnchored(once, "msg-1", "after", [A_RECEIPT]);
    expect(twice).toBe(once);
    expect(once.get("msg-1")?.after).toEqual([A_RECEIPT]);
  });

  it("anchors a flush that pooled the same receipt twice only once", () => {
    const anchors = withTurnFailedAnchored(new Map(), "msg-1", "after", [
      A_RECEIPT,
      A_RECEIPT,
    ]);
    expect(anchors.get("msg-1")?.after).toEqual([A_RECEIPT]);
  });
});

describe("the recorder's RUN_ERROR flush", () => {
  it("flushes the pending receipt on the failed run's live terminal", () => {
    // A failed run's live ending is RUN_ERROR (only replay demotes it to
    // RUN_FINISHED), so the recorder must flush there or a live failure
    // would anchor nothing until the next reload.
    const anchored: string[][] = [];
    const recorder = turnFailedMarkerRecorder((_run, _msg, _pos, receipts) => {
      anchored.push(receipts);
    }) as Required<
      Pick<
        AgentSubscriber,
        | "onRunInitialized"
        | "onRunStartedEvent"
        | "onCustomEvent"
        | "onMessagesChanged"
        | "onRunErrorEvent"
      >
    >;
    void recorder.onRunInitialized(
      {} as Parameters<typeof recorder.onRunInitialized>[0],
    );
    void recorder.onRunStartedEvent({
      event: { runId: "run-1" },
    } as Parameters<typeof recorder.onRunStartedEvent>[0]);
    void recorder.onMessagesChanged({
      messages: [{ id: "msg-1" }],
    } as unknown as Parameters<typeof recorder.onMessagesChanged>[0]);
    void recorder.onCustomEvent({
      event: { name: "turn_failed", value: { receipt: A_RECEIPT } },
    } as Parameters<typeof recorder.onCustomEvent>[0]);
    expect(anchored).toEqual([]);
    void recorder.onRunErrorEvent(
      {} as Parameters<typeof recorder.onRunErrorEvent>[0],
    );
    expect(anchored).toEqual([[A_RECEIPT]]);
  });
});

describe("the failure's honest rendering", () => {
  it("still earns the failure banner when no receipt is anchored", () => {
    // Old histories (failed before the marker existed) keep the banner.
    const sentence = failureSentenceOf([_turnWith("failed", A_RECEIPT)]);
    expect(sentence).toBe(A_RECEIPT);
    expect(bannerFailureSentenceOf(sentence, new Map())).toBe(A_RECEIPT);
    expect(bannerFailureSentenceOf(sentence, undefined)).toBe(A_RECEIPT);
  });

  it("withholds the banner once the transcript anchors the same sentence", () => {
    // The receipt row IS the record — the banner would double-tell it.
    const anchors = withTurnFailedAnchored(new Map(), "msg-1", "after", [
      A_RECEIPT,
    ]);
    expect(bannerFailureSentenceOf(A_RECEIPT, anchors)).toBeNull();
  });

  it("keeps the banner for a different failure's sentence", () => {
    const anchors = withTurnFailedAnchored(new Map(), "msg-1", "after", [
      "An older failure.",
    ]);
    expect(bannerFailureSentenceOf(A_RECEIPT, anchors)).toBe(A_RECEIPT);
  });

  it("keeps the activity feed's failure sentence", () => {
    const result = settledResultOf(_turnWith("failed", A_RECEIPT));
    expect(result).toEqual({
      turnId: "turn-1",
      status: "failed",
      failureSentence: A_RECEIPT,
    });
  });
});

describe("the resume store's failed-run arbitration", () => {
  it("anchors one receipt row per failed run, wherever re-deliveries flush", () => {
    const store = new StreamResumeStore();
    expect(
      store.recordTurnFailedReceipts("run-1", "msg-1", "after", [A_RECEIPT]),
    ).toBe(true);
    expect(
      store.recordTurnFailedReceipts("run-1", "msg-2", "after", [A_RECEIPT]),
    ).toBe(false);
    expect(store.turnFailedAnchors.has("msg-2")).toBe(false);
    expect(store.turnFailedAnchors.get("msg-1")?.after).toEqual([A_RECEIPT]);
  });
});

describe("wellFormedFailAnchorsOf", () => {
  it("passes well-formed store entries through", () => {
    const store = new StreamResumeStore();
    store.recordTurnFailedReceipts("run-1", "msg-1", "after", [A_RECEIPT]);
    expect(
      wellFormedFailAnchorsOf(store.turnFailedAnchors).get("msg-1"),
    ).toEqual({ before: [], after: [A_RECEIPT] });
  });

  it("drops malformed entries instead of crashing the seed", () => {
    const stale = new Map([
      ["msg-1", { before: [], after: [A_RECEIPT] }],
      ["msg-2", { before: [7, ""], after: undefined }],
    ]) as unknown as ReadonlyMap<string, AnchoredTurnFailReceipts>;
    const seeded = wellFormedFailAnchorsOf(stale);
    expect(seeded.get("msg-1")).toEqual({ before: [], after: [A_RECEIPT] });
    expect(seeded.has("msg-2")).toBe(false);
  });
});

function _turnWith(
  status: ServingAssistantTurn["status"],
  error: string | null = null,
): ServingAssistantTurn {
  return {
    id: "turn-1",
    thread_id: "thread-1",
    user_message: "Tell me everything about oolong.",
    kind: null,
    status,
    error,
    run_id: "run-1",
    pending_interrupt_ids: [],
    awaiting_round: null,
    pending_approvals: [],
    created_at: "2026-08-28T00:00:00Z",
    updated_at: "2026-08-28T00:00:00Z",
  };
}
