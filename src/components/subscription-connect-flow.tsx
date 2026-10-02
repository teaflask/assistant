"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

import {
  subscriptionConnectMessageOf,
  type SubscriptionAuthorization,
  type SubscriptionProvider,
  type SubscriptionStatus,
} from "../contract/subscriptions.js";
import {
  beginSubscriptionAuthorization,
  completeSubscriptionAuthorization,
  disconnectSubscription,
} from "../transport/serving-api.js";
import { ServingApiError } from "../transport/serving-error.js";
import type { TokenSession } from "../transport/token-session.js";
import { OpenAiMarkIcon } from "./icons.js";
import { TfButton, TfLinkButton } from "./primitives/button.js";
import { ConnectedStanding } from "./subscription-connected-standing.js";

// The Sign in with ChatGPT connect engine, chrome-free: the begin →
// open-the-popup → wait → complete machinery plus its presentational
// arms, shared by every surface that hosts a connect — the provider
// chip's menu on the composer shelf and the conversation gate card in
// the composer's place. The hosting surface owns positioning and
// dismissal. The server's callback page posts the provider's code back
// to this window (the opener); the listener below finishes the sign-in
// under this visitor's own bearer, which is what binds the finish to the
// browser that began it.

const _PROVIDER_NAMES: Partial<Record<SubscriptionProvider, string>> = {
  openai_chatgpt: "ChatGPT",
};

/** The provider's visitor-facing name; the wire value stands in for a
 *  provider this build predates (the contract grows additively). */
export function providerNameOf(provider: SubscriptionProvider): string {
  return _PROVIDER_NAMES[provider] ?? provider;
}

// One line, shown before connecting and on the connected state alike —
// what the visitor is agreeing to, in their own terms.
export const DISCLOSURE_LINE =
  "Conversations here will use your ChatGPT plan's included usage.";

// While a fresh credential verifies, re-read the standing at a gentle
// pace so the surface shows the settle live. One-shot and re-armed by the
// re-render each answer causes — never an interval.
const _VERIFYING_REFRESH_MS = 4000;

// The popup the authorize URL opens in — the measured shape through
// which window.opener survives the round trip to the provider.
const _POPUP_FEATURES = "popup,width=520,height=720";

// What the error arm says when the sign-in's own lifetime ran out, when
// the provider declined it (the measured Plus/Pro rule), and when the
// return leg carried no code.
const _SIGN_IN_EXPIRED_SENTENCE =
  "The sign-in took too long and has expired. Start it again.";
const _SIGN_IN_DECLINED_SENTENCE =
  "Not connected. Using your ChatGPT plan here needs ChatGPT Plus or Pro on a personal account.";
const _SIGN_IN_FAILED_SENTENCE =
  "ChatGPT didn't finish the sign-in. Try again.";

// The standing re-read's own bound: a failed GET leaves the cell (and so
// the hosting component) unchanged, so the chain re-arms itself up to
// this many times per settled render — a lone blip must not stall
// "verifying" until the surface remounts.
const _MAX_VERIFYING_REFRESH_ATTEMPTS = 5;

type ConnectFlowState =
  | { kind: "idle" }
  | { kind: "starting" }
  // The popup is open (or its link offered); the flow leaves this arm
  // when the callback page's message arrives, at expiry, or on Start over.
  | { kind: "waiting"; authorization: SubscriptionAuthorization }
  // The code is being redeemed under this visitor's bearer.
  | { kind: "completing" }
  // The completion answered but the refreshed standing hasn't landed
  // yet: hold a verifying presentation — never flash the Connect button
  // (or a stale pre-connect standing) at a visitor who just approved.
  // `before` is the status identity seen at completion: only a READ
  // that actually landed after it (a fresh object from the refetch) may
  // exit the flow — bounced included, since the probe can settle before
  // the read lands and its outcome must show.
  | { kind: "landed"; before: SubscriptionStatus }
  // The disconnect's mirror: the row is gone server-side but the
  // refreshed standing hasn't landed — hold a "Disconnected."
  // presentation, never a stale "Connected — … plan".
  | { kind: "removed"; before: SubscriptionStatus }
  | { kind: "error"; sentence: string };

