"use client";

// The transcript read surface: the ONE derivation from the store's read cells
// to renderable rows, consumed by components/transcript.tsx and exported public
// on ./headless — never ./transcript, since the BINDING to a live store rides
// the provider, which constructs the transport. Chrome-free by construction
// (tests/bundle-closure.test.ts): VALUE-imports only core/*, React, ./headless
// seams.

import { useEffect, useMemo } from "react";

import type { Message } from "@ag-ui/core";

import {
  isTerminalTurnStatus,
  type AssistantActivitySnapshot,
} from "../core/activity.js";
import type { MarkerAnchorsSnapshot } from "../core/connection-epoch.js";
import { runReadsAsWorking } from "../core/run-status.js";
import {
  approvalAwaitsMember,
  elicitationAwaitsMember,
} from "../core/suspension-queue.js";
import {
  transcriptRowsOf,
  withPendingUserEcho,
  type TranscriptRow,
} from "../core/transcript-rows.js";
import type { UserTurnMeta } from "../core/user-turn-ledger.js";
import { useConversation } from "./conversation-context.js";
import { useAssistantSession } from "./teaflask-assistant-provider.js";
import { useCell } from "./use-store-cell.js";

/** The transcript read surface: everything a host needs to render the
 *  assistant's replies, derived exactly the way the package chrome derives it. */
export interface TranscriptSurface {
  /** transcriptRowsOf(messages, markerAnchors, running, turnMeta) — the
   *  pure interleave, identity-stable while its four inputs hold. */
  rows: readonly TranscriptRow[];
  /** `rows` with the composer's optimistic echo appended (withPendingUserEcho).
   *  Render this; a host that also paints its own bubble would double it. */
  displayRows: readonly TranscriptRow[];
  /** runReadsAsWorking(activity.newestTurnStatus, decisionsPending) — the
   *  machine's time. False for the send round trip, so a "working" indicator
   *  should join the composer contract's pendingSend, as the chrome does. */
  running: boolean;
  /** The newest turn is non-terminal — broader than `running`: the HITL
   *  pauses (awaiting_input, parked) count. */
  turnOpen: boolean;
  /** A member-actionable decision is live — the run is the MEMBER's time. */
  decisionsPending: boolean;
  /** The four raw store reads, as plain values — so transcriptRowsOf(messages,
   *  markerAnchors, running, turnMeta) type-checks verbatim for a host's own projection. */
  messages: readonly Message[];
  markerAnchors: MarkerAnchorsSnapshot;
  activity: AssistantActivitySnapshot;
  turnMeta: ReadonlyMap<string, UserTurnMeta>;
}

/**
 * The store's read side, projected: the message list and marker anchors
 * folded into the flat row list, plus the run-state facts the rows key on.
 * Mounting registers transcript presence (the lease) — what guarantees the
 * epoch connects and history paints by full replay; unmounting mid-turn changes nothing.
 */
export function useTranscript(options?: {
  /** The lease label the store's presence ledger records (the chrome's `surface` prop). */
  surface?: string;
}): TranscriptSurface {
  const { store } = useAssistantSession();
  const { pendingEcho } = useConversation();
  const messages = useCell(store.messages);
  const markerAnchors = useCell(store.markerAnchors);
  const approvalCards = useCell(store.approvals);
  const elicitationCards = useCell(store.elicitations);
  const activity = useCell(store.activity);
  const turnMeta = useCell(store.turnMeta);

  const surface = options?.surface ?? "headless";
  useEffect(() => store.acquireTranscriptLease(surface), [store, surface]);

  // The decision-live fact: the one honest signal that the run is the
  // MEMBER's time — claimed only while a decision surface exists, via the
  // shared predicates, never the sorted queue (whose row-index input
  // changes every token). The gap counts too: the role="alert" banner says
  // the run waits. Truthiness on purpose: a partial snapshot's undefined
  // is no-gap.
  const decisionSurfaceLive = useMemo(
    () =>
      approvalCards.some(approvalAwaitsMember) ||
      elicitationCards.some(elicitationAwaitsMember),
    [approvalCards, elicitationCards],
  );
  const decisionsPending =
    decisionSurfaceLive || Boolean(activity.pendingDecisionGap);
  // "The run is live" is the machine's time: queued/working, or a
  // non-terminal pause with no live decision surface — the same function the
  // sr-only announcer speaks, so headline and live region never disagree. It
  // narrows the tool rows' no-result presentation and the newest rows' streaming flag.
  const running = runReadsAsWorking(
    activity.newestTurnStatus,
    decisionsPending,
  );
  // "The turn is open" is broader than "the run is live": it includes the HITL
  // pauses. The completed-episode fold keys on terminality, so a pause never
  // unifies the tail turn mid-flight and pops it back out on resume.
  const turnOpen =
    activity.newestTurnStatus !== null &&
    !isTerminalTurnStatus(activity.newestTurnStatus);

  const rows = useMemo(
    () => transcriptRowsOf(messages, markerAnchors, running, turnMeta),
    [messages, markerAnchors, running, turnMeta],
  );
  const displayRows = useMemo(
    () => withPendingUserEcho(rows, pendingEcho),
    [pendingEcho, rows],
  );

  return {
    rows,
    displayRows,
    running,
    turnOpen,
    decisionsPending,
    messages,
    markerAnchors,
    activity,
    turnMeta,
  };
}
