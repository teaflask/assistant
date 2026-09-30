import type { AgentSubscriber } from "@ag-ui/client";

import {
  TOOL_EXECUTION_REQUESTED_EVENT_NAME,
  TOOL_RESULT_RECORDED_EVENT_NAME,
  type ToolExecutionRequestedPayload,
} from "../contract/events.js";
import type { TurnStatus } from "../contract/threads.js";
import { isTerminalTurnStatus } from "./activity.js";
import { MEMBER_ANSWERABLE_KINDS } from "./execution-kinds.js";
import {
  coworkerExecutionRequestOf,
  executionRequestedPayloadOf,
  recordOrNull,
  type CoworkerRequestTurn,
} from "./execution-request-narrowing.js";

export {
  coworkerExecutionRequestOf,
  executionRequestedPayloadOf,
  type CoworkerRequestTurn,
} from "./execution-request-narrowing.js";

// A paused turn's pending client executions, distilled from the stream —
// the execution twin of the approval inbox, and its posture: the stream
// is the fast path for an entry's lifetime and the durable turn record
// its authority. A tool_execution_requested marker opens work, and the
// evidence that follows — the tool_result_recorded receipt, the gated
// call's TOOL_CALL_RESULT, RUN_ERROR, a later pause round, the settled
// turn's word — reports or closes it. Full replay (the frozen resume
// semantic) then needs no special casing: a reload mid-pause replays the
// marker with nothing after it and the entry comes back pending; a
// reload after the delivery replays the marker AND its receipt in the
// same burst, so the entry lands reported before the driver's deferred
// pass could ever act on it.
//
// Where the approval inbox waits for a human, this one is drained by an
// automatic driver — so the claim (beginExecution) is the at-most-once
// gate, and a failed POST returns the entry to pending because the
// designed recovery is a re-POST of the stored outcome, never a second
// execution.
//
// Entries of ANY kind are held (they close on the same evidence as the
// rest); only the driver's handler registry decides what executes, and a
// kind this client cannot serve is answered with a canned unsupported
// error rather than parked — inside a single mount there is no other
// handler to defer to.
//
// The inbox is deliberately React-free so the lifecycle is unit-testable;
// every mutator answers "did visible state change" so the recorder only
// publishes snapshots that matter.

export type ExecutionEntryStatus =
  | { kind: "pending" }
  | { kind: "executing" }
  | { kind: "reported"; ok: boolean }
  | { kind: "stale" };

/** Who asked: the assistant's own request rides the stream's
 *  marker; a coworker's rides its DISPATCHING turn's REST snapshot
 *  (pending_coworker_executions) and is answered at that turn's door. */
type ExecutionAsker =
  { kind: "assistant" } | { kind: "coworker"; ordinal: number };

export interface ExecutionEntryModel {
  /** The contract's opaque interrupt id — the entry key and the report id. */
  interruptId: string;
  toolName: string;
  toolCallId: string | null;
  /** True when the request's own tool row already streamed. An anchored
   *  ask is ordered in the suspension queue by its row and settled on it
   *  by the row projection (the approval cards' anchored/orphan split;
   *  only member-answerable kinds render cards, but the fact is stream
   *  evidence and lives here with the rest). */
  anchored: boolean;
  /** The request's open, additive kind vocabulary (e.g. builtin.navigate). */
  kind: string;
  /** The request's action payload, verbatim from the wire. */
  action: Record<string, unknown> | null;
  /** The request's server-built intent payload, verbatim from the wire. */
  intent: Record<string, unknown> | null;
  round: number;
  /** The server run that paused, stamped from the enclosing RUN_STARTED —
   *  for a coworker's request, the dispatching turn's run. */
  runId: string;
  status: ExecutionEntryStatus;
  asker: ExecutionAsker;
  /** The dispatching turn a coworker's result is posted to; null for the
   *  assistant's own requests, which the driver resolves by run. */
  turnId: string | null;
}

