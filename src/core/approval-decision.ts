// Answering approvals: the one POST per decision, under the
// self-narration law (attempted, sent, and every drop with its
// reason), with the durable-turn-first target resolution the execution
// driver also follows. turnIdAnsweredBy is exported for the elicitation
// submit, its documented twin.

import type {
  ApprovalSubmitDropReason,
  ApprovalSubmitTelemetryEvent,
} from "../contract/telemetry.js";
import { resolveTurnApproval } from "../transport/serving-api.js";
import { ServingApiError } from "../transport/serving-error.js";
import {
  ANSWER_NOT_SENT_SENTENCE,
  type ApprovalCardModel,
  type ApprovalDecisionInput,
  type ApprovalInbox,
} from "./approval-inbox.js";
import type { ActiveConversation } from "./conversation-contract.js";
import type { AssistantConversationStore } from "./conversation-store.js";
import type { ElicitationCardModel } from "./elicitation-cards.js";
import { publishApprovalCards } from "./epoch-sync.js";
import { userSentenceFor } from "./error-copy.js";
import type { ServingAssistantTurn } from "../contract/threads.js";

export async function submitApprovalDecisionFromStore(
  store: AssistantConversationStore,
  card: ApprovalCardModel,
  decision: ApprovalDecisionInput,
): Promise<void> {
  const active = store._active;
  // Only a card that advertised the affordance may speak trust — the
  // door degrades a stray token to a plain approval anyway; this keeps
  // the wire honest from here.
  const trusting =
    decision.trust === true && !card.gated && card.trustAvailable;
  const telemetry = _approvalTelemetryOf(
    store,
    card,
    decision,
    trusting,
    active,
  );
  telemetry("approval_submit_attempted");
  // No epoch gate here on purpose: the POST needs only session + thread
  // + inbox, and a parked turn legitimately holds no socket.
  if (active === null) {
    // Should be impossible while a card renders (cards come from the
    // active thread's inbox) — say so loudly instead of swallowing it.
    telemetry("approval_submit_dropped", "no_active_thread");
    store.deps.reportError(
      new Error(
        `Approval decision dropped: no active conversation to answer into (interrupt ${card.interruptId}).`,
      ),
    );
    return;
  }
  const inbox = active.approvalInbox;
  if (!inbox.beginSubmit(card.interruptId)) {
    _explainBeginSubmitRefusal(store, inbox, card, telemetry);
    return;
  }
  // Confine every shared-cell write to this submit's own inbox: a
  // thread switch during the POST replaces the active conversation, and
  // publishing the resolved OLD inbox's cards would stamp a foreign
  // approval onto the now-active thread until its stream next publishes.
  // Deliberately the INBOX's identity, not the epoch's or _active's: a
  // reconnect (or any refresh) on the same thread keeps this inbox, and
  // the submit's progress must keep rendering straight through it.
  const publishIfCurrent = () => {
    if (store._active?.approvalInbox === inbox) {
      publishApprovalCards(store, inbox.cards());
    }
  };
  publishIfCurrent();
  try {
    await _postApprovalDecision(
      store,
      active,
      inbox,
      card,
      decision,
      trusting,
      telemetry,
    );
  } catch (error) {
    if (_turnNoLongerAwaiting(error)) {
      // Timed out, or answered in another tab: the whole pause is over.
      // Re-read the thread for its settled truth (busy flag, and the
      // timeout sentence rides the failure banner). A coworker's 409
      // speaks for its card alone — the turn's own pause,
      // if any, is untouched.
      if (card.asker.kind === "coworker") {
        inbox.markCoworkerCardStale(card.interruptId);
      } else {
        inbox.markPauseStale();
      }
      void store.refreshConversation();
    } else {
      inbox.settleSubmitError(card.interruptId, userSentenceFor(error));
    }
  } finally {
    publishIfCurrent();
  }
}

// The self-narration law: this handler NEVER returns
// without a request, a visible state change, or a telemetered drop
// reason. attempted-without-sent is the queryable alarm.
type _SubmitTelemetry = (
  name: ApprovalSubmitTelemetryEvent["name"],
  dropReason?: ApprovalSubmitDropReason,
) => void;

