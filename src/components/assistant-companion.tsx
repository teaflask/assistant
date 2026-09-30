"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
  type ToggleEvent,
} from "react";

import {
  closeCompanionDrawer,
  companionDrawerOpen,
  openCompanionDrawer,
} from "../core/companion-drawer-flag.js";
import { companionChromeOf } from "../core/companion-presence.js";
import {
  readPanelMode,
  subscribePanelMode,
  writePanelMode,
  type PanelDock,
} from "../persistence/panel-mode.js";
import { useAssistantAppearance } from "./appearance-context.js";
import { CompanionDrawer } from "./companion-drawer.js";
import { CompanionMark } from "./companion-mark.js";
import { TfButton } from "./primitives/button.js";
import { useAssistantSession } from "./teaflask-assistant-provider.js";
import { SurfaceBoundary } from "./surface-boundary.js";
import { useAssistantSurfacePresence } from "./use-assistant-surface-presence.js";
import { usePerchClearance } from "./use-perch-clearance.js";
import { useCell } from "./use-store-cell.js";

// The companion presence surface: the bare mark that lives on every
// route, expands into the corner chat drawer, follows a tool navigation
// with the drawer open, and stands down wherever a full chat surface is
// mounted. One mark at one size, no speech, no hide control: the mark
// is always where the host expects it. When yielded it renders nothing
// but STAYS MOUNTED, so it reappears the instant the full surface
// unmounts.

export interface AssistantCompanionProps {
  /** The viewport corner the companion (and its drawer) anchor to. */
  corner?: "bottom-right" | "bottom-left";
  /** Accessible name of the open-assistant control. */
  "aria-label"?: string;
}

// How long a dismissed drawer stays mounted so the stylesheet's 220ms
// exit run gets to paint (unmounting kills it before hidePopover() can
// start it), with room for a busy frame. A timer, not transitionend:
// the widget holds no ref into the panel two components down, and a
// listener that never fires would hold the mount forever (dock-reflow's
// law). Erring long is invisible — once the run lands the closed
// popover is display:none. Reduced motion deliberately takes the same
// path: the stylesheet already collapses the run to a 1ms cut, and the
// rest of the hold keeps only a hidden node mounted.
const DRAWER_EXIT_HOLD_MS = 400;

/** The export is the boundary: a throw anywhere in this surface — its
 *  own hooks included — never unmounts the host's tree.
 *  degrade="silent": this is an overlay mount sitting as a sibling at
 *  the end of the host's tree, so the in-flow fallback card would land
 *  as a stray block on the host page — absence is the honest degraded
 *  state, and onError + the console report identically. Unkeyed
 *  backstop: it clears when the host remounts the surface. */
export function AssistantCompanion(props: AssistantCompanionProps) {
  return (
    <SurfaceBoundary surface="companion" degrade="silent">
      <AssistantCompanionInner {...props} />
    </SurfaceBoundary>
  );
}

function AssistantCompanionInner({
  corner = "bottom-right",
  "aria-label": ariaLabel = "Open assistant",
}: AssistantCompanionProps): ReactNode {
  const { publishableKey } = useAssistantSession();
  const surfaces = useAssistantSurfacePresence();
  const { rootProps } = useAssistantAppearance();

  const drawer = useCompanionDrawer();
  const panelMode = usePanelMode(publishableKey);
  const sidebarFits = useViewportFitsSidebar();
  // Below the floor a 26rem sidebar is nonsense — the floating card is
  // already full-width there. The preference survives untouched; only
  // the rendering is forced, so a tablet rotated back gets its sidebar
  // back without re-choosing.
  const dock: PanelDock =
    sidebarFits && panelMode === "sidebar" ? "sidebar" : "floating";
  const changeDock = useCallback(
    (next: PanelDock) => {
      writePanelMode(publishableKey, next);
    },
    [publishableKey],
  );
  const chrome = companionChromeOf({ surfaces, expanded: drawer.expanded });

  const dockRef = useRef<HTMLDivElement>(null);
  const dockVisible = chrome === "companion";
  const parkOnForcedHide = useDockPresence(dockRef, dockVisible);
  usePerchClearance(dockRef, dockVisible);

  return (
    <>
      <div
        ref={dockRef}
        popover="manual"
        data-tf-assistant=""
        data-tf-companion-dock={corner}
        onToggle={parkOnForcedHide}
        {...rootProps}
      >
        {chrome === "companion" ? (
          <MinimizedCompanion ariaLabel={ariaLabel} onOpen={drawer.open} />
        ) : null}
      </div>
      {chrome === "drawer" || drawer.expanded || drawer.exiting ? (
        <CompanionDrawer
          open={chrome === "drawer"}
          exiting={drawer.exiting}
          focusOnOpen={drawer.openedByGesture}
          onOpenChange={drawer.changeOpen}
          corner={corner}
          dock={dock}
          onDockChange={sidebarFits ? changeDock : null}
        />
      ) : null}
    </>
  );
}

