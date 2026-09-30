// The deterministic product scenarios of the transcript visual contract
// (docs/transcript-visual-contract.md §5). Each scenario is a full
// composition — real projection, real components, canned TeaFlask
// content — reachable at ?scenario=<name> (&theme=dark, &reduce-motion).
// Later lanes' geometry and screenshot laws target these URLs, so the
// names and coverage are contract, not convenience. Like the rest of the
// fixture bench, this module deep-imports src/** on purpose: it is the
// package looking at itself.

import { useEffect, useRef, useState, type ReactNode } from "react";

import type { Message } from "@ag-ui/core";

import {
  ActivityShelf,
  ComposerActivityOverlay,
} from "../../src/components/activity-shelf";
import { ApprovalCard } from "../../src/components/approval-card";
import { ApprovalsContext } from "../../src/components/approval-context";
import { ChildTranscriptPreviewFrame } from "../../src/components/child-transcript";
import { Composer } from "../../src/components/composer";
import { ConversationContext } from "../../src/components/conversation-context";
import { PendingDecisionGapNotice } from "../../src/components/notice-banner";
import type { ThreadDispatch } from "../../src/contract/dispatches";
import { ElicitationsContext } from "../../src/components/elicitation-context";
import { QuestionPanel } from "../../src/components/question-panel";
import { AssistantMarkdown } from "../../src/components/markdown/assistant-markdown";
import { MessageList } from "../../src/components/message-list";
import { SubagentCountPill } from "../../src/components/subagent-count-pill";
import { SubagentCurrentWorkContext } from "../../src/components/subagent-current-work";
import { SubagentExecutionWorkContext } from "../../src/components/subagent-execution-work";
import {
  SubagentDispatchesContext,
  SubagentGroupRow,
} from "../../src/components/subagent-group-row";
import { reactToolView } from "../../src/components/react-tool-view";
import { ToolViewRegistryContext } from "../../src/components/tool-view-registry-context";
import { SuspensionSurfaces } from "../../src/components/suspension-surfaces";
import { ToolRow } from "../../src/components/tool-row";
import { subagentIdentityTokenOf } from "../../src/core/agent-identity";
import { coworkerIndicesOf } from "../../src/core/subagent-presence";
import { settledDurationLabelOf } from "../../src/core/subagent-roster";
import type { ApprovalCardModel } from "../../src/core/approval-inbox";
import type { ToolViewProps, ToolViewRegistry } from "../../src/core/tool-view";
import type { MarkerAnchorsSnapshot } from "../../src/core/connection-epoch";
import type { ElicitationCardModel } from "../../src/core/elicitation-cards";
import type { BlockTiming } from "../../src/core/segment-timing";
import type {
  ToolCallDisplay,
  ToolCallViewModel,
} from "../../src/core/tool-call-display";
import type { ToolCallIcon } from "../../src/core/tool-call-presentation";
import { transcriptRowsOf } from "../../src/core/transcript-rows";
import {
  CANNED_ANSWERED_APPROVAL_CARD,
  CANNED_APPROVAL_CARD,
  CANNED_QUESTIONS_ANSWERED,
  CANNED_QUESTIONS_CANCELLED,
  CANNED_QUESTIONS_STALE,
  CANNED_QUESTIONS_THREE,
  CANNED_REFUND_APPROVAL_CARD,
  CANNED_EMAIL_APPROVAL_CARD,
  CANNED_THREAD_DISPATCHES,
  CANNED_BOOLEAN_APPROVAL_CARD,
  CANCELLED_TOOL_CALL,
  CAPTIONED_CANCELLED_TOOL_CALL,
  CAPTIONED_COMPLETED_TOOL_CALL,
  CAPTIONED_FAILED_TOOL_CALL,
  CAPTIONED_TOOL_CALL,
  COMPLETED_TOOL_CALL,
  DENIED_TOOL_CALL,
  FAILED_TOOL_CALL,
  OFFLOADED_TOOL_CALL,
  RUNNING_TOOL_CALL,
} from "./canned-data";
import { CANNED_COMPOSER, CANNED_COMPOSER_BUSY } from "./canned-conversation";
import { QuestionDraftStore } from "../../src/core/question-drafts";

const SCENARIO_NAMES = [
  "rhythm",
  "interleaved",
  "operations",
  "states",
  "approvals",
  "elicitations",
  "subagents",
  "coworker-requests",
  "notices",
  "fallbacks",
  "renderers",
  "built-ins",
  "composer",
  "activity-shelf",
  "suspensions",
  "captions",
] as const;

export type ScenarioName = (typeof SCENARIO_NAMES)[number];

export function isScenarioName(value: string): value is ScenarioName {
  return (SCENARIO_NAMES as readonly string[]).includes(value);
}

// --- shared canned bits -----------------------------------------------------

export const EMPTY_ANCHORS: MarkerAnchorsSnapshot = {
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

function anchorsWith(
  overrides: Partial<MarkerAnchorsSnapshot>,
): MarkerAnchorsSnapshot {
  return { ...EMPTY_ANCHORS, ...overrides };
}

const NO_ELICITATIONS = {
  cards: [] as ElicitationCardModel[],
  submitQuestionAnswers: () => Promise.resolve(),
  cancelQuestionSet: () => Promise.resolve(),
  drafts: new QuestionDraftStore(),
};
// The bench's question panel opens on its third question with the R46
// production paragraph already drafted in the custom row — the
// long-pasted-text picture TVC-154 shoots.
NO_ELICITATIONS.drafts.setCursor(CANNED_QUESTIONS_THREE.interruptId, 2);
NO_ELICITATIONS.drafts.setCustomText(
  CANNED_QUESTIONS_THREE.interruptId,
  "deadline_q",
  "None of these exactly — I want the Vercel-style architecture:\n\n" +
    "1. A “Getting started” track that reads top-to-bottom in 3 tiers " +
    "(quickstart → concepts → deep dives), each page one idea.\n" +
    "2. Reference pages generated from the code, one per public surface.\n" +
    "\nShip the first cut by 2026-09-01 and keep the sidebar to 2 levels.",
);

export function toolCallMessage(
  id: string,
  calls: { id: string; name: string; args: Record<string, unknown> }[],
): Message {
  return {
    id,
    role: "assistant",
    content: "",
    toolCalls: calls.map((call) => ({
      id: call.id,
      type: "function" as const,
      function: { name: call.name, arguments: JSON.stringify(call.args) },
    })),
  };
}

function Scene({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="tf:flex tf:flex-col tf:gap-3">
      <h2 className="tf:m-0 tf:border-b tf:pb-2 tf:text-tf-heading tf:font-medium">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A block posed with every disclosure expanded — the settled-fold
 *  specimens whose story lives inside a collapsed <details>. */
function PosedOpenBlock({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    host.current?.querySelectorAll("details").forEach((pane) => {
      pane.open = true;
    });
  }, []);
  return <div ref={host}>{children}</div>;
}

/** A ToolRow posed expanded, the way a visitor leaves it — the native
 *  <details> poked after mount (ToolRow deliberately has no open prop,
 *  so the bench poses the element rather than growing the component an
 *  API only a fixture wants). */
function PosedOpenToolRow({ view }: { view: ToolCallViewModel }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const pane = host.current?.querySelector("details");
    if (pane) {
      pane.open = true;
    }
  }, []);
  return (
    <div ref={host}>
      <ToolRow view={view} />
    </div>
  );
}

// --- rhythm -------------------------------------------------------------------

const RHYTHM_ANSWER = [
  "Yes — **80°C for two minutes** is the documented pairing for sencha.",
  "",
  "1. Warm the pot first",
  "2. Steep for 2:00, no longer",
  "3. Decant completely so the leaf stops steeping",
  "",
  "Boiling water is what makes it bitter, not the leaf.",
].join("\n");

const RHYTHM_MESSAGES: Message[] = [
  {
    id: "u-r1",
    role: "user",
    content: "Is 80°C right for sencha, and how long should it steep?",
  },
  {
    id: "th-r1",
    role: "reasoning",
    content:
      "Temperature and time both matter here; check the steeping guide so " +
      "the numbers are the documented ones.",
  },
  toolCallMessage("a-r1", [
    { id: "t-r1", name: "docs_search", args: { query: "sencha temperature" } },
  ]),
  {
    id: "r-r1",
    role: "tool",
    toolCallId: "t-r1",
    content:
      "[steeping#water] Water temperature\nUse 80°C for sencha; boiling water scalds the leaf.",
  },
  toolCallMessage("a-r1b", [
    { id: "t-r2", name: "read_page", args: { path: "/guides/steeping" } },
  ]),
  {
    id: "r-r2",
    role: "tool",
    toolCallId: "t-r2",
    content: "Steep for two minutes, then decant completely.",
  },
  { id: "p-r1", role: "assistant", content: RHYTHM_ANSWER },
  { id: "u-r2", role: "user", content: "And gyokuro — same numbers?" },
  {
    id: "th-r2",
    role: "reasoning",
    content: "Gyokuro runs cooler; confirm before quoting a figure.",
  },
  toolCallMessage("a-r2", [
    { id: "t-r3", name: "docs_search", args: { query: "gyokuro temperature" } },
  ]),
];

// The settled first turn's server timing: th-r1 → t-r2 spans 289s, so the
// settled fold header reads "Worked for 4m 49s". The live second turn
// (th-r2/t-r3) deliberately carries none — its fold is active
// ("Working…"), and the fold locator's .first() stays the settled one.
const RHYTHM_T0 = 1_756_400_000_000;
const RHYTHM_TIMINGS = new Map<string, BlockTiming>([
  ["th-r1", { startedAtMs: RHYTHM_T0, settledAtMs: RHYTHM_T0 + 8_000 }],
  ["t-r1", { startedAtMs: RHYTHM_T0 + 8_000, settledAtMs: RHYTHM_T0 + 65_000 }],
  [
    "t-r2",
    { startedAtMs: RHYTHM_T0 + 70_000, settledAtMs: RHYTHM_T0 + 289_000 },
  ],
]);

