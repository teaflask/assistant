"use client";

import { forwardRef } from "react";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";

import { cx } from "./cx.js";

// The package's primitives layer: raw interactive elements are legal only
// here (the lint law mirrors the dashboard's shadcn-primitives rule).

// The Graphite button grammar: filled primary-grade actions are pills
// with the control wash; quiet variants sit on the control-radius step.
// `send` is the chat bar's circular primary; `icon` the rail/masthead
// square; `row` the rail's nav row (aria-current carries its selection)
// and `rowAction` its taller sibling for the rail's one command;
// `rowTouch` both at the 44px touch floor; `prompt` the empty state's row.
type TfButtonVariant =
  | "primary"
  | "ghost"
  | "send"
  | "stop"
  | "icon"
  | "iconFloating"
  | "row"
  | "rowAction"
  | "rowTouch"
  | "rowActionTouch"
  | "prompt"
  | "bare"
  | "chip"
  | "chipQuiet"
  | "outline"
  | "answerRow";

interface TfButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: TfButtonVariant;
}

// Each variant resets the UA button border itself: no preflight ships with
// the package, so every shape states its own `border-0` rather than
// inheriting the host page's idea of what a button looks like.
const VARIANT_CLASSES: Record<TfButtonVariant, string> = {
  primary:
    "tf:justify-center tf:rounded-full tf:border-0 tf:px-3 tf:py-1.5 tf:text-tf-label tf:font-medium " +
    "tf:bg-tf-primary tf:text-tf-primary-foreground tf:shadow-tf-control " +
    "tf:hover:opacity-90 tf:disabled:opacity-50",
  ghost:
    "tf:justify-center tf:rounded-tf tf:border-0 tf:px-3 tf:py-1.5 tf:text-tf-label tf:font-medium " +
    "tf:bg-tf-transparent tf:text-tf-foreground tf:hover:bg-tf-accent tf:disabled:opacity-50",
  // Nothing to send is a resting state, not a broken one: the disabled
  // circle steps back to the muted wash instead of showing a filled ink
  // button at 40% — a washed-out primary reads as a rendering fault.
  send:
    "tf:size-8 tf:shrink-0 tf:justify-center tf:rounded-full tf:border-0 " +
    "tf:bg-tf-primary tf:text-tf-primary-foreground tf:shadow-tf-control " +
    "tf:hover:opacity-90 tf:disabled:bg-tf-muted tf:disabled:text-tf-muted-foreground " +
    "tf:disabled:opacity-100 tf:disabled:shadow-none",
  // The send circle's busy-state counterpart: same silhouette, filled-ink
  // register even through the "Stopping…" beat. That beat is narrated
  // with aria-disabled, never the disabled attribute — disabling the
  // focused control drops keyboard focus to <body>.
  stop:
    "tf:size-8 tf:shrink-0 tf:justify-center tf:rounded-full tf:border-0 " +
    "tf:bg-tf-primary tf:text-tf-primary-foreground tf:shadow-tf-control " +
    "tf:hover:opacity-90 tf:aria-disabled:cursor-not-allowed tf:aria-disabled:opacity-70",
  icon:
    "tf:size-7 tf:justify-center tf:rounded-tf tf:border-0 tf:bg-tf-transparent tf:text-tf-muted-foreground " +
    "tf:hover:bg-tf-accent tf:hover:text-tf-foreground tf:disabled:opacity-50",
  // A floating icon control: round, on its own paper plate with a hairline
  // and the control wash, for glyphs hovering over arbitrary pixels. A
  // VARIANT, not a caller className: cx is a plain join, so a caller's
  // bg-tf-background loses to icon's own bg-tf-transparent by sheet order.
  iconFloating:
    "tf:justify-center tf:rounded-full tf:border tf:bg-tf-background " +
    "tf:text-tf-muted-foreground tf:shadow-tf-control " +
    "tf:hover:bg-tf-accent tf:hover:text-tf-foreground tf:disabled:opacity-50",
  // 32px at 14px medium — the app's measured rail register, so the
  // assistant's history reads at the same density as the docs tree.
  row:
    "tf:h-8 tf:w-full tf:justify-start tf:rounded-tf tf:border-0 tf:px-2.5 tf:text-left tf:text-sm tf:font-medium " +
    "tf:bg-tf-transparent tf:text-tf-muted-foreground tf:hover:bg-tf-accent " +
    "tf:hover:text-tf-foreground tf:aria-[current=true]:bg-tf-accent " +
    "tf:aria-[current=true]:text-tf-foreground tf:disabled:opacity-50",
  rowAction:
    "tf:h-9 tf:w-full tf:justify-start tf:gap-2 tf:rounded-tf tf:border-0 tf:px-2.5 tf:text-left tf:text-sm " +
    "tf:font-medium tf:bg-tf-transparent tf:text-tf-foreground tf:hover:bg-tf-accent " +
    "tf:disabled:opacity-50",
  // The drawer's rows clear the 44px touch floor and read a step larger:
  // a phone is held further away than a rail is leaned over.
  rowTouch:
    "tf:h-11 tf:w-full tf:justify-start tf:gap-2 tf:rounded-tf tf:border-0 tf:px-3 tf:text-left " +
    "tf:text-tf-body tf:font-medium tf:bg-tf-transparent tf:text-tf-muted-foreground " +
    "tf:hover:bg-tf-accent tf:hover:text-tf-foreground " +
    "tf:aria-[current=true]:bg-tf-accent tf:aria-[current=true]:text-tf-foreground " +
    "tf:disabled:opacity-50",
  // The drawer's edition of rowAction. A variant rather than a colour
  // override on rowTouch: cx is a plain join, so a passed text-tf-foreground
  // and rowTouch's own muted ink land at equal specificity and the
  // later-emitted utility (the muted one) wins.
  rowActionTouch:
    "tf:h-11 tf:w-full tf:justify-start tf:gap-2 tf:rounded-tf tf:border-0 tf:px-3 tf:text-left " +
    "tf:text-tf-body tf:font-medium tf:bg-tf-transparent tf:text-tf-foreground " +
    "tf:hover:bg-tf-accent tf:disabled:opacity-50",
  // The opening prompts. A row, not a pill: three pills of unequal width
  // centre-justified make a ragged line, and rows survive a 390px column.
  // The trailing arrow is held at zero opacity rather than unmounted so
  // the right edge never twitches. px-4 puts the leading glyph on the
  // composer's own text inset, hanging off the chat bar's left edge.
  prompt:
    "tf:min-h-11 tf:w-full tf:justify-start tf:gap-2.5 tf:rounded-tf tf:border-0 tf:px-4 tf:py-2 " +
    "tf:text-left tf:text-tf-label tf:bg-tf-transparent tf:text-tf-foreground " +
    "tf:hover:bg-tf-accent tf:disabled:opacity-50 " +
    "tf:[&_[data-tf-prompt-mark]]:text-tf-muted-foreground " +
    "tf:[&_[data-tf-prompt-go]]:opacity-0 tf:[&_[data-tf-prompt-go]]:transition-opacity " +
    "tf:hover:[&_[data-tf-prompt-go]]:opacity-100 " +
    "tf:focus-visible:[&_[data-tf-prompt-go]]:opacity-100 " +
    // Touch has no hover to reveal the go arrow; it stays visible there.
    "tf:pointer-coarse:[&_[data-tf-prompt-go]]:opacity-100",
  // A button that draws nothing of its own — for content that IS the
  // affordance (the companion perch's mark, the bubble's sentence). Keeps
  // the focus ring, resets the UA chrome, and takes the surrounding ink:
  // the UA's buttontext would paint black on a dark popover.
  bare: "tf:rounded-tf tf:border-0 tf:bg-tf-transparent tf:p-0 tf:text-inherit tf:disabled:opacity-50",
  // The composer shelf's chip (the provider/model slot): a quiet rounded
  // control at the 13px label step. Two emphases as two variants (cx is a
  // plain join, so emphasis has to be the variant's): `chip` keeps full
  // ink for an affordance that asks, `chipQuiet` is the settled standing's.
  chip:
    "tf:rounded-full tf:border-0 tf:px-2 tf:py-1 tf:text-tf-label tf:font-medium " +
    "tf:bg-tf-transparent tf:text-tf-foreground tf:hover:bg-tf-accent " +
    "tf:disabled:opacity-50",
  chipQuiet:
    "tf:rounded-full tf:border-0 tf:px-2 tf:py-1 tf:text-tf-label tf:font-medium " +
    "tf:bg-tf-transparent tf:text-tf-muted-foreground tf:hover:bg-tf-accent " +
    "tf:hover:text-tf-foreground tf:disabled:opacity-50",
  // A bounded secondary action/status control. It shares the pill
  // silhouette with the composer's chips, but keeps a hairline so it is
  // unmistakably interactive inside a floating menu.
  outline:
    "tf:justify-center tf:rounded-full tf:border tf:px-2.5 tf:py-1 tf:text-tf-label tf:font-medium " +
    "tf:bg-tf-background tf:text-tf-foreground tf:shadow-tf-control " +
    "tf:hover:bg-tf-accent tf:disabled:opacity-50",
  // The question panel's answer row: one suggestion per line, spanning
  // the panel, on the 44px touch floor. Selection is the emphasis wash,
  // via aria-checked — state speaks through the attribute the screen
  // reader already gets (No-Accent: never a color). Borderless: the
  // row's edges are the panel's.
  answerRow:
    "tf:min-h-11 tf:w-full tf:items-start tf:justify-start tf:gap-3 tf:rounded-tf tf:border-0 " +
    "tf:bg-tf-transparent tf:px-3 tf:py-2.5 tf:text-left tf:text-tf-label tf:text-tf-foreground " +
    "tf:wrap-anywhere tf:hover:bg-tf-accent tf:disabled:opacity-50 " +
    "tf:aria-checked:bg-tf-emphasis",
};

