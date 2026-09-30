// The approval_resolved payload narrower, pure of React. THE PREMISE,
// stated: the WIRE contract is unchanged — the server records and serves
// approval_resolved markers carrying interrupt_id, approved, feedback,
// and resolved_by. This module is the CLIENT-SIDE narrower, and a
// narrower copies only the fields something renders or decides on.
// The three consumers: the approval inbox (approvalInboxRecorder →
// noteApprovalResolved) and the denial ledger (tool-denial-anchors.ts)
// read exactly interruptId and approved; the dashboard's audit receipt
// row, which imports this narrower through ./transcript, renders
// feedback and resolvedBy too — so those ride as optional fields,
// present only when the wire sent strings. Extra wire fields are
// ignored by construction (the narrower
// reads named keys off the payload); narrowing returns null only on a
// missing/mistyped interrupt_id or approved, so a server sending a richer
// payload can neither throw nor drop an event here. (The anchoring half
// this module once carried — recorder, anchor maps, receipt sentences —
// went with the deleted meta-receipt rows; the file lost the "-anchors"
// name with it.)

import type { ApprovalResolvedPayload } from "../contract/events.js";

export interface ApprovalResolved {
  interruptId: string;
  approved: boolean;
  feedback?: string;
  /** A prefixed actor handle ("member:<uuid>" / "eu:<id>"); absent for anonymous visitors. */
  resolvedBy?: string;
}

export function approvalResolvedPayloadOf(
  value: unknown,
): ApprovalResolved | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const payload = value as Partial<ApprovalResolvedPayload>;
  if (
    typeof payload.interrupt_id !== "string" ||
    typeof payload.approved !== "boolean"
  ) {
    return null;
  }
  return {
    interruptId: payload.interrupt_id,
    approved: payload.approved,
    // The optional fields may arrive as null or be absent entirely —
    // the stored payload keeps whatever the marker model dumped.
    feedback:
      typeof payload.feedback === "string" ? payload.feedback : undefined,
    resolvedBy:
      typeof payload.resolved_by === "string" ? payload.resolved_by : undefined,
  };
}
