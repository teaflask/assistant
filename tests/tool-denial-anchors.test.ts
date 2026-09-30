// The durable denial ledger: the narrower's arms, the idempotent fold
// and its identity rules, the defensive seed, the recorder, and the
// resume store round-trip — the pure half of the not-approved state.
// The integration half (the real inbox pruning the card while the
// ledger keeps the state) lives in
// tests/message-list-activity-group.test.tsx.
import { describe, expect, it } from "vitest";

import {
  EMPTY_TOOL_DENIAL_ANCHORS,
  EMPTY_TOOL_DENIAL_LEDGER,
  toolDenialMarkerOf,
  toolDenialRecorder,
  wellFormedToolDenialAnchorsOf,
  withToolDenialMarkerFolded,
  type ToolDenialLedger,
} from "../src/core/tool-denial-anchors";
import { StreamResumeStore } from "../src/transport/stream-resume";

const ASK = { kind: "ask", interruptId: "i1", toolCallId: "t1" } as const;
const DENIED = { kind: "denied", interruptId: "i1" } as const;

describe("toolDenialMarkerOf", () => {
  it("narrows an approval_requested naming a call to an ask", () => {
    expect(
      toolDenialMarkerOf("approval_requested", {
        interrupt_id: "i1",
        prompt: "?",
        tool_call_id: "t1",
      }),
    ).toEqual(ASK);
  });

  it("an unanchored ask marks nothing — there is no row to reclassify", () => {
    expect(
      toolDenialMarkerOf("approval_requested", {
        interrupt_id: "i1",
        tool_call_id: null,
      }),
    ).toBeNull();
    expect(
      toolDenialMarkerOf("approval_requested", {
        interrupt_id: "i1",
        tool_call_id: "",
      }),
    ).toBeNull();
    expect(
      toolDenialMarkerOf("approval_requested", {
        interrupt_id: "",
        tool_call_id: "t1",
      }),
    ).toBeNull();
  });

  it("narrows approval_resolved{approved:false} to a denial and an approval to nothing", () => {
    expect(
      toolDenialMarkerOf("approval_resolved", {
        interrupt_id: "i1",
        approved: false,
        feedback: "Not now.",
        resolved_by: "member:1",
      }),
    ).toEqual(DENIED);
    // An approval is not a marker here: the call then runs, and its own
    // result tells its story.
    expect(
      toolDenialMarkerOf("approval_resolved", {
        interrupt_id: "i1",
        approved: true,
      }),
    ).toBeNull();
  });

  it("ignores other markers and malformed payloads whole", () => {
    expect(
      toolDenialMarkerOf("tool_call_annotated", { tool_call_id: "t1" }),
    ).toBeNull();
    expect(toolDenialMarkerOf("approval_requested", "not-an-object")).toBe(
      null,
    );
    expect(toolDenialMarkerOf("approval_requested", null)).toBeNull();
    expect(
      toolDenialMarkerOf("approval_resolved", {
        interrupt_id: "i1",
        approved: "no",
      }),
    ).toBeNull();
    expect(toolDenialMarkerOf("approval_resolved", { approved: false })).toBe(
      null,
    );
  });
});

