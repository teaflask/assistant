// @vitest-environment jsdom
/** Adjacent protocol rows are one collapsible work group; each tool
 * remains a nested disclosure after that group is opened. */
import type { BaseEvent, Message } from "@ag-ui/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MessageList } from "../src/components/message-list";
import { ToolViewRegistryContext } from "../src/components/tool-view-registry-context";
import {
  ApprovalInbox,
  approvalInboxRecorder,
  type ApprovalCardModel,
  SERVING_APPROVAL_CAPABILITIES,
} from "../src/core/approval-inbox";
import {
  EMPTY_TOOL_CANCEL_ANCHORS,
  toolCancelRecorder,
  withToolCancelAnchored,
} from "../src/core/tool-cancel-anchors";
import { withToolOutcomeLifted } from "../src/core/tool-outcome";
import {
  EMPTY_TOOL_DENIAL_LEDGER,
  toolDenialRecorder,
  withToolDenialMarkerFolded,
  type ToolDenialLedger,
} from "../src/core/tool-denial-anchors";
import {
  EMPTY_TOOL_DECISION_ANCHORS,
  toolDecisionRecorder,
  withToolDecisionAnchored,
} from "../src/core/tool-decision-anchors";
import { transcriptRowsOf } from "../src/core/transcript-rows";
import type { MarkerAnchorsSnapshot } from "../src/core/connection-epoch";
import type { BlockTiming } from "../src/core/segment-timing";
import type { ToolViewProps, ToolViewRegistry } from "../src/core/tool-view";
import type { ToolCallRow, TranscriptRow } from "../src/core/transcript-rows";

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

function toolRow(
  key: string,
  state:
    | "input-available"
    | "output-available"
    | "output-error"
    | "denied"
    | "cancelled"
    | "refused" = "output-available",
  timing?: BlockTiming,
): TranscriptRow {
  return {
    kind: "tool-call",
    key,
    toolCallId: key,
    toolName: "docs_search",
    state,
    argsText: '{"query":"tea"}',
    result: state === "output-available" ? "One result" : undefined,
    errorText:
      state === "output-error" ? "The search backend refused." : undefined,
    refusalText:
      state === "refused" ? "Results are already waiting." : undefined,
    offloaded: false,
    timing,
  };
}

function proseRow(key: string, text: string): TranscriptRow {
  return { kind: "assistant-text", key, text, streaming: false };
}

function reasoningRow(key: string, text: string): TranscriptRow {
  return { kind: "reasoning", key, text, streaming: false };
}

function approvalCard(
  toolCallId: string,
  status: ApprovalCardModel["status"],
): ApprovalCardModel {
  return {
    interruptId: `interrupt:${toolCallId}`,
    toolName: "docs_search",
    toolArgs: {},
    toolInputSchema: null,
    toolOutputSchema: null,
    prompt: "Allow this tool to run?",
    toolCallId,
    anchored: true,
    round: 1,
    runId: "run-1",
    parked: false,
    gated: false,
    trustAvailable: false,
    asker: { kind: "assistant" },
    turnId: null,
    status,
  };
}

// A rung-1 registration and a row annotated with its wire ref — the
// minimal view-bearing pose for the placement holds.
const VIEW_REGISTRY: ToolViewRegistry = {
  "acme.reading": {
    version: 1,
    view: {
      mount(container) {
        const line = document.createElement("p");
        line.textContent = "authored reading";
        container.appendChild(line);
        return { update: () => undefined, destroy: () => undefined };
      },
    },
  },
};

function viewToolRow(
  key: string,
  state: Parameters<typeof toolRow>[1] = "output-available",
): TranscriptRow {
  const row = toolRow(key, state) as ToolCallRow;
  return { ...row, display: { view: { key: "acme.reading", version: 1 } } };
}

function userRow(key: string): TranscriptRow {
  return { kind: "user", key, text: "next question", attachments: [] };
}

/** The staging shape's failed catalog action: the wire's reserved rung-3
 *  view ref, exactly as the backend annotates every action call. */
function actionRow(key: string): TranscriptRow {
  const row = toolRow(key, "output-error") as ToolCallRow;
  return {
    ...row,
    toolName: "action__publish-doc",
    argsText: JSON.stringify({
      path_params: { doc_id: "d_41" },
      query: {},
      body: { channel: "release" },
    }),
    errorText: "404 NOT_FOUND from the publish endpoint.",
    display: { view: { key: "teaflask.action", version: 1 } },
  };
}

function namedToolRow(key: string, toolName: string): TranscriptRow {
  return { ...(toolRow(key) as ToolCallRow), toolName };
}

/** The member's gesture on the fold's OWN summary, modelled on the
 *  browser's real ordering (round-1 finding, 3/3 reviewers): the
 *  bubbling click first (keyboard activation dispatches the same click,
 *  detail 0, so this is both input paths); then the microtask
 *  checkpoint a real user gesture reaches during propagation — any
 *  discrete React commit lands HERE, BEFORE the activation behaviour;
 *  then the summary's activation behaviour, which per spec TOGGLES the
 *  open attribute's current present/absent state — never an assignment
 *  to the value the test wants to assert (the round-1 harness bug: an
 *  assignment always lands on the asserted value, so the tests passed
 *  whatever React did in between).
 *
 *  jsdom 30 implements the activation and the toggle event, but with
 *  the WRONG ordering for this race (measured, not assumed): a
 *  script-dispatched click runs the activation synchronously inside
 *  dispatchEvent — before React's scheduled commit can land — which is
 *  the opposite of a user gesture. So the helper suppresses jsdom's own
 *  activation with a one-shot preventDefault (harness scaffolding only
 *  — as a PRODUCT fix preventDefault would make a decayed fold
 *  un-expandable), lands the commit at the checkpoint, applies the
 *  activation toggle to the post-commit DOM, and drains the macrotask
 *  in which jsdom queues the REAL toggle event off the attribute
 *  change. The real-browser twin lives in tests-e2e/transcript.spec.ts. */
