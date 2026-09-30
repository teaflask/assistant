"use client";

import { useEffect, useRef, useState } from "react";

import type { SubscriptionStatus } from "../contract/subscriptions.js";
import { ChevronDownIcon, OpenAiMarkIcon } from "./icons.js";
import { TfButton } from "./primitives/button.js";
import {
  ProviderConnectSection,
  providerNameOf,
} from "./subscription-connect-flow.js";
import {
  useAssistantSession,
  useOptionalAssistantSession,
} from "./teaflask-assistant-provider.js";
import { useCell } from "./use-store-cell.js";

// The provider chip: the composer shelf's account & funding control —
// who serves and funds the conversation. Unconnected it reads "Sign in
// with ChatGPT" (the acquisition affordance the old header plug hid);
// connected it is the standing's home ("ChatGPT · Plus") and its menu
// carries reconnect and disconnect. The menu opens UPWARD over the
// transcript — the chip lives at the surface's floor.
//
// It stands alone on the shelf when the wire serves no model menu, and
// beside the model picker as an independent sibling when one is served:
// connecting or disconnecting never touches the pick, and picking never
// opens this menu. Rendered only for identified visitors on agents that
// offer (or once offered — a stored credential must stay reachable) a
// provider: the same gate the drawer's plug used, now on every surface
// because the composer is shared.

/** The shelf row below the composer slab when no model menu is served.
 *  Renders nothing when there is nothing to connect — the composer
 *  composite then keeps today's geometry. Tolerates a missing provider
 *  like the composer's paperclip does (welcome-branch tests render the
 *  view bare). */
export function ProviderChipShelf() {
  const session = useOptionalAssistantSession();
  if (session === null) {
    return null;
  }
  return <MountedProviderChipShelf />;
}

function MountedProviderChipShelf() {
  const session = useAssistantSession();
  const statuses = useCell(session.subscriptions);
  // The chip's open state lives on the shelf, not in the chip: the chip
  // is controlled, so whichever shelf hosts it owns the one-menu
  // bookkeeping and the parked connect ask below.
  const [open, setOpen] = useState(false);

  // The standing read is identified-only (the GET 403s an anonymous
  // bearer): kick it exactly when the tier admits it. tier arrives
  // already resolved on the context value (the provider subscribes).
  const identified = session.tier === "identified";
  useEffect(() => {
    if (identified) {
      session.ensureSubscriptions();
    }
  }, [identified, session]);

  const connectable = (statuses ?? []).filter(
    (status) => status.offered || status.connected,
  );
  const chipShown = identified && connectable.length > 0;

  // The parked ask (requestSubscriptionConnect — the bench's ring, and
  // any host that wants to spotlight the chip): consume it by opening
  // the menu. Living on the shelf means a ring while this surface was
  // unmounted is honored on the next mount, never dropped. The open
  // flips as a render-time adjustment of the shelf's OWN state (the
  // sanctioned shape — never setState in an effect); the effect only
  // CONSUMES the ask, an external store write, once the menu is
  // actually rendered. Gated on the chip standing: with nothing to
  // connect the ask stays parked for a surface that can honor it.
  const openRequested = useCell(session.connectOpenRequested);
  if (openRequested && chipShown && !open) {
    setOpen(true);
  }
  // A menu cannot outlive its chip: when the offer is withdrawn the
  // chip unmounts, and a LATER re-offer must render closed — the open
  // died with the withdrawal, it does not pop back (the state used to
  // live in the chip and reset by unmounting; the shelf resets it
  // explicitly, same render-time-adjustment shape).
  if (!chipShown && open) {
    setOpen(false);
  }
  useEffect(() => {
    if (openRequested && open && chipShown) {
      session.acknowledgeSubscriptionConnect();
    }
  }, [openRequested, open, chipShown, session]);

  if (!chipShown) {
    return null;
  }
  return (
    <div className="tf:relative tf:mt-1.5 tf:flex tf:items-center tf:justify-end tf:px-1">
      <ProviderChip statuses={connectable} open={open} onOpenChange={setOpen} />
    </div>
  );
}

/** The account chip itself, shelf-row-agnostic and CONTROLLED: the
 *  no-menu shelf above mounts it in its own row, the model picker's
 *  shelf mounts it beside the picker chip in a shared one. The
 *  hosting shelf owns the open state — that is what makes the shared
 *  row's one-menu-at-most invariant structural — and consumes the
 *  parked connect ask; this chip only renders and reports. */
