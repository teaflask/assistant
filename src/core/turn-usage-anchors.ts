// The turn-usage anchor model, pure of React: the recorder maps each
// turn_usage_recorded CUSTOM marker to its turn id, consumers read the
// map to show honest token totals where a surface is entitled to them
// (today none in the conversation chrome — slot contract §7), and the
// resume store holds the map across remounts (the marker never becomes a
// message, and a snapshot-seeded reconnect replays only past the cursor).
// An absent entry means usage is UNKNOWN and the number hides cleanly —
// the wire never carries a client-side estimate, and this module never
// invents one. finality is an open vocabulary: only "final" reads as
// settled truth; any other token — "partial" (a
// call was cut short before the provider reported a count, so the sums
// are known lower bounds), "stopped" (the member stopped a
// segment mid-flight and its rows are still landing) or tomorrow's
// unknowns — reads as not-final.

import type { AgentSubscriber } from "@ag-ui/client";

import { TURN_USAGE_RECORDED_EVENT_NAME } from "../contract/events.js";

// Vocabulary tokens are single words by contract; a runaway token is
// retained capped and resolves to not-final downstream.
const TOKEN_MAX_CHARS = 64;

// The one finality token that reads as settled truth — deliberately a
// plain string, not an enum: finality is an OPEN wire vocabulary (the
// "open vocabularies, not wire enums" ruling), and this constant
// exists so the schema default and the truth test can never drift apart.
const FINAL_FINALITY = "final";

export interface TurnUsage {
  turnId: string;
  /** Open vocabulary: "final" is settled truth; anything else is not. */
  finality: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

export const EMPTY_TURN_USAGE_ANCHORS: ReadonlyMap<string, TurnUsage> =
  new Map();

/** Whether a narrowed usage entry is settled truth. */
export function usageIsFinal(usage: TurnUsage): boolean {
  return usage.finality === FINAL_FINALITY;
}

/**
 * Narrow a turn_usage_recorded marker's value. Null means ignore — the
 * contract's "clients MUST ignore events and fields they do not
 * recognize": a malformed count is not honest evidence, and a usage row
 * without its turn id has no durable join.
 */
export function turnUsageAnchorOf(value: unknown): TurnUsage | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const {
    turn_id: turnId,
    finality,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cacheReadTokens,
    cache_write_tokens: cacheWriteTokens,
    total_tokens: totalTokens,
  } = value as {
    turn_id?: unknown;
    finality?: unknown;
    input_tokens?: unknown;
    output_tokens?: unknown;
    cache_read_tokens?: unknown;
    cache_write_tokens?: unknown;
    total_tokens?: unknown;
  };
  if (typeof turnId !== "string" || turnId === "") {
    return null;
  }
  // The wire schema declares finality optional with a server-side
  // default of "final" — an ABSENT field resolves to that default (the
  // counts are still honest evidence), while a PRESENT-but-malformed one
  // is a shape surprise and drops the row like any other.
  const resolvedFinality = finality === undefined ? FINAL_FINALITY : finality;
  if (typeof resolvedFinality !== "string" || resolvedFinality.trim() === "") {
    return null;
  }
  if (
    !_isCount(inputTokens) ||
    !_isCount(outputTokens) ||
    !_isCount(cacheReadTokens) ||
    !_isCount(cacheWriteTokens) ||
    !_isCount(totalTokens)
  ) {
    return null;
  }
  return {
    turnId,
    finality: resolvedFinality.slice(0, TOKEN_MAX_CHARS),
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
  };
}

/**
 * Reconcile-by-id, never append: a delayed or replayed marker updates the
 * turn's existing entry. A FINAL entry is never demoted by a non-final
 * one (a replay can interleave a future partial behind its final), and
 * an identical re-delivery returns the map unchanged — identity is the
 * publish gate.
 */
export function withTurnUsageAnchored(
  previous: ReadonlyMap<string, TurnUsage>,
  usage: TurnUsage,
): ReadonlyMap<string, TurnUsage> {
  const existing = previous.get(usage.turnId);
  if (existing !== undefined) {
    if (usageIsFinal(existing) && !usageIsFinal(usage)) {
      return previous;
    }
    if (_sameUsage(existing, usage)) {
      return previous;
    }
  }
  const next = new Map(previous);
  next.set(usage.turnId, usage);
  return next;
}

/**
 * A defensive copy for seeding from the resume store: entries that are
 * not a well-formed usage record are dropped rather than rendered — a
 * dropped entry degrades to a hidden number until the next full replay,
 * never a crash.
 */
export function wellFormedTurnUsageAnchorsOf(
  stored: ReadonlyMap<string, TurnUsage>,
): ReadonlyMap<string, TurnUsage> {
  const seeded = new Map<string, TurnUsage>();
  const entries = stored as ReadonlyMap<unknown, unknown>;
  for (const [turnId, usage] of entries) {
    if (typeof turnId !== "string" || !_isWellFormedUsage(usage)) {
      continue;
    }
    seeded.set(turnId, usage);
  }
  return seeded;
}

/** Records each usage marker's turn id → narrowed totals. */
export function turnUsageRecorder(
  onUsageAnchored: (usage: TurnUsage) => void,
): AgentSubscriber {
  return {
    onCustomEvent({ event }) {
      if (event.name !== TURN_USAGE_RECORDED_EVENT_NAME) {
        return;
      }
      const usage = turnUsageAnchorOf(event.value);
      if (usage !== null) {
        onUsageAnchored(usage);
      }
    },
  };
}

function _isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function _sameUsage(a: TurnUsage, b: TurnUsage): boolean {
  return (
    a.finality === b.finality &&
    a.inputTokens === b.inputTokens &&
    a.outputTokens === b.outputTokens &&
    a.cacheReadTokens === b.cacheReadTokens &&
    a.cacheWriteTokens === b.cacheWriteTokens &&
    a.totalTokens === b.totalTokens
  );
}

function _isWellFormedUsage(usage: unknown): usage is TurnUsage {
  if (typeof usage !== "object" || usage === null) {
    return false;
  }
  const {
    turnId,
    finality,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
  } = usage as {
    turnId?: unknown;
    finality?: unknown;
    inputTokens?: unknown;
    outputTokens?: unknown;
    cacheReadTokens?: unknown;
    cacheWriteTokens?: unknown;
    totalTokens?: unknown;
  };
  return (
    typeof turnId === "string" &&
    turnId !== "" &&
    typeof finality === "string" &&
    finality !== "" &&
    _isCount(inputTokens) &&
    _isCount(outputTokens) &&
    _isCount(cacheReadTokens) &&
    _isCount(cacheWriteTokens) &&
    _isCount(totalTokens)
  );
}
