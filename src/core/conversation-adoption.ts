// How a conversation becomes this store's active one: resuming the
// stored thread, opening one from history, entering from a landed send,
// folding in a refreshed detail, abandoning — and the identified
// visitor's history list that frames them. One module because every path
// funnels through the same adoption core (_finishAdoption and the
// wire-pick/scope rulings it applies).

import type {
  AssistantThreadDetailResponse,
  ServingAssistantThread,
  ServingAssistantTurn,
} from "../contract/threads.js";
import {
  clearStoredThread,
  readStoredThread,
  writeStoredThread,
} from "../persistence/stored-thread.js";
import {
  getAssistantThread,
  listAssistantThreads,
} from "../transport/serving-api.js";
import { ServingApiError } from "../transport/serving-error.js";
import { StreamResumeStore } from "../transport/stream-resume.js";
import {
  ApprovalInbox,
  SERVING_APPROVAL_CAPABILITIES,
} from "./approval-inbox.js";
import { resetComposerInput } from "./composer-input-state.js";
import type { ComposerModelPick } from "./conversation-contract.js";
import { publishStore } from "./conversation-publish.js";
import type { AssistantConversationStore } from "./conversation-store.js";
import {
  noteNewestTurn,
  publishApprovalCards,
  reconcileApprovals,
} from "./epoch-sync.js";
import { userSentenceFor } from "./error-copy.js";
import { backfilledTurnsOf, TURNS_WINDOW } from "./turns-backfill.js";
import { failureSentenceOf } from "./turn-failure-copy.js";
import { UserTurnLedger, userMessageIdFor } from "./user-turn-ledger.js";

// The history menu's fetch size — the serving list's maximum, asked for
// explicitly because the menu renders the visitor's history whole (no
// load-older affordance yet; that item is deferred). The API default
// (50) would silently hide a long-lived visitor's older conversations.
const HISTORY_WINDOW = 200;

// --- resuming the stored conversation ---

/** Re-adopts the stored thread (another surface may have moved it while
 *  this one wasn't looking). The boot calls it once; the palette calls
 *  it again on every open. */
export function resumeStoredThreadFromStore(
  store: AssistantConversationStore,
): void {
  const stored = readStoredThread(store.deps.publishableKey);
  if (stored === null) {
    // Nothing stored but a conversation on screen: another surface (or
    // the host's resetAssistant) started over while this one wasn't
    // looking. Resuming means following it to the empty state, not
    // keeping a ghost of the old thread.
    if (store._active !== null) {
      _abandonConversation(store);
    }
    return;
  }
  const request = store._resumeRequest + 1;
  store._resumeRequest = request;
  // Booting onto a stored thread shows the skeleton, not a flash of the
  // empty state; a palette re-open with a conversation already on
  // screen keeps showing it while the re-adoption catches up.
  if (store._active === null) {
    store._threadOpening = true;
    publishStore(store);
  }
  getAssistantThread(store.deps.session, stored.threadId)
    .then((detail) => {
      if (store._resumeRequest === request) {
        _adoptThreadDetail(store, detail);
      }
    })
    .catch((error: unknown) => {
      if (store._resumeRequest !== request) {
        return;
      }
      store._threadOpening = false;
      publishStore(store);
      if (_threadIsGone(error)) {
        // The stored id no longer opens for this visitor (purged, or an
        // identity change) — start clean rather than erroring.
        clearStoredThread(store.deps.publishableKey);
        if (store._active !== null) {
          _abandonConversation(store);
        }
        return;
      }
      if (error instanceof Error) {
        store.deps.reportError(error);
      }
    });
}

// --- navigation ---

export function openThreadFromStore(
  store: AssistantConversationStore,
  thread: ServingAssistantThread,
): void {
  invalidateInFlightResume(store);
  store._sendError = null;
  store._streamInterrupted = false;
  store._stopping = false;
  store._pendingEcho = null;
  store._threadOpening = true;
  publishStore(store);
  getAssistantThread(store.deps.session, thread.id)
    .then((detail) => {
      _adoptThreadDetail(store, detail);
      writeStoredThread(store.deps.publishableKey, {
        threadId: detail.thread.id,
        identified: store._tier === "identified",
      });
    })
    .catch((error: unknown) => {
      store._threadOpening = false;
      store._sendError = userSentenceFor(error);
      publishStore(store);
      if (error instanceof Error) {
        store.deps.reportError(error);
      }
    });
}

