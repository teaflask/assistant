// The package's product-telemetry seam: safety-critical human
// controls must never fail silently, so the approval submit path narrates
// itself as events the host forwards through onTelemetry (never an SDK here).

import { AGUIError } from "@ag-ui/core";

/** Why an attempted approval submit produced no request. */
export type ApprovalSubmitDropReason =
  // No active conversation to answer into — should be impossible while a card
  // renders; reported as an error too.
  | "no_active_thread"
  // The live inbox holds no card for this interrupt (a stale render).
  | "card_missing"
  // A benign double-click: the first submit is already in flight.
  | "already_submitting"
  // The rendered card lagged the live one, which already settled.
  | "not_actionable_answered"
  | "not_actionable_stale"
  // No turn could be resolved to answer into, even after a refresh.
  | "no_turn_id";

/** ApprovalCardStatus["kind"] (core/approval-inbox.ts) restated: the contract
 *  layer never imports core; the store's `card.status.kind` pass pins drift. */
type ApprovalCardStatusKind =
  "actionable" | "submitting" | "answered" | "stale";

export interface ApprovalSubmitTelemetryEvent {
  name:
    | "approval_submit_attempted"
    | "approval_submit_sent"
    | "approval_submit_dropped";
  properties: {
    interrupt_id: string;
    thread_id: string | null;
    approved: boolean;
    trusted: boolean;
    /** The rendered card's status kind at handler entry. */
    card_status: ApprovalCardStatusKind;
    parked: boolean;
    drop_reason?: ApprovalSubmitDropReason;
  };
}

/** How a stream fetch failed: where in the request's life the wire died,
 *  since each class has a different owner (network, edge, origin, client). */
export type StreamFailureClass =
  // The fetch rejected before any response arrived (DNS, CORS, offline).
  | "network_rejected"
  // A response arrived non-2xx; `status` carries it.
  | "http_error"
  // A 2xx was accepted but its body offered no readable stream.
  | "no_body"
  // The SSE body died mid-read after events had flowed.
  | "mid_stream"
  // The event pipeline refused what arrived (protocol/validation).
  | "parse_or_validation"
  // Our own abort; the recorder filters these — the class exists for totality.
  | "client_abort";

/** One stream failure, narrated for the host's analytics. Cursor fields
 *  locate it on the recorded log; NEVER message text, tool args or prompts. */
export interface StreamFailedTelemetryEvent {
  name: "assistant_stream_failed";
  properties: {
    failure_class: StreamFailureClass;
    /** The HTTP status when a response arrived; null before one. */
    status: number | null;
    thread_id: string | null;
    /** The resume snapshot's cursor a reconnect would replay past. */
    resume_cursor: string | null;
    /** The last SSE `id:` the dying connection committed. */
    last_committed_sse_id: string | null;
  };
}

export type AssistantTelemetryEvent =
  ApprovalSubmitTelemetryEvent | StreamFailedTelemetryEvent;

/** Classify a stream failure off the transport's shapes: runHttpRequest
 *  stamps `.status` on a non-2xx, a missing body is its fixed sentence,
 *  protocol refusals are AGUIError, schema rejections are raw ZodErrors. A
 *  network death is a bare TypeError at BOTH ends of the request's life, so
 *  the caller says whether the body delivered any bytes (keepalives count):
 *  with bytes the wire died mid-stream; without, no response ever flowed. */
export function streamFailureClassOf(
  error: Error,
  context: { sawBodyBytes: boolean },
): StreamFailureClass {
  if (error.name === "AbortError" || /\baborted?\b/i.test(error.message)) {
    return "client_abort";
  }
  if (typeof (error as { status?: unknown }).status === "number") {
    return "http_error";
  }
  if (error instanceof AGUIError || error.name === "ZodError") {
    return "parse_or_validation";
  }
  if (error.message.includes("Failed to getReader")) {
    return "no_body";
  }
  if (error instanceof TypeError) {
    return context.sawBodyBytes ? "mid_stream" : "network_rejected";
  }
  return "mid_stream";
}
