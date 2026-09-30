"use client";

// The conversation's subagent-count pill: a quiet outline pill on the
// composer's column whenever the thread's dispatch ledger has any rows,
// opening a floating roster on hover, focus, or tap. The roster is a
// read of the ledger the transcript already polls — opening it fetches
// nothing and never opens a child stream. Hovering, focusing, or tapping
// a roster row opens that child's compact transcript preview beside the
// roster; the conversation itself stays in place.
//
// The card is the pill wrapper's LAST child: the package ships no
// z-index, so among positioned boxes document order is the paint order
// (the companion-header-disclosure law), and a card mounted after the
// pill paints over the transcript's own positioned bubbles.

import { activityTitleOf } from "../core/activity-title.js";
import { ChevronRightIcon } from "lucide-react";
import { useRef, type ReactNode, type RefObject } from "react";

import {
  dispatchFailed,
  dispatchIsRunning,
  type ThreadDispatch,
} from "../contract/dispatches.js";
import { subagentIdentityTokenOf } from "../core/agent-identity.js";
import { coworkerIndicesOf } from "../core/subagent-presence.js";
import {
  rosterEntriesOf,
  settledDurationLabelOf,
  subagentPillLabelOf,
  subagentRosterOf,
  type RosterStatusPredicates,
  type SubagentRoster,
  type SubagentRosterEntry,
} from "../core/subagent-roster.js";
import { AgentIdentityMark } from "./agent-identity-mark.js";
import { ShimmerText } from "./streaming-states.js";
import { ChildTranscriptPreview } from "./child-transcript.js";
import { TfButton } from "./primitives/button.js";
import { SubagentPreviewPopover } from "./subagent-preview-popover.js";
import {
  useFloatingDismiss,
  useRosterDisclosure,
} from "./use-roster-disclosure.js";
import {
  usePreviewChoreography,
  usePreviewEscape,
} from "./use-roster-preview.js";

const _ROSTER_PREDICATES: RosterStatusPredicates<ThreadDispatch> = {
  isRunning: dispatchIsRunning,
  hasFailed: dispatchFailed,
};

export function SubagentCountPill({
  dispatches,
  threadId,
  renderPreview,
}: {
  // Keyed by ORDINAL: the ask's identity — a resume chain shares one
  // child_session_id, so a session-keyed map would collapse it. The
  // pill only iterates values; the roster keys per ask itself.
  dispatches: ReadonlyMap<number, ThreadDispatch>;
  threadId?: string;
  /** Deterministic preview seam for the package screenshot fixture. */
  renderPreview?: (entry: SubagentRosterEntry) => ReactNode;
}) {
  const {
    open,
    rosterId,
    triggerRef,
    wrapperRef,
    onWrapperPointerEnter,
    onWrapperPointerLeave,
    onWrapperBlur,
    onTriggerPointerDown,
    onTriggerPointerCancel,
    onTriggerFocus,
    onTriggerClick,
    onTriggerKeyDown,
    close,
    refocusTrigger,
  } = useRosterDisclosure();

  const roster = subagentRosterOf(
    rosterEntriesOf(dispatches.values(), _ROSTER_PREDICATES),
  );
  const label = subagentPillLabelOf(roster);
  if (label === null) {
    // No subagents, no pill — the control exists only once the
    // conversation has delegated.
    return null;
  }
  // The deterministic color variants (law 10): a pure read of the same
  // ledger the roster is, so the same coworker wears the same color
  // here, on the inline group row, and in the child preview.
  const variantIndices = coworkerIndicesOf(dispatches.values());

  return (
    // The pill is the interactive boundary inside the composer's
    // pointer-pass-through overlay. It paints as one compact floating
    // object; there is no in-flow activity row behind it.
    <div
      ref={wrapperRef}
      data-tf-subagent-pill=""
      data-tf-shelf-item=""
      className="tf:pointer-events-auto tf:relative tf:w-fit"
      onPointerEnter={onWrapperPointerEnter}
      onPointerLeave={onWrapperPointerLeave}
      onBlur={onWrapperBlur}
    >
      <TfButton
        ref={triggerRef}
        data-tf-glass=""
        variant="outline"
        className="tf:min-h-11 tf:px-3 tf:md:px-2.5"
        aria-label={`Subagents: ${label}`}
        aria-expanded={open}
        aria-controls={open ? rosterId : undefined}
        onPointerDown={onTriggerPointerDown}
        onPointerCancel={onTriggerPointerCancel}
        onFocus={onTriggerFocus}
        onClick={onTriggerClick}
        onKeyDown={onTriggerKeyDown}
      >
        {/* The TeaFlask mark in the subagent register (law 10): the pill
            speaks for the coworkers, never for a provider or a generic
            bot. No numeral — the pill is the aggregate. */}
        <AgentIdentityMark
          register="subagent"
          size="md"
          className="tf:text-tf-muted-foreground"
        />
        {/* Two independent facts: the label's shimmer says work is live
            (the one motion register — no pulsing dot doubles it), the
            destructive dot says a coworker is already lost — a live
            fan-out with a failure shows both, so the loss never hides for
            exactly the window someone is watching the pill. */}
        {roster.failed.length > 0 ? (
          <span
            aria-hidden
            className="tf:size-1.5 tf:shrink-0 tf:rounded-full tf:bg-tf-destructive"
          />
        ) : null}
        {roster.running.length > 0 ? (
          // The muted live-work ink on purpose: every moving label wears
          // it, and the button's foreground base would leave the
          // highlight band no headroom in dark.
          <ShimmerText className="tf:text-tf-muted-foreground">
            {label}
          </ShimmerText>
        ) : (
          label
        )}
      </TfButton>
      {open ? (
        <SubagentRosterCard
          id={rosterId}
          roster={roster}
          variantIndices={variantIndices}
          threadId={threadId}
          renderPreview={renderPreview}
          triggerRef={triggerRef}
          onClose={close}
          refocusTrigger={refocusTrigger}
        />
      ) : null}
    </div>
  );
}

