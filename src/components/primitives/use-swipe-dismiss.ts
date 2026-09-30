"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent,
  type PointerEvent,
} from "react";

// The swipe-to-dismiss machine, shared by every surface that leaves with
// a push: the edge sheet along x toward its own edge, the corner panel
// down along y. Axis and closing direction are the only gesture parameters;
// everything else here is a fixed bug that must not be copied twice.
// The scroll conflict is deliberately NOT a parameter: content that
// scrolls along the dismissal axis cannot be disambiguated by axis, so
// such a surface confines the drag to a grab region (`handleSelector`);
// content scrolling only across the axis lets the axis test arbitrate.

// Past this fraction of the panel's own extent along the axis, the
// release commits to a close instead of springing back: far enough that
// a lazy scroll never dismisses, near enough that a push needn't go all the way.
const DISMISS_TRAVEL_FRACTION = 0.25;
// Or past this speed, however far it got: a flick is an intent.
const DISMISS_VELOCITY_PX_PER_MS = 0.5;
// How stale a velocity reading may be and still count as a flick: speed is
// sampled only on pointermove, so without this a flick-then-hold-then-lift
// dismisses a panel the thumb deliberately parked.
const FLICK_GOES_STALE_AFTER_MS = 100;
// Slop before a press becomes a drag. Below it the gesture is undecided
// and the scrollable content underneath keeps the pointer.
const DRAG_SLOP_PX = 8;

interface DragState {
  pointerId: number;
  startMain: number;
  startCross: number;
  lastMain: number;
  lastT: number;
  velocity: number;
  committed: boolean;
}

/** Takes the drag decoration back off the panel and hands the pointer
 * back. Every way a gesture can end runs this: the marker and offset are
 * written on an element that outlives the close, and left behind they
 * render every later open shoved aside with its slide switched off. */
function _releasePanel(panel: HTMLElement, pointerId: number): void {
  delete panel.dataset.tfSwipeDragging;
  panel.style.removeProperty("--_tf-swipe-drag");
  if (panel.hasPointerCapture(pointerId)) {
    panel.releasePointerCapture(pointerId);
  }
}

export interface SwipeDismissOptions {
  /** The axis the dismissing travel moves along. */
  axis: "x" | "y";
  /** The sign along that axis that travels toward dismissal: +1 for
   * rightward/downward, -1 for leftward/upward. */
  direction: 1 | -1;
  /** The surface's open state. Every change of it ends whatever gesture
   * was in flight (see the effect below for why). */
  open: boolean;
  /** Gates the whole machine — the docked panel keeps the handlers
   * mounted (rules of hooks) but must never dismiss by touch. While
   * false, new gestures are declined, and flipping it mid-gesture
   * releases the drag with its decoration stripped. */
  enabled?: boolean;
  onDismiss: () => void;
  /** When set, a drag may only begin on a press inside a matching
   * descendant — the grab region of a surface whose content scrolls
   * along the dismissal axis. Absent, the whole panel drags. */
  handleSelector?: string;
}

/** The five handlers, all meant for the panel element itself so that
 * currentTarget is always the panel — no ref to forward, and pointer
 * capture retargets the rest of the gesture there. The stylesheet
 * animates what the machine writes: the live offset on
 * `--_tf-swipe-drag`, and `data-tf-swipe-dragging` while a finger owns it. */
export interface SwipeDismissHandlers {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  onClickCapture: (event: MouseEvent<HTMLElement>) => void;
}

