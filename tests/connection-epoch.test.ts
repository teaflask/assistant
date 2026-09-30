import { describe, expect, it, vi } from "vitest";

import { ApprovalInbox } from "../src/core/approval-inbox";
import {
  beginConnectionEpoch,
  markerAnchorsOf,
  type ConnectionEpochDeps,
} from "../src/core/connection-epoch";
import { UserTurnLedger } from "../src/core/user-turn-ledger";
import { StreamResumeStore } from "../src/transport/stream-resume";
import type { TokenSession } from "../src/transport/token-session";

function epochDeps(
  overrides: Partial<ConnectionEpochDeps> = {},
): ConnectionEpochDeps {
  return {
    epochId: 1,
    session: {
      authorizedFetch: vi.fn(),
      baseUrl: "https://api.example.test",
    } as unknown as TokenSession,
    threadId: "thread-1",
    streamThreadId: "stream-thread-1",
    ledger: new UserTurnLedger(),
    resume: new StreamResumeStore(),
    approvalInbox: new ApprovalInbox(),
    handlersOf: () => new Map(),
    publishApprovalCards: vi.fn(),
    publishExecutionEntries: vi.fn(),
    publishMarkerAnchors: vi.fn(),
    publishMessages: vi.fn(),
    noteInterruptAnswerConsumed: vi.fn(),
    onStreamError: vi.fn(),
    refreshLedger: vi.fn(() => Promise.resolve()),
    onUserMessageInjected: vi.fn(),
    onRunSettled: vi.fn(),
    onQuietClose: vi.fn(),
    onWorkflowRestarted: vi.fn(),
    ...overrides,
  };
}

describe("beginConnectionEpoch", () => {
  it("attaches every store-side subscriber at construction, before any connect", () => {
    const epoch = beginConnectionEpoch(epochDeps());

    // Three marker recorders (resume, turn_failed, delivery — the
    // turn_stopped recorder left when the package stopped projecting a
    // member's stop, and the approval-receipt and turn_voided recorders
    // went with the meta-receipt rows they fed), the consumed-interrupt
    // recorder, the tool-error recorder, the tool-cancel recorder, the
    // tool-offload recorder, the tool-call display recorder, the
    // tool-schema recorder, the three replay-metadata recorders (block
    // timing, turn usage, memory provenance), the snapshot recorder, the
    // tool-refusal recorder, the tool-decision recorder (the placement
    // hold's durable arm), the tool-denial recorder (the approval-marker
    // join behind the not-approved state), the user-turn injector, the two
    // inbox recorders, the messages mirror, and the stream-error tap (the
    // agent's own reseed guard makes the twenty-second): every run has them
    // from its first event.
    expect(epoch.agent.subscribers).toHaveLength(22);
  });

  it("dispose detaches the epoch's subscribers, leaving the agent's own", () => {
    const epoch = beginConnectionEpoch(epochDeps());

    epoch.dispose();

    expect(epoch.agent.subscribers).toHaveLength(1);
  });

  it("builds a fresh execution inbox per epoch, while the thread-lived approval inbox rides through", () => {
    const approvalInbox = new ApprovalInbox();
    const first = beginConnectionEpoch(epochDeps({ approvalInbox }));
    const second = beginConnectionEpoch(
      epochDeps({ epochId: 2, approvalInbox }),
    );

    expect(first.approvalInbox).toBe(approvalInbox);
    expect(second.approvalInbox).toBe(approvalInbox);
    expect(second.executionInbox).not.toBe(first.executionInbox);
    expect(second.agent).not.toBe(first.agent);
  });
});

