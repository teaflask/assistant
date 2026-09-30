import { describe, expect, it } from "vitest";

import type { Message } from "@ag-ui/core";

import type { MarkerAnchorsSnapshot } from "../src/core/connection-epoch";
import {
  trailingRowIsStreaming,
  transcriptRowsOf,
  withPendingUserEcho,
} from "../src/core/transcript-rows";

function anchorsOf(
  overrides: Partial<MarkerAnchorsSnapshot> = {},
): MarkerAnchorsSnapshot {
  return {
    resumeAnchors: new Map(),
    turnFailedAnchors: new Map(),
    subagentDeliveryAnchors: new Map(),
    toolRefusalAnchors: new Map(),
    toolErrorAnchors: new Map(),
    toolCancelAnchors: new Set(),
    toolOffloadAnchors: new Set(),
    toolDenialAnchors: new Set(),
    toolCallDisplayAnchors: new Map(),
    toolSchemaAnchors: new Map(),
    blockTimingAnchors: new Map(),
    turnUsageAnchors: new Map(),
    memoryProvenanceAnchors: new Map(),
    memoryAttributionAnchors: new Map(),
    ...overrides,
  };
}

const A_CONVERSATION: Message[] = [
  { id: "u1", role: "user", content: "How do I steep sencha?" },
  {
    id: "a1",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "t1",
        type: "function",
        function: { name: "docs_search", arguments: '{"query":"sencha"}' },
      },
    ],
  },
  { id: "r1", role: "tool", toolCallId: "t1", content: "[steeping] 80°C" },
  { id: "a2", role: "assistant", content: "Use 80°C water." },
];