function _approvalTelemetryOf(
  store: AssistantConversationStore,
  card: ApprovalCardModel,
  decision: ApprovalDecisionInput,
  trusting: boolean,
  active: ActiveConversation | null,
): _SubmitTelemetry {
  return (name, dropReason) => {
    store.deps.onTelemetry({
      name,
      properties: {
        interrupt_id: card.interruptId,
        thread_id: active?.thread.id ?? null,
        approved: decision.approved,
        trusted: trusting,
        card_status: card.status.kind,
        parked: card.parked,
        ...(dropReason === undefined ? {} : { drop_reason: dropReason }),
      },
    });
  };
}

// beginSubmit refused: the rendered card lagged the live one, or the
// first submit is already in flight — narrate the drop and, when the live
// truth moved, re-read it so reconciliation visibly settles what the user
// is seeing.
function _explainBeginSubmitRefusal(
  store: AssistantConversationStore,
  inbox: ApprovalInbox,
  card: ApprovalCardModel,
  telemetry: _SubmitTelemetry,
): void {
  const liveKind = inbox.statusOf(card.interruptId);
  if (liveKind === "submitting") {
    // A benign double-click: the first submit is in flight and the
    // live card already renders its spinner.
    telemetry("approval_submit_dropped", "already_submitting");
    return;
  }
  // The rendered card lagged the live one — re-read the durable
  // truth so reconciliation visibly settles what the user is seeing.
  telemetry(
    "approval_submit_dropped",
    liveKind === "answered"
      ? "not_actionable_answered"
      : liveKind === "stale"
        ? "not_actionable_stale"
        : "card_missing",
  );
  if (liveKind !== null) {
    void store.refreshConversation();
  }
}

// The POST itself and its delivery arms — target resolution, the one
// answer per POST, and what each delivery verdict means for the pause.
async function _postApprovalDecision(
  store: AssistantConversationStore,
  active: ActiveConversation,
  inbox: ApprovalInbox,
  card: ApprovalCardModel,
  decision: ApprovalDecisionInput,
  trusting: boolean,
  telemetry: _SubmitTelemetry,
): Promise<void> {
  // A coworker's card has exactly one door — its dispatching turn,
  // whatever that turn's status (the execution driver's rule).
  const turnId =
    card.asker.kind === "coworker"
      ? card.turnId
      : await _turnIdAwaitingInterrupt(store, card, active);
  if (turnId === null) {
    inbox.settleSubmitError(card.interruptId, ANSWER_NOT_SENT_SENTENCE);
    telemetry("approval_submit_dropped", "no_turn_id");
    return;
  }
  telemetry("approval_submit_sent");
  // One answer per POST — sibling cards stay individually actionable,
  // and the workflow resumes once every pending ask is answered.
  const resolution = await resolveTurnApproval(
    store.deps.session,
    active.thread.id,
    turnId,
    {
      approvals: [
        {
          interrupt_id: card.interruptId,
          approved: decision.approved,
          ...(trusting ? { trust: true } : {}),
          ...(decision.feedback === undefined
            ? {}
            : { feedback: decision.feedback }),
        },
      ],
    },
  );
  // Delivery is asynchronous (the response's turn still says
  // awaiting_input); on a live pause the stream's own resume closes
  // the card. An answer that restarted a parked turn's workflow has
  // no live stream to do that — reconnecting is what picks up the
  // restarted run (and its approval_resolved receipt keeps the
  // replayed card answered).
  inbox.settleSubmitAnswered(card.interruptId, decision.approved, trusting);
  if (
    // Confined like every post-await read: the reclaim probes exist
    // to un-freeze the conversation being VIEWED, and after a
    // mid-POST thread switch there is nothing here to un-freeze —
    // reopening the thread reconnects on adoption, while the probes
    // would bounce the other thread's epoch for nothing.
    store._active?.approvalInbox === inbox
  ) {
    if (resolution.delivery === "workflow_restarted") {
      store.handleWorkflowRestarted();
    } else if (resolution.delivery === "already_consumed") {
      // The receipt: the answer is already past the door —
      // the turn's own once a resume consumed it and then died parked, or
      // a coworker's once its row left paused with the decision
      // recorded, or paused again at a newer round — nothing
      // was restarted, so no reconnect will ever arrive to move the
      // conversation past this pause.
      // Re-read the turn for its
      // current truth (the contract's instruction): the refreshed
      // projection subtracts consumed ids, so the pause
      // retires instead of rendering a wait nothing will resume.
      void store.refreshConversation();
    }
  }
}