describe("markerAnchorsOf", () => {
  it("coalesces block-timing publishes across the REAL dispatch shape — one per macrotask window", async () => {
    // Timing fires on every block boundary (~2 per block) — the one
    // high-frequency recorder in the epoch. The pin drives subscribers
    // the way @ag-ui/client's defaultApplyEvents actually does: one
    // `await` per subscriber per event. Every one of those awaits
    // drains the microtask queue, which is exactly how the first
    // (microtask-window) version of this fix turned out to be a no-op —
    // its queued publish fired before the next subscriber of the SAME
    // event, one publish per boundary, quadratic over a replay. Under
    // this dispatch shape a microtask coalescer scores 4 publishes for
    // the 4 boundaries below and fails the not-yet-called assertion; the
    // macrotask window scores 1. The resume STORE stays synchronously
    // current for reconnect seeding throughout, and nothing here touches
    // the wire: the resume cursor and the replayed bytes are unchanged
    // by publish frequency.
    const resume = new StreamResumeStore();
    const publishMarkerAnchors = vi.fn();
    const epoch = beginConnectionEpoch(
      epochDeps({ resume, publishMarkerAnchors }),
    );

    const applyLikeTheDefaultPipeline = async (events: object[]) => {
      for (const event of events) {
        for (const subscriber of epoch.agent.subscribers) {
          // defaultApplyEvents awaits every subscriber call, even a
          // synchronous one — `await undefined` still yields.
          await subscriber.onEvent?.({ event } as never);
        }
      }
    };

    await applyLikeTheDefaultPipeline([
      { type: "TOOL_CALL_START", toolCallId: "t1", timestamp: 1_000 },
      { type: "TOOL_CALL_END", toolCallId: "t1", timestamp: 2_000 },
      { type: "TEXT_MESSAGE_START", messageId: "m1", timestamp: 3_000 },
      { type: "TEXT_MESSAGE_END", messageId: "m1", timestamp: 4_000 },
    ]);

    // The store is current the moment the events applied…
    expect(resume.blockTimingAnchors.get("t1")).toEqual({
      startedAtMs: 1_000,
      settledAtMs: 2_000,
    });
    // …and despite every microtask drain the dispatch performed, the
    // derived-snapshot publish has not fired yet: it waits for the
    // macrotask window, then fires once for the whole burst.
    expect(publishMarkerAnchors).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(publishMarkerAnchors).toHaveBeenCalledTimes(1);

    // A later boundary in a fresh macrotask publishes again — coalescing
    // is per window, never a lost update — and a no-op re-delivery
    // (idempotent min/max fold) queues nothing at all.
    await applyLikeTheDefaultPipeline([
      { type: "TOOL_CALL_RESULT", toolCallId: "t1", timestamp: 9_000 },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(publishMarkerAnchors).toHaveBeenCalledTimes(2);
    expect(resume.blockTimingAnchors.get("t1")).toEqual({
      startedAtMs: 1_000,
      settledAtMs: 9_000,
    });
    await applyLikeTheDefaultPipeline([
      { type: "TOOL_CALL_RESULT", toolCallId: "t1", timestamp: 9_000 },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(publishMarkerAnchors).toHaveBeenCalledTimes(2);
  });

  it("publishes the marker anchors on a denial and never on an ask alone — the ledger's denied half is the gate", () => {
    const resume = new StreamResumeStore();
    const publishMarkerAnchors = vi.fn();
    const epoch = beginConnectionEpoch(
      epochDeps({ resume, publishMarkerAnchors }),
    );
    const custom = (name: string, value: unknown) => {
      for (const subscriber of epoch.agent.subscribers) {
        void subscriber.onCustomEvent?.({
          event: { type: "CUSTOM", name, value },
        } as never);
      }
    };

    custom("approval_requested", {
      interrupt_id: "i-1",
      prompt: "Allow?",
      tool_name: "action__refund-order",
      tool_call_id: "call-1",
    });
    // The ask is held (the join needs it) but the ledger shows nothing.
    // The ONE publish here is the decision family's (the placement hold
    // anchors the same marker) — the ledger's denied half is still
    // empty, so it contributed no publish of its own.
    expect(resume.toolDenialLedger.asks.get("i-1")).toBe("call-1");
    expect(publishMarkerAnchors).toHaveBeenCalledTimes(1);
    expect(markerAnchorsOf(resume).toolDenialAnchors?.size).toBe(0);

    custom("approval_resolved", { interrupt_id: "i-1", approved: false });
    // The denial is the ledger's publish: the decision family ignores
    // approval_resolved, so this second call is the ledger's alone.
    expect(publishMarkerAnchors).toHaveBeenCalledTimes(2);
    expect(markerAnchorsOf(resume).toolDenialAnchors?.has("call-1")).toBe(true);

    // A reconnect's replay re-delivers both markers: identity holds on
    // both families, no further publish. An approval publishes nothing
    // either (the ledger narrows it to null).
    custom("approval_requested", {
      interrupt_id: "i-1",
      prompt: "Allow?",
      tool_name: "action__refund-order",
      tool_call_id: "call-1",
    });
    custom("approval_resolved", { interrupt_id: "i-1", approved: false });
    custom("approval_resolved", { interrupt_id: "i-2", approved: true });
    expect(publishMarkerAnchors).toHaveBeenCalledTimes(2);
  });

  it("engages the memory footer on a marker that arrives AFTER the run settled — the real recorder path, not a synchronous injection", async () => {
    // The no-op guard (the coalescer lesson): the footer mechanism must
    // engage when provenance arrives asynchronously after the message
    // has already settled — the ordering a reconnect tail produces. This
    // drives the epoch's REAL subscribers with the defaultApplyEvents
    // dispatch shape (one await per subscriber per event, typed handlers
    // beside onEvent), settles the run, crosses a genuine macrotask
    // boundary, and only then delivers the marker.
    const resume = new StreamResumeStore();
    const publishMarkerAnchors = vi.fn();
    const epoch = beginConnectionEpoch(
      epochDeps({ resume, publishMarkerAnchors }),
    );

    // The pipeline hands every typed handler the agent's current message
    // list beside the event; this mirror grows exactly like the real one.
    let messages: object[] = [];
    const applyLikeTheDefaultPipeline = async (events: object[]) => {
      for (const event of events) {
        const { type } = event as { type: string };
        for (const subscriber of epoch.agent.subscribers) {
          await subscriber.onEvent?.({ event, messages } as never);
          if (type === "RUN_STARTED") {
            await subscriber.onRunStartedEvent?.({ event, messages } as never);
          } else if (type === "RUN_FINISHED") {
            await subscriber.onRunFinishedEvent?.({
              event,
              messages,
            } as never);
          } else if (type === "CUSTOM") {
            await subscriber.onCustomEvent?.({ event, messages } as never);
          }
        }
      }
    };
    const publishMessagesLikeThePipeline = async (next: object[]) => {
      messages = next;
      for (const subscriber of epoch.agent.subscribers) {
        await subscriber.onMessagesChanged?.({ messages } as never);
      }
    };

    await applyLikeTheDefaultPipeline([
      { type: "RUN_STARTED", threadId: "thread-1", runId: "run-1" },
    ]);
    await publishMessagesLikeThePipeline([
      { id: "u1", role: "user", content: "Remember I prefer sencha." },
      { id: "p1", role: "assistant", content: "Noted — sencha it is." },
    ]);
    await applyLikeTheDefaultPipeline([
      { type: "RUN_FINISHED", threadId: "thread-1", runId: "run-1" },
    ]);
    // The run is settled; nothing has published and nothing is pending.
    expect(publishMarkerAnchors).not.toHaveBeenCalled();
    expect(resume.memoryProvenanceAnchors.size).toBe(0);

    // A genuine macrotask boundary between the settle and the marker —
    // the marker is not part of any apply chain the settle started.
    await new Promise((resolve) => setTimeout(resolve, 0));

    await applyLikeTheDefaultPipeline([
      {
        type: "CUSTOM",
        name: "memory_updated",
        value: {
          memory_id: "mem-late",
          scope: "user",
          summary: "Saved a note to memory.",
        },
      },
    ]);
    // The store is current and the footer attribution engaged: the late
    // marker anchored its provenance AND attributed it to the settled
    // run's prose, publishing both moves without waiting for any event.
    expect(resume.memoryProvenanceAnchors.get("mem-late")?.summary).toBe(
      "Saved a note to memory.",
    );
    expect(resume.memoryAttributionAnchors.get("mem-late")).toBe("p1");
    expect(publishMarkerAnchors).toHaveBeenCalledTimes(2);

    // A replayed duplicate reconciles by the durable id: identical maps
    // (identity, not equality), zero further publishes.
    await applyLikeTheDefaultPipeline([
      {
        type: "CUSTOM",
        name: "memory_updated",
        value: {
          memory_id: "mem-late",
          scope: "user",
          summary: "Saved a note to memory.",
        },
      },
    ]);
    expect(publishMarkerAnchors).toHaveBeenCalledTimes(2);
    expect(resume.memoryAttributionAnchors.get("mem-late")).toBe("p1");
  });

  it("derives a validated snapshot and never aliases the live anchor set", () => {
    const resume = new StreamResumeStore();
    resume.recordResumeAnchor(
      "run-1",
      "message-1",
      { attempt: 2, round: 0 },
      null,
    );
    resume.recordTurnFailedReceipts("run-1", "message-2", "after", [
      "The run hit an internal error.",
    ]);

    const snapshot = markerAnchorsOf(resume);
    resume.recordResumeAnchor("run-1", "message-3", null, 5_000);

    expect(snapshot.resumeAnchors.get("message-1")).toEqual({
      attempt: 2,
      round: 0,
    });
    expect(snapshot.resumeAnchors.has("message-3")).toBe(false);
    expect(snapshot.turnFailedAnchors.get("message-2")?.after).toHaveLength(1);
  });

  it("surfaces recorded block timing without aliasing the live map", () => {
    // The one collection where aliasing would be OBSERVABLE: the store's
    // backing map mutates in place (the siblings are copy-on-write), so
    // a snapshot that aliased it would change under React. This pins the
    // wellFormedBlockTimingAnchorsOf copy at the store-to-snapshot
    // boundary — a tempting "return stored when every entry validates"
    // short-circuit fails here, not in production.
    const resume = new StreamResumeStore();
    resume.recordBlockTiming("t1", 1_000);

    const snapshot = markerAnchorsOf(resume);
    resume.recordBlockTiming("t1", 9_000);
    resume.recordBlockTiming("t2", 5_000);

    expect(snapshot.blockTimingAnchors.get("t1")).toEqual({
      startedAtMs: 1_000,
      settledAtMs: 1_000,
    });
    expect(snapshot.blockTimingAnchors.has("t2")).toBe(false);
    expect(resume.blockTimingAnchors.get("t1")).toEqual({
      startedAtMs: 1_000,
      settledAtMs: 9_000,
    });
  });

  it("surfaces recorded tool errors without aliasing the live map", () => {
    const resume = new StreamResumeStore();
    resume.recordToolError("call-1", "The page took too long to respond.");

    const snapshot = markerAnchorsOf(resume);
    resume.recordToolError("call-2", "It broke.");

    expect(snapshot.toolErrorAnchors.get("call-1")).toBe(
      "The page took too long to respond.",
    );
    expect(snapshot.toolErrorAnchors.has("call-2")).toBe(false);
  });

  it("surfaces recorded tool refusals without aliasing the live map", () => {
    const resume = new StreamResumeStore();
    resume.recordToolRefusal("call-1", "Results are already waiting.");

    const snapshot = markerAnchorsOf(resume);
    resume.recordToolRefusal("call-2", "No subagent with that id.");

    expect(snapshot.toolRefusalAnchors.get("call-1")).toBe(
      "Results are already waiting.",
    );
    expect(snapshot.toolRefusalAnchors.has("call-2")).toBe(false);
  });

  it("surfaces recorded denials without aliasing the live set, from the ledger's denied half alone", () => {
    const resume = new StreamResumeStore();
    resume.recordToolDenialMarker({
      kind: "ask",
      interruptId: "i-1",
      toolCallId: "call-1",
    });
    resume.recordToolDenialMarker({ kind: "denied", interruptId: "i-1" });

    const snapshot = markerAnchorsOf(resume);
    resume.recordToolDenialMarker({
      kind: "ask",
      interruptId: "i-2",
      toolCallId: "call-2",
    });
    resume.recordToolDenialMarker({ kind: "denied", interruptId: "i-2" });

    expect(snapshot.toolDenialAnchors?.has("call-1")).toBe(true);
    expect(snapshot.toolDenialAnchors?.has("call-2")).toBe(false);
    // Only the presentation half rides the snapshot: no ask map.
    expect("asks" in snapshot).toBe(false);
  });

  it("surfaces recorded tool cancels without aliasing the live set", () => {
    const resume = new StreamResumeStore();
    resume.recordToolCancel("call-1");

    const snapshot = markerAnchorsOf(resume);
    resume.recordToolCancel("call-2");

    expect(snapshot.toolCancelAnchors.has("call-1")).toBe(true);
    expect(snapshot.toolCancelAnchors.has("call-2")).toBe(false);
  });

  it("surfaces recorded delivery receipts without aliasing the live map", () => {
    const resume = new StreamResumeStore();
    resume.recordSubagentDelivery("run-1", "message-1", [
      { ordinal: 0, label: "Audit the billing exports", succeeded: true },
    ]);

    const snapshot = markerAnchorsOf(resume);
    resume.recordSubagentDelivery("run-2", "message-2", [
      { ordinal: 1, label: "Later delivery", succeeded: true },
    ]);

    expect(snapshot.subagentDeliveryAnchors.get("message-1")).toEqual([
      { ordinal: 0, label: "Audit the billing exports", succeeded: true },
    ]);
    expect(snapshot.subagentDeliveryAnchors.has("message-2")).toBe(false);
  });

  it("surfaces recorded tool offloads without aliasing the live set", () => {
    const resume = new StreamResumeStore();
    resume.recordToolOffload("call-1");

    const snapshot = markerAnchorsOf(resume);
    resume.recordToolOffload("call-2");

    expect(snapshot.toolOffloadAnchors.has("call-1")).toBe(true);
    expect(snapshot.toolOffloadAnchors.has("call-2")).toBe(false);
  });
});
