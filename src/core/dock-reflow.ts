// The sidebar's host reflow: the docked panel is a top-layer popover that
// can never join the host's flow, so the page is pushed out from under it
// — a margin-right on documentElement equal to the panel's width, with an
// inline transition on the panel's own clock so push and slide-in read as
// one motion. The host's inline values are saved on the first push of a
// cycle and restored on release, asymmetrically: the margin goes back at
// once (that IS the un-push) while our transition outlives the slide back,
// paced by a timer, not transitionend (the host may transition nothing).
// Known Intercom-class limitations, documented rather than fixed: 100vw
// host elements overflow by the pushed width; right-anchored fixed UI stays.

// The floating panel's motion clock (styles.css), restated here because
// an inline style can't read the stylesheet's literal.
const DOCK_REFLOW_TRANSITION =
  "margin-right 220ms cubic-bezier(0.22, 1, 0.36, 1)";
// Matches the stylesheet's reduced-motion collapse: 1ms, never 0 — a
// zero-duration transition fires no events and some engines skip it.
const DOCK_REFLOW_REDUCED_TRANSITION = "margin-right 1ms";
// Outlasts the 220ms slide-back before the host's transition is
// restored, with room for a busy main thread to start the slide late.
const REFLOW_SETTLE_FALLBACK_MS = 400;

export interface DockReflowController {
  /** Pushes the page by the given width. Idempotent: a repeat push re-writes
   * the width without re-saving — the saved values must stay the HOST's.
   * Cancels a pending settle, so a re-dock inside the un-dock's settle window
   * keeps our transition. Reduced motion is the caller's per-call verdict:
   * the controller outlives the panel, and a mid-session flip must govern. */
  push(widthPx: number, reduceMotion: boolean): void;
  /** The animated un-push: restores the saved margin now, keeps our
   * transition inline until the slide lands, then restores the saved
   * transition. No-op when not pushed. */
  release(): void;
}

interface SavedRootStyle {
  marginRight: string;
  transition: string;
}

// One controller per root, for the root's lifetime. The panel that
// drives it unmounts instantly on minimize, so the controller must
// outlive it to animate the un-push — and a remount inside the settle
// window must find the SAME bookkeeping, or the new instance would save
// our own still-inline transition as host state.
const _controllers = new WeakMap<HTMLElement, DockReflowController>();

export function dockReflowFor(root: HTMLElement): DockReflowController {
  const existing = _controllers.get(root);
  if (existing !== undefined) {
    return existing;
  }
  const controller = _createDockReflow(root);
  _controllers.set(root, controller);
  return controller;
}

function _createDockReflow(root: HTMLElement): DockReflowController {
  // `saved` lives from the first push until a release's settle finishes —
  // NOT until release: a re-push inside the settle window (the park→
  // re-show path) would otherwise find it empty and save our own
  // still-inline transition as host state. `pushed` alone says whether a
  // release has work to do.
  let saved: SavedRootStyle | null = null;
  let pushed = false;
  let settleTimer: number | null = null;

  const cancelPendingSettle = () => {
    if (settleTimer !== null) {
      root.ownerDocument.defaultView?.clearTimeout(settleTimer);
      settleTimer = null;
    }
  };

  const restoreProperty = (name: string, value: string) => {
    if (value === "") {
      root.style.removeProperty(name);
    } else {
      root.style.setProperty(name, value);
    }
  };

  const restoreTransitionAndForget = () => {
    if (saved !== null) {
      restoreProperty("transition", saved.transition);
      saved = null;
    }
  };

  return {
    push(widthPx: number, reduceMotion: boolean): void {
      cancelPendingSettle();
      saved ??= {
        marginRight: root.style.marginRight,
        transition: root.style.transition,
      };
      pushed = true;
      root.style.transition = reduceMotion
        ? DOCK_REFLOW_REDUCED_TRANSITION
        : DOCK_REFLOW_TRANSITION;
      root.style.marginRight = `${String(widthPx)}px`;
    },
    release(): void {
      if (!pushed || saved === null) {
        return;
      }
      pushed = false;
      restoreProperty("margin-right", saved.marginRight);
      const view = root.ownerDocument.defaultView;
      if (view === null) {
        restoreTransitionAndForget();
        return;
      }
      settleTimer = view.setTimeout(() => {
        settleTimer = null;
        restoreTransitionAndForget();
      }, REFLOW_SETTLE_FALLBACK_MS);
    },
  };
}
