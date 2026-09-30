/** The run-fold derivation: fold boundaries, the settled headline
 *  register, per-fold duration, and completed-episode unification are pure
 *  functions of the projected rows plus one openTailTurn bit — identical
 *  across live, reconnect, and replay. */
import { describe, expect, it, vi } from "vitest";

import type { Message } from "@ag-ui/core";

import {
  blockTimingRecorder,
  foldBlockTimingObserved,
} from "../src/core/block-timing-anchors";
import type { MarkerAnchorsSnapshot } from "../src/core/connection-epoch";
import type { ToolCallDisplay } from "../src/core/tool-call-display";
import {
  currentTurnStartOf,
  foldedBlocksOf,
  liveFoldHeadlineOf,
  runFoldsOf,
  settledFoldHeadlineOf,
  type RunFoldRow,
  type RunFoldStep,
} from "../src/core/run-folds";
import type { BlockTiming } from "../src/core/segment-timing";
import {
  transcriptRowsOf,
  type ToolCallRow,
  type TranscriptRow,
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
    toolCallDisplayAnchors: new Map(),
    toolSchemaAnchors: new Map(),
    blockTimingAnchors: new Map(),
    turnUsageAnchors: new Map(),
    memoryProvenanceAnchors: new Map(),
    memoryAttributionAnchors: new Map(),
    ...overrides,
  };
}

function toolRow(key: string, timing?: BlockTiming): TranscriptRow {
  return {
    kind: "tool-call",
    key,
    toolCallId: key,
    toolName: "docs_search",
    state: "output-available",
    argsText: '{"query":"tea"}',
    result: "One result",
    offloaded: false,
    timing,
  };
}

function reasoningRow(key: string, text: string): TranscriptRow {
  return { kind: "reasoning", key, text, streaming: false };
}

function userRow(key: string, text: string): TranscriptRow {
  return { kind: "user", key, text, attachments: [] };
}

function proseRow(key: string, text: string): TranscriptRow {
  return { kind: "assistant-text", key, text, streaming: false };
}

function shapeOf(rows: readonly ReturnType<typeof runFoldsOf>[number][]) {
  return rows.map((row) => [row.kind, row.key]);
}

function stepKeysOf(fold: RunFoldRow) {
  return fold.steps.map((step) =>
    step.kind === "tool-call" ? step.row.key : step.view.key,
  );
}

/** One turn interleaving narration and work — the shape episode
 *  unification joins: reasoning → tool → intermediate finding → tool →
 *  final response. Live it reads prose → fold → prose in true
 *  chronology; settled it becomes one episode fold with only the final
 *  response outside. */
const INTERLEAVED_TURN: Message[] = [
  { id: "u1", role: "user", content: "Compare the steeping guides." },
  { id: "th-a", role: "reasoning", content: "Check the guides first." },
  {
    id: "m-a",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "t-a",
        type: "function",
        function: { name: "docs_search", arguments: "{}" },
      },
    ],
  },
  { id: "res-a", role: "tool", toolCallId: "t-a", content: "3 guides" },
  { id: "p-mid", role: "assistant", content: "Found three guides so far." },
  {
    id: "m-b",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "t-b",
        type: "function",
        function: { name: "read_page", arguments: "{}" },
      },
    ],
  },
  { id: "res-b", role: "tool", toolCallId: "t-b", content: "the guide text" },
  { id: "p-final", role: "assistant", content: "They agree on 80°C." },
];

const T0 = 1_756_400_000_000;

const INTERLEAVED_TIMINGS = new Map<string, BlockTiming>([
  ["th-a", { startedAtMs: T0, settledAtMs: T0 + 2_000 }],
  ["t-a", { startedAtMs: T0 + 2_000, settledAtMs: T0 + 65_000 }],
  ["t-b", { startedAtMs: T0 + 70_000, settledAtMs: T0 + 70_400 }],
]);

