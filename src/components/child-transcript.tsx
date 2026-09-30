"use client";

// One dispatched subagent's own run, replayed in full and tailed live
// while it runs — the full panel and the compact roster preview share one
// driver. Deliberately NOT a second <Transcript/>: that renders the
// store's parent-thread cells. This panel owns, through
// useChildReplayStream, one ServingReplayStreamAgent at the child stream
// URL, the messages recorder, and the parent's row derivation; the
// stream opens on drill-in only and leases the one child tail slot
// first, so child and parent streams share a bounded budget.

import { activityTitleOf } from "../core/activity-title.js";
import { CheckIcon, ChevronLeftIcon, XCircleIcon } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";

import { dispatchFailed, dispatchIsRunning } from "../contract/dispatches.js";
import { subagentIdentityTokenOf } from "../core/agent-identity.js";
import type { AssistantConversationStore } from "../core/conversation-store.js";
import { openingBriefOf, withOpeningBrief } from "../core/subagent-brief.js";
import { newestToolCallViewOf } from "../core/subagent-presence.js";
import { settledDurationLabelOf } from "../core/subagent-roster.js";
import {
  trailingRowIsStreaming,
  transcriptRowsOf,
  type TranscriptRow,
} from "../core/transcript-rows.js";
import { AgentIdentityMark } from "./agent-identity-mark.js";
import { MessageList } from "./message-list.js";
import { TfButton } from "./primitives/button.js";
import { ShimmerText } from "./streaming-states.js";
import { useSubagentCurrentWorkPublisher } from "./subagent-current-work.js";
import { SurfaceBoundary } from "./surface-boundary.js";
import { SubagentDrillInContext } from "./subagent-drill-in.js";
import { useAssistantSession } from "./teaflask-assistant-provider.js";
import { useChildReplayStream } from "./use-child-replay-stream.js";
import { useChildDispatch } from "./use-thread-dispatches.js";

type ChildStatus = "running" | "failed" | "finished";

export function ChildTranscriptPanel({
  threadId,
  childSessionId,
  variantIndex,
  opener,
  onBack,
}: {
  threadId: string;
  childSessionId: string;
  /** The coworker's deterministic color slot (coworkerIndicesOf) — the host
   *  passes it so the panel wears the same variant as the row that
   *  opened it; absent metadata disappears cleanly. */
  variantIndex?: number;
  /** The element Back restores focus to, captured by the host INSIDE the
   *  opening click — before the commit that inerts the conversation box
   *  blurs it to <body> (the floating-panel ordering; no effect, layout
   *  or passive, runs early enough to capture it here). */
  opener: HTMLElement | null;
  onBack: () => void;
}) {
  return (
    <ChildTranscript
      mode="panel"
      threadId={threadId}
      childSessionId={childSessionId}
      variantIndex={variantIndex}
      opener={opener}
      onBack={onBack}
    />
  );
}

/** A compact read-only scan of the same child stream. It is mounted only
 * while its roster row is hovered, focused, or tapped, so opening the
 * roster itself remains a ledger-only operation. */
export function ChildTranscriptPreview({
  threadId,
  childSessionId,
  variantIndex,
}: {
  threadId: string;
  childSessionId: string;
  variantIndex?: number;
}) {
  return (
    <ChildTranscript
      mode="preview"
      threadId={threadId}
      childSessionId={childSessionId}
      variantIndex={variantIndex}
      opener={null}
      onBack={() => undefined}
    />
  );
}

/** The preview's deterministic presentation shell, exported for the
 * package's screenshot fixture. Production fills it with the live child
 * driver below; the fixture fills it with canned transcript rows. */