describe("transcriptRowsOf — the interleave", () => {
  it("places an optimistic user message at the transcript tail", () => {
    const rows = transcriptRowsOf(A_CONVERSATION, anchorsOf(), false);
    const displayed = withPendingUserEcho(rows, {
      messageId: "optimistic-user-1",
      text: "One more question",
      attachments: [],
    });

    expect(displayed.at(-1)).toEqual({
      kind: "user",
      key: "optimistic-user-1",
      text: "One more question",
      attachments: [],
      optimistic: true,
    });
  });

  it("lets the replayed user row replace its stable-id optimistic echo in place", () => {
    const rows = transcriptRowsOf(
      [{ id: "user:turn-1", role: "user", content: "Already replayed" }],
      anchorsOf(),
      false,
    );

    const displayed = withPendingUserEcho(rows, {
      messageId: "user:turn-1",
      text: "Already replayed",
      attachments: [],
    });

    expect(displayed).toBe(rows);
    expect(displayed).toHaveLength(1);
    expect(displayed[0]).not.toHaveProperty("optimistic");
  });

  it("renders user, tool (with its matched result), and assistant rows in message order", () => {
    const rows = transcriptRowsOf(A_CONVERSATION, anchorsOf(), false);

    expect(rows.map((row) => row.kind)).toEqual([
      "user",
      "tool-call",
      "assistant-text",
    ]);
    const tool = rows[1];
    if (tool.kind !== "tool-call") {
      throw new Error("expected a tool row");
    }
    expect(tool.toolName).toBe("docs_search");
    expect(tool.result).toBe("[steeping] 80°C");
    expect(tool.state).toBe("output-available");
  });

  it("marks only the NEWEST assistant text as streaming while the run is live", () => {
    const rows = transcriptRowsOf(
      [
        ...A_CONVERSATION,
        { id: "a3", role: "assistant", content: "Then decant" },
      ],
      anchorsOf(),
      true,
    );

    const texts = rows.filter((row) => row.kind === "assistant-text");
    expect(texts.map((row) => row.streaming)).toEqual([false, true]);
  });

  it("shows a resultless call as running while the run streams, pending once it stops", () => {
    const withoutResult = A_CONVERSATION.filter(
      (message) => message.id !== "r1",
    );
    const live = transcriptRowsOf(withoutResult, anchorsOf(), true);
    const stopped = transcriptRowsOf(withoutResult, anchorsOf(), false);

    expect(live.find((row) => row.kind === "tool-call")?.state).toBe(
      "input-available",
    );
    expect(stopped.find((row) => row.kind === "tool-call")?.state).toBe(
      "input-streaming",
    );
  });

  it("marks a call output-error with its recorded error text when the anchors carry one", () => {
    const rows = transcriptRowsOf(
      A_CONVERSATION,
      anchorsOf({
        toolRefusalAnchors: new Map(),
        toolErrorAnchors: new Map([["t1", "The docs index is unreachable."]]),
      }),
      false,
    );

    const tool = rows.find((row) => row.kind === "tool-call");
    expect(tool?.state).toBe("output-error");
    expect(tool?.errorText).toBe("The docs index is unreachable.");
    // The wire form still rides along for the pane fallback.
    expect(tool?.result).toBe("[steeping] 80°C");
  });

  it("falls back to the result text when the recorded error is empty", () => {
    const rows = transcriptRowsOf(
      A_CONVERSATION,
      anchorsOf({ toolErrorAnchors: new Map([["t1", ""]]) }),
      false,
    );

    const tool = rows.find((row) => row.kind === "tool-call");
    expect(tool?.state).toBe("output-error");
    expect(tool?.errorText).toBe("[steeping] 80°C");
  });

  it("marks a call cancelled when the anchors carry its id — result present, no errorText", () => {
    const rows = transcriptRowsOf(
      A_CONVERSATION,
      anchorsOf({ toolCancelAnchors: new Set(["t1"]) }),
      false,
    );

    const tool = rows.find((row) => row.kind === "tool-call");
    expect(tool?.state).toBe("cancelled");
    expect(tool?.errorText).toBeUndefined();
    // The wire form still rides the row; the view layer keeps it off the
    // Result pane.
    expect(tool?.result).toBe("[steeping] 80°C");
  });

  it("marks a call refused when the anchors carry its sentence — result present, the reason on the row", () => {
    const rows = transcriptRowsOf(
      A_CONVERSATION,
      anchorsOf({
        toolRefusalAnchors: new Map([["t1", "Results are already waiting."]]),
      }),
      false,
    );

    const tool = rows.find((row) => row.kind === "tool-call");
    expect(tool?.state).toBe("refused");
    expect(tool?.refusalText).toBe("Results are already waiting.");
    expect(tool?.errorText).toBeUndefined();
    // The wire form (the refusal envelope) still rides the row; the view
    // layer keeps it off the Result pane.
    expect(tool?.result).toBe("[steeping] 80°C");
  });

  it("lets a recorded error or a cancel outrank a refusal, and drops the reason with the rung", () => {
    const refusal = new Map([["t1", "Results are already waiting."]]);
    const errored = transcriptRowsOf(
      A_CONVERSATION,
      anchorsOf({
        toolErrorAnchors: new Map([["t1", "It broke."]]),
        toolRefusalAnchors: refusal,
      }),
      false,
    ).find((row) => row.kind === "tool-call");
    expect(errored?.state).toBe("output-error");
    expect(errored?.refusalText).toBeUndefined();

    const cancelled = transcriptRowsOf(
      A_CONVERSATION,
      anchorsOf({
        toolCancelAnchors: new Set(["t1"]),
        toolRefusalAnchors: refusal,
      }),
      false,
    ).find((row) => row.kind === "tool-call");
    expect(cancelled?.state).toBe("cancelled");
    expect(cancelled?.refusalText).toBeUndefined();
  });

  it("marks a call denied when the denial anchors carry its id — over the wire's own cancel stamp, result present, no errorText", () => {
    // The wire's shape for a member's denial: the cancelled result IS
    // there (the receipt's `cancelled` stamp), and the denial ledger
    // names the same call.
    const rows = transcriptRowsOf(
      A_CONVERSATION,
      anchorsOf({
        toolCancelAnchors: new Set(["t1"]),
        toolDenialAnchors: new Set(["t1"]),
      }),
      false,
    );

    const tool = rows.find((row) => row.kind === "tool-call");
    expect(tool?.state).toBe("denied");
    expect(tool?.errorText).toBeUndefined();
    expect(tool?.refusalText).toBeUndefined();
    // The wire form (the cancellation sentinel) still rides the row; the
    // view layer keeps it off the Result pane.
    expect(tool?.result).toBe("[steeping] 80°C");
    // The denial marker alone — before the cancelled result lands —
    // already reads denied: the member's decision is the fact.
    const early = transcriptRowsOf(
      A_CONVERSATION.slice(0, 2),
      anchorsOf({ toolDenialAnchors: new Set(["t1"]) }),
      true,
    ).find((row) => row.kind === "tool-call");
    expect(early?.state).toBe("denied");
  });

  it("lets a recorded error outrank a denial, and a denial outrank a cancel and a refusal", () => {
    const denial = new Set(["t1"]);
    const errored = transcriptRowsOf(
      A_CONVERSATION,
      anchorsOf({
        toolErrorAnchors: new Map([["t1", "It broke."]]),
        toolCancelAnchors: new Set(["t1"]),
        toolDenialAnchors: denial,
      }),
      false,
    ).find((row) => row.kind === "tool-call");
    // A call that ran and broke is never reclassified by a later
    // decision marker.
    expect(errored?.state).toBe("output-error");
    expect(errored?.errorText).toBe("It broke.");

    // Exclusive by construction (a denied call never ran, so no door
    // answered) — but if a history ever carried both, the member's
    // decision wins and the refusal sentence drops with its rung.
    const denied = transcriptRowsOf(
      A_CONVERSATION,
      anchorsOf({
        toolRefusalAnchors: new Map([["t1", "Results are already waiting."]]),
        toolCancelAnchors: new Set(["t1"]),
        toolDenialAnchors: denial,
      }),
      false,
    ).find((row) => row.kind === "tool-call");
    expect(denied?.state).toBe("denied");
    expect(denied?.refusalText).toBeUndefined();

    // A snapshot without the optional member reads as no denials: the
    // same history falls to the wire's cancelled reading.
    const withoutMember = anchorsOf({ toolCancelAnchors: new Set(["t1"]) });
    delete withoutMember.toolDenialAnchors;
    const cancelled = transcriptRowsOf(
      A_CONVERSATION,
      withoutMember,
      false,
    ).find((row) => row.kind === "tool-call");
    expect(cancelled?.state).toBe("cancelled");
  });

  it("keeps a denied dispatch_subagent call a plain not-approved row — no child exists to group", () => {
    const rows = transcriptRowsOf(
      [
        {
          id: "a-dispatch",
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "d1",
              type: "function",
              function: { name: "dispatch_subagent", arguments: "{}" },
            },
          ],
        },
        {
          id: "r-dispatch",
          role: "tool",
          toolCallId: "d1",
          content: "CONFIRMATION_FAILED: The user declined this action.",
        },
      ],
      anchorsOf({
        toolCancelAnchors: new Set(["d1"]),
        toolDenialAnchors: new Set(["d1"]),
      }),
      false,
    );

    expect(rows.map((row) => row.kind)).toEqual(["tool-call"]);
    const [row] = rows;
    expect(row.kind === "tool-call" && row.state).toBe("denied");
  });

  it("keeps a refused dispatch_subagent call a plain declined row — no child exists to group", () => {
    const rows = transcriptRowsOf(
      [
        {
          id: "a-dispatch",
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "d1",
              type: "function",
              function: { name: "dispatch_subagent", arguments: "{}" },
            },
          ],
        },
        {
          id: "r-dispatch",
          role: "tool",
          toolCallId: "d1",
          content:
            '{"ok": false, "refused": true, "error": {"message": "Fix the brief."}}',
        },
      ],
      anchorsOf({ toolRefusalAnchors: new Map([["d1", "Fix the brief."]]) }),
      false,
    );

    expect(rows.map((row) => row.kind)).toEqual(["tool-call"]);
    const [row] = rows;
    expect(row.kind === "tool-call" && row.state).toBe("refused");
    expect(row.kind === "tool-call" && row.refusalText).toBe("Fix the brief.");
  });

  it("lets a recorded error outrank a cancel — only a tool that ran can fail", () => {
    const rows = transcriptRowsOf(
      A_CONVERSATION,
      anchorsOf({
        toolRefusalAnchors: new Map(),
        toolErrorAnchors: new Map([["t1", "It broke."]]),
        toolCancelAnchors: new Set(["t1"]),
      }),
      false,
    );

    const tool = rows.find((row) => row.kind === "tool-call");
    expect(tool?.state).toBe("output-error");
  });

  it("leaves calls without a recorded cancel untouched", () => {
    const rows = transcriptRowsOf(
      A_CONVERSATION,
      anchorsOf({ toolCancelAnchors: new Set(["some-other-call"]) }),
      false,
    );

    const tool = rows.find((row) => row.kind === "tool-call");
    expect(tool?.state).toBe("output-available");
  });

  it("marks a call offloaded when the anchors carry its id — state stays settled", () => {
    const rows = transcriptRowsOf(
      A_CONVERSATION,
      anchorsOf({ toolOffloadAnchors: new Set(["t1"]) }),
      false,
    );

    const tool = rows.find((row) => row.kind === "tool-call");
    expect(tool?.offloaded).toBe(true);
    // An offloaded call settled normally; only the Result pane's content
    // decision changes. The wire form still rides the row — the view
    // layer keeps it off the pane.
    expect(tool?.state).toBe("output-available");
    expect(tool?.result).toBe("[steeping] 80°C");
  });

  it("leaves calls without a recorded offload unstamped", () => {
    const rows = transcriptRowsOf(
      A_CONVERSATION,
      anchorsOf({ toolOffloadAnchors: new Set(["some-other-call"]) }),
      false,
    );

    const tool = rows.find((row) => row.kind === "tool-call");
    expect(tool?.offloaded).toBe(false);
  });

  it("joins the anchored display copy onto its call's row by toolCallId", () => {
    const display = {
      kind: "text" as const,
      progressText: "Searching your docs for “sencha”…",
      completeText: "Searched your docs for “sencha” — 1 result",
    };
    const rows = transcriptRowsOf(
      A_CONVERSATION,
      anchorsOf({ toolCallDisplayAnchors: new Map([["t1", display]]) }),
      false,
    );

    const tool = rows.find((row) => row.kind === "tool-call");
    expect(tool?.display).toBe(display);
  });

  it("leaves calls without an anchored display bare — the fallback ladder's case", () => {
    const rows = transcriptRowsOf(
      A_CONVERSATION,
      anchorsOf({
        toolCallDisplayAnchors: new Map([
          ["some-other-call", { kind: "text" as const, progressText: "…" }],
        ]),
      }),
      false,
    );

    const tool = rows.find((row) => row.kind === "tool-call");
    expect(tool?.display).toBeUndefined();
  });

  it("joins the anchored schemas onto its call's row by toolCallId, and leaves unanchored calls schema-less", () => {
    const schemas = {
      argsSchema: { type: "object", properties: { q: {} } },
    };
    const anchored = transcriptRowsOf(
      A_CONVERSATION,
      anchorsOf({ toolSchemaAnchors: new Map([["t1", schemas]]) }),
      false,
    ).find((row) => row.kind === "tool-call");
    // The reference rides through untouched — identity is the delivery
    // guard's change signal downstream.
    expect(anchored?.schemas).toBe(schemas);

    const bare = transcriptRowsOf(
      A_CONVERSATION,
      anchorsOf({ toolSchemaAnchors: new Map([["some-other-call", schemas]]) }),
      false,
    ).find((row) => row.kind === "tool-call");
    expect(bare?.schemas).toBeUndefined();
  });

  it("leaves calls without a recorded error untouched", () => {
    const rows = transcriptRowsOf(
      A_CONVERSATION,
      anchorsOf({
        toolRefusalAnchors: new Map(),
        toolErrorAnchors: new Map([["some-other-call", "It broke."]]),
      }),
      false,
    );

    const tool = rows.find((row) => row.kind === "tool-call");
    expect(tool?.state).toBe("output-available");
    expect(tool?.errorText).toBeUndefined();
  });

  it("reproduces the before/after marker contract around the anchored message", () => {
    // Only the turn-level failure receipt renders as a marker row now that
    // the meta-receipt class is deleted; a co-anchored resume marker
    // produces no row at all (it drives severance only).
    const rows = transcriptRowsOf(
      A_CONVERSATION,
      anchorsOf({
        resumeAnchors: new Map([["a2", { attempt: 2 }]]),
        turnFailedAnchors: new Map([
          ["a2", { before: [], after: ["The run hit an internal error."] }],
        ]),
      }),
      false,
    );

    expect(rows.map((row) => row.kind)).toEqual([
      "user",
      "tool-call",
      "assistant-text",
      "turn-failed-receipts",
    ]);
  });

  it("opens a delivery turn with its cause divider, before any prose", () => {
    // The delivery-turn shape: the delivery run's first message is
    // assistant prose — no user bubble — and the marker anchors
    // before it.
    const delivered = [
      { ordinal: 0, label: "Audit the billing exports", succeeded: true },
    ];
    const rows = transcriptRowsOf(
      [
        {
          id: "a-delivery",
          role: "assistant",
          content: "Your subagent reported back.",
        },
      ],
      anchorsOf({
        subagentDeliveryAnchors: new Map([["a-delivery", delivered]]),
      }),
      false,
    );

    expect(rows.map((row) => row.kind)).toEqual([
      "subagent-delivery",
      "assistant-text",
    ]);
    const divider = rows.find((row) => row.kind === "subagent-delivery");
    if (divider?.kind === "subagent-delivery") {
      expect(divider.results).toEqual(delivered);
    }
  });

  it("renders no row for a resume marker co-anchored with a delivery divider", () => {
    // The retry divider was deleted with the meta-receipt class: a retried
    // delivery attempt's resume marker produces no row — the delivery
    // divider (the cause of the run) is the only notice, and the resume
    // anchor's whole remaining job is severance.
    const rows = transcriptRowsOf(
      [
        {
          id: "a-delivery",
          role: "assistant",
          content: "Your subagent reported back.",
        },
      ],
      anchorsOf({
        resumeAnchors: new Map([["a-delivery", { attempt: 2 }]]),
        subagentDeliveryAnchors: new Map([
          [
            "a-delivery",
            [
              {
                ordinal: 0,
                label: "Audit the billing exports",
                succeeded: true,
              },
            ],
          ],
        ]),
      }),
      false,
    );

    expect(rows.map((row) => row.kind)).toEqual([
      "subagent-delivery",
      "assistant-text",
    ]);
  });

  it("derives no divider row from a resume anchor — round-less rows included (RULING PIN)", () => {
    // The meta-receipt deletion's pin at the row layer: a resume anchor —
    // round-carrying or pre-rollout round-less alike — produces NO transcript
    // row. Its severance effect is pinned separately (the severed
    // prior-attempt suite below); this test is the one that goes red if
    // anyone restores the divider row as a "bug fix".
    const rows = transcriptRowsOf(
      A_CONVERSATION,
      anchorsOf({
        resumeAnchors: new Map([["a2", { attempt: 2, segment: null }]]),
      }),
      false,
    );

    expect(rows.map((row) => row.kind)).toEqual([
      "user",
      "tool-call",
      "assistant-text",
    ]);
    expect(rows.map((row) => row.key)).not.toContain("a2:resume");
  });

  it("folds adjacent dispatch calls into one subagent group at their spot", () => {
    const receipt = (ordinal: number) =>
      JSON.stringify({
        outcome: "launched",
        ordinal,
        label: `Delegation ${String(ordinal)}.`,
        child_session_id: `subagent-run-${String(ordinal)}`,
        settled: null,
      });
    const call = (ordinal: number) => ({
      id: `t-${String(ordinal)}`,
      type: "function" as const,
      function: {
        name: "dispatch_subagent",
        arguments: JSON.stringify({ task: `Delegation ${String(ordinal)}.` }),
      },
    });
    // The real wire shape: every streamed call lands in its own assistant
    // message — the fold must span adjacent messages, not just one.
    const rows = transcriptRowsOf(
      [
        { id: "a1", role: "assistant", content: "Sending out coworkers." },
        { id: "a2", role: "assistant", content: "", toolCalls: [call(0)] },
        { id: "a3", role: "assistant", content: "", toolCalls: [call(1)] },
        { id: "r-0", role: "tool", toolCallId: "t-0", content: receipt(0) },
        { id: "r-1", role: "tool", toolCallId: "t-1", content: receipt(1) },
      ],
      anchorsOf(),
      true,
    );

    expect(rows.map((row) => row.kind)).toEqual([
      "assistant-text",
      "subagent-group",
    ]);
    const group = rows[1];
    if (group.kind === "subagent-group") {
      expect(group.entries).toHaveLength(2);
      expect(group.entries[0].label).toBe("Delegation 0.");
      expect(group.entries[0].running).toBe(true);
    }
  });

  it("splits delegation moments at any visible row between dispatch calls", () => {
    const call = (ordinal: number) => ({
      id: `t-${String(ordinal)}`,
      type: "function" as const,
      function: {
        name: "dispatch_subagent",
        arguments: JSON.stringify({ task: `Delegation ${String(ordinal)}.` }),
      },
    });
    const rows = transcriptRowsOf(
      [
        { id: "a1", role: "assistant", content: "", toolCalls: [call(0)] },
        { id: "a2", role: "assistant", content: "One is out." },
        { id: "a3", role: "assistant", content: "", toolCalls: [call(1)] },
      ],
      anchorsOf(),
      true,
    );

    expect(rows.map((row) => row.kind)).toEqual([
      "subagent-group",
      "assistant-text",
      "subagent-group",
    ]);
  });

  it("renders nothing standalone for tool/system messages and empty bodies", () => {
    const rows = transcriptRowsOf(
      [
        { id: "s1", role: "system", content: "system prompt" },
        { id: "u2", role: "user", content: "" },
        { id: "r9", role: "tool", toolCallId: "t9", content: "orphan result" },
      ],
      anchorsOf(),
      false,
    );

    expect(rows).toEqual([]);
  });
});

