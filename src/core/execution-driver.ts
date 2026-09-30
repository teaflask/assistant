import type {
  AssistantThreadDetailResponse,
  ResolveTurnToolResultsRequest,
  ResolveTurnToolResultsResponse,
  ServingAssistantTurn,
} from "../contract/threads.js";
import {
  readExecutedOutcome,
  recordExecutedOutcome,
  recordExecutionClaimed,
} from "../persistence/execution-ledger.js";
import { ServingApiError } from "../transport/serving-error.js";
import {
  KIND_UNSUPPORTED_OUTCOME,
  MEMBER_ANSWERABLE_KINDS,
  type ExecutionHandler,
  type ExecutionOutcome,
} from "./execution-handlers.js";
import {
  coworkerExecutionRequestOf,
  type ExecutionEntryModel,
  type ExecutionInbox,
} from "./execution-inbox.js";
import { MAX_DELIVERY_ATTEMPTS } from "./execution-kinds.js";

// The driver that drains the execution inbox — the automatic half the
// approval flow leaves to a human. Never inside an event callback: a
// deferred pass lets a replay burst's own evidence (the receipt, the
// gated call's result) close stale entries before anything acts, then a
// REST read confirms the pause is genuinely open, the inbox claim takes
// the entry, and the ledger makes the execution at-most-once even across
// the remount a navigation causes.
const EXECUTION_PASS_DELAY_MS = 400;
// A failed POST retries on a slower cadence — the outcome is already in
// the ledger, so only the delivery is being retried.
const EXECUTION_RETRY_DELAY_MS = 2000;

export interface ExecutionPassContext {
  inbox: ExecutionInbox;
  threadId: string;
  handlers: ReadonlyMap<string, ExecutionHandler>;
  /** Delivery attempts per interrupt id — exhausted entries stay pending
   *  for the NEXT connection's pass (re-POST is the designed recovery). */
  attempts: Map<string, number>;
  fetchThreadDetail: () => Promise<AssistantThreadDetailResponse>;
  postResults: (
    turnId: string,
    request: ResolveTurnToolResultsRequest,
  ) => Promise<ResolveTurnToolResultsResponse>;
  publishEntries: (entries: readonly ExecutionEntryModel[]) => void;
  onWorkflowRestarted: () => void;
}

/**
 * One drain of the inbox's pending entries. Exported so the pass logic
 * unit-tests in node — the ExecutionDriver below is only a scheduler
 * around it.
 */
export async function runExecutionPass(
  context: ExecutionPassContext,
): Promise<void> {
  const eligible = eligibleEntriesOf(context.inbox.entries(), context.attempts);
  if (eligible.length === 0) {
    return;
  }
  const turns = await _theTurnsOrNull(context);
  if (turns === null || turns.length === 0) {
    return;
  }
  for (const entry of eligible) {
    await _serveEntry(context, entry, turns);
  }
}

function eligibleEntriesOf(
  entries: readonly ExecutionEntryModel[],
  attempts: ReadonlyMap<string, number>,
): ExecutionEntryModel[] {
  return entries.filter(
    (entry) =>
      entry.status.kind === "pending" &&
      // A member-answerable kind (builtin.ask_questions) is never the
      // driver's to serve: auto-answering it — even as unsupported —
      // would withdraw the ask. Its entry stays pending for the member's
      // own submit and closes on stream evidence like every entry.
      !MEMBER_ANSWERABLE_KINDS.has(entry.kind) &&
      (attempts.get(entry.interruptId) ?? 0) < MAX_DELIVERY_ATTEMPTS,
  );
}

