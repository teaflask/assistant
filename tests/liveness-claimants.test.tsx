// @vitest-environment jsdom
/** The trailing-liveness claim matrix (a SEAM, closed at its mechanism):
 * exactly one element may claim the trailing liveness beat, decided by ONE
 * arbiter (_trailingLivenessClaimantOf in use-transcript-folds.ts), across
 * every host prop combination and every tail row kind. This file EXECUTES
 * the enumeration the arbiter's comment tabulates — hosts are prop combos
 * (live × typing: Transcript passes live only; the child preview passes
 * both; the bench passes typing only; echo views pass live only) — and
 * it poses both cases that broke the class before the fix: a trailing
 * RUNNING subagent group under live (the group's shimmer plus a stacked
 * standalone headline), and typing beside live over an inert tail (the
 * dot plus the headline). A claimant here is one of the four rendered
 * signals; a streaming prose tail is itself the claim (the paced reveal
 * is the motion) and must elect none of the four. Precedence per the
 * round-2 settlement (finding 3): typing OUTRANKS the standalone
 * headline, so the out-of-scope drill-in preview (the one host passing
 * both) keeps its pre-branch silence-gap dot. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ThreadDispatch } from "../src/contract/dispatches";
import { MessageList } from "../src/components/message-list";
import { SubagentDispatchesContext } from "../src/components/subagent-group-row";
import type { TranscriptRow } from "../src/core/transcript-rows";

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

const userRow: TranscriptRow = {
  kind: "user",
  key: "u1",
  text: "Go.",
  attachments: [],
  optimistic: true,
};

const settledProse: TranscriptRow = {
  kind: "assistant-text",
  key: "p1",
  text: "Part one.",
  streaming: false,
};

const streamingProse: TranscriptRow = {
  kind: "assistant-text",
  key: "p2",
  text: "Arriving…",
  streaming: true,
};

function toolRow(state: "input-available" | "output-available"): TranscriptRow {
  return {
    kind: "tool-call",
    key: "t1",
    toolCallId: "t1",
    toolName: "docs_search",
    state,
    argsText: "{}",
    result: state === "output-available" ? "done" : undefined,
    offloaded: false,
  };
}

function groupRow(running: boolean): TranscriptRow {
  return {
    kind: "subagent-group",
    key: "g1",
    entries: [
      {
        toolCallId: "d1",
        receipt: {
          outcome: "launched",
          ordinal: 0,
          label: "Survey the guides",
          childSessionId: "child-1",
          settled: running ? null : { failed: false, note: null },
        },
        label: "Survey the guides",
        // The WIRE-side bit stays false on purpose in the running case
        // below where the LEDGER carries the truth — reviewer A's exact
        // concern: the group's liveness is derived from the dispatches
        // ledger, not just entry.running.
        running: false,
        failed: false,
        cancelled: false,
        note: null,
      },
    ],
  };
}

function ledgerOf(status: "dispatched" | "succeeded") {
  const row: ThreadDispatch = {
    ordinal: 0,
    label: "Survey the guides",
    status,
    error: null,
    child_session_id: "child-1",
    created_at: "2026-09-07T19:00:00Z",
    updated_at: "2026-09-07T19:00:00Z",
  };
  return { byOrdinal: new Map([[0, row]]) };
}

const failedReceipts: TranscriptRow = {
  kind: "turn-failed-receipts",
  key: "f1",
  receipts: ["Something went wrong while answering."],
};

const delivery: TranscriptRow = {
  kind: "subagent-delivery",
  key: "dv1",
  results: [{ ordinal: 0, label: "Survey the guides", succeeded: true }],
};

type Claimant = "fold" | "group" | "headline" | "dot" | "none";

interface MatrixCase {
  name: string;
  rows: readonly TranscriptRow[];
  ledger?: ReturnType<typeof ledgerOf>;
  /** expected claimant per (live, typing) */
  expected: {
    idle: Claimant; // live=false typing=false
    live: Claimant; // live=true  typing=false
    typing: Claimant; // live=false typing=true
    both: Claimant; // live=true typing=true (the child preview's shape: its silence gap keeps the dot)
  };
}

