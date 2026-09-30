// The canned conversation both the gallery and (from C4 on) the mounted
// transcript bench render — one dataset so every variant is judged over
// identical content. Deterministic on purpose: the Playwright regression
// will screenshot exactly these states.

import type { Message } from "@ag-ui/core";

import type { ApprovalCardModel } from "../../src/core/approval-inbox";
import type { MarkerAnchorsSnapshot } from "../../src/core/connection-epoch";
import type { QuestionSetCardModel } from "../../src/core/elicitation-cards";
import type {
  ToolCallDisplay,
  ToolCallViewModel,
} from "../../src/core/tool-call-display";
import type { ReasoningRow } from "../../src/core/transcript-rows";
import type { ThreadDispatch } from "../../src/contract/dispatches";
import type { TurnAttachment } from "../../src/contract/threads";

export const USER_QUESTION = "How do I steep sencha without it going bitter?";

export const KITCHEN_SINK_MARKDOWN = `## Steeping sencha

Use **fresh** water at *80°C* — never boiling. The [full guide](https://example.com/guides/steeping) has photos, and \`chlorine\` is the enemy.

1. Warm the pot
2. Steep for \`2:00\`
3. Decant completely

| Tea | Temperature | Time |
| --- | --- | --- |
| Sencha | 80°C | 2 min |
| Gyokuro | 60°C | 2.5 min |
| Hojicha | 95°C | 30 s |

> Bitterness is a temperature problem, not a tea problem.

\`\`\`ts
const steep = (tea: string, seconds: number) =>
  new Promise((done) => setTimeout(done, seconds * 1000));

await steep("sencha", 120); // then decant completely
\`\`\`

That's the whole ritual.`;

const DOCS_SEARCH_RESULT =
  "[steeping#water] Water temperature\nUse 80°C for sencha; boiling water scalds the leaf.\n\n" +
  "[steeping#time] Steep time › Green teas\nTwo minutes, then decant completely.\n\n" +
  "[storage#light] Storing tea\nKeep leaves away from light and moisture.";

const DOCS_SEARCH_DISPLAY: ToolCallDisplay = {
  progressText: "Searching your docs for “steeping sencha”…",
  completeText: "Searched your docs for “steeping sencha” — 3 results",
};

/** A completed call WITH backend display text — the annotated register. */
export const COMPLETED_TOOL_CALL: ToolCallViewModel = {
  toolName: "docs_search",
  state: "output-available",
  input: JSON.stringify({ query: "steeping sencha" }, null, 2),
  output: DOCS_SEARCH_RESULT,
  display: DOCS_SEARCH_DISPLAY,
};

/** An in-flight call WITHOUT display text — the generic fallback ladder
 *  (humanized tool name + protocol state) that an unannotated backend
 *  tool gets. */
export const RUNNING_TOOL_CALL: ToolCallViewModel = {
  toolName: "action__create-support-ticket",
  state: "input-available",
  input: JSON.stringify(
    { path: "/tickets", title: "Kettle whistles in B minor" },
    null,
    2,
  ),
};

/** A captioned running call: the model's own words are the
 *  label, and they beat the backend's authored sentences in every state. */
export const CAPTIONED_TOOL_CALL: ToolCallViewModel = {
  toolName: "sandbox_bash",
  state: "input-available",
  input: JSON.stringify({ command: "which rg" }, null, 2),
  argsText: JSON.stringify({
    caption: "Checking for an existing install",
    command: "which rg",
  }),
  display: {
    caption: "Checking for an existing install",
    progressText: "Running a command in its workspace…",
    completeText: "Ran a command in its workspace",
    icon: "terminal",
  },
};

/** The same captioned call, completed: the caption alone, no tense change. */
export const CAPTIONED_COMPLETED_TOOL_CALL: ToolCallViewModel = {
  ...CAPTIONED_TOOL_CALL,
  state: "output-available",
  output: "/usr/bin/rg",
};

/** The same captioned call, failed: the caption with the quiet state word. */
export const CAPTIONED_FAILED_TOOL_CALL: ToolCallViewModel = {
  ...CAPTIONED_TOOL_CALL,
  state: "output-error",
  errorText: "The command timed out.",
  display: {
    ...CAPTIONED_TOOL_CALL.display,
    errorText: "The command did not finish.",
  },
};

/** The same captioned call, cancelled: the caption with the quiet state word. */
export const CAPTIONED_CANCELLED_TOOL_CALL: ToolCallViewModel = {
  ...CAPTIONED_TOOL_CALL,
  state: "cancelled",
};

