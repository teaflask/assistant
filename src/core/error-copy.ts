import { ServingApiError } from "../transport/serving-error.js";
import { STOP_NOT_DELIVERED_SENTENCE } from "./stop-copy.js";

// The honest error taxonomy: one user-facing sentence per contract code
// the surface can hit. Unknown codes fall back to the server's message,
// which the contract guarantees is a human sentence safe to show.

const GENERIC_FAILURE_SENTENCE =
  "Something went wrong sending that. Please try again.";

export function userSentenceFor(error: unknown): string {
  if (!(error instanceof ServingApiError)) {
    return GENERIC_FAILURE_SENTENCE;
  }
  switch (error.code) {
    // Retired producer (sends queue instead) — kept for older deploys.
    case "ASSISTANT_THREAD_BUSY":
      return (
        "The assistant is already answering — possibly in another tab. " +
        "Wait for it to finish."
      );
    case "RATE_LIMITED":
      return _rateLimitedSentence(error.retryAfterSeconds);
    case "SUBSCRIPTION_CANNOT_PAY":
      return _subscriptionCannotPaySentence(error);
    case "SUBSCRIPTION_CONNECT_REQUIRED":
      // The server sentence is the visitor copy; the connect panel (which
      // opens on this code) owns the richer affordance.
      return error.message;
    case "ORCHESTRATION_UNAVAILABLE":
      return "The assistant couldn't be started right now. Please try again in a moment.";
    case "NOT_FOUND":
      return "That conversation doesn't exist anymore.";
    case "VALIDATION_ERROR":
      return "That message couldn't be sent. Shorten it and try again.";
    default:
      return error.message;
  }
}

// The stop door's failure vocabulary: a failed stop must never
// read as a failed send ("couldn't be started", "went wrong sending
// that" — both lies about a turn that is still running). The door's own
// sentences are written for this surface — its 503 ships "The stop
// couldn't be delivered right now. Please try again in a moment." — so
// every contract sentence passes through, and the generic line (the
// stop-copy leaf's, shared with the dashboard playground) covers only
// transport deaths that never reached the door.

export function stopFailureSentenceFor(error: unknown): string {
  if (error instanceof ServingApiError && error.message !== "") {
    return error.message;
  }
  return STOP_NOT_DELIVERED_SENTENCE;
}

function _rateLimitedSentence(retryAfterSeconds: number | null): string {
  if (retryAfterSeconds !== null && retryAfterSeconds > 0) {
    return `You're sending messages too quickly. Try again in ${String(retryAfterSeconds)} seconds.`;
  }
  return "You're sending messages too quickly. Wait a moment and try again.";
}

function _subscriptionCannotPaySentence(error: ServingApiError): string {
  // The wait is rendered exactly when the server sent Retry-After — it
  // does so only for a reset still ahead (no closeness threshold
  // exists) — in the largest sensible unit: plan windows run daily to
  // weekly, so raw minutes would read "about 10080 minutes". Without
  // the header the server's own sentence stands: the plain quota copy,
  // or the re-checking copy for a stale bounce whose re-probe the door
  // just kicked.
  const retryAfterSeconds = error.retryAfterSeconds;
  if (retryAfterSeconds !== null && retryAfterSeconds > 0) {
    return (
      "Your ChatGPT plan's included usage is used up for this period. " +
      `The conversation can continue in about ${humanizedWait(retryAfterSeconds)}.`
    );
  }
  return error.message;
}

const _HOUR_SECONDS = 3600;
const _DAY_SECONDS = 24 * _HOUR_SECONDS;

/** A wait in the largest sensible unit — plan windows run daily to
 *  weekly, so raw minutes would read "about 10080 minutes". Each unit is
 *  ceiled, so the promise is never early. Shared with the gate card and
 *  the standing sentences (one spelling of every wait). */
export function humanizedWait(seconds: number): string {
  // Minutes under two hours, hours under two days, days beyond.
  if (seconds < 2 * _HOUR_SECONDS) {
    return _counted(Math.max(1, Math.ceil(seconds / 60)), "minute");
  }
  if (seconds < 2 * _DAY_SECONDS) {
    return _counted(Math.ceil(seconds / _HOUR_SECONDS), "hour");
  }
  return _counted(Math.ceil(seconds / _DAY_SECONDS), "day");
}

function _counted(count: number, unit: string): string {
  return `${String(count)} ${unit}${count === 1 ? "" : "s"}`;
}
