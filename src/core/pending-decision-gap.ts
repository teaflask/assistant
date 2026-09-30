// The pending-decision gap: the server says the turn waits on
// named interrupts and this client holds NOTHING that answers for one —
// no card, no execution-inbox entry — so the gap must be loud. The premise
// and the two server-asserted non-gap subsets: docs/decision-anchors.md.

import type { AssistantTurnStatus } from "../generated/models/assistantTurnStatus.js";

/** The five turn fields the derivation reads — structural on purpose,
 *  so both callers assign with zero casts: the widget store
 *  passes the widget's generated ServingAssistantTurn (pause fields
 *  required), the dashboard playground its own generated
 *  AssistantTurnResponse (pause fields generated optional, though the
 *  server always supplies them). The optional array makes the type tell
 *  the truth the runtime tolerance below already pins. `status` keeps
 *  the generated union, not string: the two literal
 *  comparisons below stay compile-checked, both generated status types
 *  are the identical union so assignability costs nothing, and the day
 *  the dashboard's union drifts from this one the playground call site
 *  fails to compile — the loud drift signal, not a silent never-fires. */
export interface GapJudgeableTurn {
  id: string;
  status: AssistantTurnStatus;
  run_id: string | null;
  pending_interrupt_ids?: readonly string[];
  unservable_interrupt_ids?: readonly string[];
}

/** Representation is by interruptId, any holder — structural so the
 *  playground's refusal entries (not the widget's ExecutionEntryModel)
 *  count as holders without a cast that would break silently the day
 *  the derivation read a second field. */
interface InterruptHolder {
  interruptId: string;
}

export interface PendingDecisionGap {
  turnId: string;
  /** The pending interrupt ids nothing on this client answers for. */
  missingInterruptIds: readonly string[];
}

const EMPTY_CONSUMED_IDS: ReadonlySet<string> = new Set();

export function pendingDecisionGapOf(
  turn: GapJudgeableTurn | null,
  approvalCards: readonly InterruptHolder[],
  elicitationCards: readonly InterruptHolder[],
  executionEntries: readonly InterruptHolder[],
  consumedInterruptIds: ReadonlySet<string> = EMPTY_CONSUMED_IDS,
): PendingDecisionGap | null {
  if (turn === null) {
    return null;
  }
  if (turn.status !== "awaiting_input" && turn.status !== "parked") {
    return null;
  }
  if (turn.run_id === null || !Array.isArray(turn.pending_interrupt_ids)) {
    return null;
  }
  // Representation by id, whatever the holder's status: a held card —
  // even answered or stale — renders its own truthful state, and a
  // claimed execution entry is the driver's to answer.
  const represented = new Set<string>();
  for (const card of approvalCards) {
    represented.add(card.interruptId);
  }
  for (const card of elicitationCards) {
    represented.add(card.interruptId);
  }
  for (const entry of executionEntries) {
    represented.add(entry.interruptId);
  }
  // The server's own non-gap assertion: no card can ever be served for
  // these ids, so a wait must not be presented. Tolerates any non-array
  // shape (an older server omits the field) — never a false subtraction.
  const unservable = new Set<string>(
    Array.isArray(turn.unservable_interrupt_ids)
      ? turn.unservable_interrupt_ids.filter(
          (id): id is string => typeof id === "string",
        )
      : [],
  );
  // The per-element string guard mirrors the unservable filter's (and
  // regains the narrowing Array.isArray cannot give a readonly array):
  // a non-string element is wire garbage, never a missing id.
  const missing = turn.pending_interrupt_ids.filter(
    (id): id is string =>
      typeof id === "string" &&
      !represented.has(id) &&
      !consumedInterruptIds.has(id) &&
      !unservable.has(id),
  );
  if (missing.length === 0) {
    return null;
  }
  return { turnId: turn.id, missingInterruptIds: missing };
}

/** Content identity for publish dedupe and the grace probe's scope: one
 *  gap per (turn, missing set), order-insensitive. */
export function gapSignatureOf(gap: PendingDecisionGap): string {
  return `${gap.turnId}:${[...gap.missingInterruptIds].sort().join(",")}`;
}

// The gap's settle window: how long the evidence channel gets to
// land its recorded interrupts (execution entries, elicitations) before a
// gap the best-effort re-read could not close goes loud. A hard timer,
// deliberately not a wait on any stream OR network event — boundedness is
// the alert's liveness guarantee, and neither door's transport aborts a
// stalled request.
export const GAP_PROBE_SETTLE_MS = 2_000;

export interface PendingDecisionGapGateDeps {
  /** Receives the loud gap, or null when the gap clears. */
  publish: (gap: PendingDecisionGap | null) => void;
  /** One best-effort re-read per signature — never a gate on the timer,
   *  which is the alert's only liveness driver. */
  probe: () => void;
  /** Whether the evidence channel has had its chance — read at elapse,
   *  never latched here, because the two owners' evidence differs in
   *  shape: the widget store's epoch-connected-once record resets per
   *  connection epoch, while the playground transcript's replay-finalized
   *  latch is monotonic for the mount. Until it answers true, an elapsed
   *  window re-arms as a quiet heartbeat instead of alarming. */
  evidenceSettled: () => boolean;
}

/**
 * The per-signature grace window over the evidence predicate. States:
 * quiet | armed(sig) | loud(sig), crossed with `evidenceSettled` read at
 * elapse; every transition is enumerated in docs/decision-anchors.md.
 */
export class PendingDecisionGapGate {
  private readonly deps: PendingDecisionGapGateDeps;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The signature the armed window judges, or null when quiet. */
  private armedSignature: string | null = null;
  /** The last judged gap — what the window publishes if it elapses. */
  private judged: PendingDecisionGap | null = null;
  private loudSignature: string | null = null;

  constructor(deps: PendingDecisionGapGateDeps) {
    this.deps = deps;
  }

  judge(gap: PendingDecisionGap | null): void {
    this.judged = gap;
    if (gap === null) {
      this._disarm();
      if (this.loudSignature !== null) {
        this.loudSignature = null;
        this.deps.publish(null);
      }
      return;
    }
    const signature = gapSignatureOf(gap);
    if (this.loudSignature !== null) {
      this._disarm();
      if (signature !== this.loudSignature) {
        this.loudSignature = signature;
        this.deps.publish(gap);
      }
      return;
    }
    if (signature === this.armedSignature) {
      return;
    }
    this._disarm();
    this.armedSignature = signature;
    this.deps.probe();
    this._armWindow(signature);
  }

  dispose(): void {
    this._disarm();
  }

  private _armWindow(signature: string): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      const survivor = this.judged;
      if (survivor === null || gapSignatureOf(survivor) !== signature) {
        this.armedSignature = null;
        return;
      }
      if (!this.deps.evidenceSettled()) {
        this._armWindow(signature);
        return;
      }
      this.armedSignature = null;
      this.loudSignature = signature;
      this.deps.publish(survivor);
    }, GAP_PROBE_SETTLE_MS);
  }

  private _disarm(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.armedSignature = null;
  }
}