/** A failed call — the error pane. */
export const FAILED_TOOL_CALL: ToolCallViewModel = {
  toolName: "navigate",
  state: "output-error",
  input: JSON.stringify({ path: "/guides/steeping" }, null, 2),
  errorText: "The page took too long to respond.",
};

/** A cancelled call — no Result pane, no display copy: the "Didn't run"
 *  register a stop or a steering decision settles as. A member's
 *  denial no longer settles here — it has its own register
 *  (DENIED_TOOL_CALL, below). */
export const CANCELLED_TOOL_CALL: ToolCallViewModel = {
  toolName: "action__cancel-subscription",
  state: "cancelled",
  input: JSON.stringify({ path: "/subscriptions/sub_42" }, null, 2),
};

/** A denied call — a member declined the approval: the "You
 *  didn't approve" register, a "Not approved" pill, no Result pane, no
 *  display copy. Its own tool so the state matrix judges the state, not
 *  a duplicate of the cancelled row's call. */
export const DENIED_TOOL_CALL: ToolCallViewModel = {
  toolName: "action__refund-order",
  state: "denied",
  input: JSON.stringify({ path: "/orders/ord_17/refund" }, null, 2),
};

/** A refused call — the door answered and declined: the
 *  "Didn't wait for subagents" register, a Declined pill, the door's own
 *  sentence as the reason line, no Result pane, no display copy. */
export const REFUSED_TOOL_CALL: ToolCallViewModel = {
  toolName: "wait_for_subagents",
  state: "refused",
  input: "{}",
  refusalText:
    "New subagent results have already arrived and are handed to you at your next step, so there is nothing to wait for and nothing to fetch. Finish this step, or do something else useful in the meantime.",
};

/** An offloaded call — settled, but the Result pane carries the
 *  quiet shortened-result line instead of the wire content (the context
 *  offloader's model-facing replacement, withheld by the view layer). */
export const OFFLOADED_TOOL_CALL: ToolCallViewModel = {
  toolName: "read_page",
  state: "output-available",
  input: JSON.stringify({ path: "/guides/steeping" }, null, 2),
  offloaded: true,
};

export const STREAMING_STATUS_LINE = "Reading your steeping guide…";

const REASONING_TEXT =
  "The member is fighting bitterness, and with sencha that is almost " +
  "always a temperature problem. Check the steeping guide in the docs " +
  "before answering so the numbers are theirs, not mine.";

/** The reasoning row mid-stream — auto-open, label under the shimmer. */
export const STREAMING_REASONING_ROW: ReasoningRow = {
  kind: "reasoning",
  key: "bench-reasoning-streaming",
  text: REASONING_TEXT,
  streaming: true,
};

/** The settled reasoning row — collapsed behind its static label. */
export const COMPLETED_REASONING_ROW: ReasoningRow = {
  kind: "reasoning",
  key: "bench-reasoning-done",
  text: REASONING_TEXT,
  streaming: false,
};

// --- the full-transcript flow (the owned message list end to end) -------------

