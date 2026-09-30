// The execution wire's narrowers: a
// tool_execution_requested marker's value and a turn snapshot's coworker
// request item, both `any` by contract. Malformed values return null and
// are ignored — the contract's "clients MUST ignore events and fields they
// do not recognize". A dependency-free leaf, so the ./transcript entry
// exports the coworker narrowing without dragging the inbox along.

import type { ToolExecutionRequestedPayload } from "../contract/events.js";

/** One coworker request as the turn snapshot lists it, narrowed. */
export interface CoworkerExecutionRequest {
  ordinal: number;
  label: string;
  childSessionId: string;
  card: ToolExecutionRequestedPayload;
}

/** The turn fields the coworker adoption reads — the serving and the
 *  dashboard turn shapes both satisfy it. */
export interface CoworkerRequestTurn {
  id: string;
  run_id: string | null;
  pending_coworker_executions?: readonly unknown[] | null;
}

/**
 * Narrow one pending_coworker_executions item (any by contract): the
 * asker's identity plus the card in the marker's own shape, so the
 * marker narrowing above serves both askers. Malformed → null.
 */
export function coworkerExecutionRequestOf(
  value: unknown,
): CoworkerExecutionRequest | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.ordinal !== "number" ||
    typeof record.label !== "string" ||
    typeof record.child_session_id !== "string"
  ) {
    return null;
  }
  const card = executionRequestedPayloadOf(record.card);
  if (card === null) {
    return null;
  }
  return {
    ordinal: record.ordinal,
    label: record.label,
    childSessionId: record.child_session_id,
    card,
  };
}

/**
 * Narrow a tool_execution_requested CUSTOM event's wire value (any by
 * contract). Malformed payloads return null and are ignored — the
 * contract's "clients MUST ignore events and fields they do not
 * recognize".
 */
export function executionRequestedPayloadOf(
  value: unknown,
): ToolExecutionRequestedPayload | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.interrupt_id !== "string" || record.interrupt_id === "") {
    return null;
  }
  if (typeof record.tool_name !== "string") {
    return null;
  }
  const request = _requestOf(record.request);
  if (request === null) {
    return null;
  }
  return {
    interrupt_id: record.interrupt_id,
    tool_name: record.tool_name,
    tool_call_id:
      typeof record.tool_call_id === "string" ? record.tool_call_id : null,
    round: typeof record.round === "number" ? record.round : 0,
    request,
  };
}

function _requestOf(
  value: unknown,
): ToolExecutionRequestedPayload["request"] | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.kind !== "string" || record.kind === "") {
    return null;
  }
  return {
    kind: record.kind,
    intent: recordOrNull(record.intent),
    action: recordOrNull(record.action),
  };
}

export function recordOrNull(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}