// Attempt 1 dies mid-call (no role:"tool" result for t1); the retry's
// first message a2 carries the resume anchor (stream-resume.ts anchors
// run_resumed to the first message AFTER the marker).
const A_SEVERED_ATTEMPT: Message[] = [
  { id: "u1", role: "user", content: "Summarize the refund policy." },
  {
    id: "a1",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "t1",
        type: "function",
        function: { name: "finish_with_output", arguments: "{}" },
      },
    ],
  },
  { id: "a2", role: "assistant", content: "Second attempt underway." },
];

const RETRIED = anchorsOf({
  resumeAnchors: new Map([["a2", { attempt: 2 }]]),
});

describe("transcriptRowsOf — severed prior-attempt calls", () => {
  it("TVC-037: a resultless call before the resume marker reads superseded, never running", () => {
    const live = transcriptRowsOf(A_SEVERED_ATTEMPT, RETRIED, true);
    const stopped = transcriptRowsOf(A_SEVERED_ATTEMPT, RETRIED, false);

    expect(live.find((row) => row.kind === "tool-call")?.state).toBe(
      "superseded",
    );
    expect(stopped.find((row) => row.kind === "tool-call")?.state).toBe(
      "superseded",
    );
  });

  it("keeps the current attempt's resultless call running past an earlier resume marker", () => {
    const withRetriedCall: Message[] = [
      ...A_SEVERED_ATTEMPT,
      {
        id: "a3",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "t2",
            type: "function",
            function: { name: "finish_with_output", arguments: "{}" },
          },
        ],
      },
    ];
    const rows = transcriptRowsOf(withRetriedCall, RETRIED, true);

    const states = rows
      .filter((row) => row.kind === "tool-call")
      .map((row) => row.state);
    // Strictly BEFORE the anchored message is severed; the anchored
    // message itself and everything after belong to the live attempt.
    expect(states).toEqual(["superseded", "input-available"]);
  });

  it("lets a recorded error outrank supersession — the red failed row survives a retry", () => {
    const rows = transcriptRowsOf(
      A_SEVERED_ATTEMPT,
      anchorsOf({
        resumeAnchors: new Map([["a2", { attempt: 2 }]]),
        toolRefusalAnchors: new Map(),
        toolErrorAnchors: new Map([["t1", "It broke."]]),
      }),
      true,
    );

    const tool = rows.find((row) => row.kind === "tool-call");
    expect(tool?.kind === "tool-call" ? tool.state : undefined).toBe(
      "output-error",
    );
    expect(tool?.kind === "tool-call" ? tool.errorText : undefined).toBe(
      "It broke.",
    );
  });

  it("lets a recorded cancel outrank supersession", () => {
    const rows = transcriptRowsOf(
      A_SEVERED_ATTEMPT,
      anchorsOf({
        resumeAnchors: new Map([["a2", { attempt: 2 }]]),
        toolCancelAnchors: new Set(["t1"]),
      }),
      true,
    );

    const tool = rows.find((row) => row.kind === "tool-call");
    expect(tool?.state).toBe("cancelled");
  });

  it("supersedes an earlier retry's severed call under the LAST resume marker on a second retry", () => {
    const twiceRetried: Message[] = [
      ...A_SEVERED_ATTEMPT,
      {
        id: "a3",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "t2",
            type: "function",
            function: { name: "finish_with_output", arguments: "{}" },
          },
        ],
      },
      { id: "a4", role: "assistant", content: "Third attempt underway." },
    ];
    const rows = transcriptRowsOf(
      twiceRetried,
      anchorsOf({
        resumeAnchors: new Map([
          ["a2", { attempt: 2 }],
          ["a4", { attempt: 3 }],
        ]),
      }),
      true,
    );

    const states = rows
      .filter((row) => row.kind === "tool-call")
      .map((row) => row.state);
    expect(states).toEqual(["superseded", "superseded"]);
  });

  it("scopes severance to the retry's own turn — an earlier turn's open call stays pending", () => {
    // A retry only ever re-streams the turn it belongs to, so its anchor
    // can testify nothing about an earlier turn's open call (the Stop or
    // failure shape) — that one keeps its deliberately still-pending
    // read (a failed turn's receipt row alongside owns that story). The
    // same settled history must never read differently because an
    // unrelated later turn happened to retry.
    const twoTurns: Message[] = [
      { id: "u1", role: "user", content: "First ask." },
      {
        id: "a1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "t1",
            type: "function",
            function: { name: "docs_search", arguments: "{}" },
          },
        ],
      },
      { id: "u2", role: "user", content: "Second ask." },
      {
        id: "a2",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "t2",
            type: "function",
            function: { name: "finish_with_output", arguments: "{}" },
          },
        ],
      },
      { id: "a3", role: "assistant", content: "Second attempt underway." },
    ];
    const rows = transcriptRowsOf(
      twoTurns,
      anchorsOf({ resumeAnchors: new Map([["a3", { attempt: 2 }]]) }),
      true,
    );

    const states = rows
      .filter((row) => row.kind === "tool-call")
      .map((row) => row.state);
    // t1 keeps the pre-existing pending read (input-available while any
    // run streams — deliberately outside the severance rule); only t2,
    // the retried turn's own severed call, reads superseded.
    expect(states).toEqual(["input-available", "superseded"]);
  });

  it("a retried DELIVERY turn severs only its own window — the delivery divider is its turn start", () => {
    // The machine-initiated delivery turn invokes with no new user
    // message — the mailbox speaks first — so its turn boundary is the
    // delivery divider anchored to its first message. Without that
    // boundary a delivery retry would walk back into the previous member
    // turn and flip its deliberately still-pending call.
    const memberTurnThenDelivery: Message[] = [
      { id: "u1", role: "user", content: "First ask." },
      {
        id: "a1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "t1",
            type: "function",
            function: { name: "docs_search", arguments: "{}" },
          },
        ],
      },
      { id: "d1", role: "assistant", content: "Your coworker reported back." },
      {
        id: "d2",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "t2",
            type: "function",
            function: { name: "finish_with_output", arguments: "{}" },
          },
        ],
      },
      { id: "d3", role: "assistant", content: "Second attempt underway." },
    ];
    const rows = transcriptRowsOf(
      memberTurnThenDelivery,
      anchorsOf({
        subagentDeliveryAnchors: new Map([
          ["d1", [{ ordinal: 0, label: "Scout the docs.", succeeded: true }]],
        ]),
        resumeAnchors: new Map([["d3", { attempt: 2 }]]),
      }),
      true,
    );

    const states = rows
      .filter((row) => row.kind === "tool-call")
      .map((row) => row.state);
    expect(states).toEqual(["input-available", "superseded"]);
  });

  it("a retried delivery whose divider and resume marker share one message severs nothing", () => {
    // The documented retried-delivery shape: attempt 1 died before
    // streaming, so both markers anchor to the retry's first message.
    // The boundary applies before the severance check — the safe
    // direction: a missed severance stays pending, a false one would
    // walk into the previous member turn.
    const sharedFirstMessage: Message[] = [
      { id: "u1", role: "user", content: "First ask." },
      {
        id: "a1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "t1",
            type: "function",
            function: { name: "docs_search", arguments: "{}" },
          },
        ],
      },
      { id: "d1", role: "assistant", content: "Your coworker reported back." },
    ];
    const rows = transcriptRowsOf(
      sharedFirstMessage,
      anchorsOf({
        subagentDeliveryAnchors: new Map([
          ["d1", [{ ordinal: 0, label: "Scout the docs.", succeeded: true }]],
        ]),
        resumeAnchors: new Map([["d1", { attempt: 2 }]]),
      }),
      true,
    );

    expect(rows.find((row) => row.kind === "tool-call")?.state).toBe(
      "input-available",
    );
  });

  it("a legacy payload-less anchor severs — the retry meaning is the fallback, the marker family's posture", () => {
    // RULING PIN: every resume anchor severs since segment's retirement
    // — pre-rollout shapes (payload-less, or round-less rows served
    // verbatim by the identity projection) included. Passed pre-fix
    // too; what it pins is the shape surviving the classifier's
    // deletion.
    const rows = transcriptRowsOf(
      A_SEVERED_ATTEMPT,
      anchorsOf({ resumeAnchors: new Map([["a2", null]]) }),
      true,
    );

    expect(rows.find((row) => row.kind === "tool-call")?.state).toBe(
      "superseded",
    );
  });

  it("settles a severed dispatch call as cancelled — the group must not read Working forever", () => {
    // The dispatch tool answers immediately (its receipt is the launch
    // acknowledgment), so a resultless dispatch row is only ever the
    // severed shape — and with no receipt there is no ordinal for the
    // ledger join to correct the entry.
    const severedDispatch: Message[] = [
      {
        id: "a1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "t1",
            type: "function",
            function: {
              name: "dispatch_subagent",
              arguments: JSON.stringify({ task: "Scout the refund docs." }),
            },
          },
        ],
      },
      { id: "a2", role: "assistant", content: "Second attempt underway." },
    ];
    const rows = transcriptRowsOf(severedDispatch, RETRIED, true);

    const group = rows.find((row) => row.kind === "subagent-group");
    if (group?.kind !== "subagent-group") {
      throw new Error("expected a subagent group row");
    }
    expect(group.entries[0].running).toBe(false);
    expect(group.entries[0].cancelled).toBe(true);
    expect(group.entries[0].failed).toBe(false);
  });

  it("keeps a settled prior-attempt call settled — only open calls are severed", () => {
    const withResult: Message[] = [
      A_SEVERED_ATTEMPT[0],
      A_SEVERED_ATTEMPT[1],
      { id: "r1", role: "tool", toolCallId: "t1", content: "All done." },
      A_SEVERED_ATTEMPT[2],
    ];
    const rows = transcriptRowsOf(withResult, RETRIED, true);

    const tool = rows.find((row) => row.kind === "tool-call");
    expect(tool?.state).toBe("output-available");
  });
});

