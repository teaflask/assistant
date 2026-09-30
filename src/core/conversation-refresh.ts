// Keeping the REST truth fresh: the conversation re-read every settle
// signal funnels through (ticket-ordered so a stale read never overwrites
// fresher truth), and the delivery-claim probe after a dispatch settle.

import { getAssistantThread } from "../transport/serving-api.js";
import { turnHoldsAStream } from "./connection-driver.js";
import { adoptRefreshedDetail } from "./conversation-adoption.js";
import type { AssistantConversationStore } from "./conversation-store.js";

// The delivery-claim probe: a
// dispatch settle only WAKES the thread's conversation entity — the
// backend commits the delivery turn row asynchronously afterward, and may
// decline outright. So the settle's re-read probes briefly for the opened
// turn and goes quiet on a no-show; the idle re-read is the backstop. Its
// own constants (the STOP_SETTLE_PROBES convention): retunable alone.
const DELIVERY_CLAIM_PROBES = 8;
const DELIVERY_CLAIM_PROBE_MS = 1_000;

export async function refreshConversationFromStore(
  store: AssistantConversationStore,
): Promise<void> {
  const active = store._active;
  if (active === null) {
    return;
  }
  store._refreshTicket += 1;
  const ticket = store._refreshTicket;
  try {
    const detail = await getAssistantThread(
      store.deps.session,
      active.thread.id,
    );
    if (ticket <= store._refreshAdoptedThrough) {
      // A later-issued refresh already adopted fresher truth (the
      // monotonic-adoption premise at _refreshTicket).
      return;
    }
    store._refreshAdoptedThrough = ticket;
    adoptRefreshedDetail(store, detail);
  } catch {
    // A blip here self-heals: the next settled run refreshes again.
  }
}

/** A surface's roster poll observed a dispatch settle — the
 *  one frontend-visible signal that a delivery turn may be about to
 *  open on this thread. Re-reads the conversation in a bounded burst
 *  until the claim shows up (a queued/working newest turn; adoption's
 *  publish attaches the stream through the ordinary connect sync), the
 *  thread changes, or the window exhausts QUIETLY — the entity may
 *  have declined the wake, and a no-show is not an error. Coalescing: a
 *  second settle mid-burst restarts the probe budget instead of
 *  stacking a burst. */
export function noteDispatchSettledFromStore(
  store: AssistantConversationStore,
): void {
  if (store._deliveryProbeRunning) {
    store._deliveryProbeRearm = true;
    return;
  }
  store._deliveryProbeRunning = true;
  void _probeForDeliveryClaim(store).finally(() => {
    store._deliveryProbeRunning = false;
    store._deliveryProbeRearm = false;
  });
}

async function _probeForDeliveryClaim(
  store: AssistantConversationStore,
): Promise<void> {
  const threadId = store._active?.thread.id;
  if (store._disposed || threadId === undefined) {
    return;
  }
  if (turnHoldsAStream(store)) {
    // The turn is live: the settle's consequences arrive on the stream
    // (or the connect sync is already attaching) — nothing to probe.
    return;
  }
  // THE LATCH'S CLOCK IS THE BEAT TIMER ALONE: the reads are fired
  // single-flight and never awaited, so a stalled GET can never latch
  // _deliveryProbeRunning (the premise: docs/connection-lifecycle.md).
  let refreshInFlight = false;
  const refreshOnce = () => {
    if (refreshInFlight) {
      return;
    }
    refreshInFlight = true;
    // refreshConversation never rejects (its catch is the self-heal).
    void store.refreshConversation().finally(() => {
      refreshInFlight = false;
    });
  };
  refreshOnce();
  let probesLeft = DELIVERY_CLAIM_PROBES;
  while (probesLeft > 0 || store._deliveryProbeRearm) {
    if (store._deliveryProbeRearm) {
      // Another settle landed mid-burst: its claim gets a full window.
      store._deliveryProbeRearm = false;
      probesLeft = DELIVERY_CLAIM_PROBES;
    }
    if (_deliveryProbeMoot(store, threadId) || turnHoldsAStream(store)) {
      // Disposed or switched: this probe's thread is gone. Holds a
      // stream: adopted — the publish's connect sync attached (or is
      // attaching) and the stream owns the story from here.
      return;
    }
    await settlesFor(DELIVERY_CLAIM_PROBE_MS);
    probesLeft -= 1;
    if (_deliveryProbeMoot(store, threadId)) {
      return;
    }
    refreshOnce();
  }
}

/** Whether the delivery-claim probe's thread is no longer this store's
 *  story — re-read behind every await (the stopTurn posture). */
function _deliveryProbeMoot(
  store: AssistantConversationStore,
  threadId: string,
): boolean {
  return store._disposed || store._active?.thread.id !== threadId;
}

export function settlesFor(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