export function startNewConversationFromStore(
  store: AssistantConversationStore,
): void {
  _abandonConversation(store);
  clearStoredThread(store.deps.publishableKey);
}

// --- adoption ---

function _adoptThreadDetail(
  store: AssistantConversationStore,
  detail: AssistantThreadDetailResponse,
): void {
  const ask = ++store._adoptionAsk;
  if (detail.turns.length < TURNS_WINDOW) {
    _finishAdoption(store, detail);
    return;
  }
  // A full window means earlier turns exist beyond it — and the replay
  // runs the WHOLE conversation the moment adoption publishes, so the
  // ledger must be complete first or old runs replay with the wrong
  // user message spliced in (the injector's ordered fallback guesses).
  // The skeleton stays up while the cursor walks back; only
  // pathological >window threads ever wait, one fetch per extra window.
  // A flaky page degrades inside the walk (adopt with what landed);
  // only a superseded ask adopts nothing.
  void backfilledTurnsOf(
    detail.turns,
    (cursor) =>
      getAssistantThread(store.deps.session, detail.thread.id, cursor),
    { isStale: () => store._adoptionAsk !== ask },
  ).then((turns) => {
    if (turns !== null) {
      _finishAdoption(store, { thread: detail.thread, turns });
    }
  });
}

function _finishAdoption(
  store: AssistantConversationStore,
  detail: AssistantThreadDetailResponse,
): void {
  // Same thread → same ledger and resume store. A mounted Transcript's
  // injector holds the ledger it was born with — swapping in a fresh
  // one under an unchanged key would strand every merge where the
  // injector never looks (e.g. re-adopting on palette open while the
  // replay is already running) — and the resume snapshot must likewise
  // survive re-adoption.
  const active = store._active;
  const continuing = active !== null && active.thread.id === detail.thread.id;
  const ledger = continuing ? active.ledger : new UserTurnLedger();
  const resume = continuing ? active.resume : new StreamResumeStore();
  const approvalInbox = continuing
    ? active.approvalInbox
    : new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
  ledger.merge(detail.turns);
  store._active = {
    thread: detail.thread,
    ledger,
    resume,
    approvalInbox,
    coworkerRequestTurns: detail.turns,
  };
  if (!continuing) {
    // A thread switch drops the previous conversation's staged answers
    // — they belong to a pause the member walked away from.
    store.questionDrafts.clearAll();
  }
  // Switching threads overwrites even a dirty selection — the visitor
  // left the conversation it belonged to. Re-adopting the SAME thread
  // (the palette reopens on every open) must not: a chip selection not
  // yet carried by a send survives the reopen and rides the next one.
  _adoptWireModelPick(store, detail.thread, { evenWhenDirty: !continuing });
  // The unsaved draft follows the same ruling: switching
  // threads drops it — the unsent text belonged to the conversation
  // the visitor left — while re-adopting the SAME thread (the palette
  // reopens on every open, settle refreshes land here too) keeps it.
  // Continuing needs no write: the input's threadId already names this
  // thread (the ComposerInput invariant — every _active move writes it).
  if (!continuing) {
    resetComposerInput(store, detail.thread.id);
  }
  store._threadOpening = false;
  noteNewestTurn(store, detail.turns.at(-1) ?? null, !continuing);
  store._awaitingTurn = _newestAnswerableTurnOf(detail.turns);
  reconcileApprovals(store, detail.turns);
  adoptCoworkerRequests(store, detail.turns);
  store._turnFailure = failureSentenceOf(detail.turns);
  // Any recorded interruption predates this adoption: adopting goes
  // with a Transcript (re)mount, whose fresh connection either works
  // — making the old banner a lie over a healthy stream — or fails
  // and raises its own.
  store._streamInterrupted = false;
  // A pending stop ends when no LIVE turn remains — not when busy
  // flips false (busy now derives from the rows, so a QUEUED backlog
  // keeps it true long after the stopped turn settled; queued rows
  // are a different turn's future, never the stop's).
  if (!_someTurnIsLive(detail.turns)) {
    store._stopping = false;
  }
  publishStore(store);
}