describe("transcriptRowsOf — reasoning", () => {
  const REASONING: Message = {
    id: "th1",
    role: "reasoning",
    content: "The member wants steeping guidance; check the docs first.",
  };

  it("renders a reasoning row in message order", () => {
    const rows = transcriptRowsOf(
      [A_CONVERSATION[0], REASONING, ...A_CONVERSATION.slice(1)],
      anchorsOf(),
      false,
    );

    expect(rows.map((row) => row.kind)).toEqual([
      "user",
      "reasoning",
      "tool-call",
      "assistant-text",
    ]);
    const reasoning = rows[1];
    if (reasoning.kind !== "reasoning") {
      throw new Error("expected a reasoning row");
    }
    expect(reasoning.text).toContain("steeping guidance");
    expect(reasoning.streaming).toBe(false);
  });

  it("streams only while live AND newest — the next message closes the window", () => {
    const liveAndNewest = transcriptRowsOf(
      [A_CONVERSATION[0], REASONING],
      anchorsOf(),
      true,
    );
    const liveButFollowed = transcriptRowsOf(
      [A_CONVERSATION[0], REASONING, ...A_CONVERSATION.slice(1)],
      anchorsOf(),
      true,
    );
    const settled = transcriptRowsOf(
      [A_CONVERSATION[0], REASONING],
      anchorsOf(),
      false,
    );

    const streamingOf = (rows: ReturnType<typeof transcriptRowsOf>) =>
      rows.find((row) => row.kind === "reasoning")?.streaming;
    expect(streamingOf(liveAndNewest)).toBe(true);
    expect(streamingOf(liveButFollowed)).toBe(false);
    expect(streamingOf(settled)).toBe(false);
  });

  it("renders nothing for an empty reasoning body", () => {
    const rows = transcriptRowsOf(
      [{ id: "th2", role: "reasoning", content: "" }],
      anchorsOf(),
      true,
    );

    expect(rows).toEqual([]);
  });
});

