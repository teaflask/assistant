// @vitest-environment jsdom
/**
 * The subagent-count pill: renders nothing without dispatches, counts
 * the conversation-wide ledger, and opens its roster on hover, focus,
 * or tap — fetching nothing and opening no stream. A delivery turn's
 * conversation (no user bubble at all) still carries the pill.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ComposerActivityOverlay } from "../src/components/activity-shelf";
import { SubagentCountPill } from "../src/components/subagent-count-pill";
import type { ThreadDispatch } from "../src/contract/dispatches";
import { transcriptRowsOf } from "../src/core/transcript-rows";
import { CANNED_MANY_DISPATCHES } from "../fixtures/transcript/canned-data";

vi.mock("../src/components/child-transcript", () => ({
  ChildTranscriptPreview: ({
    threadId,
    childSessionId,
  }: {
    threadId: string;
    childSessionId: string;
  }) => (
    <div data-tf-child-transcript-preview="" role="dialog">
      Preview {threadId}/{childSessionId}
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
  vi.unstubAllGlobals();
});

function _dispatch(
  ordinal: number,
  status: ThreadDispatch["status"],
  overrides: Partial<ThreadDispatch> = {},
): ThreadDispatch {
  return {
    ordinal,
    label: `Task ${String(ordinal)}`,
    status,
    error: status === "failed" ? "The subagent died." : null,
    child_session_id: `child-${String(ordinal)}`,
    created_at: "2026-08-21T10:00:00Z",
    updated_at: "2026-08-21T10:00:41Z",
    ...overrides,
  };
}

function _mapOf(
  dispatches: ThreadDispatch[],
): ReadonlyMap<number, ThreadDispatch> {
  return new Map(dispatches.map((dispatch) => [dispatch.ordinal, dispatch]));
}

function _render(dispatches: ReadonlyMap<number, ThreadDispatch>) {
  act(() => {
    root.render(<SubagentCountPill dispatches={dispatches} />);
  });
}

function _renderWithThread(dispatches: ReadonlyMap<number, ThreadDispatch>) {
  act(() => {
    root.render(
      <SubagentCountPill dispatches={dispatches} threadId="thread-1" />,
    );
  });
}

function _trigger(): HTMLButtonElement {
  const button = host.querySelector("button");
  if (button === null) {
    throw new Error("the pill trigger did not render");
  }
  return button;
}

function _wrapper(): HTMLElement {
  const wrapper = _trigger().parentElement;
  if (wrapper === null) {
    throw new Error("the pill wrapper did not render");
  }
  return wrapper;
}

function _roster(): HTMLElement | null {
  return host.querySelector("[role=dialog]");
}

function _openCard(): HTMLElement {
  const card = _roster();
  if (card === null) {
    throw new Error("the roster card is not open");
  }
  return card;
}

function _hoverIn(target: Element, pointerType = "mouse") {
  act(() => {
    target.dispatchEvent(
      new PointerEvent("pointerover", { bubbles: true, pointerType }),
    );
  });
}

function _hoverOut(target: Element, pointerType = "mouse") {
  act(() => {
    target.dispatchEvent(
      new PointerEvent("pointerout", {
        bubbles: true,
        pointerType,
        relatedTarget: document.body,
      }),
    );
  });
}

/** One real tap, in the spec's order: pointerover, pointerdown, focus,
 *  pointerup, pointerout/leave (touch leaves BEFORE the compat click),
 *  the compat mouse events, then click. Bare .click() hides the exact
 *  interleaving that broke tap-to-close. */
function _tap(trigger: HTMLButtonElement) {
  act(() => {
    for (const type of ["pointerover", "pointerdown", "pointerup"]) {
      trigger.dispatchEvent(
        new PointerEvent(type, { bubbles: true, pointerType: "touch" }),
      );
    }
    trigger.focus();
    trigger.dispatchEvent(
      new PointerEvent("pointerout", {
        bubbles: true,
        pointerType: "touch",
        relatedTarget: document.body,
      }),
    );
    trigger.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    trigger.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    trigger.click();
  });
}

