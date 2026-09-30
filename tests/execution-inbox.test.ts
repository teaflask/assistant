import { describe, expect, it } from "vitest";

import type { ToolExecutionRequestedPayload } from "../src/contract/events";
import { elicitationCardsOf } from "../src/core/elicitation-cards";
import { ASK_QUESTIONS_REQUEST_KIND } from "../src/core/execution-kinds";
import {
  coworkerExecutionRequestOf,
  ExecutionInbox,
  executionRequestedPayloadOf,
  toolResultRecordedPayloadOf,
} from "../src/core/execution-inbox";

const RUN_ID = "run-1";
const TOOL_CALL_ID = "run-1-a1-t1";
const INTERRUPT_ID = "v1:tool_call:t1";
const PENDING_STATUS = { kind: "pending" };

function payloadOf(
  overrides: Partial<ToolExecutionRequestedPayload> = {},
): ToolExecutionRequestedPayload {
  return {
    interrupt_id: INTERRUPT_ID,
    tool_name: "navigate",
    tool_call_id: TOOL_CALL_ID,
    round: 0,
    request: { kind: "builtin.navigate", action: { path: "/memory" } },
    ...overrides,
  };
}

function pausedInbox(): ExecutionInbox {
  const inbox = new ExecutionInbox();
  inbox.noteRunStarted(RUN_ID);
  inbox.noteExecutionRequested(payloadOf());
  return inbox;
}

describe("executionRequestedPayloadOf", () => {
  it("accepts the contract payload verbatim", () => {
    const narrowed = executionRequestedPayloadOf(payloadOf());
    expect(narrowed).toEqual(
      payloadOf({
        request: {
          kind: "builtin.navigate",
          intent: null,
          action: { path: "/memory" },
        },
      }),
    );
  });

  it("carries the request's server-built intent verbatim", () => {
    const intent = { method: "POST", path_template: "/subscriptions/{id}" };
    const narrowed = executionRequestedPayloadOf(
      payloadOf({ request: { kind: "http_intent", intent } }),
    );
    expect(narrowed?.request.intent).toEqual(intent);
  });

  it("rejects payloads that are not objects or lack the required fields", () => {
    expect(executionRequestedPayloadOf(null)).toBeNull();
    expect(executionRequestedPayloadOf("interrupt")).toBeNull();
    expect(executionRequestedPayloadOf({ tool_name: "navigate" })).toBeNull();
    expect(executionRequestedPayloadOf({ interrupt_id: "" })).toBeNull();
    expect(
      executionRequestedPayloadOf({ interrupt_id: "id", tool_name: 7 }),
    ).toBeNull();
    expect(
      executionRequestedPayloadOf({ interrupt_id: "id", tool_name: "t" }),
    ).toBeNull();
    expect(
      executionRequestedPayloadOf({
        interrupt_id: "id",
        tool_name: "t",
        request: { kind: "" },
      }),
    ).toBeNull();
  });

  it("normalizes the optional fields the contract lets vary", () => {
    const narrowed = executionRequestedPayloadOf({
      interrupt_id: "id",
      tool_name: "navigate",
      round: "not-a-number",
      request: {
        kind: "builtin.navigate",
        intent: "not-a-record",
        action: "not-a-record",
      },
    });
    expect(narrowed).toEqual({
      interrupt_id: "id",
      tool_name: "navigate",
      tool_call_id: null,
      round: 0,
      request: { kind: "builtin.navigate", intent: null, action: null },
    });
  });
});

describe("toolResultRecordedPayloadOf", () => {
  it("narrows the receipt, defaulting ok to true", () => {
    expect(toolResultRecordedPayloadOf({ interrupt_id: "id" })).toEqual({
      interruptId: "id",
      ok: true,
    });
    expect(
      toolResultRecordedPayloadOf({ interrupt_id: "id", ok: false }),
    ).toEqual({ interruptId: "id", ok: false });
  });

  it("rejects payloads without an interrupt id", () => {
    expect(toolResultRecordedPayloadOf(null)).toBeNull();
    expect(toolResultRecordedPayloadOf({ ok: true })).toBeNull();
    expect(toolResultRecordedPayloadOf({ interrupt_id: "" })).toBeNull();
  });
});

