// The failure banner's copy rules: which settled turn earns the failure
// banner at all (failureSentenceOf), and when the banner yields to the
// transcript's own durable receipt (bannerFailureSentenceOf). The pins in
// tests/turn-stopped.test.ts and tests/turn-failed.test.ts import from
// here.

import type { ServingAssistantTurn } from "../contract/threads.js";
import type { AnchoredTurnFailReceipts } from "./turn-failed-anchors.js";

// Exported for the status-taxonomy pins: failed is the ONLY status that
// earns the failure banner — parked is resumable and superseded is a
// receipt, and neither may ever read as an error. And only a VISITOR
// turn's failure (kind null) earns it: a failed machine turn (delivery,
// or any future kind — the additive rule) fails in a conversation the
// visitor isn't driving, and the fallback copy ("the last answer") would
// be a lie about a message they never sent. Its honest record stays in
// the activity feed (settledResultOf, deliberately) and the org-facing
// conversations log.
export function failureSentenceOf(
  turns: ServingAssistantTurn[],
): string | null {
  const newestTurn = turns.at(-1);
  if (newestTurn?.status === "failed" && newestTurn.kind == null) {
    return newestTurn.error ?? "The last answer didn't finish.";
  }
  return null;
}

// The banner's yielding rule: once the transcript itself
// anchors the failed turn's durable receipt (the turn_failed marker),
// the notice banner is a duplicate telling — the row IS the record, in
// place, and it survives reload. The banner therefore renders only for
// histories with no anchored receipt: turns that failed before the
// marker existed, or a REST adoption that outran the stream. Matching
// is by sentence content because the receipt is BY CONSTRUCTION the
// same string as the turn's error (the backend writes both in one
// settle); two distinct failed turns sharing one canned sentence would
// suppress on the older turn's receipt, which still points the reader
// at a true failure record.
export function bannerFailureSentenceOf(
  sentence: string | null,
  failedReceiptAnchors:
    ReadonlyMap<string, AnchoredTurnFailReceipts> | undefined,
): string | null {
  if (sentence === null || failedReceiptAnchors === undefined) {
    return sentence;
  }
  for (const anchored of failedReceiptAnchors.values()) {
    if (
      anchored.before.includes(sentence) ||
      anchored.after.includes(sentence)
    ) {
      return null;
    }
  }
  return sentence;
}