export function ProviderChip({
  statuses,
  open,
  onOpenChange,
  fundingNote,
}: {
  statuses: SubscriptionStatus[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** One caller-owned sentence relating the surrounding surface to the
   *  plan — the model picker's shelf passes "models your plan serves run
   *  on it…" because a pick can leave the plan's servable set; the
   *  no-menu shelf passes nothing, since without picks the sections' own
   *  included-usage copy already answers who pays. */
  fundingNote?: string;
}) {
  const session = useAssistantSession();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Light dismissal, judged by composedPath() — the script-tag
  // distribution runs in an open shadow root, where document-level
  // events retarget to the host element and contains() would call every
  // in-shadow press an outside one. The trigger is excluded so its own
  // press doesn't close-then-reopen through the click that follows.
  useEffect(() => {
    const menu = menuRef.current;
    if (!open || menu === null) {
      return;
    }
    const closeUnlessInside = (event: Event) => {
      const path = event.composedPath();
      if (path.includes(menu)) {
        return;
      }
      const trigger = triggerRef.current;
      if (trigger !== null && path.includes(trigger)) {
        return;
      }
      onOpenChange(false);
    };
    const doc = menu.ownerDocument;
    doc.addEventListener("pointerdown", closeUnlessInside);
    return () => {
      doc.removeEventListener("pointerdown", closeUnlessInside);
    };
  }, [open, onOpenChange]);

  const headline = _chipHeadlineOf(statuses);
  return (
    <>
      <TfButton
        ref={triggerRef}
        variant={headline.connected ? "chipQuiet" : "chip"}
        aria-expanded={open}
        aria-controls="tf-provider-chip-menu"
        aria-label={headline.accessibleName}
        onClick={() => {
          onOpenChange(!open);
        }}
        onKeyDown={(event) => {
          // Escape with focus on the trigger closes the menu, not the
          // hosting surface — stopped so a drawer's own Esc never sees it.
          if (!open || event.key !== "Escape") {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(false);
        }}
      >
        <OpenAiMarkIcon />
        {/* Never wraps: on a tight shelf row the PICKER chip is the
            shrinker (its name truncates); a mid-label wrap of the
            acquisition CTA reads as a broken control. */}
        <span className="tf:whitespace-nowrap">{headline.label}</span>
        <ChevronDownIcon />
      </TfButton>
      {open ? (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the keydown is the menu's own Esc-to-close; every focusable inside is a real button.
        <div
          ref={menuRef}
          id="tf-provider-chip-menu"
          role="dialog"
          aria-label={headline.accessibleName}
          // Anchored to the shelf and opening UPWARD over the transcript:
          // absolute against the shelf's relative row, painted over the
          // static transcript by document order alone — the package ships
          // no z-index. Glass like the package's other floating chrome.
          data-tf-glass=""
          className="tf:absolute tf:right-0 tf:bottom-full tf:mb-2 tf:flex tf:w-80 tf:max-w-[calc(100vw-2rem)] tf:flex-col tf:gap-3 tf:overflow-y-auto tf:rounded-2xl tf:border tf:p-3"
          onKeyDown={(event) => {
            // Esc closes the menu and hands focus back to its trigger;
            // the hosting surface survives.
            if (event.key !== "Escape") {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            onOpenChange(false);
            triggerRef.current?.focus();
          }}
        >
          {fundingNote !== undefined ? (
            <p className="tf:text-xs tf:text-tf-muted-foreground">
              {fundingNote}
            </p>
          ) : null}
          {statuses.map((status) => (
            <ProviderConnectSection
              key={status.provider}
              status={status}
              session={session.session}
              refreshSubscriptions={session.refreshSubscriptions}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

interface ChipHeadline {
  label: string;
  accessibleName: string;
  /** Connected standings read quiet (status register); the unconnected
   *  chip keeps full ink — it is the acquisition affordance. */
  connected: boolean;
}

// The chip speaks for the first credential that exists, else the first
// offered provider — one provider today, and a second one's standing
// still reaches the menu below.
function _chipHeadlineOf(statuses: SubscriptionStatus[]): ChipHeadline {
  const holding = statuses.find((status) => status.connected) ?? statuses[0];
  const name = providerNameOf(holding.provider);
  if (!holding.connected) {
    return {
      label: `Sign in with ${name}`,
      accessibleName: `Sign in with ${name}`,
      connected: false,
    };
  }
  if (holding.state === "verifying") {
    return {
      label: `${name} · verifying…`,
      accessibleName: `${name} plan — verifying`,
      connected: true,
    };
  }
  if (holding.state === "bounced") {
    return {
      label: `${name} · reconnect`,
      accessibleName: `${name} plan — reconnect`,
      connected: true,
    };
  }
  const plan = holding.plan_type;
  return {
    label: plan === null ? `${name} plan` : `${name} · ${_titleCased(plan)}`,
    accessibleName: `${name} plan`,
    connected: true,
  };
}

function _titleCased(plan: string): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}
