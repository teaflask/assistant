// The transcript renderer showcase: every renderer slot in the adopted
// register (assistant-ui's, bake-off 2026-07-30) over canned content, on
// the package's own tokens. Run `npm run fixture:transcript` and open
// http://127.0.0.1:8787/fixtures/transcript/. From C4 on this bench also
// mounts the real transcript over a canned AG-UI agent for the browser
// regression suite.
//
// Fixtures live outside src/** — the lint sanctions and the public-API
// discipline don't apply, so deep source imports are the point: this is
// the package looking at itself.

import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ArrowDownIcon } from "lucide-react";

import {
  ActivityShelf,
  ComposerActivityOverlay,
} from "../../src/components/activity-shelf";
import { ApprovalCard } from "../../src/components/approval-card";
import { ApprovalsContext } from "../../src/components/approval-context";
import { Composer } from "../../src/components/composer";
import { ConversationContext } from "../../src/components/conversation-context";
import { CANNED_COMPOSER_BUSY } from "./canned-conversation";
import { subagentIdentityTokenOf } from "../../src/core/agent-identity";
import type { ApprovalCardModel } from "../../src/core/approval-inbox";
import type { QuestionSetCardModel } from "../../src/core/elicitation-cards";
import { ElicitationsContext } from "../../src/components/elicitation-context";
import { QuestionPanel } from "../../src/components/question-panel";
import { ChildTranscriptPreviewFrame } from "../../src/components/child-transcript";
import { AssistantMarkdown } from "../../src/components/markdown/assistant-markdown";
import { MessageList } from "../../src/components/message-list";
import {
  StreamingLine,
  TypingIndicator,
} from "../../src/components/streaming-states";
import { ReasoningRow } from "../../src/components/reasoning-row";
import { SubagentCountPill } from "../../src/components/subagent-count-pill";
import { SubagentDelegationSurface } from "../../src/components/subagent-delegation-surface";
import {
  SubagentDispatchesContext,
  SubagentGroupRow,
} from "../../src/components/subagent-group-row";
import { SurfaceBoundary } from "../../src/components/surface-boundary";
import { SuspensionSurfaces } from "../../src/components/suspension-surfaces";
import { ToolRow } from "../../src/components/tool-row";
import { UserMessage } from "../../src/components/user-message";
import { TfButton } from "../../src/components/primitives/button";
import { TranscriptSkeleton } from "../../src/components/conversation-view";
import { transcriptRowsOf } from "../../src/core/transcript-rows";
import type { SubagentRosterEntry } from "../../src/core/subagent-roster";
import { isScenarioName, ScenarioRoot } from "./scenarios";
import {
  CANCELLED_TOOL_CALL,
  CANNED_ANCHORS,
  CANNED_ANSWERED_APPROVAL_CARD,
  CANNED_APPROVAL_CARD,
  CANNED_REFUND_APPROVAL_CARD,
  CANNED_EMAIL_APPROVAL_CARD,
  CANNED_BOOLEAN_APPROVAL_CARD,
  CANNED_MANY_DISPATCHES,
  CANNED_MESSAGES,
  CANNED_THREAD_DISPATCHES,
  COMPLETED_REASONING_ROW,
  COMPLETED_TOOL_CALL,
  FAILED_TOOL_CALL,
  KITCHEN_SINK_MARKDOWN,
  OFFLOADED_TOOL_CALL,
  RUNNING_TOOL_CALL,
  STREAMING_REASONING_ROW,
  STREAMING_STATUS_LINE,
  USER_QUESTION,
  CANNED_QUESTIONS_ANSWERED,
  CANNED_QUESTIONS_CANCELLED,
  CANNED_QUESTIONS_STALE,
  CANNED_QUESTIONS_THREE,
  CANNED_ATTACHMENTS,
} from "./canned-data";
import { QuestionDraftStore } from "../../src/core/question-drafts";

function Slot({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      className="bench-slot"
      data-testid={`slot-${title.toLowerCase().replaceAll(/[^a-z]+/g, "-")}`}
    >
      <h2 className="tf:m-0 tf:border-b tf:pb-2 tf:text-tf-heading tf:font-medium">
        {title}
      </h2>
      <div className="bench-specimen tf:rounded-tf tf:border tf:p-4">
        {children}
      </div>
    </section>
  );
}

// The scroll affordance, shown statically over a scrollback backdrop
// (the LIVE stick-to-bottom behavior arrives with the owned message
// list in C4).
function ScrollSpecimen() {
  return (
    <div className="bench-scrollback tf:relative tf:overflow-hidden tf:rounded-tf tf:border">
      <div className="tf:flex tf:h-full tf:flex-col tf:gap-2 tf:overflow-y-auto tf:p-3">
        {Array.from({ length: 14 }, (_, line) => (
          <p key={line} className="tf:m-0 tf:text-tf-body">
            Scrollback line {line + 1}.
          </p>
        ))}
      </div>
      <div className="bench-scroll-button">
        <TfButton
          variant="iconFloating"
          aria-label="Scroll to bottom"
          className="tf:size-9"
        >
          <ArrowDownIcon aria-hidden className="tf:size-4" />
        </TfButton>
      </div>
    </div>
  );
}

function SubagentPreviewSpecimen({ entry }: { entry: SubagentRosterEntry }) {
  const rows = transcriptRowsOf(
    [
      {
        id: "preview-user",
        role: "user",
        content: "Check the descaling instructions for drift.",
      },
      {
        id: "preview-assistant",
        role: "assistant",
        content:
          "I compared the current guide against the implementation. The interval and citric-acid ratio still match; the rinse step needs one wording correction.",
      },
    ],
    CANNED_ANCHORS,
    entry.running,
  );
  return (
    <ChildTranscriptPreviewFrame
      label={entry.label}
      status={entry.running ? "running" : entry.failed ? "failed" : "finished"}
      duration={entry.running ? null : "3m 04s"}
    >
      <MessageList
        rows={rows}
        cards={[]}
        typing={entry.running}
        // A coworker's transcript wears the coworker's token (law 10 —
        // the round-2 fix; this bench was the sweep's missed site).
        identityToken={subagentIdentityTokenOf(entry.childSessionId)}
      />
    </ChildTranscriptPreviewFrame>
  );
}

