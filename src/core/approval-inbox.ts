import type { AgentSubscriber } from "@ag-ui/client";

import {
  APPROVAL_REQUESTED_EVENT_NAME,
  APPROVAL_RESOLVED_EVENT_NAME,
  type ApprovalRequestedPayload,
} from "../contract/events.js";
import type { TurnStatus } from "../contract/threads.js";

import { isTerminalTurnStatus } from "./activity.js";
import {
  approvalRequestedPayloadOf,
  coworkerApprovalRequestOf,
  type CoworkerApprovalTurn,
} from "./approval-request-narrowing.js";
import { approvalResolvedPayloadOf } from "../core/approval-resolved.js";

export {
  approvalRequestedPayloadOf,
  coworkerApprovalRequestOf,
  type CoworkerApprovalTurn,
} from "./approval-request-narrowing.js";

// A paused turn's pending approvals. The durable turn record — status and
// pending_interrupt_ids, served on every thread read — is the lifetime
// authority for a card: reconcileWithTurn re-judges the open cards
// against it on every REST read. The stream is fast-path evidence, never
// the reason a pending card silently dies: an approval_requested marker
// opens a card, the approval_resolved receipt answers it, and the resume's
// own evidence (the gated call's TOOL_CALL_RESULT, a later pause round,
// RUN_ERROR) or the settled turn's word closes it — never a RUN_FINISHED
// alone. Replay needs no special casing: markers dedupe by interrupt id
// and a replayed receipt keeps the card answered.
//
// The inbox lives with the CONVERSATION, not the connection epoch: a
// reconnect, a replay or a post-park restart must keep the pending cards
// continuously rendered — there is a human mid-decision behind them. A
// parked turn is the one lifetime the stream cannot narrate: its
// stream simply ends; the quiet close flags the open cards parked (still
// answerable — a late answer is the designed restart path) and the next
// reconcile confirms or clears the flag. React-free; every mutator answers
// "did visible state change" so the recorder publishes only what matters.

export type ApprovalCardStatus =
  | { kind: "actionable"; errorSentence: string | null }
  | { kind: "submitting" }
  // trusted: the approval also opted this tool out of re-asks for the
  // rest of the asker's session. Only the live submit can know it (the
  // replayed receipt doesn't carry the distinction), so a replay renders
  // the plain approved note — never wrong, merely less specific.
  | { kind: "answered"; approved: boolean; trusted: boolean }
  | { kind: "stale" };

/** Who asked: the assistant's own card rides the stream's
 *  marker and the turn's own pending_approvals; a coworker's rides its
 *  DISPATCHING turn's REST snapshot (pending_coworker_approvals), is
 *  answered at that turn's door whatever the turn's status, and lives
 *  exactly as long as the snapshot lists it. label is the dispatch's
 *  brief excerpt — the card names the coworker with it. */
export type ApprovalAsker =
  { kind: "assistant" } | { kind: "coworker"; ordinal: number; label: string };