interface CompanionDrawerController {
  expanded: boolean;
  /** The drawer is dismissed but held mounted through the exit run. */
  exiting: boolean;
  /** This instance opened the drawer on the visitor's own click, so the
   *  caret may move into the composer. False for an open written from
   *  outside the tree (a tool navigation) and after a remount. */
  openedByGesture: boolean;
  open: () => void;
  changeOpen: (next: boolean) => void;
}

/** The drawer's open flag — page-level state (core/companion-drawer-flag),
 *  so a tool navigation and a full surface taking the floor write it from
 *  outside this tree and a host remount lands on the same flag — plus the
 *  exit hold, the one clock that is this instance's own. A transient
 *  yield (the palette) never touches the flag, so the drawer returns when
 *  the palette closes. */
function useCompanionDrawer(): CompanionDrawerController {
  const expanded = useCell(companionDrawerOpen);
  const [drawerExiting, setDrawerExiting] = useState(false);
  const [openedByGesture, setOpenedByGesture] = useState(false);

  // A reopen mid-exit cancels the hold in the same paint (render-time
  // adjustment), so a minimize that follows starts a full-length hold —
  // a stale timer from the first exit would truncate the second.
  if (drawerExiting && expanded) {
    setDrawerExiting(false);
  }

  const openDrawer = useCallback(() => {
    setOpenedByGesture(true);
    openCompanionDrawer();
  }, []);
  // Every deliberate dismissal — the dash, Esc, a swipe — rings this
  // with false (a yield never does), and the exit hold keeps the panel
  // mounted through the very commit that flips `open`, so hidePopover()
  // gets to run and the stylesheet's exit paints instead of a one-frame
  // cut. The timer below lets go once the run has landed.
  const changeDrawerOpen = useCallback((next: boolean) => {
    setOpenedByGesture(next);
    if (next) {
      openCompanionDrawer();
      return;
    }
    setDrawerExiting(true);
    closeCompanionDrawer();
  }, []);
  useEffect(() => {
    if (!drawerExiting) {
      return;
    }
    const timer = window.setTimeout(() => {
      setDrawerExiting(false);
    }, DRAWER_EXIT_HOLD_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [drawerExiting]);

  return {
    expanded,
    exiting: drawerExiting,
    openedByGesture,
    open: openDrawer,
    changeOpen: changeDrawerOpen,
  };
}

function MinimizedCompanion({
  ariaLabel,
  onOpen,
}: {
  ariaLabel: string;
  onOpen: () => void;
}) {
  return (
    <div data-tf-companion-perch="">
      {/* The mark is the door: it floats bare — no plate — and the
          button is its invisible hit box. Nothing else lives on the
          perch: one mark, one size, no hide control. */}
      <TfButton
        variant="bare"
        data-tf-companion-body=""
        aria-label={ariaLabel}
        onClick={onOpen}
      >
        <CompanionMark />
      </TfButton>
    </div>
  );
}

/** The durable per-key dock preference, live across every consumer in
 *  this tab. The server snapshot is floating: registration-free SSR, and
 *  hydration corrects itself without a mismatch. */
function usePanelMode(publishableKey: string): PanelDock {
  return useSyncExternalStore(
    subscribePanelMode,
    () => readPanelMode(publishableKey),
    () => "floating",
  );
}

// The sidebar's viewport floor. The margin push is invisible to the
// host's own media queries — a pushed host still *believes* the full
// viewport width — so below this floor the 26rem pane leaves hosts in
// a layout their breakpoints never planned for (the dashboard at 800px
// kept its expanded nav over a ~90px content sliver). 1024 leaves every
// host at least ~608px, and the phone/tablet cases the ticket named are
// already covered by the full-width floating card.
const SIDEBAR_MIN_VIEWPORT_QUERY = "(min-width: 1024px)";

function _subscribeSidebarViewport(onChange: () => void): () => void {
  const media = window.matchMedia(SIDEBAR_MIN_VIEWPORT_QUERY);
  media.addEventListener("change", onChange);
  return () => {
    media.removeEventListener("change", onChange);
  };
}

/** Whether the viewport clears the sidebar's floor, live across resizes
 *  and rotations. The server snapshot says no — SSR renders the floating
 *  default and hydration corrects without a mismatch. */
function useViewportFitsSidebar(): boolean {
  return useSyncExternalStore(
    _subscribeSidebarViewport,
    () => window.matchMedia(SIDEBAR_MIN_VIEWPORT_QUERY).matches,
    () => false,
  );
}

/**
 * The dock's edition of the floating panel's popover discipline: the
 * `visible` argument stays authoritative (machine-driven hides are ours;
 * this effect is the only writer), a forced external hide — a host
 * modal's hide-all-popovers, a meddling hidePopover() — PARKS the dock
 * rather than closing it, and the way-is-clear watcher restores it
 * without touching focus. In a browser without popover support the dock
 * simply never shows (the stylesheet keeps it hidden at rest).
 */
function useDockPresence(
  dockRef: RefObject<HTMLDivElement | null>,
  visible: boolean,
): (event: ToggleEvent<HTMLDivElement>) => void {
  const parkedRef = useRef(false);

  useEffect(() => {
    const dock = dockRef.current;
    if (dock === null || typeof dock.showPopover !== "function") {
      return;
    }
    const doc = dock.ownerDocument;
    const showing = dock.matches(":popover-open");
    if (visible && !showing && !parkedRef.current) {
      // The same way-must-be-clear check as the restore path: a machine
      // flip while a host modal is up must park, not punch the dock into
      // the top layer above the modal's backdrop.
      if (
        doc.querySelector("dialog:modal") !== null ||
        doc.fullscreenElement !== null
      ) {
        parkedRef.current = true;
        return;
      }
      dock.showPopover();
    } else if (!visible) {
      if (showing) {
        dock.hidePopover();
      }
      parkedRef.current = false;
    }
  }, [dockRef, visible]);

  useEffect(() => {
    const dock = dockRef.current;
    if (!visible || dock === null || typeof dock.showPopover !== "function") {
      return;
    }
    const doc = dock.ownerDocument;
    const restoreWhenClear = () => {
      if (
        !parkedRef.current ||
        doc.querySelector("dialog:modal") !== null ||
        doc.fullscreenElement !== null
      ) {
        return;
      }
      if (!dock.matches(":popover-open")) {
        dock.showPopover();
      }
      parkedRef.current = false;
    };
    doc.addEventListener("close", restoreWhenClear, true);
    doc.addEventListener("fullscreenchange", restoreWhenClear);
    return () => {
      doc.removeEventListener("close", restoreWhenClear, true);
      doc.removeEventListener("fullscreenchange", restoreWhenClear);
    };
  }, [dockRef, visible]);

  return useCallback(
    (event: ToggleEvent<HTMLDivElement>) => {
      if (event.newState === "closed" && visible) {
        parkedRef.current = true;
      }
    },
    [visible],
  );
}