function Gallery() {
  return (
    <div className="bench-gallery">
      <Slot title="1 · Assistant message + markdown">
        <AssistantMarkdown>{KITCHEN_SINK_MARKDOWN}</AssistantMarkdown>
      </Slot>

      <Slot title="2 · User message">
        <UserMessage>{USER_QUESTION}</UserMessage>
      </Slot>

      <Slot title="3 · Tool call — annotated, generic-running, failed, cancelled, offloaded">
        <ToolRow view={COMPLETED_TOOL_CALL} />
        <ToolRow view={RUNNING_TOOL_CALL} />
        <ToolRow view={FAILED_TOOL_CALL} />
        <ToolRow view={CANCELLED_TOOL_CALL} />
        <ToolRow view={OFFLOADED_TOOL_CALL} />
      </Slot>

      {/* Slot 4 retired: the bake-off ComposerShell specimen is
          gone — the REAL shipping composer's pixels are TVC-152's own
          scenario. The gap in numbering is deliberate: renumbering every
          later slot would churn the bench captions for no reason. */}

      <Slot title="5 · Streaming states">
        <TypingIndicator />
        <div className="tf:mt-2">
          <StreamingLine>{STREAMING_STATUS_LINE}</StreamingLine>
        </div>
      </Slot>

      <Slot title="6 · Thread-opening skeleton">
        <TranscriptSkeleton />
      </Slot>

      <Slot title="7 · Scroll-to-bottom">
        <ScrollSpecimen />
      </Slot>

      <Slot title="8 · Full transcript flow — the owned message list">
        <FullTranscriptFlow />
      </Slot>

      <Slot title="9 · Reasoning — streaming, done">
        <ReasoningRow view={STREAMING_REASONING_ROW} />
        <ReasoningRow view={COMPLETED_REASONING_ROW} />
      </Slot>

      <Slot title="10 · User message — attachments">
        <UserMessage attachments={CANNED_ATTACHMENTS}>
          Here is the error and the manual.
        </UserMessage>
        <div className="tf:mt-2">
          <UserMessage attachments={[CANNED_ATTACHMENTS[0]]}>{""}</UserMessage>
        </div>
      </Slot>

      <Slot title="11 · Subagent tree — running, failed, joined ledger">
        <SubagentDispatchesContext.Provider
          value={{ byOrdinal: CANNED_THREAD_DISPATCHES }}
        >
          <SubagentGroupRow
            row={{
              kind: "subagent-group",
              key: "subagents:bench",
              entries: [
                {
                  toolCallId: "t-d0",
                  receipt: {
                    outcome: "launched",
                    ordinal: 0,
                    label: "Survey the steeping guides for temperature claims.",
                    childSessionId: "subagent-bench-0",
                    settled: null,
                  },
                  label: "Survey the steeping guides for temperature claims.",
                  running: true,
                  failed: false,
                  cancelled: false,
                  note: null,
                },
                {
                  toolCallId: "t-d1",
                  receipt: {
                    outcome: "already_settled",
                    ordinal: 1,
                    label: "Map every kettle model the docs mention.",
                    childSessionId: "subagent-bench-1",
                    settled: {
                      failed: true,
                      note: "The coworker ran out of context before answering.",
                    },
                  },
                  label: "Map every kettle model the docs mention.",
                  running: false,
                  failed: true,
                  cancelled: false,
                  note: "The coworker ran out of context before answering.",
                },
                {
                  toolCallId: "t-d2",
                  receipt: {
                    outcome: "launched",
                    ordinal: 2,
                    label: "Check the descaling instructions for drift.",
                    childSessionId: "subagent-bench-2",
                    settled: null,
                  },
                  label: "Check the descaling instructions for drift.",
                  running: true,
                  failed: false,
                  cancelled: false,
                  note: null,
                },
              ],
            }}
          />
        </SubagentDispatchesContext.Provider>
      </Slot>

      <Slot title="12 · Subagent count pill + roster">
        {/* Hover, focus, or tap the pills to open the roster. The tall
            spacer gives the upward card room inside the specimen —
            an inline style, since the bench is outside the token laws
            and the package build does not emit a pt-64 utility. */}
        {/* Each pill mounts through its landlord: the band —
            ground, capped column, centering — is the shelf's now. */}
        <div
          className="tf:flex tf:flex-col tf:gap-2"
          style={{ paddingTop: 300 }}
        >
          {/* Inline height, not h-16: the package build scans only
              src/components for utilities, so a fixture-only class silently
              never exists and the wrapper collapses (the bench's own
              pt-64 note records the same rule). */}
          <div className="tf:relative" style={{ height: 64 }}>
            <ComposerActivityOverlay
              activity={
                <SubagentCountPill
                  dispatches={CANNED_THREAD_DISPATCHES}
                  renderPreview={(entry) => (
                    <SubagentPreviewSpecimen entry={entry} />
                  )}
                />
              }
            />
          </div>
          {/* Inline height, not h-16: the package build scans only
              src/components for utilities, so a fixture-only class silently
              never exists and the wrapper collapses (the bench's own
              pt-64 note records the same rule). */}
          <div className="tf:relative" style={{ height: 64 }}>
            <ComposerActivityOverlay
              activity={
                <SubagentCountPill dispatches={CANNED_MANY_DISPATCHES} />
              }
            />
          </div>
          {/* Settled with a loss: the pill names it and wears the one
              loud pixel. */}
          {/* Inline height, not h-16: the package build scans only
              src/components for utilities, so a fixture-only class silently
              never exists and the wrapper collapses (the bench's own
              pt-64 note records the same rule). */}
          <div className="tf:relative" style={{ height: 64 }}>
            <ComposerActivityOverlay
              activity={
                <SubagentCountPill
                  dispatches={
                    new Map(
                      [...CANNED_THREAD_DISPATCHES].filter(
                        ([, dispatch]) => dispatch.status !== "dispatched",
                      ),
                    )
                  }
                />
              }
            />
          </div>
        </div>
      </Slot>

      <Slot title="13 · Generic approval banners — pending and answered">
        {/* One universal banner over a boolean, a nested refund request,
            a long email, and an answered request. The banner renders
            nothing argument-derived — four differently-shaped
            requests, one consent grammar. */}
        <ApprovalsContext.Provider
          value={{
            cards: [
              CANNED_BOOLEAN_APPROVAL_CARD,
              CANNED_REFUND_APPROVAL_CARD,
              CANNED_EMAIL_APPROVAL_CARD,
              CANNED_ANSWERED_APPROVAL_CARD,
            ],
            submitDecision: () => Promise.resolve(),
          }}
        >
          <div className="tf:flex tf:flex-col tf:gap-2">
            <ApprovalCard card={CANNED_BOOLEAN_APPROVAL_CARD} />
            <ApprovalCard card={CANNED_REFUND_APPROVAL_CARD} />
            <ApprovalCard card={CANNED_EMAIL_APPROVAL_CARD} />
            <ApprovalCard card={CANNED_ANSWERED_APPROVAL_CARD} />
          </div>
        </ApprovalsContext.Provider>
      </Slot>

      {/* Slot 14 (typed tool results) is retired with the ui_spec result
          grammar it photographed; slot numbers are stable labels in the
          pixel record, so the gap stays. */}

      <Slot title="15 · Question panel — pending, answered, dismissed, stale">
        {/* The question panel over canned sets: the pending set with
            its suggestions and custom row, the answered set's Q→A
            receipt, the dismissed set's heading over its sentence, and
            the expired set's stale note. */}
        <ElicitationsContext.Provider
          value={{
            cards: [],
            submitQuestionAnswers: () => Promise.resolve(),
            cancelQuestionSet: () => Promise.resolve(),
            drafts: new QuestionDraftStore(),
          }}
        >
          <div className="tf:flex tf:flex-col tf:gap-2">
            <QuestionPanel card={CANNED_QUESTIONS_THREE} />
            <QuestionPanel card={CANNED_QUESTIONS_ANSWERED} />
            <QuestionPanel card={CANNED_QUESTIONS_CANCELLED} />
            <QuestionPanel card={CANNED_QUESTIONS_STALE} />
          </div>
        </ElicitationsContext.Provider>
      </Slot>
    </div>
  );
}