export function useSwipeDismiss({
  axis,
  direction,
  open,
  enabled = true,
  onDismiss,
  handleSelector,
}: SwipeDismissOptions): SwipeDismissHandlers {
  const drag = useRef<DragState | null>(null);
  // Whether the last gesture ended as a swipe rather than a press — the
  // one thing the click handler below needs to know.
  const swipedRatherThanTapped = useRef(false);
  // The panel, remembered from whichever handler last saw it: the open
  // effect must strip a gesture's decoration with no event to read.
  const panelRef = useRef<HTMLElement | null>(null);

  // Every change of open state ends whatever gesture was in flight. The
  // flag clears on OPEN only: the exit is a CSS transition (allow-discrete
  // on display/overlay), so the panel stays hit-testable through the slide
  // out and a dismissing swipe's compatibility click still lands on the
  // row under the thumb — the flag must survive the close to swallow it,
  // and must be gone before a reopened, keyboard-driven panel's Enter
  // click. The drag releases on every change: a close landing mid-gesture
  // (Esc, the host) never reaches endDrag or cancelDrag.
  useEffect(() => {
    if (open) {
      swipedRatherThanTapped.current = false;
    }
    const inFlight = drag.current;
    if (inFlight !== null && panelRef.current !== null) {
      drag.current = null;
      _releasePanel(panelRef.current, inFlight.pointerId);
    }
  }, [open, enabled]);

  // Touch only, and only after the movement proves itself along the axis:
  // a thumb travelling across it keeps scrolling; a mouse has Esc.
  const beginDrag = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      // Whatever the last gesture was, it is over. Clearing here — before
      // every early return — bounds the swallow to a single click: the
      // flag never waits for the first tap after the surface reopens.
      swipedRatherThanTapped.current = false;
      // Recorded before every early return: the open effect needs the
      // element even for a gesture this handler declines to track.
      panelRef.current = event.currentTarget;
      if (!enabled || !_pressBeginsDrag(event, handleSelector)) {
        return;
      }
      // A second finger doesn't get to retarget a gesture already under way:
      // overwriting the state would strand the first pointer's cleanup and
      // leave the marker and offset on the panel for the rest of the session.
      if (drag.current !== null) {
        return;
      }
      drag.current = _beginDragStateOf(_sampleOf(event, axis));
    },
    [axis, enabled, handleSelector],
  );

  const trackDrag = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const state = drag.current;
      if (event.pointerId !== state?.pointerId) {
        return;
      }
      drag.current = _trackedDragOf(
        state,
        _sampleOf(event, axis),
        event.currentTarget,
        direction,
      );
    },
    [axis, direction],
  );

  const endDrag = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const state = drag.current;
      // Only the pointer that owns the gesture ends it — and it always takes
      // the decoration off on its way out, committed or not.
      if (event.pointerId !== state?.pointerId) {
        return;
      }
      drag.current = null;
      const panel = event.currentTarget;
      _releasePanel(panel, event.pointerId);
      if (!state.committed) {
        return;
      }
      // A committed swipe moved the panel under the thumb, so the press was
      // never a tap — yet the touch sequence is about to synthesize a click
      // where it started, and pointer capture doesn't retarget click on
      // WebKit: a swipe begun on a conversation row would open it.
      swipedRatherThanTapped.current = true;
      if (
        _dragDismisses(state, _sampleOf(event, axis), panel, axis, direction)
      ) {
        onDismiss();
      }
    },
    [axis, direction, onDismiss],
  );

  // The browser taking the gesture away is not a dismissal: a pinch
  // starting, or the UA claiming the pointer for its own pan, cancels with
  // the finger still down and no decision made — the panel goes back to
  // rest. Never shared with endDrag, which would close under the thumb.
  const cancelDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (event.pointerId !== state?.pointerId) {
      return;
    }
    drag.current = null;
    _releasePanel(event.currentTarget, event.pointerId);
  }, []);

  // Capture phase, so the content underneath never sees it. One click only:
  // the flag is set by a committed swipe and cleared by the next press, the
  // next open, or this handler — it can never outlive the gesture.
  const swallowTheClickAfterASwipe = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (!swipedRatherThanTapped.current) {
        return;
      }
      swipedRatherThanTapped.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    [],
  );

  return {
    onPointerDown: beginDrag,
    onPointerMove: trackDrag,
    onPointerUp: endDrag,
    onPointerCancel: cancelDrag,
    onClickCapture: swallowTheClickAfterASwipe,
  };
}

/** One pointer event read along the gesture's axes. */
interface PointerSample {
  pointerId: number;
  main: number;
  cross: number;
  timeStamp: number;
}

function _sampleOf(
  event: PointerEvent<HTMLElement>,
  axis: SwipeDismissOptions["axis"],
): PointerSample {
  return {
    pointerId: event.pointerId,
    main: axis === "x" ? event.clientX : event.clientY,
    cross: axis === "x" ? event.clientY : event.clientX,
    timeStamp: event.timeStamp,
  };
}

/** Whether a press is a candidate drag at all: touch, not on the panel
 *  element itself, and inside the grab region when one is declared. */
