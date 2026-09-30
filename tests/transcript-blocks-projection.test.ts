import { describe, expect, it } from "vitest";

import type { Message } from "@ag-ui/core";

import type { MarkerAnchorsSnapshot } from "../src/core/connection-epoch";
import { foldedBlocksOf, runFoldsOf } from "../src/core/run-folds";
import { DISPATCH_SUBAGENT_TOOL_NAME } from "../src/core/subagent-rows";
import {
  transcriptBlocksOf,
  transcriptRowsOf,
  type TranscriptBlock,
  type TranscriptRow,
} from "../src/core/transcript-rows";

// The block projection: the per-message-id shape of the flat
// derivation, for hosts that render their own marker rows around each
// message (AssistantTranscript's agent mode). These are the laws the
// dashboard's transcript-blocks.ts carried before the lift deleted it —
// re-established here against the package walk.

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
    toolCallDisplayAnchors: new Map(),
    toolSchemaAnchors: new Map(),
    blockTimingAnchors: new Map(),
    turnUsageAnchors: new Map(),
    memoryProvenanceAnchors: new Map(),
    memoryAttributionAnchors: new Map(),
    ...overrides,
  };
}

function userMessage(id: string, content: string): Message {
  return { id, role: "user", content };
}

function assistantText(id: string, content: string): Message {
  return { id, role: "assistant", content };
}

function toolCallMessage(
  id: string,
  toolCallId: string,
  name: string,
  args = "{}",
): Message {
  return {
    id,
    role: "assistant",
    content: "",
    toolCalls: [
      { id: toolCallId, type: "function", function: { name, arguments: args } },
    ],
  };
}

function toolResult(id: string, toolCallId: string, content: string): Message {
  return { id, role: "tool", toolCallId, content };
}

function flattened(blocks: readonly TranscriptBlock[]): TranscriptRow[] {
  return blocks.flatMap((block) => block.rows);
}

const A_WORKED_TURN: Message[] = [
  userMessage("u1", "How do I steep sencha?"),
  toolCallMessage("a1", "t1", "docs_search", '{"query":"sencha"}'),
  toolResult("r1", "t1", "[steeping] 80°C"),
  assistantText("a2", "Use 80°C water."),
];

describe("transcriptBlocksOf — the block shape", () => {
  it("emits one block per message id, row-less messages included", () => {
    const blocks = transcriptBlocksOf(A_WORKED_TURN, anchorsOf(), false);
    expect(blocks.map((block) => block.messageId)).toEqual([
      "u1",
      "a1",
      "r1",
      "a2",
    ]);
    // The tool-result message renders no rows of its own but keeps its
    // block: marker composites anchor to "the newest message id", which
    // can be any of them.
    expect(blocks[2].rows).toEqual([]);
  });

  it("is deterministic: the same history yields the same blocks (law 9)", () => {
    const anchors = anchorsOf({
      toolErrorAnchors: new Map([["t1", "boom"]]),
      subagentDeliveryAnchors: new Map([["a2", []]]),
    });
    const options = {
      markerBoundaries: { before: new Set(["a2"]), after: new Set<string>() },
    };
    const first = transcriptBlocksOf(
      A_WORKED_TURN,
      anchors,
      true,
      undefined,
      options,
    );
    const second = transcriptBlocksOf(
      A_WORKED_TURN,
      anchors,
      true,
      undefined,
      options,
    );
    expect(second).toEqual(first);
  });

  it("flattens to the flat projection on a duplicate-free history with empty boundaries", () => {
    const messages: Message[] = [
      ...A_WORKED_TURN,
      // Adjacent single-call dispatch messages — the grouping walk's
      // cross-message merge must match the flat pass's.
      toolCallMessage("d1", "s1", DISPATCH_SUBAGENT_TOOL_NAME, '{"task":"a"}'),
      toolCallMessage("d2", "s2", DISPATCH_SUBAGENT_TOOL_NAME, '{"task":"b"}'),
      assistantText("a3", "Dispatched."),
    ];
    const anchors = anchorsOf({
      toolErrorAnchors: new Map([["t1", "boom"]]),
      turnFailedAnchors: new Map([
        ["a3", { before: [], after: ["The turn failed."] }],
      ]),
      subagentDeliveryAnchors: new Map([
        ["a2", [{ ordinal: 1, label: "Audit the docs", succeeded: true }]],
      ]),
    });
    const flat = transcriptRowsOf(messages, anchors, true);
    const blocks = transcriptBlocksOf(messages, anchors, true);
    expect(flattened(blocks)).toEqual(flat);
  });

  it("dedupes replayed ids: first-seen position, later content wins, assistant recovery", () => {
    const messages: Message[] = [
      userMessage("u1", "first"),
      assistantText("a1", "streamed prefix"),
      // A reconnect replays onto the uncleared list: same ids again, the
      // assistant row now complete, plus an empty re-delivery whose
      // content must not erase the recovered text.
      userMessage("u1", "first"),
      assistantText("a1", "the whole answer"),
      { id: "a1", role: "assistant", content: "" },
    ];
    const blocks = transcriptBlocksOf(messages, anchorsOf(), false);
    expect(blocks.map((block) => block.messageId)).toEqual(["u1", "a1"]);
    expect(blocks[1].rows).toEqual([
      {
        kind: "assistant-text",
        key: "a1",
        text: "the whole answer",
        streaming: false,
      },
    ]);
  });

  it("joins the attachments side table onto user rows, without a stamp", () => {
    const attachment = {
      id: "att-1",
      kind: "image" as const,
      format: "png",
      filename: "screen.png",
      byte_size: 512,
    };
    const blocks = transcriptBlocksOf(
      [userMessage("user:turn-1", "")],
      anchorsOf(),
      false,
      undefined,
      { attachmentsByMessageId: new Map([["user:turn-1", [attachment]]]) },
    );
    // An attachment-only turn has empty text and still renders its chips.
    expect(blocks[0].rows).toEqual([
      {
        kind: "user",
        key: "user:turn-1",
        text: "",
        attachments: [attachment],
      },
    ]);
    expect(blocks[0].rows[0]).not.toHaveProperty("createdAt");
  });
});