describe("a pause opening entries", () => {
  it("holds one pending entry per marker with the request on board", () => {
    const inbox = pausedInbox();
    expect(inbox.entries()).toEqual([
      expect.objectContaining({
        interruptId: INTERRUPT_ID,
        toolName: "navigate",
        toolCallId: TOOL_CALL_ID,
        kind: "builtin.navigate",
        action: { path: "/memory" },
        intent: null,
        round: 0,
        runId: RUN_ID,
        status: { kind: "pending" },
      }),
    ]);
  });

  it("holds entries of a kind it has never heard of — the registry, not the inbox, decides what executes", () => {
    const inbox = new ExecutionInbox();
    inbox.noteRunStarted(RUN_ID);
    inbox.noteExecutionRequested(
      payloadOf({ request: { kind: "builtin.confetti" } }),
    );
    expect(inbox.entries()).toEqual([
      expect.objectContaining({ kind: "builtin.confetti", action: null }),
    ]);
  });

  it("ignores a marker arriving outside any run segment", () => {
    const inbox = new ExecutionInbox();
    expect(inbox.noteExecutionRequested(payloadOf())).toBe(false);
    expect(inbox.entries()).toEqual([]);
  });

  it("holds a replayed marker to one entry (replay and StrictMode idempotence)", () => {
    const inbox = pausedInbox();
    expect(inbox.noteExecutionRequested(payloadOf())).toBe(false);
    expect(inbox.entries()).toHaveLength(1);
  });

  it("anchors an entry whose tool row streamed before its marker", () => {
    // TOOL_CALL_START precedes the pause marker in stream order (live
    // and on replay), so an anchored card can render beneath its row.
    const inbox = new ExecutionInbox();
    inbox.noteRunStarted(RUN_ID);
    expect(inbox.noteToolCallStart(TOOL_CALL_ID)).toBe(false);
    inbox.noteExecutionRequested(payloadOf());
    expect(inbox.entries()[0].anchored).toBe(true);
  });

  it("leaves an entry orphaned without its row — or without any tool call id", () => {
    const noRow = pausedInbox();
    expect(noRow.entries()[0].anchored).toBe(false);

    const noId = new ExecutionInbox();
    noId.noteRunStarted(RUN_ID);
    noId.noteToolCallStart(TOOL_CALL_ID);
    noId.noteExecutionRequested(payloadOf({ tool_call_id: null }));
    expect(noId.entries()[0].anchored).toBe(false);
  });
});

describe("the stream closing entries", () => {
  it("removes an entry when its tool call produces a result — the resume made visible", () => {
    const inbox = pausedInbox();
    expect(inbox.noteToolCallResult(TOOL_CALL_ID)).toBe(true);
    expect(inbox.entries()).toEqual([]);
  });

  it("a RUN_FINISHED alone closes nothing — the settled turn record does (a synthesized close is indistinguishable from a real one)", () => {
    const inbox = pausedInbox();
    expect(inbox.noteRunFinished()).toBe(false);
    expect(inbox.entries()).toHaveLength(1);
    // The durable turn record's word: the run's turn settled.
    expect(
      inbox.reconcileWithTurns([{ run_id: RUN_ID, status: "succeeded" }]),
    ).toBe(true);
    expect(inbox.entries()).toEqual([]);
  });

  it("the ledger's word closes only SETTLED turns' runs, and only the assistant's entries", () => {
    const inbox = pausedInbox();
    for (const status of [
      "queued",
      "working",
      "awaiting_input",
      "parked",
    ] as const) {
      expect(inbox.reconcileWithTurns([{ run_id: RUN_ID, status }])).toBe(
        false,
      );
    }
    expect(inbox.entries()).toHaveLength(1);
    for (const status of ["failed", "superseded", "stopped"] as const) {
      const again = pausedInbox();
      expect(again.reconcileWithTurns([{ run_id: RUN_ID, status }])).toBe(true);
    }
  });

  it("the streamer's synthesized close around a late row keeps the live pause's ask; a real terminal followed by a new run loses it", () => {
    // Live run B holds the parent's pending ask. A coworker's answer lands
    // under old run A: the streamer closes B (synthesized RUN_FINISHED),
    // re-enters A, then re-opens B when B's next row lands.
    const inbox = new ExecutionInbox();
    inbox.noteRunStarted("run-a");
    inbox.noteRunStarted("run-b");
    inbox.noteExecutionRequested(payloadOf());
    expect(inbox.noteRunFinished()).toBe(false);
    expect(inbox.noteRunStarted("run-a")).toBe(false);
    expect(inbox.noteRunFinished()).toBe(false);
    expect(inbox.noteRunStarted("run-b")).toBe(false);
    expect(inbox.entries()).toEqual([
      expect.objectContaining({
        interruptId: INTERRUPT_ID,
        status: PENDING_STATUS,
      }),
    ]);
    // A real terminal: B ends, a NEW run C begins — the first-seen wipe.
    inbox.noteRunFinished();
    expect(inbox.noteRunStarted("run-c")).toBe(true);
    expect(inbox.entries()).toEqual([]);
  });

  it("clears everything on RUN_ERROR, which carries no run id", () => {
    const inbox = pausedInbox();
    expect(inbox.noteRunError()).toBe(true);
    expect(inbox.entries()).toEqual([]);
  });

  it("drops stragglers from earlier runs when a new run starts", () => {
    const inbox = pausedInbox();
    expect(inbox.noteRunStarted("run-2")).toBe(true);
    expect(inbox.entries()).toEqual([]);
  });
});

