// The consumed-interrupt fold: the stream's
// interrupt_answer_consumed markers say a resume already carried a pause's
// answer into the agent, so the id is no longer anyone's to answer — the
// pending-decision-gap derivation subtracts it instead of alarming. This
// module narrows the wire and names the run; the class below holds state.

import type { AgentSubscriber } from "@ag-ui/client";

import {
  INTERRUPT_ANSWER_CONSUMED_EVENT_NAME,
  type InterruptAnswerConsumedPayload,
} from "../contract/events.js";

export interface ConsumedInterrupt {
  interruptId: string;
  round: number;
}

/** The wire is distrusted by contract: a malformed value records
 *  nothing (the gap then alarms, never a crash). The
 *  payload's `family` is deliberately not read: the row-shape contract
 *  names it descriptive, not identity — (run_id, round, interrupt_id)
 *  is the whole fold key, and no client behavior branches on which
 *  signal family carried the answer. */
export function interruptAnswerConsumedPayloadOf(
  value: unknown,
): ConsumedInterrupt | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const payload = value as Partial<InterruptAnswerConsumedPayload>;
  if (
    typeof payload.interrupt_id !== "string" ||
    typeof payload.round !== "number"
  ) {
    return null;
  }
  return { interruptId: payload.interrupt_id, round: payload.round };
}

/**
 * Fires once per replayed or live consumption marker, named by the
 * server's own run id (the RUN_STARTED before it — the receipt-anchors
 * posture), so the store keys its consumed sets by run and a marker
 * from a superseded run can never subtract from the newest turn's gap.
 */
export function consumedInterruptRecorder(
  onConsumed: (runId: string, consumed: ConsumedInterrupt) => void,
): AgentSubscriber {
  let currentRunId: string | null = null;
  return {
    onRunStartedEvent({ event }) {
      currentRunId = event.runId;
    },
    onCustomEvent({ event }) {
      if (event.name !== INTERRUPT_ANSWER_CONSUMED_EVENT_NAME) {
        return;
      }
      const consumed = interruptAnswerConsumedPayloadOf(event.value);
      if (consumed === null || currentRunId === null) {
        return;
      }
      onConsumed(currentRunId, consumed);
    },
  };
}

// The empty consumed-set the gap derivation reads for a run with no
// recorded consumption — one frozen instance, so the derivation's
// inputs stay reference-stable across publishes.
const _NO_CONSUMED_IDS: ReadonlySet<string> = new Set();

// The consumed-interrupt fold, keyed by the server's run id
// and, inside each run, by the consumed pause's round — the row's own
// identity, (run_id, round, interrupt_id), matched against the turn's
// awaiting_round exactly like the server's subtraction, so a consumed
// answer can never subtract a later pause's id. A resume already
// carried these answers into the agent, so the gap derivation
// subtracts them instead of alarming. Store-lived on purpose (an
// epoch swap must not forget a consumption the wire already proved)
// and bounded: runs are pruned oldest-first past a small cap, since
// only the newest turn's run is ever read.
export class ConsumedInterruptFold {
  private readonly byRun = new Map<string, Map<number, Set<string>>>();

  /** Records one consumption; returns false when it was already known. */
  note(runId: string, interruptId: string, round: number): boolean {
    let byRound = this.byRun.get(runId);
    if (byRound === undefined) {
      byRound = new Map();
      this.byRun.set(runId, byRound);
      // Bounded by pruning whole runs oldest-first (Map preserves
      // insertion order): only the newest turn's run is ever read, so
      // anything past a handful of runs is dead weight.
      while (this.byRun.size > 8) {
        const oldest = this.byRun.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        this.byRun.delete(oldest);
      }
    }
    let consumed = byRound.get(round);
    if (consumed === undefined) {
      consumed = new Set();
      byRound.set(round, consumed);
    }
    if (consumed.has(interruptId)) {
      return false;
    }
    consumed.add(interruptId);
    return true;
  }

  idsOf(
    runId: string | null | undefined,
    awaitingRound: number | null | undefined,
  ): ReadonlySet<string> {
    if (runId == null || awaitingRound == null) {
      return _NO_CONSUMED_IDS;
    }
    return this.byRun.get(runId)?.get(awaitingRound) ?? _NO_CONSUMED_IDS;
  }
}
