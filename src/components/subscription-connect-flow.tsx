"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

import type {
  SubscriptionDeviceAuthorization,
  SubscriptionProvider,
  SubscriptionStatus,
} from "../contract/subscriptions.js";
import {
  beginSubscriptionDeviceAuthorization,
  disconnectSubscription,
  pollSubscriptionDeviceAuthorization,
} from "../transport/serving-api.js";
import { ServingApiError } from "../transport/serving-error.js";
import type { TokenSession } from "../transport/token-session.js";
import { OpenAiMarkIcon } from "./icons.js";
import { TfButton, TfLinkButton } from "./primitives/button.js";
import { ConnectedStanding } from "./subscription-connected-standing.js";

// The device-code connect engine, chrome-free: the begin →
// open-the-prefilled-link → poll → land machinery plus its presentational
// arms, shared by every surface that hosts a connect — the provider
// chip's menu on the composer shelf and the conversation gate card in the
// composer's place. The hosting surface owns positioning and dismissal;
// unmounting the hook IS the poll's stop — no timer survives a dismissal.

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

// The enablement gate: OpenAI's "device code authorization" toggle is
// off by default on every ChatGPT account and only fails at approve
// time, so the flow pre-warns wherever it can start or is under way —
// never on the connected standing, whose gate is passed.
const _CHATGPT_SECURITY_SETTINGS_URL = "https://chatgpt.com/#settings/Security";

// While a fresh credential verifies, re-read the standing at a gentle
// pace so the surface shows the settle live. One-shot and re-armed by the
// re-render each answer causes — never an interval.
const _VERIFYING_REFRESH_MS = 4000;

// The poll's tolerance for a flaky wire: this many consecutive transient
// failures (doubling the interval each time, capped) before the flow
// gives up and asks for a fresh start.
const _MAX_TRANSIENT_POLL_FAILURES = 5;
const _MAX_POLL_BACKOFF_SECONDS = 60;

// The standing re-read's own bound: a failed GET leaves the cell (and so
// the hosting component) unchanged, so the chain re-arms itself up to
// this many times per settled render — a lone blip must not stall
// "verifying" until the surface remounts.
const _MAX_VERIFYING_REFRESH_ATTEMPTS = 5;

type ConnectFlowState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "waiting"; authorization: SubscriptionDeviceAuthorization }
  // The poll answered complete but the refreshed standing hasn't landed
  // yet: hold a verifying presentation — never flash the Connect button
  // (or a stale pre-connect standing) at a visitor who just approved.
  // `before` is the status identity seen at completion: only a READ
  // that actually landed after it (a fresh object from the refetch) may
  // exit the flow — the pre-connect standing, bounced included, never
  // does.
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
  /** The waiting arm's quiet exit: abandons the handle (it costs
   *  nothing server-side and expires on its own) and returns to idle —
   *  a mistaken click must not trap the visitor until expiry. */
  cancel: () => void;
}

/** The whole device-code machine as one hook: the poll loop, the
 *  verifying re-read chain, and the render-time flow/standing
 *  reconciliation. The hosting surface renders the arms below off its
 *  answer. */
