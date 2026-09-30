// @vitest-environment jsdom
// The mount slot — the resolution ladder's runtime half: a vanilla
// (imperative) adapter mounts once, receives prop changes through
// `update` in place, and is destroyed on unmount; a mount/update throw
// advances monotonically to the rung below; exhausting the candidates
// lands on rung 4, the package default view, the slot's own terminal.
// An icon registration replaces the operation mark's glyph and nothing
// else.

import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reactToolView } from "../src/components/react-tool-view";
import { ToolViewRegistryContext } from "../src/components/tool-view-registry-context";
import { ToolViewSlot } from "../src/components/tool-view-slot";
import { ToolRow } from "../src/components/tool-row";
import type { ToolCallViewModel } from "../src/core/tool-call-display";
import type {
  ResolvedToolView,
  ToolViewAdapter,
  ToolViewCall,
  ToolViewProps,
  ToolViewRegistry,
} from "../src/core/tool-view";

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
  vi.restoreAllMocks();
});

/** Async on purpose: the slot defers adapter calls one microtask past
 *  the commit, so every flush drains microtasks. */
async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(node);
    await Promise.resolve();
  });
}

async function unmount() {
  await act(async () => {
    root.unmount();
    await Promise.resolve();
  });
  root = createRoot(host);
}

/** The mark's content as assistive tech hears it: aria-hidden subtrees
 *  (the package glyphs, and a mounted icon adapter's container) removed,
 *  the sr-only state word kept. */
function _accessibleTextOf(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  for (const hidden of clone.querySelectorAll('[aria-hidden="true"]')) {
    hidden.remove();
  }
  return clone.textContent;
}

interface AdapterLog {
  mounts: number;
  mountProps: ToolViewProps[];
  updates: ToolViewProps[];
  destroys: number;
}

/** A genuinely vanilla adapter: raw DOM, no React. */
function recordingAdapter(label: string): {
  adapter: ToolViewAdapter;
  log: AdapterLog;
} {
  const log: AdapterLog = {
    mounts: 0,
    mountProps: [],
    updates: [],
    destroys: 0,
  };
  const adapter: ToolViewAdapter = {
    mount(container, props) {
      log.mounts += 1;
      log.mountProps.push(props);
      const line = document.createElement("p");
      line.setAttribute("data-vanilla", label);
      line.textContent = `${label}: ${props.call.status} (${props.context.themeMode})`;
      container.appendChild(line);
      return {
        update(next) {
          log.updates.push(next);
          line.textContent = `${label}: ${next.call.status} (${next.context.themeMode})`;
        },
        destroy() {
          log.destroys += 1;
          line.remove();
        },
      };
    },
  };
  return { adapter, log };
}

const ANNOTATED_VIEW: ToolCallViewModel = {
  toolName: "acme__lookup",
  state: "output-available",
  toolCallId: "t1",
  input: '{"q": "sencha"}',
  argsText: '{"q":"sencha"}',
  output: '{"hits":3}',
  display: { view: { key: "acme.lookup-view", version: 1 } },
};

function rowWithRegistry(registry: ToolViewRegistry, awaitingInput = false) {
  return (
    <ToolViewRegistryContext.Provider value={registry}>
      <ToolRow view={ANNOTATED_VIEW} awaitingInput={awaitingInput} />
    </ToolViewRegistryContext.Provider>
  );
}