interface SubscriptionConnectFlow {
  flow: ConnectFlowState;
  /** True while an in-progress flow's presentation must win over the
   *  stored standing (see the render-time reconciliation notes). */
  flowInProgress: boolean;
  errorSentence: string | null;
  begin: () => void;
  disconnect: () => void;
  /** The waiting arm's quiet exit: abandons the sign-in (it costs
   *  nothing server-side and expires on its own) and returns to idle —
   *  a mistaken click must not trap the visitor until expiry. */
  cancel: () => void;
}

/** The whole connect machine as one hook: the begin that opens the
 *  popup, the listener for the callback page's message and the
 *  completion it drives, the verifying re-read chain, and the
 *  render-time flow/standing reconciliation. The hosting surface renders
 *  the arms below off its answer. */
export function useSubscriptionConnectFlow(
  status: SubscriptionStatus,
  session: TokenSession,
  refreshSubscriptions: () => void,
): SubscriptionConnectFlow {
  const [flow, setFlow] = useState<ConnectFlowState>({ kind: "idle" });
  // One request in flight at a time — a begin double-click or a begin
  // overlapping a disconnect would race the flow state.
  const busyRef = useRef(false);
  // What the disconnect captures as "the standing before my outcome" —
  // an effect-updated ref so the async callback reads the render that
  // actually painted, not a stale closure.
  const latestStatusRef = useRef(status);
  useEffect(() => {
    latestStatusRef.current = status;
  });
  // The callback page's relay: while the popup is open, one message from
  // the server's origin either carries the code (redeemed here, under
  // this visitor's bearer) or says the consent was declined or the
  // return leg failed. Anything else is not the page talking.
  useEffect(() => {
    if (flow.kind !== "waiting") {
      return;
    }
    return _listenForTheCallback({
      session,
      provider: status.provider,
      busyRef,
      latestStatusRef,
      refreshSubscriptions,
      setFlow,
    });
  }, [flow, session, status.provider, refreshSubscriptions]);

  // While the surface holds a presentation awaiting a refreshed read — a
  // verifying row, a landed completion, or a removed flow whose refetch
  // hasn't answered — re-read at a gentle pace so the outcome shows
  // live. A successful read re-renders the host (fresh status identity)
  // and restarts the chain; a FAILED read changes nothing, so the chain
  // re-arms itself — bounded — instead of stalling on one transient GET.
  const holdsAPresentationAwaitingARead =
    status.state === "verifying" ||
    flow.kind === "landed" ||
    flow.kind === "removed";
  useEffect(() => {
    if (!holdsAPresentationAwaitingARead) {
      return;
    }
    return _pollStatus(refreshSubscriptions);
  }, [holdsAPresentationAwaitingARead, status, refreshSubscriptions]);

  // The sign-in stays claimable for expires_in; past it the callback can
  // only render its expired page, so the wait ends in the error arm
  // instead of standing for the life of the page after an abandoned
  // popup.
  useEffect(() => {
    if (flow.kind !== "waiting") {
      return;
    }
    const expiry = window.setTimeout(() => {
      setFlow({ kind: "error", sentence: _SIGN_IN_EXPIRED_SENTENCE });
    }, flow.authorization.expires_in * 1000);
    return () => {
      window.clearTimeout(expiry);
    };
  }, [flow]);

  const wires: ConnectWires = {
    session,
    provider: status.provider,
    busyRef,
    latestStatusRef,
    refreshSubscriptions,
    setFlow,
  };

  const errorSentence = flow.kind === "error" ? flow.sentence : null;
  // A reconnect (a bounced credential's second try) must show the wait:
  // an in-progress flow wins over the stored standing, whatever row
  // exists — EXCEPT a standing that is the flow's own outcome. A LANDED
  // (or removed) flow yields to any standing the refetch actually
  // delivered AFTER it — bounced included (the probe can settle bounced
  // before the read lands; its outcome must exit into the reconnect
  // presentation) — but never to the standing it captured, which on a
  // reconnect is the OLD bounced row: dropping to it would tell a
  // visitor who just approved that their connection stopped working.
  // Before completion a connected standing that isn't bounced still
  // supersedes the flow (a credential that exists must never be denied).
  // Render-time adjustment, the sanctioned shape.
  const flowInProgress =
    flow.kind === "starting" ||
    flow.kind === "waiting" ||
    flow.kind === "completing" ||
    flow.kind === "landed" ||
    flow.kind === "removed";
  if (flow.kind === "removed" || flow.kind === "landed") {
    if (status !== flow.before) {
      setFlow({ kind: "idle" });
    }
  } else if (status.connected && flowInProgress && status.state !== "bounced") {
    setFlow({ kind: "idle" });
  }

  return {
    flow,
    flowInProgress,
    errorSentence,
    begin: () => void _begin(wires),
    disconnect: () => void _disconnect(wires),
    cancel: () => {
      setFlow({ kind: "idle" });
    },
  };
}