const MATRIX: readonly MatrixCase[] = [
  {
    name: "empty transcript",
    rows: [],
    expected: {
      idle: "none",
      live: "headline",
      typing: "dot",
      both: "dot",
    },
  },
  {
    name: "user echo tail",
    rows: [userRow],
    expected: {
      idle: "none",
      live: "headline",
      typing: "dot",
      both: "dot",
    },
  },
  {
    name: "settled prose tail (the between-calls beat)",
    rows: [userRow, settledProse],
    expected: {
      idle: "none",
      live: "headline",
      typing: "dot",
      both: "dot",
    },
  },
  {
    name: "streaming prose tail — the reveal IS the claim",
    rows: [userRow, streamingProse],
    expected: { idle: "none", live: "none", typing: "none", both: "none" },
  },
  {
    name: "fold with a running member",
    rows: [userRow, toolRow("input-available")],
    expected: { idle: "fold", live: "fold", typing: "fold", both: "fold" },
  },
  {
    name: "fold with settled members",
    rows: [userRow, toolRow("output-available")],
    expected: { idle: "none", live: "fold", typing: "dot", both: "fold" },
  },
  {
    name: "RUNNING subagent group tail (ledger-driven — the breaking case)",
    rows: [userRow, groupRow(true)],
    ledger: ledgerOf("dispatched"),
    expected: { idle: "group", live: "group", typing: "group", both: "group" },
  },
  {
    name: "settled subagent group tail",
    rows: [userRow, groupRow(false)],
    ledger: ledgerOf("succeeded"),
    expected: {
      idle: "none",
      live: "headline",
      typing: "dot",
      both: "dot",
    },
  },
  {
    name: "turn-failed receipts tail",
    rows: [userRow, failedReceipts],
    expected: {
      idle: "none",
      live: "headline",
      typing: "dot",
      both: "dot",
    },
  },
  {
    name: "delivery divider tail",
    rows: [delivery],
    expected: {
      idle: "none",
      live: "headline",
      typing: "dot",
      both: "dot",
    },
  },
];

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

/** Every rendered claim signal, by site — a fold or group SUMMARY
 *  shimmer counts once however many shimmer nodes its body holds. */
function claimants(): Claimant[] {
  const found: Claimant[] = [];
  if (
    host.querySelector(
      "[data-tf-activity-group] > details > summary [data-tf-shimmer-text]",
    ) !== null
  ) {
    found.push("fold");
  }
  if (
    host.querySelector(
      "[data-tf-subagent-group] > details > summary [data-tf-shimmer-text]",
    ) !== null
  ) {
    found.push("group");
  }
  if (host.querySelector("[data-tf-working-headline]") !== null) {
    found.push("headline");
  }
  if (host.querySelector("[data-tf-working-dot]") !== null) {
    found.push("dot");
  }
  return found;
}

async function renderCase(
  matrixCase: MatrixCase,
  live: boolean,
  typing: boolean,
) {
  await act(async () => {
    root.render(
      <SubagentDispatchesContext.Provider
        value={matrixCase.ledger ?? { byOrdinal: new Map() }}
      >
        <MessageList
          rows={matrixCase.rows}
          cards={[]}
          live={live}
          typing={typing}
        />
      </SubagentDispatchesContext.Provider>,
    );
    await Promise.resolve();
  });
}

describe("the trailing-liveness claim matrix (one claimant, every host × tail × live/typing)", () => {
  const combos: [keyof MatrixCase["expected"], boolean, boolean][] = [
    ["idle", false, false],
    ["live", true, false],
    ["typing", false, true],
    ["both", true, true],
  ];
  for (const matrixCase of MATRIX) {
    for (const [comboName, live, typing] of combos) {
      it(`${matrixCase.name} — live=${String(live)} typing=${String(typing)}`, async () => {
        await renderCase(matrixCase, live, typing);
        const found = claimants();
        // The seam's invariant: NEVER two claims in one frame.
        expect(found.length, `claims: ${found.join(",")}`).toBeLessThanOrEqual(
          1,
        );
        const expected = matrixCase.expected[comboName];
        expect(found).toEqual(expected === "none" ? [] : [expected]);
      });
    }
  }
});
