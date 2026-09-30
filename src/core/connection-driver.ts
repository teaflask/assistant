// The connection driver: the store is the ONLY socket driver — the truth
// table decides when one is held, an epoch connects ONCE, a background
// attach remints the epoch, and the stream-end verdict tells a designed
// stop from an attach or a death. Record: docs/connection-lifecycle.md.

import type { ServingAssistantTurn } from "../contract/threads.js";
import type { ConnectionEpoch } from "./connection-epoch.js";
import { settlesFor } from "./conversation-refresh.js";
import {
  publishStore,
  scheduleConnectionSync,
} from "./conversation-publish.js";
import type { AssistantConversationStore } from "./conversation-store.js";

// The stream-end refresh's bound: how long _connectionEnded may
// hold the connect gate for REST's verdict. This transport aborts nothing,
// so the bound — never the GET — releases the gate. Equal to the
// delivery-claim window on purpose; its own constant so it stays retunable.
const CONNECTION_ENDED_REFRESH_BOUND_MS = 8_000;

// The hard bound on store-initiated reconnects: an unattended reconnect
// loop on a public embed is the one failure mode this feature must not
// have. No-progress automatic reconnects stop here and surface
// stream-trouble; a human retry, a mount, or a new turn resets the count.
const MAX_AUTOMATIC_RECONNECTS = 5;

// The connection truth table (docs/connection-lifecycle.md): a mounted
// surface connects ONCE per epoch; headless, only queued|working holds a
// socket — parked keeps the epoch armed but NO socket.
export function turnHoldsAStream(store: AssistantConversationStore): boolean {
  const status = store._newestTurn?.status;
  return status === "queued" || status === "working";
}

function _connectWanted(store: AssistantConversationStore): boolean {
  if (store._leaseHolders.length > 0) {
    return !store._epochConnectedOnce || turnHoldsAStream(store);
  }
  return turnHoldsAStream(store);
}

export function syncConnection(store: AssistantConversationStore): void {
  if (
    store._disposed ||
    store._connectionRunning ||
    store._epoch === null ||
    !_connectWanted(store) ||
    store._automaticReconnects >= MAX_AUTOMATIC_RECONNECTS
  ) {
    return;
  }
  if (store._epochConnectedOnce) {
    _remintForBackgroundAttach(store);
    return;
  }
  const epoch = store._epoch;
  const turnBefore = store._newestTurn;
  store._connectionRunning = true;
  store._epochConnectedOnce = true;
  epoch.agent
    .connectAgent()
    .catch(() => undefined)
    .then(() => _connectionEnded(store, epoch, turnBefore))
    .catch(() => undefined);
}

function _remintForBackgroundAttach(store: AssistantConversationStore): void {
  // A wanted connect on a USED epoch (a background-initiated turn
  // landed after this epoch's stream closed). Connect-ONCE is the agent's
  // frozen-cursor law, so remint on the BACKGROUND nonce — never
  // _reconnectNonce, which would remount the visitor's subtree. Only
  // _streamInterrupted resets here; the rest belong to other lifecycles.
  store._streamInterrupted = false;
  store._backgroundAttachNonce += 1;
  publishStore(store);
}

// The stream ended. REST is the authority on what that meant:
// park/settle are designed stops (no reconnect — the human's POST
// begins the next epoch); a turn the workflow still owns means the
// connection died under us, and the store reconnects on a fresh epoch
// under the automatic budget.
async function _connectionEnded(
  store: AssistantConversationStore,
  epoch: ConnectionEpoch,
  turnBefore: ServingAssistantTurn | null,
): Promise<void> {
  let refreshSettled = false;
  try {
    if (_connectionDecisionMoot(store, epoch)) {
      return;
    }
    // Held through the refresh so its publishes cannot race a second
    // connect — but BOUNDED BY THE TIMER, NEVER THE GET: the
    // gate's release must not depend on a network promise settling; any
    // settled rejection releases it through the finally below.
    refreshSettled = await Promise.race([
      store.refreshConversation().then(() => true),
      settlesFor(CONNECTION_ENDED_REFRESH_BOUND_MS).then(() => false),
    ]);
  } finally {
    store._connectionRunning = false;
    // A mooted decision (an epoch retired mid-connection) still owes the
    // fresh epoch its connect decision, and nothing else re-triggers it.
    if (_connectionDecisionMoot(store, epoch)) {
      scheduleConnectionSync(store);
    }
  }
  if (_connectionDecisionMoot(store, epoch)) {
    return;
  }
  if (!refreshSettled) {
    _judgeBoundedOut(store);
    return;
  }
  _judgeStreamEnd(store, turnBefore);
}