describe("the imperative adapter lifecycle", () => {
  it("mounts a vanilla adapter once with the assembled call, updates it in place, destroys on unmount", async () => {
    const { adapter, log } = recordingAdapter("vanilla");
    const registry: ToolViewRegistry = {
      "acme.lookup-view": { version: 1, view: adapter },
    };
    await render(rowWithRegistry(registry));

    expect(log.mounts).toBe(1);
    expect(host.textContent).toContain("vanilla: output-available (light)");
    // A prop change (the pending decision flips) arrives through update —
    // the adapter is NOT remounted.
    await render(rowWithRegistry(registry, true));
    expect(log.mounts).toBe(1);
    expect(log.updates.at(-1)?.call.awaitingDecision).toBe(true);
    expect(log.destroys).toBe(0);

    await unmount();
    expect(log.destroys).toBe(1);
    expect(host.querySelector("[data-vanilla]")).toBeNull();
  });

  it("suppresses a delivery when nothing observable changed, and delivers when something did", async () => {
    // The guard must be STRUCTURAL: every object on this path is minted
    // fresh per render (the presenter's call, the slot's props), so an
    // identity guard is dead by construction and a mounted view would
    // receive an update per streamed token on settled calls.
    const { adapter, log } = recordingAdapter("vanilla");
    const registry: ToolViewRegistry = {
      "acme.lookup-view": { version: 1, view: adapter },
    };
    await render(rowWithRegistry(registry));
    // An unchanged re-render (fresh objects, same data): no delivery.
    await render(rowWithRegistry(registry));
    await render(rowWithRegistry(registry));
    expect(log.updates).toHaveLength(0);
    // A genuine change (the pending decision flips): delivered.
    await render(rowWithRegistry(registry, true));
    expect(log.updates).toHaveLength(1);
    expect(log.updates[0]?.call.awaitingDecision).toBe(true);
    expect(log.mounts).toBe(1);
  });

  it("a NESTED-argument call delivers no update across unchanged re-renders, and exactly one on a genuine change", async () => {
    // The round-1 guard was only half-alive here: nested argument
    // objects were re-minted per render and mis-read as changed, so a
    // mounted view received an update per streamed token on settled
    // calls. Identity now derives from the source text (the presenter's
    // parse memo / IDENTITY LAW), so unchanged nested args must be
    // quiet — and a genuinely changed argument must still deliver.
    const { adapter, log } = recordingAdapter("vanilla");
    const registry: ToolViewRegistry = {
      "acme.lookup-view": { version: 1, view: adapter },
    };
    const nested = (argsText: string): ToolCallViewModel => ({
      ...ANNOTATED_VIEW,
      argsText,
      input: argsText,
    });
    const renderNested = async (view: ToolCallViewModel) => {
      await render(
        <ToolViewRegistryContext.Provider value={registry}>
          <ToolRow view={view} />
        </ToolViewRegistryContext.Provider>,
      );
    };
    const before = nested('{"filters":{"status":"open"},"ids":[1,2]}');
    await renderNested(before);
    await renderNested({ ...before });
    await renderNested({ ...before });
    expect(log.mounts).toBe(1);
    expect(log.updates).toHaveLength(0);
    await renderNested(nested('{"filters":{"status":"closed"},"ids":[1,2]}'));
    expect(log.updates).toHaveLength(1);
    expect(log.updates[0]?.call.args).toEqual({
      filters: { status: "closed" },
      ids: [1, 2],
    });
    expect(log.mounts).toBe(1);
  });

  it("delivers the registered schemas on mount, stays quiet while their references hold, and delivers a late-arriving one exactly once", async () => {
    const { adapter, log } = recordingAdapter("vanilla");
    const registry: ToolViewRegistry = {
      "acme.lookup-view": { version: 1, view: adapter },
    };
    const argsSchema = { type: "object", properties: { q: {} } };
    const withSchemas = (
      schemas: Partial<Pick<ToolCallViewModel, "argsSchema" | "resultSchema">>,
    ): ToolCallViewModel => ({ ...ANNOTATED_VIEW, ...schemas });
    const renderView = async (view: ToolCallViewModel) => {
      await render(
        <ToolViewRegistryContext.Provider value={registry}>
          <ToolRow view={view} />
        </ToolViewRegistryContext.Provider>,
      );
    };
    await renderView(withSchemas({ argsSchema }));
    expect(log.mountProps[0]?.call.argsSchema).toBe(argsSchema);
    expect(log.mountProps[0]?.call.resultSchema).toBeUndefined();
    // Unchanged re-renders with the SAME schema reference (the anchors
    // map's guarantee): no delivery — `===` is the guard's premise.
    await renderView(withSchemas({ argsSchema }));
    await renderView(withSchemas({ argsSchema }));
    expect(log.updates).toHaveLength(0);
    // A late-arriving result schema (the completion of a paused call, a
    // replay catching up) is a new reference: exactly one delivery, and
    // absence never regressed to `{}` along the way.
    const resultSchema = { type: "object", properties: { hits: {} } };
    await renderView(withSchemas({ argsSchema, resultSchema }));
    expect(log.updates).toHaveLength(1);
    expect(log.updates[0]?.call.resultSchema).toBe(resultSchema);
    expect(log.mounts).toBe(1);
  });

  it("a dark-pinned host's FIRST mount already carries the resolved theme — no painted-light frame, no catch-up update", async () => {
    // Settled empirically (r3): four reviewers reasoned to two different
    // answers about React's commit ordering here, so this pin is the
    // answer. Outside act (real task scheduling), the theme resolves in
    // a layout pass and BOTH commits' passive effects write the mount
    // record's props
    // before the mount microtask drains — the adapter mounts once, with
    // "dark", and receives zero updates. The README's "resolves before
    // the mount's first paint" claim is pinned to this behaviour.
    const { adapter, log } = recordingAdapter("vanilla");
    const registry: ToolViewRegistry = {
      "acme.lookup-view": { version: 1, view: adapter },
    };
    const actFlag = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    actFlag.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      const { flushSync } = await import("react-dom");
      flushSync(() => {
        root.render(
          <ToolViewRegistryContext.Provider value={registry}>
            <div data-tf-assistant="" data-tf-theme="dark">
              <ToolRow view={ANNOTATED_VIEW} />
            </div>
          </ToolViewRegistryContext.Provider>,
        );
      });
      // Drain the passive-effect tasks and the mount microtask.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(log.mounts).toBe(1);
      expect(log.mountProps[0]?.context.themeMode).toBe("dark");
      expect(log.updates).toHaveLength(0);
    } finally {
      actFlag.IS_REACT_ACT_ENVIRONMENT = true;
    }
  });

  it("a late ref that RE-KEYS the same adapter (rung 2 → rung 1) never remounts it — local state survives", async () => {
    // The README's own double-registration shape: one registration
    // object under an opaque wire key AND the exact tool name. The view
    // mounts at rung 2; the tool_call_annotated ref lands late and the
    // resolution re-keys the SAME adapter to rung 1. The adapter's
    // identity is the ONLY advance signal — a key change alone is a
    // re-labelling, and a remount here would discard exactly the local
    // UI state that update-in-place exists to preserve.
    const { adapter, log } = recordingAdapter("shared");
    const shared = { version: 1, view: adapter };
    const registry: ToolViewRegistry = {
      "acme.big-view": shared,
      acme__lookup: shared,
    };
    const bare: ToolCallViewModel = { ...ANNOTATED_VIEW, display: undefined };
    await render(
      <ToolViewRegistryContext.Provider value={registry}>
        <ToolRow view={bare} />
      </ToolViewRegistryContext.Provider>,
    );
    expect(log.mounts).toBe(1);
    const mountedLine = host.querySelector("[data-vanilla='shared']");
    expect(mountedLine).not.toBeNull();
    // The ref lands late: same adapter, new key, rung 2 → rung 1.
    await render(
      <ToolViewRegistryContext.Provider value={registry}>
        <ToolRow
          view={{
            ...bare,
            display: { view: { key: "acme.big-view", version: 1 } },
          }}
        />
      </ToolViewRegistryContext.Provider>,
    );
    expect(log.mounts).toBe(1);
    expect(log.destroys).toBe(0);
    // The adapter-owned DOM survived by identity — no teardown/rebuild.
    expect(host.querySelector("[data-vanilla='shared']")).toBe(mountedLine);
    // The wrapper's label follows the re-resolution without a remount.
    expect(
      host
        .querySelector("[data-tf-tool-view]")
        ?.getAttribute("data-tf-tool-view"),
    ).toBe("acme.big-view");
  });

  it("a destroy throw is swallowed to console — no advance, no host report (failure census, case 3)", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const grumpy: ToolViewAdapter = {
      mount(container) {
        const line = document.createElement("p");
        container.appendChild(line);
        return {
          update: () => undefined,
          destroy: () => {
            throw new Error("kaboom on destroy");
          },
        };
      },
    };
    await render(
      rowWithRegistry({ "acme.lookup-view": { version: 1, view: grumpy } }),
    );
    await unmount();
    const lines = consoleError.mock.calls.map((call) => String(call[0]));
    // The full attribution, not a substring: the deferred destroy runs
    // after the next commit's effects have already re-written the mount
    // record's key,
    // so the message must carry the key captured at cleanup time — a
    // mis-attributed log would still contain "threw on destroy".
    expect(
      lines.some((line) =>
        line.includes(
          '[teaflask-assistant] The tool view "acme.lookup-view" threw on destroy.',
        ),
      ),
    ).toBe(true);
    // Never the advance path's report — the adapter was leaving anyway.
    expect(
      lines.some((line) => line.includes("the next resolution took over")),
    ).toBe(false);
  });

  it("a destroy throw AFTER an advance still blames the destroyed view's key, not the next resolution's", async () => {
    // The attribution case the unmount test cannot pose: the deferred
    // destroy runs after the next commit's create-phase effects have
    // re-written the mount record's key — here to undefined, the
    // terminal — so a
    // destroy-time read would log `The tool view "" threw on destroy.`
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const doublyGrumpy: ToolViewAdapter = {
      mount(container) {
        const line = document.createElement("p");
        container.appendChild(line);
        return {
          update: () => {
            throw new Error("kaboom on update");
          },
          destroy: () => {
            throw new Error("kaboom on destroy");
          },
        };
      },
    };
    const registry: ToolViewRegistry = {
      "acme.lookup-view": { version: 1, view: doublyGrumpy },
    };
    await render(rowWithRegistry(registry));
    // The update throw advances past the sole candidate to the terminal
    // (the default view; the row has no quiet-line override); the
    // failed adapter's deferred destroy then throws.
    await render(rowWithRegistry(registry, true));
    expect(
      host.querySelector(
        "[data-tf-tool-view] [data-tf-approval-request-summary]",
      ),
    ).not.toBeNull();
    const lines = consoleError.mock.calls.map((call) => String(call[0]));
    expect(
      lines.some((line) =>
        line.includes(
          '[teaflask-assistant] The tool view "acme.lookup-view" threw on destroy.',
        ),
      ),
    ).toBe(true);
    expect(
      lines.some((line) => line.includes('The tool view "" threw on destroy')),
    ).toBe(false);
  });

  it("a registry identity change gives NEW adapter objects a fresh try (resolution-change census, case b)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const flaky: ToolViewAdapter = {
      mount() {
        throw new Error("old code exploded");
      },
    };
    await render(
      rowWithRegistry({ "acme.lookup-view": { version: 1, view: flaky } }),
    );
    expect(host.querySelector("[data-vanilla]")).toBeNull();
    // The host ships new code: a NEW adapter object under the same key.
    const { adapter: fixed, log } = recordingAdapter("fixed");
    await render(
      rowWithRegistry({ "acme.lookup-view": { version: 1, view: fixed } }),
    );
    expect(log.mounts).toBe(1);
    expect(host.querySelector("[data-vanilla='fixed']")).not.toBeNull();
  });

  it("hands the adapter the parsed call — args, result, identity", async () => {
    const { adapter, log } = recordingAdapter("vanilla");
    await render(
      rowWithRegistry({ "acme.lookup-view": { version: 1, view: adapter } }),
    );
    const call = log.mountProps.at(0)?.call;
    expect(call?.args).toEqual({ q: "sencha" });
    expect(call?.result).toEqual({ hits: 3 });
    expect(call?.toolCallId).toBe("t1");
  });
});

