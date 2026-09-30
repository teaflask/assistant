// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { RunAgentResult } from "@ag-ui/client";
import { writeStoredThread } from "../src/persistence/stored-thread";
import { getAssistantThread } from "../src/transport/serving-api";
import type { TokenSession } from "../src/transport/token-session";

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
  RUN_ENDED,
  settled,
  threadOf,
  turnOf,
} from "./conversation-store-harness";

installConversationStoreLifecycle();

describe("an open page attaches to a background-initiated turn", () => {
  const INTERRUPT = "v1:before_tool_call:t1:handler";

  // 8 one-second beats plus slack past the last read's microtasks.
  const DELIVERY_PROBE_WINDOW_MS = 10_000;

  function parkedDetail() {
    return detailOf(threadOf({ busy: true }), [
      turnOf({ id: "turn-parent", status: "parked" }),
    ]);
  }

  function deliveryDetail() {
    return detailOf(threadOf({ busy: true }), [
      turnOf({ id: "turn-parent", status: "parked" }),
      turnOf({
        id: "turn-delivery",
        kind: "delivery",
        status: "working",
        user_message: "",
        run_id: "run-delivery",
      }),
    ]);
  }

  // A SECOND delivery turn already queued when the first one's stream
  // closes — the one-RTT window the stream-end discriminator covers.
  function followUpDeliveryDetail() {
    return detailOf(threadOf({ busy: true }), [
      turnOf({ id: "turn-parent", status: "parked" }),
      turnOf({
        id: "turn-delivery",
        kind: "delivery",
        status: "succeeded",
        user_message: "",
        run_id: "run-delivery",
      }),
      turnOf({
        id: "turn-delivery-2",
        kind: "delivery",
        status: "working",
        user_message: "",
        run_id: "run-delivery-2",
      }),
    ]);
  }

  /** A leased page over a parked thread whose history replay already ran
   *  and ended (the parked contract's quiet close): connectAgent has been
   *  called once and the epoch is used — the exact rest state. */
  async function aParkedPage() {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(parkedDetail());
    connectAgent.mockImplementation(() => Promise.resolve(RUN_ENDED));
    const store = aStore();
    store.acquireTranscriptLease("page");
    store.bootstrap();
    await settled();
    await settled();
    await settled();
    expect(connectAgent).toHaveBeenCalledTimes(1);
    return store;
  }

  it("a settle's re-read lands a working delivery turn → the store attaches: the EXISTING conversation on a fresh connection epoch, resumed past the recorded cursor", async () => {
    const store = await aParkedPage();

    const activeBefore = store.conversation.get().active;
    // A previously settled run left a resume pair on the CARRIED store —
    // what the fresh epoch must seed from so nothing replays twice.
    activeBefore?.resume.recordPair("42", []);
    const epochBefore = store.connection.get()?.epochId;
    const nonceBefore = store.conversation.get().reconnectNonce;

    // The delivery run's attach stays open (the pending-forever default);
    // a resolving connection here would be the ended-under-a-live-turn
    // reconnect story, which is not this test's.
    connectAgent.mockImplementation(() => new Promise<never>(() => undefined));
    vi.mocked(getAssistantThread).mockResolvedValue(deliveryDetail());

    store.noteDispatchSettled();
    await settled();
    await settled();
    await settled();

    // The ticket's "socket opens on the existing epoch", as the
    // one-connect-per-epoch law permits it: the existing CONVERSATION —
    // ledger, resume store, approval inbox all carried, no re-adoption —
    // on a freshly minted connection epoch (a used agent must never
    // re-apply an overlapping replay)...
    const activeAfter = store.conversation.get().active;
    expect(activeAfter?.ledger).toBe(activeBefore?.ledger);
    expect(activeAfter?.resume).toBe(activeBefore?.resume);
    expect(activeAfter?.approvalInbox).toBe(activeBefore?.approvalInbox);
    // ...and NO FULL REMOUNT (the ticket's binding criterion, round-2
    // finding): conversation-view keys <Transcript> by
    // thread.id#reconnectNonce, so a background attach must never move
    // the reconnect nonce — the epoch remints through the background
    // nonce instead, and the keyed subtree (the composer's draft and
    // staged attachments live in it) holds still.
    expect(store.conversation.get().reconnectNonce).toBe(nonceBefore);
    expect(store.connection.get()?.epochId).not.toBe(epochBefore);
    // ...connected exactly once more...
    expect(connectAgent).toHaveBeenCalledTimes(2);
    // ...and seeded from the carried resume pair, so the replay asks past
    // the cursor instead of re-applying content — the no-duplicate-replay
    // law over a seeded agent is pinned in stream-resume.test.ts.
    const agent = store.connection.get()?.agent as unknown as {
      seededSnapshot: { afterId: string } | null;
    };
    expect(agent.seededSnapshot?.afterId).toBe("42");
    // Scope 4: every status carrier reads the refreshed snapshot — no
    // stale "parked" over the live turn.
    expect(store.activity.get().newestTurnStatus).toBe("working");
    expect(store.composer.get().busy).toBe(true);
  });

  it("a follow-up delivery turn landing in the close window rides the background nonce too — the stream-end path never remounts either", async () => {
    // Round-3 finding: _connectionEnded's post-close re-read can now
    // find a NEW background-initiated turn (streams open on previously
    // parked threads since this ticket), and its reconnect bump would
    // remount the keyed transcript with no user action — the exact
    // draft loss the background nonce exists to prevent. A changed
    // newest-turn id is an attach, not a death.
    const store = await aParkedPage();
    const nonceBefore = store.conversation.get().reconnectNonce;

    // The first delivery turn's stream runs and quiet-closes at once;
    // the follow-up attach stays open.
    connectAgent
      .mockImplementationOnce(() => Promise.resolve(RUN_ENDED))
      .mockImplementation(() => new Promise<never>(() => undefined));
    // The settle relay's re-read lands turn-delivery working; the
    // close's re-read then finds turn-delivery-2 already working.
    vi.mocked(getAssistantThread)
      .mockResolvedValueOnce(deliveryDetail())
      .mockResolvedValue(followUpDeliveryDetail());

    store.noteDispatchSettled();
    for (let flush = 0; flush < 10; flush += 1) {
      await settled();
    }

    // Two background attaches — the settle relay's and the stream-end
    // path's — and zero remounts: the remount key's nonce never moved.
    expect(connectAgent).toHaveBeenCalledTimes(3);
    expect(store.conversation.get().reconnectNonce).toBe(nonceBefore);
    expect(store.activity.get().newestTurnStatus).toBe("working");
    expect(store.conversation.get().showInterruptionBanner).toBe(false);
  });

  it("a retryStream racing a background attach still leaves the fresh epoch connected — the mooted close reschedules the decision", async () => {
    // Round-4 finding: handleWorkflowRestarted's bounded wait fires
    // retryStream while a background attach's connection is running.
    // The nonce bump retires the attach's epoch; the fresh epoch's sync
    // bails on _connectionRunning; and the mooted close used to clear
    // the flag WITHOUT rescheduling — the restarted run sat with no
    // socket on a working turn until the next user action.
    const store = await aParkedPage();
    let endAttach!: (result: RunAgentResult) => void;
    connectAgent
      .mockImplementationOnce(
        () =>
          new Promise<RunAgentResult>((resolve) => {
            endAttach = resolve;
          }),
      )
      .mockImplementation(() => new Promise<never>(() => undefined));
    vi.mocked(getAssistantThread).mockResolvedValue(deliveryDetail());
    store.noteDispatchSettled();
    await settled();
    await settled();
    await settled();
    // The background attach's connection is in flight…
    expect(connectAgent).toHaveBeenCalledTimes(2);

    // …when the reclaim's retryStream retires its epoch: the fresh
    // epoch's sync bails while the old connection still runs.
    store.retryStream();
    await settled();
    expect(connectAgent).toHaveBeenCalledTimes(2);

    // The mooted connection ends — the rescheduled decision connects
    // the epoch that won.
    endAttach(RUN_ENDED);
    await settled();
    await settled();
    await settled();
    expect(connectAgent).toHaveBeenCalledTimes(3);
    expect(store.activity.get().newestTurnStatus).toBe("working");
  });

  it("a burst over a snapshot that stays parked exhausts QUIETLY — bounded reads, no connect, no nonce movement", async () => {
    vi.useFakeTimers();
    const store = await aParkedPage();
    const nonceBefore = store.conversation.get().reconnectNonce;
    const readsBefore = vi.mocked(getAssistantThread).mock.calls.length;

    store.noteDispatchSettled();
    // A second settle mid-burst coalesces into the running burst (the
    // re-arm) instead of stacking a parallel one.
    store.noteDispatchSettled();
    await vi.advanceTimersByTimeAsync(DELIVERY_PROBE_WINDOW_MS);

    // The immediate read plus one per beat — never a stampede, and the
    // window closes quietly: the nomination was declined (or never
    // committed), so there is nothing to attach and nothing to narrate.
    // Ten, not nine: the second settle re-arms a FULL window from the
    // moment the running burst observes it, and one beat had already
    // been spent — initial read + 9 beats.
    expect(vi.mocked(getAssistantThread).mock.calls.length - readsBefore).toBe(
      10,
    );
    expect(connectAgent).toHaveBeenCalledTimes(1);
    expect(store.conversation.get().reconnectNonce).toBe(nonceBefore);
    expect(store.activity.get().newestTurnStatus).toBe("parked");
  });

  it("the leased idle re-read discovers a handoff/janitor delivery turn within one interval and attaches — no settle observation needed", async () => {
    vi.useFakeTimers();
    const store = await aParkedPage();

    connectAgent.mockImplementation(() => new Promise<never>(() => undefined));
    vi.mocked(getAssistantThread).mockResolvedValue(deliveryDetail());
    // No dispatch settle fires on this path: the turn-handoff and
    // janitor-sweep nominators are frontend-invisible, and only the slow
    // re-read of the thread snapshot can see their delivery turn.
    await vi.advanceTimersByTimeAsync(60_000);

    expect(connectAgent).toHaveBeenCalledTimes(2);
    expect(store.activity.get().newestTurnStatus).toBe("working");
  });

  it("an unchanged re-read notifies no subscriber — idle ticks and burst beats are silent until the thread moves", async () => {
    // Round-1 finding (both reviewers): adoption used to mint a fresh
    // _active literal on every read, and the conversation comparer reads
    // `active` by identity — so every machine re-read re-rendered every
    // conversation subscriber over an unchanged snapshot. The guard
    // keeps the reference; these pins hold the whole machine-driven
    // family quiet AND prove the load-bearing publish (the one the
    // connect gate rides) survives.
    vi.useFakeTimers();
    const store = await aParkedPage();
    const conversationNotified = vi.fn();
    const composerNotified = vi.fn();
    const activityNotified = vi.fn();
    store.conversation.subscribe(conversationNotified);
    store.composer.subscribe(composerNotified);
    store.activity.subscribe(activityNotified);
    const readsBefore = vi.mocked(getAssistantThread).mock.calls.length;

    // Two idle ticks and one full delivery-claim burst over a snapshot
    // that never moves: the GETs happen, nothing renders.
    await vi.advanceTimersByTimeAsync(120_000);
    store.noteDispatchSettled();
    await vi.advanceTimersByTimeAsync(DELIVERY_PROBE_WINDOW_MS);
    expect(vi.mocked(getAssistantThread).mock.calls.length).toBe(
      readsBefore + 11,
    );
    expect(conversationNotified).not.toHaveBeenCalled();
    expect(composerNotified).not.toHaveBeenCalled();
    expect(activityNotified).not.toHaveBeenCalled();

    // The moment the thread moves, the same machinery publishes the
    // cells that carry the change — activity (the working status) and
    // composer (the lock) — and the connect gate rides that publish to
    // the attach. A quieted publish here would be a missed attach: the
    // entire ticket. (The conversation cell may honestly stay silent:
    // the thread record and the reconnect nonce both held still — the
    // no-remount criterion — and turns ride the other cells.)
    connectAgent.mockImplementation(() => new Promise<never>(() => undefined));
    vi.mocked(getAssistantThread).mockResolvedValue(deliveryDetail());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(activityNotified).toHaveBeenCalled();
    expect(composerNotified).toHaveBeenCalled();
    expect(store.activity.get().newestTurnStatus).toBe("working");
    expect(store.composer.get().busy).toBe(true);
    expect(connectAgent).toHaveBeenCalledTimes(2);
  });

  it("a background attach never resurfaces a stale interruption banner over the healthy stream it opened", async () => {
    // Round-2 finding: a PREVIOUS turn's stream death sets
    // _streamInterrupted; the park merely hides the banner (busyOf() is
    // false for parked). Without the remint's clear, the delivery turn
    // flipping busy true would resurface the banner — with its Retry —
    // over the live stream the store just attached.
    const store = await aParkedPage();
    store.handleStreamError(new TypeError("network error"));
    expect(store.conversation.get().showInterruptionBanner).toBe(false);

    connectAgent.mockImplementation(() => new Promise<never>(() => undefined));
    vi.mocked(getAssistantThread).mockResolvedValue(deliveryDetail());
    store.noteDispatchSettled();
    await settled();
    await settled();
    await settled();

    expect(store.activity.get().newestTurnStatus).toBe("working");
    expect(store.composer.get().busy).toBe(true);
    expect(store.conversation.get().showInterruptionBanner).toBe(false);
    expect(connectAgent).toHaveBeenCalledTimes(2);
  });

  it("a stalled thread GET cannot retire the settle relay — the burst is bounded by its own clock", async () => {
    // Round-2 finding: nothing in this transport aborts a stalled
    // request (the gap probe's premise #2), so a burst that awaited its
    // reads would latch _deliveryProbeRunning forever on one
    // accepted-then-stalled GET, and every later settle would only
    // re-arm a dead burst.
    vi.useFakeTimers();
    const store = await aParkedPage();
    const readsBefore = vi.mocked(getAssistantThread).mock.calls.length;
    vi.mocked(getAssistantThread).mockImplementation(
      () => new Promise<never>(() => undefined),
    );

    store.noteDispatchSettled();
    await vi.advanceTimersByTimeAsync(DELIVERY_PROBE_WINDOW_MS);
    // Single-flight: the stalled read is the only one the burst fired.
    expect(vi.mocked(getAssistantThread).mock.calls.length).toBe(
      readsBefore + 1,
    );

    // A later settle finds the relay ALIVE: the stalled read never
    // latched the coalescing flag, and this burst attaches normally.
    connectAgent.mockImplementation(() => new Promise<never>(() => undefined));
    vi.mocked(getAssistantThread).mockResolvedValue(deliveryDetail());
    store.noteDispatchSettled();
    await vi.advanceTimersByTimeAsync(DELIVERY_PROBE_WINDOW_MS);
    expect(store.activity.get().newestTurnStatus).toBe("working");
    expect(connectAgent).toHaveBeenCalledTimes(2);
  });

  it("the idle re-read is single-flight — a stalled GET quiets the interval instead of stacking wedged connections", async () => {
    // Round-5 finding: this transport aborts nothing, so without the
    // guard each tick would stack another never-settling GET — one per
    // minute for the life of the page — exhausting the per-host budget
    // and starving the SSE stream itself (the delivery probe's own
    // refreshOnce posture, copied).
    vi.useFakeTimers();
    const store = await aParkedPage();
    const readsBefore = vi.mocked(getAssistantThread).mock.calls.length;
    vi.mocked(getAssistantThread).mockImplementation(
      () => new Promise<never>(() => undefined),
    );

    await vi.advanceTimersByTimeAsync(300_000);

    expect(vi.mocked(getAssistantThread).mock.calls.length).toBe(
      readsBefore + 1,
    );
    expect(store.activity.get().newestTurnStatus).toBe("parked");
  });

  it("the idle re-read is leased-only — a headless store never polls a parked thread", async () => {
    vi.useFakeTimers();
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(parkedDetail());
    const store = aStore();
    store.bootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.activity.get().newestTurnStatus).toBe("parked");
    const readsBefore = vi.mocked(getAssistantThread).mock.calls.length;

    await vi.advanceTimersByTimeAsync(180_000);

    expect(vi.mocked(getAssistantThread).mock.calls.length).toBe(readsBefore);
  });

  it("the idle re-read never runs while the turn holds a stream — the socket owns that story", async () => {
    vi.useFakeTimers();
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf({ busy: true }), [turnOf({ status: "working" })]),
    );
    const store = aStore();
    store.acquireTranscriptLease("page");
    store.bootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(connectAgent).toHaveBeenCalledTimes(1);
    const readsBefore = vi.mocked(getAssistantThread).mock.calls.length;

    await vi.advanceTimersByTimeAsync(180_000);

    expect(vi.mocked(getAssistantThread).mock.calls.length).toBe(readsBefore);
  });

  it("dispose clears the idle re-read; a StrictMode revival re-arms it", async () => {
    vi.useFakeTimers();
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(parkedDetail());
    const store = aStore();
    store.acquireTranscriptLease("page");
    store.bootstrap();
    await vi.advanceTimersByTimeAsync(0);

    store.dispose();
    const readsAfterDispose = vi.mocked(getAssistantThread).mock.calls.length;
    await vi.advanceTimersByTimeAsync(180_000);
    // The interval died with the life that armed it.
    expect(vi.mocked(getAssistantThread).mock.calls.length).toBe(
      readsAfterDispose,
    );

    store.bootstrap();
    await vi.advanceTimersByTimeAsync(0);
    const readsAfterRevival = vi.mocked(getAssistantThread).mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vi.mocked(getAssistantThread).mock.calls.length).toBe(
      readsAfterRevival + 1,
    );
  });

  interface Frame {
    id?: string;
    data: Record<string, unknown>;
  }

  function _sseBody(frames: Frame[]): string {
    return frames
      .map(
        (frame) =>
          `${frame.id === undefined ? "" : `id: ${frame.id}\n`}data: ${JSON.stringify(frame.data)}\n\n`,
      )
      .join("");
  }

  it("a background attach never re-anchors a replayed resume marker — the parked run's markers pass the filter but the store arbitrates", async () => {
    // Round-5 finding: the parked snapshot's cursor sits inside an
    // unsettled run, so the boundary-snap re-delivers that run IN FULL;
    // the seeded filter drops its content but passes its CUSTOM markers
    // by design, and resumeMarkerRecorder anchors a pending marker to
    // the next applied message — now the first POST-attach message. A
    // parked → resumed → parked-again run therefore gained a second,
    // misplaced divider. The store must arbitrate by the resumption's
    // identity (run id + the payload's own (round, attempt)), the
    // void/stop/failed/delivery siblings' posture.
    connectAgent.mockRestore();
    const resumedParkedRun = [
      {
        data: {
          type: "RUN_STARTED",
          threadId: "stream-thread-1",
          runId: "run-parked",
        },
      },
      {
        id: "1",
        data: {
          type: "TEXT_MESSAGE_START",
          messageId: "m-a",
          role: "assistant",
        },
      },
      {
        id: "2",
        data: {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "m-a",
          delta: "Before the first park.",
        },
      },
      { id: "3", data: { type: "TEXT_MESSAGE_END", messageId: "m-a" } },
      {
        id: "4",
        data: {
          type: "CUSTOM",
          name: "run_resumed",
          value: { attempt: 2, round: 1 },
        },
      },
      {
        id: "5",
        data: {
          type: "TEXT_MESSAGE_START",
          messageId: "m-b",
          role: "assistant",
        },
      },
      {
        id: "6",
        data: {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "m-b",
          delta: "After the park-to-park resume.",
        },
      },
      { id: "7", data: { type: "TEXT_MESSAGE_END", messageId: "m-b" } },
    ];
    const deliveryBody = _sseBody([
      // The boundary snap re-delivers the whole unsettled run — markers
      // included — then the read-back's synthesized quiet terminal
      // separates it from the delivery run.
      ...resumedParkedRun,
      {
        data: {
          type: "RUN_FINISHED",
          threadId: "stream-thread-1",
          runId: "run-parked",
        },
      },
      {
        data: {
          type: "RUN_STARTED",
          threadId: "stream-thread-1",
          runId: "run-delivery",
        },
      },
      {
        id: "8",
        data: {
          type: "TEXT_MESSAGE_START",
          messageId: "m-2",
          role: "assistant",
        },
      },
      {
        id: "9",
        data: {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "m-2",
          delta: "Delivering.",
        },
      },
      { id: "10", data: { type: "TEXT_MESSAGE_END", messageId: "m-2" } },
    ]);
    let connections = 0;
    const authorizedFetch = (): Promise<Response> => {
      connections += 1;
      if (connections === 1) {
        // The parked → resumed → parked-again run, ending in the parked
        // contract's quiet close.
        return Promise.resolve(
          new Response(_sseBody(resumedParkedRun), {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      }
      const held = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(deliveryBody));
        },
      });
      return Promise.resolve(
        new Response(held, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );
    };

    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(parkedDetail());
    const store = aStore({
      session: { authorizedFetch } as unknown as TokenSession,
    });
    store.acquireTranscriptLease("page");
    store.bootstrap();
    await vi.waitFor(() => {
      expect(connections).toBe(1);
      expect(store.markerAnchors.get().resumeAnchors.has("m-b")).toBe(true);
    });

    vi.mocked(getAssistantThread).mockResolvedValue(deliveryDetail());
    store.noteDispatchSettled();
    await vi.waitFor(
      () => {
        expect(store.messages.get().some((m) => m.id === "m-2")).toBe(true);
      },
      { timeout: 3_000 },
    );

    // ONE divider, at its original anchor: the re-delivered marker was
    // arbitrated away, never re-anchored to the post-attach message.
    const anchors = store.markerAnchors.get().resumeAnchors;
    expect(anchors.has("m-b")).toBe(true);
    expect(anchors.has("m-2")).toBe(false);
    expect(anchors.size).toBe(1);
  });

  it("the background-delivery corpus shape end to end: a background delivery turn's approval renders LIVE over the attached stream — stream-born, no reload, actionable before the turn parks", async () => {
    // The full corpus sequence over the mocked transport: page open →
    // parent parked → a dispatch settle is observed → the claim probe's
    // re-read lands the delivery turn → the store attaches a fresh epoch
    // with the real replay pipeline → the run's stream carries an
    // approval ask → the card is actionable while the turn still runs.
    // This is the ticket's named E2E delivered in the only harness this
    // repo has for the sequence (no harness drives backend + browser
    // together); a staging re-run is the only end-to-end proof.
    connectAgent.mockRestore();
    // The PARKED run's replayed frames — the parked contract closes its
    // open blocks and then quiet-closes with NO terminal (round-4
    // finding: the earlier fixture ended its history with RUN_FINISHED,
    // which records a resume snapshot — a shape production cannot
    // produce for a parked-open page, and it masked the blank-transcript
    // defect this test now guards against).
    const parkedRunFrames = [
      {
        data: {
          type: "RUN_STARTED",
          threadId: "stream-thread-1",
          runId: "run-parked",
        },
      },
      {
        id: "5",
        data: {
          type: "TEXT_MESSAGE_START",
          messageId: "m-parked",
          role: "assistant",
        },
      },
      {
        id: "6",
        data: {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "m-parked",
          delta: "Watching the child.",
        },
      },
      { id: "7", data: { type: "TEXT_MESSAGE_END", messageId: "m-parked" } },
    ];
    const historyBody = _sseBody([
      {
        data: {
          type: "RUN_STARTED",
          threadId: "stream-thread-1",
          runId: "run-1",
        },
      },
      {
        id: "1",
        data: {
          type: "TEXT_MESSAGE_START",
          messageId: "m-1",
          role: "assistant",
        },
      },
      {
        id: "2",
        data: {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "m-1",
          delta: "Earlier answer.",
        },
      },
      { id: "3", data: { type: "TEXT_MESSAGE_END", messageId: "m-1" } },
      {
        id: "4",
        data: {
          type: "RUN_FINISHED",
          threadId: "stream-thread-1",
          runId: "run-1",
        },
      },
      // …then the parked run, ending the body without a terminal: the
      // parked contract's quiet close.
      ...parkedRunFrames,
    ]);
    const deliveryBody = _sseBody([
      // The server snaps the echoed cursor DOWN to the last run boundary
      // (id 4) and re-delivers the unsettled parked run IN FULL — the
      // seeded de-dupe set must filter it (the ticket's "no duplicate
      // replay") — then closes the straggler with the read-back's
      // synthesized (id-less) quiet RUN_FINISHED, the parked-stream
      // contract's segment separator, before the delivery run's rows.
      ...parkedRunFrames,
      {
        data: {
          type: "RUN_FINISHED",
          threadId: "stream-thread-1",
          runId: "run-parked",
        },
      },
      {
        data: {
          type: "RUN_STARTED",
          threadId: "stream-thread-1",
          runId: "run-delivery",
        },
      },
      {
        id: "8",
        data: {
          type: "TEXT_MESSAGE_START",
          messageId: "m-2",
          role: "assistant",
        },
      },
      {
        id: "9",
        data: {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "m-2",
          delta: "Delivering the survey results.",
        },
      },
      { id: "10", data: { type: "TEXT_MESSAGE_END", messageId: "m-2" } },
      {
        id: "11",
        data: {
          type: "TOOL_CALL_START",
          toolCallId: "call-1",
          toolCallName: "publish_doc",
        },
      },
      {
        id: "12",
        data: { type: "TOOL_CALL_ARGS", toolCallId: "call-1", delta: "{}" },
      },
      {
        id: "13",
        data: {
          type: "CUSTOM",
          name: "approval_requested",
          value: {
            interrupt_id: INTERRUPT,
            tool_name: "publish_doc",
            tool_args: {},
            prompt: "Publish the survey results?",
            tool_call_id: "call-1",
            round: 0,
          },
        },
      },
      { data: { type: "TOOL_CALL_END", toolCallId: "call-1" } },
    ]);
    let connections = 0;
    const askedCursors: (string | undefined)[] = [];
    const authorizedFetch = (
      _url: string,
      requestInit: RequestInit,
    ): Promise<Response> => {
      connections += 1;
      const body = JSON.parse(requestInit.body as string) as {
        forwardedProps?: { after_id?: string };
      };
      askedCursors.push(body.forwardedProps?.after_id);
      if (connections === 1) {
        // The pre-park history plus the parked run, ending in the parked
        // contract's quiet close (the body simply ends, no terminal).
        return Promise.resolve(
          new Response(historyBody, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      }
      // The delivery run is LIVE: its stream delivers the frames and then
      // stays open — no terminal, no close. The turn is still running
      // when every assertion below fires.
      const held = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(deliveryBody));
        },
      });
      return Promise.resolve(
        new Response(held, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );
    };

    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(parkedDetail());
    const store = aStore({
      session: { authorizedFetch } as unknown as TokenSession,
    });
    store.acquireTranscriptLease("page");
    store.bootstrap();
    // The page painted its history AND the parked run, then watched the
    // quiet close: connection one ran to its end with no terminal.
    await vi.waitFor(() => {
      expect(connections).toBe(1);
      expect(store.messages.get().some((m) => m.id === "m-1")).toBe(true);
      expect(store.messages.get().some((m) => m.id === "m-parked")).toBe(true);
    });

    // The child settles; the roster relay taps the store; the re-read
    // lands the claimed delivery turn.
    vi.mocked(getAssistantThread).mockResolvedValue(deliveryDetail());
    store.noteDispatchSettled();

    // The approval card is stream-born (a working turn's REST snapshot
    // carries no pending_approvals — hydration reads paused turns only)
    // and actionable, while the turn still runs: no reload happened, and
    // the delivery run's streamed content rendered live beside it.
    await vi.waitFor(
      () => {
        expect(store.approvals.get()).toHaveLength(1);
      },
      { timeout: 3_000 },
    );
    const card = store.approvals.get()[0];
    expect(card.status.kind).toBe("actionable");
    expect(card.parked).toBe(false);
    expect(store.activity.get().newestTurnStatus).toBe("working");
    // "Events render": the transcript never blanked — the pre-park
    // history AND the parked run's content survived the attach (the
    // remint's agent seeds from the pair recorded at the quiet close),
    // and the delivery run's content streamed in beside them.
    const messageIds = store.messages.get().map((m) => m.id);
    expect(messageIds).toContain("m-1");
    expect(messageIds).toContain("m-parked");
    expect(messageIds).toContain("m-2");
    // "No duplicate replay": the attach asked past the quiet close's
    // cursor, and the boundary-snap re-delivery of the parked run was
    // filtered by the seeded de-dupe set — exactly one m-parked, its
    // content not doubled.
    expect(askedCursors[1]).toBe("7");
    expect(messageIds.filter((id) => id === "m-parked")).toHaveLength(1);
    const parkedMessage = store.messages.get().find((m) => m.id === "m-parked");
    expect(parkedMessage?.content).toBe("Watching the child.");
    expect(connections).toBe(2);
  });
});