export interface ApprovalCardModel {
  /** The contract's opaque interrupt id — the card key and the submit id. */
  interruptId: string;
  toolName: string | null;
  /** The paused call's arguments, wire-faithful minus the reserved
   *  `caption` key (the row's label, stripped at narrowing). Populated
   *  but unread: the banner renders nothing argument-derived; the
   *  transcript row carries the request. Kept like the schema pair
   *  below: dropping a recorded consent fact from the model would be a
   *  wire-shape decision, not a presentation one. */
  toolArgs: Record<string, unknown>;
  /** The paused tool's registered input schema. The generic card stays
   *  schema-agnostic; this is the schema channel's card-side producer:
   *  consumed by approvalCardSchemasOf (tool-schema-anchors)
   *  through the store's card funnel, so a paused or denied call's view
   *  still gets its argsSchema. */
  toolInputSchema: Record<string, unknown> | null;
  /** The paused tool's registered output schema, null when the tool
   *  declares none; consumed the same way for the view
   *  contract's resultSchema. */
  toolOutputSchema: Record<string, unknown> | null;
  prompt: string;
  toolCallId: string | null;
  /** True when the card's tool_call_id matched a streamed TOOL_CALL_START.
   *  Stamped only under the `anchoring` capability; false otherwise. */
  anchored: boolean;
  round: number;
  /** The server run that paused, stamped from the enclosing RUN_STARTED. */
  runId: string;
  /**
   * True once the stream ended without a terminal: the turn parked and the
   * assistant is no longer actively waiting, though the ask stays live.
   */
  parked: boolean;
  /** The locked action-approval gate raised this ask (the catalog's ask
   *  policy): strictly per-call, no session trust can waive it. Stamped
   *  only under the `gate` capability; false otherwise. */
  gated: boolean;
  /** The card may offer approve-and-stop-asking (scoped to the asker's
   *  session) — org hitl with trust enabled, never the gate. Absent on an
   *  older wire → false, so
   *  the affordance fails safe to hidden. Stamped only under the `trust`
   *  capability; false otherwise — a door whose decision carries no
   *  trust flag never grows the affordance. */
  trustAvailable: boolean;
  status: ApprovalCardStatus;
  asker: ApprovalAsker;
  /** The dispatching turn a coworker's decision is posted to; null for
   *  the assistant's own cards, which the submit resolves by turn. */
  turnId: string | null;
}

const ACTIONABLE: ApprovalCardStatus = {
  kind: "actionable",
  errorSentence: null,
};

interface CoworkerAsk {
  asker: ApprovalAsker;
  turnId: string;
  parked: boolean;
}

/**
 * A decision as the surface submits it. `trust` (approve AND stop asking
 * about this tool for the rest of the asker's session: the thread for the
 * assistant, that coworker's dispatch for a coworker) is only meaningful on
 * a card whose wire advertised trust_available under the `trust`
 * capability; ignored everywhere else.
 */
export interface ApprovalDecisionInput {
  approved: boolean;
  trust?: boolean;
  feedback?: string;
}

/**
 * The optional capabilities a host wires. Every one defaults
 * OFF: a host wiring none gets a working inbox with fewer powers — the
 * stream opens, answers and closes cards exactly the same — never a
 * demand for data its door cannot supply. The serving-door store turns
 * all three on (SERVING_APPROVAL_CAPABILITIES); the dashboard's
 * playground, whose internal door carries no trust flag and renders the
 * cards in one flat block, wires none.
 */
export interface ApprovalInboxCapabilities {
  /** Stamp `anchored` from streamed TOOL_CALL_STARTs — the suspension
   *  queue's ordering and the row projection's settle join. Off:
   *  noteToolCallStart records nothing and every card reads false. */
  anchoring?: boolean;
  /** Carry the wire's `gated` flag onto cards (the banner's "asks every
   *  time" note). Off: every card reads false. */
  gate?: boolean;
  /** Carry the wire's `trust_available` flag onto cards (the banner's
   *  approve-and-stop-asking control). Off: every card reads false, so
   *  the affordance never renders. */
  trust?: boolean;
}

/** Every capability on — the serving door's shape. */
export const SERVING_APPROVAL_CAPABILITIES: Required<ApprovalInboxCapabilities> =
  { anchoring: true, gate: true, trust: true };

/**
 * The durable turn record as the inbox reads it — the seam a host's REST
 * read satisfies. Every pause field is OPTIONAL on purpose: the
 * serving turn carries all three, the dashboard's internal turn carries
 * them optional-by-default, and an older or partial door may
 * carry none. Absent is never read as empty — it means "no judgement",
 * so the inbox degrades to stream evidence alone rather than demanding a
 * record the host cannot supply.
 */
export interface ApprovalTurnRecord extends CoworkerApprovalTurn {
  status: TurnStatus;
  pending_interrupt_ids?: readonly string[];
  awaiting_round?: number | null;
  pending_approvals?: readonly unknown[];
}

