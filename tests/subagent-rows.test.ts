// The shared grouping module's laws — the sole home of these cases: adjacent
// dispatch calls fold into one group, anything between them splits the
// moment, and the receipt parser never throws — failure sentences, garbage,
// and truncated receipts all degrade to readable rows.
import { describe, expect, it } from "vitest";

import {
  DISPATCH_SUBAGENT_TOOL_NAME,
  dispatchReceiptOf,
  dispatchedTaskOf,
  taskExcerptOf,
  withSubagentGroups,
  type DispatchCall,
  type DispatchReceipt,
  type SubagentGroupEntry,
  type SubagentGroupRow,
} from "../src/core/subagent-rows";

interface FakeRow {
  kind: string;
  key: string;
  name?: string;
  call?: DispatchCall;
}

function _dispatchRow(key: string, call: Partial<DispatchCall>): FakeRow {
  return {
    kind: "tool-call",
    key,
    name: DISPATCH_SUBAGENT_TOOL_NAME,
    call: {
      toolCallId: key,
      settled: true,
      failed: false,
      cancelled: false,
      result: undefined,
      errorText: undefined,
      argsText: "{}",
      ...call,
    },
  };
}

function _asDispatchCall(row: FakeRow): DispatchCall | null {
  return row.name === DISPATCH_SUBAGENT_TOOL_NAME ? (row.call ?? null) : null;
}

function _receiptJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    outcome: "launched",
    ordinal: 0,
    label: "Survey the corpus.",
    child_session_id: "subagent-run-0",
    settled: null,
    ...overrides,
  });
}

describe("withSubagentGroups", () => {
  it("folds adjacent dispatch calls into one group and leaves neighbors alone", () => {
    const rows: FakeRow[] = [
      { kind: "assistant-text", key: "text-1" },
      _dispatchRow("d-1", { result: _receiptJson({ ordinal: 0 }) }),
      _dispatchRow("d-2", { result: _receiptJson({ ordinal: 1 }) }),
      { kind: "tool-call", key: "other", name: "read_page" },
    ];

    const grouped = withSubagentGroups(rows, _asDispatchCall, (row) => row.key);

    expect(grouped.map((row) => row.kind)).toEqual([
      "assistant-text",
      "subagent-group",
      "tool-call",
    ]);
    const group = grouped[1] as SubagentGroupRow;
    expect(group.key).toBe("subagents:d-1");
    expect(group.entries).toHaveLength(2);
    expect(group.entries[0].label).toBe("Survey the corpus.");
  });

  it("splits dispatches separated by another row into two honest moments", () => {
    const rows: FakeRow[] = [
      _dispatchRow("d-1", { result: _receiptJson() }),
      { kind: "assistant-text", key: "text-1" },
      _dispatchRow("d-2", { result: _receiptJson({ ordinal: 1 }) }),
    ];

    const grouped = withSubagentGroups(rows, _asDispatchCall, (row) => row.key);

    expect(grouped.map((row) => row.kind)).toEqual([
      "subagent-group",
      "assistant-text",
      "subagent-group",
    ]);
  });

  it("reads a launched receipt as a running child even though the call settled", () => {
    const rows = [_dispatchRow("d-1", { result: _receiptJson() })];

    const [group] = withSubagentGroups(rows, _asDispatchCall, (row) => row.key);

    const entry = (group as SubagentGroupRow).entries[0];
    expect(entry.running).toBe(true);
    expect(entry.receipt?.childSessionId).toBe("subagent-run-0");
  });

  it("reads an already-settled failed receipt as a failed, finished child", () => {
    const rows = [
      _dispatchRow("d-1", {
        result: _receiptJson({
          outcome: "already_settled",
          settled: { status: "failed", note: "Ran out of context." },
        }),
      }),
    ];

    const [group] = withSubagentGroups(rows, _asDispatchCall, (row) => row.key);

    const entry = (group as SubagentGroupRow).entries[0];
    expect(entry.running).toBe(false);
    expect(entry.failed).toBe(true);
  });

  it("labels a still-streaming dispatch from its task args and reads it as running", () => {
    const rows = [
      _dispatchRow("d-1", {
        settled: false,
        argsText: '{"task": "Map   the auth\\nflows everywhere."}',
      }),
    ];

    const [group] = withSubagentGroups(rows, _asDispatchCall, (row) => row.key);

    const entry = (group as SubagentGroupRow).entries[0];
    expect(entry.label).toBe("Map the auth flows everywhere.");
    expect(entry.running).toBe(true);
    expect(entry.receipt).toBeNull();
  });

  it("marks a failed dispatch (a dispatcher failure's sentence) and carries it as the note", () => {
    // A `failed` DispatchCall is a genuine dispatcher failure — a door
    // REFUSAL never reaches this module: the projection keeps a
    // refused dispatch out of the grouping (no child exists).
    const rows = [
      _dispatchRow("d-1", {
        failed: true,
        result: "The slot at ordinal 0 was already taken by different work.",
        errorText: "The slot at ordinal 0 was already taken by different work.",
      }),
    ];

    const [group] = withSubagentGroups(rows, _asDispatchCall, (row) => row.key);

    const entry: SubagentGroupEntry = (group as SubagentGroupRow).entries[0];
    expect(entry.failed).toBe(true);
    expect(entry.running).toBe(false);
    expect(entry.receipt).toBeNull();
    // The failure's only explanation is the wire's failure sentence —
    // folding the tool row into a group must not drop it.
    expect(entry.note).toBe(
      "The slot at ordinal 0 was already taken by different work.",
    );
  });

  it("carries a settled receipt's note and never a healthy call's errorText", () => {
    const rows = [
      _dispatchRow("d-1", {
        result: _receiptJson({
          outcome: "already_settled",
          settled: { status: "failed", note: "Ran out of context." },
        }),
        errorText: undefined,
      }),
    ];

    const [group] = withSubagentGroups(rows, _asDispatchCall, (row) => row.key);

    expect((group as SubagentGroupRow).entries[0].note).toBe(
      "Ran out of context.",
    );
  });

  it("reads a truncated already-settled receipt as settled, never running", () => {
    // The exact shape the backend documents as truncating: an
    // already_settled receipt whose long label and note overrun the clip,
    // losing settled and child_session_id. The outcome alone says the
    // child settled — the row must not spin forever.
    const full = _receiptJson({
      outcome: "already_settled",
      label: "x".repeat(300),
      settled: { status: "failed", note: "Ran out of context." },
    });
    const rows = [_dispatchRow("d-1", { result: full.slice(0, 200) })];

    const [group] = withSubagentGroups(rows, _asDispatchCall, (row) => row.key);

    const entry = (group as SubagentGroupRow).entries[0];
    expect(entry.receipt?.outcome).toBe("already_settled");
    expect(entry.receipt?.settled).toBeNull();
    expect(entry.running).toBe(false);
  });

  it("falls back to the task text when a truncated receipt lost its label", () => {
    // Clipped before the label survives: the prefix parse yields "" and
    // the row must fall through to the streamed args, never render blank.
    const truncated = _receiptJson().slice(0, 34);
    const rows = [
      _dispatchRow("d-1", {
        result: truncated,
        argsText: JSON.stringify({ task: "Survey the corpus." }),
      }),
    ];

    const [group] = withSubagentGroups(rows, _asDispatchCall, (row) => row.key);

    const entry = (group as SubagentGroupRow).entries[0];
    expect(entry.receipt).not.toBeNull();
    expect(entry.label).toBe("Survey the corpus.");
  });
});

