// @vitest-environment jsdom
/**
 * The transcript's status composition: the conversation chrome makes NO
 * run-state claims. No status line renders in the activity slot for ANY
 * status — working, parked, awaiting — and no "Waiting for your input"
 * text exists anywhere on the surface: the ask's own card, the subagent
 * pill, the fold's "Working…" content headline (TVC-010) and the Stop
 * control are the signals. The sr-only RunStatusAnnouncer alone carries
 * the status phrases, keyed on actual pending decisions, driven here
 * through the real useCell subscription rather than a prop rerender.
 *
 * Also the pinned no-contradiction fixture: the production a70b4b5
 * screen (Stop control + "The assistant is answering…" + "Waiting for
 * your input" at once) must be UNBUILDABLE — the composer placeholder is
 * constant and no wait label exists, whatever busy says.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "@ag-ui/core";

import type { TurnStatus } from "../src/contract/threads";

import { ConversationContext } from "../src/components/conversation-context";
import { ConversationSurfacesProvider } from "../src/components/conversation-surfaces-provider";
import { Transcript } from "../src/components/transcript";
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
import type { ThreadDispatch } from "../src/contract/dispatches";

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
// A turn mid-flight: the assistant has issued a tool call whose result
// has not landed — the exact shape the stale-liveness screen showed: a
// fold with one open work item.
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

// The thread dispatch ledger the pill reads, swapped per test. MOCKED,
// never edited: use-thread-dispatches.ts is not this suite's subject;
// this suite only needs its return value.
let cannedDispatches: ReadonlyMap<number, ThreadDispatch> = new Map();
vi.mock("../src/components/use-thread-dispatches", () => ({
  useThreadDispatches: () => cannedDispatches,
}));

const RUNNING_DISPATCHES: ReadonlyMap<number, ThreadDispatch> = new Map([
  [
    0,
    {
      ordinal: 0,
      label: "Survey the steeping guides for temperature claims.",
      status: "dispatched",
      error: null,
      child_session_id: "subagent-1",
      created_at: "2026-08-21T10:00:00Z",
      updated_at: "2026-08-21T10:00:00Z",
    },
  ],
  [
    1,
    {
      ordinal: 1,
      label: "Map every kettle model the docs mention.",
      status: "dispatched",
      error: null,
      child_session_id: "subagent-2",
      created_at: "2026-08-21T10:00:00Z",
      updated_at: "2026-08-21T10:00:00Z",
    },
  ],
]);

// The composer contract the tests hand to the inner ConversationContext
// provision (the conversation view's own layering) — hoisted above the
// store because the store's composer cell (read by the provider-level
// surfaces provision) carries the same default.
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

// The store surface Transcript actually reads, over real cells so the
// activity flip travels the true subscription path. The connection's
// agent is never touched by Transcript — a null stub is honest here.
// The approval/elicitation surfaces provision at the provider, so the
// fields ConversationSurfacesProvider reads are here too, and
// renderTranscript mounts the REAL surfaces provider over this store —
// the flip of approvalsCell travels the production path.
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
  acquireTranscriptLease: () => () => undefined,
  submitApprovalDecision: () => Promise.resolve(),
  composer: new ObservableCell<ComposerContract>(composerContract),
  submitQuestionAnswers: () => Promise.resolve(),
  cancelQuestionSet: () => Promise.resolve(),
  questionDrafts: new QuestionDraftStore(),
};

// The composer's session surface, the composer-stop suite's shape.
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

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  activityCell.set(IDLE_ACTIVITY);
  approvalsCell.set([]);
  messagesCell.set(MESSAGES);
  cannedDispatches = new Map();
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

function renderTranscript(contract: ComposerContract = composerContract) {
  act(() => {
    root.render(
      // The production layering: the surfaces provider outside (the
      // provider-level provision, over the fake store's real cells), the
      // explicit composer contract inside (the conversation view's own
      // inner provision — inner wins, exactly as in production).
      <ConversationSurfacesProvider
        store={fakeStore as unknown as AssistantConversationStore}
      >
        <ConversationContext.Provider value={contract}>
          <Transcript surface="page" />
        </ConversationContext.Provider>
      </ConversationSurfacesProvider>,
    );
  });
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

describe("the transcript's status composition (chrome narrates nothing)", () => {
  it("TVC-126 a working run renders no status line and no chrome working signal — the announcer alone carries the phrase", () => {
    renderTranscript();
    // Idle: no status line, no dot, and the announcer already exists —
    // empty — so the coming phrase mutates a pre-existing region.
    expect(host.querySelector("[data-tf-run-status]")).toBeNull();
    expect(host.querySelector("[data-tf-working-dot]")).toBeNull();
    const announcer = host.querySelector("[data-tf-status-announcer]");
    expect(announcer).not.toBeNull();
    expect(announcer?.getAttribute("role")).toBe("status");
    expect(announcer?.textContent).toBe("");

    // The run goes live through the real cell subscription: nothing is
    // streaming (the silence window that used to mount the dot).
    act(() => {
      activityCell.set({
        ...IDLE_ACTIVITY,
        busy: true,
        newestTurnStatus: "working",
        newestTurnId: "turn-1",
      });
    });

    // No run-state chrome at all: no status line, no spinner, no dot —
    // work-in-progress belongs to content (the fold's own "Working…"
    // headline, TVC-010) and the kept surfaces, never to chrome.
    expect(host.querySelector("[data-tf-run-status]")).toBeNull();
    expect(host.querySelectorAll("[data-tf-spinner]")).toHaveLength(0);
    expect(host.querySelector("[data-tf-working-dot]")).toBeNull();
    expect(host.textContent).not.toContain("Waiting for your input");
    // The SAME announcer node now carries the phrase — the mechanism,
    // not just the attribute.
    const announcerNow = host.querySelector("[data-tf-status-announcer]");
    expect(announcerNow).toBe(announcer);
    expect(announcerNow?.textContent).toBe("The assistant is working");
  });

  it("a paused turn with a pending decision: the card holds the slot with no wait label above it", () => {
    renderTranscript();
    act(() => {
      approvalsCell.set([actionableApprovalCard()]);
      activityCell.set({
        ...IDLE_ACTIVITY,
        busy: true,
        newestTurnStatus: "awaiting_input",
        newestTurnId: "turn-1",
      });
    });
    // The surface IS the ask: the decision card occupies the suspension
    // slot with its consent controls…
    const surface = host.querySelector("[data-tf-suspension-surfaces]");
    expect(surface).not.toBeNull();
    expect(surface?.querySelector("[data-tf-approval-card]")).not.toBeNull();
    // …and no separate wait label exists to restate it. The visible
    // "Waiting for your input" is gone from the whole surface (the
    // sr-only announcer is the one carrier of the phrase).
    expect(host.querySelector("[data-tf-run-status]")).toBeNull();
    const announcer = host.querySelector("[data-tf-status-announcer]");
    expect(announcer?.textContent).toBe("Waiting for your input");
    expect(
      host.textContent.replace("Waiting for your input", ""),
    ).not.toContain("Waiting for your input");
    // A pause is the member's time: no animated working signal anywhere.
    expect(host.querySelectorAll("[data-tf-spinner]")).toHaveLength(0);
  });

  it("the announcer and the gap alert carry the same fact (round-1 finding 4)", () => {
    // A pending-decision gap has no cards, so the old card-only
    // predicate left the announcer saying "The assistant is working"
    // while the visible role="alert" banner said the run waits on a
    // request — two carriers, two claims, one state. The gap rides the
    // activity feed and counts as a pending decision.
    renderTranscript();
    act(() => {
      activityCell.set({
        ...IDLE_ACTIVITY,
        busy: false,
        newestTurnStatus: "awaiting_input",
        newestTurnId: "turn-1",
        pendingDecisionGap: {
          turnId: "turn-1",
          missingInterruptIds: ["i-1"],
        },
      });
    });
    expect(host.querySelector("[data-tf-status-announcer]")?.textContent).toBe(
      "Waiting for your input",
    );
  });

  it("a subagent park never implies the member is blocking it", () => {
    // The trigger screen: status "parked" with ZERO pending decisions —
    // a wait_for_subagents park. The old shelf mapped every parked to
    // "Waiting for your input"; nothing may say that now, visibly or to
    // a screen reader, while the honest signals (the pill) stay.
    cannedDispatches = RUNNING_DISPATCHES;
    renderTranscript();
    act(() => {
      activityCell.set({
        ...IDLE_ACTIVITY,
        busy: false,
        newestTurnStatus: "parked",
        newestTurnId: "turn-1",
      });
    });
    expect(host.textContent).not.toContain("Waiting for your input");
    expect(host.textContent).not.toContain("input");
    expect(host.querySelector("[data-tf-run-status]")).toBeNull();
    // No empty actionable surface: the suspension tenant renders null.
    expect(host.querySelector("[data-tf-suspension-surfaces]")).toBeNull();
    // The honest signals: the pill is present, and the announcer calls a
    // decision-less park the machine's time.
    expect(host.querySelector("[data-tf-subagent-pill]")).not.toBeNull();
    expect(host.querySelector("[data-tf-status-announcer]")?.textContent).toBe(
      "The assistant is working",
    );
  });
});

describe("the a70b4b5 contradiction is unbuildable (pinned fixture)", () => {
  // Production commit a70b4b5 showed, at once: shelf "Waiting for your
  // input", composer placeholder "The assistant is answering…", and an
  // active Stop control. The determination (recorded in the PR): that
  // was ONE consistent awaiting_input snapshot — busyOf() excludes only
  // parked — not a transition tear. The fix is structural: the wait
  // label no longer exists and the placeholder is constant, so no busy
  // value can rebuild the combination.
  it("parked and not busy: 'Ask anything', no Stop, no wait text, pill present", () => {
    // busy:false is what busyOf() yields for parked (pinned in
    // conversation-store.test.ts) — the consistent-snapshot case.
    cannedDispatches = RUNNING_DISPATCHES;
    renderTranscript();
    act(() => {
      activityCell.set({
        ...IDLE_ACTIVITY,
        busy: false,
        newestTurnStatus: "parked",
        newestTurnId: "turn-1",
      });
    });
    expect(host.querySelector("textarea")?.getAttribute("placeholder")).toBe(
      "Ask anything",
    );
    expect(host.querySelector('[aria-label="Stop generating"]')).toBeNull();
    expect(host.textContent).not.toContain("Waiting for your input");
    expect(host.textContent).not.toContain("answering");
    expect(host.querySelector("[data-tf-subagent-pill]")).not.toBeNull();
  });

  it("even a busy contract cannot rebuild the contradiction: placeholder stays constant and no wait label exists", () => {
    // The stale-snapshot worst case (thread.busy true while the shelf
    // would have claimed waiting): Stop may honestly show — a live
    // workflow exists to stop — but nothing claims the member is
    // blocking, and the placeholder never narrates.
    cannedDispatches = RUNNING_DISPATCHES;
    renderTranscript({ ...composerContract, busy: true });
    act(() => {
      activityCell.set({
        ...IDLE_ACTIVITY,
        busy: true,
        newestTurnStatus: "awaiting_input",
        newestTurnId: "turn-1",
      });
    });
    expect(host.querySelector("textarea")?.getAttribute("placeholder")).toBe(
      "Ask anything",
    );
    expect(host.querySelector('[aria-label="Stop generating"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Waiting for your input");
    expect(host.textContent).not.toContain("answering");
  });
});

describe("a parked/idle presentation over a working turn is unbuildable (pinned fixture)", () => {
  // The incident screen: the page rendered "parked/idle" chrome over a
  // background delivery turn that was running the whole time. The
  // determination: the SNAPSHOT was stale (nothing re-read REST after
  // the park), not the rendering — and with every narrating label
  // deleted, once the re-reads land the working turn there is no carrier
  // left that can claim parked/idle over it. These pins make the
  // combination structurally unbuildable from a working snapshot; the
  // store-side half (a refresh landing a working turn flips busy and
  // newestTurnStatus) is pinned in conversation-store.test.ts beside the
  // connect gate.
  it("a working newest turn renders the busy presentation: Stop present, constant placeholder, the announcer says working — nothing says waiting or idle", () => {
    // busy:true is what busyOf() yields for a working turn under a busy
    // thread — the refreshed-snapshot case.
    renderTranscript({ ...composerContract, busy: true });
    act(() => {
      activityCell.set({
        ...IDLE_ACTIVITY,
        busy: true,
        newestTurnStatus: "working",
        newestTurnId: "turn-delivery",
      });
    });
    expect(host.querySelector('[aria-label="Stop generating"]')).not.toBeNull();
    expect(host.querySelector("textarea")?.getAttribute("placeholder")).toBe(
      "Ask anything",
    );
    expect(host.querySelector("[data-tf-status-announcer]")?.textContent).toBe(
      "The assistant is working",
    );
    expect(host.textContent).not.toContain("Waiting for your input");
    // No run-state chrome exists to claim a pause over the live run.
    expect(host.querySelector("[data-tf-run-status]")).toBeNull();
  });

  it("even a stale-idle composer contract cannot narrate a pause over a working turn — no label exists to lie", () => {
    // The worst case a stale snapshot could still produce is a missing
    // Stop control, never a false "parked/waiting" claim: the placeholder
    // is constant, the wait label is deleted, and the announcer follows
    // the turn status, which says working.
    renderTranscript({ ...composerContract, busy: false });
    act(() => {
      activityCell.set({
        ...IDLE_ACTIVITY,
        busy: false,
        newestTurnStatus: "working",
        newestTurnId: "turn-delivery",
      });
    });
    expect(host.querySelector("textarea")?.getAttribute("placeholder")).toBe(
      "Ask anything",
    );
    expect(host.querySelector("[data-tf-status-announcer]")?.textContent).toBe(
      "The assistant is working",
    );
    expect(host.textContent).not.toContain("Waiting for your input");
    expect(host.textContent).not.toContain("parked");
    expect(host.querySelector("[data-tf-run-status]")).toBeNull();
  });
});

describe("the fold's liveness is the machine's time, not the REST status", () => {
  // The stale-liveness screen: an approved live pause leaves the REST
  // status at awaiting_input (submitApprovalDecision deliberately does
  // not re-read on that path, and no stream event advances the status),
  // while the stream is already running the next tool. The fold must
  // read the machine's time from terminality + the decision surface —
  // the announcer's own rule — never from the queued/working bit alone.
  function foldSummary(): HTMLElement {
    const summary = host.querySelector<HTMLElement>(
      "[data-tf-activity-group] summary",
    );
    if (summary === null) {
      throw new Error("no activity fold rendered");
    }
    return summary;
  }
  function openCallState(): string | null {
    return (
      host
        .querySelector("[data-tf-op-state]")
        ?.getAttribute("data-tf-op-state") ?? null
    );
  }
  function announcerText(): string {
    return host.querySelector("[data-tf-status-announcer]")?.textContent ?? "";
  }

  it("a non-terminal pause with NO decision surface reads the live work label, and its open call projects as running", () => {
    messagesCell.set(OPEN_CALL_MESSAGES);
    renderTranscript();
    act(() => {
      activityCell.set({
        ...IDLE_ACTIVITY,
        busy: true,
        newestTurnStatus: "awaiting_input",
        newestTurnId: "turn-1",
      });
    });
    // The live register: collapsed, the latest step's own label under
    // the shimmer — never the settled duration.
    expect(foldSummary().textContent).toContain("Running run command…");
    expect(
      foldSummary().querySelector("[data-tf-shimmer-text]"),
    ).not.toBeNull();
    expect(foldSummary().textContent).not.toContain("Worked");
    // The projection agrees: the resultless call is running, not the
    // dimmed pending mark a dead run wears (transcript-rows' _toolStateOf).
    expect(openCallState()).toBe("input-available");
    expect(announcerText()).toBe("The assistant is working");
  });

  it("a pause WITH a live decision surface never claims Working… — the member's time", () => {
    messagesCell.set(OPEN_CALL_MESSAGES);
    renderTranscript();
    act(() => {
      approvalsCell.set([actionableApprovalCard()]);
      activityCell.set({
        ...IDLE_ACTIVITY,
        busy: true,
        newestTurnStatus: "awaiting_input",
        newestTurnId: "turn-1",
      });
    });
    expect(foldSummary().textContent).not.toContain("Working…");
    expect(foldSummary().textContent).toContain("Worked");
    expect(openCallState()).toBe("input-streaming");
    expect(announcerText()).toBe("Waiting for your input");
  });

  it("a published pending-decision gap counts as a live decision for the fold too", () => {
    messagesCell.set(OPEN_CALL_MESSAGES);
    renderTranscript();
    act(() => {
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
    expect(foldSummary().textContent).not.toContain("Working…");
    expect(foldSummary().querySelector("[data-tf-shimmer-text]")).toBeNull();
    expect(announcerText()).toBe("Waiting for your input");
  });

  it("the visible headline register and the announcer never disagree, for every status × decision state", () => {
    const statuses: readonly TurnStatus[] = [
      "queued",
      "working",
      "awaiting_input",
      "parked",
      "succeeded",
      "failed",
      "superseded",
      "stopped",
    ];
    messagesCell.set(OPEN_CALL_MESSAGES);
    renderTranscript();
    const observed: [TurnStatus, boolean, boolean, boolean][] = [];
    for (const status of statuses) {
      for (const decisionLive of [false, true]) {
        act(() => {
          approvalsCell.set(decisionLive ? [actionableApprovalCard()] : []);
          activityCell.set({
            ...IDLE_ACTIVITY,
            busy: true,
            newestTurnStatus: status,
            newestTurnId: "turn-1",
          });
        });
        // The fold's live register is the shimmer (TVC-013): collapsed
        // it wears the step label, so the WORD varies while the motion
        // treatment is the one stable live signal.
        const foldWorking =
          foldSummary().querySelector("[data-tf-shimmer-text]") !== null;
        const announcedWorking = announcerText() === "The assistant is working";
        observed.push([status, decisionLive, foldWorking, announcedWorking]);
        expect(
          foldWorking,
          `${status} decisionLive=${String(decisionLive)}`,
        ).toBe(announcedWorking);
      }
    }
    // Not vacuous: both registers flip within the matrix.
    expect(observed.some(([, , fold]) => fold)).toBe(true);
    expect(observed.some(([, , fold]) => !fold)).toBe(true);
    // And the pause rows are the ones that used to disagree.
    expect(observed).toContainEqual(["awaiting_input", false, true, true]);
    expect(observed).toContainEqual(["awaiting_input", true, false, false]);
    expect(observed).toContainEqual(["parked", false, true, true]);
  });
});

describe("the optimistic send window", () => {
  it("pendingSend alone makes the transcript live: the standalone Working… headline renders before any turn exists", () => {
    // The send POST is in flight — newestTurnStatus is still null, so
    // runReadsAsWorking says false — and the transcript must already
    // claim liveness. Deliberately rendered over prose-only messages:
    // no fold exists to carry a headline, which was the dead gap.
    renderTranscript({ ...composerContract, pendingSend: true });
    const working = host.querySelector("[data-tf-working-headline]");
    expect(working).not.toBeNull();
    expect(working?.textContent).toContain("Working…");
    expect(working?.querySelector("[data-tf-shimmer-text]")).not.toBeNull();
  });

  it("no pendingSend and no live turn: no standalone headline renders", () => {
    renderTranscript();
    expect(host.querySelector("[data-tf-working-headline]")).toBeNull();
  });
});
