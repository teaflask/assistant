"use client";

import { forwardRef } from "react";
import type { ComponentPropsWithoutRef } from "react";

import { cx } from "./cx.js";

// `framed` is the standing form control (hairline stroke, 13px label
// text); `bare` rides inside a composed control like the chat bar, whose
// container draws the border and focus ring — the text steps up to the
// conversation's 15px body size to match the transcript it feeds.
type TfTextareaVariant = "framed" | "bare";

interface TfTextareaProps extends ComponentPropsWithoutRef<"textarea"> {
  variant?: TfTextareaVariant;
}

const VARIANT_CLASSES: Record<TfTextareaVariant, string> = {
  framed:
    "tf:rounded-tf tf:border tf:border-tf-input tf:bg-tf-background tf:px-3 tf:py-2 " +
    "tf:text-tf-label " +
    "tf:focus-visible:outline-2 tf:focus-visible:outline-offset-1 tf:focus-visible:outline-tf-ring",
  bare: "tf:border-0 tf:bg-transparent tf:px-2 tf:py-1.5 tf:text-tf-body tf:focus-visible:outline-none",
};

// forwardRef rather than ref-as-prop: the peer range admits React 18.3,
// where a function component receives no ref through props — and the
// composer's caret machinery anchors to this element.
export const TfTextarea = forwardRef<HTMLTextAreaElement, TfTextareaProps>(
  function TfTextarea({ variant = "framed", className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cx(
          "tf:w-full tf:resize-none tf:text-tf-foreground",
          "tf:placeholder:text-tf-muted-foreground",
          "tf:disabled:cursor-not-allowed tf:disabled:opacity-50",
          VARIANT_CLASSES[variant],
          className,
        )}
        {...props}
      />
    );
  },
);
