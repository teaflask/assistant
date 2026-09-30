import { describe, expect, it, vi } from "vitest";

import type {
  AssistantThreadDetailResponse,
  ResolveTurnToolResultsRequest,
  ResolveTurnToolResultsResponse,
  ServingAssistantThread,
  ServingAssistantTurn,
} from "../src/contract/threads";
import {
  executionHandlersFor,
  HTTP_INTENT_REQUEST_KIND,
  KIND_UNSUPPORTED_OUTCOME,
  NAVIGATE_REQUEST_KIND,
} from "../src/core/execution-handlers";
import { ExecutionInbox } from "../src/core/execution-inbox";
import {
  runExecutionPass,
  type ExecutionPassContext,
} from "../src/core/execution-driver";
import {
  recordExecutedOutcome,
  recordExecutionClaimed,
  UNKNOWN_OUTCOME,
} from "../src/persistence/execution-ledger";
import { ServingApiError } from "../src/transport/serving-error";

const RUN_ID = "run-1";
const TOOL_CALL_ID = "run-1-a1-t1";
const INTERRUPT_ID = "v1:tool_call:t1";
const TURN_ID = "turn-1";

// The ledger keys on the thread id and lives in module memory under node —
// unique ids isolate the tests.
let threadCounter = 0;
function freshThreadId(): string {
  threadCounter += 1;
  return `pass-thread-${String(threadCounter)}`;
}

function pausedInbox(): ExecutionInbox {
  const inbox = new ExecutionInbox();
  inbox.noteRunStarted(RUN_ID);
  inbox.noteExecutionRequested({
    interrupt_id: INTERRUPT_ID,
    tool_name: "navigate",
    tool_call_id: TOOL_CALL_ID,
    round: 0,
    request: { kind: NAVIGATE_REQUEST_KIND, action: { path: "/memory" } },
  });
  return inbox;
}

function turnOf(
  overrides: Partial<ServingAssistantTurn>,
): ServingAssistantTurn {
  return {
    id: TURN_ID,
    thread_id: "thread",
    user_message: "take me to the memory workbench",
    kind: null,
    status: "awaiting_input",
    error: null,
    run_id: RUN_ID,
    pending_interrupt_ids: [INTERRUPT_ID],
    awaiting_round: 0,
    pending_approvals: [],
    created_at: "2026-07-24T00:00:00Z",
    updated_at: "2026-07-24T00:00:00Z",
    ...overrides,
  };
}

function detailOf(turn: ServingAssistantTurn): AssistantThreadDetailResponse {
  return { thread: { id: "thread" } as ServingAssistantThread, turns: [turn] };
}

function detailOfTurns(
  turns: ServingAssistantTurn[],
): AssistantThreadDetailResponse {
  return { thread: { id: "thread" } as ServingAssistantThread, turns };
}

function deliveredOf(
  overrides: Partial<ResolveTurnToolResultsResponse> = {},
): ResolveTurnToolResultsResponse {
  return {
    delivery: "signaled",
    turn: turnOf({}),
    notice: null,
    ...overrides,
  };
}

function contextOf(
  overrides: Partial<ExecutionPassContext>,
): ExecutionPassContext {
  const visited: string[] = [];
  return {
    inbox: pausedInbox(),
    threadId: freshThreadId(),
    handlers: executionHandlersFor(
      (path) => {
        visited.push(path);
      },
      null,
      "thread-under-test",
    ),
    attempts: new Map(),
    fetchThreadDetail: vi.fn(() => Promise.resolve(detailOf(turnOf({})))),
    postResults: vi.fn(() => Promise.resolve(deliveredOf())),
    publishEntries: () => undefined,
    onWorkflowRestarted: vi.fn(),
    ...overrides,
  };
}