/** The floating roster: grouped by outcome, capped and scrolled. Mounted
 *  only while open — unmounting is the close, no state survives. Its
 *  rows open the adjacent transcript preview when a thread id is known;
 *  the card itself stays focusable so a click on its passive ink keeps
 *  focus within the pair instead of dropping it to body. */
function SubagentRosterCard({
  id,
  roster,
  variantIndices,
  threadId,
  renderPreview,
  triggerRef,
  onClose,
  refocusTrigger,
}: {
  id: string;
  roster: SubagentRoster;
  variantIndices: ReadonlyMap<string, number>;
  threadId?: string;
  renderPreview?: (entry: SubagentRosterEntry) => ReactNode;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  refocusTrigger: () => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const floatingRef = useRef<HTMLDivElement | null>(null);
  const {
    previewKey,
    setPreviewKey,
    previewRef,
    previewOpenerRef,
    mutePreviewFocusOpenRef,
    onPreviewChange,
    onPreviewOpener,
    onPreviewFocus,
    focusPreview,
  } = usePreviewChoreography();

  useFloatingDismiss(floatingRef, triggerRef, onClose);

  // Group headers earn their ink only when there is more than one bucket
  // to tell apart — a single-bucket roster is just its rows.
  const buckets = [
    { title: "Running", entries: roster.running },
    { title: "Completed", entries: roster.completed },
    { title: "Failed", entries: roster.failed },
  ].filter((bucket) => bucket.entries.length > 0);
  const withHeaders = buckets.length > 1;

  const previewEntry =
    previewKey === null
      ? null
      : (buckets
          .flatMap((bucket) => bucket.entries)
          .find((entry) => entry.key === previewKey) ?? null);

  usePreviewEscape({
    floatingRef,
    previewRef,
    previewOpenerRef,
    mutePreviewFocusOpenRef,
    previewKey,
    setPreviewKey,
    onClose,
    refocusTrigger,
  });

  return (
    // The pb-2 lives on the positioner, not a margin on the card, so the
    // pointer's travel from pill to card never leaves the hover surface.
    <div
      ref={floatingRef}
      // The conversation reads this flag to throw every sibling except
      // the pill/menu pair out of focus. Unlike a header disclosure, the
      // roster lives inside the conversation it obscures, so it needs a
      // dedicated hook rather than data-tf-disclosure's sibling law.
      data-tf-subagent-disclosure=""
      className="tf:absolute tf:bottom-full tf:start-1/2 tf:-translate-x-1/2 tf:pb-2"
    >
      <div
        ref={cardRef}
        id={id}
        role="dialog"
        aria-label="Subagents"
        // Focusable on purpose (the dashboard twin gets this from Radix's
        // FocusScope): a click or tap on passive card ink moves focus HERE
        // instead of dropping it to body, so the wrapper's blur guard sees
        // focus staying inside the pair and the roster survives being read.
        tabIndex={-1}
        // The sanctioned floating material (the header-disclosure and
        // provider-chip menus' register): styles.css supplies the fill
        // and shadow — an opaque no-glass baseline everywhere, the
        // liquid-glass coat on the glass hosts.
        data-tf-glass=""
        className="tf:flex tf:w-72 tf:flex-col tf:overflow-hidden tf:rounded-2xl tf:border tf:focus-visible:outline-2 tf:focus-visible:outline-offset-2 tf:focus-visible:outline-tf-ring"
      >
        <RosterBucketList
          buckets={buckets}
          withHeaders={withHeaders}
          variantIndices={variantIndices}
          previewable={threadId !== undefined || renderPreview !== undefined}
          previewKey={previewKey}
          previewId={`${id}-preview`}
          onPreviewChange={onPreviewChange}
          onPreviewOpener={onPreviewOpener}
          onPreviewFocus={onPreviewFocus}
          focusPreview={focusPreview}
        />
      </div>
      {previewEntry !== null &&
      (threadId !== undefined || renderPreview !== undefined) ? (
        <RosterPreview
          key={previewEntry.key}
          entry={previewEntry}
          id={id}
          anchorRef={cardRef}
          previewRef={previewRef}
          threadId={threadId}
          renderPreview={renderPreview}
          variantIndices={variantIndices}
        />
      ) : null}
    </div>
  );
}

/** The adjacent transcript preview for the row under the pointer or
 *  focus — the host's deterministic renderer when it supplies one, the
 *  child's own transcript otherwise. */
function RosterPreview({
  entry,
  id,
  anchorRef,
  previewRef,
  threadId,
  renderPreview,
  variantIndices,
}: {
  entry: SubagentRosterEntry;
  id: string;
  anchorRef: RefObject<HTMLDivElement | null>;
  previewRef: RefObject<HTMLDivElement | null>;
  threadId?: string;
  renderPreview?: (entry: SubagentRosterEntry) => ReactNode;
  variantIndices: ReadonlyMap<string, number>;
}) {
  return (
    <SubagentPreviewPopover
      key={entry.key}
      id={`${id}-preview`}
      anchorRef={anchorRef}
      previewRef={previewRef}
      label={entry.label}
    >
      {renderPreview !== undefined ? (
        renderPreview(entry)
      ) : threadId !== undefined ? (
        <ChildTranscriptPreview
          key={entry.key}
          threadId={threadId}
          childSessionId={entry.childSessionId}
          variantIndex={variantIndices.get(entry.childSessionId)}
        />
      ) : null}
    </SubagentPreviewPopover>
  );
}

/** The card's scrolled list: one bucket per outcome, headed only when
 *  there is more than one, each row a roster line. */
function RosterBucketList({
  buckets,
  withHeaders,
  variantIndices,
  previewable,
  previewKey,
  previewId,
  onPreviewChange,
  onPreviewOpener,
  onPreviewFocus,
  focusPreview,
}: {
  buckets: readonly {
    title: string;
    entries: readonly SubagentRosterEntry[];
  }[];
  withHeaders: boolean;
  variantIndices: ReadonlyMap<string, number>;
  previewable: boolean;
  previewKey: string | null;
  previewId: string;
  onPreviewChange: (key: string, open: boolean) => void;
  onPreviewOpener: (opener: HTMLButtonElement) => void;
  onPreviewFocus: (key: string, opener: HTMLButtonElement) => void;
  focusPreview: () => void;
}) {
  return (
    <ul className="tf:m-0 tf:flex tf:max-h-64 tf:list-none tf:flex-col tf:overflow-y-auto tf:p-2 tf:ps-2">
      {buckets.map((bucket) => (
        <li key={bucket.title} className="tf:flex tf:flex-col">
          {withHeaders ? (
            <p className="tf:m-0 tf:px-2 tf:pt-1.5 tf:pb-0.5 tf:text-xs tf:font-medium tf:text-tf-muted-foreground">
              {bucket.title}
            </p>
          ) : null}
          <ul className="tf:m-0 tf:flex tf:list-none tf:flex-col tf:ps-0">
            {bucket.entries.map((entry) => (
              <SubagentRosterLine
                key={entry.key}
                entry={entry}
                variantIndex={variantIndices.get(entry.childSessionId)}
                previewable={previewable}
                previewOpen={previewKey === entry.key}
                onPreviewChange={(nextOpen) => {
                  onPreviewChange(entry.key, nextOpen);
                }}
                onPreviewOpener={onPreviewOpener}
                onPreviewFocus={(opener) => {
                  onPreviewFocus(entry.key, opener);
                }}
                focusPreview={focusPreview}
                previewId={previewId}
              />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function SubagentRosterLine({
  entry,
  variantIndex,
  previewable,
  previewOpen,
  onPreviewChange,
  onPreviewOpener,
  onPreviewFocus,
  focusPreview,
  previewId,
}: {
  entry: SubagentRosterEntry;
  variantIndex?: number;
  previewable: boolean;
  previewOpen: boolean;
  onPreviewChange: (open: boolean) => void;
  onPreviewOpener: (opener: HTMLButtonElement) => void;
  onPreviewFocus: (opener: HTMLButtonElement) => void;
  focusPreview: () => void;
  previewId: string;
}) {
  // Pure server math (the roster law): a settled row reads its recorded
  // span in the COMPACT register ("3m 04s", "<1s" — settledDurationLabelOf,
  // on the house ladder, TVC-073) because the visible status word beside it
  // already owns the verb; "Finished · Worked for 3m 04s" would say it
  // twice. The sentence register ("Worked for …") belongs to the standalone
  // metadata lines (fold headlines, the inline group row). A running row
  // shows no clock — live ticking is the dashboard's ElapsedTime concern,
  // never this surface's. Null disappears cleanly.
  const workedLabel = settledDurationLabelOf(entry.startedAt, entry.settledAt);
  const statusWord = entry.running
    ? "Working"
    : entry.failed
      ? "Failed"
      : "Finished";
  const line = (
    <RosterLineBody
      entry={entry}
      variantIndex={variantIndex}
      previewable={previewable}
      previewOpen={previewOpen}
      workedLabel={workedLabel}
      statusWord={statusWord}
    />
  );
  if (!previewable) {
    // No thread id on this host: the row stays passive ink.
    return (
      <li className="tf:flex tf:flex-col tf:gap-0.5 tf:text-tf-label tf:text-tf-foreground">
        <span className="tf:flex tf:items-center tf:px-2 tf:py-1.5">
          {line}
        </span>
      </li>
    );
  }
  return (
    <li className="tf:flex tf:flex-col tf:gap-0.5 tf:text-tf-label tf:text-tf-foreground">
      {/* The row is the affordance: hovering, focusing, or tapping a
          coworker opens its adjacent transcript preview. bare, not the rail's `row` register —
          the roster stays on its own 13px foreground ink (the 13/15
          ladder), and the hover plate is the row's own (the sibling
          subagent-group-row's posture). */}
      <TfButton
        variant="bare"
        aria-haspopup="dialog"
        aria-expanded={previewOpen}
        aria-controls={previewOpen ? previewId : undefined}
        // The explicit name: the row's contents include the identity
        // mark's sr-only "Subagent N", so a content-derived name would
        // open with a bare identity word glued to the label — the same
        // leak the fork's group trigger shipped. The label is composed
        // deliberately from the row's own facts instead; contents stay in
        // the tree for browse mode. The final part mirrors the
        // failure-note render condition below exactly: a label that masks
        // contents must re-speak everything the row says. Successful
        // result summaries deliberately stay out of the roster; the
        // adjacent transcript preview is their detail home.
        aria-label={[
          variantIndex !== undefined
            ? `Subagent ${String(variantIndex)}`
            : null,
          entry.label,
          workedLabel !== null ? `${statusWord} · ${workedLabel}` : statusWord,
          entry.failed ? entry.note : null,
        ]
          .filter((part): part is string => part !== null)
          .join(" — ")}
        className="tf:group/subagent tf:min-h-11 tf:w-full tf:justify-start tf:px-2 tf:py-1.5 tf:hover:bg-tf-accent"
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") {
            onPreviewOpener(event.currentTarget);
            onPreviewChange(true);
          }
        }}
        onFocus={(event) => {
          onPreviewFocus(event.currentTarget);
        }}
        onClick={(event) => {
          onPreviewOpener(event.currentTarget);
          onPreviewChange(true);
        }}
        onKeyDown={(event) => {
          if (!previewOpen || event.key !== "ArrowRight") {
            return;
          }
          event.preventDefault();
          focusPreview();
        }}
      >
        {line}
      </TfButton>
    </li>
  );
}

/** One roster row's ink: the identity mark with its failure badge beside
 *  the label column — label and chevron, the status word with the settled
 *  span, and a failed row's reason. */
function RosterLineBody({
  entry,
  variantIndex,
  previewable,
  previewOpen,
  workedLabel,
  statusWord,
}: {
  entry: SubagentRosterEntry;
  variantIndex?: number;
  previewable: boolean;
  previewOpen: boolean;
  workedLabel: string | null;
  statusWord: string;
}) {
  return (
    // items-start, not items-center: the row grew from one line to two or
    // three, and centering the fixed-size identity mark and chevron
    // against the whole STACK slid them off the label they belong to — the
    // same cross-axis shape the inline row solved. The mark and the
    // min-h-6 label row are equal-height boxes at the stack's top, so
    // their centers coincide exactly; the chevron rides INSIDE the label
    // row for the same reason.
    <span className="tf:flex tf:w-full tf:items-start tf:gap-2">
      {/* The coworker's identity mark (law 10, TVC-091): the mark
          carries the SAME token the inline group row wears — one
          coworker, one token, every surface — and the TeaFlask mark's
          deterministic color is the visible half. */}
      <span
        data-tf-subagent-identity={subagentIdentityTokenOf(
          entry.childSessionId,
        )}
        className="tf:relative tf:flex tf:h-6 tf:min-w-6 tf:shrink-0 tf:items-center tf:justify-center tf:px-1"
      >
        <AgentIdentityMark register="subagent" variantIndex={variantIndex} />
        {/* Liveness is the status word's shimmer below (the one
            motion register) — only the loss keeps a badge. */}
        {entry.failed ? (
          <span
            aria-hidden
            className="tf:absolute tf:-end-0.5 tf:-bottom-0.5 tf:size-2 tf:rounded-full tf:border tf:border-tf-background tf:bg-tf-destructive"
          />
        ) : null}
      </span>
      <span className="tf:flex tf:min-w-0 tf:flex-1 tf:flex-col tf:items-start tf:gap-0.5">
        <span className="tf:flex tf:min-h-6 tf:w-full tf:min-w-0 tf:items-center tf:gap-2">
          <span
            data-tf-subagent-label=""
            className="tf:min-w-0 tf:flex-1 tf:truncate tf:text-start"
            title={entry.label}
          >
            {activityTitleOf(entry.label)}
          </span>
          {previewable ? (
            <ChevronRightIcon
              aria-hidden
              className={
                previewOpen
                  ? "tf:size-4 tf:shrink-0 tf:text-tf-muted-foreground tf:opacity-100 tf:transition-opacity"
                  : "tf:size-4 tf:shrink-0 tf:text-tf-muted-foreground tf:opacity-0 tf:transition-opacity tf:group-hover/subagent:opacity-100 tf:group-focus-visible/subagent:opacity-100 tf:pointer-coarse:opacity-100"
              }
            />
          ) : null}
        </span>
        {/* Explicit status in words (never the dot alone), with the
            settled span beside it when the ledger measured one. */}
        <span className="tf:flex tf:w-full tf:min-w-0 tf:items-baseline tf:gap-1.5 tf:text-xs tf:text-tf-muted-foreground">
          <span
            data-tf-subagent-status=""
            className={entry.failed ? "tf:text-tf-destructive" : undefined}
          >
            {/* The live row's motion (the flask badge's replacement):
                the word itself shimmers, already on the muted line. */}
            {entry.running ? (
              <ShimmerText>{statusWord}</ShimmerText>
            ) : (
              statusWord
            )}
          </span>
          {workedLabel !== null ? (
            <span data-tf-subagent-worked="" className="tf:truncate">
              {`· ${workedLabel}`}
            </span>
          ) : null}
        </span>
        {/* A failed row carries its reason: the metadata stack
            gave succeeded rows their summary, and the loss must not be
            the one row that cannot explain itself — the roster is where
            an earlier turn's failed coworker stays reachable. The ledger
            error, or rosterEntriesOf's minted fallback sentence. */}
        {entry.failed && entry.note !== null ? (
          <span
            data-tf-subagent-note=""
            className="tf:w-full tf:min-w-0 tf:truncate tf:text-start tf:text-xs tf:text-tf-muted-foreground"
            title={entry.note}
          >
            {entry.note}
          </span>
        ) : null}
      </span>
    </span>
  );
}
