// @vitest-environment jsdom
// The process row's state language, pinned member by member: every
// ToolCallState resolves to exactly one visual treatment — the semantic
// mark stays visible in all of them, the state is always worded (sr-only
// or pill or headline), motion appears only while running, and the
// disclosure trigger keeps an accurate accessible name and expanded
// state. TVC-032/033/034/036 pin the cross-state contracts; this file
// pins each state's own anatomy so a regression names the state it broke.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToolRow } from "../src/components/tool-row";
import { reactToolView } from "../src/components/react-tool-view";
import { ToolViewRegistryContext } from "../src/components/tool-view-registry-context";
import type { ToolViewRegistry } from "../src/core/tool-view";
import type { ToolCallViewModel } from "../src/core/tool-call-display";
import {
  CAPTIONED_CANCELLED_TOOL_CALL,
  CAPTIONED_COMPLETED_TOOL_CALL,
  CAPTIONED_FAILED_TOOL_CALL,
  CAPTIONED_TOOL_CALL,
} from "../fixtures/transcript/canned-data";

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
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
  view: ToolCallViewModel,
  awaitingInput = false,
  inCurrentTurn = false,
  decisionBearing?: boolean,
) {
  act(() => {
    root.render(
      <ToolRow
        view={view}
        awaitingInput={awaitingInput}
        decisionBearing={decisionBearing}
        inCurrentTurn={inCurrentTurn}
      />,
    );
  });
}

// A minimal registered view: the surviving authored-result path (a
// host tool view), used to reach ToolViewDetail's disclosure
// anatomy now that the retired result grammar cannot.
const DETAIL_READING_REGISTRY: ToolViewRegistry = {
  "acme.reading": {
    version: 1,
    view: reactToolView(() => <p>Fares reviewed.</p>),
  },
};

async function renderWithDetailReading(
  view: ToolCallViewModel,
  inCurrentTurn = false,
) {
  // Async on purpose: the slot defers adapter mounts one microtask past
  // the commit (tool-view-slot.tsx), so the flush must drain microtasks.
  await act(async () => {
    root.render(
      <ToolViewRegistryContext.Provider value={DETAIL_READING_REGISTRY}>
        <ToolRow view={view} inCurrentTurn={inCurrentTurn} />
      </ToolViewRegistryContext.Provider>,
    );
    await Promise.resolve();
  });
}

function viewOf(overrides: Partial<ToolCallViewModel>): ToolCallViewModel {
  return {
    toolName: "docs_search",
    state: "output-available",
    input: '{"query": "sencha"}',
    output: "3 results",
    ...overrides,
  };
}

function mark(): HTMLElement {
  const found = host.querySelector<HTMLElement>("[data-tf-op-mark]");
  if (found === null) {
    throw new Error("the row rendered no operation mark");
  }
  return found;
}

function pillText(): string | null {
  return (
    host.querySelector<HTMLElement>("[data-tf-state-pill]")?.textContent ?? null
  );
}

