// @vitest-environment jsdom
// The DOM-layer laws of the transcript visual contract: fold behavior,
// semantic-view-before-payload, state-on-the-operation, receipts, and
// reduced motion — rendered through the real components over the
// fixture bench's canned content (no testing library; the package's
// raw createRoot + act idiom). Law text:
// docs/transcript-visual-contract.md.

import { readFileSync } from "node:fs";
import path from "node:path";

import type { Message } from "@ag-ui/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CANCELLED_TOOL_CALL,
  CANNED_ANCHORS,
  DENIED_TOOL_CALL,
  REFUSED_TOOL_CALL,
  CANNED_APPROVAL_CARD,
  CANNED_QUESTIONS_STALE,
  CANNED_QUESTIONS_THREE,
  CANNED_THREAD_DISPATCHES,
  COMPLETED_TOOL_CALL,
  FAILED_TOOL_CALL,
} from "../../fixtures/transcript/canned-data";
import type { SubagentGroupRow as SubagentGroupRowModel } from "../../src/core/subagent-rows";
import {
  ApprovalCard,
  APPROVED_NOTE,
  DENIED_NOTE,
} from "../../src/components/approval-card";
import { ApprovalsContext } from "../../src/components/approval-context";
import { reactToolView } from "../../src/components/react-tool-view";
import { ToolViewRegistryContext } from "../../src/components/tool-view-registry-context";
import { ChildTranscriptPreviewFrame } from "../../src/components/child-transcript";
import { QuestionPanel } from "../../src/components/question-panel";
import type { ElicitationCardModel } from "../../src/core/elicitation-cards";
import { ElicitationsContext } from "../../src/components/elicitation-context";
import { MessageList } from "../../src/components/message-list";
import { SubagentCountPill } from "../../src/components/subagent-count-pill";
import { SubagentCurrentWorkContext } from "../../src/components/subagent-current-work";
import {
  SubagentDispatchesContext,
  SubagentGroupRow,
} from "../../src/components/subagent-group-row";
import { SuspensionSurfaces } from "../../src/components/suspension-surfaces";
import { ToolRow } from "../../src/components/tool-row";
import {
  TOOL_CALL_ICONS,
  toolCallPresentationOf,
} from "../../src/core/tool-call-presentation";
import type { MarkerAnchorsSnapshot } from "../../src/core/connection-epoch";
import { transcriptRowsOf } from "../../src/core/transcript-rows";
import type { ToolCallViewModel } from "../../src/core/tool-call-display";
import type { ToolViewRegistry } from "../../src/core/tool-view";
import { QuestionDraftStore } from "../../src/core/question-drafts";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// MessageList's viewport (use-stick-to-bottom) observes element
// resizes; jsdom has no ResizeObserver, and these laws read structure.
class ResizeObserverStub {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
  ResizeObserverStub;

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
  // Unconditional spy cleanup: a law body that spies (TVC-115's
  // console.error) must not leave the stub installed for the rest of
  // the suite when its own assertions throw — exactly the failure case
  // this file exists to catch.
  vi.restoreAllMocks();
});

function render(node: React.ReactNode) {
  act(() => {
    root.render(node);
  });
}

/** For scenes that mount a registered tool view: the slot defers
 *  adapter mounts one microtask past the commit (tool-view-slot.tsx),
 *  so the flush must drain microtasks. */
async function renderAndSettle(node: React.ReactNode) {
  await act(async () => {
    root.render(node);
    await Promise.resolve();
  });
}

function mustFind<T extends Element>(
  selector: string,
  filter: (element: T) => boolean = () => true,
): T {
  const match = [...host.querySelectorAll<T>(selector)].find(filter);
  if (match === undefined) {
    throw new Error(`expected an element matching ${selector}`);
  }
  return match;
}

const STYLES = readFileSync(
  path.resolve(import.meta.dirname, "../../src/styles/styles.css"),
  "utf8",
);

/** One live call inside an activity group: user asks, the assistant is
 *  mid-operation. Adding the tool result settles the same group. */
const LIVE_MESSAGES: Message[] = [
  { id: "u1", role: "user", content: "Compare the steeping guides." },
  {
    id: "a1",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "t1",
        type: "function",
        function: { name: "docs_search", arguments: "{}" },
      },
    ],
  },
];
const SETTLED_MESSAGES: Message[] = [
  ...LIVE_MESSAGES,
  { id: "r1", role: "tool", toolCallId: "t1", content: "3 results" },
];

/** One turn interleaving narration and work (the episode shape):
 *  thinking, a call, an intermediate finding, a second call, the final
 *  response. */
const INTERLEAVED_MESSAGES: Message[] = [
  { id: "u-i", role: "user", content: "Compare the steeping guides." },
  { id: "th-i", role: "reasoning", content: "Check the guides first." },
  {
    id: "m-i1",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "t-i1",
        type: "function",
        function: { name: "docs_search", arguments: "{}" },
      },
    ],
  },
  { id: "r-i1", role: "tool", toolCallId: "t-i1", content: "3 guides" },
  { id: "p-i-mid", role: "assistant", content: "Found three guides so far." },
  {
    id: "m-i2",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "t-i2",
        type: "function",
        function: { name: "read_page", arguments: "{}" },
      },
    ],
  },
  { id: "r-i2", role: "tool", toolCallId: "t-i2", content: "the guide text" },
  { id: "p-i-final", role: "assistant", content: "They agree on 80°C." },
];

/** A turn that is only prose — the no-fold control (TVC-016). */
const PROSE_ONLY_MESSAGES: Message[] = [
  { id: "u-p", role: "user", content: "Hi." },
  {
    id: "p-p1",
    role: "assistant",
    content: "Hello! Ask me anything about tea.",
  },
];

/** Two delegated children over the canned ledger — one running, one
 *  settled failed — the subagent laws' shared specimen. */
const SUBAGENT_GROUP_MODEL: SubagentGroupRowModel = {
  kind: "subagent-group",
  key: "tvc-subagents",
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
};

/** The shipped spinner surface: a submitting approval renders the
 *  spinner beside its "Sending…" state text. */
const SUBMITTING_APPROVAL_CARD = {
  ...CANNED_APPROVAL_CARD,
  interruptId: "tvc-submitting",
  toolCallId: null,
  anchored: false,
  status: { kind: "submitting" as const },
};

function renderTranscript(messages: readonly Message[], running: boolean) {
  render(
    <MessageList
      rows={transcriptRowsOf(messages, CANNED_ANCHORS, running)}
      cards={[]}
      live={running}
    />,
  );
}