const RHYTHM_DISPLAYS = new Map<string, ToolCallDisplay>([
  [
    "t-r1",
    {
      progressText: "Searching your docs for “sencha temperature”…",
      completeText: "Searched your docs — 1 result",
    },
  ],
  [
    "t-r3",
    {
      progressText: "Searching your docs for “gyokuro temperature”…",
    },
  ],
]);

// Fixed ISO stamps for the user bubbles' timestamps: with the browser
// context pinned to en-US/UTC in playwright.config.ts (enforced, not
// assumed), these render deterministic "Monday 7:19 PM"-register labels.
const RHYTHM_TURN_META = new Map([
  [
    "u-r1",
    { attachments: [], createdAt: "2026-09-07T19:19:00Z" }, // Monday
  ],
  ["u-r2", { attachments: [], createdAt: "2026-09-07T19:24:00Z" }],
]);

function RhythmScenario() {
  const rows = transcriptRowsOf(
    RHYTHM_MESSAGES,
    anchorsWith({
      toolCallDisplayAnchors: RHYTHM_DISPLAYS,
      blockTimingAnchors: RHYTHM_TIMINGS,
    }),
    true,
    RHYTHM_TURN_META,
  );
  return <MessageList rows={rows} cards={[]} live />;
}

// --- interleaved ------------------------------------------------------

// One COMPLETED turn interleaving three narration passages with three
// action clusters — the episode-unification specimen. Settled, it must
// read as one "Worked for 5m 39s" disclosure (collapsed by default)
// above the visible final response; expanded, the full chronology —
// leading narration, clusters, intermediate findings — returns in
// original order. A prose-only second turn beneath is the no-fold
// control, and proves separate turns stay separate episodes.

const INTERLEAVED_FINAL_ANSWER = [
  "The audit is done — **two of the three guides match the brew logs**.",
  "",
  "1. Sencha: guide and logs agree (80°C, 2:00)",
  "2. Gyokuro: the guide is newer; the logs drift by five degrees",
  "3. Hōjicha: guide and logs agree (95°C, 30s)",
  "",
  "I'd update the gyokuro log template rather than the guide.",
].join("\n");

const INTERLEAVED_MESSAGES: Message[] = [
  {
    id: "u-x1",
    role: "user",
    content: "Audit the steeping guides against the shop's brew logs.",
  },
  {
    id: "p-x0",
    role: "assistant",
    content:
      "I'll compare each guide against the brew logs, starting with sencha.",
  },
  {
    id: "th-x1",
    role: "reasoning",
    content: "Pull the sencha guide and its matching log entries first.",
  },
  toolCallMessage("a-x1", [
    { id: "t-x1", name: "docs_search", args: { query: "sencha steeping" } },
  ]),
  {
    id: "r-x1",
    role: "tool",
    toolCallId: "t-x1",
    content: "[steeping#sencha] 80°C for two minutes, decant completely.",
  },
  {
    id: "p-x1",
    role: "assistant",
    content:
      "The sencha guide matches the logs exactly. Gyokuro next — its log entries look older.",
  },
  toolCallMessage("a-x2", [
    { id: "t-x2", name: "read_page", args: { path: "/guides/gyokuro" } },
  ]),
  {
    id: "r-x2",
    role: "tool",
    toolCallId: "t-x2",
    content: "Gyokuro: 60°C for ninety seconds, shade-grown leaf.",
  },
  toolCallMessage("a-x3", [
    { id: "t-x3", name: "docs_search", args: { query: "gyokuro brew log" } },
  ]),
  {
    id: "r-x3",
    role: "tool",
    toolCallId: "t-x3",
    content: "[logs#gyokuro] Brewed at 65°C across the last four batches.",
  },
  {
    id: "p-x2",
    role: "assistant",
    content:
      "Gyokuro drifts by five degrees between guide and logs — checking which record is newer before calling it.",
  },
  toolCallMessage("a-x4", [
    { id: "t-x4", name: "read_page", args: { path: "/logs/gyokuro/history" } },
  ]),
  {
    id: "r-x4",
    role: "tool",
    toolCallId: "t-x4",
    content: "Guide revised 2026-08-12; the log template predates it.",
  },
  { id: "p-x-final", role: "assistant", content: INTERLEAVED_FINAL_ANSWER },
  { id: "u-x2", role: "user", content: "Perfect — thanks!" },
  {
    id: "p-x3",
    role: "assistant",
    content: "Anytime. Happy steeping!",
  },
];

// The episode's server timing spans first thought to last settle —
// 339s, so the one settled header reads "Worked for 5m 39s" (the
// narration gaps ride inside the span; prose carries no timing).
const INTERLEAVED_T0 = 1_756_400_000_000;
const INTERLEAVED_TIMINGS = new Map<string, BlockTiming>([
  [
    "th-x1",
    { startedAtMs: INTERLEAVED_T0, settledAtMs: INTERLEAVED_T0 + 6_000 },
  ],
  [
    "t-x1",
    {
      startedAtMs: INTERLEAVED_T0 + 6_000,
      settledAtMs: INTERLEAVED_T0 + 58_000,
    },
  ],
  [
    "t-x2",
    {
      startedAtMs: INTERLEAVED_T0 + 74_000,
      settledAtMs: INTERLEAVED_T0 + 121_000,
    },
  ],
  [
    "t-x3",
    {
      startedAtMs: INTERLEAVED_T0 + 121_000,
      settledAtMs: INTERLEAVED_T0 + 187_000,
    },
  ],
  [
    "t-x4",
    {
      startedAtMs: INTERLEAVED_T0 + 214_000,
      settledAtMs: INTERLEAVED_T0 + 339_000,
    },
  ],
]);

const INTERLEAVED_DISPLAYS = new Map<string, ToolCallDisplay>([
  [
    "t-x1",
    {
      progressText: "Searching your docs for “sencha steeping”…",
      completeText: "Searched your docs — 1 result",
    },
  ],
  [
    "t-x3",
    {
      progressText: "Searching your docs for “gyokuro brew log”…",
      completeText: "Searched your docs — 4 log entries",
    },
  ],
]);

function InterleavedScenario() {
  const rows = transcriptRowsOf(
    INTERLEAVED_MESSAGES,
    anchorsWith({
      toolCallDisplayAnchors: INTERLEAVED_DISPLAYS,
      blockTimingAnchors: INTERLEAVED_TIMINGS,
    }),
    false,
  );
  return <MessageList rows={rows} cards={[]} />;
}

// --- operations -----------------------------------------------------------------

interface OperationSpecimen {
  slug: string;
  view: ToolCallViewModel;
}

function operationOf(
  slug: string,
  icon: ToolCallIcon,
  toolName: string,
  completeText: string,
  args: Record<string, unknown>,
): OperationSpecimen {
  return {
    slug,
    view: {
      toolName,
      state: "output-available",
      input: JSON.stringify(args, null, 2),
      output: "ok",
      display: { completeText, icon },
    },
  };
}

const OPERATION_SPECIMENS: OperationSpecimen[] = [
  operationOf(
    "terminal",
    "terminal",
    "run_diagnostics",
    "Ran the kettle diagnostics",
    {
      target: "kettle-9",
    },
  ),
  operationOf(
    "search",
    "search",
    "docs_search",
    "Searched your docs for “steeping sencha” — 3 results",
    {
      query: "steeping sencha",
    },
  ),
  operationOf(
    "file",
    "file",
    "export_guide",
    "Saved the steeping guide export",
    {
      path: "/exports/steeping-guide.pdf",
    },
  ),
  operationOf("memory", "memory", "add_memory", "Saved a note to memory", {
    note: "Casey prefers sencha at 80°C.",
  }),
  operationOf(
    "question",
    "question",
    "ask_member",
    "Asked which plan to set up",
    {
      prompt: "Which plan should I set up?",
    },
  ),
  operationOf(
    "routine",
    "routine",
    "schedule_check",
    "Scheduled the weekly freshness check",
    {
      cadence: "weekly",
    },
  ),
  operationOf(
    "delegation",
    "delegation",
    "delegate_review",
    "Delegated the guide survey",
    {
      task: "Survey the steeping guides.",
    },
  ),
  operationOf(
    "navigation",
    "navigation",
    "navigate",
    "Opened the steeping guide",
    {
      path: "/guides/steeping",
    },
  ),
  // The plan-progress member (contract §8's recorded conditional,
  // discharged): the authored icon:"todo" annotation resolves the
  // dedicated checklist mark (TVC-055).
  operationOf(
    "todo",
    "todo",
    "update_plan",
    "Updated the brewing checklist — 2 of 5 done",
    {
      completed: 2,
      total: 5,
    },
  ),
  {
    slug: "generic",
    view: RUNNING_TOOL_CALL,
  },
];

function OperationsScenario() {
  return (
    <>
      <Scene title="One operation per semantic vocabulary member">
        <div className="tf:flex tf:flex-col">
          {OPERATION_SPECIMENS.map((specimen) => (
            <div key={specimen.slug} data-tf-scenario-op={specimen.slug}>
              <ToolRow view={specimen.view} />
            </div>
          ))}
        </div>
      </Scene>
      <LongRailScene />
      <LongLabelScene />
    </>
  );
}

// A collapsed LIVE fold whose latest step carries a long authored
// progressText (round-1 review, finding 1): the collapsed headline can
// reach activityTitleOf's 64-char cap — past what the 390px narrow
// contract can hold — so it must ellipsize inside the shimmer, never
// wrap and never overflow the transcript's horizontal bounds. The e2e
// probe reads this scene's testid at the narrow width.
const LONG_LABEL_MESSAGES: Message[] = [
  { id: "ll-u1", role: "user", content: "Reconcile the export ledgers." },
  toolCallMessage("ll-a1", [
    {
      id: "ll-t1",
      name: "action__reconcile-export-ledgers",
      args: { range: "2026-Q3" },
    },
  ]),
];

const LONG_LABEL_ANCHORS = anchorsWith({
  toolCallDisplayAnchors: new Map([
    [
      "ll-t1",
      {
        progressText:
          "Reconciling the quarterly export ledgers against the archived billing snapshots…",
      },
    ],
  ]),
});

