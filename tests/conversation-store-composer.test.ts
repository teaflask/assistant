// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { RunAgentResult } from "@ag-ui/client";
import type {
  ServingAssistantThread,
  ServingAssistantTurn,
} from "../src/contract/threads";
import type { AssistantConversationStore } from "../src/core/conversation-store";
import { writeStoredThread } from "../src/persistence/stored-thread";
import {
  getAssistantThread,
  sendAssistantMessage,
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
  connectAgent,
  detailOf,
  installConversationStoreLifecycle,
  PK,
  RUN_ENDED,
  SESSION,
  settled,
  threadOf,
  turnOf,
} from "./conversation-store-harness";

installConversationStoreLifecycle();

describe("the model pick", () => {
  it("a chip selection rides the next send and the response thread settles it", async () => {
    const store = aStore();
    store.setModelPick({ modelId: "gpt-5.6-terra", effort: "high" });
    expect(store.composer.get().modelPick).toEqual({
      modelId: "gpt-5.6-terra",
      effort: "high",
    });
    vi.mocked(sendAssistantMessage).mockResolvedValue({
      thread: threadOf({
        busy: true,
        model_pick: { model_id: "gpt-5.6-terra", effort: "high" },
      }),
      turn: turnOf({ status: "queued" }),
    });

    await store.sendMessage("hello");

    expect(vi.mocked(sendAssistantMessage)).toHaveBeenCalledWith(SESSION, {
      thread_id: undefined,
      message: "hello",
      attachment_ids: [],
      model_pick: { model_id: "gpt-5.6-terra", effort: "high" },
    });
    expect(store.composer.get().modelPick).toEqual({
      modelId: "gpt-5.6-terra",
      effort: "high",
    });
  });

  it("an unpicked send makes no pick statement — absent means keep", async () => {
    vi.mocked(sendAssistantMessage).mockResolvedValue({
      thread: threadOf({ busy: true }),
      turn: turnOf({ status: "queued" }),
    });
    const store = aStore();

    await store.sendMessage("hello");

    const [, body] = vi.mocked(sendAssistantMessage).mock.calls[0];
    expect("model_pick" in body).toBe(false);
    expect(store.composer.get().modelPick).toBeNull();
  });

  it("an effort-only wire pick seeds with a null pin", async () => {
    const stored = threadOf({
      model_pick: { model_id: null, effort: "high" },
    });
    vi.mocked(getAssistantThread).mockResolvedValue(detailOf(stored));
    const store = aStore();

    store.openThread(stored);
    await settled();

    expect(store.composer.get().modelPick).toEqual({
      modelId: null,
      effort: "high",
    });
  });

  it("opening a thread seeds the pick from the wire — per-thread stickiness", async () => {
    const stored = threadOf({
      model_pick: { model_id: "claude-opus-5", effort: null },
    });
    vi.mocked(getAssistantThread).mockResolvedValue(detailOf(stored));
    const store = aStore();

    store.openThread(stored);
    await settled();

    expect(store.composer.get().modelPick).toEqual({
      modelId: "claude-opus-5",
      effort: null,
    });
  });

  it("an unsent selection survives refreshes and same-thread reopens", async () => {
    const stored = threadOf({
      model_pick: { model_id: "claude-opus-5", effort: "low" },
    });
    vi.mocked(getAssistantThread).mockResolvedValue(detailOf(stored));
    const store = aStore();
    store.openThread(stored);
    await settled();

    // Dirty local selection survives a background refresh…
    store.setModelPick({ modelId: "gpt-5.6-terra", effort: null });
    await store.refreshConversation();
    expect(store.composer.get().modelPick).toEqual({
      modelId: "gpt-5.6-terra",
      effort: null,
    });

    // …and a re-adoption of the SAME thread (the palette reopens on
    // every open): the chip must not silently revert an unsent choice.
    store.openThread(stored);
    await settled();
    expect(store.composer.get().modelPick).toEqual({
      modelId: "gpt-5.6-terra",
      effort: null,
    });

    // Switching threads is the one adoption that overwrites even a
    // dirty selection — the visitor left the conversation it belonged to.
    const other = threadOf({ id: "thread-2", model_pick: null });
    vi.mocked(getAssistantThread).mockResolvedValue(detailOf(other, []));
    store.openThread(other);
    await settled();
    expect(store.composer.get().modelPick).toBeNull();
  });

  it("with nothing dirty, a server-side clear is authoritative on refresh", async () => {
    const stored = threadOf({
      model_pick: { model_id: "claude-opus-5", effort: "low" },
    });
    vi.mocked(getAssistantThread).mockResolvedValue(detailOf(stored));
    const store = aStore();
    store.openThread(stored);
    await settled();
    expect(store.composer.get().modelPick).not.toBeNull();

    // The toggle turned off, or the model delisted: the runtime cleared
    // the pick between turns, and the thread read is the truth.
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf({ model_pick: null })),
    );
    await store.refreshConversation();
    expect(store.composer.get().modelPick).toBeNull();
  });

  it("a selection changed mid-send stays dirty and rides the next send", async () => {
    let resolveSend: (value: {
      thread: ServingAssistantThread;
      turn: ServingAssistantTurn;
    }) => void = () => undefined;
    vi.mocked(sendAssistantMessage).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        }),
    );
    const store = aStore();
    store.setModelPick({ modelId: "claude-opus-5", effort: "low" });

    const landing = store.sendMessage("hello");
    // The shelf stays live during a send: the visitor changes their mind
    // while the old pick is in flight.
    store.setModelPick({ modelId: "gpt-5.6-terra", effort: "high" });
    resolveSend({
      thread: threadOf({
        busy: true,
        model_pick: { model_id: "claude-opus-5", effort: "low" },
      }),
      turn: turnOf({ status: "queued" }),
    });
    await landing;

    // The landing settles only the pick it carried; the newer choice
    // survives (dirty) and a refresh cannot clobber it either.
    expect(store.composer.get().modelPick).toEqual({
      modelId: "gpt-5.6-terra",
      effort: "high",
    });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(
        threadOf({ model_pick: { model_id: "claude-opus-5", effort: "low" } }),
      ),
    );
    await store.refreshConversation();
    expect(store.composer.get().modelPick).toEqual({
      modelId: "gpt-5.6-terra",
      effort: "high",
    });
  });

  it("an unchanged landing settles the pick — later server truth adopts again", async () => {
    vi.mocked(sendAssistantMessage).mockResolvedValue({
      thread: threadOf({
        busy: true,
        model_pick: { model_id: "claude-opus-5", effort: null },
      }),
      turn: turnOf({ status: "queued" }),
    });
    const store = aStore();
    store.setModelPick({ modelId: "claude-opus-5", effort: null });
    await store.sendMessage("hello");

    // The landing cleared the dirty flag, so the wire truth governs the
    // next refresh — a server-side clear propagates.
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(threadOf({ model_pick: null })),
    );
    await store.refreshConversation();
    expect(store.composer.get().modelPick).toBeNull();
  });

  it("a new conversation starts unpicked", async () => {
    const stored = threadOf({
      model_pick: { model_id: "claude-opus-5", effort: null },
    });
    vi.mocked(getAssistantThread).mockResolvedValue(detailOf(stored));
    const store = aStore();
    store.openThread(stored);
    await settled();

    store.startNewConversation();

    expect(store.composer.get().modelPick).toBeNull();
  });
});