export function useSubscriptionConnectFlow(
  status: SubscriptionStatus,
  session: TokenSession,
  refreshSubscriptions: () => void,
): SubscriptionConnectFlow {
  const [flow, setFlow] = useState<ConnectFlowState>({ kind: "idle" });
  // One request in flight at a time — a begin double-click or a poll
  // overlapping a disconnect would race the flow state.
  const busyRef = useRef(false);
  // What the completing poll captures as "the standing before my
  // outcome" — an effect-updated ref so the async callback reads the
  // render that actually painted, not a stale closure.
  const latestStatusRef = useRef(status);
  useEffect(() => {
    latestStatusRef.current = status;
  });

  // The device poll: a self-rescheduling one-shot at the server's
  // interval (the execution driver's clearTimer→re-arm discipline).
  // Unmount clears it — dismissing the hosting surface stops the poll
  // by contract.
  useEffect(() => {
    if (flow.kind !== "waiting") {
      return;
    }
    return _pollAuthorization(flow.authorization, {
      session,
      provider: status.provider,
      busyRef,
      latestStatusRef,
      refreshSubscriptions,
      setFlow,
    });
  }, [flow, session, status.provider, refreshSubscriptions]);

  // A fresh credential settles server-side moments after the connect;
  // while the surface holds a presentation awaiting a refreshed read (a
  // verifying row, a landed flow, or a removed flow whose refetch
  // hasn't answered), re-read at a gentle pace so the outcome shows
  // live. A successful read re-renders the host (fresh status identity)
  // and restarts the chain; a FAILED read changes nothing, so the chain
  // re-arms itself — bounded — instead of stalling on one transient GET.
  const holdsAVerifyingPresentation =
    status.state === "verifying" ||
    flow.kind === "landed" ||
    flow.kind === "removed";
  useEffect(() => {
    if (!holdsAVerifyingPresentation) {
      return;
    }
    return _pollStatus(refreshSubscriptions);
  }, [holdsAVerifyingPresentation, status, refreshSubscriptions]);

  const begin = async () => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setFlow({ kind: "starting" });
    try {
      const authorization = await beginSubscriptionDeviceAuthorization(
        session,
        status.provider,
      );
      setFlow({ kind: "waiting", authorization });
    } catch (error) {
      setFlow({ kind: "error", sentence: _sentenceOf(error) });
    } finally {
      busyRef.current = false;
    }
  };

  const disconnect = async () => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    try {
      await disconnectSubscription(session, status.provider);
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
  };

  const errorSentence = flow.kind === "error" ? flow.sentence : null;
  // A reconnect (a bounced credential's second try) must show the code:
  // an in-progress flow wins over the stored standing, whatever row
  // exists — EXCEPT a standing that is the flow's own outcome. A poll
  // can save the credential and still answer 503 (the probe start
  // failed after the save; the backend pins that shape), so a refreshed
  // standing showing verifying/active supersedes the flow instead of
  // the surface denying a connection that exists. A LANDED flow yields
  // to any standing the refetch actually delivered AFTER the completion
  // — bounced included (the probe can settle bounced before the surface
  // closes; its outcome must exit into the reconnect presentation) —
  // but never to the standing it captured at completion: on a reconnect
  // that is the OLD bounced row, and dropping to it would tell a
  // visitor who just approved that their connection stopped working.
  // Render-time adjustment, the sanctioned shape.
  const flowInProgress =
    flow.kind === "starting" ||
    flow.kind === "waiting" ||
    flow.kind === "landed" ||
    flow.kind === "removed";
  if (flow.kind === "removed") {
    // The removal's outcome is ANY read that landed after it — connected
    // or not, the refreshed standing is the truth to render from.
    if (status !== flow.before) {
      setFlow({ kind: "idle" });
    }
  } else if (
    status.connected &&
    (flow.kind === "landed"
      ? status !== flow.before
      : flowInProgress && status.state !== "bounced")
  ) {
    setFlow({ kind: "idle" });
  }

  return {
    flow,
    flowInProgress,
    errorSentence,
    begin: () => void begin(),
    disconnect: () => void disconnect(),
    cancel: () => {
      setFlow({ kind: "idle" });
    },
  };
}

/** The wires the device poll shares with its hook: the session and
 *  provider it polls for, the hook's one-request-at-a-time flag, the
 *  effect-updated standing, and the flow setter. */
interface PollWires {
  session: TokenSession;
  provider: SubscriptionProvider;
  busyRef: RefObject<boolean>;
  latestStatusRef: RefObject<SubscriptionStatus>;
  refreshSubscriptions: () => void;
  setFlow: Dispatch<SetStateAction<ConnectFlowState>>;
}

/** The device poll's effect body: a self-rescheduling one-shot at the
 *  server's interval (the execution driver's clearTimer→re-arm
 *  discipline). Returns the effect's cleanup — unmount clears the timer,
 *  so dismissing the hosting surface stops the poll by contract. */