describe("the subagent-count pill", () => {
  it("renders nothing when the conversation has no subagents", () => {
    _render(_mapOf([]));
    expect(host.querySelector("button")).toBeNull();
  });

  it("counts the whole ledger: live count first, plain total once settled", () => {
    _render(
      _mapOf([
        _dispatch(0, "dispatched"),
        _dispatch(1, "succeeded"),
        _dispatch(2, "dispatched"),
      ]),
    );
    expect(host.textContent).toContain("2 running");
    // The label's shimmer rides only the live state (the one motion
    // register — no pulsing dot).
    expect(host.querySelector("[data-tf-shimmer-text]")).not.toBeNull();

    _render(_mapOf([_dispatch(0, "succeeded"), _dispatch(1, "failed")]));
    // The loss survives the collapse: named in the copy, and the one
    // loud pixel rides the pill as a static destructive dot.
    expect(host.textContent).toContain("2 subagents · 1 failed");
    expect(host.querySelector("[data-tf-shimmer-text]")).toBeNull();
    expect(host.querySelector("button .tf\\:bg-tf-destructive")).not.toBeNull();

    _render(_mapOf([_dispatch(0, "succeeded"), _dispatch(1, "succeeded")]));
    expect(host.textContent).toContain("2 subagents");
    expect(host.querySelector("button .tf\\:bg-tf-destructive")).toBeNull();

    // A live fan-out with a loss shows BOTH facts: the shimmer and the
    // loud pixel, and the copy names the failure.
    _render(_mapOf([_dispatch(0, "dispatched"), _dispatch(1, "failed")]));
    expect(host.textContent).toContain("1 running · 1 failed");
    expect(host.querySelector("[data-tf-shimmer-text]")).not.toBeNull();
    expect(host.querySelector("button .tf\\:bg-tf-destructive")).not.toBeNull();
  });

  it("centers the pill over the transcript and leads with the subagent icon", () => {
    act(() => {
      root.render(
        <div className="relative">
          <ComposerActivityOverlay
            activity={
              <SubagentCountPill
                dispatches={_mapOf([_dispatch(0, "succeeded")])}
              />
            }
          />
        </div>,
      );
    });

    const pillRoot = _trigger().parentElement;
    expect(pillRoot?.classList.contains("tf:w-fit")).toBe(true);
    expect(pillRoot?.hasAttribute("data-tf-shelf-item")).toBe(true);
    expect(pillRoot?.classList.contains("tf:pointer-events-auto")).toBe(true);
    // The transparent overlay is absolutely positioned and does not
    // reserve a full-width band. It alone centers the compact tenant.
    const slot = pillRoot?.closest("[data-tf-activity-slot]");
    expect(slot?.classList.contains("tf:absolute")).toBe(true);
    expect(slot?.classList.contains("tf:bottom-full")).toBe(true);
    expect(slot?.classList.contains("tf:pointer-events-none")).toBe(true);
    expect(slot?.classList.contains("tf:flex-col")).toBe(true);
    expect(slot?.classList.contains("tf:items-center")).toBe(true);
    expect(slot?.classList.contains("tf:pb-4")).toBe(true);
    // The TeaFlask mark in the subagent register — never a
    // generic bot glyph.
    expect(
      _trigger().querySelector('[data-tf-agent-mark="subagent"]'),
    ).not.toBeNull();
    expect(_trigger().classList.contains("tf:min-h-11")).toBe(true);
    expect(_trigger().className).not.toContain("md:min-h-0");
  });

  it("a roster row reads compact metadata without dumping the settled result", () => {
    _render(
      _mapOf([
        _dispatch(0, "succeeded", {
          summary: "Descaling guidance still matches.",
        }),
        _dispatch(1, "failed"),
        _dispatch(2, "dispatched"),
      ]),
    );
    act(() => {
      _trigger().click();
    });
    const card = _openCard();
    // Explicit status in words on every row — the dot is never the only
    // signal.
    expect(card.textContent).toContain("Finished");
    expect(card.textContent).toContain("Failed");
    expect(card.textContent).toContain("Working");
    // The COMPACT register: the status word owns the verb, so the span
    // beside it is the bare house ladder — never "Finished · Worked
    // for 41s". Settled rows only; the running row gets no clock.
    const worked = [...card.querySelectorAll("[data-tf-subagent-worked]")];
    expect(worked).toHaveLength(2);
    for (const span of worked) {
      expect(span.textContent).toBe("· 41s");
    }
    expect(card.textContent).not.toContain("Worked for");
    // Result summaries belong in the adjacent child transcript, not in
    // the compact roster row.
    expect(card.querySelector("[data-tf-subagent-summary]")).toBeNull();
    expect(card.textContent).not.toContain("Descaling guidance still matches.");
    // The TeaFlask flask is the complete identity treatment. It must not
    // be cheapened into an avatar by adding a circular background plate.
    for (const mark of card.querySelectorAll(
      '[data-tf-agent-mark="subagent"]',
    )) {
      expect(mark.parentElement?.classList.contains("tf:rounded-full")).toBe(
        false,
      );
      expect(mark.parentElement?.classList.contains("tf:bg-tf-muted")).toBe(
        false,
      );
    }
    for (const chevron of card.querySelectorAll("li button svg:last-of-type")) {
      expect(chevron.getAttribute("class")).toContain("tf:opacity-0");
      expect(chevron.getAttribute("class")).toContain(
        "tf:group-hover/subagent:opacity-100",
      );
    }
  });

  it("a failed roster row carries its reason — the loss line mirrors the success line (round 5)", () => {
    // A failed row must not be the one row that cannot explain itself — the
    // roster is the only surface where an earlier turn's failed
    // coworker stays reachable, and rosterEntriesOf mints a fallback
    // sentence precisely so a reason always exists.
    _render(
      _mapOf([_dispatch(0, "failed"), _dispatch(1, "failed", { error: null })]),
    );
    act(() => {
      _trigger().click();
    });
    const notes = [..._openCard().querySelectorAll("[data-tf-subagent-note]")];
    expect(notes).toHaveLength(2);
    expect(notes[0].textContent).toBe("The subagent died.");
    // error is nullable on the wire: the minted fallback still renders.
    expect(notes[1].textContent).toBe(
      "The subagent failed before it could report back.",
    );
  });

  it("hover opens the roster and leaving closes it", () => {
    _render(_mapOf([_dispatch(0, "dispatched"), _dispatch(1, "failed")]));
    expect(_roster()).toBeNull();

    _hoverIn(_trigger());
    const roster = _roster();
    expect(roster).not.toBeNull();
    expect(roster?.getAttribute("aria-label")).toBe("Subagents");
    // Grouped, with headers only because more than one bucket is live.
    expect(roster?.textContent).toContain("Running");
    expect(roster?.textContent).toContain("Failed");
    expect(roster?.textContent).toContain("Task 0");
    // Round 5: a failed row explains itself in place — the ledger error
    // (or the minted fallback) rides the row as its note line.
    expect(roster?.textContent).toContain("The subagent died.");
    expect(roster?.querySelector(".tf\\:text-tf-destructive")).not.toBeNull();
    expect(roster?.closest("[data-tf-subagent-disclosure]")).not.toBeNull();
    expect(_wrapper().closest("[data-tf-subagent-pill]")).not.toBeNull();

    _hoverOut(_wrapper());
    expect(_roster()).toBeNull();
  });

  it("a single-bucket roster skips the group headers", () => {
    _render(_mapOf([_dispatch(0, "succeeded"), _dispatch(1, "succeeded")]));
    _hoverIn(_trigger());
    const roster = _roster();
    expect(roster?.textContent).toContain("Task 0");
    expect(roster?.textContent).not.toContain("Completed");
  });

  it("a roster at scale renders every coworker inside the capped scrolling list", () => {
    // The roster at scale: 33 dispatches (the bench's own bulk fixture)
    // must all reach the DOM — a silent cap would hide coworkers — and
    // the list itself must carry the scroll bound so the popover never
    // grows past the viewport.
    _render(CANNED_MANY_DISPATCHES);
    _hoverIn(_trigger());
    const roster = _roster();
    expect(roster).not.toBeNull();
    const list = roster?.querySelector("ul");
    expect(list?.className).toContain("tf:max-h-64");
    expect(list?.className).toContain("tf:overflow-y-auto");
    expect(list?.querySelectorAll("[data-tf-subagent-identity]")).toHaveLength(
      33,
    );
    expect(roster?.textContent).toContain(
      "Audit doc 1 of the steeping corpus.",
    );
    expect(roster?.textContent).toContain(
      "Audit doc 33 of the steeping corpus.",
    );
  });

  it("focus opens the roster; Escape closes it and keeps focus on the trigger", () => {
    _render(_mapOf([_dispatch(0, "dispatched")]));
    const trigger = _trigger();
    act(() => {
      trigger.focus();
    });
    expect(_roster()).not.toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(_roster()?.id);

    act(() => {
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(_roster()).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("a real tap toggles: open on the first, closed on the second", () => {
    // The full spec order matters twice over: the tap's own focus must
    // not pre-open what the click then toggles back closed, and touch's
    // pointerleave (fired BEFORE the compat click) must not pre-close
    // what the click then toggles back open.
    _render(_mapOf([_dispatch(0, "succeeded")]));
    _tap(_trigger());
    expect(_roster()).not.toBeNull();
    _tap(_trigger());
    expect(_roster()).toBeNull();
  });

  it("a pen hover opens like a mouse — only touch defers to the tap", () => {
    _render(_mapOf([_dispatch(0, "succeeded")]));
    _hoverIn(_trigger(), "pen");
    expect(_roster()).not.toBeNull();
    _hoverOut(_wrapper(), "pen");
    expect(_roster()).toBeNull();
  });

  it("a stale pointer flag never mutes a later keyboard focus", () => {
    _render(_mapOf([_dispatch(0, "succeeded")]));
    const trigger = _trigger();
    // Tap open, tap closed (the flag's last writer is the pointerdown),
    // then focus moves away and Tab returns — the focus-open must fire.
    _tap(trigger);
    _tap(trigger);
    act(() => {
      trigger.blur();
    });
    expect(_roster()).toBeNull();
    act(() => {
      trigger.focus();
    });
    expect(_roster()).not.toBeNull();
  });

  it("an outside pointerdown light-dismisses the tap-opened roster", () => {
    _render(_mapOf([_dispatch(0, "succeeded")]));
    act(() => {
      _trigger().click();
    });
    expect(_roster()).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(_roster()).toBeNull();
  });

  it("opening the roster fetches nothing and opens no stream", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const eventSourceSpy = vi.fn();
    vi.stubGlobal("EventSource", eventSourceSpy);

    _render(
      _mapOf(
        Array.from({ length: 33 }, (_, ordinal) =>
          _dispatch(ordinal, "succeeded"),
        ),
      ),
    );
    expect(host.textContent).toContain("33 subagents");
    act(() => {
      _trigger().click();
    });
    expect(_roster()).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(eventSourceSpy).not.toHaveBeenCalled();
  });

  it("a roster row opens an adjacent transcript preview without leaving the conversation", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    _renderWithThread(_mapOf([_dispatch(0, "succeeded")]));
    act(() => {
      _trigger().click();
    });
    const row = _openCard().querySelector<HTMLButtonElement>("li button");
    if (row === null) {
      throw new Error("the preview row did not render");
    }
    expect(row.querySelector('[data-tf-agent-mark="subagent"]')).not.toBeNull();
    expect(row.querySelector(".lucide-chevron-right")).not.toBeNull();
    _hoverIn(row);
    const preview = host.querySelector("[data-tf-child-transcript-preview]");
    expect(preview?.textContent).toContain("thread-1/child-0");
    const previewPopover = host.querySelector<HTMLElement>("[popover=manual]");
    expect(previewPopover?.getAttribute("role")).toBe("dialog");
    expect(previewPopover?.style.width).toBe("384px");
    expect(previewPopover?.classList.contains("tf:text-tf-foreground")).toBe(
      true,
    );
    const bridge = previewPopover?.querySelector(
      "[data-tf-subagent-preview-hover-bridge]",
    );
    expect(bridge).not.toBeNull();
    expect(bridge?.getAttribute("class")).toContain("tf:-inset-2");
    expect(bridge?.getAttribute("class")).toContain("tf:pointer-events-auto");
    expect(row.getAttribute("aria-controls")).toBe(previewPopover?.id);
    expect(row.classList.contains("tf:min-h-11")).toBe(true);
    expect(_roster()).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Escape closes the preview first, then the roster", () => {
    _renderWithThread(_mapOf([_dispatch(0, "succeeded")]));
    act(() => {
      _trigger().click();
    });
    const card = _openCard();
    const row = card.querySelector<HTMLButtonElement>("li button");
    act(() => {
      row?.focus();
    });
    expect(
      host.querySelector("[data-tf-child-transcript-preview]"),
    ).not.toBeNull();
    act(() => {
      card.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(host.querySelector("[data-tf-child-transcript-preview]")).toBeNull();
    expect(_roster()).not.toBeNull();
    act(() => {
      card.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(_roster()).toBeNull();
    expect(document.activeElement).toBe(_trigger());
  });

  it("ArrowRight enters the preview and Escape returns to its row", () => {
    _renderWithThread(_mapOf([_dispatch(0, "succeeded")]));
    act(() => {
      _trigger().focus();
    });
    const row = _openCard().querySelector<HTMLButtonElement>("li button");
    if (row === null) {
      throw new Error("the preview row did not render");
    }
    act(() => {
      row.focus();
    });
    act(() => {
      row.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    const preview = host.querySelector<HTMLElement>("[popover=manual]");
    expect(document.activeElement).toBe(preview);

    act(() => {
      preview?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(host.querySelector("[popover=manual]")).toBeNull();
    expect(document.activeElement).toBe(row);
    expect(_roster()).not.toBeNull();
  });

  it("row-focused Escape does not mute the next row's preview", () => {
    _renderWithThread(
      _mapOf([_dispatch(0, "succeeded"), _dispatch(1, "succeeded")]),
    );
    act(() => {
      _trigger().focus();
    });
    const rows = [
      ..._openCard().querySelectorAll<HTMLButtonElement>("li button"),
    ];
    expect(rows).toHaveLength(2);
    act(() => {
      rows[0]?.focus();
    });
    act(() => {
      rows[0]?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(host.querySelector("[popover=manual]")).toBeNull();

    act(() => {
      rows[1]?.focus();
    });
    expect(host.querySelector("[popover=manual]")).not.toBeNull();
    expect(host.textContent).toContain("thread-1/child-1");
  });

  it("a passive-ink click (card focus) never parks the roster past the hover", () => {
    // The card itself carries tabIndex -1 and takes focus from a click on
    // its passive ink. That focus is
    // not a keyboard user's place: hovering away must still close, or the
    // roster parks over the composer until Esc or an outside click.
    _renderWithThread(_mapOf([_dispatch(0, "failed")]));
    act(() => {
      _trigger().click();
    });
    act(() => {
      _openCard().focus();
    });
    expect(document.activeElement).toBe(_openCard());
    _hoverOut(_wrapper());
    expect(_roster()).toBeNull();
  });

  it("pointer-leave never closes the roster out from under a focused row", () => {
    // With keyboard focus walked into a preview row, the hover-close
    // must bail — closing would unmount the element that holds focus and
    // drop the member's place to <body> (no travel grace on this twin:
    // the close is immediate). A leave with focus elsewhere still closes.
    _renderWithThread(_mapOf([_dispatch(0, "succeeded")]));
    act(() => {
      _trigger().focus();
    });
    const row = _openCard().querySelector<HTMLButtonElement>("li button");
    act(() => {
      row?.focus();
    });
    _hoverOut(_wrapper());
    expect(_roster()).not.toBeNull();
    expect(document.activeElement).toBe(row);

    // Focus moves out of the pair: the same leave now closes.
    act(() => {
      row?.blur();
    });
    _hoverOut(_wrapper());
    expect(_roster()).toBeNull();
  });

  it("keyboard focus walks from the trigger into the rows without closing", () => {
    // The card sits inline beside the trigger, so Tab reaches the row
    // buttons in DOM order; the wrapper's blur guard must read that as
    // focus staying inside the pair, not as leaving.
    _renderWithThread(_mapOf([_dispatch(0, "succeeded")]));
    act(() => {
      _trigger().focus();
    });
    expect(_roster()).not.toBeNull();
    const row = _openCard().querySelector<HTMLButtonElement>("li button");
    act(() => {
      row?.focus();
    });
    expect(_roster()).not.toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it("without the seam the roster rows stay passive ink", () => {
    _render(_mapOf([_dispatch(0, "succeeded")]));
    act(() => {
      _trigger().click();
    });
    expect(_openCard().querySelector("li button")).toBeNull();
  });

  it("a delivery-turn conversation (no user bubble) still carries the pill", () => {
    // The delivery-turn shape: the newest turn is machine-authored, so
    // the wire holds assistant/tool messages with no user message at
    // all.
    const rows = transcriptRowsOf(
      [
        {
          id: "a-delivery",
          role: "assistant",
          content: "Your three subagents reported back.",
        },
      ],
      {
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
      },
      false,
    );
    expect(rows.some((row) => row.kind === "user")).toBe(false);

    _render(_mapOf([_dispatch(0, "succeeded"), _dispatch(1, "succeeded")]));
    expect(host.textContent).toContain("2 subagents");
  });
});

// The two pills' interaction matrices are mechanism-divergent (hand-rolled
// here, Radix on the dashboard) but must stay OBSERVABLY identical — this
// block mirrors tests/conversations/subagent-activity-pill.test.tsx's
// matrix block case for case.
describe("the interaction matrix (parity with the dashboard pill)", () => {
  it("pointer travel from pill to card keeps the roster open", () => {
    _render(_mapOf([_dispatch(0, "succeeded")]));
    _hoverIn(_trigger());
    const card = _roster();
    expect(card).not.toBeNull();
    // Leaving the trigger TOWARD the card never leaves the wrapper, so
    // the leave-close must not fire.
    act(() => {
      _trigger().dispatchEvent(
        new PointerEvent("pointerout", {
          bubbles: true,
          pointerType: "mouse",
          relatedTarget: card,
        }),
      );
    });
    expect(_roster()).not.toBeNull();
  });

  it("a click inside the card keeps it open — reading is not leaving", () => {
    _render(_mapOf([_dispatch(0, "failed")]));
    const trigger = _trigger();
    _tap(trigger);
    const card = _openCard();
    // The browser order for a press on the card's non-control content:
    // pointerdown on the card, then focus moves to the card (tabIndex -1)
    // and the trigger blurs toward it.
    act(() => {
      card.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerType: "touch",
        }),
      );
      card.focus();
      trigger.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: card }),
      );
    });
    expect(_roster()).not.toBeNull();
  });

  it("Escape from inside the card closes it, refocuses the pill, and stays closed", () => {
    _render(_mapOf([_dispatch(0, "succeeded")]));
    _tap(_trigger());
    const card = _openCard();
    act(() => {
      card.focus();
      card.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(_roster()).toBeNull();
    expect(document.activeElement).toBe(_trigger());
    // The handback's focus event must not reopen what Esc just closed.
    expect(_roster()).toBeNull();
  });

  it("a hover sweep never steals focus", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    try {
      _render(_mapOf([_dispatch(0, "succeeded")]));
      act(() => {
        input.focus();
      });
      _hoverIn(_trigger());
      expect(_roster()).not.toBeNull();
      _hoverOut(_wrapper());
      expect(_roster()).toBeNull();
      expect(document.activeElement).toBe(input);
    } finally {
      input.remove();
    }
  });

  it("an aborted press never mutes the next keyboard focus", () => {
    _render(_mapOf([_dispatch(0, "succeeded")]));
    const trigger = _trigger();
    // The pill holds focus, so the press fires no focus event to consume
    // the mute: mouse down, drag off (pointerleave), release elsewhere —
    // no click either.
    act(() => {
      trigger.focus();
    });
    expect(_roster()).not.toBeNull();
    act(() => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerType: "mouse",
          button: 0,
        }),
      );
      trigger.dispatchEvent(
        new PointerEvent("pointerout", {
          bubbles: true,
          pointerType: "mouse",
          relatedTarget: document.body,
        }),
      );
      document.body.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse" }),
      );
    });
    act(() => {
      trigger.blur();
    });
    expect(_roster()).toBeNull();
    act(() => {
      trigger.focus();
    });
    expect(_roster()).not.toBeNull();
  });

  it("a right-click never mutes the next keyboard focus", () => {
    _render(_mapOf([_dispatch(0, "succeeded")]));
    const trigger = _trigger();
    // A secondary press fires neither focus nor click.
    act(() => {
      for (const type of ["pointerdown", "pointerup"]) {
        trigger.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerType: "mouse",
            button: 2,
          }),
        );
      }
    });
    expect(_roster()).toBeNull();
    act(() => {
      trigger.focus();
    });
    expect(_roster()).not.toBeNull();
  });
});