// An out-of-window stamp (round-2 finding 4): under both e2e clock
// regimes — frozen probe and ticking capture, each anchored at
// helpers/geometry.ts SCENARIO_FIXED_NOW (2026-09-08) — this bubble
// renders the DATED register — "Aug 24, 7:19 PM" — the recency window's
// other arm, posed beside the rhythm scenario's in-window weekday form.
const LONG_LABEL_TURN_META = new Map([
  ["ll-u1", { attachments: [], createdAt: "2026-08-24T19:19:00Z" }],
]);

function LongLabelScene() {
  const rows = transcriptRowsOf(
    LONG_LABEL_MESSAGES,
    LONG_LABEL_ANCHORS,
    true,
    LONG_LABEL_TURN_META,
  );
  return (
    <Scene title="Long step label — the collapsed live headline truncates">
      <div data-testid="long-label-scene">
        <MessageList rows={rows} cards={[]} live />
      </div>
    </Scene>
  );
}

// A 30-step live run, posed open: the expanded rail caps its height and
// scrolls internally — thin scrollbar, bottom-only fade, crisp top row —
// while a short fold elsewhere (the rhythm scenario) keeps its exact
// geometry. The e2e probe reads this scene's testid; the fixture eyeball
// reads its pixels in both themes.
const LONG_RAIL_MESSAGES: Message[] = Array.from({ length: 30 }, (_, index) => {
  const step = index + 1;
  return [
    toolCallMessage(`long-a${String(step)}`, [
      {
        id: `long-t${String(step)}`,
        name: "docs_search",
        args: { query: `steeping guide ${String(step)}` },
      },
    ]),
    ...(step < 30
      ? [
          {
            id: `long-r${String(step)}`,
            role: "tool",
            toolCallId: `long-t${String(step)}`,
            content: `guide ${String(step)} read`,
          } as Message,
        ]
      : []),
  ];
}).flat();

function LongRailScene() {
  const rows = transcriptRowsOf(LONG_RAIL_MESSAGES, EMPTY_ANCHORS, true);
  return (
    <Scene title="Long run — the expanded rail grows to its content">
      <PosedOpenBlock>
        <div
          data-testid="long-rail-scene"
          className="tf:flex tf:flex-col"
          style={{ height: 480 }}
        >
          <MessageList rows={rows} cards={[]} live />
        </div>
      </PosedOpenBlock>
    </Scene>
  );
}

// --- states -----------------------------------------------------------------------

const QUEUED_TOOL_CALL: ToolCallViewModel = {
  toolName: "action__create-support-ticket",
  state: "input-streaming",
  input: '{"path": "/tickets"',
};

const AWAITING_MESSAGES: Message[] = [
  {
    id: "u-s1",
    role: "user",
    content: "File the ticket and pick the right plan for me.",
  },
  toolCallMessage("a-s1", [
    {
      id: "t-await",
      name: "action__create-support-ticket",
      args: { path: "/tickets", title: "Kettle whistles in B minor" },
    },
  ]),
];

// The pending ask is posed in its OWN live fold, beside the approval's:
// one decision per fold keeps each surface whole, and the set's first
// question carries two suggestions so the scene stays compact at the
// narrow width. (The rail's former height cap, which first forced this
// split, is gone — the rail grows to its content; the split stays because
// the baselines are photographed against it.)
const AWAITING_ASK_MESSAGES: Message[] = [
  { id: "u-s2", role: "user", content: "And pick the right plan for me." },
  toolCallMessage("a-s2", [
    {
      id: "t-ask",
      name: "ask_user",
      // The same two-question set the anchored card (AWAITING_ASK, below)
      // narrows — inlined, since the card is declared after this const.
      args: {
        questions: [
          {
            id: "plan",
            heading: "Plan",
            prompt: "Which plan should I set up?",
            options: [
              { text: "Basic" },
              {
                text: "Pro",
                description: "Adds the fare calendar and alerts.",
              },
            ],
          },
          {
            id: "billing",
            heading: "Billing",
            prompt: "Monthly or annual billing?",
            options: [{ text: "Monthly" }, { text: "Annual" }],
          },
        ],
      },
    },
  ]),
];

// A compact request, on purpose: the fold's rail is capped at 384px on the
// narrow width and auto-scrolls to its latest step, so a full ticket card
// (~470px) would photograph with its prompt and first summary rows
// scrolled out of frame. This scene pictures the awaiting STATE — the
// banner whole, above its Approve/Deny row (no banner renders the
// request's fields anywhere; decision-approvals (TVC-154) pictures the
// banner stacks). The card keeps CANNED_APPROVAL_CARD's own tool and
// prompt, so it agrees with the create-ticket row it is anchored to and
// the user's request above it.
const AWAITING_APPROVAL: ApprovalCardModel = {
  ...CANNED_APPROVAL_CARD,
  interruptId: "scenario-awaiting-approval",
  toolCallId: "t-await",
  anchored: true,
  toolArgs: {},
  toolInputSchema: null,
  toolOutputSchema: null,
};

const AWAITING_ASK: ElicitationCardModel = {
  ...CANNED_QUESTIONS_THREE,
  interruptId: "scenario-awaiting-ask",
  toolCallId: "t-ask",
  anchored: true,
  questions: [
    {
      id: "plan",
      heading: "Plan",
      prompt: "Which plan should I set up?",
      options: [
        { text: "Basic", description: null },
        { text: "Pro", description: "Adds the fare calendar and alerts." },
      ],
    },
    {
      id: "billing",
      heading: "Billing",
      prompt: "Monthly or annual billing?",
      options: [
        { text: "Monthly", description: null },
        { text: "Annual", description: null },
      ],
    },
  ],
};

const STALE_MESSAGES: Message[] = [
  { id: "u-s2", role: "user", content: "Actually, hold that thought." },
  {
    id: "p-s2",
    role: "assistant",
    content: "Setting the earlier request aside — what should we do instead?",
  },
];

// A set-aside (voided) turn renders NO receipt row (a meta-receipt kind):
// its prose simply ends and the next turn begins. The scene keeps the
// shape as the deletion's visual specimen.

// Turn-level terminal endings: one member stop, one failure outside any
// tool. Only the failure projects a row — a quiet durable receipt after
// the run's last message, distinct from a failed operation's in-row pill.
// The stopped turn keeps its durable marker but renders no notice: its
// prose simply ends where the member ended it.
const TERMINAL_MESSAGES: Message[] = [
  { id: "u-s3", role: "user", content: "Compare every kettle you know of." },
  {
    id: "p-s3",
    role: "assistant",
    content: "Starting with the stovetop models —",
  },
  { id: "u-s4", role: "user", content: "And what about travel kettles?" },
  { id: "p-s4", role: "assistant", content: "Gathering the travel models —" },
];

const TERMINAL_ANCHORS = anchorsWith({
  turnFailedAnchors: new Map([
    [
      "p-s4",
      {
        before: [],
        after: ["Something went wrong while answering. Please try again."],
      },
    ],
  ]),
});

function StatesScenario() {
  return (
    <>
      <Scene title="Protocol states — queued, active, completed, failed, interrupted, not approved, parked">
        <div className="tf:flex tf:flex-col">
          <ToolRow view={QUEUED_TOOL_CALL} />
          <ToolRow view={RUNNING_TOOL_CALL} />
          <ToolRow view={COMPLETED_TOOL_CALL} />
          <ToolRow view={FAILED_TOOL_CALL} />
          <ToolRow view={CANCELLED_TOOL_CALL} />
          {/* Directly under the cancelled row: the two
              look-alikes the state exists to tell apart, side by side. */}
          <ToolRow view={DENIED_TOOL_CALL} />
          <ToolRow view={OFFLOADED_TOOL_CALL} />
        </div>
      </Scene>
      <Scene title="Awaiting input — a pending approval and a pending ask">
        <ApprovalsContext.Provider
          value={{
            cards: [AWAITING_APPROVAL],
            submitDecision: () => Promise.resolve(),
          }}
        >
          <MessageList
            rows={transcriptRowsOf(AWAITING_MESSAGES, EMPTY_ANCHORS, true)}
            cards={[AWAITING_APPROVAL]}
            live
          />
        </ApprovalsContext.Provider>
        <ElicitationsContext.Provider
          value={{ ...NO_ELICITATIONS, cards: [AWAITING_ASK] }}
        >
          <MessageList
            rows={transcriptRowsOf(AWAITING_ASK_MESSAGES, EMPTY_ANCHORS, true)}
            cards={[]}
            live
          />
        </ElicitationsContext.Provider>
      </Scene>
      <Scene title="Stale — a set-aside turn and an expired ask">
        <MessageList
          rows={transcriptRowsOf(STALE_MESSAGES, EMPTY_ANCHORS, false)}
          cards={[]}
        />
        <ElicitationsContext.Provider value={NO_ELICITATIONS}>
          <QuestionPanel card={CANNED_QUESTIONS_STALE} />
        </ElicitationsContext.Provider>
      </Scene>
      <Scene title="Terminal turn receipts — a stopped turn and a failed turn">
        <MessageList
          rows={transcriptRowsOf(TERMINAL_MESSAGES, TERMINAL_ANCHORS, false)}
          cards={[]}
        />
      </Scene>
    </>
  );
}

// --- approvals ---------------------------------------------------------------------

const DESTRUCTIVE_CARD: ApprovalCardModel = {
  interruptId: "scenario-destructive",
  toolName: "action__delete-doc",
  toolArgs: { path_params: { doc_id: "doc_311" } },
  toolInputSchema: null,
  toolOutputSchema: null,
  prompt:
    "The assistant wants to permanently delete the “Legacy descaling guide” doc. This can't be undone.",
  toolCallId: null,
  anchored: false,
  round: 0,
  runId: "scenario-run",
  parked: false,
  gated: true,
  trustAvailable: false,
  asker: { kind: "assistant" },
  turnId: null,
  status: { kind: "actionable", errorSentence: null },
};

const CONVERSATION_SCOPED_CARD: ApprovalCardModel = {
  ...CANNED_APPROVAL_CARD,
  interruptId: "scenario-trust",
  toolCallId: null,
  anchored: false,
  trustAvailable: true,
};