describe("runExecutionPass", () => {
  it("executes a pending entry and POSTs the navigate result to the pausing turn", async () => {
    const visited: string[] = [];
    const context = contextOf({
      handlers: executionHandlersFor(
        (path) => {
          visited.push(path);
        },
        null,
        "thread-under-test",
      ),
    });
    await runExecutionPass(context);
    expect(visited).toEqual(["/memory"]);
    expect(context.postResults).toHaveBeenCalledWith(TURN_ID, {
      results: [
        {
          interrupt_id: INTERRUPT_ID,
          ok: true,
          result: { navigated: true, path: "/memory" },
        },
      ],
    });
    expect(context.inbox.entries()[0]?.status).toEqual({
      kind: "reported",
      ok: true,
    });
    expect(context.onWorkflowRestarted).not.toHaveBeenCalled();
  });

  it("drains an http_intent entry through the wired executor and POSTs the synthesized result", async () => {
    const inbox = new ExecutionInbox();
    inbox.noteRunStarted(RUN_ID);
    inbox.noteExecutionRequested({
      interrupt_id: INTERRUPT_ID,
      tool_name: "action__cancel-subscription",
      tool_call_id: TOOL_CALL_ID,
      round: 0,
      request: {
        kind: HTTP_INTENT_REQUEST_KIND,
        intent: {
          action: {
            slug: "cancel-subscription",
            title: "Cancel a subscription",
          },
          method: "POST",
          path_template: "/subscriptions/{subscription_id}",
          path_params: { subscription_id: "sub_42" },
          query: {},
        },
      },
    });
    const context = contextOf({
      inbox,
      handlers: executionHandlersFor(
        null,
        () => Promise.resolve({ status: 200, body: { status: "cancelled" } }),
        "thread-under-test",
      ),
    });
    await runExecutionPass(context);
    expect(context.postResults).toHaveBeenCalledWith(TURN_ID, {
      results: [
        {
          interrupt_id: INTERRUPT_ID,
          ok: true,
          result: { status: 200, body: { status: "cancelled" } },
        },
      ],
    });
  });

  it("re-POSTs a stored outcome without executing again — the remount recovery", async () => {
    const visited: string[] = [];
    const context = contextOf({
      handlers: executionHandlersFor(
        (path) => {
          visited.push(path);
        },
        null,
        "thread-under-test",
      ),
    });
    recordExecutionClaimed(context.threadId, INTERRUPT_ID);
    recordExecutedOutcome(context.threadId, INTERRUPT_ID, {
      ok: true,
      result: { navigated: true, path: "/memory" },
    });
    await runExecutionPass(context);
    expect(visited).toEqual([]);
    expect(context.postResults).toHaveBeenCalledOnce();
  });

  it("targets the pausing turn behind a QUEUED newer one — queuing retired the newest-turn premise", async () => {
    // A message during a live turn queues, so the newest row can be a
    // QUEUED member turn while the pause sits on an older row. The POST
    // must land on the pause's own turn — a newest-turn guess would 409
    // and markRunStale would drop the executed result.
    const queuedNewer = turnOf({
      id: "turn-queued-newer",
      status: "queued",
      run_id: null,
      pending_interrupt_ids: [],
      awaiting_round: null,
    });
    const context = contextOf({
      fetchThreadDetail: vi.fn(() =>
        Promise.resolve(detailOfTurns([turnOf({}), queuedNewer])),
      ),
    });
    await runExecutionPass(context);
    expect(context.postResults).toHaveBeenCalledOnce();
    expect(vi.mocked(context.postResults).mock.calls[0]?.[0]).toBe(TURN_ID);
  });

  it("re-POSTs a stored outcome to the ORIGIN run's turn, never a queued newer one", async () => {
    // The stored-outcome retry bypasses the holder gate by design (the
    // pause may be over; the door's evidence arms answer it) — but the
    // target must still be the turn the card came from, resolved by run.
    const queuedNewer = turnOf({
      id: "turn-queued-newer",
      status: "queued",
      run_id: null,
      pending_interrupt_ids: [],
      awaiting_round: null,
    });
    const superseded = turnOf({
      status: "superseded",
      pending_interrupt_ids: [],
      awaiting_round: null,
    });
    const context = contextOf({
      fetchThreadDetail: vi.fn(() =>
        Promise.resolve(detailOfTurns([superseded, queuedNewer])),
      ),
    });
    recordExecutionClaimed(context.threadId, INTERRUPT_ID);
    recordExecutedOutcome(context.threadId, INTERRUPT_ID, {
      ok: true,
      result: { navigated: true, path: "/memory" },
    });
    await runExecutionPass(context);
    expect(context.postResults).toHaveBeenCalledOnce();
    expect(vi.mocked(context.postResults).mock.calls[0]?.[0]).toBe(TURN_ID);
  });

  it("reports a claim that never settled as the unknown-outcome failure", async () => {
    const visited: string[] = [];
    const context = contextOf({
      handlers: executionHandlersFor(
        (path) => {
          visited.push(path);
        },
        null,
        "thread-under-test",
      ),
    });
    recordExecutionClaimed(context.threadId, INTERRUPT_ID);
    await runExecutionPass(context);
    expect(visited).toEqual([]);
    expect(context.postResults).toHaveBeenCalledWith(TURN_ID, {
      results: [
        {
          interrupt_id: INTERRUPT_ID,
          ok: false,
          error: { ...UNKNOWN_OUTCOME.error },
        },
      ],
    });
  });

  it("does nothing when REST says the pause is over — the stream closes entries, REST never does", async () => {
    for (const turn of [
      turnOf({ status: "succeeded" }),
      turnOf({ status: "working" }),
      turnOf({ run_id: "another-run" }),
    ]) {
      const context = contextOf({
        fetchThreadDetail: vi.fn(() => Promise.resolve(detailOf(turn))),
      });
      await runExecutionPass(context);
      expect(context.postResults).not.toHaveBeenCalled();
      expect(context.inbox.entries()[0]?.status).toEqual({ kind: "pending" });
    }
  });

  it("acts on a parked turn and on a lost run-id capture — the status gate still holds", async () => {
    for (const turn of [
      turnOf({ status: "parked" }),
      // A lost capture hides the server's cards too: the empty pending
      // set must not be read as "resolved" when run_id is null.
      turnOf({ run_id: null, pending_interrupt_ids: [], awaiting_round: null }),
    ]) {
      const context = contextOf({
        fetchThreadDetail: vi.fn(() => Promise.resolve(detailOf(turn))),
      });
      await runExecutionPass(context);
      expect(context.postResults).toHaveBeenCalledOnce();
    }
  });

  it("withholds when the interrupt id left the turn's pending set — the cross-tab stale replay", async () => {
    for (const turn of [
      turnOf({ pending_interrupt_ids: ["v1:tool_call:t2"], awaiting_round: 1 }),
      turnOf({ pending_interrupt_ids: [], awaiting_round: null }),
    ]) {
      const context = contextOf({
        fetchThreadDetail: vi.fn(() => Promise.resolve(detailOf(turn))),
      });
      await runExecutionPass(context);
      expect(context.postResults).not.toHaveBeenCalled();
      expect(context.inbox.entries()[0]?.status).toEqual({ kind: "pending" });
    }
  });

  it("still re-POSTs a stored outcome after the id left the pending set — membership gates fresh execution only", async () => {
    const visited: string[] = [];
    const context = contextOf({
      handlers: executionHandlersFor(
        (path) => {
          visited.push(path);
        },
        null,
        "thread-under-test",
      ),
      fetchThreadDetail: vi.fn(() =>
        Promise.resolve(
          detailOf(turnOf({ pending_interrupt_ids: [], awaiting_round: null })),
        ),
      ),
    });
    recordExecutionClaimed(context.threadId, INTERRUPT_ID);
    recordExecutedOutcome(context.threadId, INTERRUPT_ID, {
      ok: true,
      result: { navigated: true, path: "/memory" },
    });
    await runExecutionPass(context);
    expect(visited).toEqual([]);
    expect(context.postResults).toHaveBeenCalledOnce();
  });

  it("degrades to the status+run gate against a server that predates the pending set", async () => {
    const legacyTurn = turnOf({});
    // Field-absent is an old server, not a resolved pause — deleting the
    // key is the only way to say that in a required-field type.
    delete (legacyTurn as Partial<ServingAssistantTurn>).pending_interrupt_ids;
    delete (legacyTurn as Partial<ServingAssistantTurn>).awaiting_round;
    const context = contextOf({
      fetchThreadDetail: vi.fn(() => Promise.resolve(detailOf(legacyTurn))),
    });
    await runExecutionPass(context);
    expect(context.postResults).toHaveBeenCalledOnce();
  });

  it("answers a kind with no handler using the canned unsupported error", async () => {
    const context = contextOf({
      handlers: executionHandlersFor(null, null, "thread-under-test"),
    });
    await runExecutionPass(context);
    expect(context.postResults).toHaveBeenCalledWith(TURN_ID, {
      results: [
        {
          interrupt_id: INTERRUPT_ID,
          ok: false,
          error: { ...KIND_UNSUPPORTED_OUTCOME.error },
        },
      ],
    });
  });

  it("reconnects after a delivery that restarted a parked turn's workflow", async () => {
    const context = contextOf({
      postResults: vi.fn(() =>
        Promise.resolve(deliveredOf({ delivery: "workflow_restarted" })),
      ),
    });
    await runExecutionPass(context);
    expect(context.onWorkflowRestarted).toHaveBeenCalledOnce();
  });

  it("treats a non-null notice as terminal — reported, and never a reconnect", async () => {
    const context = contextOf({
      postResults: vi.fn(() =>
        Promise.resolve(
          deliveredOf({
            delivery: "already_recorded",
            notice: "Already recorded; do not retry.",
          }),
        ),
      ),
    });
    await runExecutionPass(context);
    expect(context.inbox.entries()[0]?.status).toEqual({
      kind: "reported",
      ok: true,
    });
    expect(context.onWorkflowRestarted).not.toHaveBeenCalled();
  });

  it("marks the run stale on the 409 — the whole pause is over server-side", async () => {
    const context = contextOf({
      postResults: vi.fn(() =>
        Promise.reject(
          new ServingApiError({
            code: "ASSISTANT_TURN_NOT_AWAITING_TOOL_RESULTS",
            status: 409,
            message: "This turn is not awaiting tool results.",
            retryAfterSeconds: null,
          }),
        ),
      ),
    });
    await runExecutionPass(context);
    expect(context.inbox.entries()[0]?.status).toEqual({ kind: "stale" });
    expect(context.attempts.get(INTERRUPT_ID)).toBeUndefined();
  });

  it("returns a transport-failed delivery to pending, counting the attempt — and skips the entry once attempts exhaust", async () => {
    const context = contextOf({
      postResults: vi.fn(() => Promise.reject(new Error("network down"))),
    });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await runExecutionPass(context);
      expect(context.attempts.get(INTERRUPT_ID)).toBe(attempt);
      expect(context.inbox.entries()[0]?.status).toEqual({ kind: "pending" });
    }
    await runExecutionPass(context);
    expect(context.postResults).toHaveBeenCalledTimes(3);
  });

  it("executes exactly once across a retried delivery — the ledger, not the transport, owns at-most-once", async () => {
    const visited: string[] = [];
    const posts: unknown[] = [];
    const context = contextOf({
      handlers: executionHandlersFor(
        (path) => {
          visited.push(path);
        },
        null,
        "thread-under-test",
      ),
      postResults: vi.fn(
        (turnId: string, request: ResolveTurnToolResultsRequest) => {
          posts.push(request);
          if (posts.length === 1) {
            return Promise.reject(new Error("network down"));
          }
          return Promise.resolve(deliveredOf());
        },
      ),
    });
    await runExecutionPass(context);
    await runExecutionPass(context);
    expect(visited).toEqual(["/memory"]);
    expect(posts).toHaveLength(2);
    expect(posts[0]).toEqual(posts[1]);
  });

  it("leaves everything untouched when the thread read fails — the next pass is the recovery", async () => {
    const context = contextOf({
      fetchThreadDetail: vi.fn(() => Promise.reject(new Error("network down"))),
    });
    await runExecutionPass(context);
    expect(context.postResults).not.toHaveBeenCalled();
    expect(context.inbox.entries()[0]?.status).toEqual({ kind: "pending" });
  });
});

