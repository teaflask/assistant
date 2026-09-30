// @vitest-environment jsdom

// Characterization pin for the sheet's swipe-to-dismiss gesture. Every
// behavior asserted here was a deliberate fix (the stale-flick guard, the
// cancel-is-not-a-dismissal rule, the click swallow, the cleanup on an
// open-state change), so the suite's job is to hold the machine still
// while it is moved or shared — a refactor is correct exactly when this
// file passes unchanged.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { TfSheet } from "../src/components/primitives/sheet";

// The gesture's published tuning, restated as this file's own constants:
// the pin must notice if the feel is retuned, not silently follow.
const PANEL_WIDTH_PX = 320;
const DISMISS_TRAVEL_PX = PANEL_WIDTH_PX * 0.25;
const DRAG_SLOP_PX = 8;
const FLICK_GOES_STALE_AFTER_MS = 100;

declare global {
  // React's documented act() opt-in global; declare-global var is the
  // only way to type an ambient global.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  // jsdom ships the <dialog> element without its methods; the sheet only
  // needs `open` to track showModal()/close() and a close event to fire,
  // which the attribute reflection already supports.
  const dialogProto = window.HTMLDialogElement.prototype as {
    showModal?: () => void;
    close?: () => void;
    open: boolean;
    dispatchEvent: (event: Event) => boolean;
  };
  dialogProto.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  dialogProto.close ??= function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };

  // jsdom has no pointer capture; the machine treats capture as an
  // optimisation (a try/catch in the commit path), but hasPointerCapture
  // is read unconditionally on release, so the trio must exist.
  const captured = new WeakMap<Element, Set<number>>();
  const elementProto = window.Element.prototype as unknown as {
    setPointerCapture: (pointerId: number) => void;
    releasePointerCapture: (pointerId: number) => void;
    hasPointerCapture: (pointerId: number) => boolean;
  };
  elementProto.setPointerCapture = function (this: Element, pointerId) {
    const ids = captured.get(this) ?? new Set<number>();
    ids.add(pointerId);
    captured.set(this, ids);
  };
  elementProto.releasePointerCapture = function (this: Element, pointerId) {
    captured.get(this)?.delete(pointerId);
  };
  elementProto.hasPointerCapture = function (this: Element, pointerId) {
    return captured.get(this)?.has(pointerId) ?? false;
  };
});

interface Harness {
  panel: HTMLDialogElement;
  row: HTMLButtonElement;
  onOpenChange: ReturnType<typeof vi.fn>;
  onRowClick: ReturnType<typeof vi.fn>;
  rerender: (open: boolean) => void;
}

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
});

function renderSheet(side: "left" | "right" = "right"): Harness {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const onOpenChange = vi.fn();
  const onRowClick = vi.fn();
  const render = (open: boolean) => {
    act(() => {
      root?.render(
        <TfSheet
          open={open}
          onOpenChange={onOpenChange}
          side={side}
          aria-label="Conversations"
        >
          <button type="button" data-testid="row" onClick={onRowClick}>
            A conversation
          </button>
        </TfSheet>,
      );
    });
  };
  render(true);
  const panel = container.querySelector("dialog");
  const row = container.querySelector<HTMLButtonElement>("[data-testid='row']");
  if (panel === null || row === null) {
    throw new Error("The sheet did not render its panel and row.");
  }
  // jsdom has no layout; the dismiss threshold reads the panel's own
  // rendered width, so the pin supplies one.
  Object.defineProperty(panel, "offsetWidth", { value: PANEL_WIDTH_PX });
  return {
    panel,
    row,
    onOpenChange,
    onRowClick,
    rerender: render,
  };
}

// A finger event with a steerable clock: velocity and flick staleness are
// judged from event.timeStamp, which jsdom stamps with real time. The
// epoch below keeps every stamp truthy — React swaps a falsy timeStamp
// for Date.now(), which would silently poison the velocity math.
const CLOCK_EPOCH_MS = 1_000_000;

function fingerEvent(
  type: string,
  at: { x: number; y: number; t: number; id?: number; pointerType?: string },
): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: at.id ?? 1,
    pointerType: at.pointerType ?? "touch",
    clientX: at.x,
    clientY: at.y,
  });
  Object.defineProperty(event, "timeStamp", {
    value: CLOCK_EPOCH_MS + at.t,
  });
  return event;
}

