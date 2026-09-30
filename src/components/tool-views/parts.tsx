"use client";

// The React spelling of the tool-view vocabulary (parts-classes.ts) for
// host-authored views: a card, list rows, property rows, a caption, a
// body region, a scrolling region, a badge, notes, and skeleton lines. A host composes these
// and gets the package's look for free — the same classes the built-ins
// paint with, so ours and theirs are one system.

import type { ReactNode } from "react";

import {
  BADGE_CLASS,
  BODY_REGION_CLASS,
  BONES_CLASS,
  BONE_CLASS,
  CAPTION_ROW_CLASS,
  CARD_CLASS,
  CARD_TITLE_CLASS,
  FACT_LABEL_CLASS,
  FACT_LIST_CLASS,
  FACT_ROW_CLASS,
  FACT_VALUE_CLASS,
  NOTE_CLASS,
  ROW_CLASS,
  ROW_ICON_CLASS,
  ROW_LINK_CLASS,
  ROW_SECONDARY_CLASS,
  ROW_TEXT_CLASS,
  ROW_TITLE_CLASS,
  ROW_TRAIL_CLASS,
  SCROLL_REGION_CLASS,
} from "./parts-classes.js";

/** The small label over a card — or over a skeleton, which draws no card. */
export function ToolViewTitle({ children }: { children: ReactNode }) {
  return <p className={CARD_TITLE_CLASS}>{children}</p>;
}

export function ToolViewCard({
  title,
  children,
  ...rest
}: {
  title?: string;
  children: ReactNode;
} & Record<`data-${string}`, string | number | undefined>) {
  return (
    <div {...rest}>
      {title !== undefined && <ToolViewTitle>{title}</ToolViewTitle>}
      <div className={CARD_CLASS} data-tf-tool-view-card="">
        {children}
      </div>
    </div>
  );
}

export function ToolViewRow({
  icon,
  title,
  secondary,
  trailing,
  href,
  ...rest
}: {
  icon?: ReactNode;
  title: ReactNode;
  secondary?: ReactNode;
  trailing?: ReactNode;
  /** A plain anchor: a view lives in its own React root, outside any
   *  host router, so a row that navigates is a full navigation. */
  href?: string;
} & Record<`data-${string}`, string | number | undefined>) {
  const content = (
    <>
      {icon !== undefined && <span className={ROW_ICON_CLASS}>{icon}</span>}
      <span className={ROW_TEXT_CLASS}>
        <span className={ROW_TITLE_CLASS}>{title}</span>
        {secondary !== undefined && secondary !== null && (
          <span className={ROW_SECONDARY_CLASS}>{secondary}</span>
        )}
      </span>
      {trailing !== undefined && trailing !== null && (
        <span className={ROW_TRAIL_CLASS}>{trailing}</span>
      )}
    </>
  );
  return href === undefined ? (
    <div className={ROW_CLASS} {...rest}>
      {content}
    </div>
  ) : (
    <a href={href} className={`${ROW_CLASS} ${ROW_LINK_CLASS}`} {...rest}>
      {content}
    </a>
  );
}

export function ToolViewFacts({
  facts,
  ...rest
}: {
  facts: readonly { label: string; value: ReactNode }[];
} & Record<`data-${string}`, string | number | undefined>) {
  return (
    <dl className={FACT_LIST_CLASS} {...rest}>
      {/* Positional on purpose: the list is the API's own order, and two
          problems may name one field (or none) — labels are not keys. */}
      {facts.map((fact, index) => (
        <div key={index} className={FACT_ROW_CLASS}>
          <dt className={FACT_LABEL_CLASS}>{fact.label}</dt>
          <dd className={FACT_VALUE_CLASS}>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ToolViewCaption({
  children,
  trailing,
  ...rest
}: {
  children: ReactNode;
  trailing?: ReactNode;
} & Record<`data-${string}`, string | number | undefined>) {
  return (
    <div className={CAPTION_ROW_CLASS} {...rest}>
      <span className="tf:min-w-0">{children}</span>
      {trailing !== undefined && trailing !== null && (
        <span className="tf:shrink-0">{trailing}</span>
      )}
    </div>
  );
}

export function ToolViewBody({
  label,
  children,
  ...rest
}: {
  label: string;
  children: ReactNode;
} & Record<`data-${string}`, string | number | undefined>) {
  return (
    <section aria-label={label} className={BODY_REGION_CLASS} {...rest}>
      {children}
    </section>
  );
}

/** A bounded, scrolling region for a long list inside a card. */
export function ToolViewScroll({
  children,
  ...rest
}: { children: ReactNode } & Record<
  `data-${string}`,
  string | number | undefined
>) {
  return (
    <div className={SCROLL_REGION_CLASS} data-tf-scroll-region="" {...rest}>
      {children}
    </div>
  );
}

export function ToolViewBadge({
  children,
  ...rest
}: { children: ReactNode } & Record<
  `data-${string}`,
  string | number | undefined
>) {
  return (
    <span className={BADGE_CLASS} {...rest}>
      {children}
    </span>
  );
}

/** One quiet sentence in the muted register — for what is absent,
 *  degraded, or not renderable, never for invented structure. */
export function ToolViewNote({
  children,
  ...rest
}: { children: ReactNode } & Record<
  `data-${string}`,
  string | number | undefined
>) {
  return (
    <p className={NOTE_CLASS} {...rest}>
      {children}
    </p>
  );
}

/** Skeleton lines where the result will land — pending is a shape. */
export function ToolViewBones({
  lines = 3,
  ...rest
}: { lines?: number } & Record<`data-${string}`, string | number | undefined>) {
  return (
    <div className={BONES_CLASS} aria-hidden {...rest}>
      {Array.from({ length: lines }, (_, index) => (
        <span
          key={index}
          className={`${BONE_CLASS} ${index === 0 ? "tf:w-1/2" : "tf:w-full"}`}
        />
      ))}
    </div>
  );
}