describe("runFoldsOf — completed episodes", () => {
  it("a settled turn's interleaved work unifies into one episode with the final response outside", () => {
    const rows = transcriptRowsOf(
      INTERLEAVED_TURN,
      anchorsOf({ blockTimingAnchors: INTERLEAVED_TIMINGS }),
      false,
    );
    const folded = runFoldsOf(rows);
    expect(shapeOf(folded)).toEqual([
      ["user", "u1"],
      ["run-fold", "activity:th-a"],
      ["assistant-text", "p-final"],
    ]);
    const fold = folded[1] as RunFoldRow;
    // The complete chronology inside, in original order: thinking, the
    // first call, the intermediate finding at its own position, the
    // second call.
    expect(fold.steps.map((step) => step.kind)).toEqual([
      "reasoning",
      "tool-call",
      "narration",
      "tool-call",
    ]);
    expect(stepKeysOf(fold)).toEqual([
      "reasoning:th-a",
      "m-a:t-a",
      "p-mid",
      "m-b:t-b",
    ]);
    // One duration for the one episode, spanning the narration gap —
    // reduced over the WORK members' own timing, never a client clock.
    expect(fold.duration).toEqual({ kind: "measured", durationMs: 70_400 });
    expect(settledFoldHeadlineOf(fold.duration)).toBe("Worked for 1m 10s");
  });

  it("the open tail turn keeps the live per-cluster folding — no premature unification", () => {
    const rows = transcriptRowsOf(
      INTERLEAVED_TURN,
      anchorsOf({ blockTimingAnchors: INTERLEAVED_TIMINGS }),
      true,
    );
    const folded = runFoldsOf(rows, { openTailTurn: true });
    expect(shapeOf(folded)).toEqual([
      ["user", "u1"],
      ["run-fold", "activity:th-a"],
      ["assistant-text", "p-mid"],
      ["run-fold", "activity:m-b:t-b"],
      ["assistant-text", "p-final"],
    ]);
    const folds = folded.filter(
      (row): row is RunFoldRow => row.kind === "run-fold",
    );
    // Each live fold still reduces its OWN members' timing.
    expect(folds.map((fold) => settledFoldHeadlineOf(fold.duration))).toEqual([
      "Worked for 1m 05s",
      "Worked for <1s",
    ]);
  });

  it("the settled episode keeps its live first cluster's key — the surviving fold never rekeys", () => {
    const foldsOf = (openTailTurn: boolean) =>
      runFoldsOf(transcriptRowsOf(INTERLEAVED_TURN, anchorsOf(), false), {
        openTailTurn,
      }).filter((row): row is RunFoldRow => row.kind === "run-fold");
    const open = foldsOf(true);
    const settled = foldsOf(false);
    // Anti-vacuity: the fixture must actually change shape across the
    // flip — two live folds unify into one.
    expect(open).toHaveLength(2);
    expect(settled).toHaveLength(1);
    expect(settled[0].key).toBe(open[0].key);
  });

  it("position alone decides: byte-identical prose folds when interior and stays out when trailing", () => {
    const sameWords = "The guides agree.";
    const interior = proseRow("p-interior", sameWords);
    const trailing = proseRow("p-trailing", sameWords);
    // Anti-vacuity for the control itself: the two rows carry the same
    // copy, so nothing about length, keywords, or tone can tell them
    // apart — only their position can.
    expect(interior.kind === "assistant-text" && interior.text).toBe(
      trailing.kind === "assistant-text" ? trailing.text : "",
    );
    const folded = runFoldsOf([
      userRow("u1", "Go."),
      toolRow("t1"),
      interior,
      toolRow("t2"),
      trailing,
    ]);
    expect(shapeOf(folded)).toEqual([
      ["user", "u1"],
      ["run-fold", "activity:t1"],
      ["assistant-text", "p-trailing"],
    ]);
    expect(stepKeysOf(folded[1] as RunFoldRow)).toEqual([
      "t1",
      "p-interior",
      "t2",
    ]);
  });

  it("leading narration folds into the episode it introduces", () => {
    const folded = runFoldsOf([
      userRow("u1", "Go."),
      proseRow("p-lead", "Let me check the guides."),
      toolRow("t1"),
      proseRow("p-final", "Done."),
    ]);
    expect(shapeOf(folded)).toEqual([
      ["user", "u1"],
      ["run-fold", "activity:t1"],
      ["assistant-text", "p-final"],
    ]);
    expect(stepKeysOf(folded[1] as RunFoldRow)).toEqual(["p-lead", "t1"]);
  });

  it("a prose-only turn folds nothing — no empty work disclosure", () => {
    const folded = runFoldsOf([
      userRow("u1", "Hi."),
      proseRow("p1", "Hello."),
      proseRow("p2", "How can I help?"),
    ]);
    expect(shapeOf(folded)).toEqual([
      ["user", "u1"],
      ["assistant-text", "p1"],
      ["assistant-text", "p2"],
    ]);
  });

  it("an actions-only turn folds everything, leaving no trailing prose", () => {
    const folded = runFoldsOf([
      userRow("u1", "Go."),
      reasoningRow("th1", "Thinking."),
      toolRow("t1"),
      toolRow("t2"),
    ]);
    expect(shapeOf(folded)).toEqual([
      ["user", "u1"],
      ["run-fold", "activity:th1"],
    ]);
  });

  it("separate user turns produce separate episodes", () => {
    const folded = runFoldsOf([
      userRow("u1", "First."),
      toolRow("t1"),
      proseRow("p1", "First answer."),
      userRow("u2", "Second."),
      toolRow("t2"),
      proseRow("p2", "Second answer."),
    ]);
    expect(shapeOf(folded)).toEqual([
      ["user", "u1"],
      ["run-fold", "activity:t1"],
      ["assistant-text", "p1"],
      ["user", "u2"],
      ["run-fold", "activity:t2"],
      ["assistant-text", "p2"],
    ]);
  });

  it("narration keeps its memory provenance on the folded step", () => {
    const withMemory: TranscriptRow = {
      kind: "assistant-text",
      key: "p-mem",
      text: "Noted your preference.",
      streaming: false,
      memoryUpdates: [
        { path: "preferences.md", summary: "Prefers gyokuro" },
      ] as never,
    };
    const folded = runFoldsOf([
      toolRow("t1"),
      withMemory,
      toolRow("t2"),
      proseRow("p-final", "Done."),
    ]);
    const fold = folded[0] as RunFoldRow;
    const narration = fold.steps.find((step) => step.kind === "narration");
    expect(narration?.kind === "narration" && narration.view.key).toBe("p-mem");
    expect(
      narration?.kind === "narration" && narration.view.memoryUpdates,
    ).toHaveLength(1);
  });
});