function _judgeBoundedOut(store: AssistantConversationStore): void {
  // BOUNDED OUT: REST never confirmed _newestTurn, so the arms
  // below must not judge on it. Charge the automatic budget (the only
  // thing bounding a remint loop on wedged REST) and reschedule the sync.
  store._automaticReconnects += 1;
  if (store._automaticReconnects >= MAX_AUTOMATIC_RECONNECTS) {
    // EXHAUSTION MUST BE LOUD HERE TOO: with REST wedged, retryStream —
    // reachable only through the banner — is the sole in-page reset, so a
    // quiet return here would be a permanent, reload-only dead end.
    store._streamInterrupted = true;
    publishStore(store);
    return;
  }
  scheduleConnectionSync(store);
}

// The refresh landed: judge what the close meant on REST-confirmed truth
// — a designed stop, a background attach, or a death under a live turn.
function _judgeStreamEnd(
  store: AssistantConversationStore,
  turnBefore: ServingAssistantTurn | null,
): void {
  if (!turnHoldsAStream(store)) {
    store._automaticReconnects = 0;
    publishStore(store);
    return;
  }
  if (store._newestTurn?.id !== turnBefore?.id) {
    // THE ATTACH/DEATH DISCRIMINATOR: a changed newest-turn id is
    // an ATTACH, not a death — turn ids are immutable, so a same-id live
    // turn IS the watched one dying. Ride the background nonce (no
    // remount), never the reconnect bump; the budget zeroed on adoption.
    publishStore(store);
    return;
  }
  _reconnectAfterDeath(store, turnBefore);
}

// The same turn is still live after the close: the connection died under
// us. Count it against the automatic budget and reconnect by remount.
function _reconnectAfterDeath(
  store: AssistantConversationStore,
  turnBefore: ServingAssistantTurn | null,
): void {
  const progressed =
    store._newestTurn?.updated_at !== turnBefore?.updated_at ||
    store._newestTurn?.status !== turnBefore?.status;
  store._automaticReconnects = progressed ? 1 : store._automaticReconnects + 1;
  if (store._automaticReconnects >= MAX_AUTOMATIC_RECONNECTS) {
    // The bound, not just a stop condition: surface stream-trouble and
    // wait for a human (retry, mount) or a new turn to reset it.
    store._streamInterrupted = true;
    publishStore(store);
    return;
  }
  // THE DEATH ARM'S REMOUNT IS DELIBERATE: the bump moves the Transcript
  // key (thread.id#reconnectNonce), resetting the subtree's UI state on a
  // fresh epoch. It must NEVER eat unsaved input: the draft lives
  // on the store's _composerInput cell, above the key; no reconnect clears it.
  store._reconnectNonce += 1;
  // THE CARET: the remount tears down a focused textarea with no blur, so
  // hand the caret back AT THE REMOUNT (the box stays live), and ONLY when
  // the composer demonstrably owned focus. ORDERING: read synchronously
  // BEFORE the publishStore() below, whose remount invalidates the record.
  if (store._composerFocusOwned !== null) {
    store._composerCaretReturnPending = store._composerFocusOwned;
  }
  publishStore(store);
}

// Disposal or an epoch swap takes the decision out of this connect's
// hands — read fresh on every consult because both can move during the
// awaits above. (Surface presence no longer moots anything: mounted or
// not, the store is the driver.)
function _connectionDecisionMoot(
  store: AssistantConversationStore,
  epoch: ConnectionEpoch,
): boolean {
  return store._disposed || store._epoch !== epoch;
}
