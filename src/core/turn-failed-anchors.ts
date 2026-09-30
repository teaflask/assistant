// The failure-receipt anchor model: a turn_failed CUSTOM event is the
// durable record that this turn ended in failure outside any single tool
// — quota, provider, transport, orchestration, or a sweep —
// carrying the wire's own reader-aware sentence (the same string as the
// turn's `error`). It is the failed turn's only replay-stable record:
// the run's live RUN_ERROR demotes to RUN_FINISHED on replay. The
// mechanics — narrow, merge, seed, record — are the shared
// string-receipt family's (receipt-anchors.ts); this module binds them
// to the turn_failed event under the failure vocabulary its consumers
// speak.

import {
  receiptMarkerRecorder,
  receiptOf,
  wellFormedReceiptAnchorsOf,
  withReceiptAnchored,
  type AnchoredReceipts,
} from "./receipt-anchors.js";
import { TURN_FAILED_EVENT_NAME } from "../contract/events.js";
import type { AgentSubscriber } from "@ag-ui/client";

export type AnchoredTurnFailReceipts = AnchoredReceipts;

export const EMPTY_TURN_FAILED_ANCHORS: ReadonlyMap<
  string,
  AnchoredTurnFailReceipts
> = new Map();

export const turnFailedReceiptOf = receiptOf;

export const withTurnFailedAnchored = withReceiptAnchored;

export const wellFormedFailAnchorsOf = wellFormedReceiptAnchorsOf;

export function turnFailedMarkerRecorder(
  onReceiptAnchored: (
    failedRunId: string,
    messageId: string,
    position: keyof AnchoredTurnFailReceipts,
    receipts: string[],
  ) => void,
): AgentSubscriber {
  return receiptMarkerRecorder(TURN_FAILED_EVENT_NAME, onReceiptAnchored);
}