const APPROVAL_STACK: ApprovalCardModel[] = [
  { ...CANNED_APPROVAL_CARD, toolCallId: null, anchored: false },
  DESTRUCTIVE_CARD,
  CONVERSATION_SCOPED_CARD,
  CANNED_BOOLEAN_APPROVAL_CARD,
  CANNED_REFUND_APPROVAL_CARD,
  CANNED_EMAIL_APPROVAL_CARD,
  CANNED_ANSWERED_APPROVAL_CARD,
];

function ApprovalsScenario() {
  return (
    <ApprovalsContext.Provider
      value={{ cards: APPROVAL_STACK, submitDecision: () => Promise.resolve() }}
    >
      <Scene title="Pending — generic, destructive, conversation-scoped">
        <div className="tf:flex tf:flex-col tf:gap-2">
          <ApprovalCard card={APPROVAL_STACK[0]} />
          <ApprovalCard card={DESTRUCTIVE_CARD} />
          <ApprovalCard card={CONVERSATION_SCOPED_CARD} />
        </div>
      </Scene>
      <Scene title="Generic requests — arguments never render on the banner">
        {/* Three differently-shaped requests (a boolean, nested values,
            a long email body), one consent grammar: the request lives on
            the call's own row, not here. */}
        <div className="tf:flex tf:flex-col tf:gap-2">
          <ApprovalCard card={CANNED_BOOLEAN_APPROVAL_CARD} />
          <ApprovalCard card={CANNED_REFUND_APPROVAL_CARD} />
          <ApprovalCard card={CANNED_EMAIL_APPROVAL_CARD} />
        </div>
      </Scene>
      <Scene title="Resolved — the answered card; the meta-receipt rows are gone">
        {/* The card's own footer note is the outcome's one surface; the
            quiet "Request approved/denied" receipt rows this scene used
            to pose were deleted with the meta-receipt class. */}
        <ApprovalCard card={CANNED_ANSWERED_APPROVAL_CARD} />
      </Scene>
      <Scene title="Settled quietly — an approved call's transcript carries no meta-receipt prose">
        {/* The deletion's visual specimen: this history's gated call was
            approved and ran, and the transcript shows only the work —
            the fold, the row, the answer. Posed open so a restored
            receipt line would be visible in the screenshot diff. */}
        <PosedOpenBlock>
          <div className="tf:flex tf:flex-col" style={{ height: 220 }}>
            <MessageList
              rows={transcriptRowsOf(
                JOINED_RECEIPT_MESSAGES,
                EMPTY_ANCHORS,
                false,
              )}
              cards={[]}
              decisionSurfacesInShelf
            />
          </div>
        </PosedOpenBlock>
      </Scene>
    </ApprovalsContext.Provider>
  );
}

const JOINED_RECEIPT_MESSAGES: Message[] = [
  {
    id: "ja-u1",
    role: "user",
    content: "File the ticket for the whistling kettle.",
  },
  {
    id: "ja-a1",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "ja-t1",
        type: "function",
        function: {
          name: "action__create-support-ticket",
          arguments: JSON.stringify({
            path: "/tickets",
            title: "Kettle whistles in B minor",
          }),
        },
      },
    ],
  },
  {
    id: "ja-r1",
    role: "tool",
    toolCallId: "ja-t1",
    content: JSON.stringify({ ok: true, result: { id: 7 } }),
  },
  {
    id: "ja-a2",
    role: "assistant",
    content: "Filed — ticket 7 tracks the whistling kettle.",
  },
];

// --- elicitations ---------------------------------------------------------------------

function ElicitationsScenario() {
  return (
    <ElicitationsContext.Provider value={NO_ELICITATIONS}>
      <Scene title="Asks — the question panel: pending, answered, dismissed, stale">
        <div className="tf:flex tf:flex-col tf:gap-2">
          <QuestionPanel card={CANNED_QUESTIONS_THREE} />
          {/* The settled forms render on the panel itself (the meta-receipt
              rule): the Q→A receipt, the heading over the dismissed
              sentence, and the heading over the expired note. */}
          <QuestionPanel card={CANNED_QUESTIONS_ANSWERED} />
          <QuestionPanel card={CANNED_QUESTIONS_CANCELLED} />
          <QuestionPanel card={CANNED_QUESTIONS_STALE} />
        </div>
      </Scene>
    </ElicitationsContext.Provider>
  );
}

// --- subagents ---------------------------------------------------------------------------

function SubagentsScenario() {
  // The deterministic specimen facts derive from the canned ledger the
  // way the shipped surfaces derive them — never hand-spelled twins that
  // could drift from the real presentation.
  const variantIndices = coworkerIndicesOf(CANNED_THREAD_DISPATCHES.values());
  const settledChild = CANNED_THREAD_DISPATCHES.get(2);
  return (
    <SubagentDispatchesContext.Provider
      value={{ byOrdinal: CANNED_THREAD_DISPATCHES }}
    >
      {/* The running child's current work, posed the way the open
          drill-in stream publishes it: the group row renders
          the presenter's currentWorkLabel through the shared shimmer. */}
      <SubagentCurrentWorkContext.Provider
        value={
          new Map([
            [
              "subagent-bench-0",
              {
                toolName: "docs_search",
                state: "input-available" as const,
                input: '{"query":"steeping temperature claims"}',
              },
            ],
          ])
        }
      >
        <Scene title="Delegation — one running, one failed, one completed">
          <SubagentGroupRow
            row={{
              kind: "subagent-group",
              key: "scenario-subagents",
              entries: [
                {
                  toolCallId: "t-d0",
                  receipt: {
                    outcome: "launched",
                    ordinal: 0,
                    label: "Survey the steeping guides for temperature claims.",
                    childSessionId: "subagent-bench-0",
                    settled: null,
                  },
                  label: "Survey the steeping guides for temperature claims.",
                  running: true,
                  failed: false,
                  cancelled: false,
                  note: null,
                },
                {
                  toolCallId: "t-d1",
                  receipt: {
                    outcome: "already_settled",
                    ordinal: 1,
                    label: "Map every kettle model the docs mention.",
                    childSessionId: "subagent-bench-1",
                    settled: {
                      failed: true,
                      note: "The coworker ran out of context before answering.",
                    },
                  },
                  label: "Map every kettle model the docs mention.",
                  running: false,
                  failed: true,
                  cancelled: false,
                  note: "The coworker ran out of context before answering.",
                },
                {
                  toolCallId: "t-d2",
                  receipt: {
                    outcome: "already_settled",
                    ordinal: 2,
                    label: "Check the descaling instructions for drift.",
                    childSessionId: "subagent-bench-2",
                    settled: { failed: false, note: null },
                  },
                  label: "Check the descaling instructions for drift.",
                  running: false,
                  failed: false,
                  cancelled: false,
                  note: null,
                },
              ],
            }}
          />
        </Scene>
        <Scene title="Child transcript preview">
          <ChildTranscriptPreviewFrame
            label="Check the descaling instructions for drift."
            status="finished"
            // The real derivations over the canned ledger row — the same
            // ladder ("3m 04s") and color the shipped preview computes.
            duration={
              settledChild !== undefined
                ? settledDurationLabelOf(
                    settledChild.created_at,
                    settledChild.updated_at,
                  )
                : null
            }
            variantIndex={variantIndices.get("subagent-bench-2")}
          >
            <MessageList
              rows={transcriptRowsOf(
                [
                  {
                    id: "child-u1",
                    role: "user",
                    content: "Check the descaling instructions for drift.",
                  },
                  {
                    id: "child-a1",
                    role: "assistant",
                    content:
                      "The interval and citric-acid ratio still match; the rinse step needs one wording correction.",
                  },
                ],
                EMPTY_ANCHORS,
                false,
              )}
              cards={[]}
              // The specimen matches the shipped surface: a child
              // transcript's prose wears the coworker's token (law 10).
              identityToken={subagentIdentityTokenOf("subagent-bench-2")}
            />
          </ChildTranscriptPreviewFrame>
        </Scene>
        <Scene title="Presence pill">
          {/* The pill mounts through its landlord so the bench
            keeps the band's centering and ground. The deterministic
            renderPreview seam makes the roster rows previewable (real
            buttons with chevrons) WITHOUT a live stream, so the
            geometry laws (TVC-074/075) can measure the interactive row
            shape; the pill stays closed in TVC-158's shot. */}
          {/* Inline height, not h-16: the package build scans only
              src/components for utilities, so a fixture-only class silently
              never exists and the wrapper collapses (the bench's own
              pt-64 note records the same rule). */}
          <div className="tf:relative" style={{ height: 64 }}>
            <ComposerActivityOverlay
              activity={
                <SubagentCountPill
                  dispatches={CANNED_THREAD_DISPATCHES}
                  renderPreview={(entry) => (
                    <ChildTranscriptPreviewFrame
                      label={entry.label}
                      status="finished"
                    >
                      <p className="tf:m-0 tf:p-4 tf:text-tf-label">
                        Preview specimen.
                      </p>
                    </ChildTranscriptPreviewFrame>
                  )}
                />
              }
            />
          </div>
        </Scene>
      </SubagentCurrentWorkContext.Provider>
    </SubagentDispatchesContext.Provider>
  );
}

// --- coworker requests -------------------------------------------------------------

/** A coworker paused for an action only the member's browser can run:
 *  the row names what the browser is doing for it (the execution inbox's
 *  coworker entry, folded onto the ordinal), and a paused row the browser
 *  holds nothing for reads paused. */
const PAUSED_COWORKER_DISPATCHES: ReadonlyMap<number, ThreadDispatch> = new Map(
  [
    {
      ordinal: 0,
      label: "Refund order 41 through the billing API.",
      status: "paused" as const,
      error: null,
      child_session_id: "subagent-bench-paused-0",
      created_at: "2026-08-21T10:00:00Z",
      updated_at: "2026-08-21T10:00:00Z",
    },
    {
      ordinal: 1,
      label: "Cancel the duplicate subscription.",
      status: "paused" as const,
      error: null,
      child_session_id: "subagent-bench-paused-1",
      created_at: "2026-08-21T10:00:00Z",
      updated_at: "2026-08-21T10:00:00Z",
    },
  ].map((row) => [row.ordinal, row] as const),
);