const PENDING: ExecutionEntryStatus = { kind: "pending" };

/** The turn fields the settled-run reconcile reads. The status is the
 *  generated union, never bare string: a renamed status word in the spec
 *  must fail the compile here, not silently stop closing that run's
 *  entries (contract/dispatches.ts states the rule for the ledger). */
export interface SettledRunView {
  run_id: string | null;
  status: TurnStatus;
}

interface CoworkerAsk {
  asker: ExecutionAsker;
  turnId: string;
  runId: string;
}

/** Narrow a tool_result_recorded CUSTOM event's wire value. */
export function toolResultRecordedPayloadOf(
  value: unknown,
): { interruptId: string; ok: boolean } | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.interrupt_id !== "string" || record.interrupt_id === "") {
    return null;
  }
  return {
    interruptId: record.interrupt_id,
    ok: typeof record.ok === "boolean" ? record.ok : true,
  };
}

export class ExecutionInbox {
  private currentRunId: string | null = null;
  private readonly seenRunIds = new Set<string>();
  private readonly seenToolCallIds = new Set<string>();
  // The coworker requests REST has named, by interrupt id — what a
  // stream marker for one of them is re-labelled from.
  private readonly coworkerAsks = new Map<string, CoworkerAsk>();
  private entryList: ExecutionEntryModel[] = [];

  // --- the stream side -------------------------------------------------

  noteRunStarted(runId: string): boolean {
    this.currentRunId = runId;
    if (this.seenRunIds.has(runId)) {
      // A run id already seen is a RE-ENTERED historical segment: the
      // thread stream re-opens an old run's segment whenever a row lands
      // late under it (a coworker's answer is recorded under its
      // dispatching turn's run) — nothing began, nothing closes.
      return false;
    }
    this.seenRunIds.add(runId);
    // A run beginning for the first time is closing evidence for the
    // assistant's straggler entries — only the newest run can still be
    // awaiting input. A coworker's pause outlives the parent's runs.
    return this._removeWhere(
      (entry) => entry.asker.kind === "assistant" && entry.runId !== runId,
    );
  }

  noteToolCallStart(toolCallId: string): boolean {
    // TOOL_CALL_START precedes its pause marker in stream order, so the
    // set is complete by the time anchoring is judged — nothing to
    // publish here (the approval inbox's own semantics).
    this.seenToolCallIds.add(toolCallId);
    return false;
  }

  noteExecutionRequested(payload: ToolExecutionRequestedPayload): boolean {
    if (this.currentRunId === null) {
      // A marker outside any run segment is unanchorable — ignore it.
      return false;
    }
    const runId = this.currentRunId;
    if (this._hasEntry(payload.interrupt_id)) {
      // A replayed marker for an entry we already hold: keep the entry's
      // status — replay must never reopen an already-reported request.
      return false;
    }
    const coworkerAsk = this.coworkerAsks.get(payload.interrupt_id);
    if (coworkerAsk !== undefined) {
      if (MEMBER_ANSWERABLE_KINDS.has(payload.request.kind)) {
        // The stream door of the adoption's skip below: not held here
        // either, or it would be an assistant entry minting a question card.
        return false;
      }
      // A marker for a request REST already named as a coworker's: its
      // round is the coworker's own and never meets the parent's
      // arbitration below.
      this.entryList.push(
        _entryOf(payload, this.seenToolCallIds, coworkerAsk.runId, coworkerAsk),
      );
      return true;
    }
    // THE PREMISE: round arbitration is the ASSISTANT's alone. A coworker's
    // entry carries the dispatching turn's run id and the CHILD's segment
    // round — two namespaces that share a bucket only by accident — and its
    // lifetime is REST's, so it neither competes with nor supersedes the
    // parent's rounds (the dashboard's inbox-asker census pins it).
    const newestRound = this._newestRoundOf(runId);
    if (newestRound !== null && payload.round < newestRound) {
      // A lower round replaying after a later pause is history, not an ask.
      return false;
    }
    // A higher round supersedes the run's earlier entries (round
    // namespacing: multi-pause turns re-emit cards and must not collide).
    if (newestRound !== null && payload.round > newestRound) {
      this._removeWhere(
        (entry) =>
          entry.asker.kind === "assistant" &&
          entry.runId === runId &&
          entry.round < payload.round,
      );
    }
    this.entryList.push(_entryOf(payload, this.seenToolCallIds, runId, null));
    return true;
  }

