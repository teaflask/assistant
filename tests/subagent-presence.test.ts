// The subagent-presence derivations: the variant index is a pure function
// of durable ledger facts (replay-stable by construction), the
// current-work read only ever surfaces a genuinely live call, and the
// settled copy speaks the settled-fold register.
import { describe, expect, it } from "vitest";

import {
  coworkerIndicesOf,
  newestToolCallViewOf,
  settledWorkedLabelOf,
  sameCurrentWorkView,
} from "../src/core/subagent-presence";
import type { ToolCallRow, TranscriptRow } from "../src/core/transcript-rows";

function _dispatch(ordinal: number, childSessionId: string) {
  return { ordinal, child_session_id: childSessionId };
}

describe("coworkerIndicesOf", () => {
  it("ranks coworkers by their first ask's ordinal, 1-based", () => {
    const indices = coworkerIndicesOf([
      _dispatch(0, "child-a"),
      _dispatch(1, "child-b"),
      _dispatch(2, "child-c"),
    ]);
    expect(indices.get("child-a")).toBe(1);
    expect(indices.get("child-b")).toBe(2);
    expect(indices.get("child-c")).toBe(3);
  });

  it("is a function of the durable facts alone — permuted arrival, same map", () => {
    // Reconnect and replay deliver the same rows in whatever order the
    // poll or stream happens to yield; the color slot must not move.
    const ordered = coworkerIndicesOf([
      _dispatch(0, "child-a"),
      _dispatch(1, "child-b"),
      _dispatch(2, "child-c"),
    ]);
    const permuted = coworkerIndicesOf([
      _dispatch(2, "child-c"),
      _dispatch(0, "child-a"),
      _dispatch(1, "child-b"),
    ]);
    expect([...permuted.entries()].sort()).toEqual(
      [...ordered.entries()].sort(),
    );
  });

  it("a resume chain keeps one index — several asks of one coworker", () => {
    const indices = coworkerIndicesOf([
      _dispatch(0, "child-a"),
      _dispatch(1, "child-b"),
      // child-a asked again: a later ordinal must not mint a second
      // identity or shift child-b's.
      _dispatch(2, "child-a"),
    ]);
    expect(indices.size).toBe(2);
    expect(indices.get("child-a")).toBe(1);
    expect(indices.get("child-b")).toBe(2);
  });

  it("is empty-safe", () => {
    expect(coworkerIndicesOf([]).size).toBe(0);
  });
});

function _toolCall(
  toolCallId: string,
  state: ToolCallRow["state"],
  overrides: Partial<ToolCallRow> = {},
): ToolCallRow {
  return {
    kind: "tool-call",
    key: `tool:${toolCallId}`,
    toolCallId,
    toolName: "docs_search",
    state,
    argsText: "{}",
    offloaded: false,
    ...overrides,
  };
}

describe("newestToolCallViewOf", () => {
  it("returns the newest live call", () => {
    const rows: TranscriptRow[] = [
      _toolCall("t1", "output-available"),
      _toolCall("t2", "input-available", { toolName: "read_file" }),
    ];
    const view = newestToolCallViewOf(rows);
    expect(view?.toolName).toBe("read_file");
    expect(view?.state).toBe("input-available");
  });

  it("a settled newer row never blanks an older call still live — parallel calls are normal", () => {
    // Rows sit in TOOL_CALL_START order while results land in
    // COMPLETION order (round 3): a child that issued read_file then
    // bash, with bash returning first, is still working read_file — the
    // line must not flicker off.
    const rows: TranscriptRow[] = [
      _toolCall("t1", "input-available", { toolName: "read_file" }),
      _toolCall("t2", "output-available"),
    ];
    const view = newestToolCallViewOf(rows);
    expect(view?.toolName).toBe("read_file");
  });

  it("returns null only when NO call is live — between operations, no invented work", () => {
    const rows: TranscriptRow[] = [
      _toolCall("t1", "output-available"),
      _toolCall("t2", "output-available"),
    ];
    expect(newestToolCallViewOf(rows)).toBeNull();
  });

  it("never surfaces input-streaming — in this package it is a replayed dead call, not a live one", () => {
    expect(
      newestToolCallViewOf([_toolCall("t1", "input-streaming")]),
    ).toBeNull();
  });

  it("is empty-safe, prose-safe, and reads past trailing prose to no stale call", () => {
    expect(newestToolCallViewOf([])).toBeNull();
    const proseAfterSettledCall: TranscriptRow[] = [
      _toolCall("t1", "output-available"),
      { kind: "assistant-text", key: "m1", text: "Done.", streaming: false },
    ];
    expect(newestToolCallViewOf(proseAfterSettledCall)).toBeNull();
  });
});

describe("settledWorkedLabelOf", () => {
  it("is null while the child runs", () => {
    expect(settledWorkedLabelOf("2026-08-21T10:00:00Z", null)).toBeNull();
  });

  it("speaks the settled-fold register", () => {
    expect(
      settledWorkedLabelOf("2026-08-21T10:00:00Z", "2026-08-21T10:00:41Z"),
    ).toBe("Worked for 41s");
    expect(
      settledWorkedLabelOf("2026-08-21T10:00:00Z", "2026-08-21T10:03:04Z"),
    ).toBe("Worked for 3m 04s");
  });

  it("a sub-second span reads '<1s' — 'Worked for 0s' is not in the register", () => {
    expect(
      settledWorkedLabelOf(
        "2026-08-21T10:00:00.000Z",
        "2026-08-21T10:00:00.400Z",
      ),
    ).toBe("Worked for <1s");
    // Clock skew clamps to zero — a real measured span, never "0s".
    expect(
      settledWorkedLabelOf("2026-08-21T10:00:41Z", "2026-08-21T10:00:00Z"),
    ).toBe("Worked for <1s");
  });

  it("refuses garbage timestamps — hidden, never invented", () => {
    expect(
      settledWorkedLabelOf("not a date", "2026-08-21T10:00:00Z"),
    ).toBeNull();
    expect(settledWorkedLabelOf("2026-08-21T10:00:00Z", "junk")).toBeNull();
  });
});

describe("sameCurrentWorkView reads every label-bearing field", () => {
  it("two views differing only in the model's caption are not the same evidence", () => {
    const view = (caption?: string) => ({
      toolName: "sandbox_bash",
      state: "input-available" as const,
      input: "{}",
      display: { caption, progressText: "Running a command…" },
    });
    expect(sameCurrentWorkView(view("Checking"), view("Checking"))).toBe(true);
    expect(sameCurrentWorkView(view("Checking"), view("Installing"))).toBe(
      false,
    );
    expect(sameCurrentWorkView(view("Checking"), view(undefined))).toBe(false);
  });
});
