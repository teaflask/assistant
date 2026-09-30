// @vitest-environment jsdom
/**
 * The transcript read surface: useTranscript() is the ONE
 * cells-to-rows derivation, exported public on ./headless and consumed
 * by the package chrome. This suite drives it over the fake store's
 * real cells (the transcript-status-composition harness) and asserts
 * the surface against the pure projection directly: same rows, same
 * run-state facts, the optimistic echo applied to displayRows only,
 * and the transcript lease held for exactly the mounted window.
 * Everything under test imports from ../src/headless — the public
 * path a bring-your-own-frontend host takes.
 */
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  transcriptRowsOf,
  useTranscript,
  type Message,
  type TranscriptSurface,
} from "../src/headless";

// --- test plumbing (mocks and fixtures — never API the probe touches) ---

import { ConversationContext } from "../src/components/conversation-context";
import { ConversationSurfacesProvider } from "../src/components/conversation-surfaces-provider";
import {
  IDLE_ACTIVITY,
  type AssistantActivitySnapshot,
} from "../src/core/activity";
import type { ApprovalCardModel } from "../src/core/approval-inbox";
import type { MarkerAnchorsSnapshot } from "../src/core/connection-epoch";
import type {
  AssistantConversationStore,
  ComposerContract,
} from "../src/core/conversation-store";
import { ObservableCell } from "../src/core/observable-cell";
import { QuestionDraftStore } from "../src/core/question-drafts";
import type { UserTurnMeta } from "../src/core/user-turn-ledger";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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
// A turn mid-flight: an open tool call whose result has not landed —
// the projection's `running` input decides how this call reads.
const OPEN_CALL_MESSAGES: Message[] = [
  ...MESSAGES,
  {
    id: "a1",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "t1",
        type: "function",
        function: { name: "run_command", arguments: '{"cmd":"ls"}' },
      },
    ],
  },
];

const messagesCell = new ObservableCell<readonly Message[]>(MESSAGES);
const activityCell = new ObservableCell<AssistantActivitySnapshot>(
  IDLE_ACTIVITY,
);
const approvalsCell = new ObservableCell<readonly ApprovalCardModel[]>([]);

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

// The lease, spied: the hook must hold it for exactly the mounted window.
const releaseLease = vi.fn();
const acquireTranscriptLease = vi.fn<(surface: string) => () => void>(
  () => releaseLease,
);

// The store surface the hook actually reads, over real cells so every
// flip travels the true useCell subscription path — the
// transcript-status-composition harness, minus the chrome-only fields.
const fakeStore = {
  connection: new ObservableCell({
    epochId: 1,
    agent: null,
    threadId: "thread-1",
    streamThreadId: "thread-1",
  }),
  messages: messagesCell,
  markerAnchors: new ObservableCell<MarkerAnchorsSnapshot>(EMPTY_ANCHORS),
  approvals: approvalsCell,
  activity: activityCell,
  turnMeta: new ObservableCell<ReadonlyMap<string, UserTurnMeta>>(new Map()),
  elicitations: new ObservableCell<readonly never[]>([]),
  coworkerWork: new ObservableCell<ReadonlyMap<number, never>>(
    new Map<number, never>(),
  ),
  acquireTranscriptLease,
  submitApprovalDecision: () => Promise.resolve(),
  composer: new ObservableCell<ComposerContract>(composerContract),
  submitQuestionAnswers: () => Promise.resolve(),
  cancelQuestionSet: () => Promise.resolve(),
  questionDrafts: new QuestionDraftStore(),
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

const seen: { surface: TranscriptSurface | null } = { surface: null };

function Probe({ leaseSurface }: { leaseSurface?: string }) {
  const surface = useTranscript(
    leaseSurface === undefined ? undefined : { surface: leaseSurface },
  );
  // Captured post-render (the hooks' immutability law bans render-phase
  // writes to module state); act() flushes effects.
  useEffect(() => {
    seen.surface = surface;
  });
  return null;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  activityCell.set(IDLE_ACTIVITY);
  approvalsCell.set([]);
  messagesCell.set(MESSAGES);
  seen.surface = null;
  acquireTranscriptLease.mockClear();
  releaseLease.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
});

function renderProbe(
  options: {
    contract?: ComposerContract;
    leaseSurface?: string;
  } = {},
) {
  act(() => {
    root.render(
      // The production layering: the surfaces provider outside,
      // the explicit composer contract inside — inner wins.
      <ConversationSurfacesProvider
        store={fakeStore as unknown as AssistantConversationStore}
      >
        <ConversationContext.Provider
          value={options.contract ?? composerContract}
        >
          <Probe leaseSurface={options.leaseSurface} />
        </ConversationContext.Provider>
      </ConversationSurfacesProvider>,
    );
  });
}

function surfaceNow(): TranscriptSurface {
  if (seen.surface === null) {
    throw new Error("the hook never rendered");
  }
  return seen.surface;
}

function actionableApprovalCard(): ApprovalCardModel {
  return {
    interruptId: "pause-1",
    toolName: "action__create-support-ticket",
    toolArgs: { path: "/tickets" },
    toolInputSchema: null,
    toolOutputSchema: null,
    prompt: "The assistant wants to create a support ticket.",
    toolCallId: null,
    anchored: false,
    round: 0,
    runId: "run-1",
    parked: false,
    gated: false,
    trustAvailable: false,
    asker: { kind: "assistant" },
    turnId: null,
    status: { kind: "actionable", errorSentence: null },
  };
}

