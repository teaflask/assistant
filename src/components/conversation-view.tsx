"use client";

import type { ReactNode } from "react";

import { NO_GATE, type ConversationGate } from "../core/connect-gate.js";
import { ObservableCell } from "../core/observable-cell.js";
import { Composer } from "./composer.js";
import {
  ConversationContext,
  useConversation,
} from "./conversation-context.js";
import { NoticeBanner, PendingDecisionGapNotice } from "./notice-banner.js";
import { useOptionalAssistantSession } from "./teaflask-assistant-provider.js";
import { useCell } from "./use-store-cell.js";
import {
  ArrowRightIcon,
  BookIcon,
  ComposeIcon,
  FlagIcon,
  SearchIcon,
} from "./icons.js";
import { TfButton } from "./primitives/button.js";
import { SurfaceBoundary } from "./surface-boundary.js";
import { Transcript } from "./transcript.js";
import type { AssistantConversation } from "./use-assistant-conversation.js";
import { MessageList } from "./message-list.js";
import { withPendingUserEcho } from "../core/transcript-rows.js";

// The no-provider fallback (welcome-branch tests render the view bare):
// a frozen no-gate cell, so the hook order never bends.
const NO_GATE_CELL = new ObservableCell<ConversationGate>(NO_GATE);

/**
 * Which of the four things the concierge does an opening prompt asks for.
 * The host writes the prompt; the package owns the glyph vocabulary, so a
 * customer's empty state can never drift off the icon set.
 */
export type AssistantSuggestionKind = "ask" | "review" | "write" | "learn";

export interface AssistantSuggestion {
  prompt: string;
  kind?: AssistantSuggestionKind;
}

/** A bare string is still accepted, and renders as an `ask`. */
export type AssistantSuggestionInput = string | AssistantSuggestion;

function _asSuggestion(input: AssistantSuggestionInput): AssistantSuggestion {
  return typeof input === "string" ? { prompt: input } : input;
}

/**
 * The conversation core's one render body: the honest error banners, the
 * streamed transcript (remounted per send — the whole reconnect story),
 * and the composer-carrying empty state. Both surfaces render exactly
 * this; they differ only in the chrome around it. `suggestions` seeds the
 * empty state with host-supplied opening prompts — content is the host's,
 * never the package's.
 */
