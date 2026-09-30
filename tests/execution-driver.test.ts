import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AssistantThreadDetailResponse,
  ResolveTurnToolResultsResponse,
  ServingAssistantThread,
  ServingAssistantTurn,
} from "../src/contract/threads";
import {
  ExecutionDriver,
  type ExecutionDriverDeps,
} from "../src/core/execution-driver";
import {
  ASK_QUESTIONS_REQUEST_KIND,
  KIND_UNSUPPORTED_OUTCOME,
  NAVIGATE_REQUEST_KIND,
} from "../src/core/execution-handlers";
import { ExecutionInbox } from "../src/core/execution-inbox";
import {
  recordExecutedOutcome,
  recordExecutionClaimed,
} from "../src/persistence/execution-ledger";

const RUN_ID = "run-1";
const TOOL_CALL_ID = "run-1-a1-t1";
const INTERRUPT_ID = "v1:tool_call:t1";
const TURN_ID = "turn-1";

// The ledger keys on the thread id and lives in module memory under node —
// unique ids isolate the tests.
let threadCounter = 0;
function freshThreadId(): string {
  threadCounter += 1;
  return `driver-thread-${String(threadCounter)}`;
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

function deliveredOf(): ResolveTurnToolResultsResponse {
  return { delivery: "signaled", turn: turnOf({}), notice: null };
}

function aDriver(overrides: Partial<ExecutionDriverDeps> = {}) {
  const inbox = overrides.inbox ?? pausedInbox();
  const deps: ExecutionDriverDeps = {
    inbox,
    threadId: freshThreadId(),
    handlersOf: () =>
      new Map([
        [
          NAVIGATE_REQUEST_KIND,
          vi.fn().mockResolvedValue({ ok: true, result: { ok: true } }),
        ],
      ]),
    fetchThreadDetail: vi.fn(() => Promise.resolve(detailOf(turnOf({})))),
    postResults: vi.fn(() => Promise.resolve(deliveredOf())),
    publishEntries: vi.fn(),
    onWorkflowRestarted: vi.fn(),
    ...overrides,
  };
  return { driver: new ExecutionDriver(deps), deps, inbox };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ExecutionDriver", () => {
  it("drains a pending entry one quiet delay after it is noted", async () => {
    const { driver, deps, inbox } = aDriver();

    driver.noteEntriesChanged(inbox.entries());
    expect(deps.postResults).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(400);

    expect(deps.postResults).toHaveBeenCalledTimes(1);
    expect(inbox.entries()[0]?.status.kind).toBe("reported");
  });

  it("resets the pending timer on every note, firing once after the latest", async () => {
    const { driver, deps, inbox } = aDriver();

    driver.noteEntriesChanged(inbox.entries());
    await vi.advanceTimersByTimeAsync(300);
    driver.noteEntriesChanged(inbox.entries());
    await vi.advanceTimersByTimeAsync(300);

    expect(deps.postResults).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(deps.postResults).toHaveBeenCalledTimes(1);
  });

  it("retries a failed delivery on the slower cadence", async () => {
    const { driver, deps, inbox } = aDriver({
      postResults: vi.fn(() => Promise.reject(new Error("network down"))),
    });

    driver.noteEntriesChanged(inbox.entries());
    await vi.advanceTimersByTimeAsync(400);
    expect(deps.postResults).toHaveBeenCalledTimes(1);
    expect(inbox.entries()[0]?.status.kind).toBe("pending");

    // The retry rides the slower cadence: nothing at the pass delay…
    driver.noteEntriesChanged(inbox.entries());
    await vi.advanceTimersByTimeAsync(400);
    expect(deps.postResults).toHaveBeenCalledTimes(1);

    // …and the re-POST at the retry delay.
    await vi.advanceTimersByTimeAsync(1600);
    expect(deps.postResults).toHaveBeenCalledTimes(2);
  });

  it("stops re-attempting after the delivery attempt cap", async () => {
    const { driver, deps, inbox } = aDriver({
      postResults: vi.fn(() => Promise.reject(new Error("network down"))),
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      driver.noteEntriesChanged(inbox.entries());
      await vi.advanceTimersByTimeAsync(2000);
    }

    // MAX_DELIVERY_ATTEMPTS = 3: the exhausted entry stays pending for
    // the NEXT connection's driver, which owns a fresh attempts map.
    expect(deps.postResults).toHaveBeenCalledTimes(3);
    expect(inbox.entries()[0]?.status.kind).toBe("pending");
  });

  it("a coworker's off-window stored outcome rides the retry cadence and the cap — never a 400 ms spin of thread-detail reads", async () => {
    const inbox = new ExecutionInbox();
    inbox.adoptCoworkerRequests([
      {
        id: "turn-dispatching",
        run_id: "run-dispatching",
        pending_coworker_executions: [
          {
            ordinal: 3,
            label: "Refund order 41.",
            child_session_id: "subagent-thread-3",
            round: 0,
            expires_at: "2026-09-16T00:05:00Z",
            parked: false,
            card: {
              interrupt_id: "v1:tool_call:cw-1",
              tool_name: "action__refund",
              tool_call_id: "cw-run-a1-t1",
              round: 0,
              request: { kind: "http_intent", intent: { method: "POST" } },
            },
          },
        ],
      },
    ]);
    const fetchThreadDetail = vi.fn(() =>
      // The window no longer holds the dispatching turn.
      Promise.resolve(detailOf(turnOf({ id: "turn-newer" }))),
    );
    const { driver, deps } = aDriver({ inbox, fetchThreadDetail });
    recordExecutionClaimed(deps.threadId, "v1:tool_call:cw-1");
    recordExecutedOutcome(deps.threadId, "v1:tool_call:cw-1", {
      ok: true,
      result: { status: 200, body: {} },
    });

    driver.noteEntriesChanged(inbox.entries());
    await vi.advanceTimersByTimeAsync(400);
    expect(fetchThreadDetail).toHaveBeenCalledTimes(1);
    // The pass returned the entry to pending and published (the epoch
    // pokes the driver on every publish — here the harness does): the
    // re-armed pass must sit on the RETRY cadence, not the quiet delay.
    driver.noteEntriesChanged(inbox.entries());
    await vi.advanceTimersByTimeAsync(400);
    expect(fetchThreadDetail).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1600);
    expect(fetchThreadDetail).toHaveBeenCalledTimes(2);
    // And the cap ends it: however often the entries publish, the reads
    // stop once the attempts are spent (MAX_DELIVERY_ATTEMPTS).
    for (let publish = 0; publish < 5; publish += 1) {
      driver.noteEntriesChanged(inbox.entries());
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(fetchThreadDetail).toHaveBeenCalledTimes(3);
    expect(deps.postResults).not.toHaveBeenCalled();
    expect(inbox.entries()[0]?.status.kind).toBe("pending");
  });

  it("runs one pass at a time and queues exactly one follow-up", async () => {
    let releaseFetch: (detail: AssistantThreadDetailResponse) => void = () => {
      throw new Error("fetch was never awaited");
    };
    const gatedFetch = new Promise<AssistantThreadDetailResponse>((resolve) => {
      releaseFetch = resolve;
    });
    const fetchThreadDetail = vi
      .fn<() => Promise<AssistantThreadDetailResponse>>()
      .mockReturnValueOnce(gatedFetch)
      .mockImplementation(() => Promise.resolve(detailOf(turnOf({}))));
    const { driver, deps, inbox } = aDriver({ fetchThreadDetail });

    driver.noteEntriesChanged(inbox.entries());
    await vi.advanceTimersByTimeAsync(400);
    // The pass is now parked on the gated fetch; two more notes land
    // mid-pass and must coalesce into a single follow-up pass.
    driver.noteEntriesChanged(inbox.entries());
    await vi.advanceTimersByTimeAsync(400);
    driver.noteEntriesChanged(inbox.entries());
    await vi.advanceTimersByTimeAsync(400);

    releaseFetch(detailOf(turnOf({})));
    await vi.advanceTimersByTimeAsync(0);

    expect(deps.postResults).toHaveBeenCalledTimes(1);
    // First pass + at most the one queued follow-up.
    expect(fetchThreadDetail.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("dispose clears the pending timer but lets an in-flight pass finish", async () => {
    let releasePost: (
      response: ResolveTurnToolResultsResponse,
    ) => void = () => {
      throw new Error("post was never awaited");
    };
    const gatedPost = new Promise<ResolveTurnToolResultsResponse>((resolve) => {
      releasePost = resolve;
    });
    const { driver, deps, inbox } = aDriver({
      postResults: vi.fn(() => gatedPost),
    });

    driver.noteEntriesChanged(inbox.entries());
    await vi.advanceTimersByTimeAsync(400);
    expect(deps.postResults).toHaveBeenCalledTimes(1);

    driver.dispose();
    releasePost(deliveredOf());
    await vi.advanceTimersByTimeAsync(0);

    // The in-flight POST settled the entry even though the driver died.
    expect(inbox.entries()[0]?.status.kind).toBe("reported");
  });

  it("ignores notes after dispose", async () => {
    const { driver, deps, inbox } = aDriver();

    driver.dispose();
    driver.noteEntriesChanged(inbox.entries());
    await vi.advanceTimersByTimeAsync(4000);

    expect(deps.postResults).not.toHaveBeenCalled();
  });
});

describe("member-answerable kinds (question sets included)", () => {
  const SET_INTERRUPT_ID = "v1:tool_call:q1:member-answers";

  function questionSetRequested(inbox: ExecutionInbox): void {
    inbox.noteExecutionRequested({
      interrupt_id: SET_INTERRUPT_ID,
      tool_name: "ask_user",
      tool_call_id: "run-1-q1",
      round: 0,
      request: {
        kind: ASK_QUESTIONS_REQUEST_KIND,
        action: {
          questions: [{ id: "plan", heading: "Plan", prompt: "Which plan?" }],
        },
      },
    });
  }

  it("never auto-answers a question-set entry — the member is its executor", async () => {
    const inbox = new ExecutionInbox();
    inbox.noteRunStarted(RUN_ID);
    questionSetRequested(inbox);
    const { driver, deps } = aDriver({ inbox });

    driver.noteEntriesChanged(inbox.entries());
    await vi.runAllTimersAsync();

    // No pass ever acted: no REST read, no POST, and the entry stays
    // pending for the member's own submit.
    expect(deps.fetchThreadDetail).not.toHaveBeenCalled();
    expect(deps.postResults).not.toHaveBeenCalled();
    const [entry] = inbox.entries();
    expect(entry.status).toEqual({ kind: "pending" });
  });

  it("still drains sibling kinds beside a pending question set", async () => {
    const inbox = pausedInbox();
    questionSetRequested(inbox);
    const postResults = vi.fn(() => Promise.resolve(deliveredOf()));
    const { driver } = aDriver({
      inbox,
      postResults,
      fetchThreadDetail: vi.fn(() =>
        Promise.resolve(
          detailOf(
            turnOf({
              pending_interrupt_ids: [INTERRUPT_ID, SET_INTERRUPT_ID],
            }),
          ),
        ),
      ),
    });

    driver.noteEntriesChanged(inbox.entries());
    await vi.runAllTimersAsync();

    // Exactly the navigate entry was served; the set stayed pending.
    expect(postResults).toHaveBeenCalledTimes(1);
    expect(postResults).toHaveBeenCalledWith(TURN_ID, {
      results: [{ interrupt_id: INTERRUPT_ID, ok: true, result: { ok: true } }],
    });
    const set = inbox
      .entries()
      .find((entry) => entry.interruptId === SET_INTERRUPT_ID);
    expect(set?.status).toEqual({ kind: "pending" });
  });

  it("answers a stored record of the retired one-question kind kind_unsupported — an explicit degrade, never an invisible wait", async () => {
    // The one-question ask (builtin.ask_user) is retired with its card
    // and pickers. A pause persisted before that — a stored
    // tool_execution_requested marker still carrying the kind — is no
    // member's to answer: the driver serves it like any kind this
    // client has no handler for, posting the canned unsupported error
    // that the server turns into "ask it in chat".
    const RETIRED_INTERRUPT_ID = "v1:tool_call:a1:member-answer-0";
    const inbox = new ExecutionInbox();
    inbox.noteRunStarted(RUN_ID);
    inbox.noteExecutionRequested({
      interrupt_id: RETIRED_INTERRUPT_ID,
      tool_name: "ask_user",
      tool_call_id: "run-1-a1",
      round: 0,
      request: {
        kind: "builtin.ask_user",
        action: { schema: { kind: "boolean" }, prompt: "Proceed by email?" },
      },
    });
    const postResults = vi.fn(() => Promise.resolve(deliveredOf()));
    const { driver } = aDriver({
      inbox,
      postResults,
      fetchThreadDetail: vi.fn(() =>
        Promise.resolve(
          detailOf(turnOf({ pending_interrupt_ids: [RETIRED_INTERRUPT_ID] })),
        ),
      ),
    });

    driver.noteEntriesChanged(inbox.entries());
    await vi.runAllTimersAsync();

    expect(postResults).toHaveBeenCalledTimes(1);
    expect(postResults).toHaveBeenCalledWith(TURN_ID, {
      results: [
        {
          interrupt_id: RETIRED_INTERRUPT_ID,
          ok: false,
          error: { ...KIND_UNSUPPORTED_OUTCOME.error },
        },
      ],
    });
    const [entry] = inbox.entries();
    expect(entry.status).toEqual({ kind: "reported", ok: false });
  });
});

describe("post-restart reconnect (review round 4)", () => {
  it("an oversize-dropped restart still reconnects — delivery alone decides", async () => {
    // The door pairs the oversize notice with a DELIVERED restart of a
    // parked turn; the reconnect must fire anyway or the transcript
    // freezes on the dead run (the submit paths' law).
    const onWorkflowRestarted = vi.fn();
    const { driver, inbox } = aDriver({
      onWorkflowRestarted,
      postResults: vi.fn(() =>
        Promise.resolve({
          delivery: "workflow_restarted",
          turn: turnOf({ status: "parked" }),
          notice: "A reported result exceeded the cap and was dropped.",
        } as ResolveTurnToolResultsResponse),
      ),
      fetchThreadDetail: vi.fn(() =>
        Promise.resolve(detailOf(turnOf({ status: "parked" }))),
      ),
    });

    driver.noteEntriesChanged(inbox.entries());
    await vi.runAllTimersAsync();

    expect(onWorkflowRestarted).toHaveBeenCalledTimes(1);
  });
});