describe("runFoldsOf — boundaries", () => {
  it("user messages and receipt rows bound episodes at their exact transcript position", () => {
    const folded = runFoldsOf([
      userRow("u1", "Go."),
      reasoningRow("th1", "Thinking."),
      toolRow("t1"),
      proseRow("p1", "Halfway."),
      toolRow("t2"),
      proseRow("p2", "Both guides read."),
      {
        kind: "turn-failed-receipts",
        key: "receipts:1",
        receipts: [],
      } as unknown as TranscriptRow,
      toolRow("t3"),
    ]);
    // The receipt row is a user-facing statement (the turn-level failure
    // receipt — the one standalone receipt kind left after the meta-receipt
    // deletion): it stays top-level and splits the settled turn into two
    // episodes. The interior prose does NOT split — it folds into the first
    // episode as narration — while each span's LAST prose run (p2 here)
    // stays outside.
    expect(shapeOf(folded)).toEqual([
      ["user", "u1"],
      ["run-fold", "activity:th1"],
      ["assistant-text", "p2"],
      ["turn-failed-receipts", "receipts:1"],
      ["run-fold", "activity:t3"],
    ]);
    expect(stepKeysOf(folded[1] as RunFoldRow)).toEqual([
      "reasoning:th1",
      "t1",
      "p1",
      "t2",
    ]);
  });

  it("a cut-off span keeps its last words out: work past the last prose folds into its own trailing fold", () => {
    // The round-2 review finding 1 breaker: a stopped turn whose last
    // call was cancelled. The paragraph the assistant had written must
    // stay visible — never buried behind a collapsed "Worked · 1
    // interrupted" headline — and the severed work folds after it.
    const cancelled = {
      ...(toolRow("t-cut") as Extract<TranscriptRow, { kind: "tool-call" }>),
      state: "cancelled" as const,
      result: undefined,
    };
    const stopped = runFoldsOf([
      userRow("u1", "Go."),
      proseRow("p1", "Reading the first guide now."),
      cancelled,
    ]);
    expect(shapeOf(stopped)).toEqual([
      ["user", "u1"],
      ["assistant-text", "p1"],
      ["run-fold", "activity:t-cut"],
    ]);
    // With earlier work too: leading episode, the last words, the tail.
    const midStop = runFoldsOf([
      userRow("u1", "Go."),
      toolRow("t1"),
      proseRow("p1", "Halfway."),
      cancelled,
    ]);
    expect(shapeOf(midStop)).toEqual([
      ["user", "u1"],
      ["run-fold", "activity:t1"],
      ["assistant-text", "p1"],
      ["run-fold", "activity:t-cut"],
    ]);
  });

  it("a subagent group bounds episodes — delegated work never disappears into a fold", () => {
    const folded = runFoldsOf([
      toolRow("t1"),
      proseRow("p1", "Dispatching."),
      {
        kind: "subagent-group",
        key: "sg1",
        entries: [],
      } as unknown as TranscriptRow,
      toolRow("t2"),
    ]);
    // p1 trails its span (the group cut the episode before more work
    // arrived), so it stays outside as that span's response.
    expect(shapeOf(folded)).toEqual([
      ["run-fold", "activity:t1"],
      ["assistant-text", "p1"],
      ["subagent-group", "sg1"],
      ["run-fold", "activity:t2"],
    ]);
  });

  it.each([true, false])(
    "an answered ask stays in its work fold (open turn: %s)",
    (openTailTurn) => {
      const ask = {
        ...toolRow("t-ask"),
        toolName: "ask_user",
        argsText: JSON.stringify({
          questions: [{ id: "q", heading: "Day", prompt: "How was your day?" }],
        }),
        result: JSON.stringify({ answers: [{ id: "q", text: "Good" }] }),
      };
      const folded = runFoldsOf([toolRow("t1"), ask, toolRow("t2")], {
        openTailTurn,
      });
      expect(shapeOf(folded)).toEqual([["run-fold", "activity:t1"]]);
      expect(stepKeysOf(folded[0] as RunFoldRow)).toEqual([
        "t1",
        "t-ask",
        "t2",
      ]);
    },
  );

  it("contiguous reasoning merges into one step at its own position; reasoning after a tool call stays below it", () => {
    const folded = runFoldsOf([
      reasoningRow("th1", "First thought."),
      reasoningRow("th2", "Second thought."),
      toolRow("t1"),
      reasoningRow("th3", "Afterthought."),
    ]);
    expect(folded).toHaveLength(1);
    const fold = folded[0] as RunFoldRow;
    expect(stepKeysOf(fold)).toEqual(["reasoning:th1", "t1", "reasoning:th3"]);
    const merged = fold.steps[0];
    expect(merged.kind === "reasoning" && merged.view.text).toBe(
      "First thought.\n\nSecond thought.",
    );
  });

  it("narration breaks reasoning contiguity — two thoughts around a finding stay two steps", () => {
    const folded = runFoldsOf([
      reasoningRow("th1", "Before."),
      proseRow("p1", "A finding."),
      reasoningRow("th2", "After."),
      toolRow("t1"),
      proseRow("p-end", "Done."),
    ]);
    const fold = folded[0] as RunFoldRow;
    expect(stepKeysOf(fold)).toEqual([
      "reasoning:th1",
      "p1",
      "reasoning:th2",
      "t1",
    ]);
  });
});