export function ConversationView({
  core,
  surface,
  suggestions,
  welcomeTitle,
  welcomeMark,
}: {
  core: AssistantConversation;
  /** Which chrome this is ("page", "palette") — names the holder in the
   *  transcript lease, so a double-mount report says who collided. */
  surface: string;
  suggestions?: readonly AssistantSuggestionInput[];
  /** Host voice for the empty-state invitation. */
  welcomeTitle?: string;
  /** The empty state's identity mark — supplied by host chrome or by the
   *  companion drawer's own mark. */
  welcomeMark?: ReactNode;
}) {
  // The sign-in gate: an agent whose access requires an identified
  // visitor takes the whole conversation area — there is nothing an
  // anonymous visitor could type that would serve, so the surface says
  // so plainly instead of refusing sends one by one. The host site owns
  // sign-in; wiring getEndUserToken is what clears this.
  const session = useOptionalAssistantSession();
  const gate = useCell(session?.conversationGate ?? NO_GATE_CELL);
  return (
    // Deliberately re-provided from the explicit `core` prop even though
    // the provider now provisions the same store cell app-wide: the
    // value is identical in production (inner provider wins), and it
    // keeps this view mountable bare — the welcome-branch tests and any
    // host that drives the view with its own core depend on that. The
    // provider-level provision is the public, headless-facing one.
    <ConversationContext.Provider value={core.composerContract}>
      {/* min-h-0 is load-bearing: the message list is an internal
          overflow-y-auto viewport, so every ancestor in the flex chain
          must be allowed to shrink or the transcript grows past the
          surface instead of scrolling. relative anchors the drill-in
          panel, which covers exactly this box. */}
      <div
        // Named so the drawer can throw the whole conversation out of
        // focus behind a dropped-open header menu (styles.css).
        data-tf-conversation=""
        className="tf:relative tf:flex tf:min-h-0 tf:min-w-0 tf:flex-1 tf:flex-col"
      >
        <div data-tf-conversation-body="" className="tf:contents">
          {core.showInterruptionBanner ? (
            <NoticeBanner>
              The connection to the assistant was interrupted.
              <TfButton variant="ghost" onClick={core.retryStream}>
                Retry
              </TfButton>
            </NoticeBanner>
          ) : null}
          {core.sendError !== null ? (
            <NoticeBanner>{core.sendError}</NoticeBanner>
          ) : null}
          {/* The pending-decision gap: the server says the turn waits on
              interrupts this client could build nothing for. It must be
              LOUD — the generic wait label is gone, so silence here
              would hide a real pending decision — and recoverable: the
              retry re-reads the durable snapshot. */}
          {/* Truthiness on purpose: a partial stub's or older
              payload's `undefined` must read as no-gap — only
              a real gap object may ever mean "gap present".
              */}
          {core.pendingDecisionGap ? (
            <PendingDecisionGapNotice
              onRetry={() => {
                void core.refreshConversation();
              }}
            />
          ) : null}
          {/* The sentence stands alone: policy refusals and settled
            failures carry reader-aware copy of their own, and a "hit a
            problem" preamble turned every one of them into an apology. */}
          {core.turnFailure !== null ? (
            <NoticeBanner>{core.turnFailure}</NoticeBanner>
          ) : null}
          {gate.kind === "sign_in" ? (
            <div className="tf:flex tf:flex-1 tf:items-center tf:justify-center tf:p-6">
              <SignInRequiredState />
            </div>
          ) : core.threadOpening ? (
            <TranscriptSkeleton />
          ) : core.conversation !== null ? (
            // The top-level backstop: a throw anywhere in the
            // transcript composition degrades to a card, never into the
            // host's tree. The thread#nonce key rides the BOUNDARY, not
            // the child: a latched boundary never renders its children
            // again, so a key inside it is never reconciled and the
            // card would outlive every thread switch and Retry. Keyed
            // here, a switch or a reconnectNonce bump remounts boundary
            // and transcript together — the same full Transcript
            // remount the key always forced, now also discarding the
            // latched failure.
            <SurfaceBoundary
              key={`${core.conversation.thread.id}#${String(core.reconnectNonce)}`}
              surface="transcript"
            >
              <Transcript surface={surface} />
            </SurfaceBoundary>
          ) : (
            <SurfaceBoundary surface="welcome">
              <EmptyConversation
                surface={surface}
                // A gated conversation must not dangle live-looking opening
                // prompts over a card that says chatting is paused — a first
                // click that silently 403s reads as "the assistant is
                // broken".
                suggestions={gate.kind === "none" ? suggestions : undefined}
                welcomeTitle={welcomeTitle}
                welcomeMark={welcomeMark}
              />
            </SurfaceBoundary>
          )}
        </div>
      </div>
    </ConversationContext.Provider>
  );
}

// The access gate's whole-surface state: calm, never an error — the
// workspace's policy simply requires a signed-in visitor, and the
// host site owns the signing in. The "almost a 404" register: the
// surface exists, this visitor just isn't admitted yet.
function SignInRequiredState() {
  return (
    <div className="tf:max-w-md tf:text-center">
      <h2 className="tf:text-tf-heading tf:font-medium">
        This assistant is available to signed-in users.
      </h2>
      <p className="tf:mt-1 tf:text-tf-label tf:text-tf-muted-foreground">
        Sign in to this site to start chatting.
      </p>
    </div>
  );
}

