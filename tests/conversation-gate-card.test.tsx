// @vitest-environment jsdom
/**
 * The conversation gate: when the next send cannot serve without the
 * visitor acting, the composer's slab yields to the gate card — a
 * concierge moment, never an error — and the sign-in gate takes the
 * whole conversation area. The draft must survive the takeover: the
 * composer stays mounted and returns intact the moment the gate clears.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationView } from "../src/components/conversation-view";
import type { ComposerInput } from "../src/core/conversation-store";
import type { AssistantConversation } from "../src/components/use-assistant-conversation";
import type { SubscriptionStatus } from "../src/contract/subscriptions";
import { NO_GATE, type ConversationGate } from "../src/core/connect-gate";
import { ObservableCell } from "../src/core/observable-cell";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../src/components/transcript", () => ({
  Transcript: () => <div data-testid="transcript" />,
}));

const api = vi.hoisted(() => ({
  begin: vi.fn(),
  complete: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("../src/transport/serving-api", () => ({
  beginSubscriptionAuthorization: (...args: unknown[]) =>
    api.begin(...args) as unknown,
  completeSubscriptionAuthorization: (...args: unknown[]) =>
    api.complete(...args) as unknown,
  disconnectSubscription: (...args: unknown[]) =>
    api.disconnect(...args) as unknown,
}));

interface SessionFixture {
  session: object;
  tier: string | null;
  conversationGate: ObservableCell<ConversationGate>;
  subscriptions: ObservableCell<SubscriptionStatus[] | null>;
  attachmentPolicy: ObservableCell<null>;
  modelChoice: ObservableCell<null>;
  configAnswered: ObservableCell<boolean>;
  ensureAssistantConfig: () => void;
  refreshAssistantConfig: ReturnType<typeof vi.fn>;
  ensureSubscriptions: ReturnType<typeof vi.fn>;
  refreshSubscriptions: ReturnType<typeof vi.fn>;
  connectOpenRequested: ObservableCell<boolean>;
  acknowledgeSubscriptionConnect: () => void;
}
const sessionFixture = vi.hoisted(() => ({
  value: null as unknown as SessionFixture,
}));
vi.mock("../src/components/teaflask-assistant-provider", () => ({
  useAssistantSession: () => sessionFixture.value,
  useOptionalAssistantSession: () => sessionFixture.value,
}));

const OFFERED_UNCONNECTED: SubscriptionStatus = {
  provider: "openai_chatgpt",
  offered: true,
  connected: false,
  state: null,
  plan_type: null,
  bounce_cause: null,
  bounce_retry_at: null,
};

function emptyConversation(): AssistantConversation {
  // The store's part, played by the fixture: a live input cell plus a
  // setter that writes it — the shipped shape — so the controlled
  // textarea round-trips keystrokes through the real useCell
  // subscription. Fresh per call, like the store a fresh mount reads.
  const composerInput = new ObservableCell<ComposerInput>({
    scope: "u:0",
    draft: "",
    attachments: [],
  });
  return {
    composerContract: {
      busy: false,
      sendMessage: () => Promise.resolve(true),
      pendingEcho: null,
      composerRefocusPending: false,
      markComposerRefocusHandled: () => undefined,
      composerInput,
      setDraft: (next: string | ((current: string) => string)) => {
        const current = composerInput.get();
        composerInput.set({
          ...current,
          draft: typeof next === "function" ? next(current.draft) : next,
        });
      },
      setAttachments: () => undefined,
      noteComposerFocus: () => undefined,
      takeComposerCaretReturn: () => false,
    },
    conversation: null,
    threadOpening: false,
    showInterruptionBanner: false,
    sendError: null,
    turnFailure: null,
    setupError: null,
    reconnectNonce: 0,
    pendingDecisionGap: null,
    refreshConversation: () => Promise.resolve(),
    retryStream: () => undefined,
    startNewConversation: () => undefined,
    resumeStoredThread: () => undefined,
  } as unknown as AssistantConversation;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  sessionFixture.value = {
    session: { baseUrl: "https://api.example.test" },
    tier: "identified",
    conversationGate: new ObservableCell<ConversationGate>(NO_GATE),
    subscriptions: new ObservableCell<SubscriptionStatus[] | null>(null),
    attachmentPolicy: new ObservableCell<null>(null),
    modelChoice: new ObservableCell<null>(null),
    configAnswered: new ObservableCell<boolean>(false),
    ensureAssistantConfig: () => undefined,
    refreshAssistantConfig: vi.fn(),
    ensureSubscriptions: vi.fn(),
    refreshSubscriptions: vi.fn(),
    connectOpenRequested: new ObservableCell<boolean>(false),
    acknowledgeSubscriptionConnect: () => undefined,
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function renderView(core: AssistantConversation = emptyConversation()): void {
  act(() => {
    root.render(<ConversationView core={core} surface="page" />);
  });
}

function setGate(gate: ConversationGate): void {
  act(() => {
    sessionFixture.value.conversationGate.set(gate);
  });
}

function setStatuses(statuses: SubscriptionStatus[]): void {
  act(() => {
    sessionFixture.value.subscriptions.set(statuses);
  });
}

function textarea(): HTMLTextAreaElement | null {
  return container.querySelector("textarea");
}

function buttonByText(text: string): HTMLButtonElement | null {
  return (
    [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === text,
    ) ?? null
  );
}

describe("the connect gate card", () => {
  it("a spent taster is an inline banner — the composer stays", () => {
    setGate({
      kind: "connect",
      reason: "taster_exhausted",
      providers: ["openai_chatgpt"],
    });
    setStatuses([OFFERED_UNCONNECTED]);
    renderView();

    // The chat-product grammar: the moment rides a banner above the
    // input, never a takeover of it.
    expect(textarea()).not.toBeNull();
    expect(container.textContent).toContain(
      "You've used the free preview on this assistant.",
    );
    expect(container.textContent).toContain(
      "Conversations here will use your ChatGPT plan's included usage.",
    );
    expect(buttonByText("Sign in with ChatGPT")).not.toBeNull();
  });

  it("an expired connection asks for the reconnect, not the preview copy", () => {
    setGate({
      kind: "connect",
      reason: "auth_bounced",
      providers: ["openai_chatgpt"],
    });
    setStatuses([
      {
        ...OFFERED_UNCONNECTED,
        connected: true,
        state: "bounced",
        bounce_cause: "auth",
      },
    ]);
    renderView();

    expect(textarea()).not.toBeNull();
    expect(container.textContent).toContain(
      "Your ChatGPT connection stopped working.",
    );
    expect(container.textContent).not.toContain("free preview");
    expect(buttonByText("Reconnect ChatGPT")).not.toBeNull();
  });

  it("holds a quiet beat while the standing read is in flight", () => {
    setGate({
      kind: "connect",
      reason: "taster_exhausted",
      providers: ["openai_chatgpt"],
    });
    renderView();

    expect(container.textContent).toContain("One moment…");
    expect(sessionFixture.value.ensureSubscriptions).toHaveBeenCalled();
  });
});

describe("the wait and verifying gates", () => {
  it("a wait gate promises the reset in the largest sensible unit", () => {
    setGate({ kind: "wait", retryAtMs: Date.now() + 3 * 3600 * 1000 });
    renderView();

    expect(textarea()).not.toBeNull();
    expect(container.textContent).toContain(
      "Your ChatGPT plan's included usage is used up for this period.",
    );
    expect(container.textContent).toContain("in about 3 hours");
  });

  it("a monthly-window horizon never fires the wait timer immediately", async () => {
    // The regression (2026-08-20): setTimeout's 32-bit delay overflows
    // past ~24.8 days and fires at once; the recomputed horizon then
    // drifts by the round trip, defeating the gate dedupe and re-arming
    // into a continuous config-GET storm. The clamp re-checks early
    // instead — never immediately.
    vi.useFakeTimers();
    const aMonthMs = 40 * 24 * 3600 * 1000;
    sessionFixture.value.refreshAssistantConfig.mockImplementation(() => {
      // The drifted re-read the storm fed on.
      sessionFixture.value.conversationGate.set({
        kind: "wait",
        retryAtMs: Date.now() + aMonthMs - 137,
      });
    });
    setGate({ kind: "wait", retryAtMs: Date.now() + aMonthMs });
    renderView();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(sessionFixture.value.refreshAssistantConfig).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("a verifying gate reads as the credential's own verify when one is", () => {
    setGate({ kind: "verifying" });
    setStatuses([
      { ...OFFERED_UNCONNECTED, connected: true, state: "verifying" },
    ]);
    renderView();

    expect(textarea()).not.toBeNull();
    expect(container.textContent).toContain(
      "Verifying your ChatGPT connection…",
    );
  });

  it("a verifying gate with no credential reads as the plan re-check", () => {
    setGate({ kind: "verifying" });
    setStatuses([OFFERED_UNCONNECTED]);
    renderView();

    expect(container.textContent).toContain("Re-checking your plan");
  });

  it("the verifying re-read stays bounded under render churn", async () => {
    // The regression (2026-08-20): an unmemoized refresh callback got a
    // fresh identity from every re-render the re-read itself caused (the
    // projection mints a fresh gate object each read), so the chain's
    // effect re-armed with its attempts counter reset — an unbounded
    // 4s poll. Here every refresh re-renders the tree by writing a
    // fresh-but-equal gate; the bound must still hold.
    vi.useFakeTimers();
    setGate({ kind: "verifying" });
    setStatuses([
      { ...OFFERED_UNCONNECTED, connected: true, state: "verifying" },
    ]);
    sessionFixture.value.refreshAssistantConfig.mockImplementation(() => {
      sessionFixture.value.conversationGate.set({ kind: "verifying" });
    });
    renderView();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000 * 20);
    });
    expect(
      sessionFixture.value.refreshAssistantConfig.mock.calls.length,
    ).toBeLessThanOrEqual(5);
    vi.useRealTimers();
  });
});

describe("the draft survives the gate", () => {
  it("the draft stays put while the banner comes and goes", () => {
    renderView();
    const box = textarea();
    expect(box).not.toBeNull();
    act(() => {
      if (box !== null) {
        // React controlled inputs ignore direct .value writes — go
        // through the prototype's native setter, then announce it.
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set?.call(box, "half a question");
        box.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    expect(textarea()?.value).toBe("half a question");

    setGate({
      kind: "connect",
      reason: "taster_exhausted",
      providers: ["openai_chatgpt"],
    });
    setStatuses([OFFERED_UNCONNECTED]);
    expect(textarea()?.value).toBe("half a question");
    expect(buttonByText("Sign in with ChatGPT")).not.toBeNull();

    setGate(NO_GATE);
    // The banner leaves (its sentence with it); the chip on the shelf is
    // now the one carrying the sign-in verb.
    expect(container.textContent).not.toContain(
      "You've used the free preview on this assistant.",
    );
    expect(textarea()?.value).toBe("half a question");
  });
});

describe("the gated welcome", () => {
  it("suppresses opening prompts while gated", () => {
    // A live-looking prompt over a gate silently 403s — the first click
    // on the screen must never be a dead control (design review
    // 2026-08-20).
    function renderWithSuggestions(): void {
      act(() => {
        root.render(
          <ConversationView
            core={emptyConversation()}
            surface="page"
            suggestions={[{ prompt: "How do I get started?" }]}
          />,
        );
      });
    }
    renderWithSuggestions();
    expect(container.textContent).toContain("How do I get started?");

    setGate({
      kind: "connect",
      reason: "taster_exhausted",
      providers: ["openai_chatgpt"],
    });
    setStatuses([OFFERED_UNCONNECTED]);
    expect(container.textContent).not.toContain("How do I get started?");

    setGate(NO_GATE);
    expect(container.textContent).toContain("How do I get started?");
  });
});

describe("the waiting arm's exit", () => {
  it("Start over abandons the sign-in and returns to the ask", async () => {
    setGate({
      kind: "connect",
      reason: "taster_exhausted",
      providers: ["openai_chatgpt"],
    });
    setStatuses([OFFERED_UNCONNECTED]);
    renderView();
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    api.begin.mockResolvedValueOnce({
      authorize_url:
        "https://auth.openai.com/api/accounts/authorize?state=sealed",
      expires_in: 600,
    });
    await act(async () => {
      buttonByText("Sign in with ChatGPT")?.click();
      await Promise.resolve();
    });
    expect(opened).toHaveBeenCalledWith(
      "https://auth.openai.com/api/accounts/authorize?state=sealed",
      "_blank",
      "popup,width=520,height=720",
    );
    expect(container.textContent).toContain("Waiting for ChatGPT…");
    expect(container.textContent).toContain("Finish signing in to ChatGPT");

    act(() => {
      buttonByText("Start over")?.click();
    });

    expect(container.textContent).not.toContain("Waiting for ChatGPT…");
    expect(buttonByText("Sign in with ChatGPT")).not.toBeNull();
  });
});

describe("the sign-in gate", () => {
  it("takes the whole conversation area with the almost-404 state", () => {
    setGate({ kind: "sign_in" });
    renderView();

    expect(container.textContent).toContain(
      "This assistant is available to signed-in users.",
    );
    expect(container.textContent).toContain(
      "Sign in to this site to start chatting.",
    );
    expect(textarea()).toBeNull();
    expect(container.textContent).not.toContain("Where should we begin?");
  });
});

describe("the failure banner", () => {
  it("speaks the settled sentence alone — no problem preamble", () => {
    const core = emptyConversation();
    (core as { turnFailure: string | null }).turnFailure =
      "You've used the free preview on this assistant. Connect your ChatGPT plan to keep chatting.";
    renderView(core);

    expect(container.textContent).not.toContain("The assistant hit a problem");
    expect(container.textContent).toContain(
      "You've used the free preview on this assistant.",
    );
  });
});
