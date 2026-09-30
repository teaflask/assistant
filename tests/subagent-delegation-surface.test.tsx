// @vitest-environment jsdom
/**
 * The conversation's drill-in host: a delegation row's click floats the
 * shared child-transcript preview beside the row, Escape and light
 * dismissal close it with focus handed back to the opener, a host
 * without a thread id keeps the rows passive, and the current-work
 * publisher feeds the group row's live-operation line.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SubagentDelegationSurface } from "../src/components/subagent-delegation-surface";
import { SubagentCountPill } from "../src/components/subagent-count-pill";
import {
  useSubagentCurrentWork,
  useSubagentCurrentWorkPublisher,
} from "../src/components/subagent-current-work";
import {
  SubagentDispatchesContext,
  SubagentGroupRow,
} from "../src/components/subagent-group-row";
import type { ThreadDispatch } from "../src/contract/dispatches";
import type { SubagentGroupRow as SubagentGroupRowModel } from "../src/core/subagent-rows";
import { toolCallPresentationOf } from "../src/core/tool-call-presentation";
import type { ToolCallViewModel } from "../src/core/tool-call-display";

vi.mock("../src/components/child-transcript", () => ({
  ChildTranscriptPreview: ({
    threadId,
    childSessionId,
    variantIndex,
  }: {
    threadId: string;
    childSessionId: string;
    variantIndex?: number;
  }) => (
    <div data-tf-child-transcript-preview="" role="region">
      Preview {threadId}/{childSessionId}/{variantIndex ?? "none"}
    </div>
  ),
}));

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

function _dispatch(ordinal: number): ThreadDispatch {
  return {
    ordinal,
    label: `Task ${String(ordinal)}`,
    status: "dispatched",
    error: null,
    child_session_id: `child-${String(ordinal)}`,
    created_at: "2026-08-21T10:00:00Z",
    updated_at: "2026-08-21T10:00:00Z",
  };
}

const _DISPATCHES: ReadonlyMap<number, ThreadDispatch> = new Map(
  [_dispatch(0), _dispatch(1)].map((dispatch) => [dispatch.ordinal, dispatch]),
);

const _ROW: SubagentGroupRowModel = {
  kind: "subagent-group",
  key: "subagents:call-1",
  entries: [0, 1].map((ordinal) => ({
    toolCallId: `call-${String(ordinal)}`,
    receipt: {
      outcome: "launched",
      ordinal,
      label: `Task ${String(ordinal)}`,
      childSessionId: `child-${String(ordinal)}`,
      settled: null,
    },
    label: `Task ${String(ordinal)}`,
    running: true,
    failed: false,
    cancelled: false,
    note: null,
  })),
};

function _render(threadId: string | undefined, publish?: PublishProbeProps) {
  act(() => {
    root.render(
      <SubagentDelegationSurface dispatches={_DISPATCHES} threadId={threadId}>
        <SubagentDispatchesContext.Provider value={{ byOrdinal: _DISPATCHES }}>
          <SubagentGroupRow row={_ROW} />
          {publish !== undefined ? <PublishProbe {...publish} /> : null}
        </SubagentDispatchesContext.Provider>
      </SubagentDelegationSurface>,
    );
  });
}

interface PublishProbeProps {
  childSessionId: string;
  view: ToolCallViewModel | null;
}

/** Stands in for the open child stream — the seam's one honest writer. */
function PublishProbe({ childSessionId, view }: PublishProbeProps) {
  const publish = useSubagentCurrentWorkPublisher();
  useEffect(() => {
    publish(childSessionId, view);
  }, [publish, childSessionId, view]);
  return null;
}

/** Records every distinct map identity the consumer context hands out —
 *  the observable the equal-evidence guard exists to hold still. */
function MapIdentityProbe({
  capturedMaps,
}: {
  capturedMaps: ReadonlyMap<string, ToolCallViewModel>[];
}) {
  const map = useSubagentCurrentWork();
  useEffect(() => {
    if (capturedMaps.at(-1) !== map) {
      capturedMaps.push(map);
    }
  });
  return null;
}

function _rowButtons(): HTMLButtonElement[] {
  return [
    ...host.querySelectorAll<HTMLButtonElement>(
      "button[data-tf-subagent-entry]",
    ),
  ];
}

function _preview(): HTMLElement | null {
  return host.querySelector("[data-tf-child-transcript-preview]");
}