async function activateFoldSummaryAsMember(details: HTMLDetailsElement | null) {
  if (details === null) {
    throw new Error("the transcript rendered no fold");
  }
  const summary = details.querySelector<HTMLElement>(":scope > summary");
  if (summary === null) {
    throw new Error("the fold rendered no summary");
  }
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
  // Whatever React committed off the click has landed; the activation
  // behaviour now reads the DOM as the browser would, and jsdom queues
  // the toggle event off the attribute change. Await THAT event, never a
  // timer: the pin commits from the toggle listener, and a zero-delay
  // timer racing jsdom's own task made the pin land late on some runs.
  await act(async () => {
    const toggled = new Promise<void>((resolve, reject) => {
      details.addEventListener(
        "toggle",
        () => {
          resolve();
        },
        { once: true },
      );
      setTimeout(() => {
        reject(new Error("the <details> never fired toggle"));
      }, 1000);
    });
    details.open = !details.open;
    await toggled;
    await Promise.resolve();
  });
}
const collapseAsMember = async (details: HTMLDetailsElement | null) => {
  if (details?.open !== true) {
    throw new Error("posed a member collapse on a fold that is not open");
  }
  await activateFoldSummaryAsMember(details);
};
const expandAsMember = async (details: HTMLDetailsElement | null) => {
  if (details?.open !== false) {
    throw new Error("posed a member expand on a fold that is not closed");
  }
  await activateFoldSummaryAsMember(details);
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

describe("the row's schemas reach a mounted view", () => {
  it("hands the row's anchored schemas to the resolved view, and absence stays undefined", async () => {
    // The whole streamed chain in one mount: the transcript row's
    // anchored schemas ride _toolViewOf's view model into the presenter
    // and land on the mounted adapter's call — and a schema-less row
    // hands the view undefined, never `{}`.
    const argsSchema = { type: "object", properties: { query: {} } };
    const mounted: ToolViewProps[] = [];
    const registry: ToolViewRegistry = {
      // Rung 2: exact tool name.
      docs_search: {
        version: 1,
        view: {
          mount(_container, props) {
            mounted.push(props);
            return { update: () => undefined, destroy: () => undefined };
          },
        },
      },
    };
    const one = toolRow("one");
    if (one.kind !== "tool-call") {
      throw new Error("toolRow builds tool-call rows");
    }
    const withSchemas: TranscriptRow = { ...one, schemas: { argsSchema } };
    await act(async () => {
      root.render(
        <ToolViewRegistryContext.Provider value={registry}>
          <MessageList rows={[withSchemas, toolRow("two")]} cards={[]} />
        </ToolViewRegistryContext.Provider>,
      );
      await Promise.resolve();
    });

    expect(mounted).toHaveLength(2);
    // Verbatim reference — the anchors map's identity guarantee holds
    // through the row join and the presenter.
    expect(mounted[0]?.call.argsSchema).toBe(argsSchema);
    expect(mounted[0]?.call.resultSchema).toBeUndefined();
    expect(mounted[1]?.call.argsSchema).toBeUndefined();
    expect(Object.keys(mounted[1].call)).not.toContain("argsSchema");
  });
});

describe("a not-approved step in the fold headline", () => {
  it("adds no tally to the settled headline — the row's pill wears the word — and does not force the fold open", async () => {
    await act(async () => {
      root.render(<MessageList rows={[toolRow("one", "denied")]} cards={[]} />);
      await Promise.resolve();
    });

    const outer = host.querySelector<HTMLDetailsElement>(
      "[data-tf-activity-group] > details",
    );
    const summary = outer?.querySelector(":scope > summary");
    expect(summary?.textContent).toBe("Worked");
    expect(summary?.querySelector(".tf\\:text-tf-destructive")).toBeNull();
    // Only an actionable decision forces the fold open (TVC-014); a
    // member's denial does not.
    expect(outer?.open).toBe(false);
  });
});

describe("a declined step in the fold headline", () => {
  it("adds no tally to the settled headline and does not force the fold open", async () => {
    await act(async () => {
      root.render(
        <MessageList rows={[toolRow("one", "refused")]} cards={[]} />,
      );
      await Promise.resolve();
    });

    const outer = host.querySelector<HTMLDetailsElement>(
      "[data-tf-activity-group] > details",
    );
    const summary = outer?.querySelector(":scope > summary");
    expect(summary?.textContent).toBe("Worked");
    expect(summary?.querySelector(".tf\\:text-tf-destructive")).toBeNull();
    expect(outer?.open).toBe(false);
  });
});

describe("adjacent activity rows", () => {
  it("keeps the outer work disclosure for a single tool call", async () => {
    await act(async () => {
      root.render(<MessageList rows={[toolRow("one")]} cards={[]} />);
      await Promise.resolve();
    });

    const outer = host.querySelector<HTMLDetailsElement>(
      "[data-tf-activity-group] > details",
    );
    expect(outer?.open).toBe(false);
    const summary = outer?.querySelector(":scope > summary")?.textContent;
    // A timing-less hand-built row is an unknown span: the honest
    // neutral "Worked" — never a step count, never an invented duration.
    expect(summary).toContain("Worked");
    expect(summary).not.toMatch(/\d+\s+steps?\b/);
    const chevron = outer?.querySelector(":scope > summary > svg");
    expect(chevron?.getAttribute("data-tf-disclosure-chevron")).toBe("");
    expect(chevron?.hasAttribute("data-tf-disclosure-chevron-visible")).toBe(
      false,
    );
    expect(chevron?.getAttribute("opacity")).toBe("0");
    expect(
      outer?.querySelectorAll("[data-tf-activity-rail] details"),
    ).toHaveLength(1);
  });

  it("collapse behind one work summary while preserving nested tool disclosures", async () => {
    await act(async () => {
      root.render(
        <MessageList
          rows={[
            toolRow("one", "output-available", {
              startedAtMs: 10_000,
              settledAtMs: 60_000,
            }),
            toolRow("two", "output-available", {
              startedAtMs: 60_000,
              settledAtMs: 135_000,
            }),
          ]}
          cards={[]}
        />,
      );
      await Promise.resolve();
    });

    const group = host.querySelector<HTMLElement>("[data-tf-activity-group]");
    const outer = group?.querySelector<HTMLDetailsElement>(":scope > details");
    const summary = outer?.querySelector(":scope > summary");
    // The settled headline is the fold's own server-derived span —
    // 10s → 135s across the two members — never a step count.
    expect(summary?.textContent).toContain("Worked for 2m 05s");
    expect(outer?.open).toBe(false);
    expect(
      outer?.querySelectorAll("[data-tf-activity-rail] details"),
    ).toHaveLength(2);
  });

  it("opens a running group by default — the working section is the expanded one — with the generic headline", async () => {
    await act(async () => {
      root.render(
        <MessageList
          rows={[toolRow("one", "input-available"), toolRow("two")]}
          cards={[]}
        />,
      );
      await Promise.resolve();
    });

    const outer = host.querySelector<HTMLDetailsElement>(
      "[data-tf-activity-group] > details",
    );
    expect(outer?.open).toBe(true);
    // Expanded and live, the headline goes generic (TVC-010): the rail
    // below says what the steps are.
    act(() => {
      outer?.dispatchEvent(new Event("toggle"));
    });
    expect(outer?.querySelector(":scope > summary")?.textContent).toContain(
      "Working…",
    );
    expect(outer?.querySelectorAll("[data-tf-shimmer-text]")).toHaveLength(2);
    // The spinner hook is [data-tf-spinner]; the law: a running tool row
    // shimmers, never spins.
    expect(outer?.querySelector("[data-tf-spinner]")).toBeNull();
  });

  it("a live turn keeps the trailing fold open and working between back-to-back calls", async () => {
    // Tool A's result has landed and tool B hasn't started: no row is
    // streaming for a beat, but the turn is still working — deriving
    // openness from row state alone would blink the group shut and open
    // once per call. The trailing group's turnLive keeps it open and in
    // the live register.
    await act(async () => {
      root.render(<MessageList rows={[toolRow("one")]} cards={[]} live />);
      await Promise.resolve();
    });

    const outer = host.querySelector<HTMLDetailsElement>(
      "[data-tf-activity-group] > details",
    );
    expect(outer?.open).toBe(true);
    const summary = outer?.querySelector(":scope > summary");
    expect(summary?.querySelector("[data-tf-shimmer-text]")).not.toBeNull();
    expect(summary?.textContent).not.toContain("Worked for");
    // The turn ends: the same fold releases and collapses.
    await act(async () => {
      root.render(<MessageList rows={[toolRow("one")]} cards={[]} />);
      await Promise.resolve();
    });
    expect(
      host.querySelector<HTMLDetailsElement>(
        "[data-tf-activity-group] > details",
      ),
    ).toBe(outer);
    expect(outer?.open).toBe(false);
    expect(outer?.querySelector(":scope > summary")?.textContent).toContain(
      "Worked",
    );
  });

  it("liveness never props open a group that prose already closed", async () => {
    // Once assistant text follows, the group is a finished piece of
    // work — only the TRAILING group rides the turn's liveness.
    await act(async () => {
      root.render(
        <MessageList
          rows={[
            toolRow("one"),
            {
              kind: "assistant-text",
              key: "t1",
              text: "Done.",
              streaming: true,
            },
          ]}
          cards={[]}
          live
        />,
      );
      await Promise.resolve();
    });

    const outer = host.querySelector<HTMLDetailsElement>(
      "[data-tf-activity-group] > details",
    );
    expect(outer?.open).toBe(false);
  });

  it("a failed step settles the group closed with a plain Worked headline — the row's pill names the failure", async () => {
    await act(async () => {
      root.render(
        <MessageList
          rows={[toolRow("bad", "output-error"), toolRow("two")]}
          cards={[]}
        />,
      );
      await Promise.resolve();
    });

    const outer = host.querySelector<HTMLDetailsElement>(
      "[data-tf-activity-group] > details",
    );
    expect(outer?.open).toBe(false);
    expect(outer?.querySelector(":scope > summary")?.textContent).toBe(
      "Worked",
    );
    expect(host.querySelector("[data-tf-state-pill]")?.textContent).toBe(
      "Failed",
    );
  });

  it("a cancelled step leaves the settled summary plain — the row's pill says Interrupted", async () => {
    await act(async () => {
      root.render(
        <MessageList rows={[toolRow("void", "cancelled")]} cards={[]} />,
      );
      await Promise.resolve();
    });

    const outer = host.querySelector<HTMLDetailsElement>(
      "[data-tf-activity-group] > details",
    );
    expect(outer?.open).toBe(false);
    expect(outer?.querySelector(":scope > summary")?.textContent).toBe(
      "Worked",
    );
  });

  it("a paused turn stays collapsed and does not claim work", async () => {
    // A pause used to arrive as its own prop; it no longer exists —
    // a turn awaiting the member renders exactly like a settled
    // chronology (not live, no decision card), which is this render.
    await act(async () => {
      root.render(<MessageList rows={[toolRow("one")]} cards={[]} />);
      await Promise.resolve();
    });

    const outer = host.querySelector<HTMLDetailsElement>(
      "[data-tf-activity-group] > details",
    );
    expect(outer?.open).toBe(false);
    const summary = outer?.querySelector(":scope > summary")?.textContent;
    expect(summary).toContain("Worked");
    expect(summary).not.toContain("Working…");
  });

  it("holds a paused group open while an anchored approval awaits its decision", async () => {
    // A HITL pause flips the turn out of running (awaiting_input), but
    // the approve/deny card the turn is blocked on renders INSIDE the
    // group — collapsing here would hide the only way to resume.
    await act(async () => {
      root.render(
        <MessageList
          rows={[toolRow("one")]}
          cards={[
            approvalCard("one", { kind: "actionable", errorSentence: null }),
          ]}
        />,
      );
      await Promise.resolve();
    });

    const outer = host.querySelector<HTMLDetailsElement>(
      "[data-tf-activity-group] > details",
    );
    expect(outer?.open).toBe(true);
    expect(outer?.textContent).toContain("Allow this tool to run?");
  });

  it("a running group stays open through a decision landing and collapses once its work settles", async () => {
    await act(async () => {
      root.render(
        <MessageList rows={[toolRow("one", "input-available")]} cards={[]} />,
      );
      await Promise.resolve();
    });
    const outer = host.querySelector<HTMLDetailsElement>(
      "[data-tf-activity-group] > details",
    );
    expect(outer?.open).toBe(true);
    // A gated call: the decision arm keeps the same fold open.
    await act(async () => {
      root.render(
        <MessageList
          rows={[toolRow("one", "input-available")]}
          cards={[
            approvalCard("one", { kind: "actionable", errorSentence: null }),
          ]}
        />,
      );
      await Promise.resolve();
    });
    expect(outer?.open).toBe(true);
    // Answered and settled, not live: finished work folds, on the same
    // element (true→undefined releases the attribute, nothing remounts).
    await act(async () => {
      root.render(
        <MessageList
          rows={[toolRow("one")]}
          cards={[
            approvalCard("one", {
              kind: "answered",
              approved: true,
              trusted: false,
            }),
          ]}
        />,
      );
      await Promise.resolve();
    });
    expect(
      host.querySelector<HTMLDetailsElement>(
        "[data-tf-activity-group] > details",
      ),
    ).toBe(outer);
    expect(outer?.open).toBe(false);
  });

  it("a member's collapse during the pause outranks the hold", async () => {
    // The member's toggle outranks the hold: reviewing is the member's
    // to control, and their explicit toggle pins this fold to native
    // permanently. The decision is still surfaced — the suspension slot
    // / inline card and the row's "Needs input" pill — collapsing the
    // fold was their own choice about the chronology, not about the
    // decision.
    await act(async () => {
      root.render(
        <MessageList
          rows={[toolRow("one")]}
          cards={[
            approvalCard("one", { kind: "actionable", errorSentence: null }),
          ]}
        />,
      );
      await Promise.resolve();
    });
    const outer = host.querySelector<HTMLDetailsElement>(
      "[data-tf-activity-group] > details",
    );
    expect(outer?.open).toBe(true);
    await collapseAsMember(outer);
    expect(outer?.open).toBe(false);
    // A FRESH decision landing later does not overrule the pin either —
    // "permanently for that fold". Posed through a genuine prop-value
    // flip (answered, then a new actionable card): without the pin the
    // undefined→true transition re-opens — the negative-control twin
    // below proves it — so this staying closed is the pin's doing.
    await act(async () => {
      root.render(
        <MessageList
          rows={[toolRow("one")]}
          cards={[
            approvalCard("one", {
              kind: "answered",
              approved: true,
              trusted: false,
            }),
          ]}
        />,
      );
      await Promise.resolve();
    });
    await act(async () => {
      root.render(
        <MessageList
          rows={[toolRow("one"), toolRow("two")]}
          cards={[
            approvalCard("two", { kind: "actionable", errorSentence: null }),
          ]}
        />,
      );
      await Promise.resolve();
    });
    expect(outer?.open).toBe(false);
  });

  it("approving never snaps the fold shut under the pointer: the approved call runs, and the running work keeps the fold open", async () => {
    await act(async () => {
      root.render(
        <MessageList
          rows={[toolRow("one", "input-available")]}
          cards={[
            approvalCard("one", { kind: "actionable", errorSentence: null }),
          ]}
        />,
      );
      await Promise.resolve();
    });
    const outer = host.querySelector<HTMLDetailsElement>(
      "[data-tf-activity-group] > details",
    );
    expect(outer?.open).toBe(true);
    // Answered: the call is executing (input-available), so the fold is
    // the working section and stays open; the "Needs input" pill is gone.
    await act(async () => {
      root.render(
        <MessageList
          rows={[toolRow("one", "input-available")]}
          cards={[
            approvalCard("one", {
              kind: "answered",
              approved: true,
              trusted: false,
            }),
          ]}
        />,
      );
      await Promise.resolve();
    });
    expect(outer?.open).toBe(true);
    expect(outer?.textContent).not.toContain("Needs input");
  });

  it("an answered decision on settled work holds nothing open — finished work folds", async () => {
    await act(async () => {
      root.render(
        <MessageList
          rows={[toolRow("one")]}
          cards={[
            approvalCard("one", {
              kind: "answered",
              approved: true,
              trusted: false,
            }),
          ]}
        />,
      );
      await Promise.resolve();
    });

    const outer = host.querySelector<HTMLDetailsElement>(
      "[data-tf-activity-group] > details",
    );
    expect(outer?.open).toBe(false);
    // The member may still open it, and that choice is theirs to keep.
    await expandAsMember(outer);
    expect(outer?.open).toBe(true);
  });

  it("keeps reasoning that followed a tool call below that call", async () => {
    // reasoning → tool → reasoning must render in transcript order —
    // only ADJACENT reasoning rows merge into one thinking block.
    await act(async () => {
      root.render(
        <MessageList
          rows={[
            reasoningRow("r1", "the plan"),
            toolRow("one"),
            reasoningRow("r2", "the follow-up"),
            reasoningRow("r3", "more follow-up"),
          ]}
          cards={[]}
        />,
      );
      await Promise.resolve();
    });

    const outer = host.querySelector<HTMLDetailsElement>(
      "[data-tf-activity-group] > details",
    );
    const steps = [
      ...(outer?.querySelectorAll("[data-tf-activity-step]") ?? []),
    ];
    expect(steps).toHaveLength(3);
    expect(steps[0]?.textContent).toContain("the plan");
    expect(steps[0]?.textContent).not.toContain("follow-up");
    expect(steps[1]?.textContent).toContain("Ran docs search");
    expect(steps[2]?.textContent).toContain("the follow-up");
    expect(steps[2]?.textContent).toContain("more follow-up");
  });
});

describe("completed-episode rendering", () => {
  // Work → finding → work → final response: the shape that unifies.
  const interleavedRows = (): TranscriptRow[] => [
    toolRow("t-a", "output-available", {
      startedAtMs: 10_000,
      settledAtMs: 75_000,
    }),
    proseRow("p-mid", "Found the guides."),
    toolRow("t-b", "output-available", {
      startedAtMs: 80_000,
      settledAtMs: 80_400,
    }),
    proseRow("p-final", "They agree on 80°C."),
  ];

  it("a settled turn renders one summary spanning the whole episode, narration folded inside the rail", async () => {
    await act(async () => {
      root.render(<MessageList rows={interleavedRows()} cards={[]} />);
      await Promise.resolve();
    });

    const summaries = [
      ...host.querySelectorAll("[data-tf-activity-group] > details > summary"),
    ].map((summary) => summary.textContent);
    // ONE unified episode, its duration spanning the narration gap —
    // never two adjacent "Worked for…" sections for one continuous turn.
    expect(summaries).toEqual(["Worked for 1m 10s"]);
    // The intermediate finding renders INSIDE the rail as a narration
    // step (body-register markdown); only the final response is a
    // top-level prose sibling.
    const narration = host.querySelector(
      "[data-tf-activity-rail] [data-tf-activity-narration] [data-tf-markdown]",
    );
    expect(narration?.textContent).toContain("Found the guides.");
    // The narration step is a NON-LAST step (a tool call follows it) and
    // sits flush; the connector rule excludes exactly this shape, so the
    // hairline never crosses its wrapped lines (styles.css).
    const narrationStep = host.querySelector(
      "[data-tf-activity-rail] [data-tf-activity-step][data-tf-activity-narration]",
    );
    expect(narrationStep?.matches(":not(:last-child)")).toBe(true);
    expect(
      narrationStep?.matches(
        "[data-tf-activity-step]:not(:last-child):not([data-tf-activity-narration])",
      ),
    ).toBe(false);
    expect(narrationStep?.className).not.toContain("tf:ps-");
    const group = host.querySelector("[data-tf-activity-group]");
    const strays = [...host.querySelectorAll("[data-tf-markdown]")].filter(
      (node) => !group?.contains(node),
    );
    expect(strays).toHaveLength(1);
    expect(strays[0]?.textContent).toContain("They agree on 80°C.");
  });

  it("an open turn (turnOpen without live — a HITL pause) keeps the interleaved two-fold chronology", async () => {
    // awaiting_input/parked: the run is not streaming, but the turn has
    // not settled — unifying here would prematurely read the paused
    // chronology as finished and pop it apart again on resume.
    await act(async () => {
      root.render(<MessageList rows={interleavedRows()} cards={[]} turnOpen />);
      await Promise.resolve();
    });

    const summaries = [
      ...host.querySelectorAll("[data-tf-activity-group] > details > summary"),
    ].map((summary) => summary.textContent);
    expect(summaries).toEqual(["Worked for 1m 05s", "Worked for <1s"]);
    // Every prose row stays top-level while the turn is open.
    expect(host.querySelector("[data-tf-activity-narration]")).toBeNull();
    const group = host.querySelector("[data-tf-activity-group]");
    const topLevelProse = [
      ...host.querySelectorAll("[data-tf-markdown]"),
    ].filter((node) => !group?.contains(node));
    expect(topLevelProse).toHaveLength(2);
    expect(topLevelProse[0]?.textContent).toContain("Found the guides.");
  });

  it("a live turn keeps chronology with the trailing fold working", async () => {
    await act(async () => {
      root.render(
        <MessageList
          rows={[
            toolRow("t-a", "output-available", {
              startedAtMs: 10_000,
              settledAtMs: 75_000,
            }),
            proseRow("p-mid", "Found the guides."),
            toolRow("t-b", "input-available"),
          ]}
          cards={[]}
          live
        />,
      );
      await Promise.resolve();
    });

    const summaries = [
      ...host.querySelectorAll("[data-tf-activity-group] > details > summary"),
    ].map((summary) => summary.textContent);
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toContain("Worked for 1m 05s");
    // The trailing fold is the working section: open by default, so its
    // headline is the expanded generic reading (TVC-010), never settled.
    expect(summaries[1]).toContain("Working…");
    expect(summaries[1]).not.toContain("Worked");
  });

  it("a cut-off turn keeps its last words visible above the trailing fold — a stop never collapses a turn to nothing", async () => {
    // The user pressed Stop mid-call: the paragraph the assistant had
    // written stays a top-level row, and the severed work folds after
    // it under the plain-ink interrupted suffix, collapsed (the receipt
    // row alongside owns the stop's story).
    await act(async () => {
      root.render(
        <MessageList
          rows={[
            proseRow("p-last", "Reading the first guide now."),
            toolRow("t-cut", "cancelled"),
          ]}
          cards={[]}
        />,
      );
      await Promise.resolve();
    });

    const group = host.querySelector("[data-tf-activity-group]");
    const topLevelProse = [
      ...host.querySelectorAll("[data-tf-markdown]"),
    ].filter((node) => !group?.contains(node));
    expect(topLevelProse).toHaveLength(1);
    expect(topLevelProse[0]?.textContent).toContain(
      "Reading the first guide now.",
    );
    expect(host.querySelector("[data-tf-activity-narration]")).toBeNull();
    const outer = group?.querySelector<HTMLDetailsElement>(":scope > details");
    expect(outer?.open).toBe(false);
    expect(outer?.querySelector(":scope > summary")?.textContent).toBe(
      "Worked",
    );
  });

  it("a failure past the last prose folds into the trailing fold, with the last words visible above it", async () => {
    await act(async () => {
      root.render(
        <MessageList
          rows={[
            toolRow("t-a"),
            proseRow("p-mid", "Halfway."),
            toolRow("t-bad", "output-error"),
          ]}
          cards={[]}
        />,
      );
      await Promise.resolve();
    });

    // The span's last prose stays out; the leading work and the failed
    // tail are separate folds, both settled and folded.
    const details = [
      ...host.querySelectorAll<HTMLDetailsElement>(
        "[data-tf-activity-group] > details",
      ),
    ];
    expect(details).toHaveLength(2);
    expect(details[0]?.open).toBe(false);
    expect(details[1]?.open).toBe(false);
    expect(details[1]?.querySelector(":scope > summary")?.textContent).toBe(
      "Worked",
    );
    const groups = [...host.querySelectorAll("[data-tf-activity-group]")];
    const topLevelProse = [
      ...host.querySelectorAll("[data-tf-markdown]"),
    ].filter((node) => !groups.some((groupNode) => groupNode.contains(node)));
    expect(topLevelProse).toHaveLength(1);
    expect(topLevelProse[0]?.textContent).toContain("Halfway.");
  });
});

describe("the collapsed live headline's measured truncation", () => {
  /** Collapse the (open-by-default) working fold programmatically and
   *  fire the toggle a browser would, so the DOM-backed headline mirror
   *  re-reads the closed state. */
  async function collapseLiveFold() {
    const details = host.querySelector<HTMLDetailsElement>(
      "[data-tf-activity-group] > details",
    );
    if (details === null) {
      throw new Error("no fold rendered");
    }
    await act(async () => {
      details.open = false;
      details.dispatchEvent(new Event("toggle"));
      await Promise.resolve();
    });
  }

  it("renders the label through a block-truncate span in BOTH shimmer layers, inside a shrinkable grid track", async () => {
    // jsdom cannot do layout, so this pins the measured-truncation
    // STRUCTURE (subagent-group-row's idiom): the atomic inline-grid
    // shimmer root cannot be ellipsized from outside — the ellipsis
    // must live on a blockified span inside each stacked copy, and the
    // root's track must be shrinkable (grid-cols-1 + min-w-0 +
    // max-w-full). The geometry itself is exercised by the narrow-width
    // e2e probe (tests-e2e/transcript.spec.ts).
    await act(async () => {
      root.render(
        <MessageList rows={[toolRow("one", "input-available")]} cards={[]} />,
      );
      await Promise.resolve();
    });
    // The working fold opens by default; the step label is the COLLAPSED
    // reading, so collapse it the way a member would land it.
    await collapseLiveFold();
    const summary = host.querySelector("[data-tf-activity-group] summary");
    const shimmer = summary?.querySelector("[data-tf-shimmer-text]");
    const classes = shimmer?.getAttribute("class") ?? "";
    expect(classes).toContain("tf:max-w-full");
    expect(classes).toContain("tf:grid-cols-1");
    // The wrapper is the shrinkable flex child AND the title carrier
    // (round-2 finding 5): the RAW step label rides it — on the wrapper,
    // never the inner span, which ShimmerText duplicates.
    const wrapper = shimmer?.parentElement;
    expect(wrapper?.getAttribute("class")).toContain("tf:min-w-0");
    expect(wrapper?.getAttribute("title")).toBe("Running docs search…");
    const layers = [
      shimmer?.querySelector("[data-tf-shimmer-base] > span"),
      shimmer?.querySelector("[data-tf-shimmer-highlight] > span"),
    ];
    for (const layer of layers) {
      expect(layer).not.toBeNull();
      expect(layer?.getAttribute("class")).toContain("tf:truncate");
      expect(layer?.getAttribute("class")).toContain("tf:block");
      expect(layer?.textContent).toBe("Running docs search…");
    }
  });

  it("caps the DISPLAYED label at activityTitleOf's 64 chars while the title keeps the raw authored text", async () => {
    const authored = `Running the ${"very ".repeat(30)}long operation`;
    await act(async () => {
      root.render(
        <MessageList
          rows={[
            {
              ...(toolRow("one", "input-available") as Extract<
                TranscriptRow,
                { kind: "tool-call" }
              >),
              display: { progressText: authored },
            },
          ]}
          cards={[]}
        />,
      );
      await Promise.resolve();
    });
    await collapseLiveFold();
    const shimmer = host.querySelector(
      "[data-tf-activity-group] summary [data-tf-shimmer-text]",
    );
    const visible =
      shimmer?.querySelector("[data-tf-shimmer-base] > span")?.textContent ??
      "";
    expect(visible.length).toBeLessThanOrEqual(64);
    expect(visible.endsWith("…")).toBe(true);
    expect(shimmer?.parentElement?.getAttribute("title")).toBe(authored);
  });
});

describe("the decision hold across the card store's REAL pruning (round-3 finding 1)", () => {
  // The round-2 latch read the live card list, but production prunes it
  // long before the next user turn: noteToolCallResult removes the
  // gated call's card the moment its result lands, the settled turn's
  // word (reconcileWithTurn, reconcileWithTurns) clears a terminal turn's
  // cards, and a reloaded settled thread hydrates none (the round-2
  // fresh-mount arm held an answered card in the cards prop BY HAND — a
  // state production never delivers, which is why the suite was blind).
  // This suite drives ONE event history through the real ApprovalInbox
  // recorder and renders with exactly the cards it emits at each stage.
  const RUN_ID = "run-hold";
  const TOOL_CALL_ID = "t-hold";
  const HISTORY: Message[] = [
    { id: "u-hold", role: "user", content: "File the ticket." },
    {
      id: "a-hold",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: TOOL_CALL_ID,
          type: "function",
          function: { name: "action__create-ticket", arguments: '{"p":1}' },
        },
      ],
    },
    { id: "r-hold", role: "tool", toolCallId: TOOL_CALL_ID, content: "done" },
  ];
  const EMPTY_SNAPSHOT: MarkerAnchorsSnapshot = {
    resumeAnchors: new Map(),
    turnFailedAnchors: new Map(),
    subagentDeliveryAnchors: new Map(),
    toolErrorAnchors: new Map(),
    toolCancelAnchors: new Set(),
    toolRefusalAnchors: new Map(),
    toolOffloadAnchors: new Set(),
    toolCallDisplayAnchors: new Map(),
    toolSchemaAnchors: new Map(),
    blockTimingAnchors: new Map(),
    turnUsageAnchors: new Map(),
    memoryProvenanceAnchors: new Map(),
    memoryAttributionAnchors: new Map(),
  };

  /** Replays the history's decision lifecycle through the REAL inbox
   *  recorder AND the real decision-anchor recorder up to and including
   *  the named stage, returning exactly what production would hand the
   *  transcript at that point: the (prunable) cards, and the durable
   *  anchor set the row model joins. */
  function stageThrough(
    stage: "requested" | "resolved" | "result" | "run-finished",
  ): {
    cards: readonly ApprovalCardModel[];
    anchors: MarkerAnchorsSnapshot;
  } {
    // Production's shape (conversation-adoption.ts): anchoring on, so the
    // card carries `anchored` and the fold's live decision arm sees it.
    const inbox = new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
    let cards: readonly ApprovalCardModel[] = [];
    let decisions: ReadonlySet<string> = EMPTY_TOOL_DECISION_ANCHORS;
    const recorder = approvalInboxRecorder(
      inbox,
      (next) => {
        cards = next;
      },
      () => undefined,
    );
    const anchorRecorder = toolDecisionRecorder((toolCallId) => {
      decisions = withToolDecisionAnchored(decisions, toolCallId);
    });
    const drive = (name: keyof typeof recorder, event: unknown) => {
      (recorder[name] as (payload: { event: unknown }) => void)({ event });
      (
        anchorRecorder[name] as
          ((payload: { event: unknown }) => void) | undefined
      )?.({ event });
      cards = inbox.cards();
    };
    const snapshot = () => ({
      cards,
      anchors: { ...EMPTY_SNAPSHOT, toolDecisionAnchors: decisions },
    });
    drive("onRunStartedEvent", { runId: RUN_ID });
    drive("onToolCallStartEvent", { toolCallId: TOOL_CALL_ID });
    drive("onCustomEvent", {
      name: "approval_requested",
      value: {
        interrupt_id: "int-hold",
        prompt: "Allow this?",
        tool_name: "action__create-ticket",
        tool_call_id: TOOL_CALL_ID,
      },
    });
    if (stage === "requested") return snapshot();
    drive("onCustomEvent", {
      name: "approval_resolved",
      value: { interrupt_id: "int-hold", approved: true },
    });
    if (stage === "resolved") return snapshot();
    drive("onToolCallResultEvent", { toolCallId: TOOL_CALL_ID });
    if (stage === "result") return snapshot();
    drive("onRunFinishedEvent", { runId: RUN_ID });
    return snapshot();
  }

  async function renderStage(stage: {
    cards: readonly ApprovalCardModel[];
    anchors: MarkerAnchorsSnapshot;
  }) {
    await act(async () => {
      root.render(
        <MessageList
          rows={transcriptRowsOf(HISTORY, stage.anchors, false)}
          cards={[...stage.cards]}
        />,
      );
      await Promise.resolve();
    });
    return host.querySelector<HTMLDetailsElement>(
      "[data-tf-activity-group] > details",
    );
  }

  it("the fold opens while the decision awaits and folds once it is answered; the ROW keeps its durable hold across the card's pruning", async () => {
    expect(stageThrough("requested").cards).toHaveLength(1);
    expect((await renderStage(stageThrough("requested")))?.open).toBe(true);
    // Answered, with the call's result already recorded in this history
    // and nothing live: finished work folds.
    expect((await renderStage(stageThrough("resolved")))?.open).toBe(false);
    // The gated call's result PRUNES the card (the store's own rule) —
    // the row's hold rides the durable marker anchor, not the store, so
    // the ROW inside stays open for the member who expands the fold.
    expect(stageThrough("result").cards).toHaveLength(0);
    expect((await renderStage(stageThrough("result")))?.open).toBe(false);
    expect(
      host.querySelector<HTMLDetailsElement>("[data-tf-activity-step] details")
        ?.open,
    ).toBe(true);
    expect((await renderStage(stageThrough("run-finished")))?.open).toBe(false);
  });

  it("a reloaded settled thread renders the same folded state (Law 9): full replay rebuilds the marker anchor, never the card", async () => {
    // Production's reload of a settled thread: hydratePendingApprovals
    // rebuilds nothing (the turn is not paused), and a full replay's
    // transient card dies to the replayed result — the cards prop is
    // EMPTY. The row's hold comes from the row model alone (the replayed
    // approval_requested marker rebuilt the anchor); the fold is settled
    // work and reads folded, exactly as it did live once the turn ended.
    const settled = stageThrough("run-finished");
    expect(settled.cards).toHaveLength(0);
    const fold = await renderStage(settled);
    expect(fold?.open).toBe(false);
    expect(
      host.querySelector<HTMLDetailsElement>("[data-tf-activity-step] details")
        ?.open,
    ).toBe(true);
    // A later user turn changes nothing about it.
    await act(async () => {
      root.render(
        <MessageList
          rows={transcriptRowsOf(
            [
              ...HISTORY,
              { id: "u-next", role: "user", content: "Thanks — next." },
            ],
            settled.anchors,
            false,
          )}
          cards={[]}
        />,
      );
      await Promise.resolve();
    });
    expect(
      host.querySelector<HTMLDetailsElement>(
        "[data-tf-activity-group] > details",
      ),
    ).toBe(fold);
    expect(fold?.open).toBe(false);
  });
});

