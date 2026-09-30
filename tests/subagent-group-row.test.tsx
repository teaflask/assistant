// @vitest-environment jsdom
/**
 * The widget's delegation group row under the ledger join: a joined
 * ledger row outranks a stale launched wire receipt for
 * running/failed/label/note, cancellation stays wire-only, and a host
 * without the read (the empty context default) still renders honest
 * receipt-only groups.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { SubagentDrillInContext } from "../src/components/subagent-drill-in";
import { SubagentExecutionWorkContext } from "../src/components/subagent-execution-work";
import type { CoworkerExecutionWork } from "../src/core/coworker-execution-work";
import {
  coworkerWorkLabelOf,
  SubagentDispatchesContext,
  SubagentGroupRow,
  type SubagentDispatchesJoin,
} from "../src/components/subagent-group-row";
import {
  dispatchIsPaused,
  dispatchIsRunning,
  type ThreadDispatch,
  type ThreadDispatchStatus,
} from "../src/contract/dispatches";
import type {
  SubagentGroupEntry,
  SubagentGroupRow as SubagentGroupRowModel,
} from "../src/core/subagent-rows";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

// THE LEDGER STATES THIS FILE DRIVES, with what the member holds for the
// coworker: nothing, the browser's work, or an owed approval. Recorded by
// the render helpers as they run — a state listed here was actually
// rendered, not merely built — and held to this table after the suite: a
// fixture set biased to one ledger state (every coworker-line case once
// rendered under a PAUSED row) cannot see a defect of a working coworker,
// and the browser-work line outliving the pause was found by eye for
// exactly that reason. An approval state records only when the rendered
// line spoke of an approval (the recorder reads the DOM after the paint),
// so the row cannot be satisfied by a card that never rendered.
type DrivenState =
  `${ThreadDispatchStatus}:${"browser-work" | "approval-work" | "no-work"}`;
const LEDGER_STATES_DRIVEN: ReadonlySet<DrivenState> = new Set<DrivenState>([
  "succeeded:no-work",
  "failed:no-work",
  "dispatched:no-work",
  "dispatched:browser-work", // the RESUMED coworker: the ledger says working, the browser's entry lingers
  "dispatched:approval-work", // the RESUMED coworker whose answered card lingers until the next read
  "paused:no-work",
  "paused:browser-work",
  "paused:approval-work",
]);
const driven = new Set<DrivenState>();

function _recordDriven(
  join: SubagentDispatchesJoin | undefined,
  work: ReadonlyMap<number, CoworkerExecutionWork> | undefined,
) {
  // Work counts only when the map holds THIS row's ordinal — the component
  // looks work up by entry ordinal, so a map populated elsewhere renders
  // nothing of the state and must not record it.
  for (const ledger of join?.byOrdinal.values() ?? []) {
    const held = work?.get(ledger.ordinal);
    if (held === undefined) {
      driven.add(`${ledger.status}:no-work`);
    } else if (held.via === "approval") {
      // Recorded only as the DOM shows it: a paused row must actually
      // speak of the approval; a running row must NOT (its answered card
      // lingers, and the row keeps its own work) — either way the state
      // was rendered, not merely built.
      const line = host.querySelector("[data-tf-subagent-coworker-work]");
      if (ledger.status === "paused") {
        if (line?.textContent.toLowerCase().includes("approv") === true) {
          driven.add("paused:approval-work");
        }
      } else if (line === null) {
        driven.add(`${ledger.status}:approval-work`);
      }
    } else {
      driven.add(`${ledger.status}:browser-work`);
    }
  }
}

afterAll(() => {
  expect([...driven].sort()).toEqual([...LEDGER_STATES_DRIVEN].sort());
});

function _entry(overrides: Partial<SubagentGroupEntry>): SubagentGroupEntry {
  return {
    toolCallId: "call-1",
    // The stale launched receipt: frozen the moment the turn ended,
    // while the child may have settled long since — the repro's shape.
    receipt: {
      outcome: "launched",
      ordinal: 0,
      label: "Survey the corpus.",
      childSessionId: "subagent-run-0",
      settled: null,
    },
    label: "Survey the corpus.",
    running: true,
    failed: false,
    cancelled: false,
    note: null,
    ...overrides,
  };
}

function _ledgerRow(overrides: Partial<ThreadDispatch>): ThreadDispatch {
  return {
    ordinal: 0,
    label: "Survey the corpus, from the ledger.",
    status: "succeeded",
    error: null,
    child_session_id: "subagent-run-0",
    created_at: "2026-08-19T10:00:00Z",
    updated_at: "2026-08-19T10:02:30Z",
    ...overrides,
  };
}

function _render(row: SubagentGroupRowModel, join?: SubagentDispatchesJoin) {
  _recordDriven(join, undefined);
  act(() => {
    root.render(
      join === undefined ? (
        <SubagentGroupRow row={row} />
      ) : (
        <SubagentDispatchesContext.Provider value={join}>
          <SubagentGroupRow row={row} />
        </SubagentDispatchesContext.Provider>
      ),
    );
  });
}

const _row: SubagentGroupRowModel = {
  kind: "subagent-group",
  key: "subagents:call-1",
  entries: [_entry({})],
};

describe("the widget subagent group row under the ledger join", () => {
  it("lets a settled ledger row outrank a stale launched receipt", () => {
    const settled = _ledgerRow({});
    _render(_row, {
      byOrdinal: new Map([[settled.ordinal, settled]]),
    });

    expect(host.textContent).toContain("Ran 1 subagent");
    expect(host.querySelector("[data-tf-shimmer-text]")).toBeNull();
    expect(host.textContent).toContain("Finished");
    // The ledger's non-empty label wins over the wire's.
    expect(host.textContent).toContain("Survey the corpus, from the ledger.");
  });

  it("a settled ledger row shows its cost without dumping its report", () => {
    const settled = _ledgerRow({
      summary: "Three guides matched; one needs a wording fix.",
    });
    _render(_row, { byOrdinal: new Map([[settled.ordinal, settled]]) });
    // The standalone metadata line speaks the settled-fold SENTENCE
    // (no status word beside it owns the verb) — 10:00:00 → 10:02:30.
    expect(host.querySelector("[data-tf-subagent-worked]")?.textContent).toBe(
      "Worked for 2m 30s",
    );
    expect(host.querySelector("[data-tf-subagent-summary]")).toBeNull();
    expect(host.textContent).not.toContain(
      "Three guides matched; one needs a wording fix.",
    );

    // A running row has no clock either.
    const running = _ledgerRow({ status: "dispatched" });
    _render(_row, { byOrdinal: new Map([[running.ordinal, running]]) });
    expect(host.querySelector("[data-tf-subagent-worked]")).toBeNull();
    expect(host.querySelector("[data-tf-subagent-summary]")).toBeNull();

    // A receipt-only row (no ledger) has no timestamps — nothing renders.
    _render(
      {
        kind: "subagent-group",
        key: "subagents:call-1",
        entries: [_entry({ running: false })],
      },
      { byOrdinal: new Map() },
    );
    expect(host.querySelector("[data-tf-subagent-worked]")).toBeNull();
  });

  it("wears the loud pixel on a failed ledger row and shows its reason", () => {
    const failed = _ledgerRow({
      status: "failed",
      error: "The coworker ran out of context.",
    });
    _render(_row, {
      byOrdinal: new Map([[failed.ordinal, failed]]),
    });

    expect(host.querySelector(".tf\\:text-tf-destructive")).not.toBeNull();
    expect(host.textContent).toContain("Failed");
    expect(host.textContent).toContain("The coworker ran out of context.");
    // The loss survives collapse: never a clean "Ran 1 subagent".
    expect(host.textContent).toContain("1 failed");
    expect(host.querySelector("[data-tf-shimmer-text]")).toBeNull();
  });

  it("a wire-cancelled ask whose coworker still works reads as working — never a live shimmer beside a terminal pill", () => {
    // Two truths at once (round 3): `cancelled` is the WIRE's fact — the
    // parent turn was interrupted, cancelling the dispatch call — while
    // `running` is the LEDGER's: the child is autonomous and still
    // computing. The row's own state language must not contradict
    // itself; the live child's label shimmers, and the interruption
    // speaks on this row only once the child itself settles (the group
    // counts carry it meanwhile).
    const stillWorking = _ledgerRow({ status: "dispatched" });
    _render(
      {
        kind: "subagent-group",
        key: "subagents:call-1",
        entries: [_entry({ cancelled: true })],
      },
      { byOrdinal: new Map([[stillWorking.ordinal, stillWorking]]) },
    );
    expect(
      host.querySelector("[data-tf-subagent-entry] [data-tf-shimmer-text]"),
    ).not.toBeNull();
    expect(host.textContent).not.toContain("Interrupted");

    // The child settles: now the ask's interruption is this row's story.
    const settled = _ledgerRow({ status: "succeeded" });
    _render(
      {
        kind: "subagent-group",
        key: "subagents:call-1",
        entries: [_entry({ cancelled: true, running: false })],
      },
      { byOrdinal: new Map([[settled.ordinal, settled]]) },
    );
    expect(host.textContent).toContain("Interrupted");
    expect(host.querySelector("[data-tf-shimmer-text]")).toBeNull();
  });

  it("shows the loss on the group mark DURING a live fan-out — the failed dot never hides behind running siblings", () => {
    // The pulsing running badge is gone (liveness is the headline's
    // shimmer), so the destructive dot is the mark's only badge — and it
    // must show while a sibling still works, not only at settle (the
    // count pill pins the same rule).
    const running = _ledgerRow({ status: "dispatched" });
    const failed = _ledgerRow({
      ordinal: 1,
      status: "failed",
      error: "The coworker ran out of context.",
      child_session_id: "subagent-run-1",
    });
    _render(
      {
        kind: "subagent-group",
        key: "subagents:call-1",
        entries: [
          _entry({}),
          _entry({
            toolCallId: "call-2",
            receipt: {
              outcome: "launched",
              ordinal: 1,
              label: "Map every kettle model.",
              childSessionId: "subagent-run-1",
              settled: null,
            },
            label: "Map every kettle model.",
          }),
        ],
      },
      {
        byOrdinal: new Map([
          [running.ordinal, running],
          [failed.ordinal, failed],
        ]),
      },
    );
    expect(host.textContent).toContain("Running 1 of 2 subagents · 1 failed");
    // The loud pixel on the mark itself (bg-, never the row icons' text-
    // ink), visible while the fan-out is still live.
    expect(host.querySelector(".tf\\:bg-tf-destructive")).not.toBeNull();
    // And the live claim rides beside it, not instead of it.
    expect(host.querySelector("[data-tf-shimmer-text]")).not.toBeNull();
  });

  it("keeps a wire-cancelled dispatch cancelled — the ledger never speaks cancellation", () => {
    const unrelated = _ledgerRow({
      ordinal: 9,
      child_session_id: "subagent-run-9",
    });
    _render(
      {
        kind: "subagent-group",
        key: "subagents:call-1",
        entries: [_entry({ receipt: null, running: false, cancelled: true })],
      },
      { byOrdinal: new Map([[unrelated.ordinal, unrelated]]) },
    );

    expect(host.textContent).toContain("1 subagent interrupted");
    // The affected row wears the state pill in the shared vocabulary
    // (§8: a cancelled call reads "Interrupted" in state language).
    expect(host.textContent).toContain("Interrupted");
    expect(host.textContent).not.toContain("Ran");
  });

  it("renders wire-only under the empty context default — hosts without the read are unchanged", () => {
    _render(_row);

    expect(host.textContent).toContain("Running 1 subagent");
    expect(host.textContent).toContain("Survey the corpus.");
    expect(host.querySelector("[data-tf-shimmer-text]")).not.toBeNull();
    // No drill-in stream feeds this host, so the status line falls back
    // to the visible word — the running state must survive in words
    // (reduced motion collapses the shimmer to plain text, and the
    // ornament slot is deliberately empty).
    expect(host.textContent).toContain("Working");
    expect(host.querySelector("[data-tf-subagent-current-work]")).toBeNull();
  });

  it("falls back to the wire label when the ledger's is empty", () => {
    const blank = _ledgerRow({ label: "" });
    _render(_row, {
      byOrdinal: new Map([[blank.ordinal, blank]]),
    });

    expect(host.textContent).toContain("Survey the corpus.");
    expect(host.textContent).not.toContain("from the ledger");
  });
});

describe("the delegation tree markup", () => {
  it("keeps the forced-open-while-running idiom and draws connectors per child", () => {
    _render({
      kind: "subagent-group",
      key: "subagents:call-1",
      entries: [
        _entry({}),
        _entry({
          toolCallId: "call-2",
          receipt: {
            outcome: "launched",
            ordinal: 1,
            label: "Second task.",
            childSessionId: "subagent-run-1",
            settled: null,
          },
          label: "Second task.",
        }),
      ],
    });

    // Running children force the disclosure open.
    expect(host.querySelector("details")?.open).toBe(true);
    const rows = [...host.querySelectorAll("li")];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      // Two aria-hidden connector spans per row: the trunk, then the elbow.
      expect(row.querySelectorAll(":scope > span[aria-hidden]")).toHaveLength(
        2,
      );
    }
    const [first, last] = rows.map(
      (row) => row.querySelector(":scope > span[aria-hidden]")?.className ?? "",
    );
    // A full-height trunk chains into the next row; the last row's trunk
    // stops at its own elbow so the tree never reads as a border.
    expect(first).toContain("tf:h-full");
    expect(last).toContain("tf:h-5.5");
  });
});

/** A whole drill-in seam around a spied open — the round-4 members are
 *  quiet defaults here (these tests exercise the row's open path). */