describe("runFoldsOf — settled member states ride the members, uncounted", () => {
  it("folds every settled state into one fold whose model carries no outcome tally — the word is each row pill's alone", () => {
    const withState = (
      key: string,
      state: "superseded" | "cancelled" | "denied" | "refused",
    ) => {
      const row = toolRow(key);
      if (row.kind !== "tool-call") {
        throw new Error("expected a tool row");
      }
      return { ...row, state, result: undefined };
    };
    const folded = runFoldsOf([
      withState("t1", "superseded"),
      withState("t2", "cancelled"),
      withState("t3", "denied"),
      withState("t4", "refused"),
      toolRow("t5"),
    ]);
    expect(folded).toHaveLength(1);
    const fold = folded[0];
    if (fold.kind !== "run-fold") {
      throw new Error("expected a run fold");
    }
    expect(
      fold.members.map((row) => (row.kind === "tool-call" ? row.state : null)),
    ).toEqual([
      "superseded",
      "cancelled",
      "denied",
      "refused",
      "output-available",
    ]);
    // The fold model is closed at these five fields: no per-state count
    // survives, since no renderer reads one.
    expect(Object.keys(fold).sort()).toEqual(
      ["duration", "key", "kind", "members", "steps"].sort(),
    );
  });
});

describe("runFoldsOf — per-fold duration", () => {
  it("a unified episode reduces over its own work members' timing, spanning the narration gaps", () => {
    const rows = transcriptRowsOf(
      INTERLEAVED_TURN,
      anchorsOf({ blockTimingAnchors: INTERLEAVED_TIMINGS }),
      false,
    );
    const folds = runFoldsOf(rows).filter(
      (row): row is RunFoldRow => row.kind === "run-fold",
    );
    expect(folds).toHaveLength(1);
    expect(folds[0].duration).toEqual({
      kind: "measured",
      durationMs: 70_400,
    });
    expect(settledFoldHeadlineOf(folds[0].duration)).toBe("Worked for 1m 10s");
  });

  it("a fold with no timestamped member is unknown, never zero", () => {
    const folded = runFoldsOf([toolRow("t1"), toolRow("t2")]);
    expect((folded[0] as RunFoldRow).duration).toEqual({ kind: "unknown" });
  });

  it("fold keys derive from the first work member and are stable across the running flip", () => {
    const keysOf = (running: boolean) =>
      runFoldsOf(transcriptRowsOf(INTERLEAVED_TURN, anchorsOf(), running)).map(
        (row) => [row.kind, row.key],
      );
    const settled = keysOf(false);
    // Anti-vacuity: the settled fixture must actually produce one
    // unified episode fold (the same fixture yields two folds with
    // openTailTurn — pinned in the episodes describe above).
    expect(settled.filter(([kind]) => kind === "run-fold")).toHaveLength(1);
    expect(keysOf(true)).toEqual(settled);
  });
});