async function _serveEntry(
  context: ExecutionPassContext,
  entry: ExecutionEntryModel,
  turns: readonly ServingAssistantTurn[],
): Promise<void> {
  const stored = readExecutedOutcome(context.threadId, entry.interruptId);
  // The pause's holder is resolved across the WHOLE window, newest match
  // first (there is no busy 409, so the answerable turn can sit
  // behind QUEUED rows — "newest turn" is not "the pause").
  const holder = _theTurnStillHoldingThisPause(turns, entry);
  if (stored === null && holder === null) {
    // REST is the acting authority, never the lifetime authority: the
    // entry stays untouched and the stream's own evidence closes it.
    return;
  }
  if (!context.inbox.beginExecution(entry.interruptId)) {
    return;
  }
  context.publishEntries(context.inbox.entries());
  const outcome = stored ?? (await _freshOutcomeOf(context, entry));
  // A stored outcome with no live holder re-POSTs to the ORIGIN turn —
  // the run the card came from — where the door's evidence arms
  // (recorded_after_void / already_recorded) expect it; a queued newer
  // member turn must never be guessed at (it would 409 and markRunStale
  // would drop the executed result). The newest turn remains only the
  // lost-capture fallback, backstopped by the door's own 409.
  // THE PREMISE: a coworker's request has exactly ONE legal
  // door — its dispatching turn. The door's coworker arms key on the
  // coworker's ordinal across the whole thread and on the posted turn's
  // own status, so a wrong turn is not backstopped by a 409 the way the
  // assistant's newest-turn guess is: it can DELIVER under a pause that
  // never asked, or record evidence under an unrelated run, and it would
  // dodge the door's off-page refusal by naming an on-page turn. So a
  // coworker's stored outcome re-POSTs to its dispatching turn or waits
  // this pass — the entry stays pending; the row leaving paused delists it.
  const target =
    holder ??
    (entry.asker.kind === "coworker"
      ? turns.find((turn) => turn.id === entry.turnId)
      : (_theTurnOfThisEntriesRun(turns, entry) ?? turns.at(-1)));
  if (target === undefined) {
    // Reachable only for a coworker's stored outcome whose dispatching turn
    // is off the fetched window. Every arm that returns an entry to pending
    // without a delivery counts an attempt (tests/driver-retry-arms): the
    // driver's next pass then rides the retry cadence and the cap parks the
    // entry for the next connection — a bounded wait, never a spin.
    _countDeliveryAttempt(context.attempts, entry.interruptId);
    if (context.inbox.settlePostFailed(entry.interruptId)) {
      context.publishEntries(context.inbox.entries());
    }
    return;
  }
  await _reportOutcome(context, entry, target.id, outcome);
}

function _theTurnStillHoldingThisPause(
  turns: readonly ServingAssistantTurn[],
  entry: ExecutionEntryModel,
): ServingAssistantTurn | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (_turnStillHoldsThisPause(turn, entry)) {
      return turn;
    }
  }
  return null;
}

function _theTurnOfThisEntriesRun(
  turns: readonly ServingAssistantTurn[],
  entry: ExecutionEntryModel,
): ServingAssistantTurn | undefined {
  return turns.find((turn) => turn.run_id === entry.runId);
}

async function _freshOutcomeOf(
  context: ExecutionPassContext,
  entry: ExecutionEntryModel,
): Promise<ExecutionOutcome> {
  // Claimed in the ledger before the handler runs: a tab dying mid-handler
  // must read back as unknown-outcome, never as unexecuted.
  recordExecutionClaimed(context.threadId, entry.interruptId);
  const handler = context.handlers.get(entry.kind);
  const outcome =
    handler === undefined
      ? KIND_UNSUPPORTED_OUTCOME
      : await _outcomeNeverThrown(handler, entry);
  recordExecutedOutcome(context.threadId, entry.interruptId, outcome);
  return outcome;
}