describe("the tool-result join (review round 4, finding 5)", () => {
  it("the newest tool record wins when one call id spans two tool messages", () => {
    // The approval-pause shape: message ids carry the round infix but
    // tool-call ids do not, so a call's result can be re-recorded in a
    // later round under a new message id. The later record is the
    // outcome — the deleted dashboard derivation's first-wins accident
    // would freeze the earlier round's text forever. An intended,
    // recorded delta; one join rule for every surface.
    const messages: Message[] = [
      userMessage("u1", "go"),
      toolCallMessage("a1", "t1", "docs_search"),
      toolResult("r1-round1", "t1", "PAUSED_FOR_APPROVAL"),
      toolResult("r1-round2", "t1", "The real outcome."),
    ];
    const blocks = transcriptBlocksOf(messages, anchorsOf(), false);
    const call = flattened(blocks).find(
      (row) => row.kind === "tool-call" && row.toolCallId === "t1",
    );
    expect(call).toMatchObject({
      state: "output-available",
      result: "The real outcome.",
    });
  });
});

describe("transcriptBlocksOf — severance and delivery boundaries", () => {
  const A_RETRIED_TURN: Message[] = [
    userMessage("u1", "go"),
    toolCallMessage("a1", "t1", "docs_search"),
    // The retry's first message — the resume anchor lands here.
    assistantText("a2", "Trying again."),
    toolCallMessage("a3", "t2", "docs_search"),
  ];

  it("a resume anchor severs the open calls before it in the same turn", () => {
    const blocks = transcriptBlocksOf(
      A_RETRIED_TURN,
      anchorsOf({ resumeAnchors: new Map([["a2", null]]) }),
      true,
    );
    const rows = flattened(blocks);
    const severedCall = rows.find(
      (row) => row.kind === "tool-call" && row.toolCallId === "t1",
    );
    const liveCall = rows.find(
      (row) => row.kind === "tool-call" && row.toolCallId === "t2",
    );
    expect(severedCall).toMatchObject({ state: "superseded" });
    expect(liveCall).toMatchObject({ state: "input-available" });
  });

  it("a recorded error outranks severance; an earlier turn is out of the window", () => {
    const messages: Message[] = [
      userMessage("u0", "earlier turn"),
      toolCallMessage("e1", "t0", "docs_search"),
      ...A_RETRIED_TURN,
    ];
    const blocks = transcriptBlocksOf(
      messages,
      anchorsOf({
        resumeAnchors: new Map([["a2", null]]),
        toolErrorAnchors: new Map([["t1", "boom"]]),
      }),
      true,
    );
    const rows = flattened(blocks);
    expect(
      rows.find((row) => row.kind === "tool-call" && row.toolCallId === "t1"),
    ).toMatchObject({ state: "output-error" });
    // The earlier turn's open call was not severed by this turn's retry:
    // it keeps the deliberately still-pending read.
    expect(
      rows.find((row) => row.kind === "tool-call" && row.toolCallId === "t0"),
    ).toMatchObject({ state: "input-available" });
  });

  it("an empty delivery anchor is a boundary without a row", () => {
    const messages: Message[] = [
      toolCallMessage("a1", "t1", "docs_search"),
      // A machine-initiated delivery turn starts here — no user message.
      assistantText("a2", "Delivering."),
      assistantText("a3", "Done."),
    ];
    const blocks = transcriptBlocksOf(
      messages,
      anchorsOf({
        subagentDeliveryAnchors: new Map([["a2", []]]),
        resumeAnchors: new Map([["a3", null]]),
      }),
      true,
    );
    const rows = flattened(blocks);
    // No delivery row rendered (the host's own marker divider draws it)…
    expect(rows.some((row) => row.kind === "subagent-delivery")).toBe(false);
    // …but the boundary still scopes the severance window: the resume at
    // a3 severs only from the delivery turn's start (a2), so the earlier
    // open call stays pending.
    expect(
      rows.find((row) => row.kind === "tool-call" && row.toolCallId === "t1"),
    ).toMatchObject({ state: "input-available" });
  });
});