describe("settledFoldHeadlineOf — the register", () => {
  it("renders the honest ladder and never a step count or a zero", () => {
    expect(settledFoldHeadlineOf({ kind: "unknown" })).toBe("Worked");
    expect(settledFoldHeadlineOf({ kind: "measured", durationMs: 0 })).toBe(
      "Worked for <1s",
    );
    expect(settledFoldHeadlineOf({ kind: "measured", durationMs: 999 })).toBe(
      "Worked for <1s",
    );
    expect(settledFoldHeadlineOf({ kind: "measured", durationMs: 1_000 })).toBe(
      "Worked for 1s",
    );
    expect(
      settledFoldHeadlineOf({ kind: "measured", durationMs: 289_000 }),
    ).toBe("Worked for 4m 49s");
    expect(
      settledFoldHeadlineOf({ kind: "measured", durationMs: 4_020_000 }),
    ).toBe("Worked for 1h 07m");
  });
});

describe("runFoldsOf — replay equivalence", () => {
  it("live, reconnect, and replay histories yield identical fold boundaries and headlines", () => {
    // The TVC-012 assembly idiom, extended from one fold's label to the
    // whole folded shape: one timestamped event history assembled three
    // ways must produce byte-equal boundaries and settled headlines —
    // in BOTH grouping modes — with the client clock never read.
    const EVENTS = [
      { type: "REASONING_MESSAGE_START", messageId: "th-a", timestamp: T0 },
      {
        type: "REASONING_MESSAGE_END",
        messageId: "th-a",
        timestamp: T0 + 2_000,
      },
      { type: "TOOL_CALL_START", toolCallId: "t-a", timestamp: T0 + 2_000 },
      { type: "TOOL_CALL_END", toolCallId: "t-a", timestamp: T0 + 65_000 },
      { type: "TOOL_CALL_START", toolCallId: "t-b", timestamp: T0 + 70_000 },
      { type: "TOOL_CALL_END", toolCallId: "t-b", timestamp: T0 + 70_400 },
    ];
    const assemble = (into = new Map<string, BlockTiming>()) => {
      const recorder = blockTimingRecorder((blockId, observedAtMs) => {
        foldBlockTimingObserved(into, blockId, observedAtMs);
      });
      for (const event of EVENTS) {
        void recorder.onEvent?.({ event } as never);
      }
      return into;
    };
    const foldedShapeOf = (
      timings: Map<string, BlockTiming>,
      openTailTurn: boolean,
    ) =>
      runFoldsOf(
        transcriptRowsOf(
          INTERLEAVED_TURN,
          anchorsOf({ blockTimingAnchors: timings }),
          false,
        ),
        { openTailTurn },
      ).map((row) => [
        row.kind,
        row.key,
        row.kind === "run-fold" ? settledFoldHeadlineOf(row.duration) : "",
      ]);
    const bothShapesOf = (timings: Map<string, BlockTiming>) => ({
      settled: foldedShapeOf(timings, false),
      open: foldedShapeOf(timings, true),
    });

    const clientClock = vi.spyOn(Date, "now");
    const live = bothShapesOf(assemble());
    const reconnected = bothShapesOf(assemble(assemble()));
    const replayed = bothShapesOf(assemble());

    // Anti-vacuity: the settled shape carries ONE unified measured
    // episode; the open shape still carries the two per-cluster folds.
    const headlinesOf = (shape: string[][]) =>
      shape.filter(([, , headline]) => headline !== "").map(([, , h]) => h);
    expect(headlinesOf(live.settled)).toEqual(["Worked for 1m 10s"]);
    expect(headlinesOf(live.open)).toEqual([
      "Worked for 1m 05s",
      "Worked for <1s",
    ]);
    expect(reconnected).toEqual(live);
    expect(replayed).toEqual(live);
    expect(clientClock).not.toHaveBeenCalled();
    clientClock.mockRestore();
  });
});

