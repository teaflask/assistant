"use client";

// The transcript's delegation moment: one disclosure per run of dispatch
// calls, a row per coworker — wire receipts refined by the thread's
// dispatch ledger where the host provides it, so a child that outlives
// its turn reads settled instead of spinning on its frozen receipt. The
// ledger row outranks the wire wherever both speak; cancelled stays
// wire-only (the ledger has no cancelled status). A ledgered row is a
// button that opens the child's own transcript preview. The rows carry
// the drill-in-fed current-work line and the settled "Worked for …" span;
// dashboard-only facts (model badge, live elapsed) and the final summary
// stay off this surface — the child's full report is one drill-in away.

import { activityTitleOf } from "../core/activity-title.js";
import { ChevronRightIcon } from "lucide-react";
import { createContext, useContext } from "react";

import {
  dispatchFailed,
  dispatchIsPaused,
  dispatchIsRunning,
  type ThreadDispatch,
} from "../contract/dispatches.js";
import { subagentIdentityTokenOf } from "../core/agent-identity.js";
import {
  coworkerIndicesOf,
  settledWorkedLabelOf,
} from "../core/subagent-presence.js";
import {
  subagentGroupHeadlineOf,
  subagentOutcomeCountsOf,
  type SubagentGroupEntry,
  type SubagentGroupRow as SubagentGroupRowModel,
} from "../core/subagent-rows.js";
import type { CoworkerExecutionWork } from "../core/coworker-execution-work.js";
import {
  humanizedToolName,
  type ToolCallViewModel,
} from "../core/tool-call-display.js";
import { toolCallPresentationOf } from "../core/tool-call-presentation.js";
import { AgentIdentityMark } from "./agent-identity-mark.js";
import { StatePill } from "./operation-icons.js";
import { TfButton } from "./primitives/button.js";
import { Disclosure, DisclosureChevron } from "./primitives/disclosure.js";
import { ShimmerText } from "./streaming-states.js";
import { useSubagentCurrentWork } from "./subagent-current-work.js";
import { useSubagentDrillIn } from "./subagent-drill-in.js";
import { useSubagentExecutionWork } from "./subagent-execution-work.js";

/** The thread's ledger rows keyed by ORDINAL — the ask's identity.
 *  child_session_id is not unique (a resume chain shares the handle),
 *  so a session-keyed map would let the resume row overwrite the
 *  original and every receipt after it render the wrong ask; the
 *  ordinal is unique within the thread's one parent_run_id namespace
 *  and rides the wire receipt itself (clipped receipts included). The
 *  empty default keeps a host without the read rendering honest
 *  receipt-only groups. */
export interface SubagentDispatchesJoin {
  byOrdinal: ReadonlyMap<number, ThreadDispatch>;
}

const EMPTY_SUBAGENT_DISPATCHES: SubagentDispatchesJoin = {
  byOrdinal: new Map(),
};

export const SubagentDispatchesContext = createContext<SubagentDispatchesJoin>(
  EMPTY_SUBAGENT_DISPATCHES,
);

export interface ResolvedSubagentEntry {
  toolCallId: string;
  label: string | null;
  running: boolean;
  failed: boolean;
  cancelled: boolean;
  note: string | null;
  /** The drill-in key: the receipt's child session id exactly when the
   *  ledger vouches for it — a receipt-only row has no provable family
   *  membership to stream by, so it stays null. */
  childSessionId: string | null;
  /** The coworker's identity token (law 10, TVC-091) — derived from the
   *  vouched child session, so an unvouched row wears no mark (typed
   *  evidence, never synthesis), and the roster's mark for the same
   *  coworker is the identical token. */
  identityToken: string | null;
  /** The ask's identity — the receipt's ordinal, the browser-work join
   *  key; null on a receiptless row. */
  ordinal: number | null;
  /** The ledger says the coworker is paused for an answer only the
   *  member's browser can give. */
  paused: boolean;
  /** The ledger row's timestamps — null on receipt-only rows (the wire
   *  receipt carries no timing), and settledAt null while running. */
  startedAt: string | null;
  settledAt: string | null;
}