describe("law 2 — active and settled folds", () => {
  // A rung-2 (exact tool name) registration: mounting this registry
  // makes every docs_search / read_page call view-bearing, the
  // placement stimulus — no annotation needed.
  const viewFor = (name: string): ToolViewRegistry[string] => ({
    version: 1,
    view: {
      mount(container) {
        const line = document.createElement("p");
        line.textContent = `${name} reading`;
        container.appendChild(line);
        return { update: () => undefined, destroy: () => undefined };
      },
    },
  });
  const DOCS_SEARCH_VIEW: ToolViewRegistry = {
    docs_search: viewFor("docs_search"),
  };
  const READ_PAGE_VIEW: ToolViewRegistry = { read_page: viewFor("read_page") };
  function renderTranscriptWithViews(
    registry: ToolViewRegistry,
    messages: readonly Message[],
    running: boolean,
    turnOpen?: boolean,
  ) {
    render(
      <ToolViewRegistryContext.Provider value={registry}>
        <MessageList
          rows={transcriptRowsOf(messages, CANNED_ANCHORS, running)}
          cards={[]}
          live={running}
          {...(turnOpen === undefined ? {} : { turnOpen })}
        />
      </ToolViewRegistryContext.Provider>,
    );
  }

  it("TVC-010 the active fold's headline is one live work label: the generic Working… expanded (the default), the latest step's label when the member collapses it, never a settled duration", () => {
    renderTranscript(LIVE_MESSAGES, true);
    const details = mustFind<HTMLDetailsElement>(
      "[data-tf-activity-group] details",
    );
    const summary = mustFind<HTMLElement>("[data-tf-activity-group] summary");
    // Expanded — the default while working (TVC-014): the rail below
    // says what the steps are, so the headline goes generic. jsdom fires
    // no native toggle event for the mount-time attribute — dispatch it,
    // the way a browser would, to drive the DOM-backed disclosure mirror.
    expect(details.open).toBe(true);
    act(() => {
      details.dispatchEvent(new Event("toggle"));
    });
    const stepLabel = "Searching your docs for “steeping sencha”…";
    expect(summary.textContent).toContain("Working…");
    expect(summary.textContent).not.toContain(stepLabel);
    expect(summary.textContent).not.toContain("Worked");
    // Collapsed by the member: the latest step's own label — exactly the
    // words the step's row wears, so the anchored display envelope's
    // authored progress copy wins over the mechanical ladder frame here
    // too (CANNED_ANCHORS annotates t1).
    act(() => {
      details.open = false;
      details.dispatchEvent(new Event("toggle"));
    });
    expect(summary.textContent).toContain(stepLabel);
    expect(summary.textContent).not.toContain("Worked");
    // Re-expanding goes back to the generic reading.
    act(() => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    expect(summary.textContent).toContain("Working…");
  });

  it("TVC-014 the working fold is the expanded one: open while live or awaiting a decision, folded once its work settles, and the member's toggle outranks it", async () => {
    // The member's gesture, modelled on the browser's real ordering
    // (round-1 finding, 3/3): click; the microtask checkpoint where a
    // discrete React commit would land BEFORE the activation behaviour;
    // then the activation itself — a TOGGLE of the attribute's current
    // state, never an assignment. jsdom 30 runs its own activation
    // synchronously inside dispatchEvent (the wrong side of the
    // checkpoint), so it is suppressed with a one-shot preventDefault
    // and applied manually; jsdom queues the REAL toggle event off the
    // attribute change in a macrotask, drained before asserting (the
    // full reasoning: tests/message-list-activity-group.test.tsx).
    const activateAsMember = async (
      details: HTMLDetailsElement,
      summary: HTMLElement,
    ) => {
      summary.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
        },
        {
          once: true,
        },
      );
      await act(async () => {
        summary.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        await Promise.resolve();
      });
      await act(async () => {
        details.open = !details.open;
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };
    // Every render in this body rides the SAME provider-wrapped tree —
    // the element-identity assertions below (no remount across settling,
    // decay, unification) would be voided by a root-shape change. An
    // empty registry poses "no view resolved".
    const EMPTY_VIEWS: ToolViewRegistry = {};
    renderTranscriptWithViews(EMPTY_VIEWS, LIVE_MESSAGES, true);
    const liveFold = mustFind<HTMLDetailsElement>(
      "[data-tf-activity-group] details",
    );
    // The working section is the expanded one.
    expect(liveFold.open).toBe(true);
    // Settling releases the prop (true→undefined) on the SAME element —
    // no remount — and the finished section folds.
    renderTranscriptWithViews(EMPTY_VIEWS, SETTLED_MESSAGES, false);
    const settledFold = mustFind<HTMLDetailsElement>(
      "[data-tf-activity-group] details",
    );
    expect(settledFold).toBe(liveFold);
    expect(settledFold.open).toBe(false);
    // A resolved view holds the ROW, never the fold: settled work folds
    // whether or not a member resolved a view.
    renderTranscriptWithViews(DOCS_SEARCH_VIEW, SETTLED_MESSAGES, false);
    const rerenderedFold = mustFind<HTMLDetailsElement>(
      "[data-tf-activity-group] details",
    );
    expect(rerenderedFold).toBe(settledFold);
    expect(rerenderedFold.open).toBe(false);
    // The member's toggle outranks the default, permanently for the
    // fold: an explicit expand (a click on the fold's own summary arms
    // the pin) survives a later user turn.
    const foldSummary = mustFind<HTMLElement>(
      "[data-tf-activity-group] summary",
    );
    await activateAsMember(rerenderedFold, foldSummary);
    expect(rerenderedFold.open).toBe(true);
    renderTranscriptWithViews(
      DOCS_SEARCH_VIEW,
      [...SETTLED_MESSAGES, { id: "u2", role: "user", content: "Thanks!" }],
      false,
    );
    const decayedFold = mustFind<HTMLDetailsElement>(
      "[data-tf-activity-group] details",
    );
    expect(decayedFold).toBe(rerenderedFold);
    expect(decayedFold.open).toBe(true);
    // …and the pin releases to native, never latches: one more
    // activation collapses it, and a live re-render never re-opens it.
    await activateAsMember(decayedFold, foldSummary);
    expect(decayedFold.open).toBe(false);
    renderTranscriptWithViews(DOCS_SEARCH_VIEW, LIVE_MESSAGES, true);
    expect(decayedFold.open).toBe(false);
    // The multi-cluster narrowing: preservation holds for the folds that
    // SURVIVE episode unification. The first cluster's <details> is the
    // settled episode's (same key — TVC-084), so its open state outlives
    // the merge; a later cluster merged into it does not keep a disclosure
    // of its own — whatever views its rows resolve.
    renderTranscriptWithViews(EMPTY_VIEWS, INTERLEAVED_MESSAGES, false, true);
    const openFolds = [
      ...host.querySelectorAll<HTMLDetailsElement>(
        "[data-tf-activity-group] > details",
      ),
    ];
    expect(openFolds).toHaveLength(2);
    const survivor = openFolds[0];
    survivor.open = true;
    renderTranscriptWithViews(EMPTY_VIEWS, INTERLEAVED_MESSAGES, false, false);
    const unified = mustFind<HTMLDetailsElement>(
      "[data-tf-activity-group] > details",
    );
    expect(unified).toBe(survivor);
    expect(unified.open).toBe(true);
    // The same merge under a registry that gives the second cluster's
    // call (read_page) a view: the second <details> does not survive
    // the settle either; its row now sits as a step inside the
    // surviving fold, its view slot intact.
    renderTranscriptWithViews(
      READ_PAGE_VIEW,
      INTERLEAVED_MESSAGES,
      false,
      true,
    );
    const liveClusters = [
      ...host.querySelectorAll<HTMLDetailsElement>(
        "[data-tf-activity-group] > details",
      ),
    ];
    expect(liveClusters).toHaveLength(2);
    const firstCluster = liveClusters[0];
    renderTranscriptWithViews(
      READ_PAGE_VIEW,
      INTERLEAVED_MESSAGES,
      false,
      false,
    );
    const settledClusters = [
      ...host.querySelectorAll<HTMLDetailsElement>(
        "[data-tf-activity-group] > details",
      ),
    ];
    expect(settledClusters).toHaveLength(1);
    expect(settledClusters[0]).toBe(firstCluster);
    expect(
      firstCluster.querySelector(
        '[data-tf-tool-call-id="t-i2"] [data-tf-tool-view="read_page"]',
      ),
    ).not.toBeNull();
  });

  it("TVC-011 a settled fold's headline carries no step count", () => {
    // The settled label is the duration register ("Worked for …"),
    // never a step count. Counting records is implementation
    // telemetry; elapsed time is the member-relevant cost. Both halves
    // are asserted — the duration grammar's presence anchors the
    // step-count absence, so an empty label can't green this law.
    renderTranscript(SETTLED_MESSAGES, false);
    const summary = mustFind<HTMLElement>("[data-tf-activity-group] summary");
    expect(summary.textContent).toMatch(/Worked for /);
    expect(summary.textContent).not.toMatch(/\d+\s+steps?\b/);
    // A settled fold the member opened wears the same settled register:
    // the duration, never a step count — the wording holds regardless of
    // disclosure state.
    renderTranscriptWithViews(DOCS_SEARCH_VIEW, SETTLED_MESSAGES, false);
    const heldOpenFold = mustFind<HTMLDetailsElement>(
      "[data-tf-activity-group] details",
    );
    expect(heldOpenFold.open).toBe(false);
    act(() => {
      heldOpenFold.open = true;
      heldOpenFold.dispatchEvent(new Event("toggle"));
    });
    const heldOpenSummary = mustFind<HTMLElement>(
      "[data-tf-activity-group] summary",
    );
    expect(heldOpenSummary.textContent).toMatch(/Worked for /);
    expect(heldOpenSummary.textContent).not.toMatch(/\d+\s+steps?\b/);
  });

  it("TVC-013 the active fold's motion is the one shared shimmer; a settled fold carries none", () => {
    // THE shimmer primitive is what every active-text surface uses. The
    // active fold's only motion markup must be that primitive; the
    // settled fold must carry no motion markup at all.
    renderTranscript(LIVE_MESSAGES, true);
    const activeSummary = mustFind<HTMLElement>(
      "[data-tf-activity-group] summary",
    );
    expect(
      activeSummary.querySelector("[data-tf-shimmer-text]"),
    ).not.toBeNull();
    renderTranscript(SETTLED_MESSAGES, false);
    const settledSummary = mustFind<HTMLElement>(
      "[data-tf-activity-group] summary",
    );
    expect(settledSummary.querySelector("[data-tf-shimmer-text]")).toBeNull();
    expect(settledSummary.querySelector("[class*='animate-']")).toBeNull();
  });

  it("TVC-015 a completed turn's interleaved work unifies into one episode fold whatever views its rows resolve — chronology preserved; an open turn keeps the per-cluster folding", () => {
    // The settled render: one uninterrupted work span — thinking, a
    // call, an intermediate finding, another call — must be ONE fold.
    render(
      <MessageList
        rows={transcriptRowsOf(INTERLEAVED_MESSAGES, CANNED_ANCHORS, false)}
        cards={[]}
      />,
    );
    const groups = host.querySelectorAll("[data-tf-activity-group] > details");
    expect(groups).toHaveLength(1);
    // Chronology inside, in original order: the narration step sits
    // between the two calls, exactly where it was spoken.
    // Descendant selection: the rail wraps its steps in one content
    // child; steps never nest, so order is preserved.
    const steps = [
      ...mustFind<HTMLElement>("[data-tf-activity-rail]").querySelectorAll(
        "[data-tf-activity-step]",
      ),
    ];
    expect(
      steps.map((step) => step.textContent.includes("guides so far")),
    ).toEqual([false, false, true, false]);
    expect(steps[2]?.hasAttribute("data-tf-activity-narration")).toBe(true);
    // The open turn (still non-terminal): the same rows keep the live
    // interleaved shape — two folds, the finding a top-level row.
    render(
      <MessageList
        rows={transcriptRowsOf(INTERLEAVED_MESSAGES, CANNED_ANCHORS, false)}
        cards={[]}
        turnOpen
      />,
    );
    expect(
      host.querySelectorAll("[data-tf-activity-group] > details"),
    ).toHaveLength(2);
    expect(host.querySelector("[data-tf-activity-narration]")).toBeNull();
    // A cut-off turn (round 2): work past the span's last prose run
    // folds into its OWN trailing fold — the last words never merge
    // into a headline, and nothing narration-steps them either.
    render(
      <MessageList
        rows={transcriptRowsOf(
          INTERLEAVED_MESSAGES.slice(0, -1),
          CANNED_ANCHORS,
          false,
        )}
        cards={[]}
      />,
    );
    expect(
      host.querySelectorAll("[data-tf-activity-group] > details"),
    ).toHaveLength(2);
    expect(host.querySelector("[data-tf-activity-narration]")).toBeNull();
    // A registry giving the second cluster's call a view changes nothing
    // about the grouping: still one fold, the narration inside it, and
    // the view-bearing call a step inside the same fold with its view
    // slot — the view is inspected at its row, never by splitting the
    // episode.
    renderTranscriptWithViews(READ_PAGE_VIEW, INTERLEAVED_MESSAGES, false);
    const withViews = [
      ...host.querySelectorAll<HTMLElement>(
        "[data-tf-activity-group] > details",
      ),
    ];
    expect(withViews).toHaveLength(1);
    expect(
      withViews[0]?.querySelector("[data-tf-activity-narration]"),
    ).not.toBeNull();
    // The row's own headline places the call (the adapter's content
    // mounts a microtask later; the fold structure is this law's
    // subject).
    expect(withViews[0]?.textContent).toContain("Ran read page");
    expect(
      withViews[0]?.querySelector(
        '[data-tf-tool-call-id="t-i2"] [data-tf-tool-view="read_page"]',
      ),
    ).not.toBeNull();
  });

  it("TVC-016 the last prose run of each completed span stays outside any fold and a prose-only turn renders no fold", () => {
    render(
      <MessageList
        rows={transcriptRowsOf(INTERLEAVED_MESSAGES, CANNED_ANCHORS, false)}
        cards={[]}
      />,
    );
    // The final response is visible without expanding anything: its
    // markdown sits outside the (collapsed) group; the interior finding
    // does not leak a top-level copy.
    const group = mustFind<HTMLElement>("[data-tf-activity-group]");
    const topLevel = [...host.querySelectorAll("[data-tf-markdown]")].filter(
      (node) => !group.contains(node),
    );
    expect(topLevel).toHaveLength(1);
    expect(topLevel[0]?.textContent).toContain("They agree on 80°C.");
    // A cut-off span (round-2 finding 1): the last prose BEFORE severed
    // work stays outside too — a stopped/failed turn never renders zero
    // visible assistant text.
    render(
      <MessageList
        rows={transcriptRowsOf(
          INTERLEAVED_MESSAGES.slice(0, -1),
          CANNED_ANCHORS,
          false,
        )}
        cards={[]}
      />,
    );
    const cutGroups = [...host.querySelectorAll("[data-tf-activity-group]")];
    const cutTopLevel = [...host.querySelectorAll("[data-tf-markdown]")].filter(
      (node) => !cutGroups.some((groupNode) => groupNode.contains(node)),
    );
    expect(cutTopLevel).toHaveLength(1);
    expect(cutTopLevel[0]?.textContent).toContain("Found three guides so far.");
    // Position alone decides (never copy inspection): a turn with no
    // work rows renders NO fold — no empty "Worked" disclosure.
    render(
      <MessageList
        rows={transcriptRowsOf(PROSE_ONLY_MESSAGES, CANNED_ANCHORS, false)}
        cards={[]}
      />,
    );
    expect(host.querySelector("[data-tf-activity-group]")).toBeNull();
    expect(host.textContent).toContain("Hello! Ask me anything about tea.");
  });
});

describe("law 3 — a bounded reading, never a raw payload", () => {
  // TVC-020 (the semantic view precedes the raw payload disclosure) was
  // DELETED with the Technical details disclosure it pinned: no raw wire
  // pane renders in a tool row any more. The id stays retired.
  it("TVC-021 a settled untyped operation exposes only a bounded reading of its input behind a manual disclosure — no raw pane", () => {
    render(<ToolRow view={COMPLETED_TOOL_CALL} />);
    const row = mustFind<HTMLDetailsElement>("details");
    expect(row.open).toBe(false);
    expect(row.textContent).toContain("steeping sencha");
    expect(row.textContent).not.toContain("Water temperature");
    expect(
      row.querySelector("[data-tf-approval-request-summary]"),
    ).not.toBeNull();
    expect(row.querySelector("pre")).toBeNull();
    const summary = mustFind<HTMLElement>("summary");
    expect(summary.textContent).not.toContain("Water temperature");
  });

  it("TVC-022 an elicitation renders the human heading, question and suggestions, never the wire's ids and keys", () => {
    // The question set's panel: the human heading, question and
    // suggestions render; the wire's ids and keys never do.
    render(
      <ElicitationsContext.Provider
        value={{
          cards: [CANNED_QUESTIONS_THREE],
          submitQuestionAnswers: () => Promise.resolve(),
          cancelQuestionSet: () => Promise.resolve(),
          drafts: new QuestionDraftStore(),
        }}
      >
        <QuestionPanel card={CANNED_QUESTIONS_THREE} />
      </ElicitationsContext.Provider>,
    );
    expect(host.textContent).toContain("Favorite fruit");
    expect(host.textContent).toContain("What's your favorite fruit?");
    expect(host.textContent).toContain("Mango");
    expect(host.textContent).not.toContain('"id"');
    expect(host.textContent).not.toContain('"questions"');
    expect(host.textContent).not.toContain("fruit_q");
  });
});

describe("law 4 — state appears on the affected operation", () => {
  it("TVC-030 a failed operation's error renders inside that operation's own row", () => {
    render(<ToolRow view={FAILED_TOOL_CALL} />);
    const row = mustFind<HTMLDetailsElement>("details");
    // EVERY rendering of the failure sentence lives inside the row —
    // "never as a detached badge" would be satisfied vacuously by
    // checking only the first occurrence while a duplicate floated
    // outside.
    const errors = [...host.querySelectorAll("p")].filter(
      (element) => element.textContent === "The page took too long to respond.",
    );
    expect(errors).toHaveLength(1);
    for (const error of errors) {
      expect(row.contains(error)).toBe(true);
    }
  });

  it("TVC-032 the state mark derives from the protocol state alone — same state, different tools, same mark", () => {
    const markOf = (view: ToolCallViewModel): string => {
      render(<ToolRow view={view} />);
      const mark = mustFind<HTMLElement>("summary").firstElementChild;
      if (mark === null) {
        throw new Error("the row rendered no state mark");
      }
      return mark.outerHTML;
    };
    const annotatedDone = markOf(COMPLETED_TOOL_CALL);
    const unannotatedDone = markOf({
      toolName: "action__entirely-different-tool",
      state: "output-available",
      input: "{}",
      output: "done",
    });
    expect(unannotatedDone).toBe(annotatedDone);
    expect(markOf(FAILED_TOOL_CALL)).not.toBe(annotatedDone);
  });

  it("TVC-033 a cancelled operation's mark carries no destructive treatment; a failed operation's does", () => {
    // The mark must EXIST for its ink to be assertable — a missing mark
    // would satisfy a not-contains vacuously.
    const markClassOf = (view: ToolCallViewModel): string => {
      render(<ToolRow view={view} />);
      const mark = mustFind<HTMLElement>("summary").firstElementChild;
      if (mark === null) {
        throw new Error("the row rendered no state mark");
      }
      return mark.getAttribute("class") ?? "";
    };
    expect(markClassOf(CANCELLED_TOOL_CALL)).not.toContain("destructive");
    expect(markClassOf(FAILED_TOOL_CALL)).toContain("destructive");
  });

  it("TVC-034 a failed turn's terminal receipt is its own quiet row with no motion", () => {
    // The turn-level terminal state: the failure of the TURN — quota,
    // provider, transport — rendered where the answer broke off,
    // carrying the wire's own reader-aware sentence; never a detached
    // banner and never a spinning row. (A member's own stop projects no
    // row at all, so there is no sibling receipt to be distinct from.)
    const failedSentence =
      "Something went wrong while answering. Please try again.";
    const messages: Message[] = [
      { id: "u-f1", role: "user", content: "Compare every kettle." },
      { id: "p-f1", role: "assistant", content: "Starting with stovetop —" },
      { id: "u-f2", role: "user", content: "And travel kettles?" },
      { id: "p-f2", role: "assistant", content: "Gathering the models —" },
    ];
    const anchors = {
      ...CANNED_ANCHORS,
      resumeAnchors: new Map<string, unknown>(),
      turnFailedAnchors: new Map([
        ["p-f2", { before: [], after: [failedSentence] }],
      ]),
    };
    render(
      <MessageList
        rows={transcriptRowsOf(messages, anchors, false)}
        cards={[]}
      />,
    );
    const failedReceipt = mustFind<HTMLElement>(
      "[data-tf-turn-failed-receipt]",
    );
    expect(failedReceipt.textContent).toContain(failedSentence);
    // Its own row: the sentence never renders as assistant prose.
    expect(failedReceipt.closest("[data-tf-activity-step]")).toBeNull();
    // Calm: no shimmer, no animation utility anywhere in the receipt.
    expect(failedReceipt.querySelector("[data-tf-shimmer-text]")).toBeNull();
    expect(failedReceipt.querySelector("[class*='animate-']")).toBeNull();
  });

  it("TVC-036 a call paused for a decision wears an explicit awaiting-input signal on its own row", () => {
    // Awaiting input is a first-class state (contract §8): the decision
    // card below owns the controls, but the ROW must say in text that it
    // is the one waiting — never colour or a bare hold-open alone.
    const messages: Message[] = [
      { id: "u-w1", role: "user", content: "File the ticket." },
      {
        id: "a-w1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "t-waiting",
            type: "function",
            function: {
              name: "action__create-support-ticket",
              arguments: JSON.stringify({ path: "/tickets" }),
            },
          },
        ],
      },
    ];
    render(
      <ApprovalsContext.Provider
        value={{
          cards: [
            {
              ...CANNED_APPROVAL_CARD,
              toolCallId: "t-waiting",
              anchored: true,
            },
          ],
          submitDecision: () => Promise.resolve(),
        }}
      >
        <MessageList
          rows={transcriptRowsOf(messages, CANNED_ANCHORS, false)}
          cards={[
            {
              ...CANNED_APPROVAL_CARD,
              toolCallId: "t-waiting",
              anchored: true,
            },
          ]}
          live={false}
        />
      </ApprovalsContext.Provider>,
    );
    const pill = mustFind<HTMLElement>(
      "[data-tf-activity-step] summary [data-tf-state-pill]",
    );
    expect(pill.textContent).toBe("Needs input");
  });

  it("TVC-038 a refused operation reads as its own neutral declined state with the door's reason, and never counts as failed", () => {
    // The row: neutral mark and pill, the reason line in the quiet
    // register, no Error label, no Result pane for the envelope.
    render(<ToolRow view={REFUSED_TOOL_CALL} />);
    const mark = mustFind<HTMLElement>("summary").firstElementChild;
    if (mark === null) {
      throw new Error("the row rendered no state mark");
    }
    expect(mark.getAttribute("class") ?? "").not.toContain("destructive");
    const pill = mustFind<HTMLElement>("[data-tf-state-pill]");
    expect(pill.textContent).toBe("Declined");
    expect(pill.getAttribute("class") ?? "").not.toContain("destructive");
    expect(mustFind<HTMLElement>("summary").textContent).toContain(
      "Didn't wait for subagents",
    );
    expect(mustFind<HTMLElement>("[data-tf-refusal-reason]").textContent).toBe(
      REFUSED_TOOL_CALL.refusalText,
    );
    expect(host.textContent).not.toContain("Error:");
    expect(host.textContent).not.toContain("Result");
    act(() => {
      root.unmount();
    });
    root = createRoot(host);

    // The fold: the projected refused step counts under its own word,
    // never as failed, and in plain ink.
    const messages: Message[] = [
      { id: "u-r1", role: "user", content: "Wait for the coworkers." },
      {
        id: "a-r1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "t-refused",
            type: "function",
            function: { name: "wait_for_subagents", arguments: "{}" },
          },
        ],
      },
      {
        id: "r-r1",
        role: "tool",
        toolCallId: "t-refused",
        content: '{"ok": false, "refused": true, "error": {"message": "…"}}',
      },
      { id: "a-r2", role: "assistant", content: "Continuing meanwhile." },
    ];
    const anchors: MarkerAnchorsSnapshot = {
      ...CANNED_ANCHORS,
      toolRefusalAnchors: new Map([
        ["t-refused", REFUSED_TOOL_CALL.refusalText ?? ""],
      ]),
    };
    render(
      <MessageList
        rows={transcriptRowsOf(messages, anchors, false)}
        cards={[]}
        live={false}
      />,
    );
    const summary = mustFind<HTMLElement>("[data-tf-activity-group] summary");
    expect(summary.textContent).not.toContain("declined");
    expect(summary.textContent).not.toContain("failed");
    expect(summary.querySelector(".tf\\:text-tf-destructive")).toBeNull();
  });

  it("TVC-039 a call a member declined to approve reads as its own neutral not-approved state — distinct from cancelled and refused in pill and headline — and never counts as failed or interrupted", () => {
    // The row: neutral mark and pill, the member's own word and frame,
    // no Error label, no Result pane for the cancellation sentinel.
    render(<ToolRow view={DENIED_TOOL_CALL} />);
    const mark = mustFind<HTMLElement>("summary").firstElementChild;
    if (mark === null) {
      throw new Error("the row rendered no state mark");
    }
    expect(mark.getAttribute("class") ?? "").not.toContain("destructive");
    expect(mark.getAttribute("data-tf-op-state")).toBe("denied");
    const pill = mustFind<HTMLElement>("[data-tf-state-pill]");
    expect(pill.textContent).toBe("Not approved");
    expect(pill.getAttribute("class") ?? "").not.toContain("destructive");
    const summaryText = mustFind<HTMLElement>("summary").textContent;
    expect(summaryText).toContain("You didn't approve action refund order");
    // Distinct in BOTH the pill and the headline (the ticket's bar).
    expect(summaryText).not.toContain("Interrupted");
    expect(summaryText).not.toContain("Didn't run");
    expect(summaryText).not.toContain("Declined");
    expect(host.textContent).not.toContain("Error:");
    expect(host.textContent).not.toContain("Result");
    act(() => {
      root.unmount();
    });
    root = createRoot(host);

    // The fold: the projected denied step — the wire's cancelled stamp
    // AND the joined denial on one call — counts under its own word,
    // never as failed or interrupted, in plain ink, and outranks the
    // cancel stamp; a failure on the same call still wins (TVC-082).
    const messages: Message[] = [
      { id: "u-d1", role: "user", content: "Refund the order." },
      {
        id: "a-d1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "t-denied",
            type: "function",
            function: { name: "action__refund-order", arguments: "{}" },
          },
        ],
      },
      {
        id: "r-d1",
        role: "tool",
        toolCallId: "t-denied",
        content: "CONFIRMATION_FAILED: The user declined this action.",
      },
      { id: "a-d2", role: "assistant", content: "Leaving it as is." },
    ];
    const anchors: MarkerAnchorsSnapshot = {
      ...CANNED_ANCHORS,
      toolCancelAnchors: new Set(["t-denied"]),
      toolDenialAnchors: new Set(["t-denied"]),
    };
    const rows = transcriptRowsOf(messages, anchors, false);
    const denied = rows.find((row) => row.kind === "tool-call");
    expect(denied?.kind === "tool-call" && denied.state).toBe("denied");
    render(<MessageList rows={rows} cards={[]} live={false} />);
    const summary = mustFind<HTMLElement>("[data-tf-activity-group] summary");
    expect(summary.textContent).not.toContain("not approved");
    expect(summary.textContent).not.toContain("failed");
    expect(summary.querySelector(".tf\\:text-tf-destructive")).toBeNull();
    expect(
      mustFind<HTMLDetailsElement>("[data-tf-activity-group] > details").open,
    ).toBe(false);
    // A recorded failure on the same call outranks the denial.
    const failed = transcriptRowsOf(
      messages,
      { ...anchors, toolErrorAnchors: new Map([["t-denied", "It broke."]]) },
      false,
    ).find((row) => row.kind === "tool-call");
    expect(failed?.kind === "tool-call" && failed.state).toBe("output-error");
  });
});