describe("liveFoldHeadlineOf — the collapsed live headline", () => {
  const workRow = (
    key: string,
    state:
      | "input-available"
      | "output-available"
      | "output-error"
      | "cancelled" = "input-available",
    display?: ToolCallDisplay,
  ): Extract<TranscriptRow, { kind: "tool-call" }> => ({
    kind: "tool-call",
    key,
    toolCallId: key,
    toolName: "docs_search",
    state,
    argsText: "{}",
    offloaded: false,
    display,
  });
  const thinking = (key: string, streaming: boolean): RunFoldStep => ({
    kind: "reasoning",
    view: { kind: "reasoning", key, text: "…", streaming },
  });
  const stepsOf = (rows: readonly TranscriptRow[]): readonly RunFoldStep[] => {
    const fold = runFoldsOf(rows)[0];
    if (fold.kind !== "run-fold") {
      throw new Error("expected a fold");
    }
    return fold.steps;
  };

  it("names the latest running tool with the ladder's running frame", () => {
    expect(liveFoldHeadlineOf(stepsOf([workRow("t1")]))).toBe(
      "Running docs search…",
    );
  });

  it("lets the backend's display envelope win over the mechanical frame — the row's own words, never a respelled ladder", () => {
    expect(
      liveFoldHeadlineOf(
        stepsOf([
          workRow("t1", "input-available", {
            progressText: "Searching the steeping guides…",
          }),
        ]),
      ),
    ).toBe("Searching the steeping guides…");
  });

  it("shows the latest step's model-written caption, with the state word once it settled off the done path", () => {
    expect(
      liveFoldHeadlineOf(
        stepsOf([
          workRow("t1", "output-available", { caption: "Reading the guide" }),
          workRow("t2", "input-available", {
            caption: "Checking for an existing install",
            progressText: "Running a command…",
          }),
        ]),
      ),
    ).toBe("Checking for an existing install");
    expect(
      liveFoldHeadlineOf(
        stepsOf([
          workRow("t1", "cancelled", {
            caption: "Checking for an existing install",
          }),
        ]),
      ),
    ).toBe("Checking for an existing install · didn't run");
  });

  it("reads the latest step at its OWN state — a settled latest call says Ran, not Running", () => {
    expect(
      liveFoldHeadlineOf(
        stepsOf([workRow("t1"), workRow("t2", "output-available")]),
      ),
    ).toBe("Ran docs search");
  });

  it("speaks the ReasoningRow labels for a reasoning step — streaming and settled", () => {
    expect(liveFoldHeadlineOf([thinking("th1", true)])).toBe("Thinking…");
    expect(liveFoldHeadlineOf([thinking("th1", false)])).toBe(
      "Thought about it",
    );
  });

  it("walks from the end: the LATEST step names the fold", () => {
    expect(
      liveFoldHeadlineOf([thinking("th1", false), ...stepsOf([workRow("t1")])]),
    ).toBe("Running docs search…");
  });

  it("falls back to Working… when no step is usable", () => {
    expect(liveFoldHeadlineOf([])).toBe("Working…");
  });

  it("returns the RAW label untruncated — display truncation and the title are the renderer's (round-2 finding 5)", () => {
    const authored = `Running the ${"very ".repeat(30)}long operation`;
    const label = liveFoldHeadlineOf(
      stepsOf([
        workRow("t1", "input-available", {
          progressText: authored,
        }),
      ]),
    );
    // FoldHeadline shows activityTitleOf(label) and carries this raw
    // text as its wrapper's title, so nothing is lost before render.
    expect(label).toBe(authored);
  });
});