export class ApprovalInbox {
  private currentRunId: string | null = null;
  private readonly seenToolCallIds = new Set<string>();
  private cardList: ApprovalCardModel[] = [];
  // Every interrupt id whose card this inbox removed — closing evidence
  // (tool result, RUN_ERROR, round supersession, settled turn) spends
  // an id forever, and REST hydration must not resurrect it from a stale
  // read. Interrupt ids name one pause instance of one tool
  // call, and every legitimate re-presentation of a pause (park restart,
  // reconnect replay, fallback resume) happens while the card is still
  // held or was never delivered — never after closing evidence — so a
  // closed id can never be wrongly suppressed. Thread-lived like the
  // inbox itself; one short string per closed ask, no eviction needed.
  private readonly closedInterruptIds = new Set<string>();
  // The runs of turns the record reported settled — monotonic
  // like a closed id: nothing opens under one, nothing survives under one.
  private readonly settledRunIds = new Set<string>();
  private readonly capabilities: ApprovalInboxCapabilities;

  constructor(capabilities: ApprovalInboxCapabilities = {}) {
    this.capabilities = capabilities;
  }

  // --- the stream side -------------------------------------------------

  noteRunStarted(runId: string): boolean {
    // A new run is NOT closing evidence for other runs' cards: a parked
    // turn's restarted workflow streams under a fresh run id while the
    // replayed pause still names the old one, and the workflow's wait
    // condition keeps sibling asks individually answerable. Cards die on
    // their own evidence (receipt, result, RUN_ERROR) or on the durable
    // turn record's word — never on another run merely beginning.
    this.currentRunId = runId;
    return false;
  }

  noteToolCallStart(toolCallId: string): boolean {
    if (this.capabilities.anchoring === true) {
      this.seenToolCallIds.add(toolCallId);
    }
    return false;
  }

  noteApprovalRequested(payload: ApprovalRequestedPayload): boolean {
    if (this.currentRunId === null) {
      // A marker outside any run segment is unanchorable — ignore it.
      return false;
    }
    const runId = this.currentRunId;
    if (this.settledRunIds.has(runId)) {
      // A marker under a settled turn's run is history, not an ask.
      return false;
    }
    const held = this.cardList.find(
      (card) => card.interruptId === payload.interrupt_id,
    );
    if (held !== undefined) {
      if (held.asker.kind === "coworker") {
        // A coworker's coordinates are the snapshot's, never a marker's.
        return false;
      }
      // A replayed marker for a card we already hold: keep the card's status
      // — replay must never resurrect buttons on an answered card — but
      // re-stamp the stream coordinates, so the run this replay serves under
      // is the one whose closing evidence governs the card. ANY moved
      // coordinate is a visible change: the submit path reads runId off the
      // published card, and placement reads toolCallId/anchored.
      const toolCallId = payload.tool_call_id ?? null;
      const anchored = this._anchoredOf(toolCallId);
      const changed =
        held.runId !== runId ||
        held.round !== payload.round ||
        held.toolCallId !== toolCallId ||
        held.anchored !== anchored;
      held.runId = runId;
      held.round = payload.round;
      held.toolCallId = toolCallId;
      held.anchored = anchored;
      return changed;
    }
    const newestRound = this._newestRoundOf(runId);
    if (newestRound !== null && payload.round < newestRound) {
      // A lower round replaying after a later pause is history, not an ask.
      return false;
    }
    // A higher round supersedes the run's earlier cards (round
    // namespacing: multi-pause turns re-emit cards and must not collide).
    if (newestRound !== null && payload.round > newestRound) {
      this._removeWhere(
        (card) =>
          card.asker.kind === "assistant" &&
          card.runId === runId &&
          card.round < payload.round,
      );
    }
    this.cardList.push(this._cardFrom(payload, runId, null));
    return true;
  }

