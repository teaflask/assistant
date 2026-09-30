"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import {
  useAssistantAppearance,
  type AssistantRootProps,
} from "./appearance-context.js";
import { NO_GATE, type ConversationGate } from "../core/connect-gate.js";
import { ObservableCell } from "../core/observable-cell.js";
import {
  ConversationView,
  SetupErrorState,
  type AssistantSuggestionInput,
} from "./conversation-view.js";
import { useOptionalAssistantSession } from "./teaflask-assistant-provider.js";
import { useCell } from "./use-store-cell.js";
import {
  CompanionHeaderTitle,
  CompanionHistoryMenu,
} from "./companion-history-menu.js";
import { SurfaceBoundary } from "./surface-boundary.js";
import { ComposeIcon } from "./icons.js";
import { TfButton } from "./primitives/button.js";
import { cx } from "./primitives/cx.js";
import {
  useAssistantConversation,
  type AssistantConversation,
} from "./use-assistant-conversation.js";
import { useRegisterAssistantSurface } from "./use-register-assistant-surface.js";

// The no-provider fallback (bare-render tests): a frozen no-gate cell, so
// the hook order never bends. conversation-view holds the twin.
const NO_GATE_CELL = new ObservableCell<ConversationGate>(NO_GATE);

/**
 * What a host needs to build the surface's chrome somewhere of its own.
 * Handed to `renderChrome`; the history disclosure itself stays the
 * package's.
 */
export interface AssistantChrome {
  title: string;
  /** The active thread's title, falling back to the surface title. */
  conversationTitle: string;
  /** False for anonymous visitors — there is no history to open. */
  historyAvailable: boolean;
  historyOpen: boolean;
  historyMenuId: string;
  historyTriggerId: string;
  openHistory: () => void;
  toggleHistory: () => void;
  newConversation: () => void;
}

export interface AssistantPageProps {
  /**
   * Drops the surface's own card chrome (border and radius) so it sits
   * flush inside chrome the host already draws — a workbench pane, a
   * full-page route. The default keeps the self-contained card for
   * drop-in embeds.
   */
  frameless?: boolean;
  /**
   * Opening prompts shown beneath the composer before the first message;
   * clicking one sends it as if typed. Content belongs to the host —
   * the package ships none of its own.
   */
  suggestions?: readonly AssistantSuggestionInput[];
  /**
   * One message sent on the host's behalf, as if the visitor had typed it,
   * when this surface opens on an empty conversation. For a host that
   * already knows what the visitor came to do — a first run, a deep link
   * from elsewhere in the app — so they arrive mid-conversation instead of
   * facing a blank composer. Sent at most once per mount, never over an
   * existing thread, and never while the sign-in gate is up; the host owns
   * the one-shot condition, so a value that changes later does nothing.
   */
  initialPrompt?: string;
  /**
   * The invitation above an empty page composer. Hosts can give their
   * assistant a little voice here ("Let's plan"); the package's neutral
   * default remains suitable for a customer embed.
   */
  welcomeTitle?: string;
  /** Optional host mark shown beside the empty-state invitation. */
  welcomeMark?: ReactNode;
  /**
   * The surface's display name, shown in the package's own phone header.
   * The rail deliberately doesn't repeat it — whatever this is embedded
   * in has already said where you are. Hosts name it for their own site
   * ("Acme Help"); the neutral default is "Assistant".
   */
  title?: string;
  /**
   * Takes the phone header off the package's hands. A host whose own
   * chrome already spends a bar across the top of this surface can put
   * these controls in it instead of stacking a second row under it —
   * return portals and this renders nothing in place. Given the chrome's
   * callbacks rather than its markup, so the host's controls are the
   * host's; the disclosure they open stays here. Omit it and the package
   * draws its own strip, which is what a drop-in embed wants.
   */
  renderChrome?: (chrome: AssistantChrome) => ReactNode;
}

/**
 * The full-page surface: the shared conversation core with history as a
 * disclosure over it. Keeping history transient avoids manufacturing a
 * second permanent sidebar beside whatever navigation the host already
 * owns. Anonymous visitors have no history to disclose — the browser
 * holds exactly one thread — so they get only the same start-over action
 * the palette offers. Give it a sized container; it fills that box.
 *
 * The export is the boundary: a throw anywhere in this surface — its own
 * hooks included — degrades to the fallback card instead of unmounting
 * the host's tree. Unkeyed backstop: it clears when the host remounts
 * the surface; the granular boundaries inside recover on their own
 * identities.
 */
