// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { ServingAssistantTurn } from "../src/contract/threads";
import type { ApprovalInbox } from "../src/core/approval-inbox";
import type { AssistantConversationStore } from "../src/core/conversation-store";
import { writeStoredThread } from "../src/persistence/stored-thread";
import { getAssistantThread } from "../src/transport/serving-api";

vi.mock("../src/transport/serving-api", () => ({
  getAssistantThread: vi.fn(),
  listAssistantThreads: vi.fn(),
  sendAssistantMessage: vi.fn(),
  stopAssistantTurn: vi.fn(),
  resolveTurnApproval: vi.fn(),
  resolveTurnToolResults: vi.fn(),
  streamUrlForThread: vi.fn(
    () => "https://api.example.test/serving/v1/assistant-threads/x/stream",
  ),
}));

import {
  aStore,
  connectAgent,
  detailOf,
  installConversationStoreLifecycle,
  PK,
  settled,
  threadOf,
  turnOf,
} from "./conversation-store-harness";

installConversationStoreLifecycle();

describe("REST recovery of pending approval cards", () => {
  const INTERRUPT = "v1:before_tool_call:t1:handler";

  function approvalPayload(interruptId = INTERRUPT) {
    return {
      interrupt_id: interruptId,
      tool_name: "submit-doc-draft",
      tool_args: { title: "Refund policy", body_md: "# Refund policy\n\n…" },
      tool_input_schema: null,
      tool_output_schema: null,
      prompt: "Submit this draft for review?",
      tool_call_id: "run-1-a1-t1",
      round: 0,
      gated: false,
      trust_available: false,
    };
  }

  function awaitingTurn(overrides: Partial<ServingAssistantTurn> = {}) {
    return turnOf({
      id: "t1",
      status: "awaiting_input",
      run_id: "run-1",
      pending_interrupt_ids: [INTERRUPT],
      awaiting_round: 0,
      pending_approvals: [approvalPayload()],
      ...overrides,
    });
  }

  function activeInboxOf(store: AssistantConversationStore): ApprovalInbox {
    return (store as unknown as { _active: { approvalInbox: ApprovalInbox } })
      ._active.approvalInbox;
  }

  it("renders the card from REST when the first stream fetch dies", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [awaitingTurn()]),
    );
    // The incident's exact wire shape: the stream POST never gets a
    // response. The REST read is the only truth left.
    connectAgent.mockImplementation(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    const store = aStore();
    store.bootstrap();
    await settled();

    const [card] = store.approvals.get();
    expect(card).toMatchObject({
      interruptId: INTERRUPT,
      prompt: "Submit this draft for review?",
      toolName: "submit-doc-draft",
      status: { kind: "actionable", errorSentence: null },
    });
    expect(store.approvals.get()).toHaveLength(1);
  });

  it("anchors the recovered card's schemas for the view contract, and absence stays absent", async () => {
    // The REST leg of the schema channel: pending_approvals is the only
    // recovery payload carrying tool_input_schema / tool_output_schema,
    // and the card funnel records them into the same anchors map the
    // stream marker feeds — so a recovered call's mounted view gets its
    // argsSchema exactly as a streamed call's does.
    const inputSchema = { type: "object", properties: { title: {} } };
    const outputSchema = { type: "object", properties: { id: {} } };
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [
        awaitingTurn({
          pending_approvals: [
            {
              ...approvalPayload(),
              tool_input_schema: inputSchema,
              tool_output_schema: outputSchema,
            },
          ],
        }),
      ]),
    );
    connectAgent.mockImplementation(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    const store = aStore();
    store.bootstrap();
    await settled();

    expect(store.approvals.get()).toHaveLength(1);
    expect(
      store.markerAnchors.get().toolSchemaAnchors.get("run-1-a1-t1"),
    ).toEqual({ argsSchema: inputSchema, resultSchema: outputSchema });
  });

  it("a schema-less recovered card anchors nothing — no `{}` invented", async () => {
    // The negative control: the default payload's null schemas must
    // leave the anchors map empty, so the entry above can only have
    // come through the card funnel's conversion.
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [awaitingTurn()]),
    );
    connectAgent.mockImplementation(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    const store = aStore();
    store.bootstrap();
    await settled();

    expect(store.approvals.get()).toHaveLength(1);
    expect(store.markerAnchors.get().toolSchemaAnchors.size).toBe(0);
  });

  it("hydrates the pause's card even behind a QUEUED newer message — queuing retired the newest-turn premise", async () => {
    // A message during a live turn queues, so the newest row can be a
    // QUEUED member turn while the pause sits on an older row.
    // Hydrating from the newest row would silently disable the REST
    // card rebuild exactly when the member must answer to unblock the
    // queued successor.
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    const queuedNewer = turnOf({
      id: "t2-queued",
      status: "queued",
      run_id: null,
      pending_interrupt_ids: [],
      awaiting_round: null,
      pending_approvals: [],
      user_message: "a follow-up sent during the pause",
    });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [awaitingTurn(), queuedNewer]),
    );
    connectAgent.mockImplementation(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    const store = aStore();
    store.bootstrap();
    await settled();

    const [card] = store.approvals.get();
    expect(card).toMatchObject({
      interruptId: INTERRUPT,
      status: { kind: "actionable", errorSentence: null },
    });
    expect(store.approvals.get()).toHaveLength(1);
  });

  it("a later stream replay dedupes the hydrated card instead of doubling it", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [awaitingTurn()]),
    );
    const store = aStore();
    store.bootstrap();
    await settled();
    expect(store.approvals.get()).toHaveLength(1);

    // The reconnect replays the recorded marker through the stream side.
    const inbox = activeInboxOf(store);
    inbox.noteRunStarted("run-1");
    inbox.noteApprovalRequested(approvalPayload());
    expect(inbox.cards()).toHaveLength(1);

    // And repeated REST refreshes stay idempotent too.
    await store.refreshConversation();
    expect(store.approvals.get()).toHaveLength(1);
  });

  it("a reload onto a parked turn preserves the card and its controls", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [awaitingTurn({ status: "parked" })]),
    );
    const store = aStore();
    store.bootstrap();
    await settled();

    const [card] = store.approvals.get();
    expect(card).toMatchObject({
      interruptId: INTERRUPT,
      parked: true,
      status: { kind: "actionable", errorSentence: null },
    });
  });

  it("a stream error's settle refresh hydrates a card the stream never delivered", async () => {
    vi.useFakeTimers();
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    // The first read sees the turn still working — no cards anywhere.
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf({ busy: true }), [
        awaitingTurn({
          status: "working",
          pending_interrupt_ids: [],
          awaiting_round: null,
          pending_approvals: [],
        }),
      ]),
    );
    const store = aStore();
    store.bootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.approvals.get()).toHaveLength(0);

    // The stream dies; by the time the settle refresh re-reads, the turn
    // awaits input and REST carries the snapshot.
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [awaitingTurn()]),
    );
    store.handleStreamError(new Error("socket dropped"));
    await vi.advanceTimersByTimeAsync(1200);

    const [card] = store.approvals.get();
    expect(card).toMatchObject({
      interruptId: INTERRUPT,
      status: { kind: "actionable", errorSentence: null },
    });
  });

  it("a stale refresh racing the stream's closing evidence never resurrects the card", async () => {
    // The window: refreshConversation is fire-and-forget in several
    // places, so a read fired while the pause was live can resolve after
    // the stream already delivered the gated call's result — with a
    // record that still says awaiting_input and still holds the id.
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [awaitingTurn()]),
    );
    const store = aStore();
    store.bootstrap();
    await settled();
    expect(store.approvals.get()).toHaveLength(1);

    // The stream: approved, executed, closed.
    const inbox = activeInboxOf(store);
    inbox.noteRunStarted("run-1");
    inbox.noteToolCallStart("run-1-a1-t1");
    inbox.noteApprovalResolved(INTERRUPT, true);
    inbox.noteToolCallResult("run-1-a1-t1");
    expect(inbox.cards()).toHaveLength(0);

    // The stale read lands: same awaiting record, same snapshot. The
    // closed id must not hydrate back. (The inbox is the assertion
    // target: this test drives the stream evidence directly, bypassing
    // the recorder that would have published the removal.)
    await store.refreshConversation();

    expect(inbox.cards()).toHaveLength(0);
  });

  // --- the recovered cards' display annotations --------------------

  const RECOVERED_DISPLAYS: NonNullable<
    ServingAssistantTurn["pending_approval_displays"]
  > = {
    "run-1-a1-t1": {
      progress_text: "Submitting a draft for review…",
      view: { key: "teaflask.doc-draft", version: 1 },
    },
  };

  it("hydrates the recovered display annotations into the marker anchors", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [
        awaitingTurn({ pending_approval_displays: RECOVERED_DISPLAYS }),
      ]),
    );
    const store = aStore();
    store.bootstrap();
    await settled();

    // The card hydrated AND its annotation reached the anchors map —
    // the display's single client home: the join is what carries the
    // authored copy and the view key to a recovered call with no
    // transcript row to read them from.
    expect(store.approvals.get()).toHaveLength(1);
    expect(
      store.markerAnchors.get().toolCallDisplayAnchors.get("run-1-a1-t1"),
    ).toEqual({
      progressText: "Submitting a draft for review…",
      // Stored verbatim: the anchor map records the wire's ref; the
      // teaflask.* reservation is enforced at RESOLUTION (the reserved
      // namespace resolves only against package built-ins, never the
      // host registry — tool-view.ts), not by destroying the record.
      view: { key: "teaflask.doc-draft", version: 1 },
    });
  });

  it("stays idempotent when the same annotation hydrates again", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [
        awaitingTurn({ pending_approval_displays: RECOVERED_DISPLAYS }),
      ]),
    );
    const store = aStore();
    store.bootstrap();
    await settled();

    // The anchors snapshot is identity-published; a re-read carrying the
    // same annotations must not republish it (the map's first-wins fold
    // returns the held map, exactly as a stream replay's would).
    const before = store.markerAnchors.get();
    await store.refreshConversation();
    expect(store.markerAnchors.get()).toBe(before);
  });

  it("never hydrates displays from a settled record", async () => {
    // A stale read racing the settle: the record went terminal while
    // still carrying the field. The gate (same as the cards') drops it.
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [
        awaitingTurn({
          status: "succeeded",
          pending_interrupt_ids: [],
          awaiting_round: null,
          pending_approvals: [],
          pending_approval_displays: RECOVERED_DISPLAYS,
        }),
      ]),
    );
    const store = aStore();
    store.bootstrap();
    await settled();

    expect(store.markerAnchors.get().toolCallDisplayAnchors.size).toBe(0);
  });

  // --- the recovered cards' asks, for the denial join ------

  function denialLedgerOf(store: AssistantConversationStore) {
    return (
      store as unknown as {
        _active: {
          resume: { toolDenialLedger: { asks: ReadonlyMap<string, string> } };
        };
      }
    )._active.resume.toolDenialLedger;
  }

  function deliverCustomMarker(
    store: AssistantConversationStore,
    name: string,
    value: unknown,
  ) {
    const epoch = (
      store as unknown as {
        _epoch: {
          agent: {
            subscribers: readonly {
              onCustomEvent?: (payload: unknown) => unknown;
            }[];
          };
        } | null;
      }
    )._epoch;
    if (epoch === null) {
      throw new Error("no connection epoch to deliver into");
    }
    for (const subscriber of epoch.agent.subscribers) {
      void subscriber.onCustomEvent?.({
        event: { type: "CUSTOM", name, value },
      });
    }
  }

  it("hydrates the recovered pending approvals into the denial ledger's ask map, so the resumed stream's denial receipt still finds its call", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [awaitingTurn()]),
    );
    // The breaking case for the join: the stream never delivered the
    // ask (the first fetch dies), so REST is the ask's only source —
    // and the approval_resolved that lands on the resumed stream would
    // name an interrupt the ledger never heard of.
    connectAgent.mockImplementation(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    const store = aStore();
    store.bootstrap();
    await settled();

    // The REST leg fed the ask map; asks alone publish nothing.
    expect(denialLedgerOf(store).asks.get(INTERRUPT)).toBe("run-1-a1-t1");
    expect(store.markerAnchors.get().toolDenialAnchors?.size).toBe(0);

    // The resumed stream's receipt, through the real epoch subscribers:
    // the join completes and the denied half publishes.
    deliverCustomMarker(store, "approval_resolved", {
      interrupt_id: INTERRUPT,
      approved: false,
    });
    expect(
      store.markerAnchors.get().toolDenialAnchors?.has("run-1-a1-t1"),
    ).toBe(true);
  });

  it("never hydrates asks from a settled record — the same gate as the cards'", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [
        awaitingTurn({
          status: "succeeded",
          pending_interrupt_ids: [],
          awaiting_round: null,
          pending_approvals: [approvalPayload()],
        }),
      ]),
    );
    const store = aStore();
    store.bootstrap();
    await settled();

    expect(denialLedgerOf(store).asks.size).toBe(0);
  });

  function streamFailuresOf(onTelemetry: ReturnType<typeof vi.fn>) {
    return onTelemetry.mock.calls
      .map(
        ([event]) =>
          event as import("../src/contract/telemetry").AssistantTelemetryEvent,
      )
      .flatMap((event) =>
        event.name === "assistant_stream_failed" ? [event.properties] : [],
      );
  }

  it("classifies and narrates a stream failure without any run content", async () => {
    const onTelemetry = vi.fn();
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [awaitingTurn()]),
    );
    const store = aStore({ onTelemetry });
    store.bootstrap();
    await settled();

    store.handleStreamError(new TypeError("Failed to fetch"));

    // The exact property set is the pin: cursors and class only — no
    // message text, no tool args, no prompts.
    expect(streamFailuresOf(onTelemetry)).toEqual([
      {
        failure_class: "network_rejected",
        status: null,
        thread_id: "thread-1",
        resume_cursor: null,
        last_committed_sse_id: null,
      },
    ]);
  });

  function scannerOf(store: AssistantConversationStore) {
    const agent = store.connection.get()?.agent;
    expect(agent).toBeDefined();
    return (
      agent as unknown as {
        scanner: { lastEventId: string | null; bodyBytesSeen: boolean };
      }
    ).scanner;
  }

  it("reads the same TypeError as mid_stream once this connection committed a frame", async () => {
    const onTelemetry = vi.fn();
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [awaitingTurn()]),
    );
    const store = aStore({ onTelemetry });
    store.bootstrap();
    await settled();

    // The scanner committed an id on this connection — events flowed
    // before the wire died mid-read with the same TypeError shape.
    const scanner = scannerOf(store);
    scanner.bodyBytesSeen = true;
    scanner.lastEventId = "42";
    store.handleStreamError(new TypeError("network error"));

    expect(streamFailuresOf(onTelemetry)).toEqual([
      {
        failure_class: "mid_stream",
        status: null,
        thread_id: "thread-1",
        resume_cursor: null,
        last_committed_sse_id: "42",
      },
    ]);
  });

  it("reads a keepalive-only connection's death as mid_stream, not network_rejected", async () => {
    // The live-but-idle resumed stream: a 200, an open event-stream, and
    // nothing but 15s pings until the edge's idle clock cuts it — close
    // to the production incident's own shape. Pings commit no cursor, so
    // liveness must never be inferred from the replay cursor.
    const onTelemetry = vi.fn();
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf(), [awaitingTurn()]),
    );
    const store = aStore({ onTelemetry });
    store.bootstrap();
    await settled();

    const scanner = scannerOf(store);
    scanner.bodyBytesSeen = true;
    store.handleStreamError(new TypeError("Failed to fetch"));

    expect(streamFailuresOf(onTelemetry)).toEqual([
      {
        failure_class: "mid_stream",
        status: null,
        thread_id: "thread-1",
        resume_cursor: null,
        last_committed_sse_id: null,
      },
    ]);
  });
});