// --- a coworker's request --------------------------------------------

const COWORKER_INTERRUPT_ID = "v1:tool_call:cw-1";
const DISPATCHING_TURN_ID = "turn-dispatching";
const COWORKER_INTENT: Record<string, unknown> = {
  action: { slug: "refund", title: "Refund an order" },
  method: "POST",
  path_template: "/orders/{order_id}/refund",
  path_params: { order_id: "41" },
  query: {},
  body: {},
};

function coworkerRequestOf() {
  return {
    ordinal: 3,
    label: "Refund order 41.",
    child_session_id: "subagent-thread-3",
    round: 0,
    expires_at: "2026-09-16T00:05:00Z",
    parked: false,
    card: {
      interrupt_id: COWORKER_INTERRUPT_ID,
      tool_name: "action__refund",
      tool_call_id: "cw-run-a1-t1",
      round: 0,
      request: { kind: HTTP_INTENT_REQUEST_KIND, intent: COWORKER_INTENT },
    },
  };
}

/** The dispatching turn as REST serves it: long SUCCEEDED, its own pause
 *  fields empty, the coworker's request listed on the side. */
function dispatchingTurnOf(
  requests: ReturnType<typeof coworkerRequestOf>[],
): ServingAssistantTurn {
  return turnOf({
    id: DISPATCHING_TURN_ID,
    status: "succeeded",
    run_id: "run-dispatching",
    pending_interrupt_ids: [],
    awaiting_round: null,
    pending_coworker_executions: requests,
  });
}