async function _reportOutcome(
  context: ExecutionPassContext,
  entry: ExecutionEntryModel,
  turnId: string,
  outcome: ExecutionOutcome,
): Promise<void> {
  try {
    const resolution = await context.postResults(turnId, {
      results: [
        {
          interrupt_id: entry.interruptId,
          ok: outcome.ok,
          ...(outcome.ok
            ? { result: outcome.result }
            : { error: { ...outcome.error } }),
          // Names the coworker for a report that lands after its row
          // settled — the door's evidence arm reads it.
          ...(entry.asker.kind === "coworker"
            ? { coworker_ordinal: entry.asker.ordinal }
            : {}),
        },
      ],
    });
    context.inbox.settleReported(entry.interruptId, outcome.ok);
    // Delivery is asynchronous (the response's turn still says
    // awaiting_input); on a live pause the stream's own resume closes the
    // entry. A result that restarted a parked turn's workflow has no live
    // stream to do that — reconnecting is what picks up the restarted run.
    // The delivery field alone decides (the submit paths' law): a notice
    // can accompany a DELIVERED restart too — the door pairs the
    // oversize-drop notice with workflow_restarted — and skipping the
    // reconnect there would freeze the transcript on the dead run.
    if (resolution.delivery === "workflow_restarted") {
      context.onWorkflowRestarted();
    }
  } catch (error) {
    if (_turnNoLongerAwaitingToolResults(error)) {
      // Voided, settled, or answered elsewhere: the whole pause is over —
      // or, for a coworker's request, that one request is.
      if (entry.asker.kind === "coworker") {
        context.inbox.markCoworkerRequestStale(entry.interruptId);
      } else {
        context.inbox.markRunStale(entry.runId);
      }
    } else {
      // The POST failed, not the execution — pending again, and the next
      // pass re-POSTs the stored outcome on the retry cadence.
      _countDeliveryAttempt(context.attempts, entry.interruptId);
      context.inbox.settlePostFailed(entry.interruptId);
    }
  } finally {
    context.publishEntries(context.inbox.entries());
  }
}

async function _outcomeNeverThrown(
  handler: ExecutionHandler,
  entry: ExecutionEntryModel,
): Promise<ExecutionOutcome> {
  try {
    return await handler(entry);
  } catch (error) {
    // Handlers shape their own failures; this catches only a handler bug,
    // and the turn must still resume.
    return {
      ok: false,
      error: {
        code: "execution_failed",
        message:
          "The page hit an unexpected error while performing this action. " +
          "Tell the user what was being attempted so they can do it " +
          `themselves. (${error instanceof Error ? error.message : String(error)})`,
      },
    };
  }
}

async function _theTurnsOrNull(
  context: ExecutionPassContext,
): Promise<readonly ServingAssistantTurn[] | null> {
  try {
    // The whole newest window, not just the newest row: a
    // message during a live turn QUEUES, so the turn holding the pause
    // is not necessarily the newest one.
    return (await context.fetchThreadDetail()).turns;
  } catch {
    // A transient read failure: the entries stay pending and the next
    // publish (or the next connection) schedules another pass.
    return null;
  }
}

function _turnStillHoldsThisPause(
  turn: ServingAssistantTurn,
  entry: ExecutionEntryModel,
): boolean {
  if (entry.asker.kind === "coworker") {
    // A coworker's request is held by its DISPATCHING turn, whatever that
    // turn's status (normally settled), for as long as the snapshot lists
    // it — the coworker's row leaving paused is what delists it.
    return (
      turn.id === entry.turnId &&
      (turn.pending_coworker_executions ?? []).some(
        (raw) =>
          coworkerExecutionRequestOf(raw)?.card.interrupt_id ===
          entry.interruptId,
      )
    );
  }
  const stillAnswerable =
    turn.status === "awaiting_input" || turn.status === "parked";
  if (!stillAnswerable) {
    return false;
  }
  // A null run_id is a lost capture — the server cannot locate the
  // pause's cards either (pending_interrupt_ids reads empty), so the
  // status gate alone holds and the door's own 409 backstops a stale
  // guess.
  if (turn.run_id === null) {
    return true;
  }
  return (
    turn.run_id === entry.runId && _turnStillAwaitsThisInterrupt(turn, entry)
  );
}

