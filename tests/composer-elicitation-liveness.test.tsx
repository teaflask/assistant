// @vitest-environment jsdom
/**
 * The composer stays live during a pending elicitation: the textarea
 * is never disabled and a draft still lands in it — while the orphan
 * set's panel renders above the input, through the activity shelf's
 * suspension slot.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActivityShelf } from "../src/components/activity-shelf";
import { ConversationView } from "../src/components/conversation-view";
import type { ComposerInput } from "../src/core/conversation-store";
import { ElicitationsContext } from "../src/components/elicitation-context";
import { SuspensionSurfaces } from "../src/components/suspension-surfaces";
import type { AssistantConversation } from "../src/components/use-assistant-conversation";
import type { SubscriptionStatus } from "../src/contract/subscriptions";
import type { ElicitationCardModel } from "../src/core/elicitation-cards";
import { NO_GATE, type ConversationGate } from "../src/core/connect-gate";
import { ObservableCell } from "../src/core/observable-cell";
import { QuestionDraftStore } from "../src/core/question-drafts";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../src/components/transcript", () => ({
  Transcript: () => <div data-testid="transcript" />,
}));

const sessionFixture = vi.hoisted(() => ({
  value: null as unknown as object,
}));
vi.mock("../src/components/teaflask-assistant-provider", () => ({
  useAssistantSession: () => sessionFixture.value,
  useOptionalAssistantSession: () => sessionFixture.value,
}));

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
      pendingSend: false,
      sendMessage: () => Promise.resolve(true),
      pendingEcho: null,
      composerRefocusPending: false,
      markComposerRefocusHandled: () => undefined,
      stopping: false,
      stopTurn: () => Promise.resolve(),
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

const PENDING_ORPHAN_ASK: ElicitationCardModel = {
  interruptId: "v1:tool_call:a1:member-answers",
  runId: "run-1",
  toolCallId: null,
  anchored: false,
  round: 0,
  questions: [
    {
      id: "plan",
      heading: "Plan",
      prompt: "Which plan?",
      options: [
        { text: "Yes", description: null },
        { text: "No", description: null },
      ],
    },
  ],
  status: "actionable",
  errorSentence: null,
  answered: null,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  sessionFixture.value = {
    session: {},
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

describe("the composer during a pending elicitation", () => {
  it("stays live: the ask renders above an enabled, typable input", () => {
    act(() => {
      root.render(
        <ElicitationsContext.Provider
          value={{
            cards: [PENDING_ORPHAN_ASK],
            submitQuestionAnswers: () => Promise.resolve(),
            cancelQuestionSet: () => Promise.resolve(),
            drafts: new QuestionDraftStore(),
          }}
        >
          {/* The shipping order: the shelf's suspension slot holds the
              ask, the composer renders beneath it (transcript.tsx). */}
          <ActivityShelf
            suspension={<SuspensionSurfaces rowIndexByToolCallId={new Map()} />}
          />
          <ConversationView core={emptyConversation()} surface="page" />
        </ElicitationsContext.Provider>,
      );
    });

    // The orphan ask is on the suspension surface above the input…
    expect(
      container.querySelector('[aria-label="The assistant asked questions"]'),
    ).not.toBeNull();
    // …and the main composer beneath it is not locked by the pause.
    const composerBox = [...container.querySelectorAll("textarea")].find(
      (box) => box.getAttribute("aria-label") !== "Your answer",
    );
    expect(composerBox).toBeDefined();
    expect(composerBox?.disabled).toBe(false);
    act(() => {
      if (composerBox !== undefined) {
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set?.call(composerBox, "actually, new plan");
        composerBox.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    expect(composerBox?.value).toBe("actually, new plan");
  });
});