// The shape of a conversation while its turns are on the wire: a "you"
// bubble and an answer column at the message rhythm, in the wash with no
// borders — a skeleton is an expectation, not a card. aria-hidden: the
// status story is the row that was clicked, not this placeholder.
// Exported for the fixture bench (never from the package barrel).
export function TranscriptSkeleton() {
  return (
    <div
      aria-hidden="true"
      data-tf-skeleton=""
      className="tf:min-h-0 tf:flex-1 tf:overflow-hidden tf:px-4 tf:py-6"
    >
      <div className="tf:mx-auto tf:flex tf:w-full tf:max-w-3xl tf:flex-col tf:gap-6">
        <div className="tf:flex tf:justify-end">
          <div className="tf:h-8 tf:w-2/5 tf:rounded-xl tf:bg-tf-muted" />
        </div>
        <div className="tf:flex tf:flex-col tf:gap-2">
          <div className="tf:h-4 tf:w-full tf:rounded-tf tf:bg-tf-muted" />
          <div className="tf:h-4 tf:w-11/12 tf:rounded-tf tf:bg-tf-muted" />
          <div className="tf:h-4 tf:w-3/5 tf:rounded-tf tf:bg-tf-muted" />
        </div>
        <div className="tf:flex tf:justify-end">
          <div className="tf:h-8 tf:w-1/4 tf:rounded-xl tf:bg-tf-muted" />
        </div>
        <div className="tf:flex tf:flex-col tf:gap-2">
          <div className="tf:h-4 tf:w-10/12 tf:rounded-tf tf:bg-tf-muted" />
          <div className="tf:h-4 tf:w-1/2 tf:rounded-tf tf:bg-tf-muted" />
        </div>
      </div>
    </div>
  );
}

// Loud, developer-facing: a broken key, origin allowlist, or end-user
// signer must be impossible to miss during integration.
export function SetupErrorState({
  message,
  code,
}: {
  message: string;
  code: string;
}) {
  return (
    <div className="tf:max-w-md tf:text-center">
      <h2 className="tf:text-tf-heading tf:font-medium">
        The assistant couldn&apos;t connect
      </h2>
      <p className="tf:mt-1 tf:text-tf-label tf:text-tf-muted-foreground">
        {message}
      </p>
      <p className="tf:mt-2 tf:font-mono tf:text-xs tf:text-tf-muted-foreground">
        {code}
      </p>
    </div>
  );
}