function drag(
  target: Element,
  steps: {
    type: "down" | "move" | "up" | "cancel";
    x: number;
    y?: number;
    t: number;
    id?: number;
    pointerType?: string;
  }[],
): void {
  const nativeType = {
    down: "pointerdown",
    move: "pointermove",
    up: "pointerup",
    cancel: "pointercancel",
  } as const;
  for (const step of steps) {
    target.dispatchEvent(
      fingerEvent(nativeType[step.type], {
        x: step.x,
        y: step.y ?? 100,
        t: step.t,
        id: step.id,
        pointerType: step.pointerType,
      }),
    );
  }
}

function dragDecoration(panel: HTMLDialogElement): {
  dragging: boolean;
  offset: string;
} {
  return {
    dragging: "tfSwipeDragging" in panel.dataset,
    offset: panel.style.getPropertyValue("--_tf-swipe-drag"),
  };
}

describe("the swipe gesture (right sheet: rightward travel dismisses)", () => {
  it("ignores a press that never clears the slop", () => {
    const { panel, row, onOpenChange } = renderSheet();
    drag(row, [
      { type: "down", x: 200, t: 0 },
      { type: "move", x: 205, t: 16 },
    ]);
    expect(dragDecoration(panel).dragging).toBe(false);
    drag(row, [{ type: "up", x: 205, t: 32 }]);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("ignores a mouse: the gesture is touch-only", () => {
    const { panel, row, onOpenChange } = renderSheet();
    drag(row, [
      { type: "down", x: 100, t: 0, pointerType: "mouse" },
      { type: "move", x: 300, t: 16, pointerType: "mouse" },
      { type: "up", x: 300, t: 32, pointerType: "mouse" },
    ]);
    expect(dragDecoration(panel).dragging).toBe(false);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("yields to the list when the movement decides vertical at the slop", () => {
    const { panel, row, onOpenChange } = renderSheet();
    drag(row, [
      { type: "down", x: 200, t: 0 },
      { type: "move", x: 202, y: 120, t: 16 },
      // The gesture is abandoned: even a huge later horizontal move must
      // not resurrect it.
      { type: "move", x: 320, y: 120, t: 32 },
      { type: "up", x: 320, y: 120, t: 48 },
    ]);
    expect(dragDecoration(panel).dragging).toBe(false);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("commits past the slop: marks the panel and tracks the finger exactly", () => {
    const { panel, row } = renderSheet();
    drag(row, [
      { type: "down", x: 100, t: 0 },
      { type: "move", x: 100 + DRAG_SLOP_PX + 4, t: 16 },
    ]);
    expect(dragDecoration(panel).dragging).toBe(true);
    drag(row, [{ type: "move", x: 150, t: 32 }]);
    expect(dragDecoration(panel).offset).toBe("50px");
    // Travel away from the edge clamps at rest — the panel never
    // stretches past its resting place.
    drag(row, [{ type: "move", x: 60, t: 48 }]);
    expect(dragDecoration(panel).offset).toBe("0px");
  });

  it("dismisses a release past a quarter of the panel's width", () => {
    const { panel, row, onOpenChange } = renderSheet();
    drag(row, [
      { type: "down", x: 100, t: 0 },
      { type: "move", x: 140, t: 100 },
      { type: "move", x: 100 + DISMISS_TRAVEL_PX + 10, t: 200 },
      { type: "up", x: 100 + DISMISS_TRAVEL_PX + 10, t: 250 },
    ]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // The decoration always comes off on the way out: it is written on a
    // <dialog> that outlives the close.
    expect(dragDecoration(panel)).toEqual({ dragging: false, offset: "" });
  });

  it("springs back from a slow release short of the threshold", () => {
    const { panel, row, onOpenChange } = renderSheet();
    drag(row, [
      { type: "down", x: 100, t: 0 },
      { type: "move", x: 112, t: 100 },
      { type: "move", x: 140, t: 200 },
      { type: "up", x: 140, t: 250 },
    ]);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(dragDecoration(panel)).toEqual({ dragging: false, offset: "" });
  });

  it("dismisses a flick, however short its travel", () => {
    const { row, onOpenChange } = renderSheet();
    drag(row, [
      { type: "down", x: 100, t: 0 },
      { type: "move", x: 112, t: 10 },
      { type: "move", x: 130, t: 20 },
      { type: "up", x: 130, t: 40 },
    ]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not dismiss a flick the finger then parked (stale velocity)", () => {
    const { row, onOpenChange } = renderSheet();
    drag(row, [
      { type: "down", x: 100, t: 0 },
      { type: "move", x: 112, t: 10 },
      { type: "move", x: 130, t: 20 },
      { type: "up", x: 130, t: 20 + FLICK_GOES_STALE_AFTER_MS + 50 },
    ]);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("judges dismissal by where the panel ended, not how far the finger went", () => {
    const { row, onOpenChange } = renderSheet();
    // Committed far past the threshold, then pulled back to rest and
    // released slowly: the rescue must hold.
    drag(row, [
      { type: "down", x: 100, t: 0 },
      { type: "move", x: 220, t: 100 },
      { type: "move", x: 105, t: 300 },
      { type: "up", x: 105, t: 350 },
    ]);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("springs back on pointercancel: the browser taking the gesture is not a dismissal", () => {
    const { panel, row, onOpenChange } = renderSheet();
    drag(row, [
      { type: "down", x: 100, t: 0 },
      { type: "move", x: 250, t: 16 },
      { type: "cancel", x: 250, t: 32 },
    ]);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(dragDecoration(panel)).toEqual({ dragging: false, offset: "" });
  });

  it("lets a second finger neither retarget nor end the gesture", () => {
    const { panel, row, onOpenChange } = renderSheet();
    drag(row, [
      { type: "down", x: 100, t: 0, id: 1 },
      { type: "move", x: 150, t: 16, id: 1 },
      { type: "down", x: 300, t: 20, id: 2 },
      { type: "move", x: 310, t: 24, id: 2 },
      { type: "up", x: 310, t: 28, id: 2 },
    ]);
    // The first pointer's gesture is untouched by all of it.
    expect(dragDecoration(panel)).toEqual({ dragging: true, offset: "50px" });
    drag(row, [{ type: "up", x: 150, t: 400, id: 1 }]);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(dragDecoration(panel)).toEqual({ dragging: false, offset: "" });
  });

  it("swallows exactly one click after a committed swipe", () => {
    const { row, onRowClick } = renderSheet();
    drag(row, [
      { type: "down", x: 100, t: 0 },
      { type: "move", x: 150, t: 100 },
      { type: "up", x: 150, t: 150 },
    ]);
    // The touch sequence's compatibility click lands on the row the
    // finger merely swiped across; it must not open the conversation.
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onRowClick).not.toHaveBeenCalled();
    // A genuine later press-and-click goes through.
    drag(row, [
      { type: "down", x: 100, t: 200 },
      { type: "up", x: 100, t: 250 },
    ]);
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it("strips the decoration when the open state changes mid-gesture", () => {
    const { panel, row, rerender } = renderSheet();
    drag(row, [
      { type: "down", x: 100, t: 0 },
      { type: "move", x: 150, t: 16 },
    ]);
    expect(dragDecoration(panel).dragging).toBe(true);
    // Esc or the host closing the sheet under the thumb never reaches
    // endDrag; left behind, the marker and offset would render every
    // later open shoved aside with its slide switched off.
    rerender(false);
    expect(dragDecoration(panel)).toEqual({ dragging: false, offset: "" });
  });
});

describe("the swipe gesture (left sheet: leftward travel dismisses)", () => {
  it("dismisses toward its own edge and writes a negative offset", () => {
    const { panel, row, onOpenChange } = renderSheet("left");
    drag(row, [
      { type: "down", x: 200, t: 0 },
      { type: "move", x: 150, t: 100 },
    ]);
    expect(dragDecoration(panel)).toEqual({ dragging: true, offset: "-50px" });
    drag(row, [
      { type: "move", x: 200 - DISMISS_TRAVEL_PX - 10, t: 200 },
      { type: "up", x: 200 - DISMISS_TRAVEL_PX - 10, t: 250 },
    ]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("treats rightward travel as nothing", () => {
    const { panel, row, onOpenChange } = renderSheet("left");
    drag(row, [
      { type: "down", x: 100, t: 0 },
      { type: "move", x: 300, t: 100 },
      { type: "up", x: 300, t: 150 },
    ]);
    expect(dragDecoration(panel).dragging).toBe(false);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