describe("the state language, member by member", () => {
  it("input-streaming (queued): dimmed semantic mark, worded state, no motion, no pill", () => {
    render(viewOf({ state: "input-streaming", output: undefined }));
    expect(mark().getAttribute("class")).toContain("tf:opacity-45");
    expect(mark().textContent).toBe("Queued");
    expect(host.querySelector("[data-tf-shimmer-text]")).toBeNull();
    expect(pillText()).toBeNull();
    // The dashed mystery circle is gone for good: the mark is the
    // semantic glyph, never a hollow shape.
    expect(host.querySelector(".lucide-circle-dashed")).toBeNull();
  });

  it("input-available (running): shimmering label, worded state, no spinner on the row", () => {
    render(viewOf({ state: "input-available", output: undefined }));
    expect(mark().textContent).toBe("Running");
    expect(mark().getAttribute("class")).not.toContain("tf:opacity-45");
    expect(host.querySelector("[data-tf-shimmer-text]")).not.toBeNull();
    expect(host.querySelector("[data-tf-spinner]")).toBeNull();
    expect(pillText()).toBeNull();
  });

  it("output-available (completed): quiet success — settled ink, no tick, no pill, no motion", () => {
    render(viewOf({}));
    expect(mark().textContent).toBe("Completed");
    expect(mark().getAttribute("class")).not.toContain("destructive");
    expect(pillText()).toBeNull();
    expect(host.querySelector("[data-tf-shimmer-text]")).toBeNull();
    expect(host.querySelector("summary [class*='animate-']")).toBeNull();
    expect(host.querySelector("summary .lucide-check")).toBeNull();
  });

  it("output-error (failed): destructive mark, an explicit Failed pill, worded state", () => {
    render(
      viewOf({
        state: "output-error",
        output: undefined,
        errorText: "The page took too long to respond.",
      }),
    );
    expect(mark().getAttribute("class")).toContain("tf:text-tf-destructive");
    expect(mark().textContent).toBe("Failed");
    expect(pillText()).toBe("Failed");
  });

  it("cancelled (interrupted): neutral mark, an explicit Interrupted pill, never destructive", () => {
    render(viewOf({ state: "cancelled", output: undefined }));
    expect(mark().getAttribute("class")).not.toContain("destructive");
    expect(mark().textContent).toBe("Interrupted");
    expect(pillText()).toBe("Interrupted");
    const pill = host.querySelector("[data-tf-state-pill]");
    expect(pill?.getAttribute("class")).not.toContain("destructive");
  });

  it("refused (declined): neutral mark, a Declined pill, the reason line without an Error label, no Result pane, no motion", () => {
    render(
      viewOf({
        toolName: "wait_for_subagents",
        state: "refused",
        output: undefined,
        refusalText: "New subagent results have already arrived.",
      }),
    );
    expect(mark().getAttribute("class")).not.toContain("destructive");
    expect(mark().textContent).toBe("Declined");
    expect(pillText()).toBe("Declined");
    const pill = host.querySelector("[data-tf-state-pill]");
    expect(pill?.getAttribute("class")).not.toContain("destructive");
    expect(host.querySelector("[data-tf-shimmer-text]")).toBeNull();
    // The door answered and declined: "Didn't wait for subagents".
    expect(host.querySelector("summary")?.textContent).toContain(
      "Didn't wait for subagents",
    );
    // The reason is the door's own sentence, in the quiet register — no
    // Error label, no destructive ink, and no Result pane for the
    // refusal envelope the model read.
    const reason = host.querySelector("[data-tf-refusal-reason]");
    expect(reason?.textContent).toBe(
      "New subagent results have already arrived.",
    );
    expect(reason?.getAttribute("class")).not.toContain("destructive");
    expect(host.textContent).not.toContain("Error:");
    expect(host.textContent).not.toContain("Result");
  });

  it("denied (not approved): neutral mark, a Not approved pill, the You-didn't-approve headline, no Result pane, no motion", () => {
    render(
      viewOf({
        toolName: "action__refund-order",
        state: "denied",
        output: undefined,
      }),
    );
    expect(mark().getAttribute("class")).not.toContain("destructive");
    expect(mark().textContent).toBe("Not approved");
    expect(pillText()).toBe("Not approved");
    const pill = host.querySelector("[data-tf-state-pill]");
    expect(pill?.getAttribute("class")).not.toContain("destructive");
    expect(host.querySelector("[data-tf-shimmer-text]")).toBeNull();
    // Distinct from cancelled ("Didn't run") and refused ("Didn't X") in
    // the headline as well as the pill: the member's own decision.
    expect(host.querySelector("summary")?.textContent).toContain(
      "You didn't approve action refund order",
    );
    expect(host.textContent).not.toContain("Interrupted");
    expect(host.textContent).not.toContain("Declined");
    expect(host.textContent).not.toContain("Error:");
    expect(host.textContent).not.toContain("Result");
  });

  it("superseded (severed by a run retry): neutral mark, Interrupted pill, Didn't-finish headline, no motion", () => {
    render(viewOf({ state: "superseded", output: undefined }));
    expect(mark().getAttribute("class")).not.toContain("destructive");
    expect(mark().textContent).toBe("Interrupted");
    expect(pillText()).toBe("Interrupted");
    const pill = host.querySelector("[data-tf-state-pill]");
    expect(pill?.getAttribute("class")).not.toContain("destructive");
    expect(host.querySelector("[data-tf-shimmer-text]")).toBeNull();
    // The headline frame tells it apart from cancelled ("Didn't run"):
    // this call started and was cut by the retry.
    expect(host.querySelector("summary")?.textContent).toContain(
      "Didn't finish docs search",
    );
  });

  it("awaiting input: an explicit Needs input pill on the paused row", () => {
    render(viewOf({ state: "input-streaming", output: undefined }), true);
    expect(pillText()).toBe("Needs input");
  });

  it("a settled state outranks awaiting-input: the terminal pill wins", () => {
    render(
      viewOf({
        state: "output-error",
        output: undefined,
        errorText: "Broke.",
      }),
      true,
    );
    expect(pillText()).toBe("Failed");
  });

  it("a live row with no view and no pending decision stays closed, current turn or not", () => {
    // The negative control for the placement holds: openness derives
    // from the resolution and the pending decision — a plain running
    // call earns neither, so the row stays native-manual even while
    // its turn is current.
    render(viewOf({ state: "input-available", output: undefined }));
    expect(host.querySelector("details")?.open).toBe(false);
    render(
      viewOf({ state: "input-available", output: undefined }),
      false,
      true,
    );
    expect(host.querySelector("details")?.open).toBe(false);
  });
});

