"use client";

import {
  useEffect,
  useRef,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react";

import { TfButton } from "./primitives/button.js";
import { cx } from "./primitives/cx.js";

// The drawer header's disclosure mechanics: a trigger in the header row
// that drops a small dialog open over the transcript. The history menu
// wears this today; the mode switcher joins it from the same pair.
//
// Trigger and menu are two exports rather than one component because
// they live on opposite sides of a boundary the DOM enforces: the
// trigger sits inside the header row, which IS the swipe-dismiss handle
// (`data-tf-swipe-handle` matches by closest()), and a menu nested in
// that row would turn every touch-drag over a menu row into a drawer
// dismissal. The parent owns the open flag and threads it through.
//
// The caller's side of the contract: render the menu as a DOM sibling
// AFTER the panel body, not inside the header row. The package ships no
// z-index, so among positioned boxes document order is the paint order —
// a menu mounted before the body would lose to the transcript's own
// positioned bubbles. This file can't enforce placement; the caller
// carries the law.

/** The header-row half: owns the disclosure aria wiring and the
 *  Esc-closes-the-menu-not-the-drawer keydown. Everything else — variant,
 *  className, children — passes through to TfButton. */
export function HeaderDisclosureTrigger({
  menuId,
  open,
  onOpenChange,
  triggerRef,
  children,
  ...buttonProps
}: {
  menuId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
  // "ref" stripped alongside the handlers this component owns: TfButton is
  // a forwardRef component, so its ComponentProps include a ref that would
  // ride ...buttonProps and clobber triggerRef in the spread below under
  // React 19 (and silently vanish under 18.3). triggerRef IS this
  // component's ref channel.
} & Omit<ComponentProps<typeof TfButton>, "onClick" | "onKeyDown" | "ref">) {
  return (
    <TfButton
      ref={triggerRef}
      aria-expanded={open}
      aria-controls={menuId}
      {...buttonProps}
      onClick={() => {
        onOpenChange(!open);
      }}
      onKeyDown={(event) => {
        // Escape with focus on the trigger closes the menu, not the
        // drawer — stopped so the panel's own Esc-to-close never sees it.
        if (!open || event.key !== "Escape") {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onOpenChange(false);
      }}
    >
      {children}
    </TfButton>
  );
}

/** The dropped-open half. Mounted only while open — the parent gates the
 *  render, so unmounting is the close and no state survives a minimize.
 *  The caller's className carries the anchor side and measure (the
 *  history menu hangs `left-2 w-72` under its title; a right-edge
 *  disclosure would pass `right-2`). */
export function HeaderDisclosureMenu({
  id,
  onClose,
  triggerRef,
  triggerId,
  "aria-label": ariaLabel,
  className,
  insetFromSurfaceTop = false,
  autoFocusFirstButton = true,
  children,
}: {
  id: string;
  onClose: () => void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  triggerId?: string;
  "aria-label": string;
  className?: string;
  /** A host-rendered full-page trigger can live in the host header
   *  immediately above the assistant. Its menu starts at the surface's
   *  top inset instead of below the companion's own 56px header. */
  insetFromSurfaceTop?: boolean;
  /** Default true: the first button is the menu's primary command. A
   *  tenant whose first button is NOT a safe primary (the connect
   *  panel's resting state leads with the destructive disconnect, and a
   *  held Enter on the trigger key-repeats onto whatever gets focus)
   *  opts out — focus then rests on the trigger, the classic
   *  disclosure convention, whose own Esc handling still closes. */
  autoFocusFirstButton?: boolean;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Light dismissal: any pointer that goes down outside the menu closes
  // it. Judged by composedPath(), not contains() — the script-tag
  // distribution runs in an open shadow root, where document-level
  // events retarget to the host element and contains() would call every
  // in-shadow press an outside one. The trigger is excluded so its own
  // press doesn't close-then-reopen through the click that follows.
  useEffect(() => {
    const menu = menuRef.current;
    if (menu === null) {
      return;
    }
    const closeUnlessInside = (event: Event) => {
      const path = event.composedPath();
      if (path.includes(menu)) {
        return;
      }
      const trigger =
        triggerRef?.current ??
        (triggerId === undefined
          ? null
          : menu.ownerDocument.getElementById(triggerId));
      if (trigger !== null && path.includes(trigger)) {
        return;
      }
      onClose();
    };
    const doc = menu.ownerDocument;
    doc.addEventListener("pointerdown", closeUnlessInside);
    return () => {
      doc.removeEventListener("pointerdown", closeUnlessInside);
    };
  }, [onClose, triggerId, triggerRef]);

  // Opening moves focus into the panel — its first button is the menu's
  // primary command (unless the tenant opted out above).
  useEffect(() => {
    if (autoFocusFirstButton) {
      menuRef.current?.querySelector("button")?.focus();
    }
  }, [autoFocusFirstButton]);

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the keydown is the menu's own Esc-to-close; every focusable inside is a real button.
    <div
      ref={menuRef}
      id={id}
      role="dialog"
      aria-label={ariaLabel}
      // Absolute against the assistant surface: the fixed companion or
      // the relative full-page root. It is a sibling of the transcript,
      // painted over it by document order alone — the package ships no
      // z-index. Fill, blur, and shadow come from the sanctioned
      // liquid-glass portal material.
      data-tf-glass=""
      // The flag the panel reads to throw its conversation out of focus
      // while this menu is open (styles.css) — the menu's own glass
      // tints the transcript's text but cannot soften it.
      data-tf-disclosure=""
      data-tf-surface-inset={insetFromSurfaceTop ? "" : undefined}
      className={cx(
        "tf:absolute tf:top-14 tf:flex tf:max-h-96 tf:flex-col tf:overflow-hidden tf:rounded-2xl tf:border",
        className,
      )}
      onKeyDown={(event) => {
        // Esc closes the menu and hands focus back to its trigger; the
        // drawer survives — stopped before the panel's handler minimizes
        // it too.
        if (event.key !== "Escape") {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onClose();
        const trigger =
          triggerRef?.current ??
          (triggerId === undefined
            ? null
            : menuRef.current?.ownerDocument.getElementById(triggerId));
        trigger?.focus();
      }}
    >
      {children}
    </div>
  );
}
