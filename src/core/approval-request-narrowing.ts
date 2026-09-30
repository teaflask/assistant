// The approval wire's narrowers: an approval_requested
// marker's value and a turn snapshot's coworker approval item, both `any`
// by contract. Malformed values return null and are ignored — the
// contract's "clients MUST ignore events and fields they do not
// recognize". A dependency-free leaf, the twin of
// execution-request-narrowing.ts.

import type { ApprovalRequestedPayload } from "../contract/events.js";
import { withoutStepCaption } from "./step-caption.js";

/** One coworker approval as the turn snapshot lists it, narrowed. */
export interface CoworkerApprovalRequest {
  ordinal: number;
  label: string;
  childSessionId: string;
  /** The coworker's own waiting execution already exited (its answer
   *  still counts — the entity restarts it); never the parent's state. */
  parked: boolean;
  card: ApprovalRequestedPayload;
}

/** The turn fields the coworker adoption reads — the serving and the
 *  dashboard turn shapes both satisfy it. A turn with no id has no door
 *  a coworker's decision could be posted to, so it lists nothing. */
export interface CoworkerApprovalTurn {
  id?: string;
  run_id: string | null;
  pending_coworker_approvals?: readonly unknown[] | null;
}

/**
 * Narrow one pending_coworker_approvals item (any by contract): the
 * asker's identity plus the card in the marker's own shape, so the
 * marker narrowing below serves both askers. Malformed → null.
 */
export function coworkerApprovalRequestOf(
  value: unknown,
): CoworkerApprovalRequest | null {
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
  const card = approvalRequestedPayloadOf(record.card);
  if (card === null) {
    return null;
  }
  return {
    ordinal: record.ordinal,
    label: record.label,
    childSessionId: record.child_session_id,
    parked: record.parked === true,
    card,
  };
}

/**
 * Narrow an approval_requested CUSTOM event's wire value (any by contract).
 * Malformed payloads return null and are ignored — the contract's "clients
 * MUST ignore events and fields they do not recognize".
 */
export function approvalRequestedPayloadOf(
  value: unknown,
): ApprovalRequestedPayload | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.interrupt_id !== "string" || record.interrupt_id === "") {
    return null;
  }
  if (typeof record.prompt !== "string") {
    return null;
  }
  return {
    interrupt_id: record.interrupt_id,
    prompt: record.prompt,
    tool_name: typeof record.tool_name === "string" ? record.tool_name : null,
    // The model's caption is the row's label, never an argument.
    tool_args: withoutStepCaption(recordOrEmpty(record.tool_args)),
    // Fail safe against an older wire: no schema means the generic card.
    tool_input_schema: recordOrNull(record.tool_input_schema),
    tool_output_schema: recordOrNull(record.tool_output_schema),
    tool_call_id:
      typeof record.tool_call_id === "string" ? record.tool_call_id : null,
    round: typeof record.round === "number" ? record.round : 0,
    // Fail safe against an older wire: no flag means no trust affordance.
    gated: record.gated === true,
    trust_available: record.trust_available === true,
  };
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}
