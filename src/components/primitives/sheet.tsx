"use client";

import { useCallback, type ReactNode } from "react";

import { cx } from "./cx.js";
import { TfDialog } from "./dialog.js";
import { useSwipeDismiss } from "./use-swipe-dismiss.js";

// The edge drawer: the same top-layer <dialog> the modal rides on, laid
// against one edge at full height instead of floating in the middle. A
// centred card is an alert; navigation on a phone is a drawer, and the
// difference is entirely in where it comes from and how it leaves.
//
// The slide itself is CSS (styles.css, keyed on data-tf-sheet) because a
// native <dialog> only animates in and out via @starting-style plus
// allow-discrete on display/overlay — there is no React-side moment to
// hang a transition on. The swipe — the whole difference between a drawer
// and a modal that learned to slide — is the shared machine in
// use-swipe-dismiss.ts, riding this sheet's own axis: horizontal travel
// toward its edge, no grab region needed because the thread list beneath
// only ever scrolls the other way.

interface TfSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The drawer's edge. Also the direction a dismissing swipe travels. */
  side: "left" | "right";
  "aria-label": string;
  className?: string;
  children: ReactNode;
}

export function TfSheet({
  open,
  onOpenChange,
  side,
  className,
  children,
  ...props
}: TfSheetProps) {
  const dismiss = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);
  // The handlers ride the <dialog> element itself, so currentTarget is
  // always the panel — no ref to forward, and pointer capture retargets
  // the rest of the gesture here regardless of what it started over.
  const swipe = useSwipeDismiss({
    axis: "x",
    direction: side === "left" ? -1 : 1,
    open,
    onDismiss: dismiss,
  });

  return (
    <TfDialog
      open={open}
      onOpenChange={onOpenChange}
      data-tf-sheet={side}
      data-tf-glass=""
      onPointerDown={swipe.onPointerDown}
      onPointerMove={swipe.onPointerMove}
      onPointerUp={swipe.onPointerUp}
      onPointerCancel={swipe.onPointerCancel}
      onClickCapture={swipe.onClickCapture}
      className={cx(
        // Flush to three edges at full height. Square corners are the
        // point: a full-height panel with rounded outer corners reads as
        // a modal, not as an edge. The peek left over beside it (the
        // max-width) is both the "there is a page behind this" signal and
        // a thumb-sized dismiss target.
        "tf:m-0 tf:h-dvh tf:max-h-dvh tf:w-80 tf:max-w-[calc(100vw-3rem)] tf:flex-col",
        "tf:overflow-hidden tf:text-tf-foreground",
        side === "left" ? "tf:mr-auto" : "tf:ml-auto",
        className,
      )}
      {...props}
    >
      {children}
    </TfDialog>
  );
}