describe("transcriptBlocksOf — cross-block delegation grouping", () => {
  const A_FAN_OUT: Message[] = [
    userMessage("u1", "delegate"),
    toolCallMessage("d1", "s1", DISPATCH_SUBAGENT_TOOL_NAME, '{"task":"a"}'),
    toolCallMessage("d2", "s2", DISPATCH_SUBAGENT_TOOL_NAME, '{"task":"b"}'),
  ];

  it("adjacent single-call dispatch messages merge into the first block's group", () => {
    const blocks = transcriptBlocksOf(A_FAN_OUT, anchorsOf(), true);
    expect(blocks[1].rows).toMatchObject([
      { kind: "subagent-group", entries: [{}, {}] },
    ]);
    // The swallowed block keeps its place (and its marker anchors) with
    // the row lifted out.
    expect(blocks[2].rows).toEqual([]);
  });

  it("a declared marker boundary splits the delegation moment", () => {
    const split = transcriptBlocksOf(A_FAN_OUT, anchorsOf(), true, undefined, {
      markerBoundaries: { before: new Set(["d2"]), after: new Set() },
    });
    expect(split[1].rows).toMatchObject([
      { kind: "subagent-group", entries: [{}] },
    ]);
    expect(split[2].rows).toMatchObject([
      { kind: "subagent-group", entries: [{}] },
    ]);
    // Negative control for the mechanism: the same history with the
    // boundary set emptied merges back into one group.
    const merged = transcriptBlocksOf(A_FAN_OUT, anchorsOf(), true, undefined, {
      markerBoundaries: { before: new Set(), after: new Set() },
    });
    expect(merged[1].rows).toMatchObject([
      { kind: "subagent-group", entries: [{}, {}] },
    ]);
    expect(merged[2].rows).toEqual([]);
  });

  it("a refused dispatch stays a plain declined row, never a phantom coworker", () => {
    const blocks = transcriptBlocksOf(
      A_FAN_OUT,
      anchorsOf({ toolRefusalAnchors: new Map([["s1", "Not allowed."]]) }),
      true,
    );
    expect(blocks[1].rows).toMatchObject([
      { kind: "tool-call", state: "refused", refusalText: "Not allowed." },
    ]);
    expect(blocks[2].rows).toMatchObject([
      { kind: "subagent-group", entries: [{}] },
    ]);
  });
});

