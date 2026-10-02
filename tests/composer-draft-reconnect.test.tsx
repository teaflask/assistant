// @vitest-environment jsdom
/**
 * The falsified pair: unsaved composer input survives the
 * reconnect-nonce remount. Both tests FAIL against pre-fix HEAD — they
 * use only the store's public API and the DOM, and before the lift the
 * draft and staged attachments were the keyed subtree's local state, so
 * the remount destroyed them.
 *
 * A REAL AssistantConversationStore drives a REAL ConversationView here
 * (no other suite wires the two together): the remount must actually
 * happen — the ruling that the death arm repaints the subtree is pinned
 * by element identity — while the typed text and the in-flight upload
 * land intact on the fresh instance.
 */
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import type { RunAgentResult } from "@ag-ui/client";

import { ConversationView } from "../src/components/conversation-view";
import { useAssistantConversation } from "../src/components/use-assistant-conversation";
import type { ServedAttachmentPolicy } from "../src/contract/assistant-config";
import type {
  AssistantThreadDetailResponse,
  AttachmentUploadIntent,
  ServingAssistantThread,
  ServingAssistantTurn,
  ServingAttachment,
} from "../src/contract/threads";
import { NO_GATE, type ConversationGate } from "../src/core/connect-gate";
import { AssistantConversationStore } from "../src/core/conversation-store";
import { ObservableCell } from "../src/core/observable-cell";
import { writeStoredThread } from "../src/persistence/stored-thread";
import { ServingReplayStreamAgent } from "../src/transport/replay-stream-agent";
import {
  createAttachmentUpload,
  finalizeAttachment,
  getAssistantThread,
  putFileToUploadUrl,
  sendAssistantMessage,
} from "../src/transport/serving-api";
import type { TokenSession } from "../src/transport/token-session";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
  ResizeObserverStub;

vi.mock("../src/transport/serving-api", () => ({
  getAssistantThread: vi.fn(),
  listAssistantThreads: vi.fn(),
  sendAssistantMessage: vi.fn(),
  stopAssistantTurn: vi.fn(),
  resolveTurnApproval: vi.fn(),
  resolveTurnToolResults: vi.fn(),
  createAttachmentUpload: vi.fn(),
  putFileToUploadUrl: vi.fn(),
  finalizeAttachment: vi.fn(),
  getAttachmentDownloadUrl: vi.fn(),
  streamUrlForThread: vi.fn(
    () => "https://api.example.test/serving/v1/assistant-threads/x/stream",
  ),
}));

// The dispatch ledger is another lane's file — this suite only
// needs its return value, and none of its cases dispatch subagents.
vi.mock("../src/components/use-thread-dispatches", () => ({
  useThreadDispatches: () => new Map(),
}));

const sessionFixture = vi.hoisted((): { value: unknown } => ({
  value: null,
}));
vi.mock("../src/components/teaflask-assistant-provider", () => ({
  useAssistantSession: () => sessionFixture.value,
  useOptionalAssistantSession: () => sessionFixture.value,
}));

const PK = "pk_test_draft_reconnect";
const SESSION = {} as TokenSession;

const POLICY: ServedAttachmentPolicy = {
  kinds: ["image"],
  max_bytes_by_kind: { image: 1_000_000 },
  max_per_message: 2,
};