function CoworkerRequestsScenario() {
  return (
    <SubagentDispatchesContext.Provider
      value={{ byOrdinal: PAUSED_COWORKER_DISPATCHES }}
    >
      <SubagentExecutionWorkContext.Provider
        value={
          new Map([
            [
              0,
              {
                toolName: "action__refund",
                status: "executing" as const,
                ok: null,
                via: "browser" as const,
              },
            ],
          ])
        }
      >
        <Scene title="Delegation — a coworker's action runs in your browser; another waits on you">
          <SubagentGroupRow
            row={{
              kind: "subagent-group",
              key: "scenario-coworker-requests",
              entries: [
                {
                  toolCallId: "t-cw0",
                  receipt: {
                    outcome: "launched",
                    ordinal: 0,
                    label: "Refund order 41 through the billing API.",
                    childSessionId: "subagent-bench-paused-0",
                    settled: null,
                  },
                  label: "Refund order 41 through the billing API.",
                  running: true,
                  failed: false,
                  cancelled: false,
                  note: null,
                },
                {
                  toolCallId: "t-cw1",
                  receipt: {
                    outcome: "launched",
                    ordinal: 1,
                    label: "Cancel the duplicate subscription.",
                    childSessionId: "subagent-bench-paused-1",
                    settled: null,
                  },
                  label: "Cancel the duplicate subscription.",
                  running: true,
                  failed: false,
                  cancelled: false,
                  note: null,
                },
              ],
            }}
          />
        </Scene>
      </SubagentExecutionWorkContext.Provider>
    </SubagentDispatchesContext.Provider>
  );
}

// --- notices ----------------------------------------------------------------------------------

const NOTICES_MESSAGES: Message[] = [
  { id: "u-n1", role: "user", content: "Remember that I prefer sencha." },
  toolCallMessage("a-n1", [
    {
      id: "t-mem",
      name: "add_memory",
      args: { note: "Casey prefers sencha at 80°C." },
    },
  ]),
  { id: "r-mem", role: "tool", toolCallId: "t-mem", content: "ok" },
  {
    id: "p-n1",
    role: "assistant",
    content: "Noted — I'll assume sencha at 80°C from here on.",
  },
];

const NOTICES_ANCHORS = anchorsWith({
  toolCallDisplayAnchors: new Map([
    [
      "t-mem",
      {
        progressText: "Saving a note to memory…",
        completeText: "Saved a note to memory",
        icon: "memory",
      },
    ],
  ]),
  // The memory footer: two writes from one run — the tool write and a
  // background-extraction save — attributed to the prose that run
  // authored, so the coalesced "Memory updated · 2 notes" trigger and
  // both destination labels render. The sentences are the wire's canned
  // register; content never rides the marker.
  memoryProvenanceAnchors: new Map([
    [
      "mem-n1",
      {
        memoryId: "mem-n1",
        scope: "user",
        summary: "Saved a note to memory.",
      },
    ],
    [
      "mem-n2",
      {
        memoryId: "mem-n2",
        scope: "org",
        summary: "Saved a note to memory.",
      },
    ],
  ]),
  memoryAttributionAnchors: new Map([
    ["mem-n1", "p-n1"],
    ["mem-n2", "p-n1"],
  ]),
  // The resume anchor stays as severance input only; the retry divider
  // and the voided-turn stamp rows this scenario used to pose went with
  // the meta-receipt deletion — the delivery divider below is the one
  // system-notice specimen left.
  resumeAnchors: new Map([["p-n1", { attempt: 2 }]]),
  // The completed background handoff: a delivery notice ahead
  // of the prose that answers it.
  subagentDeliveryAnchors: new Map([
    [
      "p-n1",
      [
        {
          ordinal: 0,
          label: "Check the descaling instructions.",
          succeeded: true,
        },
      ],
    ],
  ]),
});

function NoticesScenario() {
  return (
    <Scene title="Memory update and system notices">
      <MessageList
        rows={transcriptRowsOf(NOTICES_MESSAGES, NOTICES_ANCHORS, false)}
        cards={[]}
      />
    </Scene>
  );
}

// --- fallbacks -----------------------------------------------------------------------------------

const UNKNOWN_TOOL_CALL: ToolCallViewModel = {
  toolName: "acme__sync-inventory",
  state: "output-available",
  input: JSON.stringify({ warehouse: "adl-1", dry_run: false }, null, 2),
  output: JSON.stringify({
    synced: 42,
    skipped: [{ sku: "TEA-OOLONG-250", reason: "price drift" }],
    took_ms: 1834,
  }),
};

const LONG_IO_CALL: ToolCallViewModel = {
  toolName: "action__export-audit-log",
  state: "output-available",
  input: JSON.stringify(
    {
      range: { from: "2026-07-01", to: "2026-08-29" },
      filters: Array.from({ length: 12 }, (_, index) => ({
        field: `field_${String(index)}`,
        op: "eq",
        value: `value ${String(index)}`,
      })),
    },
    null,
    2,
  ),
  output: Array.from(
    { length: 80 },
    (_, line) =>
      `2026-08-${String((line % 28) + 1).padStart(2, "0")}T10:${String(line % 60).padStart(2, "0")}Z audit row ${String(line + 1)}`,
  ).join("\n"),
};

const LONG_TECHNICAL_PROSE = [
  "The export runs through the audit pipeline:",
  "",
  "```ts",
  "const rows = await auditLog.range(from, to);",
  'await exporter.write(rows, { format: "csv" });',
  "```",
  "",
  "Every row is verified against the retention policy before it leaves.",
].join("\n");

function FallbacksScenario() {
  return (
    <>
      <Scene title="Unknown customer tool — the safe fallback">
        <PosedOpenToolRow view={UNKNOWN_TOOL_CALL} />
      </Scene>
      <Scene title="Long technical input and output">
        <PosedOpenToolRow view={LONG_IO_CALL} />
      </Scene>
      <Scene title="Technical prose">
        <AssistantMarkdown>{LONG_TECHNICAL_PROSE}</AssistantMarkdown>
      </Scene>
    </>
  );
}

// --- host renderers ----------------------------------------------------------------

// Fictional trusted-host components — the bench standing in for a
// customer's compiled React (customer-neutral names; these are the
// seam's demonstration, not built-in business components). Each
// receives exactly ToolViewProps and styles itself with the public
// tf utility vocabulary — no package internals.

// The components hard-code their content: a bench stand-in owns its
// copy the way a customer's compiled React would (the call rides in
// props.call for hosts that want it — tool-views.md).
function AcmeMailReview({ context }: ToolViewProps) {
  return (
    // Its own box-sizing (inline, as a host's stylesheet would supply)
    // and an explicit border color: this view mounts inside
    // [data-tf-host-view], which the sheet's box-sizing/border-color
    // reset deliberately excludes (round-7 ruling 2) — a real host owns
    // both, so the stand-in must too, or it renders content-box with
    // currentColor borders.
    <div
      className="tf:rounded-md tf:border tf:border-tf-border tf:p-2 tf:text-xs"
      style={{ boxSizing: "border-box" }}
    >
      <p className="tf:font-medium">Re: Kettle whistles in B minor</p>
      <p className="tf:text-tf-muted-foreground">To: sam@acme.example</p>
      <p className="tf:mt-1">
        Thanks for the recording — that pitch usually means scale buildup.
        Descale, then retest.
      </p>
      <p className="tf:mt-1 tf:text-tf-muted-foreground">
        Rendered by the host · {context.themeMode} theme
      </p>
    </div>
  );
}

function AcmeLatencyReading() {
  return (
    <p className="tf:text-xs">
      <span className="tf:font-mono tf:font-medium">412 ms</span>{" "}
      <span className="tf:text-tf-muted-foreground">
        p95 checkout latency — within budget
      </span>
    </p>
  );
}

/** The bench's deliberately broken view: the slot must land the row on
 *  the rung below, never crash the scenario. */
function AcmeKaboom(): never {
  throw new Error("The bench's deliberately broken view threw.");
}

const SCENARIO_TOOL_VIEWS: ToolViewRegistry = {
  "acme.mail-review": { version: 1, view: reactToolView(AcmeMailReview) },
  "acme.checkout-latency": {
    version: 1,
    view: reactToolView(AcmeLatencyReading),
  },
  "acme.kaboom": { version: 1, view: reactToolView(AcmeKaboom) },
};

const MAIL_REVIEW_CALL: ToolCallViewModel = {
  toolName: "acme__draft-reply",
  state: "output-available",
  input: JSON.stringify({ thread: "thr_82" }, null, 2),
  output: JSON.stringify({
    subject: "Re: Kettle whistles in B minor",
    to: "sam@acme.example",
  }),
  display: {
    completeText: "Drafted a reply for the kettle thread",
    view: { key: "acme.mail-review", version: 1 },
  },
};

const LATENCY_CALL: ToolCallViewModel = {
  toolName: "acme__checkout-latency",
  state: "output-available",
  input: JSON.stringify({ window: "24h" }, null, 2),
  output: JSON.stringify({ p95_ms: 412 }),
  display: {
    completeText: "Checked checkout latency",
    view: { key: "acme.checkout-latency", version: 1 },
  },
};

/** The same key one contract version ahead of the registration: exact
 *  match or nothing, so the package default reading renders. */
const VERSION_DRIFT_CALL: ToolCallViewModel = {
  ...MAIL_REVIEW_CALL,
  display: {
    ...MAIL_REVIEW_CALL.display,
    view: { key: "acme.mail-review", version: 2 },
  },
};

const KABOOM_CALL: ToolCallViewModel = {
  ...LATENCY_CALL,
  toolName: "acme__kaboom",
  display: {
    completeText: "Ran the deliberately broken renderer",
    view: { key: "acme.kaboom", version: 1 },
  },
};