describe("runFoldsOf — the tailStart override", () => {
  // Narration before the last prose run: the one shape the two regimes
  // disagree on — the episode regime folds the early prose in, the live
  // cluster regime keeps every prose row top-level.
  const PROSE_WORK_PROSE: TranscriptRow[] = [
    {
      kind: "assistant-text",
      key: "a1",
      text: "Let me check.",
      streaming: false,
    },
    {
      kind: "tool-call",
      key: "a2:t1",
      toolCallId: "t1",
      toolName: "x",
      state: "output-available",
      argsText: "{}",
      result: "ok",
      offloaded: false,
      errorText: undefined,
    },
    { kind: "assistant-text", key: "a3", text: "Done.", streaming: false },
  ];

  it("tailStart 0 clusters everything; tailStart at length episode-folds everything", () => {
    const clustered = runFoldsOf(PROSE_WORK_PROSE, { tailStart: 0 });
    expect(clustered.map((row) => row.kind)).toEqual([
      "assistant-text",
      "run-fold",
      "assistant-text",
    ]);
    const episodes = runFoldsOf(PROSE_WORK_PROSE, {
      tailStart: PROSE_WORK_PROSE.length,
      // Outranked by tailStart on purpose — the caller pre-computed it.
      openTailTurn: true,
    });
    // Episode regime: the early narration folds in; only the last
    // maximal prose run stays out.
    expect(episodes.map((row) => row.kind)).toEqual([
      "run-fold",
      "assistant-text",
    ]);
    // Out-of-range values clamp rather than throw.
    expect(runFoldsOf(PROSE_WORK_PROSE, { tailStart: 99 })).toEqual(episodes);
  });
});

