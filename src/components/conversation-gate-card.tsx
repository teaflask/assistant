"use client";

import { useCallback, useEffect } from "react";

import type { SubscriptionStatus } from "../contract/subscriptions.js";
import type { ConversationGate } from "../core/connect-gate.js";
import { humanizedWait } from "../core/error-copy.js";
import { OpenAiMarkIcon } from "./icons.js";
import { TfButton } from "./primitives/button.js";
import {
  ConnectFlow,
  DISCLOSURE_LINE,
  providerNameOf,
  useSubscriptionConnectFlow,
} from "./subscription-connect-flow.js";
import { useAssistantSession } from "./teaflask-assistant-provider.js";
import { useCell } from "./use-store-cell.js";

// The conversation gate banner: when the next send cannot serve without
// the visitor acting, the moment renders as an INLINE banner above the
// composer — the chat-product grammar (owner reference: ChatGPT's limit
// banner, 2026-08-20) — never a takeover of the input. One tinted strip:
// the state as a sentence on the left, one intrinsic-width action on the
// right, and the composer stays where it always is. Starting the connect
// expands the sign-in flow inside the same strip; a landed
// credential clears the gate on the next projection read and the banner
// simply leaves.

// While the gate reports verifying (a fresh credential's probe, or the
// server re-checking a stale quota), re-read at the flow's own gentle
// pace, bounded the same way.
const _VERIFYING_REFRESH_MS = 4000;
const _MAX_VERIFYING_REFRESH_ATTEMPTS = 5;

// setTimeout's delay is a 32-bit signed int: past ~24.8 days it
// overflows and fires IMMEDIATELY — and a monthly plan window's reset
// horizon is exactly that far away. An immediate fire re-reads the
// projection, whose recomputed horizon drifts by the round trip, which
// defeats the gate dedupe and re-arms into a continuous GET storm. The
// ceiling guard, like the floor's: a clamped timer just re-checks
// early and re-arms with the remaining wait.
const _MAX_TIMEOUT_MS = 2 ** 31 - 1;

export function ConversationGateCard({
  gate,
}: {
  gate: Exclude<ConversationGate, { kind: "none" } | { kind: "sign_in" }>;
}) {
  const session = useAssistantSession();

  // The gate implies an identified visitor (anonymous visitors gate on
  // sign-in, which never reaches this banner) — the standing read serves.
  useEffect(() => {
    session.ensureSubscriptions();
  }, [session]);

  // Every refresh the flow performs also re-reads the projection: the
  // probe settling active is what clears this banner. Memoized on the
  // stable session: the flow's re-read chain keys its dependency array
  // on this callback, and a fresh identity per render would tear it
  // down mid-flight — its attempts counter resetting and defeating its
  // own bound.
  const refreshStandingAndGate = useCallback(() => {
    session.refreshSubscriptions();
    session.refreshAssistantConfig();
  }, [session]);

  return (
    // The tinted strip: the hover-wash ground carries it (a policy
    // moment, never the destructive register), rounded to the card step,
    // flat — it sits in the flow (The Portal Lift Rule).
    <div className="tf:mb-3 tf:flex tf:flex-col tf:gap-2 tf:rounded-xl tf:bg-tf-accent tf:p-3">
      {gate.kind === "connect" ? (
        <ConnectGateBody gate={gate} refresh={refreshStandingAndGate} />
      ) : gate.kind === "wait" ? (
        <WaitGateBody retryAtMs={gate.retryAtMs} />
      ) : (
        <VerifyingGateBody refresh={refreshStandingAndGate} />
      )}
    </div>
  );
}

function ConnectGateBody({
  gate,
  refresh,
}: {
  gate: Extract<ConversationGate, { kind: "connect" }>;
  refresh: () => void;
}) {
  const session = useAssistantSession();
  const statuses = useCell(session.subscriptions);
  const status = _theGatesStanding(gate, statuses);
  if (status === null) {
    // The standing read is still in flight (the banner can beat it by a
    // breath); the row renders the affordance the moment it lands.
    return <_StatusLine sentence="One moment…" />;
  }
  return <ConnectBannerRow status={status} gate={gate} refresh={refresh} />;
}

