// @vitest-environment jsdom

// The shared swipe machine's two paths the sheet pin cannot reach: the
// vertical axis and the grab-region gate — the exact configuration the
// floating panel runs. Driven through a bare harness div rather than
// TfFloatingPanel itself because jsdom has no popover; the machine never
// knows the difference (its world is pointer events on whatever element
// carries the handlers).

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { useSwipeDismiss } from "../src/components/primitives/use-swipe-dismiss";

// The panel-shaped configuration under test, restated as this file's own
// constants — the pin must notice a retune, not silently follow one.
const PANEL_HEIGHT_PX = 400;
const DISMISS_TRAVEL_PX = PANEL_HEIGHT_PX * 0.25;
const DRAG_SLOP_PX = 8;
const FLICK_GOES_STALE_AFTER_MS = 100;
// Truthy epoch: React swaps a falsy timeStamp for Date.now(), which
// would silently poison the velocity math.
const CLOCK_EPOCH_MS = 1_000_000;

declare global {
  // React's documented act() opt-in global; declare-global var is the
  // only way to type an ambient global.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no pointer capture; the machine treats capture as an
  // optimisation, but hasPointerCapture is read unconditionally on
  // release, so the trio must exist.
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

function VerticalPanel({
  onDismiss,
  enabled = true,
}: {
  onDismiss: () => void;
  enabled?: boolean;
}) {
  const swipe = useSwipeDismiss({
    axis: "y",
    direction: 1,
    open: true,
    enabled,
    onDismiss,
    handleSelector: "[data-tf-swipe-handle]",
  });
  return (
    <div
      role="dialog"
      aria-label="Vertical harness"
      data-testid="panel"
      onPointerDown={swipe.onPointerDown}
      onPointerMove={swipe.onPointerMove}
      onPointerUp={swipe.onPointerUp}
      onPointerCancel={swipe.onPointerCancel}
      onClickCapture={swipe.onClickCapture}
    >
      <div data-tf-swipe-handle="" data-testid="handle">
        grab
      </div>
      <div data-testid="body">content</div>
    </div>
  );
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

function renderPanel(options?: { enabled?: boolean }): {
  panel: HTMLElement;
  handle: HTMLElement;
  body: HTMLElement;
  onDismiss: ReturnType<typeof vi.fn>;
  setEnabled: (enabled: boolean) => void;
} {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const onDismiss = vi.fn();
  const setEnabled = (enabled: boolean) => {
    act(() => {
      root?.render(<VerticalPanel onDismiss={onDismiss} enabled={enabled} />);
    });
  };
  setEnabled(options?.enabled ?? true);
  const panel = container.querySelector<HTMLElement>("[data-testid='panel']");
  const handle = container.querySelector<HTMLElement>("[data-testid='handle']");
  const body = container.querySelector<HTMLElement>("[data-testid='body']");
  if (panel === null || handle === null || body === null) {
    throw new Error("The harness did not render its panel, handle and body.");
  }
  // jsdom has no layout; the vertical dismiss threshold reads the
  // panel's own rendered height, so the pin supplies one.
  Object.defineProperty(panel, "offsetHeight", { value: PANEL_HEIGHT_PX });
  return { panel, handle, body, onDismiss, setEnabled };
}

function drag(
  target: Element,
  steps: {
    type: "down" | "move" | "up" | "cancel";
    y: number;
    x?: number;
    t: number;
  }[],
): void {
  const nativeType = {
    down: "pointerdown",
    move: "pointermove",
    up: "pointerup",
    cancel: "pointercancel",
  } as const;
  for (const step of steps) {
    const event = new PointerEvent(nativeType[step.type], {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "touch",
      clientX: step.x ?? 100,
      clientY: step.y,
    });
    Object.defineProperty(event, "timeStamp", {
      value: CLOCK_EPOCH_MS + step.t,
    });
    target.dispatchEvent(event);
  }
}

function dragDecoration(panel: HTMLElement): {
  dragging: boolean;
  offset: string;
} {
  return {
    dragging: "tfSwipeDragging" in panel.dataset,
    offset: panel.style.getPropertyValue("--_tf-swipe-drag"),
  };
}

describe("the vertical, handle-gated machine (the floating panel's configuration)", () => {
  it("never begins a gesture from the body: that region belongs to its scrollers", () => {
    const { panel, body, onDismiss } = renderPanel();
    drag(body, [
      { type: "down", y: 100, t: 0 },
      { type: "move", y: 300, t: 100 },
      { type: "up", y: 300, t: 150 },
    ]);
    expect(dragDecoration(panel).dragging).toBe(false);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("commits a downward handle drag, tracks the finger, and clamps upward travel at rest", () => {
    const { panel, handle } = renderPanel();
    drag(handle, [
      { type: "down", y: 100, t: 0 },
      { type: "move", y: 100 + DRAG_SLOP_PX + 4, t: 16 },
    ]);
    expect(dragDecoration(panel).dragging).toBe(true);
    drag(handle, [{ type: "move", y: 150, t: 32 }]);
    expect(dragDecoration(panel).offset).toBe("50px");
    drag(handle, [{ type: "move", y: 60, t: 48 }]);
    expect(dragDecoration(panel).offset).toBe("0px");
  });

  it("dismisses a release past a quarter of the panel's HEIGHT (not width)", () => {
    const { panel, handle, onDismiss } = renderPanel();
    // Width is deliberately absent from the harness: a machine reading
    // offsetWidth would see 0 and dismiss any committed drag, so the
    // spring-back case below is what proves the axis picks the extent.
    drag(handle, [
      { type: "down", y: 100, t: 0 },
      { type: "move", y: 160, t: 100 },
      { type: "move", y: 100 + DISMISS_TRAVEL_PX + 10, t: 200 },
      { type: "up", y: 100 + DISMISS_TRAVEL_PX + 10, t: 250 },
    ]);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(dragDecoration(panel)).toEqual({ dragging: false, offset: "" });
  });

  it("springs back from a slow release short of the threshold", () => {
    const { panel, handle, onDismiss } = renderPanel();
    drag(handle, [
      { type: "down", y: 100, t: 0 },
      { type: "move", y: 130, t: 100 },
      { type: "move", y: 160, t: 200 },
      { type: "up", y: 160, t: 250 },
    ]);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(dragDecoration(panel)).toEqual({ dragging: false, offset: "" });
  });

  it("dismisses a downward flick, however short its travel", () => {
    const { handle, onDismiss } = renderPanel();
    drag(handle, [
      { type: "down", y: 100, t: 0 },
      { type: "move", y: 112, t: 10 },
      { type: "move", y: 130, t: 20 },
      { type: "up", y: 130, t: 40 },
    ]);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not dismiss a flick the finger then parked (stale velocity)", () => {
    const { handle, onDismiss } = renderPanel();
    drag(handle, [
      { type: "down", y: 100, t: 0 },
      { type: "move", y: 112, t: 10 },
      { type: "move", y: 130, t: 20 },
      { type: "up", y: 130, t: 20 + FLICK_GOES_STALE_AFTER_MS + 50 },
    ]);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("yields to a horizontal move at the slop: the cross axis is not ours", () => {
    const { panel, handle, onDismiss } = renderPanel();
    drag(handle, [
      { type: "down", y: 100, t: 0 },
      { type: "move", y: 102, x: 120, t: 16 },
      { type: "move", y: 300, x: 120, t: 32 },
      { type: "up", y: 300, x: 120, t: 48 },
    ]);
    expect(dragDecoration(panel).dragging).toBe(false);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("springs back on pointercancel without dismissing", () => {
    const { panel, handle, onDismiss } = renderPanel();
    drag(handle, [
      { type: "down", y: 100, t: 0 },
      { type: "move", y: 250, t: 16 },
      { type: "cancel", y: 250, t: 32 },
    ]);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(dragDecoration(panel)).toEqual({ dragging: false, offset: "" });
  });

  it("declines the whole gesture while disabled (the docked panel's state)", () => {
    const { panel, handle, onDismiss } = renderPanel({ enabled: false });
    drag(handle, [
      { type: "down", y: 100, t: 0 },
      { type: "move", y: 100 + DISMISS_TRAVEL_PX + 10, t: 100 },
      { type: "up", y: 100 + DISMISS_TRAVEL_PX + 10, t: 150 },
    ]);
    expect(dragDecoration(panel)).toEqual({ dragging: false, offset: "" });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("disabling mid-drag releases the gesture and strips the decoration", () => {
    const { panel, handle, onDismiss, setEnabled } = renderPanel();
    drag(handle, [
      { type: "down", y: 100, t: 0 },
      { type: "move", y: 150, t: 16 },
    ]);
    expect(dragDecoration(panel).dragging).toBe(true);

    // The mode flips to sidebar under the thumb: the decoration must not
    // outlive the flip — left behind, it renders every later open shoved
    // aside with its slide switched off.
    setEnabled(false);

    expect(dragDecoration(panel)).toEqual({ dragging: false, offset: "" });
    drag(handle, [
      { type: "move", y: 100 + DISMISS_TRAVEL_PX + 10, t: 100 },
      { type: "up", y: 100 + DISMISS_TRAVEL_PX + 10, t: 150 },
    ]);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