/** One entry's truth: the ledger row outranks the wire receipt wherever
 *  both speak (the dashboard row's resolve, with the vouched child
 *  session id in place of its ledger handle). */
export function resolvedSubagentEntryOf(
  entry: SubagentGroupEntry,
  byOrdinal: ReadonlyMap<number, ThreadDispatch>,
): ResolvedSubagentEntry {
  // Ordinal, not child session id: a resume chain shares one handle
  // across rows, and each receipt must stay bound to the ask that
  // launched it.
  const ledger =
    entry.receipt != null ? byOrdinal.get(entry.receipt.ordinal) : undefined;
  // An empty ledger label must not blank a good wire label.
  const ledgerLabel =
    ledger !== undefined && ledger.label !== "" ? ledger.label : null;
  const childSessionId =
    ledger !== undefined && entry.receipt?.childSessionId != null
      ? entry.receipt.childSessionId
      : null;
  const running =
    ledger !== undefined ? dispatchIsRunning(ledger) : entry.running;
  const failed = ledger !== undefined ? dispatchFailed(ledger) : entry.failed;
  return {
    toolCallId: entry.toolCallId,
    label: ledgerLabel ?? entry.label,
    running,
    failed,
    // Cancellation is a wire fact (a cancelled tool call); the ledger
    // never speaks it and must not override it.
    cancelled: entry.cancelled,
    note:
      (ledger !== undefined && dispatchFailed(ledger) ? ledger.error : null) ??
      entry.note,
    childSessionId,
    identityToken:
      childSessionId !== null ? subagentIdentityTokenOf(childSessionId) : null,
    ordinal: entry.receipt?.ordinal ?? null,
    paused: ledger !== undefined && dispatchIsPaused(ledger),
    startedAt: ledger !== undefined ? ledger.created_at : null,
    settledAt: ledger !== undefined && !running ? ledger.updated_at : null,
  };
}

export function SubagentGroupRow({ row }: { row: SubagentGroupRowModel }) {
  const join = useContext(SubagentDispatchesContext);
  const resolved = row.entries.map((entry) =>
    resolvedSubagentEntryOf(entry, join.byOrdinal),
  );
  const counts = subagentOutcomeCountsOf(resolved);
  // The deterministic color variants (law 10) — the same pure ledger
  // read the roster makes, so one coworker wears one color on every
  // surface.
  const variantIndices = coworkerIndicesOf(join.byOrdinal.values());
  // The open drill-in stream's live-operation feed (TVC-072) — empty on
  // hosts without the delegation surface, and empty for every child
  // nobody is watching: the line below disappears cleanly.
  const currentWork = useSubagentCurrentWork();
  const executionWork = useSubagentExecutionWork();
  return (
    // The group hook (TVC-070): the wrapper's x-origin IS the group's —
    // the Disclosure inside adds no inline-start spacing of its own, so
    // the child entries' one-rail-level indent is measured against it.
    <div data-tf-subagent-group="" className="tf:relative tf:w-full">
      <Disclosure
        variant="bare"
        className="tf:my-1.5 tf:w-full"
        // The reasoning-row idiom: forced open while coworkers work, the
        // member's own toggle once everything settled.
        open={counts.running > 0 || undefined}
        summaryClassName="tf:flex tf:w-fit tf:items-center tf:gap-2 tf:py-1.5 tf:text-tf-label tf:text-tf-muted-foreground tf:hover:text-tf-foreground"
        // The tree nodes own their indentation: each line carries its
        // own trunk-and-elbow connectors, so the body stays flush.
        bodyClassName="tf:flex tf:flex-col tf:pt-1 tf:pb-2"
        summary={
          <>
            <span
              aria-hidden
              className="tf:relative tf:flex tf:size-6 tf:shrink-0 tf:items-center tf:justify-center"
            >
              <AgentIdentityMark register="subagent" size="md" />
              {/* Liveness is the headline's shimmer (the one motion
            register) — no pulsing badge doubles it. The failed dot is the
            other, independent fact and no longer hides while siblings still
            run: a live fan-out with a loss shows it immediately. */}
              {counts.failed > 0 ? (
                <span
                  aria-hidden
                  className="tf:absolute tf:-end-0.5 tf:-bottom-0.5 tf:size-2 tf:rounded-full tf:border tf:border-tf-background tf:bg-tf-destructive"
                />
              ) : null}
            </span>

            {/* Live work moves its words (the fold headline's register):
                the shimmer IS the liveness claim, replacing the old
                pulsing badge on the mark. */}
            {counts.running > 0 ? (
              <ShimmerText>{subagentGroupHeadlineOf(counts)}</ShimmerText>
            ) : (
              <span>{subagentGroupHeadlineOf(counts)}</span>
            )}
            <DisclosureChevron revealOnInteraction />
          </>
        }
      >
        {/* No preflight ships with the widget: the UA's list padding,
          margin, and markers are reset right here. Deeper nesting later
          (today one generation renders): a child that fans out again
          nests another <ul> with these same node classes inside its
          <li> — the connectors compose per level. */}
        <ul className="tf:m-0 tf:flex tf:list-none tf:flex-col tf:ps-0">
          {resolved.map((entry, index) => (
            <CoworkerLine
              key={entry.toolCallId}
              entry={entry}
              variantIndex={
                entry.childSessionId !== null
                  ? variantIndices.get(entry.childSessionId)
                  : undefined
              }
              currentWorkView={
                entry.childSessionId !== null
                  ? currentWork.get(entry.childSessionId)
                  : undefined
              }
              coworkerWork={
                entry.ordinal !== null
                  ? executionWork.get(entry.ordinal)
                  : undefined
              }
              last={index === resolved.length - 1}
            />
          ))}
        </ul>
      </Disclosure>
    </div>
  );
}