/** The wires the begin, the disconnect and the callback listener share
 *  with their hook. */
interface ConnectWires {
  session: TokenSession;
  provider: SubscriptionProvider;
  busyRef: RefObject<boolean>;
  latestStatusRef: RefObject<SubscriptionStatus>;
  refreshSubscriptions: () => void;
  setFlow: Dispatch<SetStateAction<ConnectFlowState>>;
}

/** The begin: mint the sign-in, open its authorize URL in a popup, and
 *  enter the waiting arm; a refused begin lands in the error arm. One
 *  request at a time — a double-click is ignored. */
async function _begin(wires: ConnectWires): Promise<void> {
  const { busyRef, setFlow } = wires;
  if (busyRef.current) {
    return;
  }
  busyRef.current = true;
  setFlow({ kind: "starting" });
  try {
    const authorization = await beginSubscriptionAuthorization(
      wires.session,
      wires.provider,
    );
    // Opened once the begin answers, so a strict popup blocker may
    // refuse it; the waiting arm repeats the URL as a link for that
    // case. Both keep window.opener: the callback page posts to it, and
    // the listener accepts either window — the origin, not the window,
    // is what identifies the page.
    window.open(authorization.authorize_url, "_blank", _POPUP_FEATURES);
    setFlow({ kind: "waiting", authorization });
  } catch (error) {
    setFlow({ kind: "error", sentence: _sentenceOf(error) });
  } finally {
    busyRef.current = false;
  }
}

/** The disconnect: remove the stored credential, refresh the standing,
 *  and hold a "Disconnected." presentation until a read that landed
 *  after the removal renders. */
async function _disconnect(wires: ConnectWires): Promise<void> {
  const { busyRef, latestStatusRef, refreshSubscriptions, setFlow } = wires;
  if (busyRef.current) {
    return;
  }
  busyRef.current = true;
  try {
    await disconnectSubscription(wires.session, wires.provider);
    refreshSubscriptions();
    // The landed treatment, mirrored: hold until a read that landed
    // after the removal renders — a failed refetch must not leave a
    // stale "Connected" (the bounded re-read chain covers this state).
    setFlow({ kind: "removed", before: latestStatusRef.current });
  } catch (error) {
    setFlow({ kind: "error", sentence: _sentenceOf(error) });
  } finally {
    busyRef.current = false;
  }
}

/** The listener's effect body: accept one message from the server's
 *  origin for this flow's provider — from the popup or the fallback
 *  link's tab alike — then redeem the code under this visitor's bearer
 *  or land in the error arm. Returns the effect's cleanup. */