// forwardRef rather than ref-as-prop: the peer range admits React 18.3,
// where a function component receives no ref through props — and callers
// that anchor to the element (the drawer's history disclosure, the focus
// hand-backs) need the ref to attach.
export const TfButton = forwardRef<HTMLButtonElement, TfButtonProps>(
  function TfButton({ variant = "primary", className, type, ...props }, ref) {
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        className={cx(
          "tf:appearance-none",
          "tf:inline-flex tf:items-center tf:gap-1.5 tf:transition-colors",
          "tf:focus-visible:outline-2 tf:focus-visible:outline-offset-2 tf:focus-visible:outline-tf-ring",
          "tf:disabled:cursor-not-allowed",
          VARIANT_CLASSES[variant],
          className,
        )}
        {...props}
      />
    );
  },
);

// A navigation wearing the button grammar — for actions whose "click" is
// a link (the connect panel's approve CTA). Same class source as
// TfButton so the pill can never drift; no disabled arm, because anchors
// have none.
export function TfLinkButton({
  variant = "primary",
  className,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: TfButtonVariant }) {
  return (
    <a
      className={cx(
        // no-underline: the UA underlines anchors and no preflight ships
        // with the package — a pill with an underline reads as a bug.
        "tf:appearance-none tf:no-underline",
        "tf:inline-flex tf:items-center tf:gap-1.5 tf:transition-colors",
        "tf:focus-visible:outline-2 tf:focus-visible:outline-offset-2 tf:focus-visible:outline-tf-ring",
        VARIANT_CLASSES[variant],
        className,
      )}
      {...props}
    >
      {children}
    </a>
  );
}
