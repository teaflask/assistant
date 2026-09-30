"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type ToggleEvent,
} from "react";

import { useLatestRef } from "../use-latest-ref.js";
import { focusAutofocusTarget } from "./autofocus.js";
import { cx } from "./cx.js";
import { useDockReflow } from "./use-dock-reflow.js";
import { useSwipeDismiss } from "./use-swipe-dismiss.js";

// The primitives-layer NON-MODAL floating surface: a corner-anchored
// panel on popover="manual" — the one primitive that buys top-layer
// paint WITHOUT modality: the page stays interactive (no inert, no
// trap, no focus steal, no light dismiss), the panel paints above every
// host stacking context with zero z-index, in place in React's tree
// (host `--tf-*`/`data-tf-theme` inherit), inside a shadow root too.
// Rejected: position:fixed + z-index (a transformed host ancestor
// re-parents it) and non-modal dialog.show() (steals focus). Without
// popover support the panel never opens. Of the modal contract: inert
// page and focus trap dropped (usable beside the host IS the feature);
// Esc re-implemented panel-scoped; focus-on-open opt-in via
// data-tf-autofocus and only for the visitor's own open (focusOnOpen);
// focus return only while focus is still inside; no
// backdrop close, no scroll lock; top-layer order is promotion order.
// A hide the panel did not initiate (a modal's hide-all-popovers, a
// host hidePopover()) is a YIELD, not a close: `open` stays true and
// the panel returns when the way clears, without touching focus.
// Deferred: software-keyboard handling and scroll-aware swipe arbitration.
// The decision in full, alternatives included: docs/floating-panel.md.

type FloatingPanelCorner = "bottom-right" | "bottom-left";
type FloatingPanelDock = "floating" | "sidebar";

interface TfFloatingPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The viewport corner the panel anchors to. The companion sits in the
   * same corner; its clearance is the consumer's className. */
  corner?: FloatingPanelCorner;
  /** Where the panel lives: the floating corner card (default), or the
   * full-height sidebar docked flush to the right edge with the host
   * page pushed aside. The sidebar ignores `corner` — right-edge only. */
  dock?: FloatingPanelDock;
  "aria-label": string;
  /** The open is the visitor's own gesture, so the content's
   *  data-tf-autofocus mark may take the caret; read as of the open. */
  focusOnOpen: boolean;
  className?: string;
  children: ReactNode;
}

/** Where focus actually is, from the panel's own tree: getRootNode(),
 * never the document, which retargets activeElement to the shadow HOST
 * inside the script-tag distribution — the contains() guard would always
 * fail and the captured opener would be the host. */
function _activeElementNear(panel: HTMLElement): Element | null {
  const root = panel.getRootNode();
  return root instanceof Document || root instanceof ShadowRoot
    ? root.activeElement
    : null;
}

/** Restores focus to the remembered opener, but only when the close is
 * taking focus away from the user — i.e. focus still lives inside the
 * panel. A user who opened the panel and moved on keeps their place. */
function _returnFocusToOpener(
  panel: HTMLElement,
  opener: Element | null,
): void {
  if (!panel.contains(_activeElementNear(panel))) {
    return;
  }
  if (opener instanceof HTMLElement && opener.isConnected) {
    opener.focus();
  }
}