function _seamOf(
  open: (childSessionId: string, opener: HTMLElement | null) => void,
) {
  return {
    open,
    dismiss: () => undefined,
    openChildSessionId: null,
    previewId: "probe-preview",
  };
}

describe("the drill-in affordance", () => {
  it("a ledgered row is a button that opens the child's transcript", () => {
    const open = vi.fn();
    const join: SubagentDispatchesJoin = {
      byOrdinal: new Map([[0, _ledgerRow({})]]),
    };
    act(() => {
      root.render(
        <SubagentDrillInContext.Provider value={_seamOf(open)}>
          <SubagentDispatchesContext.Provider value={join}>
            <SubagentGroupRow row={_row} />
          </SubagentDispatchesContext.Provider>
        </SubagentDrillInContext.Provider>,
      );
    });
    const button = host.querySelector<HTMLButtonElement>("li button");
    expect(button).not.toBeNull();
    const chevron = button?.querySelector('svg[class*="opacity-0"]');
    expect(chevron?.getAttribute("class")).toContain("tf:opacity-0");
    expect(chevron?.getAttribute("class")).toContain(
      "tf:group-hover/subagent:opacity-100",
    );
    expect(chevron?.getAttribute("class")).toContain(
      "tf:group-aria-expanded/subagent:opacity-100",
    );
    act(() => {
      button?.click();
    });
    // The row hands ITSELF over as the opener Back restores — it
    // survives the visit under the inert cover, and no activeElement
    // read is trusted (shadow hosts and Safari both lie there).
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe("subagent-run-0");
    expect(open.mock.calls[0][1]).toBe(button);
  });

  it("a receipt-only row renders no drill-in even with the seam", () => {
    // The ledger doesn't vouch for this child: nothing to stream by.
    const open = vi.fn();
    act(() => {
      root.render(
        <SubagentDrillInContext.Provider value={_seamOf(open)}>
          <SubagentGroupRow row={_row} />
        </SubagentDrillInContext.Provider>,
      );
    });
    expect(host.querySelector("li button")).toBeNull();
  });

  it("a seamless host renders no drill-in even with the ledger", () => {
    const join: SubagentDispatchesJoin = {
      byOrdinal: new Map([[0, _ledgerRow({})]]),
    };
    _render(_row, join);
    expect(host.querySelector("li button")).toBeNull();
  });
});

