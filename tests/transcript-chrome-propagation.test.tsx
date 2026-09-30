// @vitest-environment jsdom
/**
 * The store binder's own chrome is NOT behind a host-slot boundary
 * (review round 1, finding 3): the announcer/shelf/composer are
 * package-owned mandatory chrome, and the slot-boundary law puts package
 * backstops OUTSIDE boundaries. A render throw in that chrome must
 * therefore PROPAGATE to the host's own error boundary — loud and
 * recoverable at the host's level — never be silently latched away
 * leaving a read-only conversation. This is the negative-control shape
 * for the finding: with the chrome routed through the input slot, the
 * throw is swallowed, the transcript keeps rendering, and this suite
 * goes red.
 *
 * Store harness mirrors tests/transcript-status-composition.test.tsx
 * (whose mocks are file-scoped, hence the separate file for the extra
 * composer mock).
 */
import { act, Component, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "@ag-ui/core";

import { ConversationContext } from "../src/components/conversation-context";
import { Transcript } from "../src/components/transcript";
import {
  IDLE_ACTIVITY,
  type AssistantActivitySnapshot,
} from "../src/core/activity";
import type { ApprovalCardModel } from "../src/core/approval-inbox";
import type { MarkerAnchorsSnapshot } from "../src/core/connection-epoch";
import type { ComposerContract } from "../src/core/conversation-store";
import { ObservableCell } from "../src/core/observable-cell";
import type { UserTurnMeta } from "../src/core/user-turn-ledger";

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

const EMPTY_ANCHORS: MarkerAnchorsSnapshot = {
  resumeAnchors: new Map(),
  turnFailedAnchors: new Map(),
  toolRefusalAnchors: new Map(),
  toolErrorAnchors: new Map(),
  toolCancelAnchors: new Set(),
  toolOffloadAnchors: new Set(),
  toolCallDisplayAnchors: new Map(),
  toolSchemaAnchors: new Map(),
  subagentDeliveryAnchors: new Map(),
  blockTimingAnchors: new Map(),
  turnUsageAnchors: new Map(),
  memoryProvenanceAnchors: new Map(),
  memoryAttributionAnchors: new Map(),
};

const MESSAGES: Message[] = [
  { id: "u1", role: "user", content: "How do I steep sencha?" },
];

vi.mock("../src/components/use-thread-dispatches", () => ({
  useThreadDispatches: () => new Map(),
}));

// The chrome member under test: the composer throws on render.
vi.mock("../src/components/composer", () => ({
  Composer: () => {
    throw new Error("hostile chrome render");
  },
}));

const fakeStore = {
  connection: new ObservableCell({
    epochId: 1,
    agent: null,
    threadId: "thread-1",
    streamThreadId: "thread-1",
  }),
  messages: new ObservableCell<readonly Message[]>(MESSAGES),
  markerAnchors: new ObservableCell<MarkerAnchorsSnapshot>(EMPTY_ANCHORS),
  approvals: new ObservableCell<readonly ApprovalCardModel[]>([]),
  activity: new ObservableCell<AssistantActivitySnapshot>(IDLE_ACTIVITY),
  turnMeta: new ObservableCell<ReadonlyMap<string, UserTurnMeta>>(new Map()),
  elicitations: new ObservableCell<readonly never[]>([]),
  coworkerWork: new ObservableCell<ReadonlyMap<number, never>>(
    new Map<number, never>(),
  ),
  acquireTranscriptLease: () => () => undefined,
  submitApprovalDecision: () => Promise.resolve(),
};

const fakeSession = {
  session: {},
  store: fakeStore,
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

/** The HOST's own boundary — where a chrome throw must land. */
class HostProbeBoundary extends Component<
  { onCaught: (error: Error) => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    this.props.onCaught(error);
  }
  render() {
    if (this.state.failed) {
      return <p data-host-probe-fallback="">The host saw the crash.</p>;
    }
    return this.props.children;
  }
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  vi.restoreAllMocks();
});

describe("the store binder's chrome sits outside every slot boundary", () => {
  it("a composer render throw propagates to the host's boundary, never a silent latch", () => {
    // React logs the propagating error; keep the run's output honest but
    // quiet.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const caught: Error[] = [];
    act(() => {
      root.render(
        <HostProbeBoundary
          onCaught={(error) => {
            caught.push(error);
          }}
        >
          <ConversationContext.Provider value={composerContract}>
            <Transcript surface="page" />
          </ConversationContext.Provider>
        </HostProbeBoundary>,
      );
    });
    // The throw reached the HOST boundary…
    expect(caught.map((error) => error.message)).toContain(
      "hostile chrome render",
    );
    expect(host.querySelector("[data-host-probe-fallback]")).not.toBeNull();
    // …instead of being swallowed by a slot boundary while the transcript
    // kept rendering around a silently missing composer (the finding's
    // read-only-lock shape).
    expect(host.querySelector("[data-tf-message-list]")).toBeNull();
  });
});