describe("the untyped result posture", () => {
  it("keeps an untyped result out of the transcript and shows only the bounded argument reading", () => {
    const output = "Checked 20 fares — May 12 wins.";
    render(viewOf({ output }));
    expect(host.textContent).not.toContain(output);
    // The rung-4 terminal: the package's bounded reading of the input —
    // never a raw pane, never a disclosure of wire bytes.
    expect(
      host.querySelector("[data-tf-approval-request-summary]"),
    ).not.toBeNull();
    expect(host.textContent).toContain("sencha");
    expect(host.querySelector("pre")).toBeNull();
    expect(host.querySelectorAll("details")).toHaveLength(1);
  });

  it("does not derive a generic card from an unknown tool's JSON result", () => {
    const output = JSON.stringify({
      synced: 42,
      skipped: [{ sku: "TEA-OOLONG-250", reason: "price drift" }],
      took_ms: 1834,
    });
    render(viewOf({ output }));
    expect(host.querySelector("[data-tf-generic-fallback]")).toBeNull();
    expect(host.textContent).not.toContain("Result:");
    expect(host.textContent).not.toContain("TEA-OOLONG-250");
    expect(
      host.querySelector("[data-tf-approval-request-summary]"),
    ).not.toBeNull();
  });
});

describe("the disclosure's accessibility contract", () => {
  it("the trigger has an accurate accessible name: the state word and the headline", () => {
    render(viewOf({}));
    const summary = host.querySelector<HTMLElement>("summary");
    // Native <summary> takes its accessible name from its contents; the
    // decorative glyphs are aria-hidden, so the name is the sr-only
    // state word plus the headline ladder's words.
    expect(summary?.textContent).toContain("Completed");
    expect(summary?.textContent).toContain("Ran docs search");
    for (const svg of host.querySelectorAll("summary svg")) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("the trigger exposes its expanded state through the native disclosure", async () => {
    render(viewOf({}));
    const details = host.querySelector<HTMLDetailsElement>("details");
    const summary = host.querySelector<HTMLElement>("summary");
    if (details === null || summary === null) {
      throw new Error("the row rendered no native disclosure");
    }
    // Native <details>/<summary> IS the expanded-state contract:
    // platform accessibility maps summary to a button with aria-expanded
    // mirroring the open attribute, and keyboard activation comes free.
    expect(details.open).toBe(false);
    const chevron = summary.querySelector(":scope > svg");
    expect(chevron?.hasAttribute("data-tf-disclosure-chevron-visible")).toBe(
      false,
    );
    expect(chevron?.getAttribute("opacity")).toBe("0");
    await act(async () => {
      summary.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(details.open).toBe(true);
    expect(chevron?.getAttribute("data-tf-disclosure-chevron-open")).toBe("");
    expect(chevron?.getAttribute("data-tf-disclosure-chevron-visible")).toBe(
      "",
    );
    expect(chevron?.getAttribute("opacity")).toBe("1");
    await act(async () => {
      summary.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(details.open).toBe(false);
  });
});

describe("the exhausted ladder's terminal in the row body (round-2 findings 4/5)", () => {
  const KABOOM_REGISTRY: ToolViewRegistry = {
    "acme.reading": {
      version: 1,
      view: {
        mount() {
          throw new Error("kaboom");
        },
      },
    },
  };

  it("never prints Result: over the rung-4 input reading, even with a landed output", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await act(async () => {
      root.render(
        <ToolViewRegistryContext.Provider value={KABOOM_REGISTRY}>
          <ToolRow
            view={viewOf({
              display: { view: { key: "acme.reading", version: 1 } },
            })}
          />
        </ToolViewRegistryContext.Provider>,
      );
      await Promise.resolve();
    });
    // The terminal is an INPUT reading headed by its own word…
    const summary = host.querySelector<HTMLElement>(
      "[data-tf-approval-request-summary]",
    );
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toContain("Request");
    // …never a "Result:" claim (the output landed, but nothing on this
    // arm reads it), and no raw pane anywhere.
    expect(host.textContent).not.toContain("Result:");
    expect(host.querySelector("pre")).toBeNull();
    // The shared tool-view card (parts-classes.ts): a hairline card, no
    // height floor.
    const sectionClass = summary?.getAttribute("class") ?? "";
    expect(sectionClass).not.toContain("min-h-24");
    expect(sectionClass).toContain("tf:rounded-lg");
    expect(sectionClass).toContain("tf:border-tf-border");
    consoleError.mockRestore();
  });

  it("a rung-3 built-in through the row never sits under a Result: heading — it self-labels its response", async () => {
    // No registry provider on purpose: the frozen PACKAGE_TOOL_VIEWS
    // table is the resolution, so this drives the shipping rung-3 path
    // through the row and the slot — the adapter unit tests
    // (action-tool-view.test.ts and siblings) never mount the slot, and
    // this was exactly the blind spot that let the heading print over a
    // built-in's request panes.
    const args = JSON.stringify({
      path_params: { doc_id: "doc_311" },
      body: { title: "Kettle guide" },
    });
    await act(async () => {
      root.render(
        <ToolRow
          view={viewOf({
            toolName: "action__update-doc",
            input: args,
            argsText: args,
            // The action wire envelope (transport/actions-adapter.ts):
            // {ok, result: {status, body, truncated}}.
            output: JSON.stringify({
              ok: true,
              result: {
                status: 200,
                body: { id: "doc_311" },
                truncated: false,
              },
            }),
            display: { view: { key: "teaflask.action", version: 1 } },
          })}
        />,
      );
      await Promise.resolve();
    });
    // The built-in leads with its REQUEST panes and labels its settled
    // half itself…
    expect(host.textContent).toContain("Path parameters");
    expect(host.textContent).toContain("Response");
    // …so the slot's "Result:" heading must not print over them.
    expect(host.textContent).not.toContain("Result:");
  });

  it("an argument-less exhausted call renders no reading and no false heading — an honestly empty body", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await act(async () => {
      root.render(
        <ToolViewRegistryContext.Provider value={KABOOM_REGISTRY}>
          <ToolRow
            view={viewOf({
              input: "{}",
              argsText: "{}",
              display: { view: { key: "acme.reading", version: 1 } },
            })}
          />
        </ToolViewRegistryContext.Provider>,
      );
      await Promise.resolve();
    });
    expect(host.querySelector("[data-tf-approval-request-summary]")).toBeNull();
    expect(host.textContent).not.toContain("Result:");
    // The bounded reading of empty input is honestly empty; no raw pane
    // stands in for it.
    expect(host.querySelector("pre")).toBeNull();
    vi.restoreAllMocks();
  });
});

describe("the row-level placement holds", () => {
  const ANNOTATED = () =>
    viewOf({
      display: { view: { key: "acme.reading", version: 1 } },
    });

  it("a resolved view opens its own row on arrival while its turn is current", async () => {
    await renderWithDetailReading(ANNOTATED(), true);
    const details = host.querySelector<HTMLDetailsElement>("details");
    expect(details?.open).toBe(true);
    expect(host.textContent).toContain("Fares reviewed.");
  });

  it("the same resolved view behind a turn boundary is not held (the currency control)", async () => {
    await renderWithDetailReading(ANNOTATED(), false);
    expect(host.querySelector<HTMLDetailsElement>("details")?.open).toBe(false);
  });

  it("a pending decision opens the row, view or not", () => {
    render(viewOf({ state: "input-available", output: undefined }), true, true);
    expect(host.querySelector<HTMLDetailsElement>("details")?.open).toBe(true);
  });

  it("a settled decision keeps the row held for the rest of its turn (the latch, round-2 finding 2)", () => {
    // awaitingInput false (the pill's live spelling has cleared) but a
    // card is still ANCHORED: approving must not snap the pane shut
    // under the member's pointer — TVC-014's window is the turn.
    render(viewOf({}), false, true, true);
    expect(host.querySelector<HTMLDetailsElement>("details")?.open).toBe(true);
    // No "Needs input" pill — the pill keeps the awaiting spelling.
    expect(host.textContent).not.toContain("Needs input");
    // The release is the turn boundary, same element, no remount.
    const held = host.querySelector<HTMLDetailsElement>("details");
    render(viewOf({}), false, false, true);
    const released = host.querySelector<HTMLDetailsElement>("details");
    expect(released).toBe(held);
    expect(released?.open).toBe(false);
  });

  it("a package built-in view never holds a row open — only a host-authored one does", () => {
    // teaflask.action resolves at rung 3 for every catalog action; if it
    // held rows open, every generic action reading would unfold by
    // default — the host did not decide this tool was worth a view.
    render(
      viewOf({
        toolName: "action__get-doc",
        input: '{"path_params": {"doc_id": "d1"}}',
        output: '{"ok": true, "result": {"status": 200, "body": {"id": "d1"}}}',
        display: { view: { key: "teaflask.action", version: 1 } },
      }),
      false,
      true,
    );
    expect(host.querySelector<HTMLDetailsElement>("details")?.open).toBe(false);
  });

  it("a failed row stays closed even with a host view — the pill names the state", async () => {
    await renderWithDetailReading(
      viewOf({
        state: "output-error",
        output: undefined,
        errorText: "The fare backend broke.",
        display: { view: { key: "acme.reading", version: 1 } },
      }),
      true,
    );
    expect(host.querySelector<HTMLDetailsElement>("details")?.open).toBe(false);
    expect(pillText()).toBe("Failed");
  });

  it("a not-run row stays closed even when a decision is anchored to it", () => {
    for (const state of [
      "denied",
      "cancelled",
      "refused",
      "superseded",
    ] as const) {
      render(viewOf({ state, output: undefined }), false, true, true);
      expect(
        host.querySelector<HTMLDetailsElement>("details")?.open,
        state,
      ).toBe(false);
    }
  });

  it("a degraded record — truncated or offloaded — stays closed even with a host view", async () => {
    await renderWithDetailReading(
      viewOf({
        output:
          '{"ok": true, "result": {"status": 200, "body": "[{…", "truncated": true}}',
        display: { view: { key: "acme.reading", version: 1 } },
      }),
      true,
    );
    expect(host.querySelector<HTMLDetailsElement>("details")?.open).toBe(false);
    await renderWithDetailReading(
      viewOf({
        offloaded: true,
        display: { view: { key: "acme.reading", version: 1 } },
      }),
      true,
    );
    expect(host.querySelector<HTMLDetailsElement>("details")?.open).toBe(false);
  });

  it("a pending decision on a prior turn's row does not hold it", () => {
    render(
      viewOf({ state: "input-available", output: undefined }),
      true,
      false,
    );
    expect(host.querySelector<HTMLDetailsElement>("details")?.open).toBe(false);
  });

  it("row decay runs on the same element: the release closes it without a remount", async () => {
    await renderWithDetailReading(ANNOTATED(), true);
    const held = host.querySelector<HTMLDetailsElement>("details");
    expect(held?.open).toBe(true);
    await renderWithDetailReading(ANNOTATED(), false);
    const released = host.querySelector<HTMLDetailsElement>("details");
    expect(released).toBe(held);
    expect(released?.open).toBe(false);
  });

  it("the view mounts for the call's whole lifecycle: before the result lands, no Result label", async () => {
    await renderWithDetailReading(
      viewOf({
        state: "input-available",
        output: undefined,
        display: { view: { key: "acme.reading", version: 1 } },
      }),
      true,
    );
    // The authored reading is already in the row body mid-run…
    expect(host.textContent).toContain("Fares reviewed.");
    // …without a "Result:" heading asserting an output that does not exist yet.
    expect(host.textContent).not.toContain("Result:");
  });

  it("no package heading ever prints over a view — the view titles itself", async () => {
    await renderWithDetailReading(ANNOTATED(), true);
    expect(host.textContent).toContain("Fares reviewed.");
    expect(host.textContent).not.toContain("Result:");
  });

  it("a rung-4 row never parses its result — across five re-renders the default reading reads the arguments alone", () => {
    // The slot is unconditional and reads the call on every render; the
    // default view reads args. A settled result can run to the door's
    // 20k, and a long thread re-renders every row per streamed token,
    // so the result must stay text until a view asks for it.
    const output = JSON.stringify({
      ok: true,
      result: { status: 200, body: { rerender_probe: "x".repeat(4_000) } },
    });
    const view = viewOf({
      state: "output-available",
      argsText: '{"query":"rerender probe"}',
      output,
    });
    const parse = vi.spyOn(JSON, "parse");
    try {
      for (let pass = 0; pass < 5; pass += 1) {
        render(view);
      }
      expect(host.textContent).toContain("rerender probe");
      const outputParses = parse.mock.calls.filter(
        ([text]) => text === output,
      ).length;
      expect(outputParses).toBe(0);
    } finally {
      parse.mockRestore();
    }
  });

  it("an errored view-bearing call still mounts the view, with the failure's one sentence beside it — no Error label", async () => {
    await renderWithDetailReading(
      viewOf({
        state: "output-error",
        output: undefined,
        errorText: "The fare backend broke.",
        display: { view: { key: "acme.reading", version: 1 } },
      }),
    );
    expect(host.textContent).toContain("Fares reviewed.");
    expect(host.textContent).not.toContain("Error:");
    expect(host.querySelector("[data-tf-error-reason]")?.textContent).toBe(
      "The fare backend broke.",
    );
  });
});

describe("the model's caption on the row", () => {
  const CAPTION = "Checking for an existing install";
  const summaryText = () => host.querySelector("summary")?.textContent ?? "";

  it("running: the caption is the shimmering label, not the authored progress sentence", () => {
    render(CAPTIONED_TOOL_CALL);
    const shimmer = host.querySelector("[data-tf-shimmer-text]");
    expect(shimmer?.textContent).toContain(CAPTION);
    expect(summaryText()).not.toContain("Running a command");
  });

  it("done: the caption alone — no tense change, no completion sentence, no pill", () => {
    render(CAPTIONED_COMPLETED_TOOL_CALL);
    expect(summaryText()).toContain(CAPTION);
    expect(summaryText()).not.toContain("Ran a command");
    expect(summaryText()).not.toContain("·");
    expect(host.querySelector("[data-tf-shimmer-text]")).toBeNull();
  });

  it("failed: the caption with the quiet state word beside the Failed pill; no success copy", () => {
    render(CAPTIONED_FAILED_TOOL_CALL);
    expect(summaryText()).toContain(`${CAPTION} · failed`);
    expect(summaryText()).toContain("Failed");
    expect(summaryText()).not.toContain("Ran a command");
    expect(summaryText()).not.toContain("The command did not finish.");
  });

  it("cancelled: the caption with the quiet state word beside the Interrupted pill; no success copy", () => {
    render(CAPTIONED_CANCELLED_TOOL_CALL);
    expect(summaryText()).toContain(`${CAPTION} · didn't run`);
    expect(summaryText()).toContain("Interrupted");
    expect(summaryText()).not.toContain("Ran a command");
    expect(host.querySelector("[data-tf-shimmer-text]")).toBeNull();
  });
});