/** The coworker requests the turns window lists, handed to
 *  the live epoch's inbox; the window rides the active conversation so a
 *  fresh epoch seeds from it and it dies with the conversation. The
 *  coworkers' approval cards ride the same read into the
 *  carried approval inbox — conversation-lived, so no epoch seed. */
function adoptCoworkerRequests(
  store: AssistantConversationStore,
  turns: readonly ServingAssistantTurn[],
): void {
  const active = store._active;
  if (active !== null) {
    active.coworkerRequestTurns = turns;
  }
  store._epoch?.withExecutionInbox((inbox) => {
    // Two facts off one read: the coworker requests the window lists, and
    // the settled turns whose runs can hold no open ask of the assistant's.
    const adopted = inbox.adoptCoworkerRequests(turns);
    const reconciled = inbox.reconcileWithTurns(turns);
    return adopted || reconciled;
  });
  // The cards AFTER the entries: the work cell folds both, and on a thread
  // switch the live epoch is still the previous conversation's until the
  // mint — its coworker entries must be delisted before the new window's
  // cards publish, or one fold would name the departed thread's work.
  if (active?.approvalInbox.adoptCoworkerApprovals(turns) === true) {
    publishApprovalCards(store, active.approvalInbox.cards());
  }
}

// Folds a re-fetched thread detail into the live conversation without
// touching the interruption notice — unlike _adoptThreadDetail, this
// path is not coupled to a Transcript (re)mount, so a recorded
// interruption stays whatever its own handler decided.
export function adoptRefreshedDetail(
  store: AssistantConversationStore,
  detail: AssistantThreadDetailResponse,
): void {
  const active = store._active;
  if (active?.thread.id !== detail.thread.id) {
    return;
  }
  active.ledger.merge(detail.turns);
  // Keep the _active REFERENCE when the thread record did not move:
  // the conversation cell's comparer reads `active` by
  // identity, so minting a literal here made every machine-driven
  // re-read — the 60s idle cadence, each delivery-claim beat, the
  // settle timer, the stream-end re-read — notify every
  // conversation subscriber over an unchanged snapshot. Everything
  // below is already quiet on an unchanged read (merge no-ops on
  // known turns, the model pick / newest turn / activity /
  // composer comparers are content-based, reconcile answers "did
  // anything change"), so this reference is the one leak. THE
  // PREMISE (checkable): JSON.stringify yields different strings
  // for different content, so "same" here can NEVER hide a change
  // — the direction that would matter (a missed publish is a
  // missed attach and a stale busy flip) is structurally closed.
  // The held operand is literally the previous response's parsed
  // thread object, so equal content stringifies equal in practice;
  // a server that re-orders keys between identical responses
  // merely degrades to the pre-fix publish — bounded redundant
  // notify, never silence.
  if (_sameWireRecord(active.thread, detail.thread)) {
    store._active = active;
  } else {
    store._active = {
      thread: detail.thread,
      ledger: active.ledger,
      resume: active.resume,
      approvalInbox: active.approvalInbox,
      coworkerRequestTurns: active.coworkerRequestTurns,
    };
  }
  // A refresh re-seeds the pick from the wire truth (the server may
  // have cleared it between turns) — unless a chip selection is still
  // waiting for its send.
  _adoptWireModelPick(store, detail.thread, { evenWhenDirty: false });
  noteNewestTurn(store, detail.turns.at(-1) ?? null);
  store._awaitingTurn = _newestAnswerableTurnOf(detail.turns);
  reconcileApprovals(store, detail.turns);
  adoptCoworkerRequests(store, detail.turns);
  store._turnFailure = failureSentenceOf(detail.turns);
  // The settled truth is what a pending stop was waiting for: no LIVE
  // turn means it ended (stopped, or the answer won the race) — busy
  // alone no longer says that, since a QUEUED backlog keeps it true.
  if (!_someTurnIsLive(detail.turns)) {
    store._stopping = false;
  }
  publishStore(store);
}