describe("runFoldsOf — a settled work span is one episode whatever its rows resolve", () => {
  /** A tool row under its own name and state: the staging shape's members.
   *  An action carries the wire's reserved view ref, exactly as the backend
   *  annotates every catalog action. */
  function namedToolRow(
    key: string,
    toolName: string,
    state: "output-available" | "output-error" = "output-available",
  ): TranscriptRow {
    const base = toolRow(key) as ToolCallRow;
    return {
      ...base,
      toolName,
      state,
      result: state === "output-available" ? "ok" : undefined,
      errorText:
        state === "output-error"
          ? "404 NOT_FOUND from the publish endpoint."
          : undefined,
      display: toolName.startsWith("action__")
        ? { view: { key: "teaflask.action", version: 1 } }
        : undefined,
    };
  }

  it("work → narration → work before the final prose is one fold keyed on the first work member, narration a step in place", () => {
    const rows: TranscriptRow[] = [
      toolRow("a"),
      toolRow("b"),
      proseRow("p-mid", "Found the guides."),
      toolRow("x"),
      toolRow("y"),
      proseRow("p-final", "They agree."),
    ];
    const folded = runFoldsOf(rows);
    expect(shapeOf(folded)).toEqual([
      ["run-fold", "activity:a"],
      ["assistant-text", "p-final"],
    ]);
    expect(stepKeysOf(folded[0] as RunFoldRow)).toEqual([
      "a",
      "b",
      "p-mid",
      "x",
      "y",
    ]);
  });

  it("staging shape: a failed action view → narration → browser work → final prose settles to ONE fold, the action first, the narration in place", () => {
    const rows: TranscriptRow[] = [
      namedToolRow("act", "action__publish-doc", "output-error"),
      proseRow("p-mid", "The publish call failed; checking the page instead."),
      namedToolRow("nav", "navigate"),
      namedToolRow("read", "read_page"),
      namedToolRow("hl", "highlight"),
      proseRow("p-final", "The Release control is highlighted."),
    ];
    const settled = runFoldsOf(rows);
    expect(shapeOf(settled)).toEqual([
      ["run-fold", "activity:act"],
      ["assistant-text", "p-final"],
    ]);
    expect(stepKeysOf(settled[0] as RunFoldRow)).toEqual([
      "act",
      "p-mid",
      "nav",
      "read",
      "hl",
    ]);
    // The open turn keeps the live per-cluster chronology — the settle
    // really regroups, and only the settle does.
    expect(shapeOf(runFoldsOf(rows, { openTailTurn: true }))).toEqual([
      ["run-fold", "activity:act"],
      ["assistant-text", "p-mid"],
      ["run-fold", "activity:nav"],
      ["assistant-text", "p-final"],
    ]);
  });

  it("the fold pass takes no registry join — the option cannot come back unnoticed", () => {
    const rows: TranscriptRow[] = [toolRow("a"), proseRow("p-final", "Done.")];
    // Excess-property checking on the literal is the guard: this line
    // stops compiling the moment RunFoldsOptions grows the option again.
    // @ts-expect-error — grouping never reads which views a row resolves
    const folded = runFoldsOf(rows, { isViewBearing: () => true });
    expect(shapeOf(folded)).toEqual([
      ["run-fold", "activity:a"],
      ["assistant-text", "p-final"],
    ]);
  });

  it("the derivation is deterministic: equal inputs, deep-equal output", () => {
    const rows: TranscriptRow[] = [
      toolRow("a"),
      proseRow("p-mid", "Found them."),
      toolRow("x"),
      proseRow("p-final", "Done."),
    ];
    expect(runFoldsOf(rows)).toEqual(runFoldsOf(rows));
  });
});

