// The string-receipt anchor family ({ receipt: string }, pinned per-marker by
// tests/contract-parity): the marker and its run's terminal are written in
// one commit, the receipt never becomes a message, and the row renders after
// the run's last message. The package's one consumer is turn_failed (the
// turn_voided row was deleted with the meta-receipts); the dashboard binds
// turn_failed and turn_stopped through ./transcript, so ReceiptPayload pins
// all three.

import type { AgentSubscriber } from "@ag-ui/client";

import type {
  TurnFailedMarker,
  TurnStoppedMarker,
  TurnVoidedMarker,
} from "../generated/models/index.js";
import { WIRE_SENTENCE_MAX_CHARS } from "./wire-sentence-cap.js";

// The compile-time pin to the wire schema: the UNION of the generated
// markers this family narrows — a property read on a union requires the
// field in every constituent, so renaming or dropping `receipt` in
// either contract shape fails the build here rather than silently
// null-ing every receipt row. (An intersection would only fail when
// both shapes lost it; tests/contract-parity pins each schema's field
// on the wire side as well.)
type ReceiptPayload = TurnVoidedMarker | TurnFailedMarker | TurnStoppedMarker;

export interface AnchoredReceipts {
  before: string[];
  after: string[];
}

/**
 * Narrow a receipt-carrying CUSTOM event's wire value (any by contract).
 * Malformed payloads return null and are ignored — the contract's
 * "clients MUST ignore events and fields they do not recognize".
 */
export function receiptOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const payload = value as Partial<ReceiptPayload>;
  if (typeof payload.receipt !== "string" || payload.receipt === "") {
    return null;
  }
  return payload.receipt.slice(0, WIRE_SENTENCE_MAX_CHARS);
}

/**
 * Idempotent anchor merge: every connection replays the stream from its
 * boundary (and StrictMode aborts and reruns the first connection), so the
 * same receipt can be anchored more than once per mount. Merging by content
 * keeps replays from stuttering the rows.
 */
export function withReceiptAnchored(
  previous: ReadonlyMap<string, AnchoredReceipts>,
  messageId: string,
  position: keyof AnchoredReceipts,
  receipts: string[],
): ReadonlyMap<string, AnchoredReceipts> {
  const anchored = previous.get(messageId) ?? { before: [], after: [] };
  // Unique within the batch too: a flush can carry the same receipt
  // twice when two connections' deliveries pooled before it.
  const fresh = [...new Set(receipts)].filter(
    (receipt) => !anchored[position].includes(receipt),
  );
  if (fresh.length === 0) {
    return previous;
  }
  const next = new Map(previous);
  next.set(messageId, {
    ...anchored,
    [position]: [...anchored[position], ...fresh],
  });
  return next;
}

/**
 * A defensive copy for seeding transcript state from the resume store:
 * entries that do not hold well-formed receipts are dropped rather than
 * rendered (or crashed on). The store is in-memory today, so every entry
 * it holds passed the payload narrower — this seam is where any future
 * persisted form of the store must degrade gracefully instead of wedging
 * the resume path: a dropped receipt reappears on the next full replay.
 */
export function wellFormedReceiptAnchorsOf(
  stored: ReadonlyMap<string, AnchoredReceipts>,
): ReadonlyMap<string, AnchoredReceipts> {
  const seeded = new Map<string, AnchoredReceipts>();
  // The narrowing deliberately distrusts the map's own types: this seam
  // is what turns a stale shape into missing rows instead of a crash.
  const entries = stored as ReadonlyMap<string, unknown>;
  for (const [messageId, anchored] of entries) {
    const before = _wellFormedReceiptsAt(anchored, "before");
    const after = _wellFormedReceiptsAt(anchored, "after");
    if (before.length > 0 || after.length > 0) {
      seeded.set(messageId, { before, after });
    }
  }
  return seeded;
}

/**
 * Anchors each of one marker's receipts: the marker and its run's
 * terminal are written in one commit, so the terminal is always the very
 * next event — the live RUN_ERROR for turn_failed, demoted to a quiet
 * RUN_FINISHED on replay — and the receipt flushes to a row after that
 * run's last message on either one.
 */
export function receiptMarkerRecorder(
  eventName: string,
  onReceiptAnchored: (
    runId: string,
    messageId: string,
    position: keyof AnchoredReceipts,
    receipts: string[],
  ) => void,
): AgentSubscriber {
  let pendingReceipts: string[] = [];
  let currentRunId: string | null = null;
  let newestMessageId: string | null = null;

  // One flush for both terminals: a failed run's live ending is
  // RUN_ERROR, and replay demotes it to a quiet RUN_FINISHED — the
  // turn_failed receipt must flush on either, or a live failure would
  // anchor nothing until the next reload.
  const flush = () => {
    if (
      pendingReceipts.length === 0 ||
      newestMessageId === null ||
      currentRunId === null
    ) {
      return;
    }
    onReceiptAnchored(currentRunId, newestMessageId, "after", pendingReceipts);
    pendingReceipts = [];
  };

  return {
    // One agent can be connected more than once (StrictMode detaches
    // the first run terminal-free and starts over): receipts a dead
    // connection collected but never flushed must not ride into the
    // replacement's flush, or the replay's own copy doubles them.
    onRunInitialized() {
      pendingReceipts = [];
      currentRunId = null;
      newestMessageId = null;
    },
    onRunStartedEvent({ event }) {
      // The server-named run id: the receipt's identity rides the run
      // it marked, so re-deliveries anchor once no matter where each
      // connection's message list has drifted to at flush time.
      currentRunId = event.runId;
    },
    onCustomEvent({ event }) {
      if (event.name !== eventName) {
        return;
      }
      const receipt = receiptOf(event.value);
      if (receipt !== null) {
        pendingReceipts.push(receipt);
      }
    },
    onMessagesChanged({ messages }) {
      newestMessageId = messages.at(-1)?.id ?? null;
    },
    onRunFinishedEvent() {
      flush();
    },
    onRunErrorEvent() {
      flush();
    },
  };
}

function _wellFormedReceiptsAt(
  anchored: unknown,
  position: keyof AnchoredReceipts,
): string[] {
  if (typeof anchored !== "object" || anchored === null) {
    return [];
  }
  const receipts = (anchored as Record<string, unknown>)[position];
  if (!Array.isArray(receipts)) {
    return [];
  }
  return receipts.filter(
    (receipt): receipt is string =>
      typeof receipt === "string" && receipt !== "",
  );
}