  // --- the REST side -------------------------------------------

  /**
   * The coworker requests the turn snapshot lists, adopted: a card not
   * held opens a pending entry addressed to its dispatching turn; a held
   * pending entry the stream delivered first is re-labelled; a coworker
   * entry no turn lists anymore is gone (its row left paused). Bypasses
   * the marker path's round arbitration — a coworker's round is its own.
   */
  adoptCoworkerRequests(turns: readonly CoworkerRequestTurn[]): boolean {
    let changed = false;
    const listed = new Set<string>();
    for (const turn of turns) {
      for (const raw of turn.pending_coworker_executions ?? []) {
        const request = coworkerExecutionRequestOf(raw);
        if (request === null) {
          continue;
        }
        const interruptId = request.card.interrupt_id;
        // The label and drill-in handle the snapshot carries are the ledger
        // join's to render; the entry keeps only what its readers use.
        const ask: CoworkerAsk = {
          asker: { kind: "coworker", ordinal: request.ordinal },
          turnId: turn.id,
          runId: turn.run_id ?? turn.id,
        };
        this.coworkerAsks.set(interruptId, ask);
        if (MEMBER_ANSWERABLE_KINDS.has(request.card.request.kind)) {
          // A coworker's request has exactly one door, the driver's POST
          // under its dispatching turn. A member-answerable kind would leave
          // through the question-set submit instead, addressed by the
          // assistant's run and staling that whole run on a 409 — so it is
          // held on neither door: not adopted here, and the ask is remembered
          // so a stream marker for the id is dropped by noteExecutionRequested
          // instead of landing as the assistant's (the playground twin's
          // posture). Unreachable today: a coworker runs HEADLESS and ask_user
          // mounts on LIVE only — the approval inbox's asker-carrying card
          // does not change that.
          // A marker that beat the snapshot here landed as the assistant's;
          // it leaves now.
          const dropped = this._removeWhere(
            (entry) => entry.interruptId === interruptId,
          );
          changed = dropped || changed;
          continue;
        }
        listed.add(interruptId);
        const held = this.entryList.find(
          (entry) => entry.interruptId === interruptId,
        );
        if (held === undefined) {
          this.entryList.push(
            _entryOf(request.card, this.seenToolCallIds, ask.runId, ask),
          );
          changed = true;
        } else if (held.asker.kind === "assistant") {
          held.asker = ask.asker;
          held.turnId = ask.turnId;
          changed = true;
        }
      }
    }
    if (turns.length > 0) {
      const removed = this._removeWhere(
        (entry) =>
          entry.asker.kind === "coworker" && !listed.has(entry.interruptId),
      );
      changed = removed || changed;
    }
    return changed;
  }

  /** A 409 for a coworker's request speaks for that request alone. */
  markCoworkerRequestStale(interruptId: string): boolean {
    return this._staleWhere(
      (entry) =>
        entry.asker.kind === "coworker" && entry.interruptId === interruptId,
    );
  }

  /** The member's send voids every paused coworker of the thread. */
  markCoworkerRequestsStale(): boolean {
    return this._staleWhere((entry) => entry.asker.kind === "coworker");
  }