function CoworkerLine({
  entry,
  variantIndex,
  currentWorkView,
  coworkerWork,
  last,
}: {
  entry: ResolvedSubagentEntry;
  variantIndex?: number;
  currentWorkView?: ToolCallViewModel;
  coworkerWork?: CoworkerExecutionWork;
  last: boolean;
}) {
  const drillIn = useSubagentDrillIn();
  // The drill-in address rides the resolved entry itself (childSessionId
  // is non-null exactly when the ledger vouches for the row).
  const drillInKey = entry.childSessionId;
  // The resolved note: a failed ledger row's error sentence, a settled
  // receipt's note, or a refused call's failure sentence — the row's
  // whole explanation on this surface.
  const note = entry.note;
  // Settled server math only (the roster's own law): the line renders
  // exactly when the ledger measured a span; a running child never ticks
  // here, and a receipt-only row (no timestamps) shows nothing.
  const workedLabel =
    entry.startedAt !== null
      ? settledWorkedLabelOf(entry.startedAt, entry.settledAt)
      : null;
  const EntrySurface =
    drillIn !== null && drillInKey !== null ? TfButton : "span";
  const drillable = drillIn !== null && drillInKey !== null;
  return (
    // ps-7 IS one rail level (TVC-070): the operations rail's measured
    // icon→label step — the size-4 mark plus the summary's gap-3 — which
    // is also the tool rows' own ps-7 body indent. The entry hook sits
    // on the content span below (the li's box origin is the group's;
    // its PADDING is the indent). The row's vertical padding rides the
    // entry surface, not the li, so the drill-in's hover plate covers
    // the whole row and its radius never bites the leading mark.
    <li className="tf:relative tf:flex tf:ps-7 tf:text-tf-label tf:text-tf-foreground">
      <CoworkerLineConnectors last={last} />
      {/* Two columns, the roster line's own shape (TVC-074): the
          status+identity cluster beside a label COLUMN that owns every
          metadata line, so the lines share the label's x-origin by
          construction — no static padding re-encodes the cluster's
          width, which stays stable across color variants. */}
      <EntrySurface
        data-tf-subagent-entry=""
        data-tf-subagent-identity={entry.identityToken ?? undefined}
        className="tf:group/subagent tf:flex tf:min-w-0 tf:flex-1 tf:items-start tf:justify-start tf:gap-2 tf:py-3 tf:text-start tf:text-tf-label tf:font-normal"
        {...(drillIn !== null && drillInKey !== null
          ? {
              variant: "bare" as const,
              "aria-haspopup": "dialog" as const,
              "aria-expanded": drillIn.openChildSessionId === drillInKey,
              "aria-controls":
                drillIn.openChildSessionId === drillInKey
                  ? drillIn.previewId
                  : undefined,
              onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
                if (drillIn.openChildSessionId === drillInKey)
                  drillIn.dismiss();
                else drillIn.open(drillInKey, event.currentTarget);
              },
            }
          : {})}
      >
        <CoworkerLineOrnaments
          entry={entry}
          variantIndex={variantIndex}
          working={currentWorkView !== undefined}
        />
        <span className="tf:flex tf:min-w-0 tf:flex-1 tf:flex-col tf:gap-1">
          <CoworkerLineLabel entry={entry} drillable={drillable} />
          {entry.running ? (
            <CoworkerLineWork
              currentWorkView={currentWorkView}
              coworkerWork={coworkerWork}
              paused={entry.paused}
            />
          ) : null}
          {workedLabel !== null ? (
            // Settled cost in the settled-fold register ("Worked for
            // <1s", never "0s" — TVC-073's ladder), from the ledger's
            // own timestamps.
            <span
              data-tf-subagent-worked=""
              className="tf:m-0 tf:truncate tf:text-xs tf:text-tf-muted-foreground"
            >
              {workedLabel}
            </span>
          ) : null}
          {!entry.running && note !== null ? (
            // title carries the whole sentence: the drill-in shows the
            // full transcript, but a truncated failure reason must still
            // be readable in place.
            <span
              data-tf-subagent-note=""
              title={note}
              // m-0 like every sibling line: the widget ships no
              // preflight (the <ul> comment above), so a bare <p> stacks
              // the UA margin on the flex gap and the note detaches from
              // its row.
              className="tf:m-0 tf:truncate tf:text-xs tf:text-tf-muted-foreground"
            >
              {note}
            </span>
          ) : null}
        </span>
      </EntrySurface>
    </li>
  );
}