describe("law 7 — decision surfaces", () => {
  it("TVC-062 decisions settle with no transcript receipt rows — approved and declined alike", () => {
    // The meta-receipt row class is deleted: the full pipeline —
    // one operation's ask/decision/execution/result history, with its
    // settled decision card in the shelf composition — must render NO
    // receipt sentence and NO duplicate card note anywhere in the
    // transcript, whichever way the decision went. The outcome's
    // surfaces are the card's own footer (a different mount) and the
    // operation row's state.
    const messages: Message[] = [
      { id: "u-a1", role: "user", content: "File the ticket." },
      {
        id: "a-a1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "t-approved",
            type: "function",
            function: {
              name: "action__create-support-ticket",
              arguments: JSON.stringify({ path: "/tickets" }),
            },
          },
        ],
      },
      {
        id: "r-a1",
        role: "tool",
        toolCallId: "t-approved",
        content: JSON.stringify({ ok: true, result: { id: 7 } }),
      },
      { id: "p-a1", role: "assistant", content: "Done — ticket 7 is filed." },
    ];
    const anchors = {
      ...CANNED_ANCHORS,
      resumeAnchors: new Map<string, unknown>(),
      toolErrorAnchors: new Map<string, string>(),
      toolCancelAnchors: new Set<string>(),
    };
    for (const approved of [true, false]) {
      render(
        <MessageList
          rows={transcriptRowsOf(messages, anchors, false)}
          cards={[
            {
              ...CANNED_APPROVAL_CARD,
              toolCallId: "t-approved",
              status: { kind: "answered", approved, trusted: false },
            },
          ]}
          decisionSurfacesInShelf
        />,
      );
      const receipts = [...host.querySelectorAll("p")].filter(
        (element) =>
          element.textContent.startsWith("Request approved") ||
          element.textContent.startsWith("Request denied") ||
          element.textContent.includes(APPROVED_NOTE) ||
          element.textContent.includes(DENIED_NOTE),
      );
      expect(receipts).toHaveLength(0);
    }
  });

  it("TVC-063 a generic approval banner leads with fixed consent copy and a mechanical tool label; arguments never render on the banner", () => {
    render(
      <ApprovalsContext.Provider
        value={{
          cards: [CANNED_APPROVAL_CARD],
          submitDecision: () => Promise.resolve(),
        }}
      >
        <ApprovalCard card={CANNED_APPROVAL_CARD} />
      </ApprovalsContext.Provider>,
    );
    const title = mustFind<HTMLElement>("[data-tf-approval-title]");
    expect(title.textContent).toBe("Approval required");
    // The tool identifier is mechanically humanized below the fixed title;
    // neither catalog prose nor arbitrary arguments get to name the frame.
    const frame = mustFind<HTMLElement>("[data-tf-approval-card]");
    expect(frame.textContent.trimStart().startsWith("Approval required")).toBe(
      true,
    );
    expect(title.textContent).not.toContain("{");
    // The banner asks exactly one question: the canned card's arguments
    // never render — raw, summarized, or behind a disclosure. The
    // call's own transcript row, which a pending decision holds open,
    // carries the request.
    expect(frame.querySelector("[data-tf-approval-request-summary]")).toBe(
      null,
    );
    expect(frame.querySelector("pre")).toBe(null);
    expect(frame.querySelector("details")).toBe(null);
    expect(frame.textContent).not.toContain("Technical details");
    expect(frame.textContent).not.toContain("/tickets");
    expect(frame.textContent).not.toContain("Kettle whistles in B minor");
    expect(frame.textContent).toContain(
      "The assistant wants to create a support ticket.",
    );
  });

  it("TVC-064 a resolved or stale decision's surface leaves the suspension slot — the tenant renders null unless a decision is actionable or in flight", () => {
    const renderSurfaces = (
      approvals: readonly (typeof CANNED_APPROVAL_CARD)[],
      asks: readonly ElicitationCardModel[],
    ) => {
      render(
        <ApprovalsContext.Provider
          value={{ cards: approvals, submitDecision: () => Promise.resolve() }}
        >
          <ElicitationsContext.Provider
            value={{
              cards: asks,
              submitQuestionAnswers: () => Promise.resolve(),
              cancelQuestionSet: () => Promise.resolve(),
              drafts: new QuestionDraftStore(),
            }}
          >
            <SuspensionSurfaces rowIndexByToolCallId={new Map()} />
          </ElicitationsContext.Provider>
        </ApprovalsContext.Provider>,
      );
    };
    // Only settled decisions: the tenant renders NOTHING — not an empty
    // frame, not a whitespace text node — so the slot's :empty collapse
    // holds and answered decisions can never resurrect as a surface.
    renderSurfaces(
      [
        {
          ...CANNED_APPROVAL_CARD,
          status: { kind: "answered", approved: true, trusted: false },
        },
      ],
      [CANNED_QUESTIONS_STALE],
    );
    expect(host.childNodes).toHaveLength(0);
    // One actionable decision: the surface is present, wearing the
    // landlord contract's tenant mark.
    renderSurfaces([CANNED_APPROVAL_CARD], []);
    const surface = mustFind<HTMLElement>("[data-tf-suspension-surfaces]");
    expect(surface.hasAttribute("data-tf-shelf-item")).toBe(true);
    // A question set obeys the same law: answered or stale, the
    // panel leaves the slot and the tenant renders nothing.
    renderSurfaces(
      [],
      [
        { ...CANNED_QUESTIONS_THREE, status: "answered" },
        {
          ...CANNED_QUESTIONS_THREE,
          interruptId: "bench-questions-stale",
          status: "stale",
        },
      ],
    );
    expect(host.innerHTML).toBe("");
  });

  // TVC-065's test was deleted with its law and the meta-receipt rows: no
  // decision receipt renders in the transcript at all, joined or unjoined
  // — the reworded TVC-062 above carries the surviving assertion.

  it("TVC-066 a settled (withdrawn or expired) ask never wears a running spinner or shimmer; the withdrawn sentence renders on the inline panel, never as a transcript row", () => {
    // A stale anchored ask in the shipping shelf composition: the
    // transcript renders NO settled prose for it (the stale line went with
    // the meta-receipt class) and leaves no running motion behind — a
    // hollow spinner over a dead question is the anti-pattern.
    const messages: Message[] = [
      { id: "u-w1", role: "user", content: "Ask me anything." },
      {
        id: "a-w1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "t-ask-stale",
            type: "function",
            function: { name: "ask_user", arguments: "{}" },
          },
        ],
      },
    ];
    // The stale question set: in the shelf composition the transcript
    // renders NO stale prose and no panel for it (no meta-receipt row), and
    // the sentence's one rendered home is the panel's own settled form —
    // heading kept, controls gone, no motion.
    const staleSet = {
      ...CANNED_QUESTIONS_THREE,
      anchored: true,
      toolCallId: "t-ask-stale",
      status: "stale" as const,
    };
    const staleSetSurface = {
      cards: [staleSet],
      submitQuestionAnswers: () => Promise.resolve(),
      cancelQuestionSet: () => Promise.resolve(),
      drafts: new QuestionDraftStore(),
    };
    render(
      <ElicitationsContext.Provider value={staleSetSurface}>
        <MessageList
          rows={transcriptRowsOf(messages, CANNED_ANCHORS, false)}
          cards={[]}
          decisionSurfacesInShelf
        />
      </ElicitationsContext.Provider>,
    );
    expect(host.textContent).not.toContain(
      "These questions were already answered or expired.",
    );
    expect(host.querySelector("[data-tf-question-panel]")).toBeNull();
    expect(host.querySelector("[data-tf-spinner]")).toBeNull();
    expect(host.querySelector("[data-tf-shimmer-text]")).toBeNull();
    render(
      <ElicitationsContext.Provider value={staleSetSurface}>
        <QuestionPanel card={staleSet} />
      </ElicitationsContext.Provider>,
    );
    const settledPanel = mustFind<HTMLElement>("[data-tf-question-panel]");
    expect(settledPanel.getAttribute("data-tf-question-panel-settled")).toBe(
      "stale",
    );
    expect(settledPanel.textContent).toContain(
      "These questions were already answered or expired.",
    );
    expect(settledPanel.querySelector("button, textarea")).toBeNull();
    expect(host.querySelector("[data-tf-spinner]")).toBeNull();
    expect(host.querySelector("[data-tf-shimmer-text]")).toBeNull();
  });
});