function coworkerInbox(): ExecutionInbox {
  const inbox = new ExecutionInbox();
  inbox.adoptCoworkerRequests([dispatchingTurnOf([coworkerRequestOf()])]);
  return inbox;
}

describe("runExecutionPass over a coworker's request", () => {
  it("executes the http_intent through the host adapter and POSTs to the DISPATCHING turn, naming the coworker", async () => {
    const executeActionIntent = vi.fn(() =>
      Promise.resolve({ status: 200, body: { refunded: true } }),
    );
    const context = contextOf({
      inbox: coworkerInbox(),
      handlers: executionHandlersFor(null, executeActionIntent, "thread-cw"),
      fetchThreadDetail: vi.fn(() =>
        Promise.resolve(
          detailOfTurns([
            dispatchingTurnOf([coworkerRequestOf()]),
            // A newer member turn, settled: never the address.
            turnOf({ id: "turn-newer", status: "succeeded", run_id: "run-9" }),
          ]),
        ),
      ),
    });

    await runExecutionPass(context);

    expect(executeActionIntent).toHaveBeenCalledTimes(1);
    expect(context.postResults).toHaveBeenCalledWith(DISPATCHING_TURN_ID, {
      results: [
        {
          interrupt_id: COWORKER_INTERRUPT_ID,
          ok: true,
          result: { status: 200, body: { refunded: true } },
          coworker_ordinal: 3,
        },
      ],
    });
    expect(context.inbox.entries()[0]?.status).toEqual({
      kind: "reported",
      ok: true,
    });
    // signaled: the parent stream needs no reconnect.
    expect(context.onWorkflowRestarted).not.toHaveBeenCalled();
  });

  it("does nothing while REST no longer lists the request — the snapshot is the acting authority", async () => {
    const executeActionIntent = vi.fn(() =>
      Promise.resolve({ status: 200, body: {} }),
    );
    const context = contextOf({
      inbox: coworkerInbox(),
      handlers: executionHandlersFor(null, executeActionIntent, "thread-cw"),
      fetchThreadDetail: vi.fn(() =>
        Promise.resolve(detailOfTurns([dispatchingTurnOf([])])),
      ),
    });

    await runExecutionPass(context);

    expect(executeActionIntent).not.toHaveBeenCalled();
    expect(context.postResults).not.toHaveBeenCalled();
    expect(context.inbox.entries()[0]?.status).toEqual({ kind: "pending" });
  });

  it("a stored outcome with no listing re-POSTs to the dispatching turn — where the evidence arm expects it", async () => {
    const inbox = coworkerInbox();
    const context = contextOf({
      inbox,
      handlers: executionHandlersFor(null, null, "thread-cw"),
      fetchThreadDetail: vi.fn(() =>
        Promise.resolve(
          detailOfTurns([
            dispatchingTurnOf([]),
            turnOf({ id: "turn-newer", status: "succeeded", run_id: "run-9" }),
          ]),
        ),
      ),
    });
    recordExecutionClaimed(context.threadId, COWORKER_INTERRUPT_ID);
    recordExecutedOutcome(context.threadId, COWORKER_INTERRUPT_ID, {
      ok: true,
      result: { status: 200, body: {} },
    });

    await runExecutionPass(context);

    expect(context.postResults).toHaveBeenCalledWith(
      DISPATCHING_TURN_ID,
      expect.objectContaining({
        results: [expect.objectContaining({ coworker_ordinal: 3 })],
      }),
    );
  });

  it("a 409 stales the coworker's request alone — the assistant's own pause is untouched", async () => {
    const inbox = coworkerInbox();
    inbox.noteRunStarted(RUN_ID);
    inbox.noteExecutionRequested({
      interrupt_id: INTERRUPT_ID,
      tool_name: "navigate",
      tool_call_id: TOOL_CALL_ID,
      round: 0,
      request: { kind: NAVIGATE_REQUEST_KIND, action: { path: "/memory" } },
    });
    const context = contextOf({
      inbox,
      handlers: executionHandlersFor(
        () => undefined,
        () => Promise.resolve({ status: 200, body: {} }),
        "thread-cw",
      ),
      fetchThreadDetail: vi.fn(() =>
        Promise.resolve(
          detailOfTurns([dispatchingTurnOf([coworkerRequestOf()]), turnOf({})]),
        ),
      ),
      postResults: vi.fn((turnId: string) =>
        turnId === DISPATCHING_TURN_ID
          ? Promise.reject(
              new ServingApiError({
                code: "ASSISTANT_TURN_NOT_AWAITING_TOOL_RESULTS",
                status: 409,
                message: "The coworker can no longer be reached.",
                retryAfterSeconds: null,
              }),
            )
          : Promise.resolve(deliveredOf()),
      ),
    });

    await runExecutionPass(context);

    const statuses = new Map(
      context.inbox.entries().map((e) => [e.interruptId, e.status.kind]),
    );
    expect(statuses.get(COWORKER_INTERRUPT_ID)).toBe("stale");
    expect(statuses.get(INTERRUPT_ID)).toBe("reported");
  });

  it("a stored outcome whose dispatching turn is off the fetched window waits — never the newest turn's door", async () => {
    // The assistant's own fallback (the newest turn, backstopped by the
    // door's 409) does not apply: the coworker arms key on the ordinal
    // thread-wide and the posted turn's status, so a wrong turn could
    // deliver under a pause that never asked or dodge the off-page refusal.
    const inbox = coworkerInbox();
    const context = contextOf({
      inbox,
      handlers: executionHandlersFor(null, null, "thread-cw"),
      fetchThreadDetail: vi.fn(() =>
        Promise.resolve(
          detailOfTurns([
            turnOf({
              id: "turn-newer",
              status: "awaiting_input",
              run_id: "run-9",
            }),
          ]),
        ),
      ),
    });
    recordExecutionClaimed(context.threadId, COWORKER_INTERRUPT_ID);
    recordExecutedOutcome(context.threadId, COWORKER_INTERRUPT_ID, {
      ok: true,
      result: { status: 200, body: {} },
    });

    await runExecutionPass(context);

    expect(context.postResults).not.toHaveBeenCalled();
    expect(inbox.entries()[0]?.status).toEqual({ kind: "pending" });
    // The wait is BOUNDED: the arm counts a delivery attempt like every
    // other arm that returns an entry to pending, so the driver's next pass
    // rides the retry cadence and the cap parks the entry.
    expect(context.attempts.get(COWORKER_INTERRUPT_ID)).toBe(1);
  });
});