function _listenForTheCallback(wires: ConnectWires): () => void {
  const { busyRef, latestStatusRef, refreshSubscriptions, setFlow } = wires;
  // Resolved against the document: a same-origin relative base ("/api")
  // is a legal configuration everywhere else, which only concatenates it.
  const serverOrigin = new URL(wires.session.baseUrl, window.location.href)
    .origin;
  const complete = async (request: {
    code: string;
    state: string;
    client_id: string | null;
  }) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setFlow({ kind: "completing" });
    try {
      await completeSubscriptionAuthorization(
        wires.session,
        wires.provider,
        request,
      );
      // The credential exists server-side the moment this answers; the
      // session-cached standing must learn it even if the surface is
      // dismissed before the read lands.
      refreshSubscriptions();
      setFlow({ kind: "landed", before: latestStatusRef.current });
    } catch (error) {
      setFlow({ kind: "error", sentence: _sentenceOf(error) });
    } finally {
      busyRef.current = false;
    }
  };
  const onMessage = (event: MessageEvent) => {
    const message = subscriptionConnectMessageOf(
      event,
      serverOrigin,
      wires.provider,
    );
    if (message === null) {
      return;
    }
    if (message.kind === "code") {
      void complete({
        code: message.code,
        state: message.state,
        client_id: message.client_id,
      });
      return;
    }
    setFlow({
      kind: "error",
      sentence:
        message.kind === "denied"
          ? _SIGN_IN_DECLINED_SENTENCE
          : _SIGN_IN_FAILED_SENTENCE,
    });
  };
  window.addEventListener("message", onMessage);
  return () => {
    window.removeEventListener("message", onMessage);
  };
}

/** The verifying re-read chain's effect body: re-read the standing at a
 *  gentle pace, re-arming itself up to the bound. Returns the cleanup. */
function _pollStatus(refreshSubscriptions: () => void): () => void {
  let attempts = 0;
  let timer: number | undefined;
  const arm = () => {
    timer = window.setTimeout(() => {
      attempts += 1;
      refreshSubscriptions();
      if (attempts < _MAX_VERIFYING_REFRESH_ATTEMPTS) {
        arm();
      }
    }, _VERIFYING_REFRESH_MS);
  };
  arm();
  return () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }
  };
}

/** One provider's whole connect surface: an optional heading, the
 *  disclosure line, then the connected standing or the flow arms — the
 *  block both the provider chip's menu and the gate card compose. The
 *  Linear-measured hierarchy (owner ruling 2026-08-20): one 15px title,
 *  one muted line, one intrinsic-width action — never a stack of
 *  same-weight sentences over a stretched pill. `idleHeading` is the
 *  hosting surface's ask; a flow that reaches the sign-in wait swaps
 *  it for the wait's own headline, because the card must visibly change
 *  state. */
export function ProviderConnectSection({
  status,
  session,
  refreshSubscriptions,
  beginLabel,
  idleHeading,
}: {
  status: SubscriptionStatus;
  session: TokenSession;
  refreshSubscriptions: () => void;
  beginLabel?: string;
  idleHeading?: string;
}) {
  const name = providerNameOf(status.provider);
  const connect = useSubscriptionConnectFlow(
    status,
    session,
    refreshSubscriptions,
  );
  const waiting = connect.flow.kind === "waiting";
  return (
    <section
      className="tf:flex tf:flex-col tf:gap-2"
      aria-label={`Connect ${name}`}
    >
      {waiting || idleHeading === undefined ? null : (
        <p className="tf:m-0 tf:flex tf:items-center tf:gap-2 tf:text-tf-heading tf:font-medium tf:text-tf-foreground">
          <OpenAiMarkIcon />
          {idleHeading}
        </p>
      )}
      {/* The waiting arm leads with its own headline instead — one
          focal point per state, never two competing lines. */}
      {waiting || (status.connected && !connect.flowInProgress) ? null : (
        <p className="tf:m-0 tf:text-tf-label tf:text-tf-muted-foreground">
          {DISCLOSURE_LINE}
        </p>
      )}
      {status.connected && !connect.flowInProgress ? (
        <ConnectedStanding
          name={name}
          status={status}
          errorSentence={connect.errorSentence}
          onReconnect={connect.begin}
          onDisconnect={connect.disconnect}
        />
      ) : (
        <ConnectFlow
          name={name}
          flow={connect.flow}
          errorSentence={connect.errorSentence}
          onBegin={connect.begin}
          onCancel={connect.cancel}
          beginLabel={beginLabel}
        />
      )}
    </section>
  );
}