describe("useTranscript (@teaflask/assistant/headless)", () => {
  it("rows are exactly transcriptRowsOf over the raw reads the surface itself exposes", () => {
    messagesCell.set(OPEN_CALL_MESSAGES);
    act(() => {
      activityCell.set({
        ...IDLE_ACTIVITY,
        busy: true,
        newestTurnStatus: "working",
        newestTurnId: "turn-1",
      });
    });
    renderProbe();
    const surface = surfaceNow();
    // The surface's own raw reads feed the re-exported projection
    // verbatim — the ticket's "consumable directly" shape, closed.
    expect(surface.rows).toEqual(
      transcriptRowsOf(
        surface.messages,
        surface.markerAnchors,
        surface.running,
        surface.turnMeta,
      ),
    );
    // And the derivation is live, not vacuous: the open call projects as
    // running under the machine's time.
    expect(surface.running).toBe(true);
    const toolRow = surface.rows.find((row) => row.kind === "tool-call");
    expect(toolRow?.kind === "tool-call" && toolRow.state).toBe(
      "input-available",
    );
  });

  it("running / turnOpen / decisionsPending walk the announcer's own ladder", () => {
    renderProbe();
    // Idle: nothing runs, nothing is open, nobody waits.
    expect(surfaceNow().running).toBe(false);
    expect(surfaceNow().turnOpen).toBe(false);
    expect(surfaceNow().decisionsPending).toBe(false);

    // Queued: the machine's time.
    act(() => {
      activityCell.set({
        ...IDLE_ACTIVITY,
        busy: true,
        newestTurnStatus: "queued",
        newestTurnId: "turn-1",
      });
    });
    expect(surfaceNow().running).toBe(true);
    expect(surfaceNow().turnOpen).toBe(true);
    expect(surfaceNow().decisionsPending).toBe(false);

    // A decision-less pause is still the machine's time.
    act(() => {
      activityCell.set({
        ...IDLE_ACTIVITY,
        busy: true,
        newestTurnStatus: "awaiting_input",
        newestTurnId: "turn-1",
      });
    });
    expect(surfaceNow().running).toBe(true);
    expect(surfaceNow().turnOpen).toBe(true);
    expect(surfaceNow().decisionsPending).toBe(false);

    // An actionable approval makes it the MEMBER's time: waiting, not
    // working — and the turn stays open.
    act(() => {
      approvalsCell.set([actionableApprovalCard()]);
    });
    expect(surfaceNow().running).toBe(false);
    expect(surfaceNow().turnOpen).toBe(true);
    expect(surfaceNow().decisionsPending).toBe(true);

    // The published decision gap counts too.
    act(() => {
      approvalsCell.set([]);
      activityCell.set({
        ...IDLE_ACTIVITY,
        busy: false,
        newestTurnStatus: "parked",
        newestTurnId: "turn-1",
        pendingDecisionGap: {
          turnId: "turn-1",
          missingInterruptIds: ["i-1"],
        },
      });
    });
    expect(surfaceNow().running).toBe(false);
    expect(surfaceNow().turnOpen).toBe(true);
    expect(surfaceNow().decisionsPending).toBe(true);

    // Terminal: closed.
    act(() => {
      activityCell.set({
        ...IDLE_ACTIVITY,
        busy: false,
        newestTurnStatus: "succeeded",
        newestTurnId: "turn-1",
      });
    });
    expect(surfaceNow().running).toBe(false);
    expect(surfaceNow().turnOpen).toBe(false);
    expect(surfaceNow().decisionsPending).toBe(false);
  });

  it("the optimistic echo rides displayRows only, and an authoritative row wins without a duplicate", () => {
    renderProbe({
      contract: {
        ...composerContract,
        pendingEcho: {
          messageId: "echo-1",
          text: "And gyokuro?",
          attachments: [],
        },
      },
    });
    const surface = surfaceNow();
    // rows is the pure projection — no echo.
    expect(surface.rows.some((row) => row.key === "echo-1")).toBe(false);
    // displayRows appends it, optimistic and last.
    const tail = surface.displayRows.at(-1);
    expect(tail).toMatchObject({
      kind: "user",
      key: "echo-1",
      text: "And gyokuro?",
      optimistic: true,
    });
    expect(surface.displayRows).toHaveLength(surface.rows.length + 1);

    // Replay injects the authoritative message under the echo's id: the
    // injected row wins and the echo adds nothing.
    act(() => {
      messagesCell.set([
        ...MESSAGES,
        { id: "echo-1", role: "user", content: "And gyokuro?" },
      ]);
    });
    const settled = surfaceNow();
    expect(settled.displayRows).toHaveLength(settled.rows.length);
    expect(
      settled.displayRows.filter((row) => row.key === "echo-1"),
    ).toHaveLength(1);
  });

  it("the lease is held for exactly the mounted window, labelled headless by default", () => {
    renderProbe();
    expect(acquireTranscriptLease).toHaveBeenCalledTimes(1);
    expect(acquireTranscriptLease).toHaveBeenCalledWith("headless");
    expect(releaseLease).not.toHaveBeenCalled();
    act(() => {
      root.unmount();
    });
    expect(releaseLease).toHaveBeenCalledTimes(1);
    // afterEach unmounts again — harmless on an empty root.
  });

  it("a host's own surface label rides the lease", () => {
    renderProbe({ leaseSurface: "bench" });
    expect(acquireTranscriptLease).toHaveBeenCalledWith("bench");
  });

  it("rows and displayRows keep their identity across an unrelated re-render", () => {
    renderProbe();
    const before = surfaceNow();
    // Same cells, same contract — a plain re-render of the same tree.
    renderProbe();
    const after = surfaceNow();
    expect(after.rows).toBe(before.rows);
    expect(after.displayRows).toBe(before.displayRows);
  });
});