/** The tree's connectors: the trunk (stopping at the last row's own
 *  elbow) and the elbow riding the label line's center. */
function CoworkerLineConnectors({ last }: { last: boolean }) {
  return (
    <>
      {/* The tree's connectors: the trunk runs the row's full height so
          adjacent rows read as one line, and the last row's trunk stops
          at its own elbow — a rule past the last child would read as a
          border, which this moment deliberately is not. The elbow rides
          the label LINE's center: the entry's py-3 (12px) plus half the
          ornament cluster's min-h-5 (10px) = 22px, the 5.5 spacing step.
          Re-tune both values together whenever that padding changes. */}
      <span
        aria-hidden
        className={
          last
            ? "tf:pointer-events-none tf:absolute tf:start-2 tf:top-0 tf:h-5.5 tf:w-px tf:bg-tf-border"
            : "tf:pointer-events-none tf:absolute tf:start-2 tf:top-0 tf:h-full tf:w-px tf:bg-tf-border"
        }
      />
      <span
        aria-hidden
        className="tf:pointer-events-none tf:absolute tf:start-2 tf:top-5.5 tf:h-px tf:w-4 tf:bg-tf-border"
      />
    </>
  );
}

/** The fixed-size status+identity cluster beside the label column. */
function CoworkerLineOrnaments({
  entry,
  variantIndex,
  working,
}: {
  entry: ResolvedSubagentEntry;
  variantIndex?: number;
  working: boolean;
}) {
  return (
    // data-tf-subagent-ornaments: TVC-075's measurement hook — the
    // fixed-size ornament cluster whose center must ride the label
    // line, never the row's whole stack.
    <span
      data-tf-subagent-ornaments=""
      className="tf:flex tf:min-h-5 tf:shrink-0 tf:items-center tf:gap-2"
    >
      {/* Every state uses the same identity column. Visible state pills
          carry failure/interruption without inserting another icon. */}
      {entry.running && working ? (
        <span className="tf:sr-only">Working</span>
      ) : !entry.running && !entry.failed && !entry.cancelled ? (
        <span className="tf:sr-only">Finished</span>
      ) : null}
      {/* The coworker's TeaFlask mark (law 10): identity beside
          status, never in place of it — color is the deterministic
          variant where the ledger vouches an identity. */}
      <span aria-hidden>
        <AgentIdentityMark
          register="subagent"
          variantIndex={variantIndex}
          className="tf:text-tf-muted-foreground"
        />
      </span>
    </span>
  );
}