export function ConnectFlow({
  name,
  flow,
  errorSentence,
  onBegin,
  onCancel,
  beginLabel,
}: {
  name: string;
  flow: ConnectFlowState;
  errorSentence: string | null;
  onBegin: () => void;
  onCancel: () => void;
  /** The idle arm's call to action; defaults to the sign-in verb. */
  beginLabel?: string;
}) {
  if (flow.kind === "removed") {
    // Gone server-side; the refreshed standing is on its way.
    return (
      <p
        className="tf:m-0 tf:text-tf-label tf:text-tf-muted-foreground"
        role="status"
      >
        Disconnected.
      </p>
    );
  }
  if (flow.kind === "landed") {
    // Approved and saved; the refreshed standing is on its way.
    return (
      <p
        className="tf:m-0 tf:flex tf:items-center tf:gap-1.5 tf:text-tf-label tf:text-tf-muted-foreground"
        role="status"
      >
        <span
          aria-hidden
          className="tf:size-1.5 tf:shrink-0 tf:animate-tf-pulse tf:rounded-full tf:bg-tf-foreground tf:motion-reduce:animate-none"
        />
        Verifying your {name} connection…
      </p>
    );
  }
  if (flow.kind === "waiting") {
    return (
      <WaitingForApproval
        name={name}
        authorization={flow.authorization}
        onCancel={onCancel}
      />
    );
  }
  return (
    <div className="tf:flex tf:flex-col tf:gap-2">
      {errorSentence === null ? null : (
        // role="alert": the hosting surface may keep focus elsewhere, so
        // without an announcement the sentence is invisible to a
        // screen-reader user (the package's error register).
        <p
          className="tf:m-0 tf:text-tf-label tf:text-tf-destructive"
          role="alert"
        >
          {errorSentence}
        </p>
      )}
      <TfButton
        variant="primary"
        className="tf:self-start"
        onClick={onBegin}
        disabled={flow.kind === "starting" || flow.kind === "completing"}
      >
        {flow.kind === "starting" || flow.kind === "completing"
          ? `Connecting ${name}…`
          : flow.kind === "error"
            ? `Try connecting ${name} again`
            : (beginLabel ?? `Sign in with ${name}`)}
      </TfButton>
    </div>
  );
}

/** The waiting arm: the sign-in's own headline, the URL again as a
 *  link (the popup may have been blocked), the heartbeat and the quiet
 *  exit. */
function WaitingForApproval({
  name,
  authorization,
  onCancel,
}: {
  name: string;
  authorization: SubscriptionAuthorization;
  onCancel: () => void;
}) {
  return (
    <div className="tf:flex tf:flex-col tf:gap-2">
      {/* The state must visibly change: the ask's headline swaps for
          the sign-in's own. */}
      <p className="tf:m-0 tf:text-tf-heading tf:font-medium tf:text-tf-foreground">
        Finish signing in to {name}
      </p>
      <p className="tf:m-0 tf:text-tf-label tf:text-tf-muted-foreground">
        Finish signing in to {name} in the window that opened. If no window
        opened, use the link below.
      </p>
      {/* rel="opener" on purpose: target="_blank" would sever
          window.opener by default, and the callback page posts its
          outcome to the opener. The referrer is withheld separately. */}
      <TfLinkButton
        href={authorization.authorize_url}
        target="_blank"
        rel="opener"
        referrerPolicy="no-referrer"
        className="tf:self-start"
      >
        Open {name}
      </TfLinkButton>
      <p
        className="tf:m-0 tf:flex tf:items-center tf:gap-1.5 tf:text-tf-label tf:text-tf-muted-foreground"
        role="status"
      >
        {/* The live-run heartbeat idiom (streaming-states.tsx): a
            static muted ellipsis over busy glass reads as decoration. */}
        <span
          aria-hidden
          className="tf:size-1.5 tf:shrink-0 tf:animate-tf-pulse tf:rounded-full tf:bg-tf-foreground tf:motion-reduce:animate-none"
        />
        Waiting for {name}…
      </p>
      {/* The mistaken click's quiet exit: abandoning a sign-in costs
          nothing server-side (it expires inside its own state). */}
      <TfButton variant="ghost" className="tf:self-start" onClick={onCancel}>
        Start over
      </TfButton>
    </div>
  );
}

function _sentenceOf(error: unknown): string {
  if (error instanceof ServingApiError) {
    // The contract guarantees the server's message is a human sentence
    // safe to show (the not-offered, provider-down, and storage codes
    // all carry their own).
    return error.message;
  }
  return "Something went wrong. Try again.";
}
