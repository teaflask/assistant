// @vitest-environment jsdom
/**
 * The boundary RESET wiring: conversation-view.tsx must key the
 * transcript's SurfaceBoundary on `${threadId}#${reconnectNonce}` — a
 * key on the Transcript INSIDE the boundary resets nothing, because a
 * latched boundary never reconciles its children again. This renders
 * the real ConversationView with a Transcript mocked to throw once,
 * latches the card, proves a plain re-render does NOT clear it (the
 * latch is real), then bumps reconnectNonce (what Retry does) and
 * requires the live transcript back. Negative control (verified during
 * implementation): with the key moved back onto Transcript, the final
 * assertion goes red — the card outlives the reconnect.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationView } from "../src/components/conversation-view";
import type { AssistantConversation } from "../src/components/use-assistant-conversation";
import type {
  ActiveConversation,
  ComposerContract,
} from "../src/core/conversation-store";
import { ObservableCell } from "../src/core/observable-cell";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The bomb is armed per test: throws while armed, renders a marker once
// healed — a one-time render fault, exactly the shape a transcript bug
// produces.
const bomb = vi.hoisted(() => ({ armed: false }));
vi.mock("../src/components/transcript", () => ({
  Transcript: () => {
    if (bomb.armed) {
      throw new Error("a one-time transcript fault");
    }
    return <div data-testid="live-transcript" />;
  },
}));

// React 18's development build re-dispatches a boundary-caught error on
// window (React 19 routes it through console.error); preventDefault
// keeps jsdom from reporting the deliberate throw as unhandled.
function swallowBoundaryRedispatch(event: Event) {
  event.preventDefault();
}

const composerContract: ComposerContract = {
  busy: false,
  pendingSend: false,
  sendMessage: () => Promise.resolve(true),
  pendingEcho: null,
  composerRefocusPending: false,
  markComposerRefocusHandled: () => undefined,
  stopping: false,
  stopTurn: () => Promise.resolve(),
  modelPick: null,
  setModelPick: () => undefined,
  composerInput: new ObservableCell({
    scope: "u:0",
    draft: "",
    attachments: [],
  }),
  setDraft: () => undefined,
  setAttachments: () => undefined,
  noteComposerFocus: () => undefined,
  takeComposerCaretReturn: () => false,
};

function coreOf(reconnectNonce: number): AssistantConversation {
  return {
    setupError: null,
    conversation: {
      thread: { id: "thread-1" },
    } as unknown as ActiveConversation,
    threads: [],
    historyExpected: false,
    threadOpening: false,
    reconnectNonce,
    composerContract,
    sendError: null,
    turnFailure: null,
    showInterruptionBanner: false,
    pendingDecisionGap: null,
    retryStream: () => undefined,
    refreshConversation: () => Promise.resolve(),
    openThread: () => undefined,
    startNewConversation: () => undefined,
    resumeStoredThread: () => undefined,
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  bomb.armed = false;
  window.addEventListener("error", swallowBoundaryRedispatch);
  // Silence the deliberate boundary narration; nothing here asserts on it
  // (surface-boundary.test.tsx owns the naming assertions).
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  window.removeEventListener("error", swallowBoundaryRedispatch);
  vi.restoreAllMocks();
});

function renderView(reconnectNonce: number) {
  act(() => {
    root.render(
      <ConversationView core={coreOf(reconnectNonce)} surface="page" />,
    );
  });
}

describe("the transcript boundary resets by remount", () => {
  it("a latched transcript card clears on a reconnectNonce bump — Retry recovers without a page reload", () => {
    // 1. The fault: the transcript throws, the backstop latches the card.
    bomb.armed = true;
    renderView(0);
    expect(
      host.querySelector('[data-tf-surface-fallback="transcript"]'),
    ).not.toBeNull();
    expect(host.querySelector('[data-testid="live-transcript"]')).toBeNull();

    // 2. The fault heals but nothing remounts: the latch is REAL — a
    //    plain re-render must not flicker the transcript back (and this
    //    guards the reset assertion below against a boundary that resets
    //    on every render).
    bomb.armed = false;
    renderView(0);
    expect(
      host.querySelector('[data-tf-surface-fallback="transcript"]'),
    ).not.toBeNull();

    // 3. Retry bumps reconnectNonce → the key on the BOUNDARY remounts
    //    boundary and transcript together; the card is gone and the live
    //    transcript is back.
    renderView(1);
    expect(
      host.querySelector('[data-tf-surface-fallback="transcript"]'),
    ).toBeNull();
    expect(
      host.querySelector('[data-testid="live-transcript"]'),
    ).not.toBeNull();
  });

  it("a thread switch resets the same way", () => {
    bomb.armed = true;
    renderView(0);
    expect(
      host.querySelector('[data-tf-surface-fallback="transcript"]'),
    ).not.toBeNull();

    bomb.armed = false;
    act(() => {
      const core = coreOf(0);
      core.conversation = {
        thread: { id: "thread-2" },
      } as unknown as ActiveConversation;
      root.render(<ConversationView core={core} surface="page" />);
    });
    expect(
      host.querySelector('[data-tf-surface-fallback="transcript"]'),
    ).toBeNull();
    expect(
      host.querySelector('[data-testid="live-transcript"]'),
    ).not.toBeNull();
  });
});