/** The label line: the coworker's task title (shimmering while live,
 *  with the drill-in chevron where the row is a button) and the failed
 *  or interrupted pill. */
function CoworkerLineLabel({
  entry,
  drillable,
}: {
  entry: ResolvedSubagentEntry;
  drillable: boolean;
}) {
  return (
    <span className="tf:flex tf:min-w-0 tf:items-center tf:gap-2">
      {drillable ? (
        <span className="tf:flex tf:min-w-0 tf:items-center tf:gap-1.5">
          {entry.running ? (
            // The live row's liveness claim: the label itself shimmers,
            // in the muted live-work ink every moving label wears. The
            // measurement hook sits OUTSIDE the shimmer: the primitive
            // stacks its children twice (base + aria-hidden highlight),
            // and a hook inside would match twice per running row (only
            // current-work, which must read verbatim, keeps the inside
            // placement). Truncation follows the current-work pattern:
            // the ellipsis lives on the blockified span inside the atomic inline-grid.
            <span
              data-tf-subagent-label=""
              title={entry.label ?? undefined}
              className="tf:min-w-0 tf:text-tf-muted-foreground"
            >
              <ShimmerText className="tf:max-w-full tf:grid-cols-1">
                <span className="tf:block tf:truncate">
                  {activityTitleOf(entry.label ?? "Delegated task")}
                </span>
              </ShimmerText>
            </span>
          ) : (
            <span
              data-tf-subagent-label=""
              title={entry.label ?? undefined}
              className="tf:min-w-0 tf:truncate"
            >
              {activityTitleOf(entry.label ?? "Delegated task")}
            </span>
          )}
          <ChevronRightIcon
            aria-hidden
            className="tf:size-3.5 tf:shrink-0 tf:text-tf-muted-foreground tf:opacity-0 tf:transition-opacity tf:group-hover/subagent:opacity-100 tf:group-focus-visible/subagent:opacity-100 tf:group-aria-expanded/subagent:opacity-100 tf:pointer-coarse:opacity-100"
          />
          <span className="tf:sr-only">
            Open this subagent&apos;s transcript
          </span>
        </span>
      ) : entry.running ? (
        // The passive twin of the drill-in arm above: same live
        // shimmer, same hook-outside-the-shimmer placement, same
        // truncation shape, no affordance.
        <span
          data-tf-subagent-label=""
          title={entry.label ?? undefined}
          className="tf:min-w-0 tf:text-tf-muted-foreground"
        >
          <ShimmerText className="tf:max-w-full tf:grid-cols-1">
            <span className="tf:block tf:truncate">
              {activityTitleOf(entry.label ?? "Delegated task")}
            </span>
          </ShimmerText>
        </span>
      ) : (
        <span
          data-tf-subagent-label=""
          title={entry.label ?? undefined}
          className="tf:min-w-0 tf:truncate"
        >
          {activityTitleOf(entry.label ?? "Delegated task")}
        </span>
      )}
      {/* Failure and interruption are inline pills on the affected
          child (law 4, the process-row grammar's own vocabulary) —
          text is the signal, the glyph's ink merely underlines it.
          The cancelled arm is gated on !running: the WIRE can
          cancel the ask while the LEDGER still says the autonomous
          child is computing, and a terminal pill beside a live
          spinner is self-contradicting state language — the
          running truth wins the row (the old icon cascade's
          ordering), the group counts carry the interruption
          meanwhile, and the pill speaks once the child settles.
          failed needs no gate: it and running derive from the one
          ledger status and cannot co-occur. */}
      {entry.failed ? (
        <StatePill destructive>Failed</StatePill>
      ) : entry.cancelled && !entry.running ? (
        <StatePill>Interrupted</StatePill>
      ) : null}
    </span>
  );
}