describe("law 8 — subagent surfaces", () => {
  it("TVC-071 a child preview wraps its transcript body in exactly one frame of chrome", () => {
    // Enforced over the frame's SHIPPED hook,
    // [data-tf-child-transcript-preview].
    // The fixture supplies the transcript body, so the law measures what
    // the COMPONENT contributes: exactly one frame, no nested frame, and
    // at most one card of chrome (a bordered or glass wrapper) between
    // the body and the preview boundary — a second card is the
    // card-within-card anti-pattern. Grammar reuse (the body being the
    // real transcript) is fixture-supplied here and reviewed through the
    // subagents scenario and TVC-158's baseline.
    render(
      <ChildTranscriptPreviewFrame
        label="Check the descaling instructions for drift."
        status="finished"
        duration="3m 04s"
      >
        <MessageList
          rows={transcriptRowsOf(SETTLED_MESSAGES, CANNED_ANCHORS, false)}
          cards={[]}
        />
      </ChildTranscriptPreviewFrame>,
    );
    const frames = [
      ...host.querySelectorAll("[data-tf-child-transcript-preview]"),
    ];
    expect(frames).toHaveLength(1);
    const frame = frames.at(0);
    if (frame === undefined) {
      throw new Error("the child preview frame did not render");
    }
    expect(
      frame.querySelector("[data-tf-child-transcript-preview]"),
    ).toBeNull();
    // Component-authored chrome between the body and the boundary: walk
    // from the fixture-supplied transcript body up to the frame root
    // (everything on that path is the component's own markup).
    const body = mustFind<HTMLElement>('[role="log"]');
    const wrappers: HTMLElement[] = [];
    for (
      let node = body.parentElement;
      node !== null;
      node = node.parentElement
    ) {
      wrappers.push(node);
      if (node === frame) {
        break;
      }
    }
    expect(wrappers.at(-1)).toBe(frame);
    const cardWrappers = wrappers.filter(
      (node) =>
        node.hasAttribute("data-tf-glass") ||
        /(^|\s)border(\s|$)/.test(node.getAttribute("class") ?? ""),
    );
    expect(cardWrappers.length).toBeLessThanOrEqual(1);
  });

  it("TVC-072 a subagent's current-work label reads the presenter's currentWorkLabel slot", () => {
    // The live child's label is the presenter's RUNNING arm for its
    // newest call — never a locally respelled frame.
    const currentCall = {
      toolName: "docs_search",
      state: "output-available",
      input: "{}",
    } as const;
    const expected = toolCallPresentationOf(currentCall).currentWorkLabel;
    // SETUP (the lane's wiring, §4): the real group renders here, with
    // the running child's newest call posed through the current-work
    // seam exactly the way the open drill-in stream publishes it
    // (subagent-current-work.tsx). The ASSERTIONS below are the law and
    // stay.
    render(
      <SubagentDispatchesContext.Provider
        value={{ byOrdinal: CANNED_THREAD_DISPATCHES }}
      >
        <SubagentCurrentWorkContext.Provider
          value={new Map([["subagent-bench-0", currentCall]])}
        >
          <SubagentGroupRow row={SUBAGENT_GROUP_MODEL} />
        </SubagentCurrentWorkContext.Provider>
      </SubagentDispatchesContext.Provider>,
    );
    const label = mustFind<HTMLElement>("[data-tf-subagent-current-work]");
    expect(label.textContent).toBe(expected);
  });
});

