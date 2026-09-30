// The one visual vocabulary every tool view speaks — the package's own
// built-ins (vanilla, view-dom.ts) and host views (React, parts.tsx) share
// these strings, so a customer's view and ours read as one system: a
// hairline card at rest, dense list rows with a title line and a muted
// second line, a trailing badge, property rows, a quiet caption, a
// scrolling body region. Graphite: 13px labels, hairline borders, no
// shadow, and a compact vertical rhythm — 6px row padding, 24px tiles.

export const CARD_CLASS =
  "tf:overflow-hidden tf:rounded-lg tf:border tf:border-tf-border tf:bg-tf-card";

export const CARD_TITLE_CLASS =
  "tf:mb-1 tf:text-tf-label tf:font-medium tf:text-tf-foreground";

export const ROW_CLASS =
  "tf:flex tf:min-w-0 tf:items-center tf:gap-2.5 tf:border-t tf:border-tf-border tf:px-2.5 tf:py-1.5 tf:first:border-t-0";

export const ROW_LINK_CLASS = "tf:no-underline tf:hover:bg-tf-accent";

export const ROW_ICON_CLASS =
  "tf:flex tf:size-6 tf:shrink-0 tf:items-center tf:justify-center tf:rounded-[5px] tf:bg-tf-muted tf:text-tf-muted-foreground";

export const ROW_TEXT_CLASS =
  "tf:flex tf:min-w-0 tf:flex-1 tf:flex-col tf:leading-[1.35]";

export const ROW_TITLE_CLASS =
  "tf:truncate tf:text-tf-label tf:font-medium tf:text-tf-foreground";

export const ROW_SECONDARY_CLASS =
  "tf:truncate tf:text-xs tf:text-tf-muted-foreground";

export const ROW_TRAIL_CLASS =
  "tf:ms-auto tf:flex tf:shrink-0 tf:items-center tf:gap-2";

export const BADGE_CLASS =
  "tf:inline-flex tf:shrink-0 tf:items-center tf:rounded-[3px] tf:border tf:border-tf-border tf:px-1.5 tf:py-px tf:text-[11px] tf:leading-4 tf:font-medium tf:text-tf-foreground";

/** The property-row list: a hairline above it when it follows a caption
 *  or a row, none when it opens the card — the rows' own first-child rule,
 *  applied to their container. */
export const FACT_LIST_CLASS =
  "tf:m-0 tf:border-t tf:border-tf-border tf:first:border-t-0";

export const FACT_ROW_CLASS =
  "tf:grid tf:grid-cols-[minmax(6rem,30%)_minmax(0,1fr)] tf:gap-x-3 tf:border-t tf:border-tf-border tf:px-2.5 tf:py-1.5 tf:first:border-t-0";

export const FACT_LABEL_CLASS =
  "tf:min-w-0 tf:text-xs tf:text-tf-muted-foreground tf:wrap-anywhere";

export const FACT_VALUE_CLASS =
  "tf:m-0 tf:min-w-0 tf:text-xs tf:text-tf-foreground tf:wrap-anywhere";

export const CAPTION_ROW_CLASS =
  "tf:flex tf:items-center tf:justify-between tf:gap-3 tf:border-t tf:border-tf-border tf:px-2.5 tf:py-1.5 tf:text-xs tf:text-tf-muted-foreground tf:first:border-t-0";

/** A block child of a card that is not a row — a pretty-printed value,
 *  an inset pane, a body: the same hairline above (none when it opens
 *  the card) and the same inset the rows keep. */
export const CARD_BLOCK_CLASS =
  "tf:border-t tf:border-tf-border tf:px-2.5 tf:py-2 tf:first:border-t-0";

export const BODY_REGION_CLASS = `tf:max-h-72 tf:overflow-auto ${CARD_BLOCK_CLASS}`;

export const NOTE_CLASS = "tf:text-xs tf:text-tf-muted-foreground";

/** Skeleton lines where the result will land: the first a half-width
 *  title, the rest full-width text — pending is a shape, not a sentence,
 *  and it draws no edges: no card, no border, the lines alone. */
export const BONES_CLASS = "tf:flex tf:flex-col tf:gap-2 tf:py-1";

export const BONE_CLASS =
  "tf:h-2.5 tf:animate-tf-pulse tf:rounded tf:bg-tf-muted";

/** A label over a pane: the one label-to-pane rhythm (the pane carries
 *  no margin of its own, so a host's reset cannot collapse the gap). */
export const PANE_WRAPPER_CLASS = "tf:flex tf:flex-col tf:gap-1";

/** The mono pane for text that IS text (a command's output, a diff): on
 *  the muted ground inside a card, never a second border. */
export const PANE_CLASS =
  "tf:m-0 tf:max-h-60 tf:overflow-auto tf:rounded-md tf:bg-tf-muted tf:p-2 tf:text-xs tf:whitespace-pre-wrap tf:text-tf-foreground";

/** A command and what it printed, as one terminal block: the prompt line
 *  in the foreground, the streams beneath it in the muted register. */
export const TERMINAL_CLASS =
  "tf:m-0 tf:max-h-72 tf:overflow-auto tf:rounded-lg tf:border tf:border-tf-border tf:bg-tf-muted tf:px-3 tf:py-2.5 tf:font-mono tf:text-xs tf:leading-5 tf:whitespace-pre-wrap tf:wrap-anywhere tf:text-tf-foreground";

export const TERMINAL_PROMPT_CLASS =
  "tf:select-none tf:text-tf-muted-foreground";

export const TERMINAL_OUTPUT_CLASS =
  "tf:mt-1 tf:block tf:text-tf-muted-foreground";

export const TERMINAL_STDERR_CLASS =
  "tf:mt-1 tf:block tf:text-tf-muted-foreground tf:italic";

/** A long list or value inside a card scrolls in a bounded well instead
 *  of growing the transcript — a card child itself (hairline above unless
 *  first; its first child's own hairline yields), so one line per edge. */
export const SCROLL_REGION_CLASS =
  "tf:max-h-72 tf:overflow-auto tf:border-t tf:border-tf-border tf:first:border-t-0";

export const LABEL_CLASS =
  "tf:text-xs tf:font-medium tf:text-tf-muted-foreground";
