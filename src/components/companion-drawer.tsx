"use client";

import { lazy, useId, useRef, useState, type RefObject } from "react";

import type { PanelDock } from "../persistence/panel-mode.js";
import { useAssistantAppearance } from "./appearance-context.js";
import {
  CompanionHeaderTitle,
  CompanionHistoryMenu,
} from "./companion-history-menu.js";
import {
  CompanionModeMenu,
  CompanionModeTrigger,
} from "./companion-mode-menu.js";
import { ComposeIcon, MinimizeIcon } from "./icons.js";
import { LazyBody } from "./lazy-body.js";
import { TfButton } from "./primitives/button.js";
import { TfFloatingPanel } from "./primitives/floating-panel.js";
import { useAssistantConversation } from "./use-assistant-conversation.js";

// The companion's corner chat drawer: the non-modal TfFloatingPanel with
// a real header — the visible grabber (swipe-to-dismiss starts only on
// the handle, and an invisible handle is no touch affordance at all), a
// title, and the controls. On the left the title IS the history
// disclosure: the active conversation's name with a chevron, dropping
// open the same list the page's rail shows — where you are and where
// you've been are one affordance. On the right, compose starts a fresh
// conversation, and the close control is a minimize dash, not an X:
// dismissing the drawer collapses it back into the perch — the
// conversation and the companion both survive — and an X would promise a
// destruction that never happens. The title sits at the muted label step
// so the empty state's centered question stays the surface's only
// headline; the panel's aria-label carries the accessible name
// regardless.
//
// The body is code-split behind the first expand. React.lazy's dynamic
// import is the mechanism: the minimized companion ships without the
// transcript (or the chat chassis under it), and the host's bundler
// splits the chunk without configuration.
const CompanionDrawerBody = lazy(() => import("./companion-drawer-body.js"));

export function CompanionDrawer({
  open,
  exiting,
  focusOnOpen,
  onOpenChange,
  corner,
  dock,
  onDockChange,
}: {
  open: boolean;
  /** The open is the visitor's own gesture, so the caret may land in the
   *  composer; false for an open written from outside (a tool
   *  navigation), which must leave focus where it is. */
  focusOnOpen: boolean;
  /** The parent is holding the unmount so the close transition can
   *  paint; the body stays for the ride so the card leaves whole, not
   *  as a gutted header-only shell. */
  exiting: boolean;
  onOpenChange: (open: boolean) => void;
  corner: "bottom-right" | "bottom-left";
  /** The effective mode, already viewport-resolved by the parent — the
   *  drawer never reads persistence or measures the window. */
  dock: PanelDock;
  /** Null hides the switcher: the viewport is below the sidebar's floor
   *  and the parent already forced floating. */
  onDockChange: ((dock: PanelDock) => void) | null;
}) {
  const { rootProps } = useAssistantAppearance();
  const core = useAssistantConversation();
  const menus = useDrawerMenus(onDockChange, onOpenChange);

  return (
    <TfFloatingPanel
      open={open}
      focusOnOpen={focusOnOpen}
      onOpenChange={menus.changeOpenAndSettleMenu}
      corner={corner}
      dock={dock}
      aria-label="Assistant"
      {...rootProps}
    >
      {/* The hairline is the scroll boundary: a live transcript clips
          its lines exactly at this row's bottom edge, and the palette —
          the same header anatomy over the same conversation body —
          already draws it. Same register, same line. */}
      <div
        data-tf-swipe-handle=""
        className="tf:relative tf:flex tf:h-12 tf:shrink-0 tf:items-center tf:gap-1 tf:border-b tf:pr-2 tf:pl-4"
      >
        <span aria-hidden data-tf-companion-grabber="" />
        <CompanionHeaderTitle
          menuId={menus.historyMenuId}
          open={menus.historyOpen}
          onOpenChange={menus.discloseHistory}
          triggerRef={menus.historyTriggerRef}
        />
        {/* Hidden only when the surface is broken — there is no session
            for a fresh conversation to act on (palette parity). Anonymous
            visitors keep it: they hold live conversations, just no
            server-side history. */}
        {core.setupError === null ? (
          <NewConversationButton onStart={core.startNewConversation} />
        ) : null}
        {onDockChange !== null ? (
          <CompanionModeTrigger
            menuId={menus.modeMenuId}
            open={menus.modeMenuOpen}
            onOpenChange={menus.discloseModeMenu}
            triggerRef={menus.modeTriggerRef}
          />
        ) : null}
        <TfButton
          variant="icon"
          aria-label="Minimize assistant"
          title="Minimize assistant"
          onClick={menus.minimize}
        >
          <MinimizeIcon />
        </TfButton>
      </div>
      {/* Mounted only while open or riding the exit hold, palette
          parity: a closed drawer must not hold an invisible live stream
          — a yield can last minutes while the palette holds the
          transcript lease — and reopening replays the conversation
          exactly. The exit hold is different in kind: a bounded
          teardown grace, during which nothing else holds the lease and
          the body's presence is what keeps the departing card whole. */}
      {open || exiting ? (
        <LazyBody>
          <CompanionDrawerBody />
        </LazyBody>
      ) : null}
      {/* A sibling of the handle row, not a child: a touch-drag over a
          history row must never read as a grab of the drawer. Gated on
          open too, so a yielded drawer holds the menu's flag without
          holding its listeners. AFTER the body in the DOM: the package
          ships no z-index, so among positioned boxes document order is
          the paint order — earlier, the transcript's own positioned
          bubbles drew over the dropped-open menu. */}
      {open && menus.historyOpen ? (
        <CompanionHistoryMenu
          id={menus.historyMenuId}
          onClose={menus.closeHistory}
          triggerRef={menus.historyTriggerRef}
        />
      ) : null}
      {open && menus.modeMenuOpen && onDockChange !== null ? (
        <CompanionModeMenu
          id={menus.modeMenuId}
          dock={dock}
          triggerRef={menus.modeTriggerRef}
          onClose={menus.closeModeMenu}
          onSelect={menus.selectDock}
        />
      ) : null}
    </TfFloatingPanel>
  );
}