describe("law 10 — identity", () => {
  it("TVC-090 assistant-authored turns carry the TeaFlask agent identity mark", () => {
    // EVERY assistant prose turn wears the mark — a single mark
    // somewhere on the page would satisfy "carries" only vacuously, so
    // the count is held against the turn count. The third turn
    // interleaves narration with a tool call: its leading prose folds
    // into the episode as a narration step — prose-only fixtures alone
    // leave this law green while folded narration drops the token.
    const threeTurns: Message[] = [
      { id: "u1", role: "user", content: "How do I steep sencha?" },
      { id: "p1", role: "assistant", content: "At 80°C for two minutes." },
      { id: "u2", role: "user", content: "And gyokuro?" },
      {
        id: "p2",
        role: "assistant",
        content: "Cooler — 60°C, a little longer.",
      },
      { id: "u3", role: "user", content: "Check the hōjicha guide too." },
      { id: "p3", role: "assistant", content: "Checking the guide now." },
      {
        id: "a3",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "t3",
            type: "function",
            function: { name: "docs_search", arguments: "{}" },
          },
        ],
      },
      { id: "r3", role: "tool", toolCallId: "t3", content: "1 result" },
      { id: "p4", role: "assistant", content: "The guide checks out." },
    ];
    renderTranscript(threeTurns, false);
    const marks = [...host.querySelectorAll("[data-tf-agent-identity]")];
    expect(marks.length).toBeGreaterThanOrEqual(4);
    // The folded turn's prose carries the mark on its narration step.
    expect(
      host.querySelector(
        "[data-tf-activity-narration][data-tf-agent-identity]",
      ),
    ).not.toBeNull();
    // The hook's value contract, stated where the hook is minted: the
    // attribute's value is the mark's identity token, non-empty —
    // TVC-091's distinguishable-from-the-primary comparison depends on
    // it.
    for (const mark of marks) {
      expect(mark.getAttribute("data-tf-agent-identity")).not.toBe("");
    }
  });

  it("TVC-091 each subagent's identity mark is distinguishable and stable across surfaces", () => {
    // Two children never share a mark, and the same child keeps its mark
    // between the inline group and the roster. The hook contract this
    // body defines: [data-tf-subagent-identity]'s VALUE is the child's
    // identity token, so distinctness and cross-surface stability are
    // both token comparisons. SETUP (the lane's wiring, §4): both REAL
    // surfaces render over the SAME three children — the group model's
    // entries are the ledger's dispatches, ordinal for ordinal, so a
    // token-set mismatch can only ever be a stability violation, never a
    // fixture artifact — and an assistant prose turn renders alongside
    // so the PRIMARY agent's mark ([data-tf-agent-identity]; its value
    // is the identity token, the same hook contract as the children's)
    // exists in the same host for the distinguishable-from-the-primary
    // comparison. If the roster needs posing open through the roster
    // seam, extend the render — the ASSERTIONS below are the law.
    render(
      <SubagentDispatchesContext.Provider
        value={{ byOrdinal: CANNED_THREAD_DISPATCHES }}
      >
        <MessageList
          rows={transcriptRowsOf(
            [
              { id: "u1", role: "user", content: "Survey the guides." },
              {
                id: "p1",
                role: "assistant",
                content: "Delegating the survey to three coworkers.",
              },
            ],
            CANNED_ANCHORS,
            false,
          )}
          cards={[]}
        />
        <div data-tf-probe-group-surface="">
          <SubagentGroupRow row={SUBAGENT_GROUP_MODEL} />
        </div>
        <div data-tf-probe-roster-surface="">
          <SubagentCountPill dispatches={CANNED_THREAD_DISPATCHES} />
        </div>
      </SubagentDispatchesContext.Provider>,
    );
    // SETUP continued (the roster wiring): the roster card mounts only
    // while the pill is open — keyboard focus is its opener, so pose it
    // the way a Tab arrival would.
    act(() => {
      host
        .querySelector<HTMLButtonElement>(
          "[data-tf-probe-roster-surface] button",
        )
        ?.focus();
    });
    const tokensIn = (surface: string): string[] =>
      [...host.querySelectorAll(`${surface} [data-tf-subagent-identity]`)].map(
        (mark) => mark.getAttribute("data-tf-subagent-identity") ?? "",
      );
    const groupTokens = tokensIn("[data-tf-probe-group-surface]");
    const rosterTokens = tokensIn("[data-tf-probe-roster-surface]");
    // Distinguishable: no two children share a token.
    expect(groupTokens.length).toBeGreaterThanOrEqual(2);
    expect(new Set(groupTokens).size).toBe(groupTokens.length);
    // Stable across surfaces: the roster names the same children with
    // the same tokens.
    expect([...new Set(rosterTokens)].sort()).toEqual(
      [...new Set(groupTokens)].sort(),
    );
    // Distinguishable from the primary agent's: the assistant's mark
    // exists in this render, and no child's token collides with it.
    const primaryTokens = [
      ...host.querySelectorAll("[data-tf-agent-identity]"),
    ].map((mark) => mark.getAttribute("data-tf-agent-identity") ?? "");
    expect(primaryTokens.length).toBeGreaterThanOrEqual(1);
    // The hook's VALUE contract (asserted, not assumed): a valueless
    // data-tf-agent-identity="" would make every collision check below
    // unfireable — the token comparison only means something if the
    // primary mark carries a token.
    expect(primaryTokens.every((token) => token !== "")).toBe(true);
    for (const token of groupTokens) {
      expect(primaryTokens).not.toContain(token);
    }
  });

  it("TVC-092 subagent chrome uses filled TeaFlask marks with stable colors and no number badge", () => {
    render(
      <SubagentDispatchesContext.Provider
        value={{ byOrdinal: CANNED_THREAD_DISPATCHES }}
      >
        <SubagentGroupRow row={SUBAGENT_GROUP_MODEL} />
      </SubagentDispatchesContext.Provider>,
    );
    const marks = [
      ...host.querySelectorAll<HTMLElement>(
        '[data-tf-subagent-entry] [data-tf-agent-mark="subagent"]',
      ),
    ];
    expect(marks.length).toBeGreaterThanOrEqual(2);
    expect(marks.map((mark) => mark.dataset.tfAgentVariant)).toEqual([
      "1",
      "2",
      "3",
    ]);
    const starts: string[] = [];
    for (const mark of marks) {
      const svg = mark.querySelector("svg");
      expect(svg?.getAttribute("viewBox")).toBe("0 0 172 172");
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
      expect(svg?.querySelectorAll("rect")).toHaveLength(2);
      for (const rect of svg?.querySelectorAll("rect") ?? []) {
        expect(rect.getAttribute("fill")).toMatch(/^url\(#tf-agent-/);
        expect(rect.getAttribute("stroke")).toBeNull();
      }
      const firstStop = svg?.querySelector("linearGradient stop");
      starts.push(firstStop?.getAttribute("stop-color") ?? "");
      expect(mark.querySelector(".tf\\:tabular-nums")).toBeNull();
    }
    expect(new Set(starts).size).toBe(marks.length);
  });
});

