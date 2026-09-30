// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
  getAssistantThread,
  sendAssistantMessage,
  stopAssistantTurn,
} from "../src/transport/serving-api";
import { ServingApiError } from "../src/transport/serving-error";

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
  detailOf,
  installConversationStoreLifecycle,
  SESSION,
  settled,
  threadOf,
  turnOf,
} from "./conversation-store-harness";

installConversationStoreLifecycle();

describe("AssistantConversationStore", () => {
  // --- stopping the live turn --------------------------------------

  async function aBusyStore() {
    vi.mocked(sendAssistantMessage).mockResolvedValue({
      thread: threadOf({ busy: true }),
      turn: turnOf({ status: "working" }),
    });
    const reportError = vi.fn();
    const store = aStore({ reportError });
    await store.sendMessage("brew?");
    expect(store.composer.get().busy).toBe(true);
    return { store, reportError };
  }

  it("a door-settled stop POSTs the thread id only, refreshes, and unlocks", async () => {
    const { store } = await aBusyStore();
    vi.mocked(stopAssistantTurn).mockResolvedValue({
      delivery: "turn_settled",
      turn: turnOf({ status: "stopped" }),
    });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf({ busy: false }), [turnOf({ status: "stopped" })]),
    );

    await store.stopTurn();

    expect(stopAssistantTurn).toHaveBeenCalledExactlyOnceWith(
      SESSION,
      "thread-1",
    );
    const composer = store.composer.get();
    expect(composer.busy).toBe(false);
    expect(composer.stopping).toBe(false);
    // The caret comes back exactly like a landed send.
    expect(composer.composerRefocusPending).toBe(true);
    // A stop is a receipt, never a failure of any kind.
    expect(store.conversation.get().sendError).toBeNull();
    expect(store.conversation.get().turnFailure).toBeNull();
  });

  it("an already_settled receipt is success — the answer won the race", async () => {
    const { store, reportError } = await aBusyStore();
    vi.mocked(stopAssistantTurn).mockResolvedValue({
      delivery: "already_settled",
      turn: turnOf({ status: "succeeded" }),
    });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf({ busy: false }), [turnOf({ status: "succeeded" })]),
    );

    await store.stopTurn();

    expect(store.composer.get().stopping).toBe(false);
    expect(store.conversation.get().sendError).toBeNull();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("a signaled stop holds `stopping` until the settled truth lands", async () => {
    vi.useFakeTimers();
    const { store } = await aBusyStore();
    vi.mocked(stopAssistantTurn).mockResolvedValue({
      delivery: "signaled",
      turn: turnOf({ status: "working" }),
    });
    // The workflow's stop exit takes a beat: the first probe still sees
    // the turn live, the next sees the stopped receipt.
    vi.mocked(getAssistantThread)
      .mockResolvedValueOnce(
        detailOf(threadOf({ busy: true }), [turnOf({ status: "working" })]),
      )
      .mockResolvedValue(
        detailOf(threadOf({ busy: false }), [turnOf({ status: "stopped" })]),
      );

    const stop = store.stopTurn();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.composer.get().stopping).toBe(true);
    expect(store.composer.get().busy).toBe(true);

    await vi.advanceTimersByTimeAsync(1200);
    await stop;

    expect(store.composer.get().stopping).toBe(false);
    expect(store.composer.get().busy).toBe(false);
    expect(store.conversation.get().sendError).toBeNull();
  });

  it("never raises the interruption banner during a stop — the member did the interrupting", async () => {
    const { store } = await aBusyStore();
    vi.mocked(stopAssistantTurn).mockReturnValue(
      new Promise<never>(() => undefined),
    );
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf({ busy: true }), [turnOf({ status: "working" })]),
    );

    void store.stopTurn();
    await settled();
    // The dying stream's own error path fires inside the stop window.
    store.handleStreamError(new Error("socket dropped"));
    await settled();

    expect(store.composer.get().stopping).toBe(true);
    expect(store.conversation.get().showInterruptionBanner).toBe(false);
  });

  it("a second press while stopping is a no-op — one POST", async () => {
    const { store } = await aBusyStore();
    vi.mocked(stopAssistantTurn).mockReturnValue(
      new Promise<never>(() => undefined),
    );

    void store.stopTurn();
    await settled();
    void store.stopTurn();
    await settled();

    expect(stopAssistantTurn).toHaveBeenCalledTimes(1);
  });

  it("a stop while the send POST is in flight is a no-op — no turn exists yet", async () => {
    vi.mocked(sendAssistantMessage).mockReturnValue(
      new Promise<never>(() => undefined),
    );
    const store = aStore();

    void store.sendMessage("brew?");
    await settled();
    expect(store.composer.get().busy).toBe(true);
    await store.stopTurn();

    expect(stopAssistantTurn).not.toHaveBeenCalled();
  });

  it("a failed stop clears stopping and speaks the STOP door's sentence, never the send door's", async () => {
    const { store, reportError } = await aBusyStore();
    vi.mocked(stopAssistantTurn).mockRejectedValue(
      new ServingApiError({
        code: "ORCHESTRATION_UNAVAILABLE",
        message:
          "The stop couldn't be delivered right now. Please try again in a moment.",
        status: 503,
        retryAfterSeconds: null,
      }),
    );

    await store.stopTurn();

    expect(store.composer.get().stopping).toBe(false);
    expect(store.composer.get().busy).toBe(true);
    // The door's own sentence passes through untranslated — the send
    // vocabulary ("couldn't be started", "went wrong sending that")
    // would lie about a turn that is still running.
    expect(store.conversation.get().sendError).toContain(
      "stop couldn't be delivered",
    );
    expect(reportError).toHaveBeenCalled();
  });

  it("a retry that succeeds clears the previous attempt's failure sentence", async () => {
    const { store } = await aBusyStore();
    vi.mocked(stopAssistantTurn).mockRejectedValueOnce(
      new TypeError("Failed to fetch"),
    );
    await store.stopTurn();
    expect(store.conversation.get().sendError).toContain(
      "stop couldn't be delivered",
    );

    vi.mocked(stopAssistantTurn).mockResolvedValue({
      delivery: "turn_settled",
      turn: turnOf({ status: "stopped" }),
    });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf({ busy: false }), [turnOf({ status: "stopped" })]),
    );
    await store.stopTurn();

    // The instruction to try again must not outlive the retry that
    // worked: each attempt owns its own narration.
    expect(store.conversation.get().sendError).toBeNull();
    expect(store.composer.get().busy).toBe(false);
  });

  it("a transport death mid-stop gets the stop-specific fallback sentence", async () => {
    const { store } = await aBusyStore();
    vi.mocked(stopAssistantTurn).mockRejectedValue(
      new TypeError("Failed to fetch"),
    );

    await store.stopTurn();

    expect(store.conversation.get().sendError).toContain(
      "stop couldn't be delivered",
    );
    expect(store.composer.get().stopping).toBe(false);
  });

  it("releases the Stopping lock when the probe window closes without a settle", async () => {
    vi.useFakeTimers();
    const { store } = await aBusyStore();
    vi.mocked(stopAssistantTurn).mockResolvedValue({
      delivery: "signaled",
      turn: turnOf({ status: "working" }),
    });
    // The settle never shows up: every re-read still says busy.
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf({ busy: true }), [turnOf({ status: "working" })]),
    );

    const stop = store.stopTurn();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.composer.get().stopping).toBe(true);
    // The dying stream errors inside the window — no banner yet: the
    // member did the interrupting.
    store.handleStreamError(new Error("socket dropped"));
    expect(store.conversation.get().showInterruptionBanner).toBe(false);

    await vi.advanceTimersByTimeAsync(4800);
    await stop;

    // The window is a fallback, not a promise: the lock releases so the
    // stop square re-arms — and the genuinely dead stream's banner (its
    // Retry is the only way back) can finally surface.
    expect(store.composer.get().stopping).toBe(false);
    expect(store.composer.get().busy).toBe(true);
    expect(store.conversation.get().showInterruptionBanner).toBe(true);
  });

  it("a door-settled stop whose confirming read blips still ends the narration", async () => {
    vi.useFakeTimers();
    const { store } = await aBusyStore();
    vi.mocked(stopAssistantTurn).mockResolvedValue({
      delivery: "turn_settled",
      turn: turnOf({ status: "stopped" }),
    });
    vi.mocked(getAssistantThread)
      .mockRejectedValueOnce(new Error("read blip"))
      .mockResolvedValue(
        detailOf(threadOf({ busy: false }), [turnOf({ status: "stopped" })]),
      );

    const stop = store.stopTurn();
    await vi.advanceTimersByTimeAsync(1200);
    await stop;

    expect(store.composer.get().stopping).toBe(false);
    expect(store.composer.get().busy).toBe(false);
  });
});