  noteToolResultRecorded(interruptId: string, ok: boolean): boolean {
    // The receipt is the stream saying "a delivery happened" — on a replay
    // it lands right after the marker it answers, so the entry flips to
    // reported in the same burst and the driver can never claim an
    // already-answered request. The gated call's result (or RUN_ERROR, or
    // the settled turn's word) still closes the entry, as on the live path.
    return this._transition(interruptId, ["pending", "executing"], {
      kind: "reported",
      ok,
    });
  }

  noteToolCallResult(toolCallId: string): boolean {
    // The gated call producing a result is the resume made visible.
    return this._removeWhere((entry) => entry.toolCallId === toolCallId);
  }

  noteRunFinished(): boolean {
    // A RUN_FINISHED closes nothing by itself. THE PREMISE: the thread
    // streamer synthesizes a RUN_FINISHED for the LIVE run right before it
    // re-enters an old run's segment for a late row (a coworker's answer or
    // receipt lands under its dispatching turn's run), and the two frames
    // are indistinguishable on the wire from a real terminal — so removing
    // the run's entries here would lose a live pause's ask that nothing
    // re-delivers. The run's entries die on their own evidence (the receipt,
    // the gated call's result), on a first-seen run beginning (the
    // straggler wipe above), on RUN_ERROR, or on the durable turn record's
    // word (reconcileWithTurns) — the approval inbox's posture too
    // (the dashboard's run-lifecycle census pins it).
    return false;
  }

  /** The durable turn record's word: the assistant's entries
   *  whose run belongs to a SETTLED turn are gone — the REST-driven close a
   *  synthesized terminal cannot fake. */
  reconcileWithTurns(turns: readonly SettledRunView[]): boolean {
    const settledRuns = new Set(
      turns
        .filter((turn) => isTerminalTurnStatus(turn.status))
        .map((turn) => turn.run_id)
        .filter((runId): runId is string => runId !== null),
    );
    return this._removeWhere(
      (entry) =>
        entry.asker.kind === "assistant" && settledRuns.has(entry.runId),
    );
  }

  noteRunError(): boolean {
    // RUN_ERROR carries no runId, and a serving RUN_ERROR ends the stream —
    // nothing of the assistant's can be answered anymore.
    return this._removeWhere((entry) => entry.asker.kind === "assistant");
  }

  // --- the driver side ---------------------------------------------------

  beginExecution(interruptId: string): boolean {
    // The at-most-once claim: synchronous, so two overlapping passes (or
    // StrictMode's double connection) can never both win the same entry.
    return this._transition(interruptId, ["pending"], { kind: "executing" });
  }

  settleReported(interruptId: string, ok: boolean): boolean {
    return this._transition(interruptId, ["executing"], {
      kind: "reported",
      ok,
    });
  }

  settlePostFailed(interruptId: string): boolean {
    // The POST failed, not the execution — the entry returns to pending so
    // a later pass re-POSTs the stored outcome. Re-execution is the
    // ledger's to prevent, never this transition's to allow.
    return this._transition(interruptId, ["executing"], PENDING);
  }

  markRunStale(runId: string): boolean {
    // A 409 speaks for the whole pause: none of the run's open asks can
    // land anymore. Reported entries keep their honest note.
    return this._staleWhere(
      (entry) => entry.asker.kind === "assistant" && entry.runId === runId,
    );
  }

  // --- reading -------------------------------------------------------------

  entries(): readonly ExecutionEntryModel[] {
    return this.entryList.map((entry) => ({ ...entry }));
  }

  // --- internals -------------------------------------------------------------

  private _hasEntry(interruptId: string): boolean {
    return this.entryList.some((entry) => entry.interruptId === interruptId);
  }

  private _newestRoundOf(runId: string): number | null {
    const rounds = this.entryList
      .filter(
        (entry) => entry.asker.kind === "assistant" && entry.runId === runId,
      )
      .map((entry) => entry.round);
    return rounds.length > 0 ? Math.max(...rounds) : null;
  }

