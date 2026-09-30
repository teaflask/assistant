"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";

import { focusIfRestorable } from "./subagent-delegation-surface.js";
import { useSubagentDrillIn } from "./subagent-drill-in.js";

interface RosterDisclosure {
  open: boolean;
  rosterId: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  wrapperRef: RefObject<HTMLDivElement | null>;
  onWrapperPointerEnter: (event: React.PointerEvent<HTMLDivElement>) => void;
  onWrapperPointerLeave: (event: React.PointerEvent<HTMLDivElement>) => void;
  onWrapperBlur: (event: React.FocusEvent<HTMLDivElement>) => void;
  onTriggerPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onTriggerPointerCancel: () => void;
  onTriggerFocus: () => void;
  onTriggerClick: () => void;
  onTriggerKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  /** The card's close. */
  close: () => void;
  /** The card handing focus back on its own Esc. */
  refocusTrigger: () => void;
}

/** The roster's open/close choreography across the pill wrapper and its
 *  trigger: hover for mice and pens, tap and keyboard for the rest, with
 *  the one-shot focus-open mute that keeps a tap from toggling twice. */
export function useRosterDisclosure(): RosterDisclosure {
  const [open, setOpen] = useState(false);
  const rosterId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // At most one child preview surface at a time: opening the
  // roster dismisses an open inline drill-in through its own seam —
  // otherwise the roster's defocus blur would land on the drill-in
  // popover (a conversation-body child) and the two previews would
  // contend for the capacity-1 tail lease. Null outside a delegation
  // surface (tests, bare hosts): nothing to dismiss.
  const drillIn = useSubagentDrillIn();
  const openRoster = () => {
    drillIn?.dismiss();
    setOpen(true);
  };
  // The one-shot mute on the trigger's focus-open. Two writers: a
  // pointerdown (a tap fires focus BEFORE click — an unguarded focus-open
  // would flip the state the click then toggles straight back closed),
  // and the card handing focus back on its own Esc (a close, not an
  // arrival). Consumed at the next focus either way.
  const muteFocusOpenRef = useRef(false);

  return {
    open,
    rosterId,
    triggerRef,
    wrapperRef,
    onWrapperPointerEnter: (event) => {
      // Hover opens for mice and pens; a touch pointer waits for
      // the tap so a scroll-past never flashes the roster open.
      if (event.pointerType !== "touch") {
        openRoster();
      }
    },
    onWrapperPointerLeave: (event) => {
      // Touch fires pointerleave between pointerup and the compat
      // click: an unguarded close here would flip the state the
      // click then toggles straight back open, breaking
      // tap-to-close. Only hover-capable pointers close on leave —
      // and a hover-capable pointer leaving also abandons any
      // press in flight, so the stale mute goes with it (its focus
      // consumer already ran at mousedown if the press was real).
      if (event.pointerType !== "touch") {
        muteFocusOpenRef.current = false;
        // …but never out from under a keyboard user: the preview
        // rows are focusable, and unmounting the card
        // would drop their place to <body>. Only genuinely
        // keyboard-reachable elements count (tabIndex >= 0): the
        // card ITSELF carries tabIndex -1 and takes focus from a
        // click on its passive ink — that focus must not park the
        // roster open past the hover. Read through getRootNode() —
        // in the script-tag shadow root, document.activeElement
        // names the HOST and a contains() guard would always fail
        // (the floating-panel read).
        const wrapper = wrapperRef.current;
        const root = wrapper?.getRootNode();
        const active =
          root instanceof Document || root instanceof ShadowRoot
            ? root.activeElement
            : null;
        if (
          wrapper !== null &&
          active instanceof HTMLElement &&
          active.tabIndex >= 0 &&
          active !== triggerRef.current &&
          wrapper.contains(active)
        ) {
          return;
        }
        setOpen(false);
      }
    },
    onWrapperBlur: (event) => {
      // Focus leaving the pair (Tab away) closes the roster; a
      // move within it (trigger to a drill-in row) does not.
      const next = event.relatedTarget;
      if (
        wrapperRef.current !== null &&
        (!(next instanceof Node) || !wrapperRef.current.contains(next))
      ) {
        setOpen(false);
      }
    },
    onTriggerPointerDown: (event) => {
      // Primary presses only: a right-click fires no click to
      // consume the flag, so it must never set it. NOT cleared on
      // pointerup — touch fires its compat focus AFTER pointerup,
      // and an early clear would resurrect the open-then-closed
      // tap (the interaction matrix pins that order).
      if (event.button === 0) {
        muteFocusOpenRef.current = true;
      }
    },
    onTriggerPointerCancel: () => {
      // A press the browser took back (touch became a scroll)
      // fires neither focus nor click — nothing else will
      // consume the flag.
      muteFocusOpenRef.current = false;
    },
    onTriggerFocus: () => {
      // Keyboard focus opens; pointer-initiated focus defers to
      // the click that follows it. The flag is one-shot so an
      // abandoned press never mutes a later Tab.
      if (!muteFocusOpenRef.current) {
        openRoster();
      }
      muteFocusOpenRef.current = false;
    },
    onTriggerClick: () => {
      // The tap/keyboard toggle — the touch path's only opener.
      // The flag also clears here: a second tap fires no focus
      // (the trigger already holds it), and a stale flag would
      // mute the next keyboard Tab once.
      muteFocusOpenRef.current = false;
      if (open) {
        setOpen(false);
      } else {
        openRoster();
      }
    },
    onTriggerKeyDown: (event) => {
      // Escape with focus on the trigger closes the roster, not
      // the surface — stopped so the panel's own Esc never sees
      // it while the roster is open.
      if (!open || event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    },
    close: () => {
      setOpen(false);
    },
    refocusTrigger: () => {
      // Handing focus back is a close, not an arrival: mute the
      // focus-open the trigger would otherwise fire, or the
      // card's own Esc would reopen what it just closed. Through
      // the shared restorable guard: a scrollback-yielded
      // trigger is visibility:hidden, where a bare focus()
      // silently no-ops and strands focus — the guard hands it
      // to the merged jump affordance instead.
      muteFocusOpenRef.current = true;
      focusIfRestorable(triggerRef.current);
    },
  };
}

// Light dismissal for the tap-opened roster: any pointer down outside
// the card and its trigger closes it. Judged by composedPath(), not
// contains() — the script-tag distribution runs in an open shadow
// root, where document-level events retarget to the host element.
export function useFloatingDismiss(
  floatingRef: RefObject<HTMLDivElement | null>,
  triggerRef: RefObject<HTMLButtonElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    const floating = floatingRef.current;
    if (floating === null) {
      return;
    }
    const closeUnlessInside = (event: Event) => {
      const path = event.composedPath();
      if (path.includes(floating)) {
        return;
      }
      const trigger = triggerRef.current;
      if (trigger !== null && path.includes(trigger)) {
        return;
      }
      onClose();
    };
    const doc = floating.ownerDocument;
    doc.addEventListener("pointerdown", closeUnlessInside);
    return () => {
      doc.removeEventListener("pointerdown", closeUnlessInside);
    };
  }, [floatingRef, onClose, triggerRef]);
}