describe("a throwing adapter lands on the rung below", () => {
  it("a mount throw advances rung 1 → rung 2, latched — the flaky adapter never flickers back", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const flaky: ToolViewAdapter = {
      mount() {
        throw new Error("rung 1 exploded at mount");
      },
    };
    const { adapter: named, log } = recordingAdapter("rung2");
    const registry: ToolViewRegistry = {
      "acme.lookup-view": { version: 1, view: flaky },
      acme__lookup: { version: 1, view: named },
    };
    await render(rowWithRegistry(registry));

    // The rung below took over…
    expect(host.textContent).toContain("rung2: output-available");
    expect(log.mounts).toBe(1);
    // …the console named the key…
    expect(
      consoleError.mock.calls.some((call) =>
        String(call[0]).includes(
          '[teaflask-assistant] The tool view "acme.lookup-view" threw',
        ),
      ),
    ).toBe(true);
    // …and the advance is latched: a re-render does not retry rung 1.
    await render(rowWithRegistry(registry, true));
    expect(log.mounts).toBe(1);
    expect(log.updates.at(-1)?.call.awaitingDecision).toBe(true);
  });

  it("advances past IDENTITY-EQUAL candidates: a wire key equal to the tool name still lands on the terminal", async () => {
    // Rungs 1 and 2 resolve the SAME registration when the annotation's
    // key equals the tool name, so the ladder holds two candidates with
    // one adapter object. Failures are tracked by ADAPTER IDENTITY
    // (resolution-change census, case c): one throw skips every
    // occurrence — one report, no pointless re-mount of the adapter
    // that just threw — and the row lands on the terminal, never a
    // "Result:" label over an empty container.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const flaky: ToolViewAdapter = {
      mount() {
        throw new Error("kaboom on both rungs");
      },
    };
    const view: ToolCallViewModel = {
      ...ANNOTATED_VIEW,
      toolName: "acme.lookup-view",
      display: { view: { key: "acme.lookup-view", version: 1 } },
    };
    await render(
      <ToolViewRegistryContext.Provider
        value={{ "acme.lookup-view": { version: 1, view: flaky } }}
      >
        <ToolRow view={view} />
      </ToolViewRegistryContext.Provider>,
    );
    expect(
      consoleError.mock.calls.filter((call) =>
        String(call[0]).includes('The tool view "acme.lookup-view" threw'),
      ),
    ).toHaveLength(1);
    expect(
      host.querySelector(
        "[data-tf-tool-view] [data-tf-approval-request-summary]",
      ),
    ).not.toBeNull();
  });

  it("a late-arriving wire ref re-composes the list without losing the bookkeeping: the untried rung 1 mounts, the failed rung 2 stays skipped", async () => {
    // The resolution-change census, case a: icons mount for the whole
    // lifecycle, a rung-2 icon fails at input-available, and the
    // tool_call_annotated ref lands on a LATER marker — prepending a
    // rung-1 candidate. Positional bookkeeping would re-mount the
    // failed adapter at its new index and skip the untried rung 1;
    // identity tracking must do the opposite.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let flakyMounts = 0;
    const flakyIcon: ToolViewAdapter = {
      mount() {
        flakyMounts += 1;
        throw new Error("rung-2 icon exploded");
      },
    };
    const { adapter: goodIcon, log } = recordingAdapter("rung1-icon");
    const registry: ToolViewRegistry = {
      "acme.big-icon": { version: 1, icon: goodIcon },
      acme__lookup: { version: 1, icon: flakyIcon },
    };
    const liveView: ToolCallViewModel = {
      toolName: "acme__lookup",
      state: "input-available",
      toolCallId: "t1",
      input: '{"q": "sencha"}',
      argsText: '{"q":"sencha"}',
    };
    await render(
      <ToolViewRegistryContext.Provider value={registry}>
        <ToolRow view={liveView} />
      </ToolViewRegistryContext.Provider>,
    );
    expect(flakyMounts).toBe(1);
    expect(log.mounts).toBe(0);
    // The ref arrives late: the candidate list becomes [rung1, rung2].
    await render(
      <ToolViewRegistryContext.Provider value={registry}>
        <ToolRow
          view={{
            ...liveView,
            display: { view: { key: "acme.big-icon", version: 1 } },
          }}
        />
      </ToolViewRegistryContext.Provider>,
    );
    // Ladder order holds: the untried rung 1 mounted…
    expect(log.mounts).toBe(1);
    expect(host.querySelector("[data-vanilla='rung1-icon']")).not.toBeNull();
    // …and the adapter that already failed was NOT re-mounted.
    expect(flakyMounts).toBe(1);
  });

  it("a throw from a view's SELF-SCHEDULED render lands on the terminal (failure census, case 5)", async () => {
    // The genuinely-late phase, settled empirically while writing this
    // test: a mount/update flush surfaces even its passive-effect
    // throws synchronously (flushSync flushes the forced work's
    // effects), so a mount-time useEffect throw travels the SYNC path
    // and cannot falsify the late channel. What no mount/update return
    // can observe is a render the view schedules for ITSELF — its own
    // setState from a timer — committed with no renderInto in flight.
    // That throw must travel the sugar's late-failure event, or the
    // row silently strands on an emptied container.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const SelfDestruct = () => {
      const [boom, setBoom] = useState(false);
      useEffect(() => {
        const timer = setTimeout(() => {
          setBoom(true);
        }, 0);
        return () => {
          clearTimeout(timer);
        };
      }, []);
      if (boom) {
        throw new Error("kaboom from a self-scheduled render");
      }
      return <p>looks mounted</p>;
    };
    const actFlag = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    actFlag.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      const { flushSync } = await import("react-dom");
      flushSync(() => {
        root.render(
          <ToolViewRegistryContext.Provider
            value={{
              "acme.lookup-view": {
                version: 1,
                view: reactToolView(SelfDestruct),
              },
            }}
          >
            <ToolRow view={ANNOTATED_VIEW} />
          </ToolViewRegistryContext.Provider>,
        );
      });
      // Drain: the slot's mount microtask, the view's own timer, the
      // nested root's self-scheduled render (the throw), the late
      // event, the advance.
      for (let drain = 0; drain < 8; drain += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      // The row landed on the terminal — the default view —
      // not an emptied container…
      const slot = host.querySelector("[data-tf-tool-view]");
      expect(
        slot?.querySelector("[data-tf-approval-request-summary]"),
      ).not.toBeNull();
      expect(slot?.textContent).not.toContain("looks mounted");
      // …and the failure was reported on the named console line.
      expect(
        consoleError.mock.calls.some((call) =>
          String(call[0]).includes('The tool view "acme.lookup-view" threw'),
        ),
      ).toBe(true);
    } finally {
      actFlag.IS_REACT_ACT_ENVIRONMENT = true;
    }
  });

  it("an update throw advances the same way and clears the failed adapter's debris", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failsOnUpdate: ToolViewAdapter = {
      mount(container) {
        const debris = document.createElement("p");
        debris.setAttribute("data-debris", "");
        debris.textContent = "half-drawn reading";
        container.appendChild(debris);
        return {
          update() {
            throw new Error("rung 1 exploded at update");
          },
          destroy() {
            debris.remove();
          },
        };
      },
    };
    const { adapter: named, log } = recordingAdapter("rung2");
    const registry: ToolViewRegistry = {
      "acme.lookup-view": { version: 1, view: failsOnUpdate },
      acme__lookup: { version: 1, view: named },
    };
    await render(rowWithRegistry(registry));
    expect(host.querySelector("[data-debris]")).not.toBeNull();

    // The prop change triggers the throwing update.
    await render(rowWithRegistry(registry, true));
    expect(host.querySelector("[data-debris]")).toBeNull();
    expect(host.textContent).toContain("rung2: output-available");
    expect(log.mounts).toBe(1);
  });
});