function _pollAuthorization(
  authorization: SubscriptionDeviceAuthorization,
  wires: PollWires,
): () => void {
  const { busyRef, latestStatusRef, refreshSubscriptions, setFlow } = wires;
  let disposed = false;
  let timer: number | undefined;
  // A fetch blip must not abandon a code the user may already have
  // approved on the provider's page: transient failures retry at a
  // stretched interval, and only a settled refusal (a 4xx envelope —
  // the handle expired, the grant was denied) or exhaustion ends the
  // flow.
  let transientFailures = 0;
  const arm = (seconds: number) => {
    // Floored like the 429 delay: the interval originates at the
    // provider and replays out of the sealed handle — a 0 must never
    // arm an every-tick loop (the backend floors it too; this is the
    // belt to that brace).
    timer = window.setTimeout(
      () => {
        void pollOnce();
      },
      Math.max(1, seconds) * 1000,
    );
  };
  const pollOnce = async () => {
    if (busyRef.current) {
      arm(1);
      return;
    }
    busyRef.current = true;
    try {
      const answer = await pollSubscriptionDeviceAuthorization(
        wires.session,
        wires.provider,
        authorization.sealed_authorization,
      );
      if (answer.status === "complete") {
        // Even a dismissed surface must not strand the cached standing:
        // the credential exists server-side the moment this answer
        // arrives, and the session-cached GET would otherwise say
        // "not connected" for the page's life. Only the flow state
        // stays gated on the mount.
        refreshSubscriptions();
        if (!disposed) {
          setFlow({ kind: "landed", before: latestStatusRef.current });
        }
        return;
      }
      if (disposed) {
        return;
      }
      transientFailures = 0;
      // The server absorbs the provider's back-off semantics: pending
      // always carries the interval to obey next.
      arm(answer.interval ?? authorization.interval);
    } catch (error) {
      if (disposed) {
        return;
      }
      if (_isARateLimitPause(error)) {
        // 429 is a pause, never a verdict: honor Retry-After and keep
        // the flow alive — the handle's own expiry bounds the loop
        // (an expired handle answers a settled 403).
        arm(_rateLimitDelaySecondsOf(error, authorization.interval));
        return;
      }
      if (
        _isASettledRefusal(error) ||
        transientFailures >= _MAX_TRANSIENT_POLL_FAILURES
      ) {
        setFlow({ kind: "error", sentence: _sentenceOf(error) });
        return;
      }
      // The failure may have landed AFTER the save (the probe start's
      // 503): re-read the standing — if the credential exists, the
      // hosting render supersedes this flow with it.
      refreshSubscriptions();
      transientFailures += 1;
      arm(
        Math.min(
          authorization.interval * 2 ** transientFailures,
          _MAX_POLL_BACKOFF_SECONDS,
        ),
      );
    } finally {
      busyRef.current = false;
    }
  };
  arm(authorization.interval);
  return () => {
    disposed = true;
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }
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
 *  hosting surface's ask; a flow that reaches the approval wait swaps
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
      {/* The waiting arm leads with the code instead — one focal point
          per state, never two competing lines. */}
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
        disabled={flow.kind === "starting"}
      >
        {flow.kind === "starting"
          ? `Connecting ${name}…`
          : flow.kind === "error"
            ? `Try connecting ${name} again`
            : (beginLabel ?? `Sign in with ${name}`)}
      </TfButton>
      {/* One quiet line below the action (the gate is the likeliest
          reason a first attempt settles denied) — never a paragraph
          competing with the button above it. */}
      <EnablementHint />
    </div>
  );
}

/** The waiting arm: the approval headline, the code as the one hero, the
 *  prefilled link, the heartbeat and the quiet exit. */