export const CANNED_MESSAGES: Message[] = [
  { id: "u1", role: "user", content: USER_QUESTION },
  // The model reasons before its first move; settled here, so the flow
  // shows the collapsed "Thought about it" register above the answer.
  { id: "th1", role: "reasoning", content: REASONING_TEXT },
  {
    id: "a1",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "t1",
        type: "function",
        function: {
          name: "docs_search",
          arguments: JSON.stringify({ query: "steeping sencha" }),
        },
      },
    ],
  },
  {
    id: "r1",
    role: "tool",
    toolCallId: "t1",
    content:
      "[steeping#water] Water temperature\nUse 80°C for sencha; boiling water scalds the leaf.",
  },
  { id: "a2", role: "assistant", content: KITCHEN_SINK_MARKDOWN },
  {
    id: "a-cancel",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "t-cancel",
        type: "function",
        function: {
          name: "action__cancel-subscription",
          arguments: JSON.stringify({ path: "/subscriptions/sub_42" }),
        },
      },
    ],
  },
  {
    id: "r-cancel",
    role: "tool",
    toolCallId: "t-cancel",
    // The wire form a denied call settles as: the model-facing sentinel,
    // verbatim. The anchors' cancel set is what keeps it off the pane —
    // the bench must prove that, not sidestep it.
    content:
      "CONFIRMATION_FAILED: The assistant wants to cancel subscription sub_42.",
  },
  {
    id: "a-err",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "t-err",
        type: "function",
        function: {
          name: "navigate",
          arguments: JSON.stringify({ path: "/guides/steeping" }),
        },
      },
    ],
  },
  {
    id: "r-err",
    role: "tool",
    toolCallId: "t-err",
    // The wire form a failed client execution settles as: the serialized
    // tool-result/v1 envelope. The anchors map carries the human sentence.
    content: JSON.stringify({
      ok: false,
      error: {
        code: "execution_failed",
        message: "The page took too long to respond.",
      },
      instruction: "Read the error and explain the problem to the user.",
    }),
  },
  // A delegation moment: two dispatch calls in one turn fold into the
  // "Running N subagents" group — one coworker still working (launched
  // receipt), one that already settled failed with its note.
  {
    id: "a-dispatch",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "t-d0",
        type: "function",
        function: {
          name: "dispatch_subagent",
          arguments: JSON.stringify({
            task: "Survey the steeping guides for temperature claims.",
          }),
        },
      },
      {
        id: "t-d1",
        type: "function",
        function: {
          name: "dispatch_subagent",
          arguments: JSON.stringify({
            task: "Map every kettle model the docs mention.",
          }),
        },
      },
    ],
  },
  {
    id: "r-d0",
    role: "tool",
    toolCallId: "t-d0",
    content: JSON.stringify({
      outcome: "launched",
      ordinal: 0,
      label: "Survey the steeping guides for temperature claims.",
      child_session_id: "subagent-bench-0",
      settled: null,
    }),
  },
  {
    id: "r-d1",
    role: "tool",
    toolCallId: "t-d1",
    content: JSON.stringify({
      outcome: "already_settled",
      ordinal: 1,
      label: "Map every kettle model the docs mention.",
      child_session_id: "subagent-bench-1",
      settled: {
        status: "failed",
        note: "The coworker ran out of context before answering.",
      },
    }),
  },
  { id: "u2", role: "user", content: "File a ticket about my kettle too." },
  {
    id: "a3",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "t2",
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
];

export const CANNED_ANCHORS: MarkerAnchorsSnapshot = {
  // The resume anchor severs the prior attempt's open calls; no
  // divider row renders for it: that was a meta-receipt row.
  resumeAnchors: new Map([["a2", { attempt: 2 }]]),
  turnFailedAnchors: new Map(),
  toolRefusalAnchors: new Map(),
  toolErrorAnchors: new Map([["t-err", "The page took too long to respond."]]),
  toolCancelAnchors: new Set(["t-cancel"]),
  toolOffloadAnchors: new Set(),
  // The annotated register arrives exactly as production does: the
  // display anchored to the streamed call, never derived client-side.
  toolCallDisplayAnchors: new Map([["t1", DOCS_SEARCH_DISPLAY]]),
  toolSchemaAnchors: new Map(),
  subagentDeliveryAnchors: new Map(),
  // Server timing for the first work sequence only — th1 → t1 spans
  // 289s, so its settled fold reads "Worked for 4m 49s". The cancelled
  // and failed calls deliberately carry none: the bench keeps one
  // honest unknown-duration fold ("Worked · …") beside the measured
  // register, exactly the mixed old/new history production replays.
  blockTimingAnchors: new Map([
    ["th1", { startedAtMs: 1_756_400_000_000, settledAtMs: 1_756_400_008_000 }],
    ["t1", { startedAtMs: 1_756_400_008_000, settledAtMs: 1_756_400_289_000 }],
  ]),
  turnUsageAnchors: new Map(),
  memoryProvenanceAnchors: new Map(),
  memoryAttributionAnchors: new Map(),
};

/** Generic approval samples over varied request shapes. The generic card
 *  ignores these schemas; complete host overrides receive them unchanged. */
const TOGGLE_SCHEMA = {
  type: "object",
  properties: {
    path_params: {
      type: "object",
      properties: { subscription_id: { type: "string" } },
      additionalProperties: false,
    },
    body: {
      type: "object",
      properties: { auto_renew: { type: "boolean" } },
      additionalProperties: false,
    },
  },
  required: ["path_params", "body"],
  additionalProperties: false,
};

const REFUND_SCHEMA = {
  type: "object",
  properties: {
    path_params: {
      type: "object",
      properties: { payment_id: { type: "string" } },
      additionalProperties: false,
    },
    body: {
      type: "object",
      properties: { amount: { type: "number" }, reason: { type: "string" } },
      additionalProperties: false,
    },
  },
  required: ["path_params", "body"],
  additionalProperties: false,
};