describe("a resume chain in the transcript", () => {
  it("keeps each receipt bound to the ask that launched it", () => {
    // One child asked twice: the original row and its resume row share
    // child_session_id but carry their own ordinals. A session-keyed map
    // would let the resume row overwrite the original — the original
    // receipt would wear the follow-up's excerpt and running state.
    const original = _ledgerRow({});
    const resume = _ledgerRow({
      ordinal: 1,
      label: "How many are blue, from the ledger.",
      status: "dispatched",
    });
    _render(
      {
        kind: "subagent-group",
        key: "subagents:call-1",
        entries: [
          _entry({}),
          _entry({
            toolCallId: "call-2",
            receipt: {
              outcome: "launched",
              ordinal: 1,
              label: "How many are blue?",
              childSessionId: "subagent-run-0",
              settled: null,
            },
            label: "How many are blue?",
          }),
        ],
      },
      {
        byOrdinal: new Map([
          [original.ordinal, original],
          [resume.ordinal, resume],
        ]),
      },
    );

    // Both asks render with their OWN ledger labels — the original's
    // excerpt intact beside the running follow-up.
    expect(host.textContent).toContain("Survey the corpus, from the ledger.");
    expect(host.textContent).toContain("How many are blue, from the ledger.");
  });
});

describe("the coworker's line names what the member's browser does for it", () => {
  function _renderWithWork(
    join: SubagentDispatchesJoin,
    work: ReadonlyMap<number, CoworkerExecutionWork>,
  ) {
    act(() => {
      root.render(
        <SubagentDispatchesContext.Provider value={join}>
          <SubagentExecutionWorkContext.Provider value={work}>
            <SubagentGroupRow row={_row} />
          </SubagentExecutionWorkContext.Provider>
        </SubagentDispatchesContext.Provider>,
      );
    });
    _recordDriven(join, work);
  }
  const paused = _ledgerRow({ status: "paused" });
  const join = { byOrdinal: new Map([[paused.ordinal, paused]]) };

  it("a request the browser is running reads on the coworker's row, never as an assistant tool call", () => {
    _renderWithWork(
      join,
      new Map([
        [
          0,
          {
            toolName: "action__refund",
            status: "executing",
            ok: null,
            via: "browser",
          },
        ],
      ]),
    );
    const line = host.querySelector("[data-tf-subagent-coworker-work]");
    expect(line?.textContent).toBe("Running action refund in your browser");
    // The line sits inside the coworker's own entry, under its identity.
    expect(line?.closest("[data-tf-subagent-entry]")).not.toBeNull();
    expect(host.querySelector("[data-tf-subagent-current-work]")).toBeNull();
  });

  it("an open ask, a reported one and a failed one each say so", () => {
    for (const [status, ok, expected] of [
      ["pending", null, "Waiting to run action refund in your browser"],
      ["reported", true, "Ran action refund in your browser"],
      ["reported", false, "action refund failed in your browser"],
    ] as const) {
      _renderWithWork(
        join,
        new Map([
          [
            0,
            {
              interruptId: "i",
              toolName: "action__refund",
              status,
              ok,
              via: "browser",
            },
          ],
        ]),
      );
      expect(
        host.querySelector("[data-tf-subagent-coworker-work]")?.textContent,
      ).toBe(expected);
    }
  });

  it("a paused row the browser holds nothing for reads paused; a running row reads its work", () => {
    _renderWithWork(join, new Map());
    expect(
      host.querySelector("[data-tf-subagent-coworker-work]")?.textContent,
    ).toBe("Paused, waiting on you");

    const running = _ledgerRow({ status: "dispatched" });
    _renderWithWork(
      { byOrdinal: new Map([[running.ordinal, running]]) },
      new Map(),
    );
    expect(host.querySelector("[data-tf-subagent-coworker-work]")).toBeNull();
    expect(host.textContent).toContain("Working");
  });

  it("a resumed row — the ledger says dispatched while the browser's entry still reads reported — speaks its own work, never the browser's", () => {
    // The state this case must enter: the ledger's word is running, not
    // paused, while the inbox still holds the coworker's reported entry
    // (it leaves only on the next conversation read).
    const resumed = _ledgerRow({ status: "dispatched" });
    expect(dispatchIsPaused(resumed)).toBe(false);
    expect(dispatchIsRunning(resumed)).toBe(true);
    const reported = new Map<number, CoworkerExecutionWork>([
      [
        0,
        {
          toolName: "action__refund",
          status: "reported",
          ok: true,
          via: "browser",
        },
      ],
    ]);

    _renderWithWork(
      { byOrdinal: new Map([[resumed.ordinal, resumed]]) },
      reported,
    );
    expect(host.querySelector("[data-tf-subagent-coworker-work]")).toBeNull();
    expect(host.textContent).not.toContain("in your browser");
    expect(host.textContent).toContain("Working");

    // The same entry under the paused row still speaks — the ledger's word
    // is the gate, not the entry's status.
    _renderWithWork(join, reported);
    expect(
      host.querySelector("[data-tf-subagent-coworker-work]")?.textContent,
    ).toBe("Ran action refund in your browser");
  });

  it("an owed approval reads on the coworker's row — waiting, approved, not approved — and never as the browser's work", () => {
    for (const [status, ok, expected] of [
      ["pending", null, "Waiting for your approval to run action cancel"],
      ["reported", true, "Approved action cancel"],
      ["reported", false, "action cancel not approved"],
    ] as const) {
      _renderWithWork(
        join,
        new Map([
          [0, { toolName: "action__cancel", status, ok, via: "approval" }],
        ]),
      );
      const line = host.querySelector("[data-tf-subagent-coworker-work]");
      expect(line?.textContent).toBe(expected);
      expect(line?.closest("[data-tf-subagent-entry]")).not.toBeNull();
      expect(host.textContent).not.toContain("in your browser");
    }
    // A stale decision falls back to the paused line.
    _renderWithWork(
      join,
      new Map([
        [
          0,
          {
            toolName: "action__cancel",
            status: "stale",
            ok: null,
            via: "approval",
          },
        ],
      ]),
    );
    expect(
      host.querySelector("[data-tf-subagent-coworker-work]")?.textContent,
    ).toBe("Paused, waiting on you");
  });

  it("an approval that stopped no tool call (tool_name null on the contract) keeps its sentence and drops the clause — never a dangling 'to run '", () => {
    for (const [status, ok, expected] of [
      ["pending", null, "Waiting for your approval"],
      ["reported", true, "Approved"],
      ["reported", false, "Not approved"],
    ] as const) {
      _renderWithWork(
        join,
        new Map([[0, { toolName: null, status, ok, via: "approval" }]]),
      );
      const line = host.querySelector("[data-tf-subagent-coworker-work]");
      expect(line?.textContent).toBe(expected);
      expect(line?.textContent).not.toMatch(/ $/);
      expect(line?.textContent).not.toMatch(/^ /);
      expect(line?.textContent).not.toContain("to run");
    }
    // A browser action always names its tool on the contract
    // (ToolExecutionRequestedMarker.tool_name is required); were the name
    // ever missing, the line falls back to the paused sentence rather
    // than "Running  in your browser".
    _renderWithWork(
      join,
      new Map([
        [0, { toolName: null, status: "executing", ok: null, via: "browser" }],
      ]),
    );
    expect(
      host.querySelector("[data-tf-subagent-coworker-work]")?.textContent,
    ).toBe("Paused, waiting on you");
  });

  it("a resumed row whose answered card lingers speaks its own work, not the decision", () => {
    const resumed = _ledgerRow({ status: "dispatched" });
    _renderWithWork(
      { byOrdinal: new Map([[resumed.ordinal, resumed]]) },
      new Map([
        [
          0,
          {
            toolName: "action__cancel",
            status: "reported",
            ok: true,
            via: "approval",
          },
        ],
      ]),
    );
    expect(host.querySelector("[data-tf-subagent-coworker-work]")).toBeNull();
    expect(host.textContent).not.toContain("pprov");
    expect(host.textContent).toContain("Working");
  });

  it("coworkerWorkLabelOf is the one ladder the line speaks", () => {
    expect(coworkerWorkLabelOf(undefined, false)).toBeNull();
    expect(coworkerWorkLabelOf(undefined, true)).toBe("Paused, waiting on you");
    expect(
      coworkerWorkLabelOf(
        {
          toolName: "action__cancel",
          status: "pending",
          ok: null,
          via: "approval",
        },
        true,
      ),
    ).toBe("Waiting for your approval to run action cancel");
    expect(
      coworkerWorkLabelOf(
        {
          toolName: "action__cancel",
          status: "pending",
          ok: null,
          via: "approval",
        },
        false,
      ),
    ).toBeNull();
    expect(
      coworkerWorkLabelOf(
        {
          toolName: "action__refund",
          status: "reported",
          ok: true,
          via: "browser",
        },
        false,
      ),
    ).toBeNull();
    expect(
      coworkerWorkLabelOf(
        {
          toolName: "action__refund",
          status: "stale",
          ok: null,
          via: "browser",
        },
        true,
      ),
    ).toBe("Paused, waiting on you");
  });
});