describe("a member's denial survives the card's pruning", () => {
  // The breaking case for the join, driven through the REAL inbox
  // recorder, the real cancel recorder and the real denial recorder over
  // one event history — the wire's exact shape for a denial: the ask,
  // the approval_resolved{approved:false} receipt (recorded at the head
  // of the resumed invocation), then the resumed round's TOOL_CALL_RESULT
  // stamped `cancelled`, which PRUNES the card. If the row read the card
  // it would fall back to "Interrupted" at exactly that beat.
  const RUN_ID = "run-deny";
  const TOOL_CALL_ID = "t-deny";
  const HISTORY: Message[] = [
    { id: "u-deny", role: "user", content: "Refund the order." },
    {
      id: "a-deny",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: TOOL_CALL_ID,
          type: "function",
          function: { name: "action__refund-order", arguments: '{"o":17}' },
        },
      ],
    },
    {
      id: "r-deny",
      role: "tool",
      toolCallId: TOOL_CALL_ID,
      content: "CONFIRMATION_FAILED: The user declined this action.",
    },
    { id: "a-deny-2", role: "assistant", content: "Understood — leaving it." },
  ];
  const EMPTY_SNAPSHOT: MarkerAnchorsSnapshot = {
    resumeAnchors: new Map(),
    turnFailedAnchors: new Map(),
    subagentDeliveryAnchors: new Map(),
    toolErrorAnchors: new Map(),
    toolCancelAnchors: new Set(),
    toolRefusalAnchors: new Map(),
    toolOffloadAnchors: new Set(),
    toolCallDisplayAnchors: new Map(),
    toolSchemaAnchors: new Map(),
    blockTimingAnchors: new Map(),
    turnUsageAnchors: new Map(),
    memoryProvenanceAnchors: new Map(),
    memoryAttributionAnchors: new Map(),
  };

  function stageThrough(
    stage: "requested" | "resolved" | "result" | "run-finished",
  ): {
    cards: readonly ApprovalCardModel[];
    anchors: MarkerAnchorsSnapshot;
  } {
    const inbox = new ApprovalInbox();
    let cards: readonly ApprovalCardModel[] = [];
    let ledger: ToolDenialLedger = EMPTY_TOOL_DENIAL_LEDGER;
    let cancels: ReadonlySet<string> = EMPTY_TOOL_CANCEL_ANCHORS;
    const recorders = [
      approvalInboxRecorder(
        inbox,
        (next) => {
          cards = next;
        },
        () => undefined,
      ),
      toolDenialRecorder((marker) => {
        ledger = withToolDenialMarkerFolded(ledger, marker);
      }),
      toolCancelRecorder((toolCallId) => {
        cancels = withToolCancelAnchored(cancels, toolCallId);
      }),
    ];
    const drive = (name: string, event: unknown) => {
      for (const recorder of recorders) {
        (
          (recorder as Record<string, unknown>)[name] as
            ((payload: { event: unknown }) => void) | undefined
        )?.({ event });
      }
      cards = inbox.cards();
    };
    const snapshot = () => ({
      cards,
      anchors: {
        ...EMPTY_SNAPSHOT,
        toolCancelAnchors: cancels,
        toolDenialAnchors: ledger.denied,
      },
    });
    drive("onRunStartedEvent", { runId: RUN_ID });
    drive("onToolCallStartEvent", { toolCallId: TOOL_CALL_ID });
    drive("onCustomEvent", {
      name: "approval_requested",
      value: {
        interrupt_id: "int-deny",
        prompt: "Refund order 17?",
        tool_name: "action__refund-order",
        tool_call_id: TOOL_CALL_ID,
      },
    });
    if (stage === "requested") return snapshot();
    drive("onCustomEvent", {
      name: "approval_resolved",
      value: { interrupt_id: "int-deny", approved: false },
    });
    if (stage === "resolved") return snapshot();
    drive(
      "onToolCallResultEvent",
      withToolOutcomeLifted({
        type: "TOOL_CALL_RESULT",
        messageId: `${TOOL_CALL_ID}-result`,
        toolCallId: TOOL_CALL_ID,
        content: "CONFIRMATION_FAILED: The user declined this action.",
        cancelled: true,
      } as unknown as BaseEvent),
    );
    if (stage === "result") return snapshot();
    drive("onRunFinishedEvent", { runId: RUN_ID });
    return snapshot();
  }

  // The messages the projection sees at each stage: before the resumed
  // round's result lands the history holds only the call.
  const BEFORE_RESULT = HISTORY.slice(0, 2);

  function stateAt(
    stage: Parameters<typeof stageThrough>[0],
    messages: readonly Message[] = HISTORY,
  ) {
    const { anchors } = stageThrough(stage);
    const row = transcriptRowsOf(messages, anchors, false).find(
      (candidate) => candidate.kind === "tool-call",
    );
    return row?.kind === "tool-call" ? row.state : undefined;
  }

  it("reads denied from the receipt on, through the pruning result and the run terminal", async () => {
    // Before the receipt the row knows only that a decision rode it.
    expect(stageThrough("requested").cards).toHaveLength(1);
    expect(stateAt("requested", BEFORE_RESULT)).toBe("input-streaming");
    // The receipt lands first — before the cancelled result — so the row
    // is already denied while the card is still answered: no beat where
    // it reads Interrupted.
    expect(stageThrough("resolved").cards[0]?.status.kind).toBe("answered");
    expect(stateAt("resolved", BEFORE_RESULT)).toBe("denied");
    // The cancelled result PRUNES the card — and the row stays denied,
    // never falling to the cancel stamp that arrived with it.
    const result = stageThrough("result");
    expect(result.cards).toHaveLength(0);
    expect(result.anchors.toolCancelAnchors.has(TOOL_CALL_ID)).toBe(true);
    expect(stateAt("result")).toBe("denied");
    expect(stateAt("run-finished")).toBe("denied");

    // And rendered: the not-approved pill, the fold's own suffix, plain ink.
    const settled = stageThrough("run-finished");
    await act(async () => {
      root.render(
        <MessageList
          rows={transcriptRowsOf(HISTORY, settled.anchors, false)}
          cards={[...settled.cards]}
        />,
      );
      await Promise.resolve();
    });
    const summary = host.querySelector(
      "[data-tf-activity-group] > details > summary",
    );
    expect(summary?.textContent).toBe("Worked");
    expect(host.querySelector("[data-tf-state-pill]")?.textContent).toBe(
      "Not approved",
    );
    expect(host.querySelector(".tf\\:text-tf-destructive")).toBeNull();
  });

  it("a reloaded settled thread renders the same state (Law 9): the full replay rebuilds the ledger, never the card", () => {
    // Production's reload of a settled thread: the pause is over, so
    // hydratePendingApprovals rebuilds nothing, and the replay's
    // transient card dies to the replayed result — the cards prop is
    // EMPTY. The state comes from the ledger alone.
    const reloaded = stageThrough("run-finished");
    expect(reloaded.cards).toHaveLength(0);
    expect(stateAt("run-finished")).toBe("denied");
    // The negative control for the join itself: the same history with
    // the ledger withheld is exactly the defect — "Interrupted".
    const withoutLedger = {
      ...reloaded.anchors,
      toolDenialAnchors: new Set<string>(),
    };
    const row = transcriptRowsOf(HISTORY, withoutLedger, false).find(
      (candidate) => candidate.kind === "tool-call",
    );
    expect(row?.kind === "tool-call" && row.state).toBe("cancelled");
  });
});

