"use client";

import { useState } from "react";

import type { SubscriptionStatus } from "../contract/subscriptions.js";
import { humanizedWait } from "../core/error-copy.js";
import { ChevronDownIcon, OpenAiMarkIcon } from "./icons.js";
import { TfButton } from "./primitives/button.js";

/** The connected standing: the provider's mark, plan and state chip, the
 *  disclosure line, the standing sentence when not active, the reconnect
 *  action for a bounced credential, and the disconnect behind the chip. */
export function ConnectedStanding({
  name,
  status,
  errorSentence,
  onReconnect,
  onDisconnect,
}: {
  name: string;
  status: SubscriptionStatus;
  errorSentence: string | null;
  onReconnect: () => void;
  onDisconnect: () => void;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsId = `tf-provider-actions-${status.provider}`;
  const active = status.state === "active";
  return (
    <div className="tf:flex tf:flex-col tf:gap-3">
      <ConnectedStandingHeader
        name={name}
        status={status}
        actionsOpen={actionsOpen}
        actionsId={actionsId}
        onToggleActions={() => {
          setActionsOpen((current) => !current);
        }}
      />
      <p className="tf:m-0 tf:text-xs tf:text-tf-muted-foreground">
        Uses your {name} plan&apos;s included usage.
      </p>
      {active ? null : (
        <p
          className="tf:m-0 tf:text-tf-label tf:text-tf-foreground"
          role="status"
        >
          {standingSentenceOf(name, status)}
        </p>
      )}
      {/* A withdrawn offer keeps the credential visible — disconnect must
          never strand — but stops inviting a reconnect. */}
      {status.offered ? null : (
        <p className="tf:m-0 tf:text-tf-label tf:text-tf-muted-foreground">
          {name} sign-in is no longer offered here.
        </p>
      )}
      {status.state === "bounced" && status.offered ? (
        <TfButton
          variant="primary"
          className="tf:self-start"
          onClick={onReconnect}
        >
          Reconnect {name}
        </TfButton>
      ) : null}
      {errorSentence === null ? null : (
        // Same announcement law as the connect arm's error line.
        <p
          className="tf:m-0 tf:text-tf-label tf:text-tf-destructive"
          role="alert"
        >
          {errorSentence}
        </p>
      )}
      {actionsOpen ? (
        <div
          id={actionsId}
          className="tf:flex tf:justify-end tf:border-t tf:pt-2"
        >
          <TfButton variant="outline" onClick={onDisconnect}>
            Disconnect {name}
          </TfButton>
        </div>
      ) : null}
    </div>
  );
}

/** The standing's header row: the provider's mark and plan beside the
 *  state chip that toggles the actions row. */
function ConnectedStandingHeader({
  name,
  status,
  actionsOpen,
  actionsId,
  onToggleActions,
}: {
  name: string;
  status: SubscriptionStatus;
  actionsOpen: boolean;
  actionsId: string;
  onToggleActions: () => void;
}) {
  const plan = status.plan_type;
  return (
    <div className="tf:flex tf:items-center tf:justify-between tf:gap-3">
      <div className="tf:flex tf:min-w-0 tf:items-center tf:gap-2.5">
        <span className="tf:flex tf:size-8 tf:shrink-0 tf:items-center tf:justify-center tf:rounded-full tf:bg-tf-muted tf:text-tf-foreground">
          <OpenAiMarkIcon />
        </span>
        <div className="tf:flex tf:min-w-0 tf:flex-col">
          <span className="tf:truncate tf:text-tf-label tf:font-medium tf:text-tf-foreground">
            {name}
          </span>
          <span className="tf:truncate tf:text-xs tf:text-tf-muted-foreground">
            {plan === null ? "AI subscription" : `${_titleCased(plan)} plan`}
          </span>
        </div>
      </div>
      <TfButton
        variant="outline"
        className="tf:shrink-0"
        aria-expanded={actionsOpen}
        aria-controls={actionsId}
        onClick={onToggleActions}
      >
        <span
          aria-hidden
          className={
            status.state === "bounced"
              ? "tf:size-1.5 tf:rounded-full tf:bg-tf-destructive"
              : "tf:size-1.5 tf:rounded-full tf:bg-tf-foreground"
          }
        />
        {status.state === "verifying"
          ? "Verifying"
          : status.state === "bounced"
            ? "Reconnect"
            : "Connected"}
        <ChevronDownIcon />
      </TfButton>
    </div>
  );
}

/** The standing, as one sentence. A bounced credential names which
 *  recovery helps off the read's own cause: a quota bounce heals
 *  with time, an auth bounce by reconnecting. */
function standingSentenceOf(name: string, status: SubscriptionStatus): string {
  if (status.state === "verifying") {
    return `Verifying your ${name} connection…`;
  }
  if (status.state === "bounced") {
    return status.bounce_cause === "quota"
      ? `Your ${name} plan's included usage is used up${_untilItsReset(status)}.`
      : `Your ${name} connection stopped working.`;
  }
  const plan = status.plan_type;
  return plan === null
    ? `Connected to ${name}.`
    : `Connected — ${_titleCased(plan)} plan.`;
}

function _untilItsReset(status: SubscriptionStatus): string {
  if (status.bounce_retry_at === null) {
    return "";
  }
  const resetMs = Date.parse(status.bounce_retry_at);
  if (Number.isNaN(resetMs) || resetMs <= Date.now()) {
    return "";
  }
  return ` — it resets in about ${humanizedWait((resetMs - Date.now()) / 1000)}`;
}

function _titleCased(plan: string): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}
