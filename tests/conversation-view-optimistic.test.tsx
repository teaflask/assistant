// @vitest-environment jsdom
/**
 * A submitted first message belongs to the transcript immediately, even
 * before the send POST has returned a thread to connect. The composer must
 * stay mounted through that transition so a refusal can still restore the
 * draft owned by that exact instance.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationView } from "../src/components/conversation-view";
import type { ComposerContract } from "../src/core/conversation-store";
import { ObservableCell } from "../src/core/observable-cell";
import type { AssistantConversation } from "../src/components/use-assistant-conversation";

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

const sendMessage = vi.fn<ComposerContract["sendMessage"]>();

function coreWith(
  pendingEcho: ComposerContract["pendingEcho"],
): AssistantConversation {
  return {
    setupError: null,
    conversation: null,
    threads: [],
    historyExpected: false,
    threadOpening: false,
    reconnectNonce: 0,
    composerContract: {
      busy: pendingEcho !== null,
      pendingSend: false,
      sendMessage,
      pendingEcho,
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
    },
    sendError: null,
    turnFailure: null,
    showInterruptionBanner: false,
    pendingDecisionGap: null,
    refreshConversation: () => Promise.resolve(),
    retryStream: () => undefined,
    openThread: () => undefined,
    startNewConversation: () => undefined,
    resumeStoredThread: () => undefined,
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
});

describe("the first message's optimistic transcript placement", () => {
  it("moves the empty state into transcript mode without putting the bubble in or remounting the composer", async () => {
    await act(async () => {
      root.render(<ConversationView core={coreWith(null)} surface="page" />);
      await Promise.resolve();
    });
    const originalTextarea = host.querySelector("textarea");

    await act(async () => {
      root.render(
        <ConversationView
          core={coreWith({
            messageId: "optimistic-user-1",
            text: "Show this in the transcript now",
            attachments: [],
          })}
          surface="page"
        />,
      );
      await Promise.resolve();
    });

    const messageList = host.querySelector("[data-tf-message-list]");
    const optimistic = host.querySelector("[data-tf-pending-echo]");
    // The composer's OWN ground, reached from its textarea rather than by
    // first match: the activity shelf also wears data-tf-composer-ground
    // wherever a Transcript renders. This branch is the shelf-less
    // optimistic empty state — pinned, so the lookup's target can never
    // silently change out from under the assertion.
    expect(host.querySelector("[data-tf-activity-shelf]")).toBeNull();
    const composer = host
      .querySelector("textarea")
      ?.closest("[data-tf-composer-ground]");
    expect(messageList).not.toBeNull();
    expect(optimistic?.textContent).toContain(
      "Show this in the transcript now",
    );
    expect(messageList?.contains(optimistic)).toBe(true);
    expect(composer?.contains(optimistic)).toBe(false);
    expect(host.querySelector("textarea")).toBe(originalTextarea);
    // From the instant of submit something says "Working…": the echo
    // screen renders the standalone shimmered headline — no dead gap
    // while the send POST is in flight.
    const working = host.querySelector("[data-tf-working-headline]");
    expect(working).not.toBeNull();
    expect(working?.textContent).toContain("Working…");
    expect(working?.querySelector("[data-tf-shimmer-text]")).not.toBeNull();
  });
});