function _turnStillAwaitsThisInterrupt(
  turn: ServingAssistantTurn,
  entry: ExecutionEntryModel,
): boolean {
  // A replayed card from a superseded round must not act even though
  // status and run still match. A server predating the field sends no
  // array at all — that degrades to the status+run gate; an actual empty
  // list means the pause moved on, so absent must never read as empty.
  return (
    !Array.isArray(turn.pending_interrupt_ids) ||
    turn.pending_interrupt_ids.includes(entry.interruptId)
  );
}

function _turnNoLongerAwaitingToolResults(error: unknown): boolean {
  return (
    error instanceof ServingApiError &&
    error.code === "ASSISTANT_TURN_NOT_AWAITING_TOOL_RESULTS"
  );
}

function _countDeliveryAttempt(
  attempts: Map<string, number>,
  interruptId: string,
): void {
  attempts.set(interruptId, (attempts.get(interruptId) ?? 0) + 1);
}

export interface ExecutionDriverDeps {
  inbox: ExecutionInbox;
  threadId: string;
  /** Read fresh at each pass: the host's handlers map changes identity
   *  with the provider's re-renders (navigate ref), and the driver must
   *  never act on a stale one. */
  handlersOf: () => ReadonlyMap<string, ExecutionHandler>;
  fetchThreadDetail: () => Promise<AssistantThreadDetailResponse>;
  postResults: (
    turnId: string,
    request: ResolveTurnToolResultsRequest,
  ) => Promise<ResolveTurnToolResultsResponse>;
  publishEntries: (entries: readonly ExecutionEntryModel[]) => void;
  onWorkflowRestarted: () => void;
}

/**
 * Schedules a drain whenever the inbox holds actionable entries. One pass
 * runs at a time; a signal that lands mid-pass queues exactly one
 * follow-up, so evidence arriving during a pass is never missed. The
 * timer dies with `dispose()`, but an in-flight pass runs to completion —
 * that is what carries the result POST across whatever tears the driver
 * down.
 */
export class ExecutionDriver {
  /** Per-driver on purpose: exhausted entries stay pending for the NEXT
   *  connection's driver (re-POST is the designed recovery). */
  private readonly attempts = new Map<string, number>();
  private passRunning = false;
  private passQueued = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly deps: ExecutionDriverDeps) {}

  /** Call with every published entries snapshot; each call resets the
   *  pending timer, so the drain fires one quiet delay after the latest
   *  evidence rather than racing a replay burst. */
  noteEntriesChanged(entries: readonly ExecutionEntryModel[]): void {
    if (this.disposed) {
      return;
    }
    this._clearTimer();
    const eligible = eligibleEntriesOf(entries, this.attempts);
    if (eligible.length === 0) {
      return;
    }
    this.timer = setTimeout(
      () => {
        void this._drainInbox();
      },
      this._someDeliveryWasAttempted(eligible)
        ? EXECUTION_RETRY_DELAY_MS
        : EXECUTION_PASS_DELAY_MS,
    );
  }

  dispose(): void {
    this.disposed = true;
    this._clearTimer();
  }

  private async _drainInbox(): Promise<void> {
    if (this.passRunning) {
      this.passQueued = true;
      return;
    }
    this.passRunning = true;
    try {
      do {
        this.passQueued = false;
        await runExecutionPass({
          inbox: this.deps.inbox,
          threadId: this.deps.threadId,
          handlers: this.deps.handlersOf(),
          attempts: this.attempts,
          fetchThreadDetail: this.deps.fetchThreadDetail,
          postResults: this.deps.postResults,
          publishEntries: this.deps.publishEntries,
          onWorkflowRestarted: this.deps.onWorkflowRestarted,
        });
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- a timer firing mid-pass flips the flag during the await above
      } while (this.passQueued);
    } finally {
      this.passRunning = false;
    }
  }

  private _someDeliveryWasAttempted(
    eligible: readonly ExecutionEntryModel[],
  ): boolean {
    return eligible.some(
      (entry) => (this.attempts.get(entry.interruptId) ?? 0) > 0,
    );
  }

  private _clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