  noteApprovalResolved(interruptId: string, approved: boolean): boolean {
    // The receipt is the stream saying "answered" — on a replay it lands
    // right after the marker it answers, so the card flips to answered in
    // the same burst and buttons never resurrect on an already-answered
    // ask. The gated call's result (or the settled turn's word) still
    // closes the card later, exactly like the live path.
    return this._transition(interruptId, ["actionable", "submitting"], {
      kind: "answered",
      approved,
      trusted: false,
    });
  }

  noteToolCallResult(toolCallId: string): boolean {
    // The gated call producing a result is the resume made visible.
    return this._removeWhere((card) => card.toolCallId === toolCallId);
  }

  noteRunFinished(): boolean {
    // Closes nothing by itself. THE PREMISE: the thread streamer
    // synthesizes a RUN_FINISHED for the LIVE run right before re-entering
    // an old run's segment for a late row, re-emits none of the live pause
    // on the way back, and the frame is indistinguishable from a real
    // terminal. A real finish closes through the gated call's result,
    // RUN_ERROR (never synthesized) or the settled turn's word.
    return false;
  }

  noteRunError(): boolean {
    // RUN_ERROR carries no runId — the run being narrated is the one that
    // errored. Scoped to it on purpose: a replayed historical run's error
    // must not wipe a carried live card from a newer pause. The errored
    // turn's settled truth reaches the survivors on the next REST read.
    return this._removeWhere(
      (card) =>
        card.asker.kind === "assistant" && card.runId === this.currentRunId,
    );
  }

  noteStreamClosedWithoutTerminal(): boolean {
    // The parked contract's only wire signal: the stream just ends, with
    // no terminal event. The open asks stay answerable — a late answer is
    // the designed restart path — but their cards learn the assistant
    // stopped actively waiting. A dropped connection takes this same
    // transition (the wire shapes are identical); the conversation layer's
    // REST confirm decides which it was, and either way the cards must
    // survive.
    let changed = false;
    for (const card of this.cardList) {
      if (
        card.asker.kind === "assistant" &&
        !card.parked &&
        (card.status.kind === "actionable" || card.status.kind === "submitting")
      ) {
        card.parked = true;
        changed = true;
      }
    }
    return changed;
  }

  // --- the submit side ---------------------------------------------------

  beginSubmit(interruptId: string): boolean {
    return this._transition(interruptId, ["actionable"], {
      kind: "submitting",
    });
  }

  settleSubmitAnswered(
    interruptId: string,
    approved: boolean,
    trusted = false,
  ): boolean {
    return this._transition(interruptId, ["submitting"], {
      kind: "answered",
      approved,
      trusted,
    });
  }

  settleSubmitError(interruptId: string, sentence: string): boolean {
    return this._transition(interruptId, ["submitting"], {
      kind: "actionable",
      errorSentence: sentence,
    });
  }

  markPauseStale(): boolean {
    // A 409 speaks for the whole pause — the turn no longer awaits ANY of
    // these answers, whatever run each card is stamped with. Answered
    // cards keep their honest note. A coworker's card is not the turn's
    // pause: its 409 is its own (markCoworkerCardStale).
    return this._staleWhere((card) => card.asker.kind === "assistant");
  }

  /** A 409 for a coworker's decision speaks for that card alone. */
  markCoworkerCardStale(interruptId: string): boolean {
    return this._staleWhere(
      (card) =>
        card.asker.kind === "coworker" && card.interruptId === interruptId,
    );
  }

  /** The member's send voids every paused coworker of the thread. */
  markCoworkerCardsStale(): boolean {
    return this._staleWhere((card) => card.asker.kind === "coworker");
  }

  // --- the durable turn record -----------------------------------------------