/** What the member owes this coworker — an action in their browser or a
 *  decision on an approval; the asker named by the row it sits on, never
 *  as the assistant's tool call. Null unless the ledger says the row is
 *  paused: a resumed coworker's entry stays in the inbox (still
 *  "reported") until the next conversation read, and must not speak over
 *  the row's own live work meanwhile. */
export function coworkerWorkLabelOf(
  work: CoworkerExecutionWork | undefined,
  paused: boolean,
): string | null {
  if (!paused) {
    return null;
  }
  if (work !== undefined) {
    // An approval's tool name is best-effort on the contract (null when the
    // pause stopped no tool call); an execution's is required. An unnamed
    // approval keeps its sentence and drops the "to run X" clause.
    const name = work.toolName === null ? "" : humanizedToolName(work.toolName);
    if (work.via === "approval") {
      // The member owes a decision, not the browser an action.
      switch (work.status) {
        case "pending":
        case "executing":
          return name === ""
            ? "Waiting for your approval"
            : `Waiting for your approval to run ${name}`;
        case "reported":
          if (work.ok === false) {
            return name === "" ? "Not approved" : `${name} not approved`;
          }
          return name === "" ? "Approved" : `Approved ${name}`;
        case "stale":
          break;
      }
      return "Paused, waiting on you";
    }
    if (name === "") {
      return "Paused, waiting on you";
    }
    switch (work.status) {
      case "executing":
        return `Running ${name} in your browser`;
      case "pending":
        return `Waiting to run ${name} in your browser`;
      case "reported":
        return `${work.ok === false ? `${name} failed` : `Ran ${name}`} in your browser`;
      case "stale":
        break;
    }
  }
  return "Paused, waiting on you";
}

/** The live status line under a running coworker's label. */
function CoworkerLineWork({
  currentWorkView,
  coworkerWork,
  paused,
}: {
  currentWorkView?: ToolCallViewModel;
  coworkerWork?: CoworkerExecutionWork;
  paused: boolean;
}) {
  const workLabel = coworkerWorkLabelOf(coworkerWork, paused);
  if (workLabel !== null) {
    return (
      <span className="tf:m-0 tf:text-xs tf:text-tf-muted-foreground">
        <ShimmerText className="tf:max-w-full tf:grid-cols-1">
          <span
            data-tf-subagent-coworker-work=""
            className="tf:block tf:truncate"
          >
            {workLabel}
          </span>
        </ShimmerText>
      </span>
    );
  }
  return (
    // The live status line: the presenter's currentWorkLabel
    // (TVC-072 — the one headline ladder's RUNNING arm, never a
    // locally respelled frame) while the drill-in stream feeds
    // it, the plain word "Working" otherwise — a running row
    // must state its state in visible words (the roster row's
    // rule), because reduced motion collapses the label's
    // shimmer to plain text and the ornament slot is
    // deliberately empty. Through the one shared shimmer either
    // way.
    <span className="tf:m-0 tf:text-xs tf:text-tf-muted-foreground">
      {/* The hook rides INSIDE the shimmer: the primitive stacks a
            base and an aria-hidden highlight copy, and the label's
            textContent must read once (TVC-072 asserts it verbatim).
            Truncation lives INSIDE too: the shimmer root is an atomic
            inline-grid, so a `truncate` on the paragraph clips it
            mid-word with no ellipsis; grid-cols-1 + max-w-full make the
            track shrinkable and the blockified hook span carries the
            ellipsis — both stacked copies truncate identically. */}
      <ShimmerText className="tf:max-w-full tf:grid-cols-1">
        {/* The hook marks REAL current work only — the "Working"
              fallback is status, not a tool headline, and TVC-072
              reads the hook's text verbatim. */}
        {currentWorkView !== undefined ? (
          <span
            data-tf-subagent-current-work=""
            className="tf:block tf:truncate"
          >
            {toolCallPresentationOf(currentWorkView).currentWorkLabel}
          </span>
        ) : (
          <span className="tf:block tf:truncate">Working</span>
        )}
      </ShimmerText>
    </span>
  );
}