// The placement scene: two turns through the real fold layer. Turn 1's
// view-bearing call is settled — its fold is closed (the prose answer
// stays outside), the view ready inside for a member who opens it. Turn
// 2 is current: the mail-review fold settled and folded too, while the
// ticket fold is open because its pending decision awaits the member,
// the row wearing "Needs input". Narration splits the two calls into
// their own live folds, and the decision rides the SHIPPING shelf
// composition (no inline card).
const PLACEMENT_MESSAGES: Message[] = [
  { id: "u-pl1", role: "user", content: "Check checkout latency for me." },
  toolCallMessage("a-pl1", [
    {
      id: "t-pl-latency",
      name: "acme__checkout-latency",
      args: { window: "24h" },
    },
  ]),
  {
    id: "r-pl1",
    role: "tool",
    toolCallId: "t-pl-latency",
    content: '{"p95_ms":412}',
  },
  {
    id: "p-pl1",
    role: "assistant",
    content: "Latency is within budget — 412 ms at p95.",
  },
  {
    id: "u-pl2",
    role: "user",
    content: "Now draft the kettle reply and file the ticket.",
  },
  toolCallMessage("a-pl2", [
    { id: "t-pl-mail", name: "acme__draft-reply", args: { thread: "thr_82" } },
  ]),
  {
    id: "r-pl2",
    role: "tool",
    toolCallId: "t-pl-mail",
    content: '{"subject":"Re: Kettle whistles in B minor"}',
  },
  {
    id: "p-pl2",
    role: "assistant",
    content: "Here's the draft — filing the ticket next.",
  },
  toolCallMessage("a-pl3", [
    {
      id: "t-pl-ticket",
      name: "action__create-support-ticket",
      args: { path: "/tickets", title: "Kettle whistles in B minor" },
    },
  ]),
];

const PLACEMENT_ANCHORS = anchorsWith({
  toolCallDisplayAnchors: new Map([
    [
      "t-pl-latency",
      {
        completeText: "Checked checkout latency",
        view: { key: "acme.checkout-latency", version: 1 },
      },
    ],
    [
      "t-pl-mail",
      {
        completeText: "Drafted a reply for the kettle thread",
        view: { key: "acme.mail-review", version: 1 },
      },
    ],
  ]),
});

const PLACEMENT_APPROVAL: ApprovalCardModel = {
  ...CANNED_APPROVAL_CARD,
  interruptId: "scenario-placement-approval",
  toolCallId: "t-pl-ticket",
  anchored: true,
  toolArgs: {},
  toolInputSchema: null,
  toolOutputSchema: null,
};

function RenderersScenario() {
  return (
    <ToolViewRegistryContext.Provider value={SCENARIO_TOOL_VIEWS}>
      <Scene title="Custom detail — an email-like review object">
        <PosedOpenToolRow view={MAIL_REVIEW_CALL} />
      </Scene>
      <Scene title="Custom detail — a compact, non-card result">
        <PosedOpenToolRow view={LATENCY_CALL} />
      </Scene>
      <Scene title="Version drift — exact match or the package default">
        <PosedOpenToolRow view={VERSION_DRIFT_CALL} />
      </Scene>
      <Scene title="Throwing view — the slot lands on the package fallback">
        <PosedOpenToolRow view={KABOOM_CALL} />
      </Scene>
      <Scene title="Placement — an awaiting decision keeps its fold open; settled work folds">
        <ApprovalsContext.Provider
          value={{
            cards: [PLACEMENT_APPROVAL],
            submitDecision: () => Promise.resolve(),
          }}
        >
          <MessageList
            rows={transcriptRowsOf(PLACEMENT_MESSAGES, PLACEMENT_ANCHORS, true)}
            cards={[PLACEMENT_APPROVAL]}
            live
            decisionSurfacesInShelf
          />
        </ApprovalsContext.Provider>
      </Scene>
    </ToolViewRegistryContext.Provider>
  );
}

// --- built-ins (rung 3) ------------------------------------------------------
// The package-shipped views, resolved through the REAL default table —
// no registry provider on purpose: only the wire's reserved teaflask.*
// ref reaches rung 3, exactly as production resolves it.

const ACTION_OK_CALL: ToolCallViewModel = {
  toolName: "action__issue-refund",
  state: "output-available",
  input: JSON.stringify(
    {
      path_params: { order_id: "o_2041" },
      query: { notify: true },
      body: { amount_cents: 1200, reason: "arrived damaged" },
    },
    null,
    2,
  ),
  // The adapter's real shape: {status, body, truncated} — the wire's
  // optional headers field is never populated by any producer.
  output: JSON.stringify({
    ok: true,
    result: {
      status: 200,
      body: { refund_id: "re_881", amount_cents: 1200, state: "queued" },
      truncated: false,
    },
  }),
  display: {
    completeText: "Used “Issue a refund”",
    view: { key: "teaflask.action", version: 1 },
  },
};

const ACTION_NON_2XX_CALL: ToolCallViewModel = {
  ...ACTION_OK_CALL,
  output: JSON.stringify({
    ok: true,
    result: {
      status: 503,
      body: { error: "refund service unavailable" },
      truncated: false,
    },
  }),
};

const ACTION_TRUNCATED_CALL: ToolCallViewModel = {
  ...ACTION_OK_CALL,
  toolName: "action__export-orders",
  input: JSON.stringify({ query: { month: "2026-08" } }, null, 2),
  output: JSON.stringify({
    ok: true,
    result: {
      status: 200,
      body: "order_id,amount\no_1,1200\n…",
      truncated: true,
    },
  }),
  display: {
    completeText: "Used “Export orders”",
    view: { key: "teaflask.action", version: 1 },
  },
};

const COMMAND_BASH_CALL: ToolCallViewModel = {
  toolName: "sandbox_bash",
  state: "output-available",
  input: JSON.stringify({ command: "rg --files src | head -3" }, null, 2),
  output: JSON.stringify({
    output: "src/kettle.py\nsrc/steep.py\nsrc/pour.py\n",
    error: "",
  }),
  display: {
    completeText: "Ran a command in its workspace",
    icon: "terminal",
    view: { key: "teaflask.command", version: 1 },
  },
};

const COMMAND_DOCS_CALL: ToolCallViewModel = {
  toolName: "docs_filesystem",
  state: "output-available",
  input: JSON.stringify({ command: "ls guides/" }, null, 2),
  output: "steeping.md\nstorage.md\nkettles.md",
  display: {
    completeText: "Browsed your docs",
    icon: "file",
    view: { key: "teaflask.command", version: 1 },
  },
};

const FILE_EDIT_CALL: ToolCallViewModel = {
  toolName: "sandbox_file_editor",
  state: "output-available",
  input: JSON.stringify(
    {
      command: "str_replace",
      path: "/workspace/src/steep.py",
      old_str: "TEMPERATURE_C = 100\nSTEEP_MINUTES = 5",
      new_str: "TEMPERATURE_C = 80\nSTEEP_MINUTES = 2",
    },
    null,
    2,
  ),
  // The producer's whole str_replace sentence (vended file_editor's
  // _handle_str_replace): the first sentence, the embedded cat -n
  // snippet, and the closing instruction — an abridged output here
  // would purport to be producer output while being nobody's.
  output:
    "The file /workspace/src/steep.py has been edited. " +
    "Here's the result of running `cat -n` on a snippet of /workspace/src/steep.py:\n" +
    "     1  TEMPERATURE_C = 80\n     2  STEEP_MINUTES = 2\n" +
    "Review the changes and make sure they are as expected. Edit the file again if necessary.",
  display: {
    completeText: "Edited a file in its workspace",
    icon: "file",
    view: { key: "teaflask.file-edit", version: 1 },
  },
};

// A view is a pure read — the row copy claims no edit, and the view
// renders the neutral Contents pane over the recorded read. Output
// format is the producer's own: _make_output (vended file_editor)
// expands tabs to 8 spaces BEFORE numbering and joins a width-6
// right-aligned line number to the content with two spaces — a literal
// tab cannot appear in a real view result.
const FILE_VIEW_CALL: ToolCallViewModel = {
  toolName: "sandbox_file_editor",
  state: "output-available",
  input: JSON.stringify(
    {
      command: "view",
      path: "/workspace/src/steep.py",
    },
    null,
    2,
  ),
  output:
    "Here's the result of running `cat -n` on /workspace/src/steep.py:\n" +
    "     1  TEMPERATURE_C = 80\n     2  STEEP_MINUTES = 2\n",
  display: {
    completeText: "Read from its workspace",
    icon: "file",
    view: { key: "teaflask.file-edit", version: 1 },
  },
};

function BuiltInsScenario() {
  return (
    <>
      <Scene title="teaflask.action — a 2xx with a JSON body">
        <PosedOpenToolRow view={ACTION_OK_CALL} />
      </Scene>
      <Scene title="teaflask.action — a non-2xx wears its status honestly">
        <PosedOpenToolRow view={ACTION_NON_2XX_CALL} />
      </Scene>
      <Scene title="teaflask.action — a client-truncated body says so">
        <PosedOpenToolRow view={ACTION_TRUNCATED_CALL} />
      </Scene>
      <Scene title="teaflask.command — a workspace command and its output">
        <PosedOpenToolRow view={COMMAND_BASH_CALL} />
      </Scene>
      <Scene title="teaflask.command — a docs listing (plain-text shape)">
        <PosedOpenToolRow view={COMMAND_DOCS_CALL} />
      </Scene>
      <Scene title="teaflask.file-edit — the recorded edit as a diff">
        <PosedOpenToolRow view={FILE_EDIT_CALL} />
      </Scene>
      <Scene title="teaflask.file-edit — a view is a read, not an edit">
        <PosedOpenToolRow view={FILE_VIEW_CALL} />
      </Scene>
    </>
  );
}

// --- composer --------------------------------------------------------------------------------------