describe("tool_result_recorded receipts as already-delivered evidence — the replay guard", () => {
  it("flips a replayed marker's entry straight to reported, and the claim then refuses", () => {
    const inbox = pausedInbox();
    expect(inbox.noteToolResultRecorded(INTERRUPT_ID, true)).toBe(true);
    expect(inbox.entries()).toEqual([
      expect.objectContaining({ status: { kind: "reported", ok: true } }),
    ]);
    expect(inbox.beginExecution(INTERRUPT_ID)).toBe(false);
  });

  it("never allows a claim at any point of a full stale replay — a reload can never re-execute", () => {
    // The recorded log of a delivered pause replays in this exact order:
    // marker, receipt, the gated call's result, the run's terminal.
    const inbox = new ExecutionInbox();
    inbox.noteRunStarted(RUN_ID);
    inbox.noteExecutionRequested(payloadOf());
    inbox.noteToolResultRecorded(INTERRUPT_ID, true);
    expect(inbox.beginExecution(INTERRUPT_ID)).toBe(false);
    inbox.noteToolCallResult(TOOL_CALL_ID);
    expect(inbox.beginExecution(INTERRUPT_ID)).toBe(false);
    inbox.noteRunFinished();
    expect(inbox.entries()).toEqual([]);
    expect(inbox.beginExecution(INTERRUPT_ID)).toBe(false);
  });

  it("reports over an in-flight execution too — the receipt outranks the local claim", () => {
    const inbox = pausedInbox();
    inbox.beginExecution(INTERRUPT_ID);
    expect(inbox.noteToolResultRecorded(INTERRUPT_ID, false)).toBe(true);
    expect(inbox.entries()[0]?.status).toEqual({
      kind: "reported",
      ok: false,
    });
  });

  it("ignores receipts for entries it does not hold, and leaves stale notes alone", () => {
    const inbox = pausedInbox();
    expect(inbox.noteToolResultRecorded("never-asked", true)).toBe(false);
    inbox.markRunStale(RUN_ID);
    expect(inbox.noteToolResultRecorded(INTERRUPT_ID, true)).toBe(false);
    expect(inbox.entries()[0]?.status).toEqual({ kind: "stale" });
  });
});

describe("multi-round pauses", () => {
  it("supersedes the run's earlier round when a later round pauses", () => {
    const inbox = pausedInbox();
    inbox.noteToolCallResult(TOOL_CALL_ID);
    inbox.noteExecutionRequested(
      payloadOf({
        interrupt_id: "v1:tool_call:t2",
        tool_call_id: "run-1-a1-r1-t2",
        round: 1,
      }),
    );
    expect(inbox.entries()).toEqual([
      expect.objectContaining({ interruptId: "v1:tool_call:t2", round: 1 }),
    ]);
  });

  it("treats a lower round replaying after a later pause as history", () => {
    const inbox = new ExecutionInbox();
    inbox.noteRunStarted(RUN_ID);
    inbox.noteExecutionRequested(payloadOf({ interrupt_id: "late", round: 1 }));
    expect(
      inbox.noteExecutionRequested(payloadOf({ interrupt_id: "early" })),
    ).toBe(false);
    expect(inbox.entries().map((entry) => entry.interruptId)).toEqual(["late"]);
  });
});