export function ChildTranscriptPreviewFrame({
  label,
  status,
  duration,
  variantIndex,
  children,
}: {
  label: string;
  status: ChildStatus;
  duration?: string | null;
  variantIndex?: number;
  children: ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label={`Conversation preview: ${label}`}
      data-tf-glass=""
      data-tf-child-transcript-preview=""
      className="tf:flex tf:h-full tf:w-full tf:min-h-0 tf:min-w-0 tf:flex-col tf:overflow-hidden tf:rounded-2xl tf:border tf:bg-tf-background"
    >
      <div className="tf:flex tf:items-center tf:gap-2 tf:border-b tf:px-3 tf:py-2.5">
        {/* The coworker's identity (law 10): the same TeaFlask mark and
            color its roster row and inline row wear. */}
        <span className="tf:flex tf:h-6 tf:min-w-6 tf:shrink-0 tf:items-center tf:justify-center tf:px-1">
          <AgentIdentityMark register="subagent" variantIndex={variantIndex} />
        </span>
        <ChildStatusMark status={status} />
        {status === "running" ? (
          // The live header's liveness claim is the label's own shimmer
          // (the one motion register — the same treatment as the inline
          // coworker row), in the muted live-work ink every moving label
          // wears. The shimmer root is an atomic inline-grid, so the
          // ellipsis lives on the blockified span inside.
          <ShimmerText className="tf:min-w-0 tf:flex-1 tf:grid-cols-1 tf:text-tf-label tf:font-medium tf:text-tf-muted-foreground">
            <span className="tf:block tf:truncate" title={label}>
              {activityTitleOf(label)}
            </span>
          </ShimmerText>
        ) : (
          <span
            className="tf:min-w-0 tf:flex-1 tf:truncate tf:text-tf-label tf:font-medium"
            title={label}
          >
            {activityTitleOf(label)}
          </span>
        )}
        {status === "running" ? (
          // The state in visible words, in the slot the settled clock
          // takes over: the header's shimmering label carries no state
          // word of its own, and under reduced motion the shimmer
          // collapses to plain text — this word is what keeps a running
          // header distinguishable from a settled one there.
          <ShimmerText className="tf:shrink-0 tf:text-xs tf:text-tf-muted-foreground">
            Working
          </ShimmerText>
        ) : null}
        {duration != null ? (
          <span className="tf:shrink-0 tf:text-xs tf:text-tf-muted-foreground">
            {duration}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function ChildStatusMark({ status }: { status: ChildStatus }) {
  if (status === "running") {
    // Liveness is the header label's shimmer plus the visible "Working"
    // word in the trailing slot (the one motion register — no spinner
    // beside a shimmering line). The invisible spacer holds the settled
    // glyph's size-4 slot so the label never shifts when the check
    // lands. No sr-only twin: the trailing word is visible text.
    return <span aria-hidden className="tf:size-4 tf:shrink-0" />;
  }
  if (status === "failed") {
    return (
      <>
        <XCircleIcon
          aria-hidden
          className="tf:size-4 tf:shrink-0 tf:text-tf-destructive"
        />
        <span className="tf:sr-only">Failed</span>
      </>
    );
  }
  return (
    <>
      <CheckIcon
        aria-hidden
        className="tf:size-4 tf:shrink-0 tf:text-tf-muted-foreground"
      />
      <span className="tf:sr-only">Finished</span>
    </>
  );
}

function ChildTranscript({
  mode,
  threadId,
  childSessionId,
  variantIndex,
  opener,
  onBack,
}: {
  mode: "panel" | "preview";
  threadId: string;
  childSessionId: string;
  variantIndex?: number;
  opener: HTMLElement | null;
  onBack: () => void;
}) {
  const { session, store } = useAssistantSession();
  const { dispatch, refreshLedger } = useChildDispatch(
    session,
    threadId,
    childSessionId,
  );
  const running = dispatch !== undefined && dispatchIsRunning(dispatch);
  const { messages, streamEnd, tailed, slotDenied, anchors, retry } =
    useChildReplayStream({ session, threadId, childSessionId, refreshLedger });
  const backRef = usePanelBackFocus(mode, opener);
  const brief = useOpeningBrief(store, childSessionId);

  const rows = useMemo(
    () =>
      transcriptRowsOf(
        withOpeningBrief(messages, brief, childSessionId),
        anchors,
        running,
      ),
    [messages, brief, childSessionId, anchors, running],
  );
  // The end-state table's render half, all derived from streamEnd + the
  // ledger row (docs/transcript-surfaces.md): the stream is LIVE only
  // while it is open at the tail of a running dispatch — never dropped,
  // never finished. typing and the trailing group's hold-open both key
  // on this one spelling.
  const streamLive = running && tailed && streamEnd === "open";
  const typing = streamLive && !trailingRowIsStreaming(rows);
  useChildCurrentWorkPublish(childSessionId, rows, streamLive);
  const duration =
    dispatch !== undefined
      ? settledDurationLabelOf(
          dispatch.created_at,
          running ? null : dispatch.updated_at,
        )
      : null;
  // The empty-string guard every neighbouring surface keeps: a
  // whitespace-only task stores '' (question_excerpt_of collapses it),
  // and ?? alone would blank the header.
  const label =
    dispatch !== undefined && dispatch.label !== ""
      ? dispatch.label
      : "Delegated task";
  // The one reason to drill into a FAILED child is to learn why: the
  // ledger's sentence leads the panel, not just the header glyph — the
  // dashboard drill-in's outcome line, in this surface's register.
  const failed = dispatch !== undefined && dispatchFailed(dispatch);
  // error is nullable on the wire: a failed row with no sentence still
  // owes the member an explanation (the neighbouring surfaces' fallback).
  const failureSentence = failed
    ? (dispatch.error ?? "The subagent failed before it could report back.")
    : null;
  // A failed child's stream legitimately ENDS in RUN_ERROR (recorded, or
  // synthesized by the door's settled fallback) — that is its honest
  // terminal, not a dropped connection, and a Retry would replay onto
  // the same ending. The interruption banner speaks only when the ledger
  // does not already explain the ending — and the error end lands AFTER
  // the ledger catch-up (the table's judge order), so a child failing
  // mid-watch reads failed here, never interrupted. A QUIET ending was
  // judged into "error" or "clean" when it landed, so this reads ONE
  // latched fact — never the live row, which would un-paint the banner
  // the moment the child settled.
  const interrupted = streamEnd === "error" && !failed;

  const status = running ? "running" : failed ? "failed" : "finished";

  const transcript = (
    <ChildTranscriptBody
      failureSentence={failureSentence}
      interrupted={interrupted}
      onRetry={retry}
      waitingForSlot={slotDenied && streamEnd === "open"}
      rows={rows}
      typing={typing}
      streamLive={streamLive}
      running={running}
      childSessionId={childSessionId}
    />
  );

  if (mode === "preview") {
    return (
      <ChildTranscriptPreviewFrame
        label={label}
        status={status}
        duration={duration}
        variantIndex={variantIndex}
      >
        {transcript}
      </ChildTranscriptPreviewFrame>
    );
  }

  return (
    <ChildTranscriptPanelFrame
      label={label}
      status={status}
      duration={duration}
      variantIndex={variantIndex}
      backRef={backRef}
      onBack={onBack}
    >
      {transcript}
    </ChildTranscriptPanelFrame>
  );
}

// Opening moves focus here; closing hands it back to the opener the
// host captured INSIDE the opening click — no effect (layout or
// passive) runs before the sibling inert commit's focus-fixup blurs a
// covered opener to <body>, so a capture here would read body and
// restore nothing. The roster refocuses its trigger before asking for
// the panel, so its captured opener survives the roster's unmount; a
// tree row survives under the inert cover. Under StrictMode's
// mount-cleanup-remount the first cleanup's restore hits the
// still-inert opener and no-ops; the real close restores once the same
// commit lifted the cover. A thread switch unmounts the panel too; a
// disconnected opener is simply skipped. Esc anywhere in the panel is
// the back gesture.
function usePanelBackFocus(
  mode: "panel" | "preview",
  opener: HTMLElement | null,
): RefObject<HTMLButtonElement | null> {
  const backRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (mode !== "panel") {
      return;
    }
    backRef.current?.focus();
    return () => {
      if (opener?.isConnected) {
        opener.focus();
      }
    };
    // Fixed for the panel's lifetime: the host keys this panel by child,
    // so a different drill-in is a fresh mount with a fresh opener.
  }, [mode, opener]);
  return backRef;
}

// The brief is a string snapshot, so parent deltas that leave it
// unchanged never re-render the panel.
function useOpeningBrief(
  store: AssistantConversationStore,
  childSessionId: string,
): string | null {
  const briefNow = () => openingBriefOf(store.messages.get(), childSessionId);
  return useSyncExternalStore(store.messages.subscribe, briefNow, briefNow);
}

// The current-work publish (TVC-072): while THIS surface holds the live
// tail, its newest live call feeds the inline group row's current-work
// line — the drill-in stream is the seam's only honest writer (no extra
// streams ever open for it). publishedRef guards the clear: a second
// surface on the same child that never held the tail (slot-denied, or a
// settled replay) must not blank the holder's entry.
function useChildCurrentWorkPublish(
  childSessionId: string,
  rows: readonly TranscriptRow[],
  streamLive: boolean,
): void {
  const publishCurrentWork = useSubagentCurrentWorkPublisher();
  const publishedRef = useRef(false);
  useEffect(() => {
    const view = streamLive ? newestToolCallViewOf(rows) : null;
    if (view !== null) {
      publishedRef.current = true;
      publishCurrentWork(childSessionId, view);
    } else if (publishedRef.current) {
      publishedRef.current = false;
      publishCurrentWork(childSessionId, null);
    }
  }, [publishCurrentWork, childSessionId, rows, streamLive]);
  useEffect(
    () => () => {
      if (publishedRef.current) {
        publishCurrentWork(childSessionId, null);
      }
    },
    [publishCurrentWork, childSessionId],
  );
}

// The child's transcript proper: the ledger's failure sentence, the
// interruption banner with Retry, the slot-wait notice, then the rows.
function ChildTranscriptBody({
  failureSentence,
  interrupted,
  onRetry,
  waitingForSlot,
  rows,
  typing,
  streamLive,
  running,
  childSessionId,
}: {
  failureSentence: string | null;
  interrupted: boolean;
  onRetry: () => void;
  waitingForSlot: boolean;
  rows: readonly TranscriptRow[];
  typing: boolean;
  streamLive: boolean;
  running: boolean;
  childSessionId: string;
}) {
  return (
    <>
      {failureSentence !== null ? (
        <div className="tf:border-b">
          <p className="tf:mx-auto tf:m-0 tf:w-full tf:max-w-3xl tf:px-4 tf:py-2 tf:text-tf-label tf:text-tf-destructive">
            {failureSentence}
          </p>
        </div>
      ) : null}
      {interrupted ? (
        <div role="alert" className="tf:border-b">
          <div className="tf:mx-auto tf:flex tf:w-full tf:max-w-3xl tf:items-center tf:gap-2 tf:px-4 tf:py-2 tf:text-tf-label tf:text-tf-destructive">
            The connection to this subagent was interrupted.
            <TfButton variant="ghost" onClick={onRetry}>
              Retry
            </TfButton>
          </div>
        </div>
      ) : null}
      {waitingForSlot ? (
        <p className="tf:mx-auto tf:m-0 tf:w-full tf:max-w-3xl tf:px-4 tf:py-3 tf:text-tf-label tf:text-tf-muted-foreground">
          Waiting for another subagent view to finish…
        </p>
      ) : null}
      <SubagentDrillInContext.Provider value={null}>
        {/* live rides the STREAM's liveness: the dispatch row alone
            would pin the trailing group open with "Working…" over a
            dropped stream's interruption banner, and briefly over a
            clean terminal until refreshLedger() catches the row up. */}
        <SurfaceBoundary surface="child-transcript">
          <MessageList
            rows={rows}
            cards={[]}
            typing={typing}
            live={streamLive}
            // Episode unification keys on the child's TURN terminality,
            // never on stream liveness: a dropped or untailed stream over
            // a still-running dispatch — the interruption banner, the
            // slot-denied wait, a second view without the tail lease —
            // must not unify the turn mid-flight and present its latest
            // paragraph as the final response, only to pop it apart when
            // Retry reopens the stream.
            turnOpen={running}
            // The placement holds ride the dispatch's own running fact: a
            // child thread is one turn by construction — its only user
            // row is the opening brief — so the next-user-turn decay can
            // never fire here. While the coworker works, its
            // view/decision-bearing calls hold open exactly like a live
            // parent turn; once the dispatch settles, the drill-in is an
            // inspection surface and every disclosure is native — never a
            // wall of held-open panes over a finished history.
            placementHolds={running}
            // The coworker's own transcript: its
            // prose wears the child's identity
            // token, never the primary agent's
            // (law 10; the token is the same one
            // the group row and roster wear for
            // this coworker).
            identityToken={subagentIdentityTokenOf(childSessionId)}
          />
        </SurfaceBoundary>
      </SubagentDrillInContext.Provider>
    </>
  );
}

// The full panel's frame: a non-modal dialog over the conversation box
// with the Back row, the coworker's identity and status, and the clock.
function ChildTranscriptPanelFrame({
  label,
  status,
  duration,
  variantIndex,
  backRef,
  onBack,
  children,
}: {
  label: string;
  status: ChildStatus;
  duration: string | null;
  variantIndex?: number;
  backRef: RefObject<HTMLButtonElement | null>;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the keydown is the panel's own Esc-to-back; every control inside is a real button.
    <div
      role="dialog"
      // A non-modal dialog on purpose — NO aria-modal: the panel covers
      // only the conversation box (whose content the host marks inert),
      // while the chrome around it — the drawer's header row, the
      // dashboard shell — stays live and Tab-reachable for everyone.
      // aria-modal would tell assistive tech to ignore exactly those
      // controls; role + label still announce the panel.
      aria-label="Subagent transcript"
      data-tf-child-transcript=""
      // Focusable on purpose (the roster card's own posture): a click on
      // the panel's passive ink — selecting a failure sentence, message
      // text — moves focus HERE instead of dropping it to body, so the
      // Esc-to-back below keeps routing through this subtree. "Esc
      // anywhere in the panel" has to survive a click anywhere in it.
      tabIndex={-1}
      className="tf:absolute tf:inset-0 tf:flex tf:min-h-0 tf:min-w-0 tf:flex-col tf:bg-tf-background"
      onKeyDown={(event) => {
        if (event.key !== "Escape") {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onBack();
      }}
    >
      <div className="tf:border-b">
        <div className="tf:mx-auto tf:flex tf:w-full tf:max-w-3xl tf:items-center tf:gap-2 tf:px-4 tf:py-2">
          <TfButton ref={backRef} variant="ghost" onClick={onBack}>
            <ChevronLeftIcon aria-hidden className="tf:size-4 tf:shrink-0" />
            Back
          </TfButton>
          {/* The coworker's identity beside its status — the same mark
              and color every other surface wears for this child. */}
          <span className="tf:flex tf:h-6 tf:min-w-6 tf:shrink-0 tf:items-center tf:justify-center tf:px-1">
            <AgentIdentityMark
              register="subagent"
              variantIndex={variantIndex}
            />
          </span>
          <ChildStatusMark status={status} />
          {status === "running" ? (
            // The preview frame's running treatment, verbatim (the two
            // headers are the same surface at two sizes): shimmering
            // muted label plus the visible "Working" word in the slot
            // the settled clock takes over — the words are what survive
            // the reduced-motion collapse.
            <>
              <ShimmerText className="tf:min-w-0 tf:flex-1 tf:grid-cols-1 tf:text-tf-label tf:font-medium tf:text-tf-muted-foreground">
                <span className="tf:block tf:truncate" title={label}>
                  {activityTitleOf(label)}
                </span>
              </ShimmerText>
              <ShimmerText className="tf:shrink-0 tf:text-xs tf:text-tf-muted-foreground">
                Working
              </ShimmerText>
            </>
          ) : (
            <span
              className="tf:min-w-0 tf:flex-1 tf:truncate tf:text-tf-label tf:font-medium"
              title={label}
            >
              {activityTitleOf(label)}
            </span>
          )}
          {duration !== null ? (
            <span className="tf:shrink-0 tf:text-xs tf:text-tf-muted-foreground">
              {duration}
            </span>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}
