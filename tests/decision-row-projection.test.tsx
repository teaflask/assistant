// @vitest-environment jsdom
// The compact chronology's settled states (narrowed by the meta-receipt
// deletion): in the shipping shelf composition (decisionSurfacesInShelf)
// a pending decision's row keeps only the "Needs input" chronology — the
// actionable card lives on the shelf — and a settled decision leaves NO
// transcript prose at all: the receipt lines, card-note lines, and stale
// sentences this suite used to pin were deleted as a product decision.
// Only an ANSWERED ask keeps a rendered settled form (its Q→A receipt —
// content, not meta-narration). Shelf-less hosts keep the inline card
// path untouched.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Message } from "@ag-ui/core";

import {
  APPROVED_NOTE,
  DENIED_NOTE,
  TRUSTED_NOTE,
} from "../src/components/approval-card";
import { ApprovalsContext } from "../src/components/approval-context";
import { ElicitationsContext } from "../src/components/elicitation-context";
import { MessageList } from "../src/components/message-list";
import type { MarkerAnchorsSnapshot } from "../src/core/connection-epoch";
import type {
  ApprovalCardModel,
  ApprovalCardStatus,
} from "../src/core/approval-inbox";
import type { ElicitationCardModel } from "../src/core/elicitation-cards";
import { suspensionQueueOf } from "../src/core/suspension-queue";
import { transcriptRowsOf } from "../src/core/transcript-rows";
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

const EMPTY_ANCHORS: MarkerAnchorsSnapshot = {
  resumeAnchors: new Map(),
  turnFailedAnchors: new Map(),
  subagentDeliveryAnchors: new Map(),
  toolRefusalAnchors: new Map(),
  toolErrorAnchors: new Map(),
  toolCancelAnchors: new Set(),
  toolOffloadAnchors: new Set(),
  toolCallDisplayAnchors: new Map(),
  toolSchemaAnchors: new Map(),
  blockTimingAnchors: new Map(),
  turnUsageAnchors: new Map(),
  memoryProvenanceAnchors: new Map(),
  memoryAttributionAnchors: new Map(),
};

const MESSAGES: Message[] = [
  { id: "u1", role: "user", content: "File the ticket." },
  {
    id: "a1",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "t1",
        type: "function",
        function: {
          name: "action__create-support-ticket",
          arguments: '{"path":"/tickets"}',
        },
      },
    ],
  },
];

function approvalOf(status: ApprovalCardStatus): ApprovalCardModel {
  return {
    interruptId: "i-1",
    toolName: "action__create-support-ticket",
    toolArgs: { path: "/tickets" },
    toolInputSchema: null,
    toolOutputSchema: null,
    prompt: "The assistant wants to create a support ticket.",
    toolCallId: "t1",
    anchored: true,
    round: 0,
    runId: "run-1",
    parked: false,
    gated: false,
    trustAvailable: false,
    asker: { kind: "assistant" },
    turnId: null,
    status,
  };
}

const ANSWERED_ASK: ElicitationCardModel = {
  interruptId: "e-1",
  runId: "run-1",
  toolCallId: "t1",
  anchored: true,
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
  status: "answered",
  errorSentence: null,
  answered: {
    kind: "answers",
    answers: [{ id: "plan", text: "The annual one." }],
  },
};

// A question set settled by this tab: its own answers, or the
// dismissal — the same meta-receipt rule applies to both.
const ANSWERED_SET: ElicitationCardModel = {
  interruptId: "e-set",
  runId: "run-1",
  toolCallId: null,
  anchored: false,
  round: 0,
  status: "answered",
  errorSentence: null,
  questions: [
    {
      id: "plan",
      heading: "Plan",
      prompt: "Which plan?",
      options: [{ text: "Annual", description: null }],
    },
  ],
  answered: { kind: "answers", answers: [{ id: "plan", text: "Annual" }] },
};

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