// The thread object's model_pick is the stored truth; an
// adoption that goes with a (re)mount overwrites even a dirty local
// selection — the visitor is looking at a freshly opened conversation —
// while a background refresh yields to one still waiting for its send.
function _adoptWireModelPick(
  store: AssistantConversationStore,
  thread: ServingAssistantThread,
  { evenWhenDirty }: { evenWhenDirty: boolean },
): void {
  if (store._modelPickDirty && !evenWhenDirty) {
    return;
  }
  const pick = thread.model_pick ?? null;
  store._modelPick =
    pick === null
      ? null
      : { modelId: pick.model_id ?? null, effort: pick.effort ?? null };
  store._modelPickDirty = false;
}

export function enterConversationFromSend(
  store: AssistantConversationStore,
  thread: ServingAssistantThread,
  turn: ServingAssistantTurn,
  sentPick: ComposerModelPick | null,
): void {
  invalidateInFlightResume(store);
  const active = store._active;
  const continuing = active !== null && active.thread.id === thread.id;
  const ledger = continuing ? active.ledger : new UserTurnLedger();
  const resume = continuing ? active.resume : new StreamResumeStore();
  const approvalInbox = continuing
    ? active.approvalInbox
    : new ApprovalInbox(SERVING_APPROVAL_CAPABILITIES);
  if (continuing) {
    // The landed send withdraws any pause the previous turn still
    // held (the entity's member open voids the parked pause
    // the queued message moved past — one beat after the 201, not at
    // the door). The carried cards promised exactly this — "sending a
    // new message will withdraw this request" — so they go visibly
    // stale NOW, not a REST read later when the voided turn's settled
    // word removes them; a reconnect that fails must not
    // leave withdrawn Approve/Deny buttons rendering live.
    approvalInbox.markPauseStale();
    // The same open voids every paused coworker of the thread:
    // their requests and approval cards go stale now too, not a refresh
    // later.
    approvalInbox.markCoworkerCardsStale();
    store._epoch?.withExecutionInbox((inbox) =>
      inbox.markCoworkerRequestsStale(),
    );
  }
  ledger.record(turn);
  // THE PREMISE: the send's member open voids EVERY paused
  // coworker of the thread, so no request the pre-send window listed
  // survives it — the conversation enters the send with an EMPTY window,
  // and the fresh epoch the nonce bump below mints seeds nothing. The
  // entity's void lands one beat after the 201; had the window carried
  // over, that beat is exactly when the driver's next pass could still
  // find the dispatching turn listing the request and perform the action
  // the send withdrew. The next conversation read re-establishes the
  // truth from the server.
  store._active = {
    thread,
    ledger,
    resume,
    approvalInbox,
    coworkerRequestTurns: [],
  };
  // The landed send carried sentPick (or kept the stored one); the
  // response thread is its settled truth, and nothing is dirty — UNLESS
  // the selection changed while the send was in flight (the shelf stays
  // live): that newer choice stays dirty and rides the next send.
  if (sameModelPick(store._modelPick, sentPick)) {
    _adoptWireModelPick(store, thread, { evenWhenDirty: true });
  }
  noteNewestTurn(store, turn, !continuing);
  // The landed send re-scopes the input to its conversation — a first
  // send mints the thread scope the refusal guard compares against on
  // the NEXT send. Draft and attachments ride through untouched: the
  // submitted text was already consumed by the composer's optimistic
  // clear, so whatever is here now was typed DURING the POST (the
  // shelf-stays-live doctrine) and belongs to this conversation.
  store._composerInput.set({
    ...store._composerInput.get(),
    scope: `t:${thread.id}`,
  });
  writeStoredThread(store.deps.publishableKey, {
    threadId: thread.id,
    identified: store._tier === "identified",
  });
  store._pendingEcho = {
    messageId: userMessageIdFor(turn.id),
    text: turn.user_message,
    attachments: turn.attachments ?? [],
  };
  // A fresh replay-then-tail connection picks the new turn up; the
  // echo above bridges the moment until its rows arrive.
  store._reconnectNonce += 1;
  publishStore(store);
  // The new conversation's title joins the history.
  void refreshThreads(store);
}