describe("law 13 — provenance and system rows", () => {
  it("TVC-130 a memory write renders one coalesced footer on its originating message — safe fields only, behind a keyboard reveal", () => {
    const messages: Message[] = [
      { id: "mem-u1", role: "user", content: "Remember that I prefer sencha." },
      { id: "mem-p1", role: "assistant", content: "Noted — sencha it is." },
      { id: "mem-p2", role: "assistant", content: "Anything else today?" },
    ];
    // Three writes from one run — the known scopes and an unknown token
    // (the open vocabulary's fallback arm). The ids are realistic and
    // deliberately greppable so the leak assertion below has teeth.
    const writes = [
      {
        memoryId: "3e0f2a4c-0001-4222-8333-944444444444",
        scope: "user",
        summary: "Saved a note to memory.",
      },
      {
        memoryId: "3e0f2a4c-0002-4222-8333-944444444444",
        scope: "org",
        summary: "Saved a note to memory.",
      },
      {
        memoryId: "3e0f2a4c-0003-4222-8333-944444444444",
        scope: "workspace",
        summary: "Saved a note to memory.",
      },
    ];
    const anchors = {
      ...CANNED_ANCHORS,
      memoryProvenanceAnchors: new Map(
        writes.map((write) => [write.memoryId, write]),
      ),
      memoryAttributionAnchors: new Map(
        writes.map((write) => [write.memoryId, "mem-p1"]),
      ),
    };
    render(
      <MessageList
        rows={transcriptRowsOf(messages, anchors, false)}
        cards={[]}
      />,
    );
    // Coalesced: three writes, ONE footer — and on the originating
    // message's own block, never a detached row and never the neighbour.
    const footers = [...host.querySelectorAll("[data-tf-memory-footer]")];
    expect(footers).toHaveLength(1);
    const block = footers[0]?.parentElement;
    expect(block?.textContent).toContain("Noted — sencha it is.");
    expect(block?.textContent).not.toContain("Anything else today?");
    // The trigger names the batch; the entries stay behind the reveal.
    const trigger = mustFind<HTMLButtonElement>(
      "[data-tf-memory-footer] button",
    );
    expect(trigger.textContent).toContain("Memory updated · 3");
    expect(host.querySelectorAll("[data-tf-memory-entry]")).toHaveLength(0);
    act(() => {
      trigger.click();
    });
    const entries = [...host.querySelectorAll("[data-tf-memory-entry]")];
    expect(entries).toHaveLength(3);
    const labelOf = (entry: Element) =>
      entry.querySelector("span:last-child")?.textContent;
    expect(entries[0]?.textContent).toContain("Saved a note to memory.");
    expect(labelOf(entries[0])).toBe("Your memory");
    expect(labelOf(entries[1])).toBe("Shared memory");
    // The unknown scope token renders the generic destination — never
    // the raw token.
    expect(labelOf(entries[2])).toBe("Memory");
    expect(entries[2]?.textContent).not.toContain("workspace");
    // Safe fields only: the durable id never reaches the DOM.
    expect(footers[0]?.innerHTML).not.toContain("3e0f2a4c");
    // The old-history arm: the same provenance with no attribution —
    // an older persistence — renders no footer, never a synthesized
    // one.
    render(
      <MessageList
        rows={transcriptRowsOf(
          messages,
          { ...anchors, memoryAttributionAnchors: new Map() },
          false,
        )}
        cards={[]}
      />,
    );
    expect(host.querySelectorAll("[data-tf-memory-footer]")).toHaveLength(0);
  });

  it("TVC-132 a system-originated notice wears explicit system semantics, never prose or user styling", () => {
    const messages: Message[] = [
      { id: "sys-u1", role: "user", content: "What did the survey find?" },
      {
        id: "sys-p1",
        role: "assistant",
        content: "The survey is back — here's the digest.",
      },
    ];
    const anchors = {
      ...CANNED_ANCHORS,
      // The resume anchor renders NO notice — a meta-receipt kind
      // (severance input only); seeding it alongside proves the delivery
      // divider is the interleave's one remaining system-notice row.
      resumeAnchors: new Map<string, unknown>([["sys-p1", { attempt: 2 }]]),
      subagentDeliveryAnchors: new Map([
        [
          "sys-p1",
          [
            {
              ordinal: 0,
              label: "Survey the steeping guides.",
              succeeded: true,
            },
          ],
        ],
      ]),
    };
    render(
      <MessageList
        rows={transcriptRowsOf(messages, anchors, false)}
        cards={[]}
      />,
    );
    // One typed system event renders a dedicated notice row in the
    // interleave: the completed background handoff. The resume marker
    // renders nothing (its divider went with the meta-receipt rows).
    const notices = [...host.querySelectorAll("[data-tf-system-notice]")];
    expect(notices).toHaveLength(1);
    expect(host.textContent).not.toContain("Retrying — resumed");
    const noticeTexts = notices.map((notice) => notice.textContent);
    expect(
      noticeTexts.some((text) => text.includes("System notification")),
    ).toBe(true);
    for (const notice of notices) {
      // Accessible system semantics, not model-authored prose: an
      // explicit role and name a screen reader announces.
      expect(notice.getAttribute("role")).toBe("note");
      expect(notice.getAttribute("aria-label")).toBe("System notification");
      // Never styled as the conversation's voices: no markdown prose
      // body inside, and neither voice's words absorbed into the notice.
      expect(notice.querySelector("[data-tf-markdown]")).toBeNull();
      expect(notice.textContent).not.toContain("What did the survey find?");
      expect(notice.textContent).not.toContain("here's the digest");
      // The muted hairline register — the label step, never body ink.
      expect(notice.className).toContain("tf:text-xs");
      expect(notice.className).toContain("tf:text-tf-muted-foreground");
      expect(notice.className).not.toContain("tf:text-tf-body");
    }
  });
});