// Long enough to overflow the 420px column, so the transcript scrolls
// and TVC-120's jump-to-latest overlay has a scrollback to appear over.
const COMPOSER_MESSAGES: Message[] = [
  { id: "u-c1", role: "user", content: "How do I steep sencha?" },
  {
    id: "p-c1",
    role: "assistant",
    content:
      "Use 80°C water for two minutes, then decant completely. Boiling water is what makes it bitter.",
  },
  { id: "u-c2", role: "user", content: "And how should I store the leaves?" },
  {
    id: "p-c2",
    role: "assistant",
    content:
      "Away from light, heat, and moisture — an opaque, airtight tin in a cupboard. The fridge invites condensation every time the tin comes out, so room temperature wins for leaves you drink within a couple of months.",
  },
  { id: "u-c3", role: "user", content: "Does the kettle material matter?" },
  {
    id: "p-c3",
    role: "assistant",
    content:
      "Less than temperature control does. Any kettle that holds 80°C works; a gooseneck just makes the pour easier to place. Descale it on the documented interval and the taste stays clean.",
  },
];

function ComposerScenario() {
  return (
    <>
      <Scene title="The shipping composer — idle, under a settled transcript">
        <ConversationContext.Provider value={CANNED_COMPOSER}>
          {/* The transcript's own composition: list above, composer below.
              Fixed height so the pixel contract pins the seam between
              them. Inline style is sanctioned bench scaffolding. */}
          <div className="tf:flex tf:flex-col" style={{ height: 420 }}>
            <MessageList
              rows={transcriptRowsOf(COMPOSER_MESSAGES, EMPTY_ANCHORS, false)}
              cards={[]}
            />
            <Composer />
          </div>
        </ConversationContext.Provider>
      </Scene>
      <Scene title="The shipping composer — busy, the stop affordance showing">
        <ConversationContext.Provider value={CANNED_COMPOSER_BUSY}>
          <Composer />
        </ConversationContext.Provider>
      </Scene>
    </>
  );
}

// --- activity shelf ---------------------------------------------------------------------------------

// Long enough that the 420px column genuinely scrolls (TVC-123's
// precondition demands >100px of scrollback).
const ACTIVITY_SHELF_MESSAGES: Message[] = [
  ...COMPOSER_MESSAGES,
  { id: "u-s4", role: "user", content: "What about cold brewing?" },
  {
    id: "p-s4",
    role: "assistant",
    content:
      "Cold brew flatters sencha: 10g of leaf per litre, six hours in the fridge, and the low temperature never extracts the bitterness hot water can. Strain and drink within a day.",
  },
  { id: "u-s5", role: "user", content: "And a second steep?" },
  {
    id: "p-s5",
    role: "assistant",
    content:
      "Always. The second steep wants hotter water and a shorter wait — 85°C for thirty seconds — because the leaves are already open. Many drinkers prefer it to the first.",
  },
];

/** The fixture's suspension-slot placeholder tenant: a stand-in with
 *  the geometry of the decision surfaces — full measure, a hairline
 *  frame — so the slot contract is proven against something real. */
function SuspensionPlaceholder() {
  return (
    <div
      data-tf-shelf-item=""
      data-tf-suspension-placeholder=""
      className="tf:w-full tf:rounded-2xl tf:border tf:p-4"
    >
      <p className="tf:text-tf-label tf:text-tf-muted-foreground">
        Suspension-slot placeholder — an approval or question surface renders
        here on the full transcript/composer measure.
      </p>
    </div>
  );
}

/** TVC-125's resize stimulus: a fixture-only specimen tenant whose width
 *  the toggle changes mid-observation. A bench specimen on purpose (no
 *  shipping tenant plays this part — the shelf renders no run-state
 *  status line): the law is about the pill's roster card holding its
 *  position while a SIBLING shelf item resizes — any sibling exercises
 *  it. */
function SiblingSpecimen({ wide }: { wide: boolean }) {
  return (
    <span
      data-tf-shelf-item=""
      data-tf-sibling-specimen=""
      className="tf:flex tf:items-center tf:text-tf-label tf:text-tf-muted-foreground"
    >
      {wide ? "Bench specimen — the wide form" : "Bench specimen"}
    </span>
  );
}

function PopulatedShelfScene() {
  // The sibling-width toggle is TVC-125's stimulus: flipping it changes
  // the specimen tenant's width mid-observation, and the law asserts the
  // pill's roster card holds its position anyway (the stacked slot makes
  // every tenant's center the column's center, siblings notwithstanding).
  const [wideSibling, setWideSibling] = useState(true);
  return (
    <ConversationContext.Provider value={CANNED_COMPOSER_BUSY}>
      {/* The transcript's own composition: list above, shelf between,
          composer below. Fixed height so the geometry law measures
          the seam; live so the jump affordance wears the scroll-away
          treatment in scrollback. Inline style is sanctioned bench
          scaffolding. */}
      <div className="tf:flex tf:flex-col" style={{ height: 420 }}>
        <MessageList
          rows={transcriptRowsOf(ACTIVITY_SHELF_MESSAGES, EMPTY_ANCHORS, false)}
          cards={[]}
          live
        />
        <div data-tf-composer-anchor="" className="tf:relative">
          <ComposerActivityOverlay
            activity={
              <>
                <SiblingSpecimen wide={wideSibling} />
                <SubagentCountPill dispatches={CANNED_THREAD_DISPATCHES} />
              </>
            }
          />
          <ActivityShelf suspension={<SuspensionPlaceholder />} />
          <Composer />
        </div>
      </div>
      <button
        type="button"
        data-testid="toggle-sibling-width"
        onClick={() => {
          setWideSibling((value) => !value);
        }}
      >
        Toggle sibling width
      </button>
    </ConversationContext.Provider>
  );
}

/** The parked-on-subagents screen, rebuilt honestly: a run parked on
 *  subagents (status "parked", zero pending interrupts). Nothing may
 *  claim the member is blocking it — no wait label, no busy
 *  placeholder, no Stop, no actionable surface — while the honest
 *  signals stay: the group row and the pill. */
const PARKED_ON_SUBAGENTS_MESSAGES: Message[] = [
  {
    id: "park-u1",
    role: "user",
    content: "Audit the exports while I'm away.",
  },
  {
    id: "park-a1",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "park-t0",
        type: "function",
        function: {
          name: "dispatch_subagent",
          arguments: JSON.stringify({ task: "Audit the billing exports." }),
        },
      },
    ],
  },
  {
    id: "park-r0",
    role: "tool",
    toolCallId: "park-t0",
    content: JSON.stringify({
      outcome: "launched",
      ordinal: 0,
      label: "Audit the billing exports.",
      child_session_id: "subagent-park-0",
      settled: null,
    }),
  },
];

/** The parked scene's ledger matches its own transcript — one running
 *  child, no failures (round-1 design-review finding: reusing the bench
 *  ledger showed a "1 failed" pill segment the scene's transcript never
 *  explains). */
const PARKED_DISPATCHES: ReadonlyMap<number, ThreadDispatch> = new Map([
  [
    0,
    {
      ordinal: 0,
      label: "Audit the billing exports.",
      status: "dispatched",
      error: null,
      child_session_id: "subagent-park-0",
      created_at: "2026-08-21T10:00:00Z",
      updated_at: "2026-08-21T10:00:00Z",
    },
  ],
]);

function ActivityShelfScenario() {
  return (
    <>
      <Scene title="Populated shelf — suspension placeholder, sibling specimen, pill, busy composer">
        <PopulatedShelfScene />
      </Scene>
      <Scene title="Parked on subagents — the pill is the only signal; nothing claims the member">
        <ConversationContext.Provider value={CANNED_COMPOSER}>
          <div
            data-testid="parked-on-subagents"
            className="tf:flex tf:flex-col"
            style={{ height: 420 }}
          >
            <MessageList
              rows={transcriptRowsOf(
                PARKED_ON_SUBAGENTS_MESSAGES,
                EMPTY_ANCHORS,
                false,
              )}
              cards={[]}
            />
            <div data-tf-composer-anchor="" className="tf:relative">
              <ComposerActivityOverlay
                activity={<SubagentCountPill dispatches={PARKED_DISPATCHES} />}
              />
              <ActivityShelf />
              <Composer />
            </div>
          </div>
        </ConversationContext.Provider>
      </Scene>
      <Scene title="Empty shelf — collapses to nothing between transcript and composer">
        <ConversationContext.Provider value={CANNED_COMPOSER}>
          <div
            data-testid="empty-shelf"
            className="tf:flex tf:flex-col"
            style={{ height: 420 }}
          >
            <MessageList
              rows={transcriptRowsOf(COMPOSER_MESSAGES, EMPTY_ANCHORS, false)}
              cards={[]}
            />
            <div data-tf-composer-anchor="" className="tf:relative">
              <ActivityShelf />
              <Composer />
            </div>
          </div>
        </ConversationContext.Provider>
      </Scene>
    </>
  );
}

// --- suspensions ---------------------------------------------------------------

/** A settled exchange ABOVE the pending work: the compositions below are
 *  the ones the shrink re-follow and capture-clock laws (TVC-146,
 *  TVC-190) pose as "two overflowing lists and one content-fit", and the
 *  overflow has to be real — a paused transcript in the wild sits on
 *  history, and the compact request cards and collapsed settled folds
 *  no longer overflow a 760px column on the pending rows alone. */
const SETTLED_HISTORY_MESSAGES: Message[] = [
  {
    id: "hist-u1",
    role: "user",
    content: "Before that — which kettle docs went stale this quarter?",
  },
  {
    id: "hist-a1",
    role: "assistant",
    content:
      "Three of them. The descaling guide still quotes the 2024 vinegar " +
      "ratio, the travel-kettle FAQ answers a question about a model we " +
      "no longer sell, and the warranty page's contact block points at the " +
      "old ticket form.\n\nThe steeping guides are current — every " +
      "temperature and time matches the brew logs, so nothing there needs " +
      "a hand. I'd refresh the descaling ratio first; it is the one members " +
      "act on at the sink.",
  },
];

const SUSPENSION_MESSAGES: Message[] = [
  ...SETTLED_HISTORY_MESSAGES,
  {
    id: "sus-u1",
    role: "user",
    content: "Tidy the docs library and file the kettle ticket.",
  },
  {
    id: "sus-a1",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "sus-t1",
        type: "function",
        function: {
          name: "action__create-support-ticket",
          arguments: JSON.stringify({
            path: "/tickets",
            title: "Kettle whistles in B minor",
          }),
        },
      },
    ],
  },
  {
    id: "sus-a2",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "sus-t2",
        type: "function",
        function: {
          name: "action__delete-doc",
          arguments: JSON.stringify({ path_params: { doc_id: "doc_311" } }),
        },
      },
    ],
  },
];