describe("a stream ending without a terminal", () => {
  it("leaves a pending entry untouched and still claimable", () => {
    // The quiet close is not an inbox event at all since the card line
    // it used to feed was deleted: nothing about being answerable
    // depends on whether the turn parked.
    const inbox = pausedInbox();
    expect(inbox.entries()).toEqual([
      expect.objectContaining({ status: { kind: "pending" } }),
    ]);
    expect(inbox.beginExecution(INTERRUPT_ID)).toBe(true);
  });

  it("the void's paired RUN_FINISHED alone closes nothing; the voided turn's word, or the next member run beginning, does", () => {
    const inbox = pausedInbox();
    expect(inbox.noteRunFinished()).toBe(false);
    expect(inbox.entries()).toHaveLength(1);
    expect(
      inbox.reconcileWithTurns([{ run_id: RUN_ID, status: "superseded" }]),
    ).toBe(true);
    expect(inbox.entries()).toEqual([]);
  });
});

describe("the driver's claim machine", () => {
  it("claims only from pending — two schedulers can never both win", () => {
    const inbox = pausedInbox();
    expect(inbox.beginExecution(INTERRUPT_ID)).toBe(true);
    expect(inbox.beginExecution(INTERRUPT_ID)).toBe(false);
    expect(inbox.entries()[0]?.status).toEqual({ kind: "executing" });
  });

  it("settles a claimed entry as reported", () => {
    const inbox = pausedInbox();
    inbox.beginExecution(INTERRUPT_ID);
    expect(inbox.settleReported(INTERRUPT_ID, true)).toBe(true);
    expect(inbox.entries()[0]?.status).toEqual({
      kind: "reported",
      ok: true,
    });
    expect(inbox.beginExecution(INTERRUPT_ID)).toBe(false);
  });

  it("returns a failed delivery to pending — the retry re-POSTs, it never re-executes", () => {
    const inbox = pausedInbox();
    inbox.beginExecution(INTERRUPT_ID);
    expect(inbox.settlePostFailed(INTERRUPT_ID)).toBe(true);
    expect(inbox.entries()[0]?.status).toEqual({ kind: "pending" });
    expect(inbox.beginExecution(INTERRUPT_ID)).toBe(true);
  });

  it("never resurrects a reported entry from a replayed marker", () => {
    const inbox = pausedInbox();
    inbox.beginExecution(INTERRUPT_ID);
    inbox.settleReported(INTERRUPT_ID, true);
    inbox.noteExecutionRequested(payloadOf());
    expect(inbox.entries().map((entry) => entry.status)).toEqual([
      { kind: "reported", ok: true },
    ]);
  });

  it("marks the run's open asks stale on a 409, leaving reported notes alone", () => {
    const inbox = pausedInbox();
    inbox.noteExecutionRequested(payloadOf({ interrupt_id: "open-ask" }));
    inbox.beginExecution(INTERRUPT_ID);
    inbox.settleReported(INTERRUPT_ID, true);
    expect(inbox.markRunStale(RUN_ID)).toBe(true);
    expect(inbox.entries().map((entry) => entry.status)).toEqual([
      { kind: "reported", ok: true },
      { kind: "stale" },
    ]);
    expect(inbox.beginExecution("open-ask")).toBe(false);
  });

  it("keeps sibling entries of the same round individually servable", () => {
    const inbox = pausedInbox();
    inbox.noteExecutionRequested(payloadOf({ interrupt_id: "sibling" }));
    inbox.beginExecution(INTERRUPT_ID);
    inbox.settleReported(INTERRUPT_ID, true);
    expect(inbox.entries().map((entry) => entry.status)).toEqual([
      { kind: "reported", ok: true },
      { kind: "pending" },
    ]);
    expect(inbox.beginExecution("sibling")).toBe(true);
  });
});

// --- a coworker's request --------------------------------------------

const COWORKER_INTERRUPT_ID = "v1:tool_call:cw-1";
const DISPATCHING_TURN_ID = "turn-dispatching";