// The turn to answer, resolved durable-turn-first (the execution
// driver's stance): the newest turn that still awaits this interrupt
// names the POST's target — which stays correct after a park-restart,
// when the card's stamped run id names a run the ledger never saw. One
// refresh covers a stale read; a queued message can sit
// NEWER than the pause, so the refreshed check also consults the
// newest ANSWERABLE turn, not just the newest row. The CAPTURED
// conversation's ledger remains as the fallback (absent
// pending_interrupt_ids must never read as empty, and the door's own
// 409 backstops a wrong guess).
//
// Confinement (the publishIfCurrent law): the first _newestTurn read
// runs before any await in the submit, so it still belongs to the
// captured conversation; every read AFTER the refresh trusts the
// store-global turn only while the submit's inbox is still the active
// one — a thread switch mid-refresh would otherwise resolve thread B's
// turn id and POST it to thread A's approval URL. The captured ledger
// is switch-proof by construction.
async function _turnIdAwaitingInterrupt(
  store: AssistantConversationStore,
  card: ApprovalCardModel,
  active: ActiveConversation,
): Promise<string | null> {
  if (_turnAwaitsInterrupt(store._newestTurn, card.interruptId)) {
    return store._newestTurn?.id ?? null;
  }
  await store.refreshConversation();
  if (store._active?.approvalInbox === active.approvalInbox) {
    if (_turnAwaitsInterrupt(store._newestTurn, card.interruptId)) {
      return store._newestTurn?.id ?? null;
    }
    if (_turnAwaitsInterrupt(store._awaitingTurn, card.interruptId)) {
      return store._awaitingTurn?.id ?? null;
    }
  }
  const ledger = active.ledger;
  return (ledger.turnForRun(card.runId) ?? ledger.newestTurn())?.turnId ?? null;
}

// The elicitation submit's twin of _turnIdAwaitingInterrupt: the
// ledger names the pausing run when it can; a lost capture (or
// another tab's send) refreshes and then consults the ANSWERABLE turn
// — a queued message can sit newer than the pause, so
// the ledger's newest record may be a QUEUED turn whose POST would
// 409. Same confinement as the sibling: store-global turns are
// trusted only while this submit's inbox is still the active one.
// ledger.newestTurn() stays the last resort, 409-backstopped.
export async function turnIdAnsweredBy(
  store: AssistantConversationStore,
  active: ActiveConversation,
  card: ElicitationCardModel,
): Promise<string | null> {
  const ledger = active.ledger;
  const known = ledger.turnForRun(card.runId);
  if (known !== null) {
    return known.turnId;
  }
  await store.refreshConversation();
  const refreshed = ledger.turnForRun(card.runId);
  if (refreshed !== null) {
    return refreshed.turnId;
  }
  if (store._active?.approvalInbox === active.approvalInbox) {
    if (_turnAwaitsInterrupt(store._newestTurn, card.interruptId)) {
      return store._newestTurn?.id ?? null;
    }
    if (_turnAwaitsInterrupt(store._awaitingTurn, card.interruptId)) {
      return store._awaitingTurn?.id ?? null;
    }
  }
  return ledger.newestTurn()?.turnId ?? null;
}

// The sibling of the execution driver's durable-turn guard: a
// turn is answerable iff it still pauses (awaiting_input or parked — a
// late answer restarts a parked turn) and still holds the interrupt. Two
// tolerances mirror the driver's: a null run_id is a lost capture, where
// the server hides the cards (the set reads empty though the pause is
// real), so the status gate alone holds; and a server predating
// pending_interrupt_ids sends no array at all, which degrades to the
// status gate too — an actual empty list under a captured run means the
// pause moved on, so absent must never read as empty. A wrong yes is
// backstopped by the door's own 409.
function _turnAwaitsInterrupt(
  turn: ServingAssistantTurn | null,
  interruptId: string,
): boolean {
  if (turn === null) {
    return false;
  }
  if (turn.status !== "awaiting_input" && turn.status !== "parked") {
    return false;
  }
  return (
    turn.run_id === null ||
    !Array.isArray(turn.pending_interrupt_ids) ||
    turn.pending_interrupt_ids.includes(interruptId)
  );
}

function _turnNoLongerAwaiting(error: unknown): boolean {
  return (
    error instanceof ServingApiError &&
    error.code === "ASSISTANT_TURN_NOT_AWAITING_APPROVAL"
  );
}
