// The conversation-store test family's shared harness. Factories, the
// minted-store registry, and the load-bearing
// dispose-before-useRealTimers afterEach live here as ONE unit; each
// family file carries its own `// @vitest-environment jsdom` pragma and
// serving-api vi.mock block (vi.mock is hoisted per test file and cannot
// live in a shared module — the beforeEach guard below throws loudly if
// a file forgot it), then calls installConversationStoreLifecycle() at
// top level.

import { afterEach, beforeEach, vi, type MockInstance } from "vitest";

import type { RunAgentResult } from "@ag-ui/client";

import type {
  AssistantThreadDetailResponse,
  ServingAssistantThread,
  ServingAssistantTurn,
} from "../src/contract/threads";
import {
  AssistantConversationStore,
  type ConversationStoreDeps,
} from "../src/core/conversation-store";
import { ServingReplayStreamAgent } from "../src/transport/replay-stream-agent";
import {
  getAssistantThread,
  listAssistantThreads,
  sendAssistantMessage,
  stopAssistantTurn,
} from "../src/transport/serving-api";
import type { TokenSession } from "../src/transport/token-session";

export const PK = "pk_test_store";
export const SESSION = {} as TokenSession;

export function threadOf(
  overrides: Partial<ServingAssistantThread> = {},
): ServingAssistantThread {
  return {
    id: "thread-1",
    title: "A conversation",
    busy: false,
    stream_thread_id: "stream-thread-1",
    created_at: "2026-07-29T00:00:00Z",
    updated_at: "2026-07-29T00:00:00Z",
    ...overrides,
  };
}

export function turnOf(
  overrides: Partial<ServingAssistantTurn> = {},
): ServingAssistantTurn {
  return {
    id: "turn-1",
    thread_id: "thread-1",
    user_message: "hello",
    kind: null,
    status: "succeeded",
    error: null,
    run_id: "run-1",
    pending_interrupt_ids: [],
    awaiting_round: 0,
    pending_approvals: [],
    created_at: "2026-07-29T00:00:00Z",
    updated_at: "2026-07-29T00:00:00Z",
    ...overrides,
  };
}

export function detailOf(
  thread: ServingAssistantThread,
  turns: ServingAssistantTurn[] = [turnOf()],
): AssistantThreadDetailResponse {
  return { thread, turns };
}

// Every store a family file mints is disposed by the afterEach
// installConversationStoreLifecycle registers below — an undisposed
// store is the react-18 peer-floor gate's intra-file flake. (The
// conversation-store suite is a FAMILY of test files sharing this
// harness; vitest isolates each file's module graph, so every file gets
// its own registry and hooks.)
//
// The mechanism it closes: stores minted here hold NATIVE timers no
// vitest teardown clears, and the connectAgent/detachActiveRun spies
// live on ServingReplayStreamAgent.prototype, so an undisposed store
// from ANY earlier test dispatches into the CURRENT test's spy count.
// The measured chain behind the fixture reds (5 in 18 instrumented
// full-suite runs; every observed solo run stayed green even though
// the same ghost activity fired there — it never happened to land in
// the assert's window): a mock restore exposes the real connectAgent
// to a leaked store's pending connect sync; the real transport dies
// over this file's empty TokenSession; the run-failed event reaches
// handleStreamError, which arms the 400ms settle-refresh setTimeout;
// that native timer fires inside a later fixture's real-loop yield
// (await vi.advanceTimersByTimeAsync(0)), refreshes against that
// test's getAssistantThread mock, remints an epoch, and lands an
// extra connectAgent on the fresh spy — toHaveBeenCalledTimes(1)
// reads 2.
//
// Why disposal is sufficient (the premise, verified in source): a
// disposed store can never reach connectAgent. syncConnection
// (connection-driver.ts) gates on _disposed with no await between the
// gate and the STORE's one
// connectAgent call site (the component call sites in
// child-transcript/assistant-transcript never mount here); every
// settlesFor loop re-checks disposal behind each await — the stop
// probe via _stopLostItsThread, the delivery probe via
// _deliveryProbeMoot, the workflow-restart reclaim's explicit
// _disposed checks, and _connectionEnded via _connectionDecisionMoot;
// syncEpoch retires and mints nothing once disposed;
// scheduleConnectionSync refuses to queue; dispose() itself clears
// the settle timer, gap probe, and idle interval outright. The one
// revival hazard — bootstrap() clears _disposed — cannot fire after
// the hook's dispose, because bootstrap() is called only from test
// bodies (the family's dispose→bootstrap StrictMode revival tests
// revive mid-test, before the hook) and each test's stores are
// disposed in that same test's afterEach pass; leaked continuations
// that resume later stay disposal-gated no-ops.
//
// The class, swept: this factory is the conversation-store family's
// only construction site — each family file installs this lifecycle —
// so registration cannot be bypassed silently; the criterion is
// structural, not a census. composer-draft-reconnect.test.tsx
// constructs one store and already disposes it in its own afterEach; no
// other test file constructs AssistantConversationStore (fakes only).
const mintedStores = new Set<AssistantConversationStore>();