// The real render path end to end: canned AG-UI messages through the
// interleave (core/transcript-rows) into the real MessageList — user
// rows, the annotated-and-generic tool rows, and a pending approval
// card anchored to the in-flight call (the meta-receipt rows and the
// resume divider this bench used to pose were deleted) — then the
// subagent pill in Transcript's own composition (below the list, above
// where the composer sits), so the pixel contract pins the pill's column
// alignment against the bubbles, not just its shape.
function FullTranscriptFlow() {
  const rows = transcriptRowsOf(CANNED_MESSAGES, CANNED_ANCHORS, true);
  return (
    <ApprovalsContext.Provider
      value={{
        cards: [CANNED_APPROVAL_CARD],
        submitDecision: () => Promise.resolve(),
      }}
    >
      <div className="bench-transcript-flow tf:flex tf:flex-col">
        <MessageList rows={rows} cards={[CANNED_APPROVAL_CARD]} typing />
        {/* Inline height, not h-16: the package build scans only
              src/components for utilities, so a fixture-only class silently
              never exists and the wrapper collapses (the bench's own
              pt-64 note records the same rule). */}
        <div className="tf:relative" style={{ height: 64 }}>
          <ComposerActivityOverlay
            activity={
              <SubagentCountPill dispatches={CANNED_THREAD_DISPATCHES} />
            }
          />
        </div>
      </div>
    </ApprovalsContext.Provider>
  );
}

// The late-growth scroll probe: approval markers arrive on their own
// recorder after the tool row has already painted. A body-sized request is
// therefore one large resize, not a stream of little text deltas. The real
// MessageList must land its footer inside the viewport on that resize; the
// regression used to leave the native scrollbar apparently bottomed-out
// while the Approve button still sat below the composer.
function LateApprovalResizeProbe() {
  const [bodyLineCount, setBodyLineCount] = useState(0);
  const rows = transcriptRowsOf(
    [
      { id: "probe-user", role: "user", content: "Create the document." },
      {
        id: "probe-tool",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "probe-tool-call",
            type: "function",
            function: { name: "action__create-doc", arguments: "{}" },
          },
        ],
      },
    ],
    CANNED_ANCHORS,
    true,
  );
  // The law under test (TVC-140/141's resize half) is the LATE RESIZE,
  // and the banner's only growable content is the consent prompt. Both
  // counts stay below the banner's own height cap (styles.css caps
  // [data-tf-approval-card] to the well budget), so "render" AND "grow"
  // each produce a real layout resize — a count past the cap would make
  // the second half of the probe vacuous.
  const giantCard = {
    ...CANNED_EMAIL_APPROVAL_CARD,
    interruptId: "late-growth-probe",
    toolCallId: "probe-tool-call",
    anchored: true,
    prompt: Array.from(
      { length: bodyLineCount },
      (_, line) => `Approval consent sentence line ${String(line + 1)}.`,
    ).join(" "),
  } satisfies ApprovalCardModel;

  return (
    <div
      data-tf-assistant=""
      className="tf:bg-tf-background tf:font-tf-sans tf:text-tf-foreground"
    >
      <ApprovalsContext.Provider
        value={{
          cards: bodyLineCount > 0 ? [giantCard] : [],
          submitDecision: () => Promise.resolve(),
        }}
      >
        <div
          data-testid="late-approval-probe"
          className="tf:flex tf:flex-col"
          style={{ height: 420 }}
        >
          <MessageList
            rows={rows}
            cards={bodyLineCount > 0 ? [giantCard] : []}
          />
        </div>
        <button
          type="button"
          onClick={() => {
            setBodyLineCount(12);
          }}
        >
          Render giant approval
        </button>
        <button
          type="button"
          onClick={() => {
            setBodyLineCount(24);
          }}
        >
          Grow approval more
        </button>
      </ApprovalsContext.Provider>
    </div>
  );
}