function WaitingForApproval({
  name,
  authorization,
  onCancel,
}: {
  name: string;
  authorization: SubscriptionDeviceAuthorization;
  onCancel: () => void;
}) {
  return (
    <div className="tf:flex tf:flex-col tf:gap-2">
      {/* The state must visibly change: the ask's headline swaps for
          the approval's own. */}
      <p className="tf:m-0 tf:text-tf-heading tf:font-medium tf:text-tf-foreground">
        Approve the connection in {name}
      </p>
      {/* The code is what the visitor acts on, so it is the arm's one
          hero: micro-label above, the code at display scale — never a
          value buried mid-sentence. It is confirm-only against what
          the provider's page shows (the verification_url arrives
          prefilled); retyping codes into a second site is what
          device-code phishing looks like. */}
      <div className="tf:flex tf:flex-col tf:gap-0.5">
        <span className="tf:text-xs tf:font-medium tf:tracking-wide tf:text-tf-muted-foreground tf:uppercase">
          Confirm this code
        </span>
        <span className="tf:font-mono tf:text-lg tf:tracking-widest tf:text-tf-foreground tf:select-all">
          {authorization.user_code}
        </span>
      </div>
      <TfLinkButton
        href={authorization.verification_url}
        target="_blank"
        rel="noreferrer"
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
        Waiting for approval…
      </p>
      {/* The mistaken click's quiet exit: abandoning a handle costs
          nothing server-side (it expires inside itself). */}
      <TfButton variant="ghost" className="tf:self-start" onClick={onCancel}>
        Start over
      </TfButton>
    </div>
  );
}

/** The enablement-gate pre-warning: the toggle only fails at approve
 *  time, so this one quiet line rides the arms where a flow can start.
 *  One link, under the action, 12px — a caveat, never a paragraph. The
 *  workspace-admin path lives in the denial sentence the server sends
 *  when the gate actually bites (it names
 *  chatgpt.com/admin/permissions). ChatGPT is hardcoded like the
 *  disclosure line above: it is the flow's only provider. */
function EnablementHint() {
  return (
    <p className="tf:m-0 tf:text-xs tf:text-tf-muted-foreground">
      First time? Turn on device codes in{" "}
      <a
        className="tf:underline tf:underline-offset-2"
        href={_CHATGPT_SECURITY_SETTINGS_URL}
        target="_blank"
        rel="noreferrer"
      >
        ChatGPT&apos;s security settings
      </a>
      .
    </p>
  );
}

function _isASettledRefusal(error: unknown): boolean {
  // A 4xx envelope is the server saying "this handle will never work" —
  // expired, another visitor's, denied. Anything else (a network blip,
  // a 5xx, a rate-limit window) deserves the retry loop; 429 is
  // explicitly a pause, not a verdict.
  return (
    error instanceof ServingApiError &&
    error.status < 500 &&
    error.status !== 429
  );
}

function _isARateLimitPause(error: unknown): boolean {
  return error instanceof ServingApiError && error.status === 429;
}

function _rateLimitDelaySecondsOf(error: unknown, interval: number): number {
  const retryAfter =
    error instanceof ServingApiError ? error.retryAfterSeconds : null;
  // Floored: 429s deliberately never count toward exhaustion, so this
  // delay is the only throttle — and an intermediary's Retry-After: 0
  // (our own limiter floors at 1) must not arm an every-tick re-poll
  // for the handle's remaining lifetime.
  return Math.max(1, retryAfter ?? interval * 2);
}

function _sentenceOf(error: unknown): string {
  if (error instanceof ServingApiError) {
    if (error.code === "SUBSCRIPTION_AUTHORIZATION_INVALID") {
      // One coarse code covers expired, wrong-visitor, wrong-provider,
      // and malformed alike — the sentence must be true for all of
      // them, implying no specific cause. (A settled denial carries its
      // own code and rides the passthrough below.)
      return "That connection attempt can't be completed — start a new one.";
    }
    // The contract guarantees the server's message is a human sentence
    // safe to show (the not-offered, denial, provider-down, and storage
    // codes all carry their own).
    return error.message;
  }
  return "Something went wrong. Try again.";
}
