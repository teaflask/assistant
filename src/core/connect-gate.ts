// The conversation gate: what stands between this visitor
// and their next send, as one client-side shape with two producers — the
// assistant-config read's pre-flight projection (the gate is known before
// anyone types) and a send refusal (the race window where the projection
// was stale). ConversationView renders it in the composer's place; the
// provider chip and the gate card are its readers.

import type {
  ConnectProjectionResponse,
  SubscriptionProvider,
} from "../generated/models/index.js";
import { ServingApiError } from "../transport/serving-error.js";

/** Why a connect gate is asking: the free preview ran out (a first
 *  connect) or a connected plan's credential died (a reconnect). The
 *  contract grows reasons additively; unknown values read as
 *  auth_bounced — the conservative ask. */
type ConnectGateReason = "taster_exhausted" | "auth_bounced";

export type ConversationGate =
  | { kind: "none" }
  | { kind: "sign_in" }
  | {
      kind: "connect";
      reason: ConnectGateReason;
      providers: SubscriptionProvider[];
    }
  | { kind: "wait"; retryAtMs: number | null }
  | { kind: "verifying" };

export const NO_GATE: ConversationGate = { kind: "none" };

/** Whether two gates say the same thing. The projection mints a fresh
 *  object every read, so the registry dedupes on substance before
 *  writing its cell — an unchanged gate must not notify (each notify
 *  re-renders every gate consumer, and a re-render storm under a
 *  4s re-read chain is how a bounded poll turns unbounded). */
export function gatesEqual(a: ConversationGate, b: ConversationGate): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === "connect" && b.kind === "connect") {
    // Joined, not compared elementwise: the provider union has one
    // member today, and TS narrows an element comparison to
    // always-true (the vocabulary grows additively).
    return (
      a.reason === b.reason && a.providers.join(" ") === b.providers.join(" ")
    );
  }
  if (a.kind === "wait" && b.kind === "wait") {
    return a.retryAtMs === b.retryAtMs;
  }
  return true;
}

/** The projection's gate, client-shaped. An unknown gate value reads as
 *  none — the contract's growth rule; the send door stays the truth. */
export function gateOfProjection(
  connect: ConnectProjectionResponse | undefined,
): ConversationGate {
  if (connect === undefined) {
    return NO_GATE;
  }
  switch (connect.gate) {
    case "sign_in":
      return { kind: "sign_in" };
    case "connect":
      return {
        kind: "connect",
        reason: _reasonOf(connect.reason),
        providers: connect.providers,
      };
    case "wait":
      return { kind: "wait", retryAtMs: _retryAtMsOf(connect) };
    case "verifying":
      return { kind: "verifying" };
    default:
      return NO_GATE;
  }
}

/** A send refusal's gate, or null when the refusal is not a gate (a rate
 *  limit, a busy thread — the banner's story, not the composer's). */
export function gateOfRefusal(error: unknown): ConversationGate | null {
  if (!(error instanceof ServingApiError)) {
    return null;
  }
  if (error.code === "ASSISTANT_SIGN_IN_REQUIRED") {
    return { kind: "sign_in" };
  }
  if (error.code === "SUBSCRIPTION_CONNECT_REQUIRED") {
    const details = _connectDetailsOf(error);
    return {
      kind: "connect",
      reason: _reasonOf(details.reason),
      providers: details.providers,
    };
  }
  if (error.code === "SUBSCRIPTION_CANNOT_PAY") {
    if (error.retryAfterSeconds !== null) {
      return {
        kind: "wait",
        retryAtMs: Date.now() + error.retryAfterSeconds * 1000,
      };
    }
    return { kind: "verifying" };
  }
  return null;
}

// --- the details reader --------------------------------------------------------

interface ConnectRefusalDetails {
  reason: string | null;
  providers: SubscriptionProvider[];
}

/** The refusal envelope's structured half, read leniently: details is
 *  `unknown` on the wire by design, and a malformed shape must degrade
 *  to an empty ask, never throw under an error handler. */
function _connectDetailsOf(error: ServingApiError): ConnectRefusalDetails {
  const details = error.details;
  if (typeof details !== "object" || details === null) {
    return { reason: null, providers: [] };
  }
  const reason = "reason" in details ? details.reason : null;
  const named = "providers" in details ? details.providers : null;
  const providers = Array.isArray(named)
    ? named.filter((value): value is SubscriptionProvider =>
        _isAKnownProvider(value),
      )
    : [];
  return { reason: typeof reason === "string" ? reason : null, providers };
}

function _isAKnownProvider(value: unknown): boolean {
  return value === "openai_chatgpt";
}

function _reasonOf(reason: string | null): ConnectGateReason {
  return reason === "taster_exhausted" ? "taster_exhausted" : "auth_bounced";
}

function _retryAtMsOf(connect: ConnectProjectionResponse): number | null {
  if (connect.retry_after_seconds === null) {
    return null;
  }
  return Date.now() + connect.retry_after_seconds * 1000;
}