function coworkerCardOf(
  overrides: Partial<ToolExecutionRequestedPayload> = {},
): ToolExecutionRequestedPayload {
  return {
    interrupt_id: COWORKER_INTERRUPT_ID,
    tool_name: "action__refund",
    tool_call_id: "cw-run-a1-t1",
    round: 4,
    request: { kind: "http_intent", intent: { method: "POST" } },
    ...overrides,
  };
}

function coworkerRequestOf(card = coworkerCardOf()) {
  return {
    ordinal: 3,
    label: "Refund order 41.",
    child_session_id: "subagent-thread-3",
    round: 4,
    expires_at: "2026-09-16T00:05:00Z",
    parked: false,
    card,
  };
}

function dispatchingTurnOf(requests: readonly unknown[]) {
  return {
    id: DISPATCHING_TURN_ID,
    run_id: "run-dispatching",
    pending_coworker_executions: requests,
  };
}

describe("coworkerExecutionRequestOf", () => {
  it("narrows the asker and the card", () => {
    expect(coworkerExecutionRequestOf(coworkerRequestOf())).toEqual({
      ordinal: 3,
      label: "Refund order 41.",
      childSessionId: "subagent-thread-3",
      card: coworkerCardOf({
        request: {
          kind: "http_intent",
          intent: { method: "POST" },
          action: null,
        },
      }),
    });
  });

  it("rejects a request missing its asker or with a malformed card", () => {
    expect(coworkerExecutionRequestOf(null)).toBeNull();
    expect(
      coworkerExecutionRequestOf({ ...coworkerRequestOf(), ordinal: "3" }),
    ).toBeNull();
    expect(
      coworkerExecutionRequestOf({
        ...coworkerRequestOf(),
        card: { round: 1 },
      }),
    ).toBeNull();
  });
});

describe("a re-entered historical segment is not closing evidence", () => {
  it("wipes the assistant's stragglers on a FIRST-seen run, never on a run already seen", () => {
    const inbox = pausedInbox();
    // The stream re-enters run-1's segment (a late row landed under it).
    inbox.noteRunStarted("run-2");
    inbox.noteRunStarted(RUN_ID);
    expect(inbox.entries()).toEqual([]);

    const again = new ExecutionInbox();
    again.noteRunStarted(RUN_ID);
    again.noteRunStarted("run-2");
    again.noteExecutionRequested(
      payloadOf({ interrupt_id: "v1:tool_call:t2" }),
    );
    // run-1 re-entered: nothing began, so run-2's open ask survives.
    expect(again.noteRunStarted(RUN_ID)).toBe(false);
    expect(again.entries()).toHaveLength(1);
    // The re-entered segment ending again closes nothing of run-2's.
    expect(again.noteRunFinished()).toBe(false);
    expect(again.entries()).toHaveLength(1);
  });
});