const SEND_EMAIL_SCHEMA = {
  type: "object",
  properties: {
    body: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        message: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  required: ["body"],
  additionalProperties: false,
};

export const CANNED_BOOLEAN_APPROVAL_CARD: ApprovalCardModel = {
  interruptId: "bench-toggle",
  toolName: "action__update-subscription",
  toolArgs: {
    path_params: { subscription_id: "sub_842" },
    body: { auto_renew: false },
  },
  toolInputSchema: TOGGLE_SCHEMA,
  toolOutputSchema: null,
  prompt: "The assistant wants to turn off auto-renewal.",
  toolCallId: null,
  anchored: false,
  round: 0,
  runId: "bench-run",
  parked: false,
  gated: true,
  trustAvailable: false,
  asker: { kind: "assistant" },
  turnId: null,
  status: { kind: "actionable", errorSentence: null },
};

export const CANNED_REFUND_APPROVAL_CARD: ApprovalCardModel = {
  interruptId: "bench-diff",
  toolName: "action__issue-refund",
  toolArgs: {
    path_params: { payment_id: "pay_1097" },
    body: { amount: 12.5, reason: "Kettle arrived dented." },
  },
  toolInputSchema: REFUND_SCHEMA,
  toolOutputSchema: null,
  prompt: "The assistant wants to issue a refund.",
  toolCallId: null,
  anchored: false,
  round: 0,
  runId: "bench-run",
  parked: false,
  gated: false,
  trustAvailable: false,
  asker: { kind: "assistant" },
  turnId: null,
  status: { kind: "actionable", errorSentence: null },
};

export const CANNED_EMAIL_APPROVAL_CARD: ApprovalCardModel = {
  interruptId: "bench-entity",
  toolName: "action__send-email",
  toolArgs: {
    body: {
      to: "casey@brightloom.example",
      subject: "Your export is ready",
      message:
        "Hi Casey,\n\nThe workspace export you asked for finished this " +
        "morning and is ready to download from Settings → Exports.\n\n" +
        "The link stays live for seven days. If anything looks off, " +
        "reply here and we'll regenerate it.\n\n— The Brightloom team",
    },
  },
  toolInputSchema: SEND_EMAIL_SCHEMA,
  toolOutputSchema: null,
  prompt: "The assistant wants to send this email.",
  toolCallId: null,
  anchored: false,
  round: 0,
  runId: "bench-run",
  parked: false,
  gated: false,
  trustAvailable: false,
  asker: { kind: "assistant" },
  turnId: null,
  status: { kind: "actionable", errorSentence: null },
};

/** An answered generic approval keeps the same bounded request reading. */
export const CANNED_ANSWERED_APPROVAL_CARD: ApprovalCardModel = {
  ...CANNED_REFUND_APPROVAL_CARD,
  interruptId: "bench-diff-answered",
  status: { kind: "answered", approved: true, trusted: false },
};

/** A pending ask anchored to the in-flight action call (t2). */
export const CANNED_APPROVAL_CARD: ApprovalCardModel = {
  interruptId: "bench-ask",
  toolName: "action__create-support-ticket",
  toolArgs: {
    path: "/tickets",
    title: "Kettle whistles in B minor",
    body: { priority: "high", description: "Reproducible every morning." },
  },
  toolInputSchema: null,
  toolOutputSchema: null,
  prompt: "The assistant wants to create a support ticket.",
  toolCallId: "t2",
  anchored: true,
  round: 0,
  runId: "bench-run",
  parked: false,
  gated: false,
  trustAvailable: false,
  asker: { kind: "assistant" },
  turnId: null,
  status: { kind: "actionable", errorSentence: null },
};

/** Attachment chips on a user message. Rendered without a
 *  provider, so the image deliberately takes its chip fallback — the
 *  pixel contract pins the chips, not a network fetch. */
export const CANNED_ATTACHMENTS: TurnAttachment[] = [
  {
    id: "bench-att-1",
    kind: "image",
    format: "png",
    filename: "kettle-error.png",
    byte_size: 48_213,
  },
  {
    id: "bench-att-2",
    kind: "document",
    format: "pdf",
    filename: "kettle-manual.pdf",
    byte_size: 1_262_485,
  },
];

/** The thread's dispatch ledger: the join that settles the
 *  bench's delegation moment — one coworker still running, one settled
 *  failed — plus a third child the wire never showed (the ledger is the
 *  conversation-wide truth the pill and roster read). */
export const CANNED_THREAD_DISPATCHES: ReadonlyMap<number, ThreadDispatch> =
  new Map(
    [
      {
        ordinal: 0,
        label: "Survey the steeping guides for temperature claims.",
        status: "dispatched",
        error: null,
        child_session_id: "subagent-bench-0",
        created_at: "2026-08-21T10:00:00Z",
        updated_at: "2026-08-21T10:00:00Z",
      },
      {
        ordinal: 1,
        label: "Map every kettle model the docs mention.",
        status: "failed",
        error: "The coworker ran out of context before answering.",
        child_session_id: "subagent-bench-1",
        created_at: "2026-08-21T10:00:00Z",
        updated_at: "2026-08-21T10:00:41Z",
      },
      {
        ordinal: 2,
        label: "Check the descaling instructions for drift.",
        status: "succeeded",
        error: null,
        child_session_id: "subagent-bench-2",
        // The durable final summary: the settled receipt's clipped
        // excerpt of the child's recorded report — present exactly
        // on succeeded rows, so this is the roster's and the group
        // row's summary specimen.
        summary:
          "The interval and citric-acid ratio still match; the rinse step needs one wording correction.",
        created_at: "2026-08-21T10:00:00Z",
        updated_at: "2026-08-21T10:03:04Z",
      },
    ].map((dispatch) => [dispatch.ordinal, dispatch as ThreadDispatch]),
  );

/** The roster's scroll cap under load: 33 settled coworkers. */
export const CANNED_MANY_DISPATCHES: ReadonlyMap<number, ThreadDispatch> =
  new Map(
    Array.from({ length: 33 }, (_, ordinal) => {
      const dispatch: ThreadDispatch = {
        ordinal,
        label: `Audit doc ${String(ordinal + 1)} of the steeping corpus.`,
        status: "succeeded",
        error: null,
        child_session_id: `subagent-bench-bulk-${String(ordinal)}`,
        created_at: "2026-08-21T10:00:00Z",
        updated_at: "2026-08-21T10:01:12Z",
      };
      return [dispatch.ordinal, dispatch];
    }),
  );

// --- The question panel ------------------------------------------

/** One pending question SET: three questions, the second with (i)
 *  descriptions, the third open — the panel's reference anatomy. */
function questionSetOf(
  interruptId: string,
  overrides: Partial<QuestionSetCardModel> = {},
): QuestionSetCardModel {
  return {
    interruptId,
    runId: "bench-run",
    toolCallId: null,
    anchored: false,
    round: 0,
    status: "actionable",
    errorSentence: null,
    answered: null,
    questions: [
      {
        id: "fruit_q",
        heading: "Favorite fruit",
        prompt: "What's your favorite fruit?",
        options: [
          { text: "Mango", description: "Sweet, tropical, in season now" },
          { text: "Apple", description: null },
          { text: "Strawberry", description: null },
        ],
      },
      {
        id: "architecture_q",
        heading: "Docs architecture",
        prompt: "Which documentation architecture should we build?",
        options: [
          {
            text: "A flat reference site",
            description: "One page per public surface, generated from code.",
          },
          {
            text: "Task-based guides",
            description: "Written for the jobs people search for.",
          },
          {
            text: "A hybrid: concepts first, then generated reference",
            description: "The Vercel shape — a proposal, not an escape hatch.",
          },
        ],
      },
      {
        id: "deadline_q",
        heading: "Deadline",
        prompt: "When do you need the first cut?",
        options: [],
      },
    ],
    ...overrides,
  };
}

export const CANNED_QUESTIONS_THREE = questionSetOf("bench-questions-three");

export const CANNED_QUESTIONS_ANSWERED = questionSetOf(
  "bench-questions-answered",
  {
    status: "answered",
    answered: {
      kind: "answers",
      answers: [
        { id: "fruit_q", text: "Mango" },
        {
          id: "architecture_q",
          text:
            "None of these exactly — I want the Vercel-style architecture:\n\n" +
            "1. A “Getting started” track in 3 tiers.\n" +
            "2. Reference pages generated from the code.",
        },
        { id: "deadline_q", text: "2026-09-01" },
      ],
    },
  },
);

export const CANNED_QUESTIONS_CANCELLED = questionSetOf(
  "bench-questions-cancelled",
  { status: "answered", answered: { kind: "cancelled" } },
);

/** The abandoned set — the approval card's quiet expired register. */
export const CANNED_QUESTIONS_STALE = questionSetOf("bench-questions-stale", {
  status: "stale",
});