describe("placement holds and decay", () => {
  function foldEl(): HTMLDetailsElement {
    const details = host.querySelector<HTMLDetailsElement>(
      "[data-tf-activity-group] > details",
    );
    if (details === null) {
      throw new Error("the transcript rendered no fold");
    }
    return details;
  }
  async function renderList(
    rows: readonly TranscriptRow[],
    cards: readonly ApprovalCardModel[] = [],
  ) {
    await act(async () => {
      root.render(
        <ToolViewRegistryContext.Provider value={VIEW_REGISTRY}>
          <MessageList rows={rows} cards={cards} />
        </ToolViewRegistryContext.Provider>,
      );
      await Promise.resolve();
    });
  }

  it("a running view-bearing member opens its fold — the working section — and the view resolves into the row body", async () => {
    await renderList([viewToolRow("one", "input-available")]);
    expect(foldEl().open).toBe(true);
    // The view really resolved into the row body.
    expect(foldEl().textContent).toContain("authored reading");
  });

  it("a settled view-bearing member holds nothing open (the finished-work control)", async () => {
    // The view resolved, the row inside holds itself open for the turn
    // — but the FOLD is finished work and folds, so a member expanding
    // it finds the view ready.
    await renderList([viewToolRow("one")]);
    expect(foldEl().open).toBe(false);
    expect(
      foldEl().querySelector<HTMLDetailsElement>(
        "[data-tf-activity-step] details",
      )?.open,
    ).toBe(true);
  });

  it("a view-bearing fold behind a user turn boundary is not held (the currency control)", async () => {
    await renderList([viewToolRow("one"), userRow("u1")]);
    expect(foldEl().open).toBe(false);
  });

  it("settling runs on the same element: the fold collapses when its work finishes, without remounting", async () => {
    await renderList([viewToolRow("one", "input-available")]);
    const held = foldEl();
    // The path's precondition, observed — not just the end state.
    expect(held.open).toBe(true);
    await renderList([viewToolRow("one")]);
    // Same <details> element (the fold key survived, nothing
    // remounted), now programmatically released and closed.
    expect(foldEl()).toBe(held);
    expect(held.open).toBe(false);
  });

  it("a member's explicit expand survives settling and the next user turn", async () => {
    await renderList([viewToolRow("one", "input-available")]);
    const held = foldEl();
    expect(held.open).toBe(true);
    // The member collapses (arming the pin), then re-expands: the fold
    // is theirs now, so neither the settle nor the next turn closes it.
    await collapseAsMember(held);
    expect(held.open).toBe(false);
    await expandAsMember(held);
    expect(held.open).toBe(true);
    await renderList([viewToolRow("one")]);
    expect(foldEl()).toBe(held);
    expect(held.open).toBe(true);
    await renderList([viewToolRow("one"), userRow("u1")]);
    expect(foldEl()).toBe(held);
    expect(held.open).toBe(true);
  });

  it("a member's explicit collapse survives a later running call in the same fold", async () => {
    // Posed on a settled fold (nothing running), so the later running
    // arrival is a genuine undefined→true prop flip — the transition
    // that re-opens an unpinned fold (the running-member test above is
    // that control). The member inspects and closes it (both gestures
    // arm the pin), then more work lands.
    await renderList([toolRow("one")]);
    const fold = foldEl();
    expect(fold.open).toBe(false);
    await expandAsMember(fold);
    await collapseAsMember(fold);
    expect(fold.open).toBe(false);
    // A running call lands in the same cluster: the fold's key (its
    // first work member) is unchanged, and the pin outranks the arrival.
    await renderList([toolRow("one"), toolRow("two", "input-available")]);
    expect(foldEl()).toBe(fold);
    expect(fold.open).toBe(false);
  });

  it("a failure never forces a fold open — pinned or not", async () => {
    // The row's own red pill tells the story; a finished section folds
    // whatever its outcome and its headline stays the plain cost.
    await renderList([toolRow("one")]);
    const fold = foldEl();
    expect(fold.open).toBe(false);
    await renderList([toolRow("one"), toolRow("two", "output-error")]);
    expect(foldEl()).toBe(fold);
    expect(fold.open).toBe(false);
    expect(fold.querySelector(":scope > summary")?.textContent).toBe("Worked");
  });

  it("a member collapses a running fold with a single activation", async () => {
    // The capture-committed pin must not cost the member their click:
    // one modelled activation must close an open fold.
    await renderList([toolRow("one", "input-available")]);
    const held = foldEl();
    expect(held.open).toBe(true);
    await collapseAsMember(held);
    expect(held.open).toBe(false);
  });

  it("a member expands a settled fold with a single activation — the keyboard-shaped click included — and a later user turn leaves it open", async () => {
    await renderList([viewToolRow("one"), userRow("u1")]);
    const decayed = foldEl();
    expect(decayed.open).toBe(false);
    // The helper's MouseEvent carries detail 0 — the shape a keyboard
    // activation synthesizes — so both input paths ride this gesture.
    await expandAsMember(decayed);
    expect(decayed.open).toBe(true);
    // Another user turn begins: the release is pinned to native and the
    // member's expand survives.
    await renderList([viewToolRow("one"), userRow("u1"), userRow("u2")]);
    expect(foldEl()).toBe(decayed);
    expect(decayed.open).toBe(true);
  });

  it("placementHolds={false} releases the rows' hold to native — the settled drill-in is never a wall of expanded panes (round-2 finding 1)", async () => {
    // A child transcript is one turn by construction (its only user row
    // is the opening brief), so the next-user-turn decay can never fire
    // there; ChildTranscript passes its dispatch's running fact as this
    // switch. Off, the same view-bearing history renders fully native.
    // The fold itself is settled work and folds under both settings.
    await act(async () => {
      root.render(
        <ToolViewRegistryContext.Provider value={VIEW_REGISTRY}>
          <MessageList
            rows={[userRow("brief"), viewToolRow("one"), viewToolRow("two")]}
            cards={[]}
            placementHolds={false}
          />
        </ToolViewRegistryContext.Provider>,
      );
      await Promise.resolve();
    });
    expect(foldEl().open).toBe(false);
    expect(host.querySelectorAll("details[open]")).toHaveLength(0);
    // The default (holds on) over the identical history is the control:
    // both rows hold open inside the folded section.
    await act(async () => {
      root.render(
        <ToolViewRegistryContext.Provider value={VIEW_REGISTRY}>
          <MessageList
            rows={[userRow("brief"), viewToolRow("one"), viewToolRow("two")]}
            cards={[]}
          />
        </ToolViewRegistryContext.Provider>,
      );
      await Promise.resolve();
    });
    expect(foldEl().open).toBe(false);
    expect(
      host.querySelectorAll("[data-tf-activity-step] details[open]"),
    ).toHaveLength(2);
  });

  it("a member row's own summary does not arm the fold's pin", async () => {
    // The discrimination the capture filter exists for: toggling a tool
    // row INSIDE the rail is not a judgement about the fold. Observed
    // through the running-arrival flip: after the member-row click, work
    // landing in the fold still opens it — the pin was never armed. The
    // pinned twin is the "collapse survives a later running call" test
    // above, whose fold-summary gestures keep the same arrival closed.
    await renderList([toolRow("one")]);
    const fold = foldEl();
    expect(fold.open).toBe(false);
    // Programmatic open (a queued toggle with the ref unarmed) — proves
    // in passing that non-member toggles never pin either.
    await act(async () => {
      fold.open = true;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const memberSummary = fold.querySelector<HTMLElement>(
      "[data-tf-activity-step] summary",
    );
    if (memberSummary === null) {
      throw new Error("the rail rendered no member summary");
    }
    await act(async () => {
      memberSummary.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      fold.open = false;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fold.open).toBe(false);
    await renderList([toolRow("one"), toolRow("two", "input-available")]);
    expect(foldEl()).toBe(fold);
    expect(fold.open).toBe(true);
  });

  it("a view-bearing cluster merges into the settled episode — one fold, the first cluster's element survives (end to end)", async () => {
    // An interleaved OPEN turn: work → narration → view-bearing work.
    // While open, two cluster folds render; once the turn settles, both
    // clusters and the narration unify into ONE fold — the first
    // cluster's element — and the view-bearing row rides inside it with
    // its view slot.
    const rows: TranscriptRow[] = [
      toolRow("one"),
      proseRow("p1", "Found the guides."),
      viewToolRow("two"),
      proseRow("p2", "All done."),
    ];
    await act(async () => {
      root.render(
        <ToolViewRegistryContext.Provider value={VIEW_REGISTRY}>
          <MessageList rows={rows} cards={[]} turnOpen />
        </ToolViewRegistryContext.Provider>,
      );
      await Promise.resolve();
    });
    const liveFolds = host.querySelectorAll<HTMLDetailsElement>(
      "[data-tf-activity-group] > details",
    );
    expect(liveFolds).toHaveLength(2);
    const firstFold = liveFolds[0];
    await act(async () => {
      root.render(
        <ToolViewRegistryContext.Provider value={VIEW_REGISTRY}>
          <MessageList rows={rows} cards={[]} turnOpen={false} />
        </ToolViewRegistryContext.Provider>,
      );
      await Promise.resolve();
    });
    const settledFolds = host.querySelectorAll<HTMLDetailsElement>(
      "[data-tf-activity-group] > details",
    );
    expect(settledFolds).toHaveLength(1);
    expect(settledFolds[0]).toBe(firstFold);
    expect(
      firstFold.querySelector(
        '[data-tf-tool-call-id="two"] [data-tf-tool-view="acme.reading"]',
      ),
    ).not.toBeNull();
  });

  it("staging shape: a failed action view → narration → browser work → final prose settles to one fold; the action row's view is inspectable inside it", async () => {
    const rows: TranscriptRow[] = [
      actionRow("act"),
      proseRow("p1", "The publish call failed; checking the page instead."),
      namedToolRow("nav", "navigate"),
      namedToolRow("read", "read_page"),
      namedToolRow("hl", "highlight"),
      proseRow("p2", "The Release control is highlighted."),
    ];
    await renderList(rows);
    const folds = host.querySelectorAll<HTMLDetailsElement>(
      "[data-tf-activity-group] > details",
    );
    expect(folds).toHaveLength(1);
    const fold = folds[0];
    // Settled work folds; no member carries timing, so the headline is
    // the neutral register.
    expect(fold.open).toBe(false);
    expect(fold.querySelector("summary")?.textContent).toContain("Worked");
    // Transcript order inside: the action, the narration where it was
    // spoken, then the browser work.
    const steps = [
      ...fold.querySelectorAll<HTMLElement>("[data-tf-activity-step]"),
    ];
    expect(steps).toHaveLength(5);
    expect(
      steps[0].querySelector('[data-tf-tool-call-id="act"]'),
    ).not.toBeNull();
    expect(steps[1].hasAttribute("data-tf-activity-narration")).toBe(true);
    expect(steps[1].textContent).toContain("checking the page");
    expect(
      steps[2].querySelector('[data-tf-tool-call-id="nav"]'),
    ).not.toBeNull();
    expect(
      steps[3].querySelector('[data-tf-tool-call-id="read"]'),
    ).not.toBeNull();
    expect(
      steps[4].querySelector('[data-tf-tool-call-id="hl"]'),
    ).not.toBeNull();
    // The final answer stays outside the fold.
    expect(fold.textContent).not.toContain(
      "The Release control is highlighted.",
    );
    expect(host.textContent).toContain("The Release control is highlighted.");
    // Expanding the fold exposes the action row; a failed rung-3 row is
    // closed by default, and its body carries the resolved action view.
    await expandAsMember(fold);
    const actionDetails = fold.querySelector<HTMLDetailsElement>(
      '[data-tf-tool-call-id="act"]',
    );
    expect(actionDetails?.open).toBe(false);
    expect(
      fold.querySelector(
        '[data-tf-tool-call-id="act"] [data-tf-semantic-view] [data-tf-tool-view="teaflask.action"]',
      ),
    ).not.toBeNull();
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      fold.querySelector('[data-tf-tool-call-id="act"] [data-tf-action-view]'),
    ).not.toBeNull();
    // The open-turn control: the same rows while the turn is still
    // running or paused keep the per-cluster chronology — two folds,
    // the narration a top-level row.
    await act(async () => {
      root.render(
        <ToolViewRegistryContext.Provider value={VIEW_REGISTRY}>
          <MessageList rows={rows} cards={[]} turnOpen />
        </ToolViewRegistryContext.Provider>,
      );
      await Promise.resolve();
    });
    expect(
      host.querySelectorAll("[data-tf-activity-group] > details"),
    ).toHaveLength(2);
    expect(host.querySelector("[data-tf-activity-narration]")).toBeNull();
  });
});