export function aStore(overrides: Partial<ConversationStoreDeps> = {}) {
  const store = new AssistantConversationStore({
    session: SESSION,
    publishableKey: PK,
    hostCapabilitiesOf: () => ({ navigate: null, executeActionIntent: null }),
    reportError: vi.fn(),
    onTelemetry: vi.fn(),
    onGateRefusal: vi.fn(),
    onTurnSettled: vi.fn(),
    ...overrides,
  });
  mintedStores.add(store);
  return store;
}

export async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// The wire shape does not matter to the store — only that the
// connection ended; every recorder consumed its events long before.
export const RUN_ENDED = {} as RunAgentResult;

export let connectAgent: MockInstance<
  (typeof ServingReplayStreamAgent.prototype)["connectAgent"]
>;
export let detachActiveRun: MockInstance<
  (typeof ServingReplayStreamAgent.prototype)["detachActiveRun"]
>;

export function installConversationStoreLifecycle(): void {
  beforeEach(() => {
    if (!vi.isMockFunction(getAssistantThread)) {
      throw new Error(
        "this test file must carry the serving-api vi.mock block — " +
          "see the harness header",
      );
    }
  });

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(getAssistantThread).mockReset();
    vi.mocked(listAssistantThreads).mockReset();
    vi.mocked(sendAssistantMessage).mockReset();
    vi.mocked(stopAssistantTurn).mockReset();
    // No real socket ever: a pending-forever connection is the neutral
    // stand-in (tests that need the connection to END override this).
    connectAgent = vi
      .spyOn(ServingReplayStreamAgent.prototype, "connectAgent")
      .mockImplementation(() => new Promise<never>(() => undefined));
    detachActiveRun = vi
      .spyOn(ServingReplayStreamAgent.prototype, "detachActiveRun")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    // Dispose FIRST, before useRealTimers and restoreAllMocks: while the
    // test's timer regime is still installed, dispose's clearTimeout/
    // clearInterval address the same clock that minted the handles. That
    // matching is an invariant of EVERY FAMILY FILE, not a property of
    // the store: every vi.useFakeTimers() precedes any store creation
    // in its test, and no test switches regimes mid-test (the only
    // vi.useRealTimers() is this hook's own, after the dispose loop). It
    // matters because a handle that survived a mismatched clear would
    // NOT be harmless — the settle timer's callback and the idle
    // interval's tick reach refreshConversation with no _disposed
    // re-check, and refreshConversation gates only on _active, which
    // dispose() never clears — so it would land getAssistantThread
    // reads in later tests. Only the extra connectAgent is unreachable
    // post-dispose, via the connection/epoch sync gates, never via the
    // timer callbacks themselves.
    // And while the prototype spies are still installed, retireEpoch's
    // detachActiveRun goes through the mock, never the real transport.
    // One store's throwing dispose must not leave its siblings leaked.
    const failures: unknown[] = [];
    for (const store of mintedStores) {
      try {
        store.dispose();
      } catch (error) {
        failures.push(error);
      }
    }
    mintedStores.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (failures.length > 0) {
      throw failures[0];
    }
  });
}