describe("dispatchReceiptOf", () => {
  it("parses the wire receipt verbatim", () => {
    const receipt: DispatchReceipt | null = dispatchReceiptOf(_receiptJson());

    expect(receipt).toEqual({
      outcome: "launched",
      ordinal: 0,
      label: "Survey the corpus.",
      childSessionId: "subagent-run-0",
      settled: null,
    });
  });

  it("recovers outcome, ordinal, and label from a truncated receipt prefix", () => {
    const truncated = _receiptJson({
      label: "A very long label about billing \\ and auth",
    }).slice(0, 58);

    const receipt = dispatchReceiptOf(truncated);

    expect(receipt).not.toBeNull();
    expect(receipt?.outcome).toBe("launched");
    expect(receipt?.ordinal).toBe(0);
    expect(receipt?.childSessionId).toBeNull();
  });

  it("treats prototype-chain status words as unrecognized, not settled", () => {
    // The lookup table is a plain object: without an own-key guard,
    // settled.status "constructor" reads a truthy inherited value and the
    // entry would parse as settled-and-not-failed.
    const receipt = dispatchReceiptOf(
      _receiptJson({ settled: { status: "constructor", note: "x" } }),
    );

    expect(receipt).not.toBeNull();
    expect(receipt?.settled).toBeNull();
  });

  it("answers null for failure sentences and garbage", () => {
    expect(
      dispatchReceiptOf("Dispatch failed: the workspace is gone."),
    ).toBeNull();
    expect(dispatchReceiptOf('{"outcome":"exploded"}')).toBeNull();
    expect(dispatchReceiptOf(undefined)).toBeNull();
    expect(dispatchReceiptOf("")).toBeNull();
  });
});

describe("taskExcerptOf", () => {
  it("reads a partial task string out of mid-stream args", () => {
    expect(taskExcerptOf('{"task": "Survey the bil')).toBe("Survey the bil");
  });

  it("clips to the ledger's excerpt bound", () => {
    const task = "x".repeat(400);
    expect(taskExcerptOf(JSON.stringify({ task }))).toHaveLength(200);
  });

  it("answers null when no task is readable", () => {
    expect(taskExcerptOf("{}")).toBeNull();
    expect(taskExcerptOf('{"output_schema": {}}')).toBeNull();
    expect(taskExcerptOf("")).toBeNull();
  });
});

describe("dispatchedTaskOf", () => {
  it("returns the task exactly as dispatched, unclipped and uncollapsed", () => {
    const task = `Survey the billing docs.\n\n${"x".repeat(400)}`;
    expect(dispatchedTaskOf(JSON.stringify({ task }))).toBe(task);
  });

  it("reads a partial task string out of mid-stream args", () => {
    expect(dispatchedTaskOf('{"task": "Survey\\nthe bil')).toBe(
      "Survey\nthe bil",
    );
  });

  it("answers null when no task is readable", () => {
    expect(dispatchedTaskOf("{}")).toBeNull();
    expect(dispatchedTaskOf("null")).toBeNull();
    expect(dispatchedTaskOf("")).toBeNull();
  });
});