  /**
   * The REST recovery path: build cards from the turn record's
   * pending_approvals snapshot — the same persisted markers the stream
   * replays — so a failed stream fetch never strands a pending pause. Upsert
   * only: a held card keeps its status and coordinates, nothing is removed
   * (reconcile judges membership), the parked flag stays reconcile's job.
   * Rounds below the run's newest are history, and a closed id never
   * returns: a REST response that raced the stream's closing evidence would
   * otherwise put live Approve/Deny on an ask that already executed.
   * Independent of currentRunId: there may have been no stream at all.
   */
  hydratePendingApprovals(turn: ApprovalTurnRecord | null): boolean {
    if (
      turn === null ||
      (turn.status !== "awaiting_input" && turn.status !== "parked") ||
      turn.run_id === null ||
      // A server predating the field sends no array at all — an old
      // wire, never an empty pause.
      !Array.isArray(turn.pending_approvals)
    ) {
      return false;
    }
    const runId = turn.run_id;
    let changed = false;
    for (const value of turn.pending_approvals) {
      const payload = approvalRequestedPayloadOf(value);
      if (payload === null) {
        continue;
      }
      if (this.closedInterruptIds.has(payload.interrupt_id)) {
        continue;
      }
      if (
        this.cardList.some((card) => card.interruptId === payload.interrupt_id)
      ) {
        continue;
      }
      const newestRound = this._newestRoundOf(runId);
      if (newestRound !== null && payload.round < newestRound) {
        continue;
      }
      this.cardList.push(this._cardFrom(payload, runId, null));
      changed = true;
    }
    return changed;
  }

  /**
   * The coworker approvals the turn snapshot lists, adopted: a
   * card not held opens actionable, addressed to its dispatching turn; a
   * held card re-reads its coworker's parked flag; a coworker card no turn
   * lists anymore is gone (its row left paused). Bypasses the marker path's
   * round arbitration — a coworker's round is its own — and remembers
   * nothing it removes: "not in this window" is not monotonic evidence, so
   * a later read may re-adopt (a re-POST after a real delist is the door's
   * already_consumed receipt).
   */
  adoptCoworkerApprovals(turns: readonly CoworkerApprovalTurn[]): boolean {
    let changed = false;
    const listed = new Set<string>();
    for (const turn of turns) {
      if (turn.id === undefined) {
        continue;
      }
      for (const raw of turn.pending_coworker_approvals ?? []) {
        const request = coworkerApprovalRequestOf(raw);
        if (request === null) {
          continue;
        }
        const interruptId = request.card.interrupt_id;
        listed.add(interruptId);
        const held = this.cardList.find(
          (card) => card.interruptId === interruptId,
        );
        if (held === undefined) {
          this.cardList.push(
            this._cardFrom(request.card, turn.run_id ?? turn.id, {
              asker: {
                kind: "coworker",
                ordinal: request.ordinal,
                label: request.label,
              },
              turnId: turn.id,
              parked: request.parked,
            }),
          );
          changed = true;
        } else if (
          held.asker.kind === "coworker" &&
          held.parked !== request.parked
        ) {
          held.parked = request.parked;
          changed = true;
        }
      }
    }
    if (turns.length > 0) {
      const delisted = this._delistWhere(
        (card) =>
          card.asker.kind === "coworker" && !listed.has(card.interruptId),
      );
      changed = delisted || changed;
    }
    return changed;
  }