const SUSPENSION_APPROVALS: ApprovalCardModel[] = [
  {
    ...CANNED_APPROVAL_CARD,
    interruptId: "sus-approve-ticket",
    toolCallId: "sus-t1",
    anchored: true,
  },
  {
    ...DESTRUCTIVE_CARD,
    interruptId: "sus-approve-delete",
    toolCallId: "sus-t2",
    anchored: true,
  },
];

const SUSPENSION_ASK: ElicitationCardModel = {
  ...CANNED_QUESTIONS_THREE,
  interruptId: "sus-ask",
  toolCallId: null,
  anchored: false,
};

/** The ticket call is backend-annotated for the ROW alone: authored
 *  progress copy and the file icon render on the transcript row. The
 *  banner reads none of it (there is no display join into the card:
 *  it renders neither icon nor argument summary). */
const SUSPENSION_ANCHORS: MarkerAnchorsSnapshot = {
  ...EMPTY_ANCHORS,
  toolCallDisplayAnchors: new Map([
    [
      "sus-t1",
      {
        progressText: "Filing the support ticket…",
        icon: "file",
      },
    ],
  ]),
};

/** The shipping decision composition: rows keep the compact chronology
 *  while the suspension tenant holds the queue above the busy composer —
 *  three pending decisions, so the "Decision n of N" pager shows. */
function SuspensionsScenario() {
  // running=false: the turn is PAUSED on the member (awaiting_input),
  // which is exactly when this composition exists — the rows wear the
  // ladder's pending arm, so a row and its queued card say the same
  // words and matching one to the other is reading, not fuzzy matching.
  const rows = transcriptRowsOf(SUSPENSION_MESSAGES, SUSPENSION_ANCHORS, false);
  const rowIndexByToolCallId = new Map<string, number>();
  rows.forEach((row, index) => {
    if (row.kind === "tool-call") {
      rowIndexByToolCallId.set(row.toolCallId, index);
    }
  });
  return (
    <ApprovalsContext.Provider
      value={{
        cards: SUSPENSION_APPROVALS,
        submitDecision: () => Promise.resolve(),
      }}
    >
      <ElicitationsContext.Provider
        value={{ ...NO_ELICITATIONS, cards: [SUSPENSION_ASK] }}
      >
        <Scene title="Three pending decisions — the queue holds the current one; rows keep the chronology">
          <ConversationContext.Provider value={CANNED_COMPOSER_BUSY}>
            <div className="tf:flex tf:flex-col" style={{ height: 760 }}>
              <MessageList
                rows={rows}
                cards={SUSPENSION_APPROVALS}
                decisionSurfacesInShelf
              />
              <ActivityShelf
                suspension={
                  <SuspensionSurfaces
                    rowIndexByToolCallId={rowIndexByToolCallId}
                  />
                }
              />
              <Composer />
            </div>
          </ConversationContext.Provider>
        </Scene>
      </ElicitationsContext.Provider>
    </ApprovalsContext.Provider>
  );
}

/** The settle-in-place specimen, interactive: Approve answers the queued
 *  card, and — decisions settling with no transcript receipt rows at all
 *  (TVC-062, the meta-receipt deletion's law) — no receipt line renders
 *  anywhere while the emptied suspension slot collapses. */
const SETTLE_MESSAGES: Message[] = [
  ...SETTLED_HISTORY_MESSAGES,
  { id: "settle-u1", role: "user", content: "File the kettle ticket." },
  {
    id: "settle-a1",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "settle-t1",
        type: "function",
        function: {
          name: "action__create-support-ticket",
          arguments: JSON.stringify({ path: "/tickets" }),
        },
      },
    ],
  },
];

function ApprovalSettlesInPlaceScene() {
  const [approved, setApproved] = useState<boolean | null>(null);
  const card: ApprovalCardModel = {
    ...CANNED_APPROVAL_CARD,
    interruptId: "settle-approve",
    toolCallId: "settle-t1",
    anchored: true,
    status:
      approved === null
        ? { kind: "actionable", errorSentence: null }
        : { kind: "answered", approved, trusted: false },
  };
  const rows = transcriptRowsOf(SETTLE_MESSAGES, EMPTY_ANCHORS, false);
  const rowIndexByToolCallId = new Map<string, number>();
  rows.forEach((row, index) => {
    if (row.kind === "tool-call") {
      rowIndexByToolCallId.set(row.toolCallId, index);
    }
  });
  return (
    <ApprovalsContext.Provider
      value={{
        cards: [card],
        submitDecision: (_card, decision) => {
          setApproved(decision.approved);
          return Promise.resolve();
        },
      }}
    >
      <ElicitationsContext.Provider value={NO_ELICITATIONS}>
        <Scene title="Approve settles in place — the card leaves, the slot collapses, no receipt renders">
          <ConversationContext.Provider value={CANNED_COMPOSER}>
            <div
              data-testid="settle-in-place"
              className="tf:flex tf:flex-col"
              style={{ height: 560 }}
            >
              <MessageList rows={rows} cards={[card]} decisionSurfacesInShelf />
              <ActivityShelf
                suspension={
                  <SuspensionSurfaces
                    rowIndexByToolCallId={rowIndexByToolCallId}
                  />
                }
              />
              <Composer />
            </div>
          </ConversationContext.Provider>
        </Scene>
      </ElicitationsContext.Provider>
    </ApprovalsContext.Provider>
  );
}

/** The loud fallback, as a specimen: the server names pending
 *  interrupts this client could build no card for. With no generic
 *  wait label, this alert is the ONE thing that may say the run waits
 *  — explicit, recoverable (Retry re-reads the REST truth), never
 *  silence. Posed over a populated paused transcript — the
 *  composition it ships in (over the empty state the bench would
 *  contradict itself: "mid-run, blocked" above "Where should we
 *  begin?"). */
function PendingDecisionGapScene() {
  return (
    <Scene title="Pending-decision gap — ids with no constructible card are loud, never silent">
      <ConversationContext.Provider value={CANNED_COMPOSER}>
        <div
          data-testid="pending-decision-gap-scene"
          className="tf:flex tf:flex-col"
          style={{ height: 420 }}
        >
          <PendingDecisionGapNotice onRetry={() => undefined} />
          {/* The pending call alone — this is the composition's one
              content-fit list (TVC-146 / TVC-190 pose it that way). */}
          <MessageList
            rows={transcriptRowsOf(
              SETTLE_MESSAGES.slice(SETTLED_HISTORY_MESSAGES.length),
              EMPTY_ANCHORS,
              false,
            )}
            cards={[]}
            decisionSurfacesInShelf
          />
          <ActivityShelf />
          <Composer />
        </div>
      </ConversationContext.Provider>
    </Scene>
  );
}

function CaptionsScenario() {
  // The model's own words as the label: one caption across running,
  // done, failed and interrupted; the shimmer or a quiet state word
  // carries the state.
  return (
    <Scene title="Model-written captions — one label, every state">
      <div className="tf:flex tf:flex-col">
        <ToolRow view={CAPTIONED_TOOL_CALL} />
        <ToolRow view={CAPTIONED_COMPLETED_TOOL_CALL} />
        <ToolRow view={CAPTIONED_FAILED_TOOL_CALL} />
        <ToolRow view={CAPTIONED_CANCELLED_TOOL_CALL} />
        <ToolRow view={{ ...CAPTIONED_TOOL_CALL, state: "denied" }} />
        <ToolRow view={{ ...CAPTIONED_TOOL_CALL, state: "superseded" }} />
      </div>
    </Scene>
  );
}

// --- the scenario page ------------------------------------------------------------------------------

const SCENARIOS: Record<ScenarioName, ReactNode> = {
  rhythm: <RhythmScenario />,
  interleaved: <InterleavedScenario />,
  operations: <OperationsScenario />,
  states: <StatesScenario />,
  approvals: <ApprovalsScenario />,
  elicitations: <ElicitationsScenario />,
  subagents: <SubagentsScenario />,
  "coworker-requests": <CoworkerRequestsScenario />,
  notices: <NoticesScenario />,
  fallbacks: <FallbacksScenario />,
  renderers: <RenderersScenario />,
  "built-ins": <BuiltInsScenario />,
  composer: <ComposerScenario />,
  "activity-shelf": <ActivityShelfScenario />,
  suspensions: (
    <>
      <SuspensionsScenario />
      <ApprovalSettlesInPlaceScene />
      <PendingDecisionGapScene />
    </>
  ),
  captions: <CaptionsScenario />,
};

export function ScenarioRoot({
  name,
  dark,
  reduceMotion,
}: {
  name: ScenarioName;
  dark: boolean;
  reduceMotion: boolean;
}) {
  // The readiness flag flips after two settled frames — the contract's
  // capture gate for scenarios without fenced code. `fallbacks` carries
  // one fenced block and gates additionally on its pre.shiki count
  // through openScenario's shikiBlocks option (contract §5) — TVC-040
  // is posed on `renderers`, so no automated test opens this scene, but
  // the gate stays for manual review and future consumers.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        setReady(true);
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);
  // Class discipline: only utilities the package sheet actually emits —
  // its @source scans src/components alone (index.html documents the
  // trap), so gap-6 is real and gap-8 would silently collapse to zero;
  // the base [data-tf-assistant] rule already supplies the font family.
  return (
    <div
      data-tf-assistant=""
      data-tf-theme={dark ? "dark" : "light"}
      {...(reduceMotion ? { "data-reduce-motion": "true" } : {})}
      data-testid="scenario-surface"
      className="tf:bg-tf-background tf:p-6 tf:text-tf-foreground"
    >
      <div
        data-testid="scenario"
        data-scenario-name={name}
        {...(ready ? { "data-scenario-ready": "true" } : {})}
        className="tf:mx-auto tf:flex tf:w-full tf:max-w-3xl tf:flex-col tf:gap-6"
      >
        {SCENARIOS[name]}
      </div>
    </div>
  );
}