describe("law 11 — motion has a reduced-motion equivalent", () => {
  it("TVC-100 the shimmer collapses to a static equivalent under both reduced-motion switches", () => {
    // The stylesheet is the artifact under law (the package's
    // stylesheet-contract idiom): both switches neutralize the moving
    // highlight while the base glyphs — the state text — stay.
    const killSwitch = STYLES.indexOf(
      '[data-reduce-motion="true"] [data-tf-shimmer-highlight]',
    );
    expect(killSwitch).toBeGreaterThan(-1);
    expect(STYLES.slice(killSwitch, killSwitch + 200)).toContain(
      "animation: none",
    );
    expect(STYLES).toMatch(
      /@media \(prefers-reduced-motion[^{]*\{\s*\[data-tf-shimmer-highlight\]\s*\{[^}]*animation: none/,
    );
  });

  it("TVC-101 the one indeterminate spinner has a reduced-motion equivalent that preserves its state text", () => {
    // THE spinner primitive lives under the [data-tf-spinner] hook. The
    // surface: a submitting approval renders the spinner beside its
    // state text.
    render(
      <ApprovalsContext.Provider
        value={{
          cards: [SUBMITTING_APPROVAL_CARD],
          submitDecision: () => Promise.resolve(),
        }}
      >
        <ApprovalCard card={SUBMITTING_APPROVAL_CARD} />
      </ApprovalsContext.Provider>,
    );
    const spinner = mustFind<HTMLElement>("[data-tf-spinner]");
    // The OS half, the way this package builds spinners: the
    // motion-reduce utility on the element itself — the source sheet
    // compiles no utilities, so the media query cannot live there.
    expect(spinner.getAttribute("class") ?? "").toContain(
      "tf:motion-reduce:animate-none",
    );
    // The host kill-switch half lives in the stylesheet (its own comment
    // requires every spinner to stop under data-reduce-motion) — and the
    // rule must actually STOP the animation, not merely mention the
    // hook (TVC-100's shape, two tests above).
    const killSwitch = STYLES.search(
      /\[data-reduce-motion="true"\][^{}]*\[data-tf-spinner\]/,
    );
    expect(killSwitch).toBeGreaterThan(-1);
    expect(STYLES.slice(killSwitch, killSwitch + 200)).toContain(
      "animation: none",
    );
    // The state text survives the motion: the surface names its state
    // beside the spinner.
    expect(spinner.closest("p")?.textContent.trim()).toMatch(/\S/);
  });
});

describe("laws 1, 6, 12 — voice, semantic icons, fallbacks", () => {
  it("TVC-001 a process row's label renders on a smaller type-step token than assistant prose", () => {
    // The row keeps the label register one step under body prose (the
    // 13/15 discipline). The fixture renders BOTH registers: the
    // settled activity group and a trailing assistant prose turn to
    // compare against.
    renderTranscript(
      [
        ...SETTLED_MESSAGES,
        {
          id: "p1",
          role: "assistant",
          content: "Use 80°C water for two minutes, then decant completely.",
        },
      ],
      false,
    );
    // A PROCESS ROW's label — [data-tf-activity-step], the surface the
    // law names — never the fold header's own summary, which carries its
    // own label token and would keep this green while rebuilt rows
    // drifted to the body register.
    const label = mustFind<HTMLElement>("[data-tf-activity-step] summary span");
    const prose = mustFind<HTMLElement>("[data-tf-activity-group] ~ div p");
    expect(label.closest(".tf\\:text-tf-label")).not.toBeNull();
    expect(label.closest(".tf\\:text-tf-body")).toBeNull();
    expect(prose.closest(".tf\\:text-tf-label")).toBeNull();
    expect(prose.closest(".tf\\:text-tf-body")).not.toBeNull();
  });

  it("TVC-054 each icon-vocabulary member renders a distinct semantic mark", () => {
    // The resolved icon drives the mark; a completion tick is a state,
    // not the universal operation icon.
    const marks = TOOL_CALL_ICONS.map((icon) => {
      render(
        <ToolRow
          view={{
            toolName: "docs_search",
            state: "output-available",
            input: "{}",
            output: "done",
            display: { icon },
          }}
        />,
      );
      const mark = mustFind<HTMLElement>("summary").firstElementChild;
      if (mark === null) {
        throw new Error("the row rendered no mark");
      }
      return mark.outerHTML;
    });
    expect(new Set(marks).size).toBe(TOOL_CALL_ICONS.length);
  });

  it('TVC-055 a plan-progress operation annotated icon:"todo" resolves the dedicated checklist member, never the generic fallback', () => {
    // Contract §8's recorded conditional, discharged: plan-progress
    // semantics come with their own vocabulary member. The evidence is
    // the AUTHORED annotation token — same tool name in every arm, so a
    // tool-name mapping cannot fake this distinction.
    const markFor = (icon: string) => {
      render(
        <ToolRow
          view={{
            toolName: "update_plan",
            state: "output-available",
            input: "{}",
            output: "ok",
            display: { icon },
          }}
        />,
      );
      const mark = mustFind<HTMLElement>("summary").firstElementChild;
      if (mark === null) {
        throw new Error("the row rendered no mark");
      }
      return mark.outerHTML;
    };
    const todoMark = markFor("todo");
    const genericMark = markFor("generic");
    // An unknown token still degrades to generic (TVC-112's fallback) —
    // todo is a resolved member now, not one more spelling of unknown.
    expect(markFor("someday-vocabulary")).toBe(genericMark);
    expect(todoMark).not.toBe(genericMark);
  });

  it("TVC-111 an unknown customer tool exposes a bounded reading of its input but no inferred result surface", () => {
    render(
      <ToolRow
        view={{
          toolName: "acme__mystery-operation",
          state: "output-available",
          input: '{"a":1}',
          output: '{"widgets":[{"name":"alpha","count":3}]}',
        }}
      />,
    );
    const row = mustFind<HTMLDetailsElement>("details");
    row.open = true;
    expect(row.querySelector("[data-tf-generic-fallback]")).toBeNull();
    // The rung-4 reading: the input's fields as bounded rows, never the
    // raw JSON text, and no raw pane at all.
    expect(
      row.querySelector("[data-tf-approval-request-summary]"),
    ).not.toBeNull();
    expect(row.textContent).not.toContain('"a":1');
    expect(row.querySelector("pre")).toBeNull();
    expect(row.textContent).not.toContain("widgets");
  });

  it("TVC-115 a tool view that throws is isolated; package defaults take over", async () => {
    // A registered view that really throws during render. This suite
    // mounts the registry context directly (the channel the provider
    // prop feeds — the prop→context half is pinned in
    // tests/tool-views.test.tsx, which carries the session stub this
    // suite deliberately doesn't). React reports caught boundary errors
    // on console.error; spied so the law's run stays clean.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const throwingView: ToolCallViewModel = {
      ...COMPLETED_TOOL_CALL,
      display: {
        ...COMPLETED_TOOL_CALL.display,
        view: { key: "acme.kaboom", version: 1 },
      },
    };
    const ThrowingReading = (): never => {
      throw new Error("acme.kaboom exploded during render");
    };
    await renderAndSettle(
      <ToolViewRegistryContext.Provider
        value={{
          "acme.kaboom": {
            version: 1,
            view: reactToolView(ThrowingReading),
          },
        }}
      >
        <ToolRow view={throwingView} />
      </ToolViewRegistryContext.Provider>,
    );
    expect(host.textContent).toContain("Searched your docs");
    // The slot keeps the row intact without turning the raw result into
    // an inferred fallback card: the throw advances past the one
    // candidate onto the slot's own terminal — the package default
    // view's bounded argument reading (the row has no quiet-line
    // override).
    const fallbackReading = host.querySelector("[data-tf-tool-view]");
    expect(
      fallbackReading?.querySelector("[data-tf-approval-request-summary]"),
    ).not.toBeNull();
    expect(
      consoleError.mock.calls.some((call) =>
        String(call[0]).includes(
          '[teaflask-assistant] The tool view "acme.kaboom" threw',
        ),
      ),
    ).toBe(true);
  });
});