// TVC-067's stimulus: the same giant late approval, arriving the
// SHIPPING way — through the activity shelf's suspension slot. Three
// scenes: the full-viewport host (a fixed column emulating the page);
// `?late-suspension-probe=constrained` — a host wearing the REAL
// palette hook (data-tf-assistant-palette) at the palette's REAL height
// formula min(100dvh − 192px, 576px), overflow hidden, over the REAL
// composer; and `?late-suspension-probe=floating` — the companion
// card's hook (data-tf-panel-dock="floating") at ITS height formula
// min(68dvh, 832px, 100dvh − 96px). The replicas write the formulas'
// rem terms as px — identical at this harness's 16px root, and
// JS-authored styles never carry rem (the authored-rem law in
// tests/rem-in-source.test.ts). The real formulas matter: a fixed
// emulation height only observes one viewport height, and the bound's
// short-viewport behaviour is exactly what a full-height probe can
// never see. Buttons render inside the column so clicking never scrolls
// the page mid-measurement. The question panel's worst case: every
// fixed part of the panel at its bound at once — a 60-char heading, a
// 500-char prompt, a submit-failure sentence, and eight suggestions
// with descriptions — so a constrained host is measured against the
// most the panel can be asked to hold above its footer.
const PROBE_QUESTION_SET: QuestionSetCardModel = {
  interruptId: "late-suspension-probe-questions",
  runId: "probe-run",
  toolCallId: "probe-tool-call",
  anchored: true,
  round: 0,
  status: "actionable",
  errorSentence: "That couldn't be sent. Check your connection and try again.",
  answered: null,
  questions: [
    {
      id: "scope",
      heading: "Scope of the migration and the rollout window for it",
      prompt:
        "Which parts of the workspace should the migration move first, given " +
        "that the archive holds fourteen years of tickets, the knowledge base " +
        "was rewritten twice, the macros reference fields that no longer " +
        "exist, and the two regional teams keep separate escalation paths " +
        "that were never reconciled? Pick the closest fit, or describe the " +
        "order you'd prefer in your own words below — the more detail the " +
        "better, since the plan will follow it exactly as written here.",
      options: Array.from({ length: 8 }, (_, index) => ({
        text: `Move tranche ${String(index + 1)} first`,
        description: `The tranche's tickets, macros and knowledge articles together.`,
      })),
    },
    {
      id: "window",
      heading: "Rollout window",
      prompt: "When should the cutover run?",
      options: [
        { text: "Overnight, this weekend", description: null },
        { text: "Next quiet Tuesday", description: null },
      ],
    },
  ],
};
const PROBE_DRAFTS = new QuestionDraftStore();

function LateSuspensionProbe({
  host,
}: {
  host: "page" | "constrained" | "floating";
}) {
  const [bodyLineCount, setBodyLineCount] = useState(0);
  const [questionsPending, setQuestionsPending] = useState(false);
  const rows = transcriptRowsOf(
    [
      { id: "probe-user", role: "user", content: "Create the document." },
      {
        id: "probe-tool",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "probe-tool-call",
            type: "function",
            function: { name: "action__create-doc", arguments: "{}" },
          },
        ],
      },
    ],
    CANNED_ANCHORS,
    true,
  );
  // The banner's surviving stressor is a long backend-authored consent
  // sentence (arguments never render on the banner) — the prompt is
  // the only content that can grow the surface past the well's budget.
  const giantCard = {
    ...CANNED_EMAIL_APPROVAL_CARD,
    interruptId: "late-suspension-probe",
    toolCallId: "probe-tool-call",
    anchored: true,
    prompt: Array.from(
      { length: bodyLineCount },
      (_, line) => `Approval consent sentence line ${String(line + 1)}.`,
    ).join(" "),
  } satisfies ApprovalCardModel;
  const cards = bodyLineCount > 0 ? [giantCard] : [];
  const column = (
    <>
      <button
        type="button"
        style={{ flexShrink: 0, alignSelf: "flex-start" }}
        onClick={() => {
          setBodyLineCount(64);
        }}
      >
        Render giant approval
      </button>
      <button
        type="button"
        style={{ flexShrink: 0, alignSelf: "flex-start" }}
        onClick={() => {
          setQuestionsPending(true);
        }}
      >
        Render long question set
      </button>
      <MessageList rows={rows} cards={cards} decisionSurfacesInShelf />
      <ActivityShelf
        suspension={
          <SuspensionSurfaces
            rowIndexByToolCallId={new Map([["probe-tool-call", 1]])}
          />
        }
      />
      {host === "page" ? (
        // The full-viewport scene's stand-in: a real textbox, so the
        // law measures an actual control's visibility.
        <textarea
          aria-label="Message TeaFlask"
          rows={3}
          style={{ flexShrink: 0 }}
        />
      ) : (
        // The REAL composer: the constrained laws measure whether an
        // actual composer survives inside the capped panel, not a
        // stand-in's optimistic height.
        <ConversationContext.Provider value={CANNED_COMPOSER_BUSY}>
          <Composer />
        </ConversationContext.Provider>
      )}
    </>
  );
  return (
    <div
      data-tf-assistant=""
      className="tf:bg-tf-background tf:font-tf-sans tf:text-tf-foreground"
    >
      <ApprovalsContext.Provider
        value={{ cards, submitDecision: () => Promise.resolve() }}
      >
        <ElicitationsContext.Provider
          value={{
            cards: questionsPending ? [PROBE_QUESTION_SET] : [],
            submitQuestionAnswers: () => Promise.resolve(),
            cancelQuestionSet: () => Promise.resolve(),
            drafts: PROBE_DRAFTS,
          }}
        >
          {host === "constrained" ? (
            // The palette-shaped host at the palette's REAL height
            // formula, wearing the REAL palette hook so the stylesheet
            // rule the palette relies on is the one under test.
            // (Residual, stated: the real palette's own chrome is not
            // reproduced; the emulation covers the height-cap geometry,
            // not the palette's layout.)
            <div
              data-tf-assistant-palette=""
              data-testid="late-suspension-probe"
              className="tf:flex tf:flex-col tf:overflow-hidden tf:border"
              style={{ height: "min(calc(100dvh - 192px), 576px)" }}
            >
              {column}
            </div>
          ) : host === "floating" ? (
            // The companion card's host shape, wearing ITS hook and ITS
            // height formula. Same residual: geometry, not chrome.
            <div
              data-tf-panel-dock="floating"
              data-testid="late-suspension-probe"
              className="tf:flex tf:flex-col tf:overflow-hidden tf:border"
              style={{ height: "min(68dvh, 832px, calc(100dvh - 96px))" }}
            >
              {column}
            </div>
          ) : (
            // A fixed full-viewport column (fixture scaffolding — probes
            // emulate a full-height host, and the bench page's own chrome
            // must not shift what the law measures against the viewport).
            // The button lives inside it so clicking never scrolls.
            <div
              data-testid="late-suspension-probe"
              className="tf:flex tf:flex-col tf:bg-tf-background"
              style={{ position: "fixed", inset: 0 }}
            >
              {column}
            </div>
          )}
        </ElicitationsContext.Provider>
      </ApprovalsContext.Provider>
    </div>
  );
}

