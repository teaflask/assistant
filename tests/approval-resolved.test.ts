import { describe, expect, it } from "vitest";

import { approvalResolvedPayloadOf } from "../src/core/approval-resolved";

// The narrower copies only what its consumers read: the approval inbox
// and the denial ledger take interruptId/approved; the dashboard's
// audit receipt row (a consumer through ./transcript) renders feedback
// and resolvedBy too, so those ride as optional fields — present when
// the wire sent strings, absent when it sent null or nothing (the
// premise is stated in the module header).

describe("approvalResolvedPayloadOf", () => {
  it("narrows the wire payload, snake to camel — the two required fields and the two the receipt row renders", () => {
    expect(
      approvalResolvedPayloadOf({
        interrupt_id: "v1:before_tool_call:t1:handler",
        approved: false,
        feedback: "Never store card numbers.",
        resolved_by: "member:6c5c0b32-0000-4000-a000-000000000031",
      }),
    ).toEqual({
      interruptId: "v1:before_tool_call:t1:handler",
      approved: false,
      feedback: "Never store card numbers.",
      resolvedBy: "member:6c5c0b32-0000-4000-a000-000000000031",
    });
  });

  it("narrows a minimal payload — the optional wire fields absent or null read as absent", () => {
    expect(
      approvalResolvedPayloadOf({ interrupt_id: "v1:x", approved: true }),
    ).toEqual({ interruptId: "v1:x", approved: true });
    expect(
      approvalResolvedPayloadOf({
        interrupt_id: "v1:x",
        approved: true,
        feedback: null,
        resolved_by: null,
      }),
    ).toEqual({ interruptId: "v1:x", approved: true });
  });

  it("rejects malformed payloads instead of throwing", () => {
    expect(approvalResolvedPayloadOf(null)).toBeNull();
    expect(approvalResolvedPayloadOf("approved")).toBeNull();
    expect(approvalResolvedPayloadOf({ approved: true })).toBeNull();
    expect(
      approvalResolvedPayloadOf({ interrupt_id: "v1:x", approved: "yes" }),
    ).toBeNull();
  });
});