describe("withToolDenialMarkerFolded — the fold and its identity rules", () => {
  it("joins a denial to the call its ask named", () => {
    const asked = withToolDenialMarkerFolded(EMPTY_TOOL_DENIAL_LEDGER, ASK);
    const denied = withToolDenialMarkerFolded(asked, DENIED);
    expect([...denied.denied]).toEqual(["t1"]);
    expect(denied.asks.get("i1")).toBe("t1");
  });

  it("is idempotent — a replayed ask or denial returns the identical ledger (identity is the publish gate)", () => {
    const asked = withToolDenialMarkerFolded(EMPTY_TOOL_DENIAL_LEDGER, ASK);
    expect(withToolDenialMarkerFolded(asked, ASK)).toBe(asked);
    const denied = withToolDenialMarkerFolded(asked, DENIED);
    expect(withToolDenialMarkerFolded(denied, DENIED)).toBe(denied);
  });

  it("the untouched half keeps its identity: an ask never moves `denied`, a denial never moves `asks`", () => {
    const asked = withToolDenialMarkerFolded(EMPTY_TOOL_DENIAL_LEDGER, ASK);
    // An ask changes the map, not the set — so a host gating its publish
    // on `denied` identity repaints nothing for an ask.
    expect(asked.denied).toBe(EMPTY_TOOL_DENIAL_LEDGER.denied);
    expect(asked.asks).not.toBe(EMPTY_TOOL_DENIAL_LEDGER.asks);
    const denied = withToolDenialMarkerFolded(asked, DENIED);
    expect(denied.asks).toBe(asked.asks);
    expect(denied.denied).not.toBe(asked.denied);
    // A second, unrelated ask keeps the denied set's identity too.
    const askedAgain = withToolDenialMarkerFolded(denied, {
      kind: "ask",
      interruptId: "i2",
      toolCallId: "t2",
    });
    expect(askedAgain.denied).toBe(denied.denied);
  });

  it("THE RULING: a denial whose ask is unknown is ignored, not queued — order-dependence stated (premise 2)", () => {
    // The log records the ask before its resolution on every path, so
    // this case cannot arise from a well-formed history; when it does
    // (a malformed log), the row degrades to the wire's own cancelled
    // reading rather than the ledger inventing a join.
    const orphan = withToolDenialMarkerFolded(EMPTY_TOOL_DENIAL_LEDGER, DENIED);
    expect(orphan).toBe(EMPTY_TOOL_DENIAL_LEDGER);
    // And a LATER ask does not retroactively deny: the denial was not
    // remembered.
    const askedAfter = withToolDenialMarkerFolded(orphan, ASK);
    expect(askedAfter.denied.size).toBe(0);
  });

  it("the empty anchors constant IS the empty ledger's denied half", () => {
    expect(EMPTY_TOOL_DENIAL_ANCHORS).toBe(EMPTY_TOOL_DENIAL_LEDGER.denied);
    expect(EMPTY_TOOL_DENIAL_ANCHORS.size).toBe(0);
  });
});

describe("wellFormedToolDenialAnchorsOf", () => {
  it("drops non-string members from a stored seed rather than rendering them", () => {
    const dirty = new Set(["t1", 7, null] as unknown as string[]);
    expect([...wellFormedToolDenialAnchorsOf(dirty)]).toEqual(["t1"]);
  });
});

describe("toolDenialRecorder", () => {
  it("records both approval markers from CUSTOM events only, through the narrower", () => {
    const seen: unknown[] = [];
    const recorder = toolDenialRecorder((marker) => {
      seen.push(marker);
    });
    // CUSTOM events only: the recorder has no tool-result arm — the
    // cancelled stamp it reclassifies is tool-cancel-anchors' business.
    expect(Object.keys(recorder)).toEqual(["onCustomEvent"]);
    void recorder.onCustomEvent?.({
      event: {
        name: "approval_requested",
        value: { interrupt_id: "i1", prompt: "?", tool_call_id: "t1" },
      },
    } as never);
    void recorder.onCustomEvent?.({
      event: {
        name: "approval_resolved",
        value: { interrupt_id: "i1", approved: true },
      },
    } as never);
    void recorder.onCustomEvent?.({
      event: {
        name: "approval_resolved",
        value: { interrupt_id: "i1", approved: false },
      },
    } as never);
    void recorder.onCustomEvent?.({
      event: { name: "tool_call_annotated", value: { tool_call_id: "t3" } },
    } as never);
    expect(seen).toEqual([ASK, DENIED]);
  });
});

describe("the resume store's denial ledger", () => {
  it("folds markers in place and keeps identity across a replayed re-delivery", () => {
    const store = new StreamResumeStore();
    expect(store.toolDenialLedger).toBe(EMPTY_TOOL_DENIAL_LEDGER);
    store.recordToolDenialMarker(ASK);
    store.recordToolDenialMarker(DENIED);
    const settled: ToolDenialLedger = store.toolDenialLedger;
    expect([...settled.denied]).toEqual(["t1"]);
    // The reconnect's replay re-delivers both markers — no-ops.
    store.recordToolDenialMarker(ASK);
    store.recordToolDenialMarker(DENIED);
    expect(store.toolDenialLedger).toBe(settled);
  });
});
