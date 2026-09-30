"use client";

import { type RefObject } from "react";

import type { PanelDock } from "../persistence/panel-mode.js";
import {
  HeaderDisclosureMenu,
  HeaderDisclosureTrigger,
} from "./companion-header-disclosure.js";
import { CheckIcon, SidebarIcon } from "./icons.js";
import { TfButton } from "./primitives/button.js";

// The drawer header's mode switcher: Floating (the corner card, the
// default) or Sidebar (the flush right-edge dock that pushes the page).
// The second wearer of the header-disclosure pair — same trigger
// mechanics, same light dismiss, same Esc discipline as the history
// menu. Unlike the title, this renders for anonymous visitors too: the
// mode is chrome, not history, so there is no historyExpected gate. The
// a11y register also matches the history menu — a small dialog of plain
// buttons, not menuitemradio rows, which would promise a role="menu"
// arrow-key contract neither disclosure implements; the active choice
// rides aria-pressed and a visible check.

/** The header-row half, mounted in the reserved slot between compose and
 *  minimize. The parent hides it below the sidebar's viewport floor by
 *  not rendering it at all. */
export function CompanionModeTrigger({
  menuId,
  open,
  onOpenChange,
  triggerRef,
}: {
  menuId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <HeaderDisclosureTrigger
      menuId={menuId}
      open={open}
      onOpenChange={onOpenChange}
      triggerRef={triggerRef}
      variant="icon"
      aria-label="Panel position"
      title="Panel position"
    >
      <SidebarIcon />
    </HeaderDisclosureTrigger>
  );
}

/** The dropped-open half: two rows, a check on the active one. Selection
 *  reports up and closes — the parent owns the persisted mode, the menu
 *  never reads storage. */
export function CompanionModeMenu({
  id,
  dock,
  onSelect,
  onClose,
  triggerRef,
}: {
  id: string;
  dock: PanelDock;
  onSelect: (dock: PanelDock) => void;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <HeaderDisclosureMenu
      id={id}
      aria-label="Panel position"
      onClose={onClose}
      triggerRef={triggerRef}
      // Right-anchored under the icon cluster it drops from (the history
      // menu's left-2.5 mirrored); w-52 fits the longer label with the
      // check's column to spare, and p-1 is the same row inset the
      // thread list carries.
      className="tf:right-2 tf:w-52 tf:p-1"
    >
      <ModeRow
        label="Floating"
        active={dock === "floating"}
        onSelect={() => {
          onSelect("floating");
        }}
      />
      <ModeRow
        label="Sidebar"
        active={dock === "sidebar"}
        onSelect={() => {
          onSelect("sidebar");
        }}
      />
    </HeaderDisclosureMenu>
  );
}

function ModeRow({
  label,
  active,
  onSelect,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    // The desktop `row` register, not rowTouch: this menu only exists
    // above the sidebar's viewport floor, so its rows always sit beside
    // the history menu's desktop-density list — two disclosures off one
    // header must read at one density.
    <TfButton variant="row" aria-pressed={active} onClick={onSelect}>
      <span className="tf:min-w-0 tf:flex-1 tf:truncate">{label}</span>
      {active ? <CheckIcon /> : null}
    </TfButton>
  );
}
