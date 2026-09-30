import { describe, expect, it } from "vitest";

import { failureSentenceOf } from "../src/core/turn-failure-copy";
import { settledResultOf } from "../src/core/activity";
import type { ServingAssistantTurn } from "../src/contract/threads";

// A member's own stop is a receipt on the wire, never a failure — and
// since the package projects no row for it, the whole client-side story
// is that nothing loud happens: no banner, no failure sentence.

describe("the stop's honest rendering", () => {
  it("earns no failure banner: a stop is a receipt, not an error", () => {
    expect(failureSentenceOf([_turnWith("stopped")])).toBeNull();
  });

  it("settles the activity feed with no failure sentence", () => {
    const result = settledResultOf(_turnWith("stopped"));
    expect(result).toEqual({
      turnId: "turn-1",
      status: "stopped",
      failureSentence: null,
    });
  });
});

function _turnWith(
  status: ServingAssistantTurn["status"],
): ServingAssistantTurn {
  return {
    id: "turn-1",
    thread_id: "thread-1",
    user_message: "Tell me everything about oolong.",
    kind: null,
    status,
    error: null,
    run_id: "run-1",
    pending_interrupt_ids: [],
    awaiting_round: null,
    pending_approvals: [],
    created_at: "2026-08-28T00:00:00Z",
    updated_at: "2026-08-28T00:00:00Z",
  };
}