function ConnectBannerRow({
  status,
  gate,
  refresh,
}: {
  status: SubscriptionStatus;
  gate: Extract<ConversationGate, { kind: "connect" }>;
  refresh: () => void;
}) {
  const session = useAssistantSession();
  const name = providerNameOf(status.provider);
  const connect = useSubscriptionConnectFlow(status, session.session, refresh);

  // A running (or failed) flow expands inside the strip — the sign-in
  // headline, the link and the waiting line replace the one-row ask.
  if (connect.flow.kind !== "idle") {
    return (
      <ConnectFlow
        name={name}
        flow={connect.flow}
        errorSentence={connect.errorSentence}
        onBegin={connect.begin}
        onCancel={connect.cancel}
        beginLabel={`Sign in with ${name}`}
      />
    );
  }
  const taster = gate.reason === "taster_exhausted";
  return (
    <>
      <div className="tf:flex tf:flex-wrap tf:items-center tf:gap-x-3 tf:gap-y-2">
        <p className="tf:m-0 tf:flex tf:min-w-0 tf:flex-1 tf:items-center tf:gap-2 tf:text-tf-label tf:text-tf-foreground">
          <OpenAiMarkIcon />
          {taster
            ? "You've used the free preview on this assistant."
            : `Your ${name} connection stopped working.`}
        </p>
        <TfButton
          variant="primary"
          className="tf:shrink-0"
          onClick={connect.begin}
        >
          {taster ? `Sign in with ${name}` : `Reconnect ${name}`}
        </TfButton>
      </div>
      {/* What signing in means, in the visitor's own terms — consent
          belongs before the click. */}
      {taster ? (
        <p className="tf:m-0 tf:text-xs tf:text-tf-muted-foreground">
          {DISCLOSURE_LINE}
        </p>
      ) : null}
    </>
  );
}

function WaitGateBody({ retryAtMs }: { retryAtMs: number | null }) {
  const session = useAssistantSession();
  // When the recorded reset passes, re-read the projection: the send
  // door will have flipped to the re-checking arm (or cleared entirely),
  // and the banner must not keep promising a wait that is over.
  useEffect(() => {
    if (retryAtMs === null) {
      return;
    }
    const timer = window.setTimeout(
      () => {
        session.refreshAssistantConfig();
      },
      Math.min(Math.max(1000, retryAtMs - Date.now()), _MAX_TIMEOUT_MS),
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [retryAtMs, session]);

  return (
    <p className="tf:m-0 tf:flex tf:items-center tf:gap-2 tf:text-tf-label tf:text-tf-foreground">
      <OpenAiMarkIcon />
      Your ChatGPT plan&apos;s included usage is used up for this period.{" "}
      {_theContinuePromiseOf(retryAtMs)}
    </p>
  );
}

function _theContinuePromiseOf(retryAtMs: number | null): string {
  const secondsLeft =
    retryAtMs === null ? null : Math.ceil((retryAtMs - Date.now()) / 1000);
  if (secondsLeft !== null && secondsLeft > 0) {
    return `The conversation can continue in about ${humanizedWait(secondsLeft)}.`;
  }
  return "The conversation can continue when it resets.";
}

function VerifyingGateBody({ refresh }: { refresh: () => void }) {
  const session = useAssistantSession();
  const statuses = useCell(session.subscriptions);
  const aCredentialIsVerifying =
    statuses?.some((status) => status.state === "verifying") ?? false;

  // The bounded re-read chain (the flow's discipline): the probe settles
  // in moments, and each landed read restarts the chain via the fresh
  // render — a failed read re-arms itself up to the bound.
  useEffect(() => {
    let attempts = 0;
    let timer: number | undefined;
    const arm = () => {
      timer = window.setTimeout(() => {
        attempts += 1;
        refresh();
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
  }, [statuses, refresh]);

  return (
    <_StatusLine
      sentence={
        aCredentialIsVerifying
          ? "Verifying your ChatGPT connection…"
          : "Re-checking your plan — one moment…"
      }
    />
  );
}

function _StatusLine({ sentence }: { sentence: string }) {
  return (
    <p
      className="tf:m-0 tf:flex tf:items-center tf:gap-1.5 tf:text-tf-label tf:text-tf-foreground"
      role="status"
    >
      <span
        aria-hidden
        className="tf:size-1.5 tf:shrink-0 tf:animate-tf-pulse tf:rounded-full tf:bg-tf-foreground tf:motion-reduce:animate-none"
      />
      {sentence}
    </p>
  );
}

// The standing the gate spoke about: the named provider's row first,
// else the first row a flow could act on. Null while the read is in
// flight — never a fabricated status.
function _theGatesStanding(
  gate: Extract<ConversationGate, { kind: "connect" }>,
  statuses: SubscriptionStatus[] | null,
): SubscriptionStatus | null {
  if (statuses === null) {
    return null;
  }
  const named = statuses.find((status) =>
    gate.providers.includes(status.provider),
  );
  if (named !== undefined) {
    return named;
  }
  return statuses.find((status) => status.offered || status.connected) ?? null;
}