// Drops the in-memory conversation and every notice that belonged to
// it. Storage is the caller's concern — a new conversation clears it,
// a resume that found it already cleared does not need to.
function _abandonConversation(store: AssistantConversationStore): void {
  invalidateInFlightResume(store);
  store._sendError = null;
  store._turnFailure = null;
  store._streamInterrupted = false;
  store._stopping = false;
  store._threadOpening = false;
  store._pendingEcho = null;
  store._active = null;
  store._newestTurn = null;
  store._awaitingTurn = null;
  store._lastResult = null;
  // A new conversation starts unpicked — the served default answers
  // until its user chooses.
  store._modelPick = null;
  store._modelPickDirty = false;
  // The unsaved draft dies with the conversation it was typed into
  // — abandoning is a user action, never a transport event.
  // The question-set drafts go with it, same reasoning.
  resetComposerInput(store, null);
  store.questionDrafts.clearAll();
  publishStore(store);
}

export function invalidateInFlightResume(
  store: AssistantConversationStore,
): void {
  store._resumeRequest += 1;
  // Every caller is a new-intent moment (open, abandon, a landed send,
  // dispose), so a >window adoption's in-flight backfill must die with
  // the old intent too — without this, an abandoned thread's drain
  // completes later and resurrects it over the fresh empty state.
  store._adoptionAsk += 1;
}

// --- the identified visitor's history ---

export async function refreshThreads(
  store: AssistantConversationStore,
): Promise<void> {
  if (store._tier !== "identified") {
    return;
  }
  try {
    store._threads = await listAssistantThreads(store.deps.session, {
      limit: HISTORY_WINDOW,
    });
    publishStore(store);
  } catch {
    // The list is decoration; the conversation itself still works.
  }
}

export function loadHistoryOnceExpected(
  store: AssistantConversationStore,
): void {
  if (!historyExpected(store) || store._historyLoadRequested) {
    return;
  }
  store._historyLoadRequested = true;
  listAssistantThreads(store.deps.session, { limit: HISTORY_WINDOW })
    .then((history) => {
      if (!store._disposed) {
        store._threads = history;
        publishStore(store);
      }
    })
    .catch(() => {
      // The list is decoration; the conversation itself still works.
    });
}

export function historyExpected(store: AssistantConversationStore): boolean {
  return store.deps.identityProvided || store._tier === "identified";
}

function _threadIsGone(error: unknown): boolean {
  return error instanceof ServingApiError && error.status === 404;
}

// A turn a stop could still be waiting on: running, or paused awaiting
// answers (its workflow is live either way). QUEUED rows are the
// entity's future work, PARKED has no run to stop.
function _someTurnIsLive(turns: readonly ServingAssistantTurn[]): boolean {
  return turns.some(
    (turn) => turn.status === "working" || turn.status === "awaiting_input",
  );
}

// The newest turn in a pausing status, scanned across the whole window
// (with queuing the pause can sit behind QUEUED rows). Status
// only — per-interrupt membership is approval-decision.ts's
// _turnAwaitsInterrupt.
function _newestAnswerableTurnOf(
  turns: readonly ServingAssistantTurn[],
): ServingAssistantTurn | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.status === "awaiting_input" || turn.status === "parked") {
      return turn;
    }
  }
  return null;
}

export function sameModelPick(
  a: ComposerModelPick | null,
  b: ComposerModelPick | null,
): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.modelId === b.modelId && a.effort === b.effort;
}

// Content equality between two parses of the same wire record — the
// unchanged-refresh guard in adoptRefreshedDetail (see the premise
// written there: different content always stringifies different, so the
// dangerous direction — treating a moved record as unchanged — cannot
// happen; key-order drift only costs a redundant publish). Concretely
// typed on purpose: an `unknown` signature would let a future caller
// hand the whole detail (the guard would then almost never hit —
// redundant publishes) or the whole ActiveConversation with its class
// instances (stringify would compare stripped shells and the guard
// would ALWAYS hit — silent adoption loss); the concrete type turns
// both into compile errors.
function _sameWireRecord(
  a: ServingAssistantThread,
  b: ServingAssistantThread,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
