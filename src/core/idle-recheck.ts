// The leased idle re-read: while a surface is mounted over a
// conversation whose newest known turn holds no stream, a bounded
// single-flight interval GET is the only way a background-initiated
// delivery turn becomes visible.

import { turnHoldsAStream } from "./connection-driver.js";
import type { AssistantConversationStore } from "./conversation-store.js";

// The leased idle re-read: while a surface is MOUNTED and the
// newest known turn holds no stream, the thread snapshot is the only
// place a background-initiated delivery turn becomes visible — the
// entity's settle-wake and janitor-re-wake openers have no push signal
// the client can hold (the parent stream emits nothing until the delivery
// run's first event, and the server's 60s handoff hold only pushes to a
// socket that is already open). One lightweight GET per interval per
// open conversation; ≤60s of added latency against the janitor's own
// 15-minute sweep. Leased only: a headless embed must not poll for the
// life of the page — its attach happens at the next mount through the
// first-connect arm of the truth table.
const IDLE_RECHECK_INTERVAL_MS = 60_000;

// Armed while a surface is mounted over a conversation whose newest
// known turn holds no stream — parked, awaiting_input, terminal, or
// none: settle wakes and the janitor's re-wakes grow delivery turns
// on terminal threads too, so gating on "parked" would miss them. The
// re-read only calls refreshConversation(). An UNCHANGED read notifies
// no subscriber: adoption keeps the _active reference when the thread
// record did not move (the guard and its premise live in
// adoptRefreshedDetail) and every cell publisher compares before it
// sets — so an idle tick costs one GET and nothing renders. A read
// that DID move still publishes, which is what flips the connect gate
// on a landed queued/working turn and disarms this interval on that
// same publish.
export function syncIdleRecheck(store: AssistantConversationStore): void {
  const wanted =
    !store._disposed &&
    store._leaseHolders.length > 0 &&
    store._active !== null &&
    !turnHoldsAStream(store);
  if (!wanted) {
    clearIdleRecheck(store);
    return;
  }
  store._idleRecheckTimer ??= setInterval(() => {
    // Single-flight (the delivery probe's own refreshOnce posture):
    // this transport aborts nothing, so a tick that stacked a new
    // GET behind an accepted-then-stalled one would add a wedged
    // connection per minute for the life of the page — on HTTP/1.1
    // exhausting the per-host budget and starving the SSE stream
    // itself. One read in flight at a time; a wedged read quiets the
    // interval instead of multiplying, and the flag clears the
    // moment the read settles.
    if (store._idleRecheckInFlight) {
      return;
    }
    store._idleRecheckInFlight = true;
    void store.refreshConversation().finally(() => {
      store._idleRecheckInFlight = false;
    });
  }, IDLE_RECHECK_INTERVAL_MS);
}

export function clearIdleRecheck(store: AssistantConversationStore): void {
  if (store._idleRecheckTimer !== null) {
    clearInterval(store._idleRecheckTimer);
    store._idleRecheckTimer = null;
  }
}