// The follow-contract probe: a fixed-height column holding the real
// MessageList over a composer stand-in flex sibling, plus a rAF-loop
// growth engine. Growing the stand-in shrinks the scroll viewport without
// touching content height (the composer-auto-grow shape the library never
// observes); per-frame card growth keeps the library's resizeDifference
// non-zero essentially continuously, which is the exact condition under
// which its scroll handler swallows every non-wheel escape. The trailing
// code-block message keeps a <pre> glued to the content bottom so the
// wheel probe's pointer is reliably over it while pinned.
const PROBE_CODE_MESSAGE = [
  "The pipeline stages, in order:",
  "",
  "```ts",
  Array.from(
    { length: 40 },
    (_, line) => `pipeline.stage(${String(line + 1)});`,
  ).join("\n"),
  "```",
].join("\n");

function ScrollGuardsProbe() {
  const [composerTall, setComposerTall] = useState(false);
  const [growing, setGrowing] = useState(false);
  const [bodyLineCount, setBodyLineCount] = useState(0);

  useEffect(() => {
    if (!growing) {
      return;
    }
    // Every OTHER frame on purpose (round-6 CI fix): real streams pause
    // between chunks, and use-stick-to-bottom only self-heals a scroll
    // deficit on a frame where content did NOT grow — its catch-up
    // check compares against a one-frame-stale target, so perfectly
    // continuous growth larger than the deficit outruns the heal
    // forever. The axis-mixed pan probe (TVC-144) leaves an 18px jitter
    // deficit and needs the heal frame a real stream always provides;
    // per-frame growth here is a 24px user-message line.
    let grow = true;
    let frame = requestAnimationFrame(function tick() {
      if (grow) {
        setBodyLineCount((count) => count + 1);
      }
      grow = !grow;
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [growing]);

  const rows = transcriptRowsOf(
    [
      { id: "guards-user", role: "user", content: "Run the pipeline." },
      {
        id: "guards-tool",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "guards-tool-call",
            type: "function",
            function: { name: "action__create-doc", arguments: "{}" },
          },
        ],
      },
      // The growth channel: a user message grows one line per frame —
      // user prose renders whole (whitespace-pre-wrap), unclamped and
      // unpaced, so each appended line is one content resize per frame
      // with no reveal pacer between the test and the geometry. The
      // approval banner cannot drive unbounded height: it renders
      // nothing argument-derived (the row carries the request) and
      // holds a max-height, so a growing payload never grows it. Placed
      // ABOVE the code message on purpose — TVC-142's pointer target
      // must stay glued to the content bottom.
      {
        id: "guards-growth",
        role: "user",
        content: [
          "Keep the pipeline going.",
          ...Array.from(
            { length: bodyLineCount },
            (_, line) => `Pipeline note line ${String(line + 1)}.`,
          ),
        ].join("\n"),
      },
      { id: "guards-code", role: "assistant", content: PROBE_CODE_MESSAGE },
    ],
    CANNED_ANCHORS,
    false,
  );
  // Static now (see the growth row above): the card still poses the
  // anchored actionable surface the probe renders inline.
  const growingCard = {
    ...CANNED_EMAIL_APPROVAL_CARD,
    interruptId: "scroll-guards-probe",
    toolCallId: "guards-tool-call",
    anchored: true,
    toolArgs: {
      body: {
        to: "casey@brightloom.example",
        subject: "Your export is ready",
        message: "The export attached; the link expires in seven days.",
      },
    },
  } satisfies ApprovalCardModel;

  return (
    <div
      data-tf-assistant=""
      className="tf:bg-tf-background tf:font-tf-sans tf:text-tf-foreground"
    >
      <ApprovalsContext.Provider
        value={{
          cards: [growingCard],
          submitDecision: () => Promise.resolve(),
        }}
      >
        <div
          data-testid="scroll-guards-probe"
          className="tf:flex tf:flex-col"
          style={{ height: 420 }}
        >
          <MessageList rows={rows} cards={[growingCard]} />
          {/* The composer stand-in: growing it steals 150px of viewport. */}
          <div style={{ height: composerTall ? 190 : 40, flexShrink: 0 }} />
        </div>
        <button
          type="button"
          onClick={() => {
            setComposerTall(true);
          }}
        >
          Grow composer
        </button>
        <button
          type="button"
          onClick={() => {
            setGrowing(true);
          }}
        >
          Start growth
        </button>
        <button
          type="button"
          onClick={() => {
            setGrowing(false);
          }}
        >
          Stop growth
        </button>
      </ApprovalsContext.Provider>
    </div>
  );
}

// The activity-shelf growth probe (TVC-124): the real MessageList
// over the real ActivityShelf over a composer stand-in. Populating
// the shelf's suspension slot with a ~150px tenant shrinks the scroll
// viewport without touching content height — the exact resize class
// use-stick-to-bottom never observes and Guard 1 of
// ScrollFollowGuards exists to catch. The probe drives it both ways:
// populate/empty while pinned (the reader must stay pinned) and while
// scrolled away (the reader must not move).
function ActivityShelfProbe() {
  const [populated, setPopulated] = useState(false);
  const rows = transcriptRowsOf(
    [
      { id: "shelf-user", role: "user", content: "Run the pipeline." },
      { id: "shelf-code", role: "assistant", content: PROBE_CODE_MESSAGE },
    ],
    CANNED_ANCHORS,
    false,
  );
  return (
    <div
      data-tf-assistant=""
      className="tf:bg-tf-background tf:font-tf-sans tf:text-tf-foreground"
    >
      <div
        data-testid="activity-shelf-probe"
        className="tf:flex tf:flex-col"
        style={{ height: 420 }}
      >
        <MessageList rows={rows} cards={[]} />
        <ActivityShelf
          suspension={
            populated ? (
              <div
                data-tf-shelf-item=""
                data-tf-probe-suspension=""
                className="tf:w-full tf:rounded-2xl tf:border tf:p-4"
                style={{ height: 150 }}
              >
                <p className="tf:text-tf-label tf:text-tf-muted-foreground">
                  A tall suspension tenant — the shelf's growth channel.
                </p>
              </div>
            ) : undefined
          }
        />
        {/* The composer stand-in. */}
        <div style={{ height: 40, flexShrink: 0 }} />
      </div>
      <button
        type="button"
        onClick={() => {
          setPopulated(true);
        }}
      >
        Populate shelf
      </button>
      <button
        type="button"
        onClick={() => {
          setPopulated(false);
        }}
      >
        Empty shelf
      </button>
    </div>
  );
}

function Bench() {
  const [dark, setDark] = useState(false);
  return (
    <>
      <div className="bench-controls">
        <label>
          <input
            type="checkbox"
            checked={dark}
            onChange={(event) => {
              setDark(event.target.checked);
            }}
          />{" "}
          dark
        </label>
      </div>
      <div>
        <div
          data-tf-assistant=""
          data-tf-theme={dark ? "dark" : "light"}
          className="bench-surface tf:bg-tf-background tf:p-6 tf:font-tf-sans tf:text-tf-foreground"
          data-testid="bench-gallery"
        >
          <Gallery />
        </div>
      </div>
    </>
  );
}

// The subagent-defocus probe: the drill-in popover is a direct
// [data-tf-conversation-body] child, exactly what the roster's defocus
// rule (styles.css, activity-shelf-slot-contract.md §6) targets — so an
// open drill-in and an open roster must never coexist. This probe renders
// the REAL hook structure conversation-view.tsx ships (the conversation
// div, the `contents` body, the delegation surface as a fragment, the
// shelf with the pill) so a browser test can measure the rendered
// outcome: open a drill-in, hover the pill, and assert the drill-in is
// dismissed rather than blurred and inert under the roster.
function SubagentDefocusProbe() {
  return (
    <div
      data-tf-assistant=""
      className="tf:bg-tf-background tf:font-tf-sans tf:text-tf-foreground"
    >
      <div
        data-testid="subagent-defocus-probe"
        data-tf-conversation=""
        className="tf:relative tf:flex tf:min-h-0 tf:min-w-0 tf:flex-1 tf:flex-col"
        // A real conversation is tall: the popover anchors near its row
        // at the top while the shelf sits far below, so the two floats
        // never overlap and the hover genuinely reaches the pill.
        style={{ height: 860 }}
      >
        <div data-tf-conversation-body="" className="tf:contents">
          <SubagentDelegationSurface
            dispatches={CANNED_THREAD_DISPATCHES}
            threadId="probe-thread"
            // The deterministic preview seam: the probe measures surface
            // coexistence, never a live child stream.
            renderPreview={(childSessionId) => (
              <ChildTranscriptPreviewFrame
                label={`Probe preview ${childSessionId}`}
                status="running"
              >
                <p className="tf:m-0 tf:p-4 tf:text-tf-label">
                  Probe preview body.
                </p>
              </ChildTranscriptPreviewFrame>
            )}
          >
            <SubagentDispatchesContext.Provider
              value={{ byOrdinal: CANNED_THREAD_DISPATCHES }}
            >
              {/* SETTLED entries on purpose (round 5): a settled group is
                  collapsible — `open={counts.running > 0 || undefined}`
                  frees the toggle — so the probe can hide a preview's
                  anchor while the preview stays up (the auto-collapse
                  arm, driven here by keyboard since a pointer collapse
                  light-dismisses first). The ledger rows are the canned
                  failed/succeeded pair, so the drill-in stays vouched. */}
              <SubagentGroupRow
                row={{
                  kind: "subagent-group",
                  key: "defocus-probe",
                  entries: [1, 2].map((ordinal) => ({
                    toolCallId: `probe-call-${String(ordinal)}`,
                    receipt: {
                      outcome: "already_settled",
                      ordinal,
                      label: `Probe task ${String(ordinal)}.`,
                      childSessionId: `subagent-bench-${String(ordinal)}`,
                      settled: { failed: ordinal === 1, note: null },
                    },
                    label: `Probe task ${String(ordinal)}.`,
                    running: false,
                    failed: ordinal === 1,
                    cancelled: false,
                    note: null,
                  })),
                }}
              />
            </SubagentDispatchesContext.Provider>
            {/* The transcript's stand-in bulk, pushing the shelf to the
                bottom the way a real conversation does. */}
            <div style={{ flexGrow: 1 }} />
            <div
              data-tf-composer-root=""
              data-tf-composer-ground=""
              className="tf:relative"
            >
              <ComposerActivityOverlay
                activity={
                  <SubagentCountPill dispatches={CANNED_THREAD_DISPATCHES} />
                }
              />
            </div>
          </SubagentDelegationSurface>
        </div>
      </div>
    </div>
  );
}

// The boundary probe: a forced throw inside a transcript row, delivered
// through the PRODUCTION mount — the real MessageList behind the same
// SurfaceBoundary wiring transcript.tsx mounts — must leave the host
// page alive, degrade ONE ROW to the fallback card (round-3 finding 3:
// the projection runs inside the per-row boundary, so the census's
// one-tool-row blast radius is what this asserts), and report through
// onError. The fault is a poisoned row: a getter that throws on
// `offloaded`, the first field the row's own projection dereferences
// and a field nothing outside the row boundary reads (toolName/argsText
// are also read by the list's fold pass, so poisoning those probes the
// LIST boundary instead). A sibling row in the same list and a second,
// healthy MessageList prove the radius. The chrome-root section renders
// a boundary OUTSIDE any [data-tf-assistant] ancestor: the fallback
// card is CASCADE-INDEPENDENT since the round-6 ruling — inline
// literals, no theming root, no token chain — so this arm shows the
// literals surviving with no widget root above them; the spec reads
// computed styles against the section's garish host ink. The Playwright
// spec (tests-e2e/boundary.spec.ts) reads the sentinel array plus the
// DOM — assertions only, no screenshots.
function BoundaryBomb(): never {
  throw new Error("boundary-probe: chrome-root bomb");
}

function BoundaryProbe() {
  const rows = transcriptRowsOf(
    [
      { id: "boom-user", role: "user", content: "Poison the next row." },
      {
        id: "boom-tool",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "boom-call",
            type: "function",
            function: { name: "action__create-doc", arguments: "{}" },
          },
        ],
      },
    ],
    CANNED_ANCHORS,
    false,
  );
  const poisoned = rows.find(
    (row) => row.kind === "tool-call" && row.toolCallId === "boom-call",
  );
  if (poisoned !== undefined) {
    Object.defineProperty(poisoned, "offloaded", {
      get(): never {
        throw new Error("boundary-probe: poisoned transcript row");
      },
    });
  }
  const report = (error: Error) => {
    const sink = window as Window & { __tfBoundaryProbeErrors?: string[] };
    (sink.__tfBoundaryProbeErrors ??= []).push(error.message);
  };
  return (
    <>
      <div
        data-tf-assistant=""
        className="tf:bg-tf-background tf:font-tf-sans tf:text-tf-foreground tf:flex tf:flex-col tf:gap-6 tf:p-4"
      >
        <p data-testid="host-alive">The host page is alive.</p>
        <section data-testid="poisoned-list">
          <SurfaceBoundary surface="message-list" onError={report}>
            <MessageList rows={rows} cards={[]} />
          </SurfaceBoundary>
        </section>
        <section data-testid="healthy-list">
          <SurfaceBoundary surface="message-list" onError={report}>
            <MessageList
              rows={transcriptRowsOf(CANNED_MESSAGES, CANNED_ANCHORS, false)}
              cards={[]}
            />
          </SurfaceBoundary>
        </section>
      </div>
      {/* OUTSIDE the data-tf-assistant div above — the chrome-root case,
          with garish host ink the fallback must NOT inherit. */}
      <section data-testid="chrome-root" style={{ color: "rgb(255, 0, 255)" }}>
        <SurfaceBoundary surface="page" onError={report}>
          <BoundaryBomb />
        </SurfaceBoundary>
      </section>
      {/* THE CARD MATRIX (round-6 ruling 1): the fallback is
          CASCADE-INDEPENDENT — inline literals, no theming root, no
          token chain — so every arm below must compute the SAME values,
          and the spec asserts them by computed style, never markup.
          Arms: chrome root on a dark host; interior of a LIGHT widget on
          a dark host page; interior of a DARK widget on a light host;
          interior of an auto widget under OS dark (spec emulates); and a
          hostile host stylesheet aiming straight at the card. */}
      <section
        data-testid="arm-chrome-dark-host"
        style={{ background: "#111111", color: "rgb(255, 0, 255)", padding: 8 }}
      >
        <SurfaceBoundary surface="page" onError={report}>
          <BoundaryBomb />
        </SurfaceBoundary>
      </section>
      <section
        data-testid="arm-interior-light-widget-dark-host"
        style={{ background: "#111111", padding: 8 }}
      >
        <div data-tf-assistant="" className="tf:bg-tf-background tf:p-2">
          <SurfaceBoundary surface="message-list" onError={report}>
            <BoundaryBomb />
          </SurfaceBoundary>
        </div>
      </section>
      <section data-testid="arm-interior-dark-widget-light-host">
        <div
          data-tf-assistant=""
          data-tf-theme="dark"
          className="tf:bg-tf-background tf:p-2"
        >
          <SurfaceBoundary surface="message-list" onError={report}>
            <BoundaryBomb />
          </SurfaceBoundary>
        </div>
      </section>
      <section data-testid="arm-interior-auto-widget">
        <div
          data-tf-assistant=""
          data-tf-theme="auto"
          className="tf:bg-tf-background tf:p-2"
        >
          <SurfaceBoundary surface="message-list" onError={report}>
            <BoundaryBomb />
          </SurfaceBoundary>
        </div>
      </section>
      <section data-testid="arm-hostile-host">
        {/* A host stylesheet aiming straight at the card, unlayered and
            AFTER the package sheet — the strongest non-!important attack
            a host can mount. Inline literals must still win. */}
        <style>{`
          [data-tf-surface-fallback] {
            color: rgb(255, 0, 255);
            background: rgb(0, 255, 0);
            border-radius: 0;
            font-family: serif;
          }
        `}</style>
        <SurfaceBoundary surface="page" onError={report}>
          <BoundaryBomb />
        </SurfaceBoundary>
      </section>
      {/* THE TOOL-VIEW RESET ARM (round-6 ruling 2): host DOM rendered
          inside the widget through the tool-view extension point must be
          styleable by the HOST — its layered utility must win over the
          sheet's unlayered border reset, which excludes
          [data-tf-host-view] subtrees. The sibling with the same class
          OUTSIDE the marker is the in-test control: the reset still owns
          widget DOM. Markup mirrors tool-view-slot.tsx; the unit pin
          that the slot really renders data-tf-host-view is
          tests/tool-views.test.tsx. */}
      <section data-testid="host-tool-view">
        <style>{`
          @layer host-utilities {
            .host-view-border {
              border: 2px solid rgb(210, 20, 20);
            }
          }
        `}</style>
        <div data-tf-assistant="" className="tf:p-2">
          <div data-tf-tool-view="acme.demo">
            <div data-tf-host-view="">
              <div data-testid="host-view-el" className="host-view-border">
                host content
              </div>
            </div>
          </div>
          {/* The renderChrome and PAGE-welcomeMark slots (round-7
              ruling 2): the SAME marker on the same mechanism —
              replicated markup per slot, with the real wiring pinned by
              unit tests (assistant-page / conversation-view render the
              marker). The companion welcome mark is deliberately absent
              from this list: it is package DOM, unmarked (round-7
              review, finding 1) — its replica is below. */}
          <div data-tf-host-view="" className="tf:contents">
            <div data-testid="host-chrome-el" className="host-view-border">
              host chrome
            </div>
          </div>
          <span data-tf-host-view="" className="tf:contents">
            <div data-testid="host-mark-el" className="host-view-border">
              host welcome mark
            </div>
          </span>
          {/* The companion welcome mark's replica (round-7 review,
              finding 1): package DOM, NO host-view marker — a bordered
              element under it must take the widget's reset, exactly like
              widget-el. Markup mirrors companion-drawer-body.tsx's
              mark span inside conversation-view's unmarked slot. */}
          <span data-tf-companion-welcome-mark="">
            <div data-testid="companion-mark-el" className="host-view-border">
              package welcome mark
            </div>
          </span>
          <div data-testid="widget-el" className="host-view-border">
            widget content
          </div>
        </div>
      </section>
      <HostAnimationsArm />
    </>
  );
}

