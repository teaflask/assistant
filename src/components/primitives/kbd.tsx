"use client";

import type { ComponentPropsWithoutRef } from "react";

import { cx } from "./cx.js";

// A key cap: the question panel's ↑ ↓ ↵ hints at the right edge of the
// active answer row. Hairline on a transparent ground (so it sits on the
// emphasis wash in light and dark alike), the badge step, the control
// radius — an instrument marking, never a decoration — and always
// aria-hidden at the call site: the hint duplicates what the radiogroup's
// description already tells assistive tech, so it must not be read twice.
// Never wraps: a two-token cap ("Ctrl ↵") must stay one line inside its
// 20px height. Geist Sans, not mono: the visual spec keeps the mono face
// for code alone; the glyphs themselves are icons at the call site,
// because a host font cannot be trusted to carry U+21B5.

// WithoutRef on purpose: a plain function component cannot forward a ref
// under React 18.3, so admitting one in the props type would type-check a
// silent no-op (tests/ref-prop-surface.test.ts holds the line).
export function Kbd({ className, ...props }: ComponentPropsWithoutRef<"kbd">) {
  return (
    <kbd
      className={cx(
        "tf:inline-flex tf:h-5 tf:min-w-5 tf:items-center tf:justify-center tf:gap-0.5 tf:rounded-tf",
        "tf:border tf:border-tf-input tf:bg-tf-transparent tf:px-1 tf:font-tf-sans tf:text-xs",
        "tf:leading-none tf:whitespace-nowrap tf:text-tf-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