  /**
   * Re-judge the cards against the turn record — the lifetime authority,
   * called on every REST read of the thread. Terminal turns
   * close everything (except an in-flight submit, which settles itself);
   * live turns stamp the parked flag from status; and where the contract
   * makes pending_interrupt_ids meaningful (awaiting_input or parked,
   * with a run captured), an actionable card the turn no longer holds
   * goes visibly stale — never a silent vanish. Under queued/working the
   * set is contractually empty, so membership is deliberately NOT judged
   * there: a stale read racing a live marker must not kill a fresh card
   * (stale has no return transition); the stream's own evidence closes
   * those. Same tolerance for a card whose round is newer than the
   * record's awaiting_round: the read predates the card.
   */
  reconcileWithTurn(turn: ApprovalTurnRecord | null): boolean {
    if (turn === null) {
      return false;
    }
    // A coworker's card is exempt from every judgement below: its lifetime
    // is the snapshot's (adoptCoworkerApprovals), and its dispatching turn
    // is normally settled while it still awaits the member.
    if (isTerminalTurnStatus(turn.status)) {
      return this._removeWhere(
        (card) =>
          card.asker.kind === "assistant" && card.status.kind !== "submitting",
      );
    }
    const parked = turn.status === "parked";
    // Null where the record makes membership meaningless (or where an
    // older door sends no set at all — absent is never empty).
    const pendingIds = _membershipIsJudgeable(turn)
      ? turn.pending_interrupt_ids
      : null;
    // An absent awaiting_round (older door) reads like the null the
    // serving door sends between pauses: no round to shield behind.
    const awaitingRound = turn.awaiting_round ?? null;
    let changed = false;
    for (const card of this.cardList) {
      if (
        card.asker.kind === "coworker" ||
        (card.status.kind !== "actionable" && card.status.kind !== "submitting")
      ) {
        continue;
      }
      if (card.parked !== parked) {
        card.parked = parked;
        changed = true;
      }
      if (
        pendingIds !== null &&
        card.status.kind === "actionable" &&
        !(awaitingRound !== null && card.round > awaitingRound) &&
        !pendingIds.includes(card.interruptId)
      ) {
        card.status = { kind: "stale" };
        changed = true;
      }
    }
    return changed;
  }

  /**
   * The settled turns' word: the assistant's cards whose run
   * belongs to a turn with a terminal status are gone, whatever row is
   * newest — the close a synthesized terminal cannot fake. The removal
   * reads the ACCUMULATED runs, so a stale read still showing the pause
   * rebuilds nothing. THE PREMISE: a turn's run_id is captured once and a
   * terminal status is final, so a settled run never carries a live card
   * again. Submitting cards settle themselves; coworker cards are exempt.
   */
  reconcileWithTurns(
    turns: readonly Pick<ApprovalTurnRecord, "run_id" | "status">[],
  ): boolean {
    for (const turn of turns) {
      if (isTerminalTurnStatus(turn.status) && turn.run_id !== null) {
        this.settledRunIds.add(turn.run_id);
      }
    }
    return this._removeWhere(
      (card) =>
        card.asker.kind === "assistant" &&
        card.status.kind !== "submitting" &&
        this.settledRunIds.has(card.runId),
    );
  }

  // --- reading -------------------------------------------------------------

  cards(): readonly ApprovalCardModel[] {
    return this.cardList.map((card) => ({ ...card }));
  }

  statusOf(interruptId: string): ApprovalCardStatus["kind"] | null {
    return (
      this.cardList.find((card) => card.interruptId === interruptId)?.status
        .kind ?? null
    );
  }

  // --- internals -------------------------------------------------------------

  // The one card constructor, shared by the stream marker and the REST
  // snapshot so the two paths cannot drift.
  private _cardFrom(
    payload: ApprovalRequestedPayload,
    runId: string,
    ask: CoworkerAsk | null,
  ): ApprovalCardModel {
    const toolCallId = payload.tool_call_id ?? null;
    return {
      interruptId: payload.interrupt_id,
      toolName: payload.tool_name ?? null,
      toolArgs: payload.tool_args,
      toolInputSchema: payload.tool_input_schema ?? null,
      toolOutputSchema: payload.tool_output_schema ?? null,
      prompt: payload.prompt,
      toolCallId,
      anchored: this._anchoredOf(toolCallId),
      round: payload.round,
      runId,
      parked: ask?.parked ?? false,
      gated: this.capabilities.gate === true && payload.gated,
      // Either asker's, off the wire: a coworker's grant lands
      // in its own session, so its card may offer what the record says.
      trustAvailable:
        this.capabilities.trust === true && payload.trust_available,
      status: ACTIONABLE,
      asker: ask?.asker ?? { kind: "assistant" },
      turnId: ask?.turnId ?? null,
    };
  }