// The keyframes-namespace arm (round-7 review, finding 3): the host
// defines its OWN @keyframes pulse/spin BEFORE the package sheet in
// document order (head-prepended — the sheet-loads-later order under
// which the package's old global pulse/spin definitions won). The
// package now ships only tf-named animations, so the host's must
// survive untouched while the package's own still run. All four
// elements pause at a fixed negative delay, so every assertion reads a
// deterministic mid-animation computed value.
function HostAnimationsArm() {
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent =
      "@keyframes pulse { 0%, 100% { opacity: 0.25; } }" +
      "@keyframes spin { 0%, 100% { opacity: 0.75; } }";
    document.head.prepend(style);
    return () => {
      style.remove();
    };
  }, []);
  return (
    <section data-testid="host-animations">
      <div
        data-testid="host-pulse-el"
        style={{ animation: "pulse 1s linear -0.5s infinite paused" }}
      >
        host pulse
      </div>
      <div
        data-testid="host-spin-el"
        style={{ animation: "spin 1s linear -0.5s infinite paused" }}
      >
        host spin
      </div>
      <div data-tf-assistant="">
        <span
          data-testid="widget-pulse-el"
          className="tf:animate-tf-pulse"
          style={{ animationDelay: "-1s", animationPlayState: "paused" }}
        >
          widget pulse
        </span>
        {/* A div, not a span: transform needs a box, and a display
            value string here would (rightly) trip the bare-candidate
            law in styles-prefix.test.ts. */}
        <div
          data-testid="widget-spin-el"
          className="tf:animate-tf-spin"
          style={{ animationDelay: "-0.25s", animationPlayState: "paused" }}
        >
          widget spin
        </div>
      </div>
    </section>
  );
}