export function TfFloatingPanel({
  open,
  onOpenChange,
  corner = "bottom-right",
  dock = "floating",
  focusOnOpen,
  className,
  children,
  ...props
}: TfFloatingPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const parkOnForcedHide = usePopoverPresence(panelRef, open, focusOnOpen);

  // Esc closes the surface it is pressed in, and nothing else: scoped to
  // keydowns that reach the panel, stopped so one keystroke does one thing.
  const closeFromEscape = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }
      event.stopPropagation();
      onOpenChange(false);
    },
    [onOpenChange],
  );

  const dismiss = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);
  // Downward swipe on the grab region dismisses — confined to the handle
  // because the content scrolls the same axis. Docked, the gesture is
  // off: a full-height pane reads as page furniture, and furniture that
  // flies away under a drag reads as breakage.
  const swipe = useSwipeDismiss({
    axis: "y",
    direction: 1,
    open,
    enabled: dock === "floating",
    onDismiss: dismiss,
    handleSelector: "[data-tf-swipe-handle]",
  });

  useDockReflow(panelRef, dock);

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the keydown is the panel's own Esc-to-close; the pointer handlers are the handle's swipe. Keyboard users close via Esc.
    <div
      ref={panelRef}
      popover="manual"
      role="dialog"
      data-tf-assistant=""
      data-tf-floating-panel={corner}
      data-tf-panel-dock={dock}
      // Glass is earned by floating over the host's pixels; the docked
      // pane pushes the page aside and stays opaque Graphite.
      data-tf-glass={dock === "floating" ? "" : undefined}
      onToggle={parkOnForcedHide}
      onKeyDown={closeFromEscape}
      onPointerDown={swipe.onPointerDown}
      onPointerMove={swipe.onPointerMove}
      onPointerUp={swipe.onPointerUp}
      onPointerCancel={swipe.onPointerCancel}
      onClickCapture={swipe.onClickCapture}
      className={cx(
        // `hidden` restates the UA's closed-popover display and is the
        // whole display without popover support; the important marker is
        // ordering insurance between tf:hidden and tf:open:flex.
        "tf:m-0 tf:hidden tf:p-0 tf:open:flex!",
        "tf:flex-col tf:overflow-hidden tf:text-tf-foreground",
        dock === "sidebar"
          ? // Flush full-height, edge to edge, never an inset column: the
            // Portal Lift rule inverted — no shadow, square corners, a
            // hairline left border (in styles.css, not a border-l utility:
            // border utilities ride an @property registration Chromium honours
            // only in document sheets; this must paint everywhere). A fixed 26rem
            // on ultrawide too — a pane, not a proportion; max-w guards an
            // inflated host rem. left-auto is load-bearing: the UA popover
            // style is inset:0, and left+right 0 resolves to the LEFT edge in LTR.
            "tf:inset-y-0 tf:right-0 tf:left-auto tf:h-dvh tf:w-104 tf:max-w-[calc(100vw-2rem)] tf:rounded-none tf:bg-tf-background tf:shadow-none"
          : cx(
              // A floating corner card, never flush: the viewport-edge margins
              // signal "the page is still there". Compose-window proportions
              // (~44vw): the 24rem floor is the phone card, 46rem caps the
              // ultrawide so the panel stays a card, never a pane.
              "tf:inset-auto tf:bottom-4 tf:w-[clamp(24rem,44vw,46rem)] tf:max-w-[calc(100vw-2rem)]",
              // Fixed height under viewport-relative caps so the panel never
              // jumps between empty and busy: ~68dvh is the compose-window
              // register, 52rem stops tall monitors growing a tower, and the
              // 6rem headroom term keeps the software-keyboard behavior.
              "tf:h-[min(68dvh,52rem,calc(100dvh-6rem))]",
              // The floating-surface chrome comes from the liquid-glass
              // material (data-tf-glass, styles.css). The 24px corner is the
              // panel step of the radius ladder (the composer slab wears the
              // same literal), not derived from --tf-radius so a host's
              // control-radius theme can't unround the surface.
              "tf:rounded-3xl tf:border",
              corner === "bottom-left" ? "tf:left-4" : "tf:right-4",
            ),
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * The popover discipline: `open` shows and hides the top-layer panel
 * (focus captured on a gesture's open, returned on close), a hide the
 * panel did not initiate parks it, and the way-is-clear watcher restores
 * it. Returns the toggle handler that detects the forced hide.
 */
function usePopoverPresence(
  panelRef: RefObject<HTMLDivElement | null>,
  open: boolean,
  focusOnOpen: boolean,
): (event: ToggleEvent<HTMLDivElement>) => void {
  const openerRef = useRef<Element | null>(null);
  const focusOnOpenRef = useLatestRef(focusOnOpen);
  // Parked by a modal (or a meddling host script): hidden while `open`
  // still says true, waiting for the way to clear. A ref, not state:
  // nothing rendered depends on it and the watcher reads it live.
  const yieldedRef = useRef(false);

  // The `open` prop stays authoritative: external hides are parked or
  // reported, never applied locally, and this effect is the only writer.
  // Inert is written here for the whole not-open stretch, not rendered:
  // inert={!open} would commit before this effect and blur the focused
  // descendant, so the focus return's "still inside" check could never
  // pass. On open it lifts BEFORE showPopover(); on close it lands after.
  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) {
      return;
    }
    if (open) {
      panel.removeAttribute("inert");
    }
    if (typeof panel.showPopover === "function") {
      const showing = panel.matches(":popover-open");
      if (open && !showing && !yieldedRef.current) {
        openerRef.current = _activeElementNear(panel);
        panel.showPopover();
        if (focusOnOpenRef.current) {
          focusAutofocusTarget(panel, () => panel.matches(":popover-open"));
        }
      } else if (!open) {
        if (showing) {
          // Before hidePopover(), while "focus is still inside" is still
          // observable.
          _returnFocusToOpener(panel, openerRef.current);
          panel.hidePopover();
        }
        yieldedRef.current = false;
      }
    }
    if (!open) {
      panel.setAttribute("inert", "");
    }
  }, [panelRef, open, focusOnOpenRef]);

  // The yield detector. Our own hide only ever runs with `open` already
  // false, so a closed-toggle arriving while `open` is true was forced
  // from outside — a modal's hide-all-popovers, or a host script.
  const parkOnForcedHide = useCallback(
    (event: ToggleEvent<HTMLDivElement>) => {
      if (event.newState === "closed" && open) {
        yieldedRef.current = true;
      }
    },
    [open],
  );

  // The way-is-clear watcher, listening for the whole open stretch and
  // acting only while parked. `close` doesn't bubble, so the document
  // hears it in the capture phase; fullscreen exits hide popovers through
  // the same spec step. Restoration never touches focus.
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || panel === null || typeof panel.showPopover !== "function") {
      return;
    }
    const doc = panel.ownerDocument;
    const restoreWhenClear = () => {
      // fullscreenchange fires on the way IN too, and entering fullscreen
      // is itself a popover-hiding step — without the fullscreenElement
      // check this would pop the panel over the fullscreen element.
      if (
        !yieldedRef.current ||
        doc.querySelector("dialog:modal") !== null ||
        doc.fullscreenElement !== null
      ) {
        return;
      }
      if (!panel.matches(":popover-open")) {
        panel.showPopover();
      }
      yieldedRef.current = false;
    };
    doc.addEventListener("close", restoreWhenClear, true);
    doc.addEventListener("fullscreenchange", restoreWhenClear);
    return () => {
      doc.removeEventListener("close", restoreWhenClear, true);
      doc.removeEventListener("fullscreenchange", restoreWhenClear);
    };
  }, [panelRef, open]);

  return parkOnForcedHide;
}