export function AssistantPage(props: AssistantPageProps) {
  return (
    <SurfaceBoundary surface="page">
      <AssistantPageInner {...props} />
    </SurfaceBoundary>
  );
}

function AssistantPageInner({
  frameless = false,
  suggestions,
  initialPrompt,
  title = "Assistant",
  welcomeTitle,
  welcomeMark,
  renderChrome,
}: AssistantPageProps) {
  const core = useAssistantConversation();
  useInitialPrompt(core, initialPrompt);
  // The provider's theme/mode props ride onto every data-tf-assistant
  // root as inline variables and the theme attribute.
  const { rootProps } = useAssistantAppearance();
  // Registered even in the setup-error branch: the error card still fills
  // the surface's box, so the companion must yield to it all the same.
  useRegisterAssistantSurface("full-surface");
  const {
    historyOpen,
    setHistoryOpen,
    historyMenuId,
    historyTriggerId,
    historyTriggerRef,
    openHistory,
    toggleHistory,
    startFresh,
  } = useHistoryDisclosure(core);
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty server title is the same visual gap as no title while a new thread is being named.
  const conversationTitle = core.conversation?.thread.title || title;

  if (core.setupError !== null) {
    return (
      <SetupErrorSurface
        rootProps={rootProps}
        frameless={frameless}
        setupError={core.setupError}
      />
    );
  }

  return (
    <div
      data-tf-assistant=""
      {...rootProps}
      className={cx(
        "tf:relative tf:flex tf:h-full tf:min-h-0 tf:w-full tf:overflow-hidden tf:bg-tf-background tf:text-tf-foreground",
        !frameless && "tf:rounded-tf tf:border",
      )}
    >
      <div className="tf:flex tf:min-h-0 tf:min-w-0 tf:flex-1 tf:flex-col">
        {/* A host with a bar of its own can take these controls through
            renderChrome. Otherwise the package spends one compact strip
            on them, which is what a drop-in page embed needs. */}
        {renderChrome === undefined ? (
          <PageHeaderStrip
            title={title}
            historyExpected={core.historyExpected}
            historyMenuId={historyMenuId}
            historyOpen={historyOpen}
            onHistoryOpenChange={setHistoryOpen}
            historyTriggerRef={historyTriggerRef}
            onNewConversation={startFresh}
          />
        ) : (
          // data-tf-host-view: renderChrome's output is HOST-authored
          // DOM inside the widget root — the sheet's box/border reset
          // excludes everything under this marker, so the host's own
          // utilities style the host's own chrome. The wrapper is
          // display:contents: no box, no layout change.
          <div data-tf-host-view="" className="tf:contents">
            {renderChrome({
              title,
              conversationTitle,
              historyAvailable: core.historyExpected,
              historyOpen,
              historyMenuId,
              historyTriggerId,
              openHistory,
              toggleHistory,
              newConversation: startFresh,
            })}
          </div>
        )}
        <ConversationView
          core={core}
          surface="page"
          suggestions={suggestions}
          welcomeTitle={welcomeTitle}
          welcomeMark={welcomeMark}
        />
      </div>
      {core.historyExpected && historyOpen ? (
        // Granular over the page backstop: the thread list renders server
        // data, and a bad row must cost the transient menu, not the page.
        // Reopening the disclosure remounts it (historyOpen unmounts on
        // close), which is what clears a latched card.
        <SurfaceBoundary surface="history-menu">
          <CompanionHistoryMenu
            id={historyMenuId}
            onClose={() => {
              setHistoryOpen(false);
            }}
            triggerRef={
              renderChrome === undefined ? historyTriggerRef : undefined
            }
            triggerId={
              renderChrome === undefined ? undefined : historyTriggerId
            }
            insetFromSurfaceTop={renderChrome !== undefined}
          />
        </SurfaceBoundary>
      ) : null}
    </div>
  );
}

/** The history disclosure's flag, ids and the actions the chrome exposes;
 *  starting a fresh conversation takes the disclosure down with it. */
function useHistoryDisclosure(core: AssistantConversation) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyMenuId = useId();
  const historyTriggerId = `${historyMenuId}-trigger`;
  const historyTriggerRef = useRef<HTMLButtonElement | null>(null);

  function openHistory() {
    setHistoryOpen(true);
  }
  function toggleHistory() {
    setHistoryOpen((open) => !open);
  }
  function startFresh() {
    setHistoryOpen(false);
    core.startNewConversation();
  }
  return {
    historyOpen,
    setHistoryOpen,
    historyMenuId,
    historyTriggerId,
    historyTriggerRef,
    openHistory,
    toggleHistory,
    startFresh,
  };
}

