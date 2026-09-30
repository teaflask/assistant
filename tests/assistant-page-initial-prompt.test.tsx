// @vitest-environment jsdom
/**
 * The host's opening message: a surface that mounts on an empty
 * conversation sends it once, as if the visitor had typed it, so a host
 * that already knows what the visitor came to do can put them
 * mid-conversation instead of in front of a blank composer. Every guard
 * that keeps it from firing twice or firing wrongly is pinned here — a
 * duplicated first turn is a real, visible bug, and a turn sent over a
 * sign-in gate would 403 in the visitor's face.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantPage } from "../src/components/assistant-page";
import { TeaflaskAssistantProvider } from "../src/components/teaflask-assistant-provider";
import { sendAssistantMessage } from "../src/transport/serving-api";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The mint is the seam the tier guard turns on. The real session answers it
// through the registrants the PROVIDER wires in its effect, which lands
// after this surface's — so the stub reproduces both orders: `mintOnMount`
// false leaves the session unanswered exactly as it is during that window.
const mint = vi.hoisted(() => ({ onMount: true }));
vi.mock("../src/transport/token-session", () => ({
  TokenSession: class {
    constructor(config: { onMinted?: (m: { tier: string }) => void }) {
      if (mint.onMount) {
        // A microtask, never synchronously: the real mint is a round trip,
        // and the entry under construction here has no store yet.
        queueMicrotask(() => config.onMinted?.({ tier: "identified" }));
      }
    }
    dispose(): void {
      // Nothing to release — the suite never opens anything.
    }
    authorizedFetch(): Promise<never> {
      return Promise.reject(
        new Error("The initial-prompt suite never touches the network."),
      );
    }
  },
}));

// The send is the seam: whether the message left is the whole subject, so
// the transport answers with a never-settling promise and the call record
// is the proof.
vi.mock("../src/transport/serving-api", () => ({
  getAssistantThread: vi.fn(() => new Promise(() => undefined)),
  getAssistantConfig: vi.fn(() =>
    Promise.resolve({ suggestions: { default: [], routes: [] } }),
  ),
  listAssistantThreads: vi.fn(() => Promise.resolve([])),
  sendAssistantMessage: vi.fn(() => new Promise(() => undefined)),
  resolveTurnApproval: vi.fn(),
  resolveTurnToolResults: vi.fn(),
  createAttachmentUpload: vi.fn(),
  finalizeAttachment: vi.fn(),
  getAttachmentDownloadUrl: vi.fn(),
  putFileToUploadUrl: vi.fn(),
  streamUrlForThread: vi.fn(
    () => "https://api.example.test/serving/v1/assistant-threads/x/stream",
  ),
}));

let container: HTMLDivElement;
let root: Root;
// The session registry is a module singleton keyed on publishableKey — a
// fresh key per test keeps one test's store from bleeding into the next.
let testSerial = 0;

beforeEach(() => {
  testSerial += 1;
  mint.onMount = true;
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.clearAllMocks();
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

function renderPage(initialPrompt?: string, identity = true): void {
  act(() => {
    root.render(
      <TeaflaskAssistantProvider
        publishableKey={`pk_test_initial_${String(testSerial)}`}
        {...(identity ? { getEndUserToken: () => "end-user-token" } : {})}
      >
        <AssistantPage
          {...(initialPrompt === undefined ? {} : { initialPrompt })}
        />
      </TeaflaskAssistantProvider>,
    );
  });
}

/** Lets the stubbed mint answer, the way the real one does a tick later. */
async function settleMint(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function sentMessages(): string[] {
  return vi
    .mocked(sendAssistantMessage)
    .mock.calls.map(([, request]) => (request as { message: string }).message);
}

describe("AssistantPage initialPrompt", () => {
  it("sends the host's opening message once on an empty conversation", async () => {
    renderPage("Help me get started.");
    await settleMint();
    expect(sentMessages()).toEqual(["Help me get started."]);
  });

  it("sends nothing when the host supplies no prompt", async () => {
    renderPage();
    await settleMint();
    expect(sentMessages()).toEqual([]);
  });

  it("treats a blank prompt as no prompt", async () => {
    renderPage("   ");
    await settleMint();
    expect(sentMessages()).toEqual([]);
  });

  it("waits for the mint rather than triggering it", async () => {
    // THE regression: this surface's effect runs before the provider wires
    // the identity resolver, so a send here would mint with nothing to ask
    // and the session would fall open to anonymous — stranding the thread
    // it creates behind the identified re-mint that follows.
    mint.onMount = false;
    renderPage("Help me get started.");
    await settleMint();
    expect(sentMessages()).toEqual([]);
  });

  it("waits for the mint on an anonymous host too", async () => {
    // The wait is not about identity — it is about the retain, which is
    // also where the store bootstraps. A host that wires no identity still
    // must not send before that, or the greeting opens a second
    // conversation over the stored thread being resumed underneath.
    mint.onMount = false;
    renderPage("Help me get started.", false);
    await settleMint();
    expect(sentMessages()).toEqual([]);
  });

  it("never sends twice, however often the surface re-renders", async () => {
    renderPage("Help me get started.");
    await settleMint();
    renderPage("Help me get started.");
    await settleMint();
    renderPage("Help me get started.");
    await settleMint();
    expect(sentMessages()).toEqual(["Help me get started."]);
  });
});