describe("the subagent delegation surface", () => {
  it("a row's drill-in opens the shared preview for exactly that child, with its variant", () => {
    _render("thread-1");
    const second = _rowButtons()[1];
    act(() => {
      second.click();
    });
    expect(_preview()?.textContent).toContain("thread-1/child-1/2");
    // One preview at a time — the popover is keyed per child.
    expect(
      host.querySelectorAll("[data-tf-child-transcript-preview]"),
    ).toHaveLength(1);
    // The floating shell is the shared popover dialog and holds focus,
    // so Escape routes through it.
    const popover = host.querySelector<HTMLElement>("[popover=manual]");
    expect(popover?.getAttribute("role")).toBe("dialog");
    expect(document.activeElement).toBe(popover);
  });

  it("Escape closes the preview and hands focus back to the opener row", () => {
    _render("thread-1");
    const opener = _rowButtons()[0];
    act(() => {
      opener.click();
    });
    expect(_preview()).not.toBeNull();
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(_preview()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("a pointer down outside dismisses; inside the preview it does not", () => {
    _render("thread-1");
    act(() => {
      _rowButtons()[0].click();
    });
    const inside = _preview();
    if (inside === null) {
      throw new Error("the preview did not open");
    }
    act(() => {
      inside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(_preview()).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(_preview()).toBeNull();
  });

  it("without a thread id the rows stay honestly passive — no drill-in seam", () => {
    _render(undefined);
    expect(_rowButtons()).toHaveLength(0);
    expect(host.textContent).toContain("Task 0");
  });

  it("a thread switch drops an open drill-in — and returning to the first thread never revives it", () => {
    _render("thread-1");
    act(() => {
      _rowButtons()[0].click();
    });
    expect(_preview()?.textContent).toContain("thread-1/child-0");
    // The conversation moves to another thread: the held childSessionId
    // belongs to the OLD thread's ledger, so the popover must not float
    // over the new one (failure-mode ledger, mode 8).
    _render("thread-2");
    expect(_preview()).toBeNull();
    // Round 2: the shipped host remounts Transcript per thread
    // (conversation-view.tsx keys it by thread.id#reconnectNonce), so
    // this in-place prop swap is HARSHER than production — and the
    // surface must hold its own even here: coming BACK to the first
    // thread must not re-float a preview the reader never re-opened
    // (a thread-id stamp would match again; the per-visit stamp never
    // recurs).
    _render("thread-1");
    expect(_preview()).toBeNull();
  });

  it("Escape dismisses the preview itself — never a host panel above it (the drawer's own Esc-to-close)", () => {
    // The shipped companion drawer (primitives/floating-panel.tsx)
    // closes itself from a React onKeyDown on the panel div —
    // dispatched from React's ROOT container, which sits between this
    // popover and `document`. This wrapper replicates that exact
    // handler (key check, defaultPrevented guard, stopPropagation), so
    // a document-level Escape listener here would never run inside the
    // drawer: the panel would minimize with the preview still open.
    // The preview's listener must therefore ride the preview element
    // itself and stop propagation — the roster card's idiom.
    const panelCloses: number[] = [];
    const closeFromEscape = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }
      event.stopPropagation();
      panelCloses.push(1);
    };
    act(() => {
      root.render(
        <div onKeyDown={closeFromEscape}>
          <SubagentDelegationSurface
            dispatches={_DISPATCHES}
            threadId="thread-1"
          >
            <SubagentDispatchesContext.Provider
              value={{ byOrdinal: _DISPATCHES }}
            >
              <SubagentGroupRow row={_ROW} />
            </SubagentDispatchesContext.Provider>
          </SubagentDelegationSurface>
        </div>,
      );
    });
    act(() => {
      _rowButtons()[0].click();
    });
    expect(_preview()).not.toBeNull();
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    // One keystroke, one action: the preview closed, the panel did not.
    expect(_preview()).toBeNull();
    expect(panelCloses).toHaveLength(0);
  });

  it("equal-evidence publishes coalesce: the map holds still, so rows never re-render on prose deltas", () => {
    // The guard's premise, proven live (never by reading it): the child
    // stream derives a FRESH view object per delta, so only VALUE
    // equality over the label-bearing evidence (toolName + authored
    // progressText) can make the bail-out fire. It fires here — two
    // distinct objects, same evidence, ONE map identity — and stops
    // firing when the evidence changes. Removing the guard turns the
    // first assertion red.
    const capturedMaps: ReadonlyMap<string, ToolCallViewModel>[] = [];
    const viewOf = (input: string, toolName = "docs_search") =>
      ({ toolName, state: "input-available", input }) as const;
    const renderWithView = (view: ToolCallViewModel) => {
      act(() => {
        root.render(
          <SubagentDelegationSurface
            dispatches={_DISPATCHES}
            threadId="thread-1"
          >
            <SubagentDispatchesContext.Provider
              value={{ byOrdinal: _DISPATCHES }}
            >
              <SubagentGroupRow row={_ROW} />
              <PublishProbe childSessionId="child-0" view={view} />
              <MapIdentityProbe capturedMaps={capturedMaps} />
            </SubagentDispatchesContext.Provider>
          </SubagentDelegationSurface>,
        );
      });
    };
    renderWithView(viewOf('{"query":"a"}'));
    const afterFirst = capturedMaps.at(-1);
    expect(afterFirst?.get("child-0")?.input).toBe('{"query":"a"}');
    // A prose-delta-shaped republish: fresh object, same evidence — the
    // map identity must not move (React bails, no consumer re-renders).
    renderWithView(viewOf('{"query":"ab"}'));
    expect(capturedMaps.at(-1)).toBe(afterFirst);
    // Genuinely new evidence — a different call became newest — moves
    // the map and reaches the row.
    renderWithView(viewOf("{}", "read_file"));
    expect(capturedMaps.at(-1)).not.toBe(afterFirst);
    expect(capturedMaps.at(-1)?.get("child-0")?.toolName).toBe("read_file");
  });

  it("hovering the pill's roster open dismisses an open drill-in — at most one preview surface at a time", () => {
    // Round 4 (unanimous): the roster's defocus blur targets every
    // conversation-body child outside the shelf, and the tail budget is
    // capacity 1 — a drill-in left open under an opening roster would be
    // blurred, inert, and starving the roster's own preview. The pill's
    // open paths dismiss the drill-in through the seam instead.
    act(() => {
      root.render(
        <SubagentDelegationSurface dispatches={_DISPATCHES} threadId="thread-1">
          <SubagentDispatchesContext.Provider
            value={{ byOrdinal: _DISPATCHES }}
          >
            <SubagentGroupRow row={_ROW} />
            <SubagentCountPill dispatches={_DISPATCHES} threadId="thread-1" />
          </SubagentDispatchesContext.Provider>
        </SubagentDelegationSurface>,
      );
    });
    act(() => {
      _rowButtons()[0].click();
    });
    expect(_preview()).not.toBeNull();
    const pillTrigger = host.querySelector<HTMLButtonElement>(
      "[data-tf-subagent-pill] button",
    );
    if (pillTrigger === null) {
      throw new Error("the pill did not render");
    }
    act(() => {
      pillTrigger.dispatchEvent(
        new PointerEvent("pointerover", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
    });
    // The roster is open; the drill-in preview is gone — never both.
    expect(host.querySelector("[data-tf-subagent-disclosure]")).not.toBeNull();
    expect(_preview()).toBeNull();
  });

  it("pressing an open row again dismisses its preview — aria-expanded promises a toggle, so the handler performs one", () => {
    // Round 5: announcing expanded state while the second activation
    // re-opens is a broken promise to AT users — the row must toggle.
    _render("thread-1");
    const opener = _rowButtons()[0];
    act(() => {
      opener.click();
    });
    expect(_preview()).not.toBeNull();
    expect(opener.getAttribute("aria-expanded")).toBe("true");
    act(() => {
      opener.click();
    });
    expect(_preview()).toBeNull();
    expect(opener.getAttribute("aria-expanded")).toBe("false");
  });

  it("a sibling-surface dismiss returns focus to the opener — never dropped to body", () => {
    // Round 5 overturned the round-4 rationale: the popover holds focus
    // for EVERY drill-in (the open effect focuses it), so unmounting it
    // without a focus move strands keyboard and AT readers on <body> —
    // the exact failure the pill's own pointer-leave guard exists to
    // prevent. The dismiss restores the opener exactly when the popover
    // contains focus at that moment.
    act(() => {
      root.render(
        <SubagentDelegationSurface dispatches={_DISPATCHES} threadId="thread-1">
          <SubagentDispatchesContext.Provider
            value={{ byOrdinal: _DISPATCHES }}
          >
            <SubagentGroupRow row={_ROW} />
            <SubagentCountPill dispatches={_DISPATCHES} threadId="thread-1" />
          </SubagentDispatchesContext.Provider>
        </SubagentDelegationSurface>,
      );
    });
    const opener = _rowButtons()[0];
    act(() => {
      opener.click();
    });
    expect(document.activeElement).toBe(host.querySelector("[popover=manual]"));
    const pillTrigger = host.querySelector<HTMLButtonElement>(
      "[data-tf-subagent-pill] button",
    );
    act(() => {
      pillTrigger?.dispatchEvent(
        new PointerEvent("pointerover", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
    });
    expect(_preview()).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("a drill-in row carries the dialog affordance semantics its roster twin has", () => {
    _render("thread-1");
    const [first, second] = _rowButtons();
    expect(first.getAttribute("aria-haspopup")).toBe("dialog");
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(first.hasAttribute("aria-controls")).toBe(false);
    act(() => {
      first.click();
    });
    // The opener row announces its open dialog and references it; the
    // sibling row does not.
    expect(first.getAttribute("aria-expanded")).toBe("true");
    const popover = host.querySelector<HTMLElement>("[popover=manual]");
    expect(first.getAttribute("aria-controls")).toBe(popover?.id);
    expect(popover?.id).not.toBe("");
    expect(second.getAttribute("aria-expanded")).toBe("false");
    expect(second.hasAttribute("aria-controls")).toBe(false);
  });

  it("a published current-work view reaches the row through the presenter's slot", () => {
    const view: ToolCallViewModel = {
      toolName: "docs_search",
      state: "input-available",
      input: "{}",
    };
    _render("thread-1", { childSessionId: "child-0", view });
    const label = host.querySelector("[data-tf-subagent-current-work]");
    expect(label?.textContent).toBe(
      toolCallPresentationOf(view).currentWorkLabel,
    );
    // Clearing the entry removes the line cleanly.
    _render("thread-1", { childSessionId: "child-0", view: null });
    expect(host.querySelector("[data-tf-subagent-current-work]")).toBeNull();
  });
});
