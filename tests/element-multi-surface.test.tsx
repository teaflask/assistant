// @vitest-environment jsdom
/**
 * The multi-surface proof: a widget element and a page element with the
 * same publishable key on one host page are two separate React roots,
 * and a turn's streamed reply still lands in both — because both
 * providers resolved the SAME store through the session registry. The
 * stream itself rides the store-suite recipe (a mocked stream agent the
 * test pushes messages through); only the scroll viewport is stubbed,
 * so the real page chrome, transcript wiring, and cross-root cell
 * subscriptions are all live.
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assistantSessionRegistry } from "../src/core/assistant-session-registry";
import type { TranscriptRow } from "../src/core/transcript-rows";
import { defineTeaflaskAssistantElement } from "../src/element/assistant-element";
import { defineTeaflaskAssistantPageElement } from "../src/element/assistant-page-element";
import {
  ELEMENT_TAG_NAME,
  PAGE_ELEMENT_TAG_NAME,
} from "../src/element/element-config";
import {
  getAssistantThread,
  sendAssistantMessage,
} from "../src/transport/serving-api";
import { ServingReplayStreamAgent } from "../src/transport/replay-stream-agent";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../src/transport/token-session", () => ({
  TokenSession: class {
    dispose(): void {
      // Nothing to release — the suite never opens anything.
    }
    authorizedFetch(): Promise<never> {
      return Promise.reject(
        new Error("The multi-surface suite never touches the network."),
      );
    }
  },
}));

vi.mock("../src/transport/serving-api", () => ({
  getAssistantThread: vi.fn(),
  listAssistantThreads: vi.fn(() => Promise.resolve([])),
  sendAssistantMessage: vi.fn(),
  resolveTurnApproval: vi.fn(),
  resolveTurnToolResults: vi.fn(),
  getAssistantConfig: vi.fn(() =>
    Promise.resolve({ suggestions: { default: [], routes: [] } }),
  ),
  createAttachmentUpload: vi.fn(),
  finalizeAttachment: vi.fn(),
  getAttachmentDownloadUrl: vi.fn(),
  putFileToUploadUrl: vi.fn(),
  streamUrlForThread: vi.fn(
    () => "https://api.example.test/serving/v1/assistant-threads/x/stream",
  ),
}));

// Only the scroll viewport is stubbed (its stick-to-bottom machinery
// needs a real layout engine); the rows it receives are the real
// transcript pipeline's output.
vi.mock("../src/components/message-list", () => ({
  MessageList: ({ rows }: { rows: readonly TranscriptRow[] }) => (
    <ul data-testid="message-list">
      {rows.map((row) =>
        row.kind === "user" || row.kind === "assistant-text" ? (
          <li key={row.key}>{row.text}</li>
        ) : null,
      )}
    </ul>
  ),
}));

const PK = "pk_test_multi_surface";
const SHARED_SPEC = { publishableKey: PK };

function thread(overrides: Record<string, unknown> = {}) {
  return {
    id: "thread-1",
    title: "A conversation",
    busy: true,
    stream_thread_id: "stream-thread-1",
    created_at: "2026-08-03T00:00:00Z",
    updated_at: "2026-08-03T00:00:00Z",
    ...overrides,
  };
}

function queuedTurn() {
  return {
    id: "turn-1",
    thread_id: "thread-1",
    user_message: "hello from the widget",
    status: "queued",
    error: null,
    run_id: "run-1",
    pending_interrupt_ids: [],
    awaiting_round: 0,
    created_at: "2026-08-03T00:00:00Z",
    updated_at: "2026-08-03T00:00:00Z",
  };
}

async function settled(): Promise<void> {
  // A macrotask, not just microtasks: the page body arrives through a
  // real dynamic import, which resolves on its own tick.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

let mounted: HTMLElement[] = [];

function connectElement(tagName: string): HTMLElement {
  const element = document.createElement(tagName);
  element.setAttribute("publishable-key", PK);
  mounted.push(element);
  act(() => {
    document.body.appendChild(element);
  });
  return element;
}

beforeEach(async () => {
  // Warm the page body's module before any element connects: the lazy
  // import then resolves within the mounting act() window instead of
  // pinging React from outside it (where jsdom never flushes the retry).
  await import("../src/components/assistant-page");
  window.localStorage.clear();
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
  // No real socket ever: a pending-forever connection is the neutral
  // stand-in; the test pushes messages through the agent directly.
  vi.spyOn(
    ServingReplayStreamAgent.prototype,
    "connectAgent",
  ).mockImplementation(() => new Promise(() => undefined));
  vi.spyOn(
    ServingReplayStreamAgent.prototype,
    "detachActiveRun",
  ).mockResolvedValue(undefined);
  vi.mocked(sendAssistantMessage).mockResolvedValue({
    thread: thread(),
    turn: queuedTurn(),
  } as never);
  vi.mocked(getAssistantThread).mockResolvedValue({
    thread: thread(),
    turns: [queuedTurn()],
  } as never);
  defineTeaflaskAssistantElement({ cssText: "" });
  defineTeaflaskAssistantPageElement({ cssText: "" });
});

afterEach(async () => {
  for (const element of mounted) {
    await act(async () => {
      element.remove();
      await Promise.resolve();
    });
  }
  mounted = [];
  await settled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("two roots, one conversation", () => {
  it("streams a turn started in the widget into the open page", async () => {
    connectElement(ELEMENT_TAG_NAME);
    const pageElement = connectElement(PAGE_ELEMENT_TAG_NAME);
    await settled();

    // Both providers resolved the same registry entry — the store below
    // IS the widget's store and the page's store.
    const entry = assistantSessionRegistry.entryFor(SHARED_SPEC);
    const { store } = entry;

    // The page's transcript is a mounted surface of that store: sending
    // through it is exactly what the widget's composer does.
    await act(async () => {
      await store.sendMessage("hello from the widget");
    });
    await settled();

    // The turn's reply streams in through the store's live agent...
    const agent = (
      store as unknown as { _epoch: { agent: ServingReplayStreamAgent } }
    )._epoch.agent;
    await act(async () => {
      agent.addMessages([
        {
          id: "assistant-1",
          role: "assistant",
          content: "Streamed across roots.",
        },
      ]);
      await Promise.resolve();
    });

    // ...and lands inside the PAGE element's shadow root, a different
    // React root from the store's other surfaces.
    const pageText = pageElement.shadowRoot?.textContent ?? "";
    expect(pageText).toContain("hello from the widget");
    expect(pageText).toContain("Streamed across roots.");
  });

  it("sweeps the shared entry when the last element disconnects", async () => {
    connectElement(ELEMENT_TAG_NAME);
    connectElement(PAGE_ELEMENT_TAG_NAME);
    await settled();
    const shared = assistantSessionRegistry.entryFor(SHARED_SPEC);

    for (const element of mounted) {
      await act(async () => {
        element.remove();
        await Promise.resolve();
      });
    }
    mounted = [];
    await settled();

    // The ref-count reached zero and the sweep vacated the key: the next
    // resolve builds a fresh conversation, not a ghost of the old one.
    expect(assistantSessionRegistry.entryFor(SHARED_SPEC)).not.toBe(shared);
  });
});
