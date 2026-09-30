// The delivery-receipt anchor model, pure of React: a
// machine-started delivery turn opens its run with a
// subagent_results_delivered marker naming the settled dispatches it
// pushes. The recorder anchors each marker to the run's first message,
// the transcript renders a quiet divider before it, and the resume
// store holds the anchors across remounts (a snapshot-seeded reconnect
// replays only past the cursor, so historical receipts never re-arrive
// on the wire).

import type { AgentSubscriber } from "@ag-ui/client";

import {
  SUBAGENT_RESULTS_DELIVERED_EVENT_NAME,
  type SubagentResultsDeliveredPayload,
} from "../contract/events.js";

// The label is the dispatch's bounded excerpt today, but the narrower
// distrusts the wire by contract; a runaway string is retained capped,
// never unbounded.
const LABEL_MAX_CHARS = 200;

export interface DeliveredResult {
  ordinal: number;
  label: string;
  succeeded: boolean;
}

export const EMPTY_SUBAGENT_DELIVERY_ANCHORS: ReadonlyMap<
  string,
  DeliveredResult[]
> = new Map();

/**
 * Narrow a subagent_results_delivered CUSTOM event's wire value (any by
 * contract). Entries without a numeric ordinal are dropped; a missing
 * label degrades to "" and a missing succeeded to true (the wire's own
 * default). Null when nothing valid survives — the contract's "clients
 * MUST ignore events and fields they do not recognize".
 */
export function deliveredResultsOf(value: unknown): DeliveredResult[] | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const payload = value as Partial<SubagentResultsDeliveredPayload>;
  if (!Array.isArray(payload.results)) {
    return null;
  }
  const results: DeliveredResult[] = [];
  for (const entry of payload.results as unknown[]) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const result = entry as Record<string, unknown>;
    if (typeof result.ordinal !== "number") {
      continue;
    }
    results.push({
      ordinal: result.ordinal,
      label:
        typeof result.label === "string"
          ? result.label.slice(0, LABEL_MAX_CHARS)
          : "",
      succeeded: result.succeeded !== false,
    });
  }
  return results.length > 0 ? results : null;
}

/**
 * First anchor wins, ever: the marker is emitted at most once per
 * delivery run, so a second anchoring under the same message id is a
 * replay's re-delivery, never new information.
 */
export function withSubagentDeliveryAnchored(
  previous: ReadonlyMap<string, DeliveredResult[]>,
  messageId: string,
  results: DeliveredResult[],
): ReadonlyMap<string, DeliveredResult[]> {
  if (previous.has(messageId)) {
    return previous;
  }
  const next = new Map(previous);
  next.set(messageId, results);
  return next;
}

/**
 * A defensive copy for seeding transcript state from the resume store:
 * entries that do not hold well-formed results are dropped rather than
 * rendered (or crashed on). The store is in-memory today, so every entry
 * it holds passed the payload narrower — this seam is where any future
 * persisted form of the store must degrade gracefully instead of wedging
 * the resume path: a dropped receipt reappears on the next full replay.
 */
export function wellFormedDeliveryAnchorsOf(
  stored: ReadonlyMap<string, DeliveredResult[]>,
): ReadonlyMap<string, DeliveredResult[]> {
  const seeded = new Map<string, DeliveredResult[]>();
  // The narrowing deliberately distrusts the map's own types: this seam
  // is what turns a stale shape into missing rows instead of a crash.
  const entries = stored as ReadonlyMap<string, unknown>;
  for (const [messageId, anchored] of entries) {
    if (!Array.isArray(anchored)) {
      continue;
    }
    const results = anchored.filter(
      (entry): entry is DeliveredResult =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as Record<string, unknown>).ordinal === "number" &&
        typeof (entry as Record<string, unknown>).label === "string" &&
        typeof (entry as Record<string, unknown>).succeeded === "boolean",
    );
    if (results.length > 0) {
      seeded.set(messageId, results);
    }
  }
  return seeded;
}

/**
 * Anchors each subagent_results_delivered marker to the first message
 * that appears after it — the delivery run's first assistant message,
 * since the marker is the run's first stored row and a delivery turn
 * has no user bubble. Run-bounded: a pending marker never leaks onto a
 * later run's first message, and the run id rides to the caller so the
 * store can anchor once per delivery run no matter where each
 * connection's message list has drifted to at flush time.
 */
export function subagentDeliveryMarkerRecorder(
  onDeliveryAnchored: (
    deliveryRunId: string,
    messageId: string,
    results: DeliveredResult[],
  ) => void,
): AgentSubscriber {
  let pending: { runId: string; results: DeliveredResult[] } | null = null;
  let currentRunId: string | null = null;

  return {
    // One agent can be connected more than once (StrictMode detaches
    // the first run terminal-free and starts over): a marker a dead
    // connection collected but never flushed must not ride into the
    // replacement's flush.
    onRunInitialized() {
      pending = null;
      currentRunId = null;
    },
    onRunStartedEvent({ event }) {
      currentRunId = event.runId;
    },
    onCustomEvent({ event }) {
      if (event.name !== SUBAGENT_RESULTS_DELIVERED_EVENT_NAME) {
        return;
      }
      const results = deliveredResultsOf(event.value);
      if (results !== null && currentRunId !== null) {
        pending = { runId: currentRunId, results };
      }
    },
    onMessagesChanged({ messages }) {
      const newestMessage = messages.at(-1);
      if (pending === null || newestMessage === undefined) {
        return;
      }
      const marker = pending;
      pending = null;
      onDeliveryAnchored(marker.runId, newestMessage.id, marker.results);
    },
    // A pathological message-less delivery run must not carry its
    // divider into the next run's first message.
    onRunFinishedEvent() {
      pending = null;
    },
  };
}