const root = document.getElementById("root");
if (root !== null) {
  const params = new URLSearchParams(window.location.search);
  const scenario = params.get("scenario");
  let app = <Bench />;
  if (params.has("boundary-probe")) {
    app = <BoundaryProbe />;
  } else if (params.has("late-approval-probe")) {
    app = <LateApprovalResizeProbe />;
  } else if (params.has("late-suspension-probe")) {
    const hostParam = params.get("late-suspension-probe");
    app = (
      <LateSuspensionProbe
        host={
          hostParam === "constrained" || hostParam === "floating"
            ? hostParam
            : "page"
        }
      />
    );
  } else if (params.has("scroll-guards-probe")) {
    app = <ScrollGuardsProbe />;
  } else if (params.has("activity-shelf-probe")) {
    app = <ActivityShelfProbe />;
  } else if (params.has("subagent-defocus-probe")) {
    app = <SubagentDefocusProbe />;
  } else if (scenario !== null && isScenarioName(scenario)) {
    // The deterministic product scenarios — the URL contract is
    // docs/transcript-visual-contract.md §5. The bench page's hostile
    // host chrome (<main> at max-width 860px + 24px padding) is the
    // POINT for the bench baselines, but a scenario surface must receive
    // the real viewport width — the contract widths (390/672/1280) are
    // measured on the surface, and 1280 exercises the measure's
    // centering. Neutralized here, on scenario pages only, so the bench
    // and probe pages (and their committed baselines) are untouched.
    const main = document.querySelector("main");
    if (main !== null) {
      main.style.maxWidth = "none";
      main.style.padding = "0";
    }
    app = (
      <ScenarioRoot
        name={scenario}
        dark={params.get("theme") === "dark"}
        reduceMotion={params.has("reduce-motion")}
      />
    );
  }
  createRoot(root).render(<StrictMode>{app}</StrictMode>);
}