  // Anchoring is a capability: without it the set stays empty, so this
  // reads false for every card — the flat-block host never anchors.
  private _anchoredOf(toolCallId: string | null): boolean {
    return toolCallId !== null && this.seenToolCallIds.has(toolCallId);
  }

  // Round arbitration is the ASSISTANT's alone: a coworker's card carries
  // the dispatching turn's run id with the CHILD's segment round.
  private _newestRoundOf(runId: string): number | null {
    const rounds = this.cardList
      .filter((card) => card.asker.kind === "assistant" && card.runId === runId)
      .map((card) => card.round);
    return rounds.length > 0 ? Math.max(...rounds) : null;
  }

  private _delistWhere(doomed: (card: ApprovalCardModel) => boolean): boolean {
    const kept = this.cardList.filter((card) => !doomed(card));
    if (kept.length === this.cardList.length) {
      return false;
    }
    this.cardList = kept;
    return true;
  }

  private _staleWhere(doomed: (card: ApprovalCardModel) => boolean): boolean {
    let changed = false;
    for (const card of this.cardList) {
      if (
        doomed(card) &&
        (card.status.kind === "actionable" || card.status.kind === "submitting")
      ) {
        card.status = { kind: "stale" };
        changed = true;
      }
    }
    return changed;
  }

  // Removal is closing evidence: the removed ids are remembered so a
  // stale REST snapshot can never hydrate them back.
  private _removeWhere(doomed: (card: ApprovalCardModel) => boolean): boolean {
    const kept: ApprovalCardModel[] = [];
    let changed = false;
    for (const card of this.cardList) {
      if (doomed(card)) {
        this.closedInterruptIds.add(card.interruptId);
        changed = true;
      } else {
        kept.push(card);
      }
    }
    if (!changed) {
      return false;
    }
    this.cardList = kept;
    return true;
  }

  private _transition(
    interruptId: string,
    fromKinds: ApprovalCardStatus["kind"][],
    to: ApprovalCardStatus,
  ): boolean {
    const card = this.cardList.find(
      (known) => known.interruptId === interruptId,
    );
    if (card === undefined || !fromKinds.includes(card.status.kind)) {
      return false;
    }
    card.status = to;
    return true;
  }
}

// The execution driver's tolerances, mirrored: membership is
// only meaningful where the contract fills the set — a paused turn with a
// captured run. A null run_id is a lost capture (the server hides the
// cards, the set reads empty), and a server predating the field sends no
// array at all — absent must never read as empty. A type predicate, so
// the caller reads the set only where this says it may.
function _membershipIsJudgeable(
  turn: ApprovalTurnRecord,
): turn is ApprovalTurnRecord & {
  run_id: string;
  pending_interrupt_ids: readonly string[];
} {
  return (
    (turn.status === "awaiting_input" || turn.status === "parked") &&
    turn.run_id !== null &&
    Array.isArray(turn.pending_interrupt_ids)
  );
}

// The submit path's own failure sentence — reached only when the caller
// cannot name any turn to answer at all, which a live pause makes
// near-impossible.
export const ANSWER_NOT_SENT_SENTENCE =
  "That answer couldn't be sent. Please try again.";

/** The turn holding the answerable pause, if any: the newest row when it
 *  pauses itself, else the newest answerable row behind it (a queued
 *  message can sit newer than the pause, and reading the queued row would
 *  silently miss the pause exactly when the member must answer to unblock
 *  the queue). Generic so each caller gets its own turn type back. */
export function answerablePauseOf<T extends { status: TurnStatus }>(
  turns: readonly T[],
): T | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.status === "awaiting_input" || turn.status === "parked") {
      return turn;
    }
  }
  return null;
}

