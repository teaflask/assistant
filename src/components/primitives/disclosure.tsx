"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

import { cx } from "./cx.js";

// A dependency-free collapsible on native <details>/<summary> — the
// package ships no Radix. Consumers place their own trailing affordance
// (the chevron, or a spinner while work is in flight) in the summary.
// `framed` is the standing bordered form; `bare` keeps only the
// mechanics (marker hiding, cursor, focus ring) and hands every visual
// decision to the caller — the form composed surfaces like the tool
// rows build their own chrome on.

type DisclosureVariant = "framed" | "bare";

interface DisclosureProps {
  summary: ReactNode;
  children: ReactNode;
  variant?: DisclosureVariant;
  /** true opens the disclosure and re-opens it on every VALUE change
   *  back to true (React re-writes the attribute only when the prop
   *  value changes — see the nativeOpen comment below — so a visitor's
   *  collapse of a held-open details sticks until the next flip);
   *  undefined leaves it native — pass `condition || undefined` so the
   *  true→undefined transition auto-collapses once, then hands toggling
   *  back to the visitor. */
  open?: boolean;
  className?: string;
  summaryClassName?: string;
  bodyClassName?: string;
  /** data-* identity hooks spread onto the <details> root (the tool
   *  row's data-tf-tool-call-id). Undefined for every other consumer —
   *  zero DOM change where unused. */
  rootDataAttributes?: Record<`data-${string}`, string>;
}

interface DisclosureVisualState {
  open: boolean;
  summaryActive: boolean;
}

const DisclosureVisualStateContext =
  createContext<DisclosureVisualState | null>(null);

/** The disclosure's DOM-backed visual state, for summary content that
 *  renders differently open vs closed (the fold headline's collapsed
 *  step label — the same mirror the chevron rotates on). Only readable
 *  INSIDE the summary: the provider deliberately wraps the summary
 *  children alone, and the read is the DOM's `open` (see the nativeOpen
 *  comment below), never the prop — a visitor can collapse a force-opened
 *  details while the prop still reads true. Null outside any Disclosure
 *  summary. */
export function useDisclosureVisualState(): DisclosureVisualState | null {
  return useContext(DisclosureVisualStateContext);
}

export function Disclosure({
  summary,
  children,
  variant = "framed",
  open,
  className,
  summaryClassName,
  bodyClassName,
  rootDataAttributes,
}: DisclosureProps) {
  // The package cannot rely on a consuming application's Tailwind scan to
  // emit selectors for arbitrary parent states such as
  // `[summary:hover_&]` or `[[open]>summary_&]`. Keep the native details as
  // the source of truth, mirror only the two visual facts the chevron
  // needs, and hand them to the summary's affordance through context.
  // This makes the behavior identical in the package fixture and in a host
  // that consumes only the built JavaScript.
  const [nativeOpen, setNativeOpen] = useState(open === true);
  const [summaryActive, setSummaryActive] = useState(false);

  return (
    // No `group` class here on purpose: a group variant on a nestable
    // disclosure matches ANY open ancestor (see DisclosureChevron below),
    // so the hook stays unwired rather than inviting the next consumer
    // to re-create the nested-chevron bug. Anchor on [open]>summary.
    <details
      {...rootDataAttributes}
      open={open}
      onToggle={(event) => {
        setNativeOpen(event.currentTarget.open);
      }}
      className={cx(
        variant === "framed" && "tf:rounded-tf tf:border",
        className,
      )}
    >
      <summary
        onMouseEnter={() => {
          setSummaryActive(true);
        }}
        onMouseLeave={() => {
          setSummaryActive(false);
        }}
        onFocus={() => {
          setSummaryActive(true);
        }}
        onBlur={() => {
          setSummaryActive(false);
        }}
        className={cx(
          "tf:cursor-pointer tf:list-none tf:select-none tf:[&::-webkit-details-marker]:hidden",
          "tf:focus-visible:outline-2 tf:focus-visible:outline-offset-2 tf:focus-visible:outline-tf-ring",
          variant === "framed" &&
            "tf:flex tf:items-center tf:gap-2 tf:px-3 tf:py-1.5 tf:text-tf-label",
          summaryClassName,
        )}
      >
        <DisclosureVisualStateContext.Provider
          // nativeOpen ALONE, never `open === true || nativeOpen`: React
          // re-writes the open attribute only when the prop VALUE changes,
          // so after a visitor collapses a force-opened details the DOM is
          // closed while the prop still reads true — the [open]>summary
          // selector this mirror replaced always read the DOM, and so must
          // the mirror. nativeOpen is seeded from the prop at mount and a
          // later undefined→true flip lands through onToggle.
          value={{ open: nativeOpen, summaryActive }}
        >
          {summary}
        </DisclosureVisualStateContext.Provider>
      </summary>
      <div
        className={cx(
          variant === "framed" && "tf:border-t tf:px-3 tf:py-2",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </details>
  );
}

// Rotates when its OWN Disclosure is open. Not the group-open hook:
// every Tailwind group variant (named or not) compiles to an
// ancestor-matching selector, so inside a nested Disclosure — a tool
// row inside an open fold — the outer open details would keep an inner
// chevron rotated forever. The [open]>summary anchor can't leak across
// nesting levels, because a chevron's only <summary> ancestor is its
// own (a details' body is never inside another details' summary).
// The framed variant hides the native marker, so summaries that carry no
// other trailing affordance MUST place this — a markerless summary reads
// as an inert box, invisible as a control.
export function DisclosureChevron({
  revealOnInteraction = false,
}: {
  /** Keep quiet summaries free of permanent arrow furniture. Keyboard
   *  focus mirrors hover so the disclosure never loses its affordance
   *  for non-pointer navigation. */
  revealOnInteraction?: boolean;
} = {}) {
  const visualState = useContext(DisclosureVisualStateContext);
  const isOpen = visualState?.open === true;
  const visible =
    !revealOnInteraction || isOpen || visualState?.summaryActive === true;

  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      data-tf-disclosure-chevron=""
      data-tf-disclosure-chevron-visible={visible ? "" : undefined}
      data-tf-disclosure-chevron-open={isOpen ? "" : undefined}
      opacity={revealOnInteraction ? (visible ? 1 : 0) : 1}
      className={cx(
        "tf:size-3.5 tf:shrink-0 tf:text-tf-muted-foreground",
        isOpen ? "tf:rotate-90" : "tf:rotate-0",
        revealOnInteraction
          ? "tf:transition-[opacity,transform]"
          : "tf:transition-transform",
      )}
    >
      <path
        d="M6 4l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