describe("the coworker requests the turn snapshot lists", () => {
  it("a coworker's member-answerable request is not held — it has no door here, and no elicitation card derives from it", () => {
    const inbox = new ExecutionInbox();
    const askQuestions = coworkerRequestOf(
      coworkerCardOf({
        interrupt_id: "v1:tool_call:cw-ask",
        request: {
          kind: ASK_QUESTIONS_REQUEST_KIND,
          action: {
            questions: [
              {
                id: "order",
                heading: "Order",
                prompt: "Which order?",
                options: [{ text: "41" }, { text: "42" }],
              },
            ],
          },
        },
      }),
    );
    expect(
      inbox.adoptCoworkerRequests([
        dispatchingTurnOf([askQuestions, coworkerRequestOf()]),
      ]),
    ).toBe(true);
    expect(inbox.entries().map((entry) => entry.interruptId)).toEqual([
      COWORKER_INTERRUPT_ID,
    ]);
    expect(elicitationCardsOf(inbox.entries(), new Map())).toEqual([]);

    // The stream door: a marker for the same id, under the parent's live
    // run, is the coworker's (the ask is remembered) and is dropped too —
    // never held as the assistant's under the current run.
    inbox.noteRunStarted("run-live");
    expect(inbox.noteExecutionRequested(askQuestions.card)).toBe(false);
    expect(inbox.entries().map((entry) => entry.interruptId)).toEqual([
      COWORKER_INTERRUPT_ID,
    ]);
    expect(elicitationCardsOf(inbox.entries(), new Map())).toEqual([]);

    // The other order: a marker that beat the snapshot was held as the
    // assistant's; the adoption that names it a coworker's drops it.
    const early = new ExecutionInbox();
    early.noteRunStarted("run-live");
    expect(early.noteExecutionRequested(askQuestions.card)).toBe(true);
    expect(elicitationCardsOf(early.entries(), new Map())).toHaveLength(1);
    expect(
      early.adoptCoworkerRequests([dispatchingTurnOf([askQuestions])]),
    ).toBe(true);
    expect(early.entries()).toEqual([]);
  });

  it("opens a pending entry addressed to the dispatching turn, naming the asker", () => {
    const inbox = pausedInbox();
    expect(
      inbox.adoptCoworkerRequests([dispatchingTurnOf([coworkerRequestOf()])]),
    ).toBe(true);
    const coworker = inbox
      .entries()
      .find((entry) => entry.interruptId === COWORKER_INTERRUPT_ID);
    expect(coworker).toMatchObject({
      kind: "http_intent",
      intent: { method: "POST" },
      round: 4,
      runId: "run-dispatching",
      turnId: DISPATCHING_TURN_ID,
      anchored: false,
      status: { kind: "pending" },
      asker: { kind: "coworker", ordinal: 3 },
    });
    // The assistant's own entry is untouched.
    expect(inbox.entries()).toHaveLength(2);
  });

  it("is idempotent, and a second adoption of the same window changes nothing", () => {
    const inbox = new ExecutionInbox();
    const turns = [dispatchingTurnOf([coworkerRequestOf()])];
    expect(inbox.adoptCoworkerRequests(turns)).toBe(true);
    expect(inbox.adoptCoworkerRequests(turns)).toBe(false);
    expect(inbox.entries()).toHaveLength(1);
  });

  it("re-labels a held pending entry the stream delivered first, and never reopens a reported one", () => {
    const inbox = new ExecutionInbox();
    inbox.noteRunStarted("run-dispatching");
    inbox.noteExecutionRequested(coworkerCardOf());
    expect(inbox.entries()[0]?.asker).toEqual({ kind: "assistant" });
    expect(
      inbox.adoptCoworkerRequests([dispatchingTurnOf([coworkerRequestOf()])]),
    ).toBe(true);
    expect(inbox.entries()[0]).toMatchObject({
      asker: { kind: "coworker", ordinal: 3 },
      turnId: DISPATCHING_TURN_ID,
      status: { kind: "pending" },
    });
    inbox.noteToolResultRecorded(COWORKER_INTERRUPT_ID, true);
    expect(
      inbox.adoptCoworkerRequests([dispatchingTurnOf([coworkerRequestOf()])]),
    ).toBe(false);
    expect(inbox.entries()[0]?.status).toEqual({ kind: "reported", ok: true });
  });

  it("drops a coworker entry no turn in the window lists anymore — the row left paused", () => {
    const inbox = new ExecutionInbox();
    inbox.adoptCoworkerRequests([dispatchingTurnOf([coworkerRequestOf()])]);
    expect(inbox.adoptCoworkerRequests([dispatchingTurnOf([])])).toBe(true);
    expect(inbox.entries()).toEqual([]);
    // An EMPTY window says nothing — it never removes.
    inbox.adoptCoworkerRequests([dispatchingTurnOf([coworkerRequestOf()])]);
    expect(inbox.adoptCoworkerRequests([])).toBe(false);
    expect(inbox.entries()).toHaveLength(1);
  });

  it("outlives the parent's runs: RUN_STARTED, RUN_FINISHED and RUN_ERROR close nothing of a coworker's", () => {
    const inbox = new ExecutionInbox();
    inbox.noteRunStarted("run-dispatching");
    inbox.adoptCoworkerRequests([dispatchingTurnOf([coworkerRequestOf()])]);
    expect(inbox.noteRunFinished()).toBe(false);
    expect(inbox.noteRunStarted("run-later")).toBe(false);
    expect(inbox.noteRunError()).toBe(false);
    expect(inbox.entries()).toHaveLength(1);
    // The receipt under the dispatching turn's run is what reports it.
    expect(inbox.noteToolResultRecorded(COWORKER_INTERRUPT_ID, true)).toBe(
      true,
    );
    expect(inbox.entries()[0]?.status).toEqual({ kind: "reported", ok: true });
  });

  it("a marker for a request REST already named as a coworker's bypasses the parent's round arbitration", () => {
    const inbox = new ExecutionInbox();
    inbox.adoptCoworkerRequests([dispatchingTurnOf([coworkerRequestOf()])]);
    inbox.noteRunStarted("run-dispatching");
    // The parent paused at round 9 under the same run; the coworker's
    // card says round 4 — lower, which the parent's rule would drop.
    inbox.noteExecutionRequested(
      payloadOf({ interrupt_id: "v1:tool_call:parent", round: 9 }),
    );
    inbox.noteToolResultRecorded(COWORKER_INTERRUPT_ID, true);
    inbox.adoptCoworkerRequests([dispatchingTurnOf([])]);
    expect(inbox.noteExecutionRequested(coworkerCardOf())).toBe(true);
    expect(
      inbox.entries().find((e) => e.interruptId === COWORKER_INTERRUPT_ID),
    ).toMatchObject({ asker: { kind: "coworker", ordinal: 3 }, round: 4 });
    // And the parent's round-9 entry was not superseded by it.
    expect(
      inbox.entries().find((e) => e.interruptId === "v1:tool_call:parent"),
    ).toBeDefined();
  });

  it("a 409 stales that one request; the member's send stales every coworker request", () => {
    const inbox = pausedInbox();
    inbox.adoptCoworkerRequests([
      dispatchingTurnOf([
        coworkerRequestOf(),
        coworkerRequestOf(
          coworkerCardOf({ interrupt_id: "v1:tool_call:cw-2" }),
        ),
      ]),
    ]);
    expect(inbox.markCoworkerRequestStale(COWORKER_INTERRUPT_ID)).toBe(true);
    expect(inbox.markCoworkerRequestStale(INTERRUPT_ID)).toBe(false);
    expect(inbox.markCoworkerRequestsStale()).toBe(true);
    const statuses = new Map(
      inbox.entries().map((e) => [e.interruptId, e.status.kind]),
    );
    expect(statuses.get(COWORKER_INTERRUPT_ID)).toBe("stale");
    expect(statuses.get("v1:tool_call:cw-2")).toBe("stale");
    expect(statuses.get(INTERRUPT_ID)).toBe("pending");
    // markRunStale is the assistant's alone.
    expect(inbox.markRunStale(RUN_ID)).toBe(true);
  });

  it("a coworker's round never buckets with the parent's — a higher coworker round drops no parent marker, a lower one is not superseded", () => {
    // The dispatching turn is the live run: the coworker (child round 4)
    // is adopted under its run id while the parent then pauses at round 0.
    const inbox = new ExecutionInbox();
    inbox.noteRunStarted("run-dispatching");
    inbox.adoptCoworkerRequests([dispatchingTurnOf([coworkerRequestOf()])]);
    expect(
      inbox.noteExecutionRequested(
        payloadOf({ interrupt_id: "v1:tool_call:parent", round: 0 }),
      ),
    ).toBe(true);
    expect(
      inbox
        .entries()
        .map((e) => e.interruptId)
        .sort(),
    ).toEqual(["v1:tool_call:parent", COWORKER_INTERRUPT_ID].sort());

    // The reverse: the parent paused at round 1, a coworker at round 0
    // adopted beside it, then the parent pauses again at round 3 — its
    // supersede retires ITS round-1 ask and must not delete the coworker's.
    const again = new ExecutionInbox();
    again.noteRunStarted("run-dispatching");
    again.noteExecutionRequested(
      payloadOf({ interrupt_id: "v1:tool_call:older", round: 1 }),
    );
    again.adoptCoworkerRequests([
      dispatchingTurnOf([coworkerRequestOf(coworkerCardOf({ round: 0 }))]),
    ]);
    again.noteExecutionRequested(
      payloadOf({ interrupt_id: "v1:tool_call:parent", round: 3 }),
    );
    expect(
      again
        .entries()
        .map((e) => e.interruptId)
        .sort(),
    ).toEqual(["v1:tool_call:parent", COWORKER_INTERRUPT_ID].sort());
    // And the parent's own arbitration still works among its own rounds.
    expect(
      again.noteExecutionRequested(
        payloadOf({ interrupt_id: "v1:tool_call:stale", round: 1 }),
      ),
    ).toBe(false);
  });
});