describe("currentTurnStartOf — the one boundary the fold window and the hold window share", () => {
  const deliveryRow = (key: string): TranscriptRow => ({
    kind: "subagent-delivery",
    key,
    results: [],
  });

  it("is the last user row when nothing is declared", () => {
    const rows = [
      userRow("u1", "a"),
      toolRow("t1"),
      userRow("u2", "b"),
      toolRow("t2"),
    ];
    expect(currentTurnStartOf(rows, null)).toBe(2);
  });

  it("recognizes a projected delivery row as a turn boundary", () => {
    const rows = [
      userRow("u1", "a"),
      toolRow("t1"),
      deliveryRow("d1"),
      toolRow("t2"),
    ];
    expect(currentTurnStartOf(rows, null)).toBe(2);
  });

  it("is 0 for a list with neither boundary — one turn, all of it the tail", () => {
    expect(currentTurnStartOf([toolRow("t1"), proseRow("p", "x")], null)).toBe(
      0,
    );
    expect(currentTurnStartOf([], null)).toBe(0);
  });

  it("a declared turn-start block later than every row boundary wins", () => {
    const rows = [
      userRow("u1", "a"),
      toolRow("t1"),
      toolRow("t2"),
      proseRow("p", "x"),
    ];
    const blocks = [
      { messageId: "u1", rows: [rows[0]] },
      { messageId: "m1", rows: [rows[1]] },
      // The row-less delivery block (agent mode draws its own marker):
      // its boundary sits where its rows would have been.
      { messageId: "delivery", rows: [] },
      { messageId: "m2", rows: [rows[2], rows[3]] },
    ];
    expect(currentTurnStartOf(rows, blocks, new Set(["delivery"]))).toBe(2);
  });

  it("the row scan wins over an earlier declared start", () => {
    const rows = [
      userRow("u1", "a"),
      toolRow("t1"),
      userRow("u2", "b"),
      toolRow("t2"),
    ];
    const blocks = [
      { messageId: "u1", rows: [rows[0]] },
      { messageId: "m1", rows: [rows[1]] },
      { messageId: "u2", rows: [rows[2]] },
      { messageId: "m2", rows: [rows[3]] },
    ];
    expect(currentTurnStartOf(rows, blocks, new Set(["u1"]))).toBe(2);
  });

  it("accepts the raw rows (reasoning included) and the folded display rows alike", () => {
    const rows = [
      userRow("u1", "a"),
      reasoningRow("r", "hm"),
      toolRow("t1"),
      toolRow("t2"),
    ];
    expect(currentTurnStartOf(rows, null)).toBe(0);
    const folded = runFoldsOf(rows, { openTailTurn: false });
    expect(currentTurnStartOf(folded, null)).toBe(0);
  });

  it("is the boundary foldedBlocksOf opens its tail window at", () => {
    // Two turns; the second's user row is the tail start, so the first
    // turn's work folds as a completed episode and the second's stays a
    // live cluster — the same index currentTurnStartOf reports.
    const rows = [
      userRow("u1", "a"),
      toolRow("t1"),
      proseRow("p1", "done"),
      userRow("u2", "b"),
      toolRow("t2"),
    ];
    const blocks = [
      { messageId: "u1", rows: [rows[0]] },
      { messageId: "m1", rows: [rows[1], rows[2]] },
      { messageId: "u2", rows: [rows[3]] },
      { messageId: "m2", rows: [rows[4]] },
    ];
    expect(currentTurnStartOf(rows, blocks)).toBe(3);
    const folded = foldedBlocksOf(blocks, { openTailTurn: true });
    const display = folded.flatMap((block) => block.rows);
    expect(display.map((row) => row.kind)).toEqual([
      "user",
      "run-fold",
      "assistant-text",
      "user",
      "run-fold",
    ]);
    expect(currentTurnStartOf(display, folded)).toBe(3);
  });
});