  private _staleWhere(
    doomed: (entry: ExecutionEntryModel) => boolean,
  ): boolean {
    let changed = false;
    for (const entry of this.entryList) {
      if (
        doomed(entry) &&
        (entry.status.kind === "pending" || entry.status.kind === "executing")
      ) {
        entry.status = { kind: "stale" };
        changed = true;
      }
    }
    return changed;
  }

  private _removeWhere(
    doomed: (entry: ExecutionEntryModel) => boolean,
  ): boolean {
    const kept = this.entryList.filter((entry) => !doomed(entry));
    if (kept.length === this.entryList.length) {
      return false;
    }
    this.entryList = kept;
    return true;
  }

  private _transition(
    interruptId: string,
    fromKinds: ExecutionEntryStatus["kind"][],
    to: ExecutionEntryStatus,
  ): boolean {
    const entry = this.entryList.find(
      (known) => known.interruptId === interruptId,
    );
    if (entry === undefined || !fromKinds.includes(entry.status.kind)) {
      return false;
    }
    entry.status = to;
    return true;
  }
}

function _entryOf(
  payload: ToolExecutionRequestedPayload,
  seenToolCallIds: ReadonlySet<string>,
  runId: string,
  ask: CoworkerAsk | null,
): ExecutionEntryModel {
  return {
    interruptId: payload.interrupt_id,
    toolName: payload.tool_name,
    toolCallId: payload.tool_call_id ?? null,
    // A coworker's card names the CHILD run's tool call, which never
    // streams in the parent's transcript — it anchors nothing here.
    anchored:
      payload.tool_call_id != null && seenToolCallIds.has(payload.tool_call_id),
    kind: payload.request.kind,
    action: recordOrNull(payload.request.action),
    intent: recordOrNull(payload.request.intent),
    round: payload.round,
    runId,
    status: PENDING,
    asker: ask?.asker ?? { kind: "assistant" },
    turnId: ask?.turnId ?? null,
  };
}

/**
 * The subscriber that feeds the stream into the inbox: markers open
 * entries, receipts report them, and the resume's own evidence closes
 * them. Only the server-named run id from RUN_STARTED is trusted — the
 * connect-run's input.runId is the client's own and never names a
 * recorded run.
 *
 * A quiet close needs nothing from this recorder: an open entry survives
 * it untouched, because nothing about being answerable depends on whether
 * the turn parked. The REST consult that tells a park from a dropped
 * connection, and the go/no-go it drives, stay the approval recorder's.
 */
export function executionInboxRecorder(
  inbox: ExecutionInbox,
  onEntriesChanged: (entries: readonly ExecutionEntryModel[]) => void,
): AgentSubscriber {
  const publishWhen = (changed: boolean) => {
    if (changed) {
      onEntriesChanged(inbox.entries());
    }
  };
  return {
    onRunStartedEvent({ event }) {
      publishWhen(inbox.noteRunStarted(event.runId));
    },
    onCustomEvent({ event }) {
      if (event.name === TOOL_EXECUTION_REQUESTED_EVENT_NAME) {
        const payload = executionRequestedPayloadOf(event.value);
        if (payload !== null) {
          publishWhen(inbox.noteExecutionRequested(payload));
        }
        return;
      }
      if (event.name === TOOL_RESULT_RECORDED_EVENT_NAME) {
        const receipt = toolResultRecordedPayloadOf(event.value);
        if (receipt !== null) {
          publishWhen(
            inbox.noteToolResultRecorded(receipt.interruptId, receipt.ok),
          );
        }
      }
    },
    onToolCallStartEvent({ event }) {
      publishWhen(inbox.noteToolCallStart(event.toolCallId));
    },
    onToolCallResultEvent({ event }) {
      publishWhen(inbox.noteToolCallResult(event.toolCallId));
    },
    onRunFinishedEvent() {
      publishWhen(inbox.noteRunFinished());
    },
    onRunErrorEvent() {
      publishWhen(inbox.noteRunError());
    },
  };
}
