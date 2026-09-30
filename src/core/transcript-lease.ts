// Surface presence — the transcript lease: a mounted transcript chrome
// registers its presence for its lifetime, and presence is what upgrades
// the socket policy and arms the leased idle re-read. The _leaseHolders
// roster stays a store field per the friend convention.

import {
  publishStore,
  scheduleConnectionSync,
} from "./conversation-publish.js";
import type { AssistantConversationStore } from "./conversation-store.js";
import { syncIdleRecheck } from "./idle-recheck.js";

/** A mounted transcript chrome registers its presence for its lifetime;
 *  the release is the returned function (idempotent). Any number of
 *  surfaces may render the same cells concurrently — the store is the
 *  only connection driver, so there is nothing left to collide.
 *  Presence upgrades the socket policy (see syncConnection): a mounted
 *  surface guarantees the epoch connects once so history paints, and
 *  the LAST release mid-live-turn changes nothing — the store's own run
 *  simply keeps streaming (the old CopilotChat-abort handoff dance is
 *  gone with the chassis). LAW: never bump reconnectNonce
 *  from this release path — a keyed remount releases and re-acquires in
 *  one tick during normal reconnects. */
export function acquireTranscriptLeaseFromStore(
  store: AssistantConversationStore,
  surface: string,
): () => void {
  store._leaseHolders.push(surface);
  // A human is present again: the automatic-reconnect budget refills.
  store._automaticReconnects = 0;
  // The presence flip may demand a connect (a chrome mounting over a
  // never-connected epoch); the decision rides the same coalesced
  // microtask as every other trigger.
  scheduleConnectionSync(store);
  // Presence also arms the idle re-read — the acquire path
  // deliberately never publishes, so the sync must run here.
  syncIdleRecheck(store);
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const index = store._leaseHolders.indexOf(surface);
    if (index !== -1) {
      store._leaseHolders.splice(index, 1);
    }
    // The publish schedules the connect decision on the coalesced
    // microtask (see scheduleConnectionSync), so a keyed transcript
    // REMOUNT (release then re-acquire in the same tick) is seen
    // settled before the store acts.
    publishStore(store);
  };
}