describe("unsaved composer input is store truth — ruling pins", () => {
  // RULING PINS, not falsified regressions: the _composerInput cell is a
  // NEW store surface, so none of these can fail against pre-fix HEAD —
  // pre-fix, the draft was the keyed subtree's local state and the store
  // had nothing to assert on. The falsified tests (red pre-fix, green
  // post-fix) live in composer-draft-reconnect.test.tsx. These pin the
  // lifetime ruling: consumed by the send, cleared (and re-scoped) on a
  // thread switch or abandon, and NO reconnect path — death arm,
  // retryStream, workflow restart — may clear it.
  function workingDetail() {
    return detailOf(threadOf({ busy: true }), [turnOf({ status: "working" })]);
  }

  function inputOf(store: AssistantConversationStore) {
    return store.composer.get().composerInput.get();
  }

  /** The death-arm rig: a leased page over a working turn whose first
   *  connection is held open by the returned resolver. */
  async function aLeasedWorkingPage() {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(workingDetail());
    let endStream!: (result: RunAgentResult) => void;
    connectAgent
      .mockImplementationOnce(
        () =>
          new Promise<RunAgentResult>((resolve) => {
            endStream = resolve;
          }),
      )
      .mockImplementation(() => new Promise<never>(() => undefined));
    const store = aStore();
    store.acquireTranscriptLease("page");
    store.bootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(connectAgent).toHaveBeenCalledTimes(1);
    return { store, endStream };
  }

  const STAGED = [
    {
      localId: 1,
      filename: "leaf.png",
      byteSize: 3,
      status: "uploading" as const,
    },
  ];

  it("a stream death under the same turn id bumps the nonce, owes ONE caret return when the box owned focus, and never touches the draft", async () => {
    vi.useFakeTimers();
    const { store, endStream } = await aLeasedWorkingPage();
    store.composer.get().setDraft("half a question");
    store.composer.get().setAttachments(STAGED);
    // The palette's composer reported a real focus event before the
    // death.
    store.composer.get().noteComposerFocus("palette");
    const nonceBefore = store.conversation.get().reconnectNonce;

    endStream(RUN_ENDED);
    await vi.advanceTimersByTimeAsync(0);

    // The death arm fired (the remount and the fresh epoch are wanted)…
    expect(store.conversation.get().reconnectNonce).toBe(nonceBefore + 1);
    // …the caret return is owed ONCE, to the OWNING surface (round 4 —
    // a bystander's take must not burn it), and never rides the
    // send/stop-lifecycle refocus flag…
    expect(store.composer.get().composerRefocusPending).toBe(false);
    expect(store.composer.get().takeComposerCaretReturn("page")).toBe(false);
    expect(store.composer.get().takeComposerCaretReturn("palette")).toBe(true);
    expect(store.composer.get().takeComposerCaretReturn("palette")).toBe(false);
    // …and the unsaved input is untouched — by reference.
    expect(inputOf(store).draft).toBe("half a question");
    expect(inputOf(store).attachments).toBe(STAGED);
  });

  it("a stream death while the visitor never owned the composer's focus owes NO caret return — a machine event claims nobody's keyboard", async () => {
    vi.useFakeTimers();
    const { store, endStream } = await aLeasedWorkingPage();
    const nonceBefore = store.conversation.get().reconnectNonce;

    endStream(RUN_ENDED);
    await vi.advanceTimersByTimeAsync(0);

    expect(store.conversation.get().reconnectNonce).toBe(nonceBefore + 1);
    expect(store.composer.get().composerRefocusPending).toBe(false);
    expect(store.composer.get().takeComposerCaretReturn("page")).toBe(false);
    expect(store.composer.get().takeComposerCaretReturn("palette")).toBe(false);
  });

  it("retryStream — the banner's own recovery — keeps the draft", async () => {
    vi.useFakeTimers();
    const { store } = await aLeasedWorkingPage();
    store.composer.get().setDraft("half a question");
    const nonceBefore = store.conversation.get().reconnectNonce;

    store.retryStream();

    expect(store.conversation.get().reconnectNonce).toBe(nonceBefore + 1);
    expect(inputOf(store).draft).toBe("half a question");
  });

  it("handleWorkflowRestarted keeps the draft across the designed remount — rewritten server history never invalidates unsent text", async () => {
    vi.useFakeTimers();
    vi.mocked(sendAssistantMessage).mockResolvedValue({
      thread: threadOf({ busy: true }),
      turn: turnOf({ status: "working" }),
    });
    const store = aStore();
    await store.sendMessage("hello");
    store.composer.get().setDraft("a follow-up I am still writing");
    const nonceBefore = store.conversation.get().reconnectNonce;

    vi.mocked(getAssistantThread)
      .mockResolvedValueOnce(
        detailOf(threadOf({ busy: true }), [turnOf({ status: "parked" })]),
      )
      .mockResolvedValue(
        detailOf(threadOf({ busy: true }), [turnOf({ status: "working" })]),
      );
    store.handleWorkflowRestarted();
    await vi.advanceTimersByTimeAsync(1200);

    expect(store.conversation.get().reconnectNonce).toBe(nonceBefore + 1);
    expect(inputOf(store).draft).toBe("a follow-up I am still writing");
  });

  it("a landed send re-scopes the input to its conversation and keeps text typed during the POST", async () => {
    let landSend!: (response: {
      thread: ServingAssistantThread;
      turn: ServingAssistantTurn;
    }) => void;
    vi.mocked(sendAssistantMessage).mockImplementation(
      () =>
        new Promise((resolve) => {
          landSend = resolve;
        }),
    );
    const store = aStore();
    expect(inputOf(store).scope).toBe("u:0");
    const landing = store.sendMessage("hello");
    // The shelf stays live during a send: this text arrives mid-POST.
    store.composer.get().setDraft("typed during the POST");

    landSend({
      thread: threadOf({ busy: true }),
      turn: turnOf({ status: "working" }),
    });
    await landing;

    // The first send minted the conversation the input now belongs to —
    // the identity the NEXT send's refusal guard compares against.
    expect(inputOf(store).scope).toBe("t:thread-1");
    expect(inputOf(store).draft).toBe("typed during the POST");
  });

  it("switching threads clears the draft and re-scopes the input; re-adopting the same thread keeps it", async () => {
    vi.mocked(getAssistantThread).mockResolvedValue(detailOf(threadOf()));
    const store = aStore();
    store.openThread(threadOf());
    await settled();
    store.composer.get().setDraft("typed into thread-1");
    store.composer.get().setAttachments(STAGED);
    expect(inputOf(store).scope).toBe("t:thread-1");

    // The palette-reopen shape: the SAME thread re-adopts — the draft
    // survives, exactly the dirty-modelPick rule.
    store.openThread(threadOf());
    await settled();
    expect(inputOf(store).draft).toBe("typed into thread-1");
    expect(inputOf(store).attachments).toBe(STAGED);

    // A DIFFERENT thread adopts — the visitor left the conversation the
    // text belonged to, and the empty input names its new home.
    const other = threadOf({
      id: "thread-2",
      stream_thread_id: "stream-thread-2",
    });
    vi.mocked(getAssistantThread).mockResolvedValue(
      detailOf(other, [turnOf({ id: "turn-2", thread_id: "thread-2" })]),
    );
    store.openThread(other);
    await settled();
    expect(store.conversation.get().active?.thread.id).toBe("thread-2");
    expect(inputOf(store).scope).toBe("t:thread-2");
    expect(inputOf(store).draft).toBe("");
    expect(inputOf(store).attachments).toEqual([]);
  });

  it("a refused thread switch keeps the draft with the conversation that stays", async () => {
    vi.mocked(getAssistantThread).mockResolvedValue(detailOf(threadOf()));
    const store = aStore();
    store.openThread(threadOf());
    await settled();
    store.composer.get().setDraft("typed into thread-1");

    vi.mocked(getAssistantThread).mockRejectedValueOnce(
      new ServingApiError({
        code: "INTERNAL",
        message: "the switch refused",
        status: 500,
        retryAfterSeconds: null,
      }),
    );
    store.openThread(
      threadOf({ id: "thread-2", stream_thread_id: "stream-thread-2" }),
    );
    await settled();

    expect(store.conversation.get().active?.thread.id).toBe("thread-1");
    expect(inputOf(store).scope).toBe("t:thread-1");
    expect(inputOf(store).draft).toBe("typed into thread-1");
  });

  it("startNewConversation clears the draft and the staged attachments — abandoning is a user action", async () => {
    vi.mocked(getAssistantThread).mockResolvedValue(detailOf(threadOf()));
    const store = aStore();
    store.openThread(threadOf());
    await settled();
    store.composer.get().setDraft("typed into thread-1");
    store.composer.get().setAttachments(STAGED);

    store.startNewConversation();
    await settled();

    // Abandon MINTS a fresh conversation-less scope (round 2): every
    // empty state is a NEW context, never a shared null.
    expect(inputOf(store).scope).toMatch(/^u:/);
    expect(inputOf(store).scope).not.toBe("u:0");
    expect(inputOf(store).draft).toBe("");
    expect(inputOf(store).attachments).toEqual([]);
  });

  it("the setters accept updaters that read live truth — the upload-continuation contract", () => {
    const store = aStore();
    store.composer.get().setDraft("half");
    store.composer.get().setDraft((current) => `${current} a question`);
    expect(inputOf(store).draft).toBe("half a question");

    store.composer.get().setAttachments(STAGED);
    store.composer
      .get()
      .setAttachments((current) =>
        current.map((item) => ({ ...item, status: "ready" as const })),
      );
    expect(inputOf(store).attachments).toEqual([
      { ...STAGED[0], status: "ready" },
    ]);
  });

  it("a keystroke never rides _publish — the conversation and composer snapshots hold still while the input cell moves", () => {
    const store = aStore();
    const conversationBefore = store.conversation.get();
    const composerBefore = store.composer.get();
    const inputBefore = inputOf(store);

    store.composer.get().setDraft("h");
    store.composer.get().setDraft((current) => `${current}i`);

    // The dedicated cell moved (the composer's own subscription pays)…
    expect(inputOf(store)).not.toBe(inputBefore);
    expect(inputOf(store).draft).toBe("hi");
    // …and both broad snapshots are the SAME objects — no publish, so
    // nothing beyond the composer re-renders on a keystroke (round-1
    // finding).
    expect(store.conversation.get()).toBe(conversationBefore);
    expect(store.composer.get()).toBe(composerBefore);
  });
});
