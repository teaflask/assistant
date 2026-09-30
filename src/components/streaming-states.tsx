"use client";

import type { ReactNode } from "react";

import { cx } from "./primitives/cx.js";

// The adopted register — bake-off 2026-07-30 (assistant-ui): a single pulsing dot where the next
// message will land — the ChatGPT idiom assistant-ui ships as its
// working indicator — and muted status text rendered as a moving gradient
// (the active-reasoning treatment; its animation lives in styles.css under
// [data-tf-shimmer-highlight]).
//
// THE MOTION PRIMITIVES (contract law 11). This module owns the
// migration's two motion primitives, and they are the only two:
//
//   - ShimmerText — THE active-text shimmer. Every surface whose words
//     move while work is live (fold headlines, process-row labels,
//     subagent presence) renders through it; nothing forks its markup
//     or keyframes (TVC-013 pins the fold, TVC-100 its reduced-motion
//     collapse).
//   - Spinner — THE indeterminate spinner, under [data-tf-spinner]. Its
//     label is REQUIRED and always visible: the hook is never valueless,
//     so reduced motion always leaves state text behind (TVC-101).
//     Today's only surface is the decision cards' submitting beat
//     ("Sending…"); run-state liveness everywhere else is ShimmerText.
//
// Both collapse under BOTH switches — the OS prefers-reduced-motion query
// and the host kill switch (data-reduce-motion="true" on any ancestor; the
// script-tag element reflects it across its shadow boundary) — and both
// are proven inside the custom element's constructed-stylesheet shadow
// root under a strict CSP (TVC-102). A lane needing motion beyond these
// must mint its own reduced-motion law; three shimmer implementations is a
// failure of contract law 11.

export function TypingIndicator() {
  return (
    <span
      // Both motion switches: the OS media query (the utility) and the
      // app's own kill switch (the data attribute, styles.css).
      data-tf-working-dot=""
      className="tf:animate-tf-pulse tf:text-tf-body tf:text-tf-foreground tf:motion-reduce:animate-none"
      role="status"
      aria-label="The assistant is working"
    >
      {"●"}
    </span>
  );
}

export function ShimmerText({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span data-tf-shimmer-text="" className={cx("tf:inline-grid", className)}>
      <span data-tf-shimmer-base="" className="tf:col-start-1 tf:row-start-1">
        {children}
      </span>
      <span
        data-tf-shimmer-highlight=""
        aria-hidden
        className="tf:col-start-1 tf:row-start-1"
      >
        {children}
      </span>
    </span>
  );
}

export function Spinner({
  label,
}: {
  /** The state the motion stands for — always rendered as visible text,
   *  so the spinner never spins wordlessly and reduced motion loses
   *  nothing. */
  label: string;
}) {
  return (
    <>
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        // Both motion switches: the OS media query (the utility) and the
        // app's own kill switch (the data attribute, styles.css).
        data-tf-spinner=""
        className="tf:size-3.5 tf:shrink-0 tf:animate-tf-spin tf:motion-reduce:animate-none"
      >
        <path
          d="M8 1.5a6.5 6.5 0 1 1-6.5 6.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <span>{label}</span>
    </>
  );
}

export function StreamingLine({ children }: { children: string }) {
  return (
    <ShimmerText className="tf:text-tf-label tf:text-tf-muted-foreground">
      {children}
    </ShimmerText>
  );
}