function threadOf(
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

function turnOf(
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

function workingDetail(): AssistantThreadDetailResponse {
  return {
    thread: threadOf({ busy: true }),
    turns: [turnOf({ status: "working" })],
  };
}

function succeededDetail(): AssistantThreadDetailResponse {
  return { thread: threadOf(), turns: [turnOf()] };
}

const RUN_ENDED = {} as RunAgentResult;

// The chrome under test, wired exactly as production: the hook reads the
// real store's cells, the view keys <Transcript> by
// thread.id#reconnectNonce, the composer inside it reads the contract.
function Harness() {
  const core = useAssistantConversation();
  return <ConversationView core={core} surface="page" />;
}

// Two surfaces over ONE store, the TeaflaskAssistant shape (page or
// drawer beside an open palette): a reconnect-nonce bump remounts both
// keyed transcripts in a single commit, and the page's fresh composer
// runs its effects first in tree order.
function DualHarness() {
  const core = useAssistantConversation();
  return (
    <>
      <ConversationView core={core} surface="page" />
      <ConversationView core={core} surface="palette" />
    </>
  );
}

let connectAgent: MockInstance<
  (typeof ServingReplayStreamAgent.prototype)["connectAgent"]
>;
let store: AssistantConversationStore;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  vi.mocked(getAssistantThread).mockReset();
  vi.mocked(sendAssistantMessage).mockReset();
  vi.mocked(createAttachmentUpload).mockReset();
  vi.mocked(putFileToUploadUrl).mockReset();
  vi.mocked(finalizeAttachment).mockReset();
  connectAgent = vi
    .spyOn(ServingReplayStreamAgent.prototype, "connectAgent")
    .mockImplementation(() => new Promise<never>(() => undefined));
  vi.spyOn(
    ServingReplayStreamAgent.prototype,
    "detachActiveRun",
  ).mockResolvedValue(undefined);
  store = new AssistantConversationStore({
    session: SESSION,
    publishableKey: PK,
    hostCapabilitiesOf: () => ({ navigate: null, executeActionIntent: null }),
    reportError: vi.fn(),
    onTelemetry: vi.fn(),
    onGateRefusal: vi.fn(),
    onTurnSettled: vi.fn(),
  });
  sessionFixture.value = {
    setupError: null,
    session: SESSION,
    store,
    attachmentPolicy: new ObservableCell<ServedAttachmentPolicy | null>(POLICY),
    conversationGate: new ObservableCell<ConversationGate>(NO_GATE),
    ensureAssistantConfig: () => undefined,
    tier: null,
    subscriptions: new ObservableCell(null),
    ensureSubscriptions: () => undefined,
    modelChoice: new ObservableCell(null),
    configAnswered: new ObservableCell(false),
    connectOpenRequested: new ObservableCell(false),
    acknowledgeSubscriptionConnect: () => undefined,
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  store.dispose();
  vi.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function typeInto(box: HTMLTextAreaElement, text: string): void {
  act(() => {
    // React controlled inputs ignore direct .value writes — go through
    // the prototype's native setter, then announce it.
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set?.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("unsaved input survives the reconnect-nonce remount", () => {
  it("a draft typed over a live turn survives a stream death under the same turn id — the remount happens, the text does not die with it", async () => {
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

    act(() => {
      root.render(<Harness />);
    });
    act(() => {
      store.bootstrap();
    });
    await flush();
    await flush();

    const before = host.querySelector<HTMLTextAreaElement>("textarea");
    if (before === null) {
      throw new Error("The working page rendered no composer textarea.");
    }
    expect(store.conversation.get().reconnectNonce).toBe(0);
    expect(connectAgent).toHaveBeenCalledTimes(1);

    typeInto(before, "half a question");
    expect(before.value).toBe("half a question");

    // The stream dies; the close's refresh reads the SAME working turn —
    // the death arm bumps the nonce and the keyed subtree remounts.
    await act(async () => {
      endStream(RUN_ENDED);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(store.conversation.get().reconnectNonce).toBe(1);
    const after = host.querySelector<HTMLTextAreaElement>("textarea");
    expect(after).not.toBeNull();
    // The ruling intact: the death arm still repaints the subtree…
    expect(after).not.toBe(before);
    // …and the fix: the visitor's text is still there.
    expect(after?.value).toBe("half a question");
  });

  it("an upload still in flight across a reconnect remount lands its chip on the fresh composer", async () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(succeededDetail());

    act(() => {
      root.render(<Harness />);
    });
    act(() => {
      store.bootstrap();
    });
    await flush();
    await flush();
    const before = host.querySelector<HTMLTextAreaElement>("textarea");
    expect(before).not.toBeNull();

    vi.mocked(createAttachmentUpload).mockResolvedValue({
      upload_url: "https://upload.example.test/att-1",
      attachment: { id: "att-1" },
    } as unknown as AttachmentUploadIntent);
    vi.mocked(putFileToUploadUrl).mockResolvedValue(undefined);
    let settleFinalize!: (attachment: ServingAttachment) => void;
    vi.mocked(finalizeAttachment).mockImplementation(
      () =>
        new Promise<ServingAttachment>((resolve) => {
          settleFinalize = resolve;
        }),
    );

    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    Object.defineProperty(input, "files", {
      value: [new File(["x"], "leaf.png", { type: "image/png" })],
      configurable: true,
    });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(host.textContent).toContain("leaf.png");
    expect(host.textContent).toContain("uploading");

    // A user Retry moves the remount key mid-upload.
    const nonceBefore = store.conversation.get().reconnectNonce;
    act(() => {
      store.retryStream();
    });
    await flush();
    expect(store.conversation.get().reconnectNonce).toBe(nonceBefore + 1);
    const after = host.querySelector<HTMLTextAreaElement>("textarea");
    expect(after).not.toBe(before);
    // Pre-fix the chip died with the instance…
    expect(host.textContent).toContain("leaf.png");

    // …and the continuation, closing over the store's stable setter,
    // lands READY on the fresh instance instead of an unmounted one.
    await act(async () => {
      settleFinalize({
        id: "att-1",
        kind: "image",
        format: "image/png",
        filename: "leaf.png",
        byte_size: 1,
        ready: true,
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("leaf.png");
    expect(host.textContent).not.toContain("uploading");
  });

  it("a send refused after a thread switch does not restore the old thread's text into the new conversation", async () => {
    // FALSIFIED against the unguarded restore (round-1 finding 1): the
    // setters are store arrows, so without the composer's scope guard a
    // refusal landing after a mid-flight thread switch writes thread-1's
    // text into thread-2's composer.
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(succeededDetail());
    act(() => {
      root.render(<Harness />);
    });
    act(() => {
      store.bootstrap();
    });
    await flush();
    await flush();
    const box = host.querySelector<HTMLTextAreaElement>("textarea");
    if (box === null) {
      throw new Error("The page rendered no composer textarea.");
    }
    typeInto(box, "typed into thread-1");

    let refuseSend!: (error: Error) => void;
    vi.mocked(sendAssistantMessage).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          refuseSend = reject;
        }),
    );
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('button[aria-label="Send message"]')
        ?.click();
      await Promise.resolve();
    });
    // The optimistic clear consumed the draft; the POST is in flight.
    expect(store.composer.get().composerInput.get().draft).toBe("");

    // The visitor switches threads while the POST is still out.
    const other = threadOf({
      id: "thread-2",
      stream_thread_id: "stream-thread-2",
    });
    vi.mocked(getAssistantThread).mockResolvedValue({
      thread: other,
      turns: [turnOf({ id: "turn-2", thread_id: "thread-2" })],
    });
    await act(async () => {
      store.openThread(other);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(store.composer.get().composerInput.get().scope).toBe("t:thread-2");

    // The send refuses AFTER the switch: the restore must not leak
    // thread-1's text into thread-2's composer.
    await act(async () => {
      refuseSend(new Error("the POST failed"));
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(store.composer.get().composerInput.get().draft).toBe("");
    expect(host.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
  });

  it("a refusal restore still lands when the visitor left and came back to the sending conversation", async () => {
    // RULING PIN, not a falsified test (the unguarded restore also
    // landed here): the guard compares thread IDENTITY, not a
    // clear-counter, so refused text returns to the conversation it was
    // typed in even after an A→B→A round trip — the text was in flight,
    // not a draft, when those switches cleared the input.
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(succeededDetail());
    act(() => {
      root.render(<Harness />);
    });
    act(() => {
      store.bootstrap();
    });
    await flush();
    await flush();
    const box = host.querySelector<HTMLTextAreaElement>("textarea");
    if (box === null) {
      throw new Error("The page rendered no composer textarea.");
    }
    typeInto(box, "typed into thread-1");

    let refuseSend!: (error: Error) => void;
    vi.mocked(sendAssistantMessage).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          refuseSend = reject;
        }),
    );
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('button[aria-label="Send message"]')
        ?.click();
      await Promise.resolve();
    });

    // Away to thread-2, then back to thread-1, all mid-POST.
    const other = threadOf({
      id: "thread-2",
      stream_thread_id: "stream-thread-2",
    });
    vi.mocked(getAssistantThread).mockResolvedValueOnce({
      thread: other,
      turns: [turnOf({ id: "turn-2", thread_id: "thread-2" })],
    });
    await act(async () => {
      store.openThread(other);
      await Promise.resolve();
      await Promise.resolve();
    });
    vi.mocked(getAssistantThread).mockResolvedValue(succeededDetail());
    await act(async () => {
      store.openThread(threadOf());
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(store.composer.get().composerInput.get().scope).toBe("t:thread-1");

    await act(async () => {
      refuseSend(new Error("the POST failed"));
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(host.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "typed into thread-1",
    );
  });

  it("a stream death while the caret is in the box hands the caret back AT the remount, not at settle", async () => {
    // FALSIFIED against the settle-gated restore (round-2 facet i): the
    // death arm fires only over a live turn, the box stays enabled, and
    // a busy-gated refocus leaves the visitor typing into <body> for the
    // rest of the answer.
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

    act(() => {
      root.render(<Harness />);
    });
    act(() => {
      store.bootstrap();
    });
    await flush();
    await flush();
    const before = host.querySelector<HTMLTextAreaElement>("textarea");
    if (before === null) {
      throw new Error("The working page rendered no composer textarea.");
    }
    typeInto(before, "half a question");
    act(() => {
      before.focus();
    });
    expect(document.activeElement).toBe(before);

    await act(async () => {
      endStream(RUN_ENDED);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    const after = host.querySelector<HTMLTextAreaElement>("textarea");
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    // The turn is STILL live (busy) — and the caret is already back.
    expect(store.activity.get().newestTurnStatus).toBe("working");
    expect(document.activeElement).toBe(after);
  });

  it("a stream death while the visitor never touched the composer claims nobody's focus — not even at settle", async () => {
    // FALSIFIED against the unconditional flag (round-2 facet ii): body
    // is the resting state of a visitor who never focused the composer,
    // and the settle-time refocus used to read it as "dropped by the
    // remount" and park the caret in a box they never touched.
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

    act(() => {
      root.render(<Harness />);
    });
    act(() => {
      store.bootstrap();
    });
    await flush();
    await flush();
    // The visitor is reading, not writing: focus rests on <body>.
    expect(document.activeElement).toBe(document.body);

    await act(async () => {
      endStream(RUN_ENDED);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    expect(document.activeElement).toBe(document.body);

    // The turn settles — the window where the settle-gated restore used
    // to fire. Focus must stay wherever the visitor left it.
    vi.mocked(getAssistantThread).mockResolvedValue(succeededDetail());
    await act(async () => {
      await store.refreshConversation();
    });
    await flush();
    expect(store.activity.get().newestTurnStatus).toBe("succeeded");
    expect(document.activeElement).toBe(document.body);
  });

  it("a first send refused after New conversation does not restore the abandoned attempt into the fresh composer", async () => {
    // FALSIFIED against the thread-id scope guard (round-2 finding 2):
    // null is not an identity — every conversation-less state shared it,
    // so the empty state before New conversation and the fresh one after
    // compared equal and the refusal leaked the abandoned text back in.
    vi.mocked(getAssistantThread).mockResolvedValue(succeededDetail());
    act(() => {
      root.render(<Harness />);
    });
    act(() => {
      store.bootstrap();
    });
    await flush();
    const box = host.querySelector<HTMLTextAreaElement>("textarea");
    if (box === null) {
      throw new Error("The empty state rendered no composer textarea.");
    }
    typeInto(box, "a first question, never sent");

    let refuseSend!: (error: Error) => void;
    vi.mocked(sendAssistantMessage).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          refuseSend = reject;
        }),
    );
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('button[aria-label="Send message"]')
        ?.click();
      await Promise.resolve();
    });
    expect(store.composer.get().composerInput.get().draft).toBe("");

    // New conversation while the first POST is still out.
    await act(async () => {
      store.startNewConversation();
      await Promise.resolve();
    });

    // The send refuses AFTER the abandon: the fresh conversation must
    // not inherit the abandoned attempt.
    await act(async () => {
      refuseSend(new Error("the POST failed"));
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(store.composer.get().composerInput.get().draft).toBe("");
    expect(host.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
  });

  it("focus left behind in a departed thread never arms a caret return in the next one", async () => {
    // FALSIFIED against the round-2 record (round-3 finding 1, path A):
    // the thread-switch skeleton swap unmounts a focused textarea with
    // no blur, so the store's focus record read stale-true and a stream
    // death under the NEW thread focused a composer the visitor never
    // touched there.
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(succeededDetail());
    let endFirst!: (result: RunAgentResult) => void;
    connectAgent.mockImplementationOnce(
      () =>
        new Promise<RunAgentResult>((resolve) => {
          endFirst = resolve;
        }),
    );
    act(() => {
      root.render(<Harness />);
    });
    act(() => {
      store.bootstrap();
    });
    await flush();
    await flush();
    // Thread-1's settled stream closes quietly, releasing the connect
    // gate for the thread-2 tail below.
    await act(async () => {
      endFirst(RUN_ENDED);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    const inThreadOne = host.querySelector<HTMLTextAreaElement>("textarea");
    if (inThreadOne === null) {
      throw new Error("Thread-1 rendered no composer textarea.");
    }
    act(() => {
      inThreadOne.focus();
    });
    expect(document.activeElement).toBe(inThreadOne);

    // Switch to thread-2, whose turn is live; capture its tail stream.
    const other = threadOf({
      id: "thread-2",
      stream_thread_id: "stream-thread-2",
      busy: true,
    });
    const workingTwo = {
      thread: other,
      turns: [
        turnOf({ id: "turn-2", thread_id: "thread-2", status: "working" }),
      ],
    };
    vi.mocked(getAssistantThread).mockResolvedValue(workingTwo);
    let endStream!: (result: RunAgentResult) => void;
    connectAgent.mockImplementationOnce(
      () =>
        new Promise<RunAgentResult>((resolve) => {
          endStream = resolve;
        }),
    );
    await act(async () => {
      store.openThread(other);
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    // The visitor is READING thread-2 — the caret is nowhere.
    expect(document.activeElement).toBe(document.body);

    await act(async () => {
      endStream(RUN_ENDED);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    // The death arm fired under thread-2…
    expect(store.conversation.get().reconnectNonce).toBe(1);
    // …and nobody's focus was claimed.
    expect(document.activeElement).toBe(document.body);
  });

  it("focus left behind by a closed surface never arms a caret return on the reopened one", async () => {
    // FALSIFIED against the round-2 record (round-3 finding 1, path B):
    // closing a surface (the palette's Escape) unmounts a focused
    // textarea with no blur — the record read stale-true, and the next
    // stream death focused the reopened composer nobody had touched.
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
    act(() => {
      root.render(<Harness />);
    });
    act(() => {
      store.bootstrap();
    });
    await flush();
    await flush();
    const before = host.querySelector<HTMLTextAreaElement>("textarea");
    if (before === null) {
      throw new Error("The working page rendered no composer textarea.");
    }
    act(() => {
      before.focus();
    });
    expect(document.activeElement).toBe(before);

    // The surface closes (unmount, no blur) and reopens; the visitor
    // does not touch the reopened composer.
    act(() => {
      root.render(<span />);
    });
    act(() => {
      root.render(<Harness />);
    });
    await flush();
    expect(document.activeElement).toBe(document.body);

    await act(async () => {
      endStream(RUN_ENDED);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(store.conversation.get().reconnectNonce).toBe(1);
    expect(document.activeElement).toBe(document.body);
  });

  it("with two surfaces mounted, the caret returns to the surface that owned it — a bystander cannot eat the return", async () => {
    // FALSIFIED against the unscoped take (round-4 finding 1): both
    // keyed transcripts remount on one bump, the page composer's effect
    // runs first in tree order, and its unconditional take burned the
    // one-shot — the caret landed in the page's box (or nowhere) while
    // the palette's composer, the one the visitor was typing in, took
    // false.
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
    act(() => {
      root.render(<DualHarness />);
    });
    act(() => {
      store.bootstrap();
    });
    await flush();
    await flush();
    const boxes = host.querySelectorAll<HTMLTextAreaElement>("textarea");
    expect(boxes).toHaveLength(2);
    // The caret is in the SECOND surface's box (the palette).
    act(() => {
      boxes[1].focus();
    });
    expect(document.activeElement).toBe(boxes[1]);

    await act(async () => {
      endStream(RUN_ENDED);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    const fresh = host.querySelectorAll<HTMLTextAreaElement>("textarea");
    expect(fresh).toHaveLength(2);
    expect(fresh[1]).not.toBe(boxes[1]);
    // The palette's fresh composer — not the page's — holds the caret.
    expect(document.activeElement).toBe(fresh[1]);
  });

  it("under StrictMode, the caret return keeps working past the first death — the replayed cleanup never clears a live record", async () => {
    // FALSIFIED against the ref-only cleanup guard (round-4 finding 2):
    // StrictMode's simulated unmount fired the cleanup on a mounted,
    // focused textarea right after the first death's refocus, clearing
    // the record — so the SECOND death under the same turn armed
    // nothing and the visitor typed into <body> for the rest of the
    // answer.
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    vi.mocked(getAssistantThread).mockResolvedValue(workingDetail());
    let endFirst!: (result: RunAgentResult) => void;
    let endSecond!: (result: RunAgentResult) => void;
    connectAgent
      .mockImplementationOnce(
        () =>
          new Promise<RunAgentResult>((resolve) => {
            endFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<RunAgentResult>((resolve) => {
            endSecond = resolve;
          }),
      )
      .mockImplementation(() => new Promise<never>(() => undefined));
    act(() => {
      root.render(
        <StrictMode>
          <Harness />
        </StrictMode>,
      );
    });
    act(() => {
      store.bootstrap();
    });
    await flush();
    await flush();
    const first = host.querySelector<HTMLTextAreaElement>("textarea");
    if (first === null) {
      throw new Error("The working page rendered no composer textarea.");
    }
    act(() => {
      first.focus();
    });
    expect(document.activeElement).toBe(first);

    // Death #1: the caret comes back at the remount…
    await act(async () => {
      endFirst(RUN_ENDED);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    const second = host.querySelector<HTMLTextAreaElement>("textarea");
    expect(second).not.toBe(first);
    expect(document.activeElement).toBe(second);

    // …and death #2 — well within the automatic budget — must return
    // it AGAIN: dev-time StrictMode may not spend the mechanism.
    await act(async () => {
      endSecond(RUN_ENDED);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    const third = host.querySelector<HTMLTextAreaElement>("textarea");
    expect(third).not.toBe(second);
    expect(store.conversation.get().reconnectNonce).toBe(2);
    expect(document.activeElement).toBe(third);
  });
});