// The first-run screen is the conversation's focal point: one question at
// the display step, the chat bar as its floor, and the host's opening
// prompts beneath. A mark above the question only where the surface has an
// identity to show — the companion drawer passes its mark; the palette
// and page stay markless. No subtitle: "answers come from the docs" is a
// claim, and the prompts are the demonstration.
function EmptyConversation({
  surface,
  suggestions,
  welcomeTitle = "Where should we begin?",
  welcomeMark,
}: {
  surface: string;
  suggestions?: readonly AssistantSuggestionInput[];
  welcomeTitle?: string;
  welcomeMark?: ReactNode;
}) {
  const { pendingEcho } = useConversation();
  const pendingRows = withPendingUserEcho([], pendingEcho);
  // The surface name — already here as the transcript lease's holder
  // label — is what says which chrome this is. The drawer gets the
  // bottom-anchored welcome; the palette and page keep the centered one.
  if (surface === "companion") {
    return (
      <CompanionWelcome
        suggestions={suggestions}
        welcomeTitle={welcomeTitle}
        welcomeMark={welcomeMark}
        pendingRows={pendingRows}
      />
    );
  }
  return (
    <div
      className={
        "tf:flex tf:min-h-0 tf:flex-1 tf:flex-col " +
        (pendingEcho === null ? "tf:overflow-y-auto" : "")
      }
    >
      {/* Auto margins, not justify-center: centered flex content that
          overflows a short container pushes past the scroll origin and
          the top becomes unreachable — margins center at rest and let
          the overflow scroll from the top. The lopsided padding is the
          optical lift: centring the taller box carries the visible
          content ~32px above true centre, which is where a placed thing
          sits and dead centre is where an adrift one does. */}
      <div
        className={
          pendingEcho === null
            ? "tf:my-auto tf:flex tf:w-full tf:flex-col tf:pt-4 tf:pb-16"
            : "tf:contents"
        }
      >
        {pendingEcho !== null ? (
          // Bare `live`: this branch exists only while the send is in
          // flight, and the standalone "Working…" headline must claim the
          // beat from the instant of submit — the store sets the turn before
          // sendMessage's finally clears pendingSend, so the handoff to
          // Transcript has no dead frame.
          <SurfaceBoundary surface="message-list">
            <MessageList rows={pendingRows} cards={[]} live />
          </SurfaceBoundary>
        ) : (
          <div className="tf:flex tf:items-center tf:justify-center tf:gap-2 tf:px-6 tf:pb-5 tf:text-center">
            {/* The display step (30px/600/-0.04em), earned:
              this is the one headline on an otherwise empty surface, and
              at the 15px section step it read as a caption for nothing. */}
            {/* data-tf-host-view: THIS mark is
                host-authored DOM — it reaches here only through the
                public AssistantPageProps.welcomeMark (assistant-page.tsx
                forwards it; the palette exposes no such prop) — so the
                reset must not capture it. The span is display:contents:
                no box. The companion branch below stays unmarked: its
                mark carries the marker itself, around a host node alone. */}
            <span data-tf-host-view="" className="tf:contents">
              {welcomeMark}
            </span>
            <h2 className="tf:text-3xl tf:font-semibold tf:tracking-[-0.04em] tf:text-balance">
              {welcomeTitle}
            </h2>
          </div>
        )}
        <SurfaceBoundary surface="composer">
          <Composer compact={pendingEcho === null} surface={surface} />
        </SurfaceBoundary>
        {pendingEcho === null &&
        suggestions !== undefined &&
        suggestions.length > 0 ? (
          <div className="tf:px-4 tf:pb-4">
            <div className="tf:mx-auto tf:flex tf:w-full tf:max-w-xl tf:flex-col">
              <SuggestionRows suggestions={suggestions} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// The drawer's edition of the welcome, compose-window anatomy: the mark,
// the question, and the prompts centered in the flexible upper space;
// the composer pinned to the panel's bottom edge — the same relationship
// it has to a live transcript, so sending the first message moves
// nothing under the caret.
function CompanionWelcome({
  suggestions,
  welcomeTitle,
  welcomeMark,
  pendingRows,
}: {
  suggestions?: readonly AssistantSuggestionInput[];
  welcomeTitle: string;
  welcomeMark?: ReactNode;
  pendingRows: ReturnType<typeof withPendingUserEcho>;
}) {
  return (
    // Its own inline-size container, deliberately NOT the panel: sizing
    // the welcome against its measure must not leak containment onto
    // the popover geometry or the shared palette/page markup above.
    <div className="tf:@container tf:flex tf:min-h-0 tf:min-w-0 tf:flex-1 tf:flex-col">
      {pendingRows.length > 0 ? (
        // Bare `live`, same reason as EmptyConversation's echo branch:
        // this renders only mid-send, and the echo must carry the
        // standalone Working… headline until Transcript takes over.
        <SurfaceBoundary surface="message-list">
          <MessageList rows={pendingRows} cards={[]} live />
        </SurfaceBoundary>
      ) : (
        <div className="tf:flex tf:min-h-0 tf:flex-1 tf:flex-col tf:overflow-y-auto">
          {/* Auto margins, not justify-center: centered flex content that
            overflows a short container pushes past the scroll origin and
            the top becomes unreachable — margins center at rest and let
            the overflow scroll from the top. The padding bias is the
            optical placement, re-measured for this anatomy and split by
            what the host sent: with opening prompts the stack fills
            downward toward the composer and rests a step above center,
            where a placed thing sits; without them (the sparser screen)
            the same lift left the greeting adrift over a void, so the
            stack drops a step below center instead — the question
            visibly belongs to the chat bar that answers it. */}
          <div
            className={
              suggestions !== undefined && suggestions.length > 0
                ? "tf:my-auto tf:flex tf:w-full tf:flex-col tf:pt-4 tf:pb-6"
                : "tf:my-auto tf:flex tf:w-full tf:flex-col tf:pt-16 tf:pb-6"
            }
          >
            <div className="tf:flex tf:justify-center">
              {/* Deliberately NOT a data-tf-host-view slot: the companion
                  branch's only caller is companion-drawer-body.tsx, which
                  passes the package's CompanionMark. That component marks
                  the host's node alone (companion-mark.tsx), so the default
                  flask stays package DOM under the sheet's box-sizing +
                  border-color reset. Marking the whole slot would exempt
                  package DOM and expose it to the host cascade. */}
              {welcomeMark}
            </div>
            <div className="tf:px-6 tf:pt-3 tf:pb-5 tf:text-center">
              {/* The display step, chosen against its measure: 24px in the
                compose-proportioned drawer, one step down when the drawer
                is a phone-width card (the @container query reads the
                drawer's actual measure — phone-width gets the narrow
                treatment for free). */}
              <h2 className="tf:text-xl tf:font-semibold tf:tracking-[-0.04em] tf:text-balance tf:@md:text-2xl">
                {welcomeTitle}
              </h2>
            </div>
            {suggestions !== undefined && suggestions.length > 0 ? (
              <div className="tf:px-4">
                <div className="tf:mx-auto tf:flex tf:w-full tf:max-w-3xl tf:flex-col">
                  <SuggestionRows suggestions={suggestions} />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
      <div className="tf:shrink-0">
        {/* This welcome renders only on the companion branch (the
            surface === "companion" fork above), so the caret-return
            identity is a constant here. */}
        <SurfaceBoundary surface="composer">
          <Composer surface="companion" />
        </SurfaceBoundary>
      </div>
    </div>
  );
}

/** @public — read by the frontend's assistant-mirror parity test, not by an
 *  entry point: the serving kind enum and this glyph table never drift apart. */
export const SUGGESTION_MARKS: Record<
  AssistantSuggestionKind,
  () => ReactNode
> = {
  ask: SearchIcon,
  review: FlagIcon,
  write: ComposeIcon,
  learn: BookIcon,
};

// The kind is host data, and the script-tag distribution's hosts are plain
// JS — nothing type-checks their suggestion objects. An unrecognized kind
// takes the default glyph instead of rendering `undefined` as a component.
// The parameter is `string`, not the union, on purpose: inside this
// function the value is untrusted. Own-property lookup, not plain indexing:
// an untrusted key naming something on Object.prototype ("constructor")
// would resolve to the inherited member — truthy — and hand React a non-component.
function _suggestionMarkOf(kind: string | undefined): () => ReactNode {
  const named = kind ?? "ask";
  return Object.hasOwn(SUGGESTION_MARKS, named)
    ? SUGGESTION_MARKS[named as AssistantSuggestionKind]
    : SUGGESTION_MARKS.ask;
}

// Opening prompts, as rows in the composer's own column, not pills: three
// pills of unequal width read as debris and wrap into a pile at 390px (and
// inside the companion drawer's 384px column a sentence-length prompt wraps
// inside its own pill). Rows share the composer's left edge, and the
// leading glyph keeps them from reading as autocomplete.
function SuggestionRows({
  suggestions,
}: {
  suggestions: readonly AssistantSuggestionInput[];
}) {
  const { busy, sendMessage } = useConversation();
  return (
    <>
      {suggestions.map(_asSuggestion).map((suggestion) => {
        const Mark = _suggestionMarkOf(suggestion.kind);
        return (
          <TfButton
            key={suggestion.prompt}
            variant="prompt"
            disabled={busy}
            onClick={() => {
              void sendMessage(suggestion.prompt);
            }}
          >
            <span data-tf-prompt-mark="" className="tf:flex tf:shrink-0">
              <Mark />
            </span>
            {/* Two lines before the cut, never one: clicking a row sends
                its words verbatim as the user's own message, so the row
                must show enough of the sentence to commit to. */}
            <span className="tf:min-w-0 tf:flex-1 tf:line-clamp-2">
              {suggestion.prompt}
            </span>
            <span
              data-tf-prompt-go=""
              className="tf:flex tf:shrink-0 tf:text-tf-muted-foreground"
            >
              <ArrowRightIcon />
            </span>
          </TfButton>
        );
      })}
    </>
  );
}