function render(
  cards: readonly ApprovalCardModel[],
  {
    elicitations = [] as readonly ElicitationCardModel[],
    anchors = EMPTY_ANCHORS,
    inShelf = true,
  } = {},
) {
  act(() => {
    root.render(
      <ApprovalsContext.Provider
        value={{ cards, submitDecision: () => Promise.resolve() }}
      >
        <ElicitationsContext.Provider
          value={{
            cards: elicitations,
            submitQuestionAnswers: () => Promise.resolve(),
            cancelQuestionSet: () => Promise.resolve(),
            drafts: new QuestionDraftStore(),
          }}
        >
          <MessageList
            rows={transcriptRowsOf(MESSAGES, anchors, false)}
            cards={cards}
            decisionSurfacesInShelf={inShelf}
          />
        </ElicitationsContext.Provider>
      </ApprovalsContext.Provider>,
    );
  });
}

describe("the shelf composition's row projection", () => {
  it("a pending decision's row keeps only the chronology — the controls live on the shelf", () => {
    render([approvalOf({ kind: "actionable", errorSentence: null })]);
    expect(host.querySelector("[data-tf-approval-card]")).toBeNull();
    expect(
      [...host.querySelectorAll("button")].some(
        (button) => button.textContent.trim() === "Approve",
      ),
    ).toBe(false);
    // The row still says it is the one waiting (TVC-036's predicate).
    expect(host.querySelector("[data-tf-state-pill]")?.textContent).toBe(
      "Needs input",
    );
  });

  it("an answered approval leaves no settled prose in the transcript", () => {
    // The DELETION PIN for the approval half of the meta-receipt class:
    // the card-note lines (GroupSettledDecisionLines / the tail lines)
    // and the receipt sentences are gone. The outcome's surfaces are the
    // card's own footer (a different mount) and the row's state — the
    // transcript itself stays quiet. This is the test that goes red if
    // anyone renders "Request approved/denied" or a card note back into
    // a row.
    render([approvalOf({ kind: "answered", approved: true, trusted: false })]);
    expect(host.textContent).not.toContain(APPROVED_NOTE);
    render([approvalOf({ kind: "answered", approved: true, trusted: true })]);
    expect(host.textContent).not.toContain(TRUSTED_NOTE);
    render([approvalOf({ kind: "answered", approved: false, trusted: false })]);
    expect(host.textContent).not.toContain(DENIED_NOTE);
    expect(host.textContent).not.toContain("Request approved");
    expect(host.textContent).not.toContain("Request denied");
    expect(host.querySelector("[data-tf-approval-card]")).toBeNull();
  });

  it("an answered ask with a rendered row waits for the row's own result — no transient card-only statement", () => {
    // The Q→A receipt renders from the ROW once its tool
    // result carries the settled answer (the fold-escape path,
    // ToolCallRows). The transient statement GroupSettledDecisionLines
    // used to render in the window before that result lands was deleted
    // with the meta-receipt class — an accepted loss. Here the row's result
    // carries no answer, so nothing renders: no card, no prompt, no answer.
    render([], { elicitations: [ANSWERED_ASK] });
    expect(host.querySelector("[data-tf-elicitation-card]")).toBeNull();
    expect(host.textContent).not.toContain("Which plan?");
    expect(host.textContent).not.toContain("The annual one.");
  });

  it("a stale ask leaves no settled prose in the transcript", () => {
    // The stale-ask half of the deletion pin: the withdrawn/expired
    // sentence renders only on the inline card (shelf-less hosts), never
    // as a transcript row.
    render([], { elicitations: [{ ...ANSWERED_ASK, status: "stale" }] });
    expect(host.textContent).not.toContain(
      "These questions were already answered or expired.",
    );
  });

  it("a cancelled or stale question set leaves no settled prose in the transcript; only an ANSWERED set keeps its Q→A receipt", async () => {
    // The dismissal is a decision with no answers: no dismissed sentence,
    // no panel, no receipt — the row's own state and (in shelf-less
    // hosts) the panel's footer are its surfaces.
    render([], {
      elicitations: [
        { ...ANSWERED_SET, answered: { kind: "cancelled" as const } },
      ],
    });
    expect(host.textContent).not.toContain("dismissed");
    expect(host.querySelector("[data-tf-question-panel]")).toBeNull();
    expect(host.querySelector("[data-tf-questions-receipt]")).toBeNull();
    render([], { elicitations: [{ ...ANSWERED_SET, status: "stale" }] });
    expect(host.textContent).not.toContain("already answered or expired");
    expect(host.querySelector("[data-tf-question-panel]")).toBeNull();
    // The kept content: an answered set whose call never rendered a row
    // states its questions and answers at the tail.
    render([], { elicitations: [ANSWERED_SET] });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector("[data-tf-questions-receipt]")).not.toBeNull();
    expect(host.textContent).toContain("Which plan?");
    expect(host.textContent).toContain("Annual");
  });

  it("the queue and the row's 'Needs input' pill judge the same statuses — one predicate, two consumers", () => {
    // Round-1 finding: the queue must never disagree with the pill (a
    // row saying "Needs input" with no surface anywhere in the slot, or
    // the reverse). Both sides read the ONE shared spelling in
    // core/suspension-queue.ts; this sweeps every status per family and
    // pins the agreement itself. (The placement HOLDS ride the durable
    // decision anchor, not this projection — a hold ends with the turn,
    // not the decision.)
    const approvalStatuses: ApprovalCardStatus[] = [
      { kind: "actionable", errorSentence: null },
      { kind: "submitting" },
      { kind: "answered", approved: true, trusted: false },
      { kind: "stale" },
    ];
    for (const status of approvalStatuses) {
      const card = approvalOf(status);
      render([card]);
      const pillSaysWaiting =
        host.querySelector("[data-tf-state-pill]")?.textContent ===
        "Needs input";
      const queued = suspensionQueueOf([card], [], new Map()).length > 0;
      expect(queued, `approval status ${status.kind}`).toBe(pillSaysWaiting);
    }
    const askStatuses = [
      "actionable",
      "submitting",
      "answered",
      "stale",
    ] as const;
    for (const status of askStatuses) {
      const ask = { ...ANSWERED_ASK, status };
      render([], { elicitations: [ask] });
      const pillSaysWaiting =
        host.querySelector("[data-tf-state-pill]")?.textContent ===
        "Needs input";
      const queued = suspensionQueueOf([], [ask], new Map()).length > 0;
      expect(queued, `ask status ${status}`).toBe(pillSaysWaiting);
    }
  });

  it("a stale approval leaves no settled prose in the transcript — orphan or anchored", () => {
    render([{ ...approvalOf({ kind: "stale" }), anchored: false }]);
    expect(host.textContent).not.toContain(
      "This request was already answered or expired.",
    );
  });

  it("a snapshot-replay orphan's pending state still marks its row as waiting", () => {
    render([
      {
        ...approvalOf({ kind: "actionable", errorSentence: null }),
        anchored: false,
      },
    ]);
    expect(host.querySelector("[data-tf-state-pill]")?.textContent).toBe(
      "Needs input",
    );
  });

  it("an unrowed settled decision leaves no tail prose either", () => {
    // The old tail lines (a wire that never named a tool_call_id, a
    // history whose call never reached the messages) are gone with the
    // rest of the class — stale and answered alike.
    render([
      { ...approvalOf({ kind: "stale" }), anchored: false, toolCallId: null },
    ]);
    expect(host.textContent).not.toContain(
      "This request was already answered or expired.",
    );
    render([
      {
        ...approvalOf({ kind: "answered", approved: true, trusted: false }),
        anchored: false,
        toolCallId: null,
      },
    ]);
    expect(host.textContent).not.toContain(APPROVED_NOTE);
  });

  it("an answered ask with no rendered row keeps its quiet receipt at the tail", async () => {
    render([], {
      elicitations: [{ ...ANSWERED_ASK, anchored: false, toolCallId: null }],
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Which plan?");
    expect(host.textContent).toContain("The annual one.");
  });

  it("shelf-less hosts keep the inline card path — the bench and probes are untouched", () => {
    render([approvalOf({ kind: "actionable", errorSentence: null })], {
      inShelf: false,
    });
    expect(host.querySelector("[data-tf-approval-card]")).not.toBeNull();
    expect(
      [...host.querySelectorAll("button")].some(
        (button) => button.textContent.trim() === "Approve",
      ),
    ).toBe(true);
  });
});