describe("trailingRowIsStreaming — the typing-dot window", () => {
  it("is true under a trailing streaming reasoning row or assistant text", () => {
    const reasoningTrailing = transcriptRowsOf(
      [A_CONVERSATION[0], { id: "th1", role: "reasoning", content: "hmm" }],
      anchorsOf(),
      true,
    );
    const textTrailing = transcriptRowsOf(A_CONVERSATION, anchorsOf(), true);

    expect(trailingRowIsStreaming(reasoningTrailing)).toBe(true);
    expect(trailingRowIsStreaming(textTrailing)).toBe(true);
  });

  it("is false over settled rows, trailing tool calls, and an empty transcript", () => {
    const settled = transcriptRowsOf(A_CONVERSATION, anchorsOf(), false);
    const toolTrailing = transcriptRowsOf(
      A_CONVERSATION.slice(0, 3),
      anchorsOf(),
      true,
    );

    expect(trailingRowIsStreaming(settled)).toBe(false);
    expect(trailingRowIsStreaming(toolTrailing)).toBe(false);
    expect(trailingRowIsStreaming([])).toBe(false);
  });
});

describe("transcriptRowsOf — attachments", () => {
  const AN_IMAGE = {
    id: "att-1",
    kind: "image" as const,
    format: "png",
    filename: "cat.png",
    byte_size: 72,
  };

  it("hands a user row its turn's attachments from the side table", () => {
    const rows = transcriptRowsOf(
      [{ id: "user:t1", role: "user", content: "what is this?" }],
      anchorsOf(),
      false,
      new Map([
        [
          "user:t1",
          { attachments: [AN_IMAGE], createdAt: "2026-09-07T19:19:00Z" },
        ],
      ]),
    );
    const user = rows[0];
    if (user.kind !== "user") {
      throw new Error("expected a user row");
    }
    expect(user.attachments).toEqual([AN_IMAGE]);
    // The turn's created_at rides the same side table: the
    // bubble's one honest clock, never a client's.
    expect(user.createdAt).toBe("2026-09-07T19:19:00Z");
  });

  it("leaves createdAt absent when the host passes no meta — no stamp is invented", () => {
    const rows = transcriptRowsOf(
      [{ id: "user:t1", role: "user", content: "what is this?" }],
      anchorsOf(),
      false,
    );
    const user = rows[0];
    if (user.kind !== "user") {
      throw new Error("expected a user row");
    }
    expect("createdAt" in user).toBe(false);
  });

  it("keeps an attachment-only turn (empty text) in the transcript", () => {
    const rows = transcriptRowsOf(
      [{ id: "user:t1", role: "user", content: "" }],
      anchorsOf(),
      false,
      new Map([
        [
          "user:t1",
          { attachments: [AN_IMAGE], createdAt: "2026-09-07T19:19:00Z" },
        ],
      ]),
    );
    expect(rows.map((row) => row.kind)).toEqual(["user"]);
  });

  it("still drops a genuinely empty user message", () => {
    const rows = transcriptRowsOf(
      [{ id: "user:t1", role: "user", content: "" }],
      anchorsOf(),
      false,
    );
    expect(rows).toEqual([]);
  });
});