describe("foldedBlocksOf — the segmented fold", () => {
  // A settled turn whose narration precedes its work: the two folding
  // regimes DISAGREE on this shape — the episode regime folds the early
  // narration into the fold (only the last prose run stays out), the live
  // cluster regime keeps every prose row top-level — so these cases
  // falsify a fold pass that clusters where it should unify, or unifies
  // the open tail.
  const A_SETTLED_TURN: TranscriptBlock[] = [
    {
      messageId: "u1",
      rows: [{ kind: "user", key: "u1", text: "go", attachments: [] }],
    },
    {
      messageId: "a0",
      rows: [
        {
          kind: "assistant-text",
          key: "a0",
          text: "Let me check.",
          streaming: false,
        },
      ],
    },
    {
      messageId: "a1",
      rows: [
        {
          kind: "tool-call",
          key: "a1:t1",
          toolCallId: "t1",
          toolName: "x",
          state: "output-available",
          argsText: "{}",
          result: "ok",
          offloaded: false,
          errorText: undefined,
        },
      ],
    },
    { messageId: "r1", rows: [] },
    {
      messageId: "a2",
      rows: [
        {
          kind: "tool-call",
          key: "a2:t2",
          toolCallId: "t2",
          toolName: "y",
          state: "output-available",
          argsText: "{}",
          result: "ok",
          offloaded: false,
          errorText: undefined,
        },
      ],
    },
    {
      messageId: "a3",
      rows: [
        { kind: "assistant-text", key: "a3", text: "Done.", streaming: false },
      ],
    },
  ];

  it("unifies a settled span into one episode — narration folded, last prose out", () => {
    const folded = foldedBlocksOf(A_SETTLED_TURN, {});
    expect(folded.map((block) => block.rows.map((row) => row.kind))).toEqual([
      ["user"],
      ["run-fold"],
      [],
      [],
      [],
      ["assistant-text"],
    ]);
    const fold = folded[1].rows[0];
    if (fold.kind !== "run-fold") {
      throw new Error("expected a run fold");
    }
    expect(fold.members.map((member) => member.key)).toEqual([
      "a0",
      "a1:t1",
      "a2:t2",
    ]);
  });

  it("a declared boundary splits the fold exactly as a visible row would", () => {
    const folded = foldedBlocksOf(A_SETTLED_TURN, {
      markerBoundaries: { before: new Set(["a2"]), after: new Set() },
    });
    // The first segment's own episode pass keeps ITS last prose run out
    // (the narration), so the split reshapes the whole span, not just the
    // boundary block.
    expect(folded.map((block) => block.rows.map((row) => row.kind))).toEqual([
      ["user"],
      ["assistant-text"],
      ["run-fold"],
      [],
      ["run-fold"],
      ["assistant-text"],
    ]);
    // Negative control: emptying the boundary set merges the fold back.
    const merged = foldedBlocksOf(A_SETTLED_TURN, {
      markerBoundaries: { before: new Set(), after: new Set() },
    });
    expect(merged.map((block) => block.rows.map((row) => row.kind))).toEqual([
      ["user"],
      ["run-fold"],
      [],
      [],
      [],
      ["assistant-text"],
    ]);
  });

  it("a declared turn start keeps the open tail window on the delivery turn", () => {
    // Review round 1, finding 2: agent mode rides the delivery anchors in
    // EMPTY, so no subagent-delivery row exists for the tail scan to find
    // — the turn start must be declared, or the window falls back to the
    // previous member turn's user row and re-clusters its settled episode
    // for as long as the delivery run streams.
    const blocks: TranscriptBlock[] = [
      {
        messageId: "u1",
        rows: [{ kind: "user", key: "u1", text: "go", attachments: [] }],
      },
      {
        messageId: "a0",
        rows: [
          {
            kind: "assistant-text",
            key: "a0",
            text: "Let me check.",
            streaming: false,
          },
        ],
      },
      {
        messageId: "a1",
        rows: [
          {
            kind: "tool-call",
            key: "a1:t1",
            toolCallId: "t1",
            toolName: "x",
            state: "output-available",
            argsText: "{}",
            result: "ok",
            offloaded: false,
            errorText: undefined,
          },
        ],
      },
      {
        messageId: "a2",
        rows: [
          {
            kind: "assistant-text",
            key: "a2",
            text: "Done.",
            streaming: false,
          },
        ],
      },
      // The machine-initiated delivery turn: no user message, and the
      // host draws its own divider, so the block projects no delivery
      // row — only the declaration below marks the boundary.
      {
        messageId: "d1",
        rows: [
          {
            kind: "assistant-text",
            key: "d1",
            text: "Delivering.",
            streaming: true,
          },
        ],
      },
      {
        messageId: "d2",
        rows: [
          {
            kind: "tool-call",
            key: "d2:t9",
            toolCallId: "t9",
            toolName: "x",
            state: "input-available",
            argsText: "{}",
            result: undefined,
            offloaded: false,
            errorText: undefined,
          },
        ],
      },
    ];
    const folded = foldedBlocksOf(blocks, {
      openTailTurn: true,
      turnStartIds: new Set(["d1"]),
    });
    // The settled member turn keeps its unified episode (narration folded
    // in, last prose out); the delivery tail clusters live.
    expect(folded.map((block) => block.rows.map((row) => row.kind))).toEqual([
      ["user"],
      ["run-fold"],
      [],
      ["assistant-text"],
      ["assistant-text"],
      ["run-fold"],
    ]);
    // The bug's shape, kept as the in-test contrast: with no declaration
    // the tail window falls back to u1 and the settled turn re-clusters —
    // its narration surfaces to top level instead of folding.
    const undeclared = foldedBlocksOf(blocks, { openTailTurn: true });
    expect(undeclared[1].rows.map((row) => row.kind)).toEqual([
      "assistant-text",
    ]);
  });

  it("foldedBlocksOf does not accept the tailStart it computes itself", () => {
    // Review round 1, finding 4: tailStart is the per-segment offset this
    // function derives and hands down — accepting it would type-check and
    // silently do nothing. The directive below is self-falsifying: if the
    // Omit is ever removed, the expected error stops occurring and tsc
    // fails on the unused directive.
    expect(
      foldedBlocksOf([], {
        // @ts-expect-error -- tailStart is Omit-ed from foldedBlocksOf's options
        tailStart: 3,
      }),
    ).toEqual([]);
  });

  it("the open tail turn keeps per-cluster folding from the last boundary row", () => {
    const openTail: TranscriptBlock[] = [
      ...A_SETTLED_TURN,
      {
        messageId: "u2",
        rows: [{ kind: "user", key: "u2", text: "more", attachments: [] }],
      },
      {
        messageId: "a4",
        rows: [
          {
            kind: "assistant-text",
            key: "a4",
            text: "Checking again.",
            streaming: false,
          },
        ],
      },
      {
        messageId: "a5",
        rows: [
          {
            kind: "tool-call",
            key: "a5:t3",
            toolCallId: "t3",
            toolName: "x",
            state: "input-available",
            argsText: "{}",
            result: undefined,
            offloaded: false,
            errorText: undefined,
          },
        ],
      },
      {
        messageId: "a6",
        rows: [
          {
            kind: "assistant-text",
            key: "a6",
            text: "So far…",
            streaming: true,
          },
        ],
      },
    ];
    const folded = foldedBlocksOf(openTail, { openTailTurn: true });
    // Before the tail turn: the settled turn unifies (narration folded).
    // The open tail clusters live: BOTH its prose rows stay top-level at
    // their own positions — an episode pass would fold the earlier one in.
    expect(folded.map((block) => block.rows.map((row) => row.kind))).toEqual([
      ["user"],
      ["run-fold"],
      [],
      [],
      [],
      ["assistant-text"],
      ["user"],
      ["assistant-text"],
      ["run-fold"],
      ["assistant-text"],
    ]);
  });
});