describe("rung 4 — the slot's own terminal is the package default view", () => {
  const CALL: ToolViewCall = {
    toolName: "acme__lookup",
    toolCallId: "t1",
    status: "output-available",
    awaitingDecision: false,
    args: { query: "sencha", customer_id: 7 },
  };

  it("exhausted candidates land on the default view — the bounded argument reading", async () => {
    await render(<ToolViewSlot views={[]} call={CALL} />);
    const summary = host.querySelector("[data-tf-approval-request-summary]");
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toContain("Request");
    expect(summary?.textContent).toContain("Query");
    expect(summary?.textContent).toContain("sencha");
  });

  it("a throwing sole candidate falls through to the default view", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const flaky: ResolvedToolView = {
      rung: 1,
      key: "acme.kaboom",
      adapter: {
        mount() {
          throw new Error("kaboom");
        },
      },
    };
    await render(<ToolViewSlot views={[flaky]} call={CALL} />);
    expect(
      host.querySelector("[data-tf-approval-request-summary]"),
    ).not.toBeNull();
  });

  // There is no `terminal` override prop: a row holds no quiet line to
  // fill pixels until views mount. The slot's own terminal — the
  // default view above — is the only rung 4.
});

describe("the icon slot — one registration, two roles", () => {
  function markOf(): HTMLElement {
    const mark = host.querySelector<HTMLElement>("[data-tf-op-mark]");
    if (mark === null) {
      throw new Error("the row rendered no operation mark");
    }
    return mark;
  }

  it("an icon-only registration replaces the operation mark's glyph and nothing else", async () => {
    const icon: ToolViewAdapter = {
      mount(container) {
        const dot = document.createElement("span");
        dot.setAttribute("data-acme-dot", "");
        dot.textContent = "◎";
        container.appendChild(dot);
        return {
          update: () => undefined,
          destroy: () => {
            dot.remove();
          },
        };
      },
    };
    await render(rowWithRegistry({ acme__lookup: { version: 1, icon } }));

    // The glyph is the host's…
    const mark = markOf();
    expect(mark.querySelector("[data-acme-dot]")).not.toBeNull();
    expect(mark.querySelector("svg")).toBeNull();
    // …inside the package-owned chrome: identity, state, and the
    // assistive state word stay ours.
    expect(mark.getAttribute("data-tf-op-state")).toBe("output-available");
    expect(mark.textContent).toContain("Completed");
    // And NOTHING else changed: no host view mounted — the body is the
    // slot's own rung-4 terminal, the bounded input reading.
    expect(
      host.querySelector("[data-tf-tool-view] [data-tf-host-view]"),
    ).toBeNull();
    expect(
      host.querySelector("[data-tf-approval-request-summary]"),
    ).not.toBeNull();
  });

  it("a mounted icon's DOM stays silent to assistive tech — the state word remains the mark's only announced content", async () => {
    const icon: ToolViewAdapter = {
      mount(container) {
        const label = document.createElement("span");
        label.textContent = "◎ acme mark";
        container.appendChild(label);
        return {
          update: () => undefined,
          destroy: () => {
            label.remove();
          },
        };
      },
    };
    await render(rowWithRegistry({ acme__lookup: { version: 1, icon } }));
    const mark = markOf();
    // Sighted readers see the host glyph…
    expect(mark.textContent).toContain("◎ acme mark");
    // …assistive tech hears only the package state word: the mount
    // container is aria-hidden like every package glyph, so nothing an
    // adapter mounts joins the row summary's accessible name.
    expect(_accessibleTextOf(mark)).toBe("Completed");
  });

  it("a throwing icon adapter falls back to the package glyph inside the same chrome", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const kaboom: ToolViewAdapter = {
      mount() {
        throw new Error("icon exploded");
      },
    };
    await render(
      rowWithRegistry({ acme__lookup: { version: 1, icon: kaboom } }),
    );
    const mark = markOf();
    expect(mark.querySelector("svg")).not.toBeNull();
    expect(mark.getAttribute("data-tf-op-state")).toBe("output-available");
    expect(mark.textContent).toContain("Completed");
  });
});