function _pressBeginsDrag(
  event: PointerEvent<HTMLElement>,
  handleSelector: string | undefined,
): boolean {
  // A press that lands on the panel element itself belongs to the
  // surface (the dialog's ::backdrop is the only place that happens),
  // not to us.
  if (event.pointerType !== "touch" || event.target === event.currentTarget) {
    return false;
  }
  // The grab-region gate: content that scrolls along the dismissal
  // axis makes a bare axis test a coin flip, so such surfaces confine
  // the gesture to a handle and presses elsewhere never dismiss.
  if (
    handleSelector !== undefined &&
    !(
      event.target instanceof Element &&
      event.target.closest(handleSelector) !== null
    )
  ) {
    return false;
  }
  return true;
}

function _beginDragStateOf(sample: PointerSample): DragState {
  return {
    pointerId: sample.pointerId,
    startMain: sample.main,
    startCross: sample.cross,
    lastMain: sample.main,
    lastT: sample.timeStamp,
    velocity: 0,
    committed: false,
  };
}

/** Advances the gesture by one move: an undecided press is either handed
 *  to the content (null) or committed to the panel; a committed drag
 *  records its speed and writes the live offset. */
function _trackedDragOf(
  state: DragState,
  sample: PointerSample,
  panel: HTMLElement,
  direction: SwipeDismissOptions["direction"],
): DragState | null {
  const dMain = sample.main - state.startMain;
  const dCross = sample.cross - state.startCross;
  // Travel toward dismissal counts; the other way is nothing, and the
  // panel never stretches past its resting place.
  const closing = direction * dMain;

  if (!state.committed) {
    if (
      Math.abs(dCross) >= DRAG_SLOP_PX &&
      Math.abs(dCross) >= Math.abs(dMain)
    ) {
      // Decided across the axis: the gesture is the content's, not ours.
      return null;
    }
    if (closing < DRAG_SLOP_PX) {
      return state;
    }
    state.committed = true;
    // The marker first, and the capture defensively: a pointer that
    // ended between two moves makes setPointerCapture throw, and losing
    // the capture only costs the tail of the gesture — losing the marker
    // would leave the transition running under the thumb.
    panel.dataset.tfSwipeDragging = "";
    try {
      panel.setPointerCapture(sample.pointerId);
    } catch {
      // Capture is an optimisation here; the handlers are on the
      // panel and the gesture stays inside it either way.
    }
  }

  const elapsed = sample.timeStamp - state.lastT;
  if (elapsed > 0) {
    state.velocity = (sample.main - state.lastMain) / elapsed;
    state.lastMain = sample.main;
    state.lastT = sample.timeStamp;
  }
  const offset = Math.max(0, closing);
  // A DOM style property, not the banned JSX style prop: the live
  // offset is a per-frame number and the stylesheet reads it through
  // the surface's transform variable.
  panel.style.setProperty(
    "--_tf-swipe-drag",
    `${String(direction * offset)}px`,
  );
  return state;
}

/** The release verdict for a committed drag: a flick still fresh at the
 *  lift, or travel past the panel's own quarter, dismisses. */
function _dragDismisses(
  state: DragState,
  sample: PointerSample,
  panel: HTMLElement,
  axis: SwipeDismissOptions["axis"],
  direction: SwipeDismissOptions["direction"],
): boolean {
  // Where the panel actually ended up, not how far the finger went: a
  // swipe pulled back past rest clamps to rest (the Math.max above) and
  // must spring back too — |dMain| would count the pull-back as travel
  // and dismiss the panel the finger just rescued.
  const travelled = Math.max(0, direction * (sample.main - state.startMain));
  // A speed nobody has measured recently is not a flick: velocity is
  // sampled on pointermove alone, so a finger that flicked, stopped and
  // lifted still carries the flick's number. Parking means parking.
  const stillMoving =
    sample.timeStamp - state.lastT <= FLICK_GOES_STALE_AFTER_MS;
  const flicked =
    stillMoving && direction * state.velocity > DISMISS_VELOCITY_PX_PER_MS;
  // The panel's own extent, not the viewport: capped below nominal on
  // the narrowest phones, a quarter of nominal would be a third on screen.
  const extent = axis === "x" ? panel.offsetWidth : panel.offsetHeight;
  return flicked || travelled > extent * DISMISS_TRAVEL_FRACTION;
}
