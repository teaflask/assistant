// @vitest-environment jsdom
/**
 * The boundary WIRING law: transcript.tsx must mount its message list
 * behind a SurfaceBoundary. The unit suite proves the boundary
 * component; this file proves the wrap is actually there — the real
 * Transcript renders, its MessageList is mocked to throw, and the
 * degraded card must stand in the list's place while the composer (a
 * sibling surface inside the same Transcript) stays alive. Negative
 * control (verified during implementation): removing the SurfaceBoundary
 * around MessageList in transcript.tsx makes this render throw.
 */
import { act } from "react";
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

import { ConversationContext } from "../src/components/conversation-context";
import { ConversationSurfacesProvider } from "../src/components/conversation-surfaces-provider";
import { Transcript } from "../src/components/transcript";
import { IDLE_ACTIVITY } from "../src/core/activity";
import type { MarkerAnchorsSnapshot } from "../src/core/connection-epoch";
import type {
  AssistantConversationStore,
  ComposerContract,
} from "../src/core/conversation-store";
import { ObservableCell } from "../src/core/observable-cell";
import { QuestionDraftStore } from "../src/core/question-drafts";

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

const BOOM = new Error("the message list is poisoned");

vi.mock("../src/components/message-list", () => ({
  MessageList: (): never => {
    throw BOOM;
  },
}));

vi.mock("../src/components/use-thread-dispatches", () => ({
  useThreadDispatches: () => new Map(),
}));

const EMPTY_ANCHORS: MarkerAnchorsSnapshot = {
  toolSchemaAnchors: new Map(),
  resumeAnchors: new Map(),
  turnFailedAnchors: new Map(),
  toolRefusalAnchors: new Map(),
  toolErrorAnchors: new Map(),
  toolCancelAnchors: new Set(),
  toolOffloadAnchors: new Set(),
  toolCallDisplayAnchors: new Map(),
  subagentDeliveryAnchors: new Map(),
  blockTimingAnchors: new Map(),
  turnUsageAnchors: new Map(),
  memoryProvenanceAnchors: new Map(),
  memoryAttributionAnchors: new Map(),
};

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

const reportError = vi.fn();

const fakeStore = {
  connection: new ObservableCell({
    epochId: 1,
    agent: null,
    threadId: "thread-1",
    streamThreadId: "thread-1",
  }),
  messages: new ObservableCell([
    { id: "u1", role: "user", content: "How do I steep sencha?" },
  ]),
  markerAnchors: new ObservableCell<MarkerAnchorsSnapshot>(EMPTY_ANCHORS),
  approvals: new ObservableCell<readonly never[]>([]),
  activity: new ObservableCell(IDLE_ACTIVITY),
  turnMeta: new ObservableCell(new Map()),
  elicitations: new ObservableCell<readonly never[]>([]),
  coworkerWork: new ObservableCell<ReadonlyMap<number, never>>(
    new Map<number, never>(),
  ),
  acquireTranscriptLease: () => () => undefined,
  submitApprovalDecision: () => Promise.resolve(),
  composer: new ObservableCell<ComposerContract>(composerContract),
  submitQuestionAnswers: () => Promise.resolve(),
  cancelQuestionSet: () => Promise.resolve(),
  questionDrafts: new QuestionDraftStore(),
};

const fakeSession = {
  session: {},
  store: fakeStore,
  reportError,
  attachmentPolicy: new ObservableCell(null),
  ensureAssistantConfig: () => undefined,
  tier: null,
  subscriptions: new ObservableCell(null),
  ensureSubscriptions: () => undefined,
  modelChoice: new ObservableCell(null),
  configAnswered: new ObservableCell(false),
  connectOpenRequested: new ObservableCell(false),
  acknowledgeSubscriptionConnect: () => undefined,
};

vi.mock("../src/components/teaflask-assistant-provider", () => ({
  useAssistantSession: () => fakeSession,
  useOptionalAssistantSession: () => fakeSession,
}));

let host: HTMLDivElement;
let root: Root;
let consoleError: MockInstance<typeof console.error>;

// React 18's development build re-dispatches a boundary-CAUGHT error on
// window for debugger visibility (React 19 routes it through
// onCaughtError/console.error instead). jsdom turns that deliberate
// re-dispatch into an unhandled error, which fails the react18 CI arm on
// a passing suite — preventDefault marks it handled. Harmless under 19:
// the event is never dispatched there.
function swallowBoundaryRedispatch(event: Event) {
  event.preventDefault();
}

beforeEach(() => {
  reportError.mockClear();
  window.addEventListener("error", swallowBoundaryRedispatch);

  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
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
  consoleError.mockRestore();
});

describe("the transcript's boundary wiring", () => {
  it("a throwing message list degrades to the card; the composer survives; the session hears the error", () => {
    act(() => {
      root.render(
        <ConversationSurfacesProvider
          store={fakeStore as unknown as AssistantConversationStore}
        >
          <ConversationContext.Provider value={composerContract}>
            <Transcript surface="page" />
          </ConversationContext.Provider>
        </ConversationSurfacesProvider>,
      );
    });

    // The list's place is the fallback card…
    const fallback = host.querySelector(
      '[data-tf-surface-fallback="message-list"]',
    );
    expect(fallback).not.toBeNull();
    // …the composer — a sibling surface inside the same Transcript —
    // still rendered…
    expect(host.querySelector("textarea")).not.toBeNull();
    // …and the throw reached the session's reportError, unswallowed.
    expect(reportError).toHaveBeenCalledWith(BOOM);
  });
});