function SetupErrorSurface({
  rootProps,
  frameless,
  setupError,
}: {
  rootProps: AssistantRootProps;
  frameless: boolean;
  setupError: NonNullable<AssistantConversation["setupError"]>;
}) {
  return (
    <div
      data-tf-assistant=""
      {...rootProps}
      className={cx(
        "tf:flex tf:h-full tf:min-h-0 tf:w-full tf:items-center tf:justify-center tf:bg-tf-background tf:p-6",
        !frameless && "tf:rounded-tf tf:border",
      )}
    >
      <SetupErrorState message={setupError.message} code={setupError.code} />
    </div>
  );
}

/** The package's own header strip: the history disclosure (or a plain
 *  title for visitors with no history) and the new-conversation control. */
function PageHeaderStrip({
  title,
  historyExpected,
  historyMenuId,
  historyOpen,
  onHistoryOpenChange,
  historyTriggerRef,
  onNewConversation,
}: {
  title: string;
  historyExpected: boolean;
  historyMenuId: string;
  historyOpen: boolean;
  onHistoryOpenChange: (open: boolean) => void;
  historyTriggerRef: RefObject<HTMLButtonElement | null>;
  onNewConversation: () => void;
}) {
  return (
    <div className="tf:flex tf:h-14 tf:shrink-0 tf:items-center tf:gap-1 tf:border-b tf:pr-2 tf:pl-4">
      {historyExpected ? (
        <CompanionHeaderTitle
          menuId={historyMenuId}
          open={historyOpen}
          onOpenChange={onHistoryOpenChange}
          triggerRef={historyTriggerRef}
          fallbackTitle={title}
        />
      ) : (
        <h2 className="tf:min-w-0 tf:flex-1 tf:truncate tf:text-tf-heading tf:font-medium">
          {title}
        </h2>
      )}
      <TfButton
        variant="icon"
        aria-label="New conversation"
        title="New conversation"
        onClick={onNewConversation}
      >
        <ComposeIcon />
      </TfButton>
    </div>
  );
}

/**
 * Sends the host's opening message once, when this surface opens on an
 * empty conversation. Guarded on every reason a send would be wrong or
 * lost — a thread already exists, one is being opened, the setup failed,
 * the sign-in gate is up, or a send is already in flight — and latched by
 * a ref so a re-render can never send twice.
 *
 * The tier guard is what makes every other guard here mean anything. This
 * surface's effects run BEFORE its provider's (React commits a
 * descendant's first), and the provider's effect is where the session is
 * retained — which is what wires the identity resolver AND what bootstraps
 * the store. So on this effect's first pass nothing has happened yet: a
 * returning visitor's stored thread has not raised threadOpening, and an
 * identity-wired session has no registrant to ask for a vouch.
 *
 * Sending there does both harms at once. The mint goes out with nobody to
 * vouch, the session falls open to anonymous for its whole life, and the
 * thread this message creates belongs to a visitor the member never
 * becomes; meanwhile the stored thread resumes underneath and the greeting
 * has opened a second conversation over it.
 *
 * A non-null tier is the proof that bootstrap has run — the mint is its
 * first act — so waiting for one waits for the retain, whichever tier it
 * lands on and whether or not the host wired identity at all.
 */
function useInitialPrompt(
  core: AssistantConversation,
  prompt: string | undefined,
): void {
  const session = useOptionalAssistantSession();
  const gate = useCell(session?.conversationGate ?? NO_GATE_CELL);
  const tier = session?.tier ?? null;
  const sent = useRef(false);
  const { sendMessage, pendingSend } = core.composerContract;

  useEffect(() => {
    if (sent.current || prompt === undefined || prompt.trim() === "") {
      return;
    }
    if (
      core.setupError !== null ||
      core.conversation !== null ||
      core.threadOpening ||
      gate.kind !== "none" ||
      pendingSend ||
      tier === null
    ) {
      return;
    }
    sent.current = true;
    void sendMessage(prompt);
  }, [
    prompt,
    core.setupError,
    core.conversation,
    core.threadOpening,
    gate.kind,
    pendingSend,
    tier,
    sendMessage,
  ]);
}