describe("transcriptRowsOf — block timing", () => {
  it("joins timing by toolCallId for tool calls and messageId for reasoning; absent anchors leave timing undefined", () => {
    const rows = transcriptRowsOf(
      [
        { id: "th1", role: "reasoning", content: "Thinking." },
        {
          id: "a1",
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "t1",
              type: "function",
              function: { name: "docs_search", arguments: "{}" },
            },
            {
              id: "t2",
              type: "function",
              function: { name: "read_page", arguments: "{}" },
            },
          ],
        },
      ],
      anchorsOf({
        blockTimingAnchors: new Map([
          ["th1", { startedAtMs: 1_000, settledAtMs: 2_000 }],
          ["t1", { startedAtMs: 2_000, settledAtMs: 9_500 }],
        ]),
      }),
      false,
    );
    const [reasoning, first, second] = rows;
    expect(
      reasoning.kind === "reasoning" ? reasoning.timing : undefined,
    ).toEqual({ startedAtMs: 1_000, settledAtMs: 2_000 });
    expect(first.kind === "tool-call" ? first.timing : undefined).toEqual({
      startedAtMs: 2_000,
      settledAtMs: 9_500,
    });
    expect(
      second.kind === "tool-call" ? second.timing : undefined,
    ).toBeUndefined();
  });
});
