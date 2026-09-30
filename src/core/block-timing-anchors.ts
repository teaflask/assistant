// The block-timing anchor model, pure of React: the recorder reads the
// per-event server timestamp off every raw event that names a
// block (a messageId or a toolCallId), folds it into that block's
// earliest-start/latest-settle pair, and the resume store holds the map
// across remounts. The indirection exists because the client carries no
// per-event timestamp onto the messages it builds — this map is the
// timing's only home on the client, and a snapshot-seeded reconnect
// replays only past the cursor, so historical blocks keep their timing
// from here alone. Absent timestamps
// (old histories, synthesized frames) record nothing: to every consumer,
// absence means unknown, never zero.

import type { AgentSubscriber } from "@ag-ui/client";
import { EventType } from "@ag-ui/core";

import type { BlockTiming } from "./segment-timing.js";

/**
 * One observed instant folded into a block's pair, IN PLACE: the
 * earliest observed value is the start, the latest the settle. True when
 * the map moved — the caller's change signal. Deliberately NOT the
 * neighbouring anchors' copy-on-write idiom: timing is the one
 * high-frequency map (every block boundary moves it), and an immutable
 * copy per fold is O(N) per write — O(N²) over an N-block replay — so
 * this map mutates and the resume store's REVISION counter replaces
 * identity as the change signal. ENTRIES stay immutable (a fold sets a
 * fresh pair object, never mutates one), so a snapshot that copied the
 * map never sees its held pairs change; re-applying a replayed sequence
 * changes nothing (min/max are idempotent) and answers false.
 */
export function foldBlockTimingObserved(
  timings: Map<string, BlockTiming>,
  blockId: string,
  observedAtMs: number,
): boolean {
  const existing = timings.get(blockId);
  if (existing === undefined) {
    timings.set(blockId, {
      startedAtMs: observedAtMs,
      settledAtMs: observedAtMs,
    });
    return true;
  }
  const startedAtMs =
    existing.startedAtMs === null
      ? observedAtMs
      : Math.min(existing.startedAtMs, observedAtMs);
  const settledAtMs =
    existing.settledAtMs === null
      ? observedAtMs
      : Math.max(existing.settledAtMs, observedAtMs);
  if (
    startedAtMs === existing.startedAtMs &&
    settledAtMs === existing.settledAtMs
  ) {
    return false;
  }
  timings.set(blockId, { startedAtMs, settledAtMs });
  return true;
}

/**
 * A defensive copy for seeding transcript state from the resume store:
 * entries that are not a well-formed pair are dropped rather than
 * rendered (or crashed on) — a dropped pair degrades that block's
 * duration to unknown until the next full replay, never a crash.
 */
export function wellFormedBlockTimingAnchorsOf(
  stored: ReadonlyMap<string, BlockTiming>,
): ReadonlyMap<string, BlockTiming> {
  const seeded = new Map<string, BlockTiming>();
  const entries = stored as ReadonlyMap<unknown, unknown>;
  for (const [blockId, timing] of entries) {
    if (typeof blockId !== "string" || !_isWellFormedTiming(timing)) {
      continue;
    }
    seeded.set(blockId, timing);
  }
  return seeded;
}

// Only block BOUNDARIES contribute: a delta's timestamp can only land
// between its block's start and end, so recording it would tighten
// nothing while republishing the anchors snapshot on every batch. Built
// from the shipped EventType enum, never raw strings, so a typo or an
// upstream rename fails the build instead of silently degrading a
// block's duration to unknown.
const BLOCK_BOUNDARY_EVENT_TYPES: ReadonlySet<string> = new Set([
  EventType.TEXT_MESSAGE_START,
  EventType.TEXT_MESSAGE_END,
  EventType.REASONING_START,
  EventType.REASONING_END,
  EventType.REASONING_MESSAGE_START,
  EventType.REASONING_MESSAGE_END,
  EventType.TOOL_CALL_START,
  EventType.TOOL_CALL_END,
  EventType.TOOL_CALL_RESULT,
]);

/**
 * Records each timestamped block-boundary event against the block it
 * names. The block id is the durable join — the event's own messageId
 * or toolCallId — never adjacency; an event naming no block (lifecycle
 * frames, thread markers) contributes nothing here.
 */
export function blockTimingRecorder(
  onTimingObserved: (blockId: string, observedAtMs: number) => void,
): AgentSubscriber {
  return {
    onEvent({ event }) {
      if (!BLOCK_BOUNDARY_EVENT_TYPES.has(event.type)) {
        return;
      }
      const observedAtMs = _timestampOf(event);
      if (observedAtMs === undefined) {
        return;
      }
      const blockId = _blockIdOf(event);
      if (blockId !== undefined) {
        onTimingObserved(blockId, observedAtMs);
      }
    },
  };
}

function _timestampOf(event: unknown): number | undefined {
  if (typeof event !== "object" || event === null) {
    return undefined;
  }
  const { timestamp } = event as { timestamp?: unknown };
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return undefined;
  }
  return timestamp;
}

/** The durable block id an event names: its toolCallId when it is a
 *  tool-family event, else its messageId (text and reasoning families).
 *  Narrowed from unknown — the wire is distrusted by contract. */
function _blockIdOf(event: unknown): string | undefined {
  if (typeof event !== "object" || event === null) {
    return undefined;
  }
  const { toolCallId, messageId } = event as {
    toolCallId?: unknown;
    messageId?: unknown;
  };
  if (typeof toolCallId === "string" && toolCallId !== "") {
    return toolCallId;
  }
  if (typeof messageId === "string" && messageId !== "") {
    return messageId;
  }
  return undefined;
}

function _isWellFormedTiming(timing: unknown): timing is BlockTiming {
  if (typeof timing !== "object" || timing === null) {
    return false;
  }
  const { startedAtMs, settledAtMs } = timing as {
    startedAtMs?: unknown;
    settledAtMs?: unknown;
  };
  const halfIsWellTyped = (half: unknown): boolean =>
    half === null || (typeof half === "number" && Number.isFinite(half));
  return halfIsWellTyped(startedAtMs) && halfIsWellTyped(settledAtMs);
}