/**
 * The durable turn record re-judges the pending approvals on every REST
 * read: hydration first — the record's pending_approvals snapshot rebuilds
 * any card the stream never delivered — then reconcile judges the whole
 * set, hydrated cards included. Two different rows on purpose: the pause
 * hydrates from the ANSWERABLE turn (a queued message can sit newer than
 * the pause), while reconcile keeps the NEWEST row (a terminal newest turn
 * is what removes the conversation's cards). The inbox's own guards absorb
 * what the read cannot know: closed ids never hydrate back, a round below
 * the run's newest is history, absent pause fields change nothing. The
 * settled-runs arm runs last over the whole window: a card
 * whose run belongs to any turn that settled is gone even while a newer
 * turn is live. Returns whether the visible cards changed.
 */
export function reconcileApprovalsWithTurns(
  inbox: ApprovalInbox,
  turns: readonly ApprovalTurnRecord[],
): boolean {
  const newest = turns[turns.length - 1] ?? null;
  const hydrated = inbox.hydratePendingApprovals(answerablePauseOf(turns));
  // The coworkers' cards ride the same read: every turn in the
  // window may be some paused coworker's dispatching turn.
  const adopted = inbox.adoptCoworkerApprovals(turns);
  const reconciled = inbox.reconcileWithTurn(newest);
  const settled = inbox.reconcileWithTurns(turns);
  return hydrated || adopted || reconciled || settled;
}

/**
 * The subscriber that feeds the stream into the inbox: markers open cards,
 * receipts answer them, and the resume's own evidence or the settled turn's
 * word closes them — a RUN_FINISHED alone closes nothing. Only the
 * server-named run id from RUN_STARTED is trusted — the connect-run's
 * input.runId is the client's own and never names a recorded run.
 *
 * It also watches for the parked contract's quiet close, with the same
 * last-event-was-a-terminal flags as resumeSnapshotRecorder: lifecycle
 * events route to their dedicated handlers, everything else through
 * onEvent, and an errored or aborted pipeline routes through onRunFailed
 * before finalize — so a finalize where nothing failed and the last
 * applied event was not a terminal is a stream that simply ended. The
 * flags reset per run: one agent can be connected more than once.
 */
export function approvalInboxRecorder(
  inbox: ApprovalInbox,
  onCardsChanged: (cards: readonly ApprovalCardModel[]) => void,
  onStreamClosedWithoutTerminal: () => void,
): AgentSubscriber {
  let endedAtTerminal = false;
  let failed = false;
  const publishWhen = (changed: boolean) => {
    if (changed) {
      onCardsChanged(inbox.cards());
    }
  };
  return {
    onRunInitialized() {
      endedAtTerminal = false;
      failed = false;
    },
    onEvent() {
      endedAtTerminal = false;
    },
    onRunStartedEvent({ event }) {
      endedAtTerminal = false;
      publishWhen(inbox.noteRunStarted(event.runId));
    },
    onToolCallStartEvent({ event }) {
      publishWhen(inbox.noteToolCallStart(event.toolCallId));
    },
    onCustomEvent({ event }) {
      if (event.name === APPROVAL_REQUESTED_EVENT_NAME) {
        const payload = approvalRequestedPayloadOf(event.value);
        if (payload !== null) {
          publishWhen(inbox.noteApprovalRequested(payload));
        }
        return;
      }
      if (event.name === APPROVAL_RESOLVED_EVENT_NAME) {
        const receipt = approvalResolvedPayloadOf(event.value);
        if (receipt !== null) {
          publishWhen(
            inbox.noteApprovalResolved(receipt.interruptId, receipt.approved),
          );
        }
      }
    },
    onToolCallResultEvent({ event }) {
      publishWhen(inbox.noteToolCallResult(event.toolCallId));
    },
    onRunFinishedEvent() {
      endedAtTerminal = true;
      publishWhen(inbox.noteRunFinished());
    },
    onRunErrorEvent() {
      endedAtTerminal = true;
      publishWhen(inbox.noteRunError());
    },
    onRunFailed() {
      failed = true;
    },
    onRunFinalized() {
      if (!endedAtTerminal && !failed) {
        publishWhen(inbox.noteStreamClosedWithoutTerminal());
        onStreamClosedWithoutTerminal();
      }
    },
  };
}