interface DrawerMenus {
  historyOpen: boolean;
  historyMenuId: string;
  historyTriggerRef: RefObject<HTMLButtonElement | null>;
  modeMenuOpen: boolean;
  modeMenuId: string;
  modeTriggerRef: RefObject<HTMLButtonElement | null>;
  discloseHistory: (next: boolean) => void;
  discloseModeMenu: (next: boolean) => void;
  closeHistory: () => void;
  closeModeMenu: () => void;
  selectDock: (next: PanelDock) => void;
  changeOpenAndSettleMenu: (next: boolean) => void;
  /** The dash: a deliberate dismissal, menus and all. */
  minimize: () => void;
}

/** The header's two disclosures — history and dock mode — open one at a
 *  time, and both taken down by any deliberate dismissal of the drawer. */
function useDrawerMenus(
  onDockChange: ((dock: PanelDock) => void) | null,
  onOpenChange: (open: boolean) => void,
): DrawerMenus {
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyMenuId = useId();
  const historyTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const modeMenuId = useId();
  const modeTriggerRef = useRef<HTMLButtonElement | null>(null);

  // The switcher leaving takes its menu down for good — without this, a
  // menu open when the viewport drops below the sidebar floor would hold
  // its flag through the unmount and pop back open, unprompted, when the
  // viewport returns. Render-time adjustment (the sanctioned shape), not
  // an effect: the flag must never survive into a paint that renders the
  // trigger expanded.
  if (onDockChange === null && modeMenuOpen) {
    setModeMenuOpen(false);
  }

  // One disclosure at a time: two dropped-open menus would stack by
  // paint order and race each other's light dismiss, so opening any
  // takes the others down.
  function discloseHistory(next: boolean) {
    if (next) {
      setModeMenuOpen(false);
    }
    setHistoryOpen(next);
  }
  function discloseModeMenu(next: boolean) {
    if (next) {
      setHistoryOpen(false);
    }
    setModeMenuOpen(next);
  }
  function closeHistory() {
    setHistoryOpen(false);
  }
  function closeModeMenu() {
    setModeMenuOpen(false);
  }
  function selectDock(next: PanelDock) {
    setModeMenuOpen(false);
    if (onDockChange !== null) {
      onDockChange(next);
    }
    // The pick just re-geometried the whole panel under the
    // keyboard user; the trigger is the one landmark that stayed
    // put, so focus comes back to it rather than dying with the
    // menu row.
    modeTriggerRef.current?.focus();
  }

  // Every deliberate dismissal — the dash, Esc, a swipe, a forced park —
  // arrives through this callback, and takes the menus down with the
  // drawer. A yield to the palette deliberately does NOT: it flips the
  // open prop without ringing here, and the drawer's contract for a
  // yield is that everything comes back exactly as it was.
  function changeOpenAndSettleMenu(next: boolean) {
    if (!next) {
      setHistoryOpen(false);
      setModeMenuOpen(false);
    }
    onOpenChange(next);
  }
  function minimize() {
    changeOpenAndSettleMenu(false);
  }

  return {
    historyOpen,
    historyMenuId,
    historyTriggerRef,
    modeMenuOpen,
    modeMenuId,
    modeTriggerRef,
    discloseHistory,
    discloseModeMenu,
    closeHistory,
    closeModeMenu,
    selectDock,
    changeOpenAndSettleMenu,
    minimize,
  };
}

/** Compose: a fresh conversation, with the caret handed to the composer. */
function NewConversationButton({ onStart }: { onStart: () => void }) {
  return (
    <TfButton
      variant="icon"
      aria-label="New conversation"
      title="New conversation"
      onClick={(event) => {
        onStart();
        // The fresh conversation starts with the caret in the
        // composer, not on this button (palette parity, retargeted:
        // the drawer's root is the popover div, not a dialog).
        const panel = event.currentTarget.closest("[data-tf-floating-panel]");
        requestAnimationFrame(() => {
          panel?.querySelector<HTMLElement>("[data-tf-autofocus]")?.focus();
        });
      }}
    >
      <ComposeIcon />
    </TfButton>
  );
}
