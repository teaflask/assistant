"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type DialogHTMLAttributes,
  type MouseEvent,
  type PointerEvent,
  type SyntheticEvent,
} from "react";

import { focusAutofocusTarget } from "./autofocus.js";
import { cx } from "./cx.js";

// The primitives-layer overlay: a controlled modal on the native <dialog>.
// showModal() is what buys the whole overlay contract for free — top-layer
// paint above every host stacking context, an inert page behind (a real
// focus trap), Esc via `cancel`, and focus returned to the opener on
// close() — while the element stays where React rendered it, so host
// `--tf-*` variables and `data-tf-theme` keep inheriting exactly as they
// do into in-flow surfaces. A portal would break that inheritance; the
// top layer never does.

interface TfDialogProps extends Omit<
  DialogHTMLAttributes<HTMLDialogElement>,
  "open"
> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TfDialog({
  open,
  onOpenChange,
  className,
  children,
  onPointerDown: onHostPointerDown,
  ...props
}: TfDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // The `open` prop stays authoritative: native closes are reported up,
  // never applied locally, and this effect is the only writer.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
      // The composer marks itself with data-tf-autofocus; without a mark
      // the native behavior (first focusable) stands.
      focusAutofocusTarget(dialog, () => dialog.open);
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Esc. Cancelled so the close happens through the controlled cycle.
  const closeFromCancel = useCallback(
    (event: SyntheticEvent<HTMLDialogElement>) => {
      event.preventDefault();
      onOpenChange(false);
    },
    [onOpenChange],
  );

  // Safety net for a native close that skipped `cancel` (a
  // method="dialog" form, or a browser force-closing on repeated Esc).
  const closeFromNativeClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  // With zero own padding, the only place a press lands on the dialog
  // element itself is the ::backdrop. The click alone can't be trusted:
  // it dispatches on the common ancestor of pointerdown and pointerup,
  // so a text selection that starts in content and releases past the
  // panel edge also "clicks" the dialog — only a press that BEGAN on the
  // backdrop counts.
  //
  // Composed, not overridden: the spread below lands after every handler
  // on the element, so a caller passing its own onPointerDown (the sheet's
  // drag) would silently take this one's place and with it click-to-close.
  const pressBeganOnBackdropRef = useRef(false);
  const trackPressOrigin = useCallback(
    (event: PointerEvent<HTMLDialogElement>) => {
      pressBeganOnBackdropRef.current = event.target === event.currentTarget;
      onHostPointerDown?.(event);
    },
    [onHostPointerDown],
  );
  const closeFromBackdropClick = useCallback(
    (event: MouseEvent<HTMLDialogElement>) => {
      if (
        event.target === event.currentTarget &&
        pressBeganOnBackdropRef.current
      ) {
        onOpenChange(false);
      }
    },
    [onOpenChange],
  );

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- backdrop click-to-close; keyboard users close via Esc (the native cancel event)
    <dialog
      ref={dialogRef}
      // `hidden` restates the UA's closed-dialog display so the open:flex
      // override can't leak onto the closed-but-mounted element. The
      // important marker's collision rationale is historical: it guarded
      // against a host build re-declaring `.hidden` after this element's
      // `open:flex` — with the tf: prefix no host build can generate a
      // colliding name. Kept as ordering insurance between the sheet's
      // own tf:hidden and tf:open:flex rules, immune to any future
      // intra-sheet order or specificity drift.
      className={cx("tf:hidden tf:p-0 tf:open:flex!", className)}
      onCancel={closeFromCancel}
      onClose={closeFromNativeClose}
      onPointerDown={trackPressOrigin}
      onClick={closeFromBackdropClick}
      {...props}
    >
      {children}
    </dialog>
  );
}
