// The pure-projection laws of the transcript visual contract: replay
// equivalence, the settled-state ladder, copy discipline, and
// vocabulary resolution — all asserted without React, over the same
// canned history the fixture bench renders. Law text:
// docs/transcript-visual-contract.md + tests/tvc/registry.ts.

import type { Message } from "@ag-ui/core";
import { describe, expect, it, vi } from "vitest";

import {
  CANNED_ANCHORS,
  CANNED_MESSAGES,
} from "../../fixtures/transcript/canned-data";
import {
  blockTimingRecorder,
  foldBlockTimingObserved,
} from "../../src/core/block-timing-anchors";
import type { MarkerAnchorsSnapshot } from "../../src/core/connection-epoch";
import { bannerFailureSentenceOf } from "../../src/core/turn-failure-copy";
import {
  EMPTY_MEMORY_ATTRIBUTION_ANCHORS,
  EMPTY_MEMORY_PROVENANCE_ANCHORS,
  withMemoryAttributed,
  withMemoryUpdateAnchored,
  type MemoryUpdated,
} from "../../src/core/memory-provenance-anchors";
import { runFoldsOf, settledFoldHeadlineOf } from "../../src/core/run-folds";
import {
  durationLabelOf,
  settledFoldDurationOf,
  type BlockTiming,
} from "../../src/core/segment-timing";
import { settledWorkedLabelOf } from "../../src/core/subagent-presence";
import { settledDurationLabelOf } from "../../src/core/subagent-roster";
import {
  withTurnFailedAnchored,
  type AnchoredTurnFailReceipts,
} from "../../src/core/turn-failed-anchors";
import {
  toolRowHeadlineOf,
  type ToolCallDisplay,
  type ToolCallViewModel,
} from "../../src/core/tool-call-display";
import {
  EMPTY_TOOL_CALL_DISPLAY_ANCHORS,
  withToolCallDisplayAnchored,
} from "../../src/core/tool-call-display-anchors";
import { toolCallPresentationOf } from "../../src/core/tool-call-presentation";
import { transcriptRowsOf } from "../../src/core/transcript-rows";
import { TVC_LAWS } from "./registry";
import { parkedLawTests, scanLawTests } from "./law-tests";

const AUTHORED: ToolCallDisplay = {
  progressText: "Brewing the comparison…",
  completeText: "Compared the steeping guides",
  errorText: "Couldn't compare the steeping guides",
};

function viewOf(overrides: Partial<ToolCallViewModel>): ToolCallViewModel {
  return {
    toolName: "action__compare-guides",
    state: "output-available",
    input: "{}",
    ...overrides,
  };
}

describe("law 9 — the same event history yields the same transcript", () => {
  it("TVC-080 the projection is deterministic: equal inputs yield deep-equal rows", () => {
    const first = transcriptRowsOf(CANNED_MESSAGES, CANNED_ANCHORS, true);
    const second = transcriptRowsOf(CANNED_MESSAGES, CANNED_ANCHORS, true);
    expect(second).toEqual(first);
    // The canned history is a real one — prose, reasoning, annotated
    // and errored tool rows, a folded delegation, and a severance-
    // bearing resume anchor (row-less: a meta-receipt kind) — not a trivial
    // fixture that would make determinism vacuous.
    expect(first.length).toBeGreaterThan(8);
  });

  it("TVC-081 marker-by-marker anchor building equals the replay snapshot, and re-application is a no-op", () => {
    // Live: the display arrives as two markers (progress at start,
    // completion at finish); replay re-delivers both. First non-absent
    // field wins, so every path lands on the same merged display.
    const progressOnly: ToolCallDisplay = {
      progressText: AUTHORED.progressText,
    };
    const completeOnly: ToolCallDisplay = {
      completeText: AUTHORED.completeText,
    };
    let live = EMPTY_TOOL_CALL_DISPLAY_ANCHORS;
    live = withToolCallDisplayAnchored(live, "t1", progressOnly);
    live = withToolCallDisplayAnchored(live, "t1", completeOnly);
    const replayedOnce = withToolCallDisplayAnchored(live, "t1", progressOnly);
    const replayedTwice = withToolCallDisplayAnchored(
      replayedOnce,
      "t1",
      completeOnly,
    );
    // Idempotence is identity: a no-op merge returns the SAME map.
    expect(replayedOnce).toBe(live);
    expect(replayedTwice).toBe(live);

    const snapshot: MarkerAnchorsSnapshot = {
      ...CANNED_ANCHORS,
      toolCallDisplayAnchors: new Map([
        [
          "t1",
          {
            progressText: AUTHORED.progressText,
            completeText: AUTHORED.completeText,
          },
        ],
      ]),
    };
    const incremental: MarkerAnchorsSnapshot = {
      ...CANNED_ANCHORS,
      toolCallDisplayAnchors: live,
    };
    const incrementalRows = transcriptRowsOf(
      CANNED_MESSAGES,
      incremental,
      false,
    );
    // Anti-vacuity: the anchors genuinely reach the projected row — two
    // empty maps would compare equal without proving anything.
    const annotated = incrementalRows.find(
      (row) => row.kind === "tool-call" && row.toolCallId === "t1",
    );
    if (annotated?.kind !== "tool-call") {
      throw new Error("the annotated call did not project");
    }
    expect(annotated.display).toEqual({
      progressText: AUTHORED.progressText,
      completeText: AUTHORED.completeText,
    });
    expect(incrementalRows).toEqual(
      transcriptRowsOf(CANNED_MESSAGES, snapshot, false),
    );
  });

  it("TVC-035 turn-failed receipts are replay-identical and never double the story", () => {
    // The turn-level terminal state under law 9: anchoring the
    // turn_failed marker live (marker-by-marker, RUN_ERROR flush) must
    // project the same rows a snapshot-seeded reconnect and a full
    // replay project; re-application is a no-op; and once the receipt is
    // anchored, the failure banner yields — the transcript row is the
    // one telling.
    const sentence = "Something went wrong while answering. Please try again.";
    let live: ReadonlyMap<string, AnchoredTurnFailReceipts> = new Map();
    live = withTurnFailedAnchored(live, "r1", "after", [sentence]);
    // Idempotence is identity: replay's re-delivery returns the SAME map.
    expect(withTurnFailedAnchored(live, "r1", "after", [sentence])).toBe(live);

    const incremental: MarkerAnchorsSnapshot = {
      ...CANNED_ANCHORS,
      turnFailedAnchors: live,
    };
    const snapshot: MarkerAnchorsSnapshot = {
      ...CANNED_ANCHORS,
      turnFailedAnchors: new Map([["r1", { before: [], after: [sentence] }]]),
    };
    const incrementalRows = transcriptRowsOf(
      CANNED_MESSAGES,
      incremental,
      false,
    );
    // Anti-vacuity: the receipt genuinely projects as its own row kind.
    const receiptRow = incrementalRows.find(
      (row) => row.kind === "turn-failed-receipts",
    );
    if (receiptRow?.kind !== "turn-failed-receipts") {
      throw new Error("the turn-failed receipt did not project");
    }
    expect(receiptRow.receipts).toEqual([sentence]);
    expect(incrementalRows).toEqual(
      transcriptRowsOf(CANNED_MESSAGES, snapshot, false),
    );

    // The banner yields to the anchored record — and only to it.
    expect(bannerFailureSentenceOf(sentence, live)).toBeNull();
    expect(bannerFailureSentenceOf(sentence, new Map())).toBe(sentence);
  });

  it("TVC-131 memory-footer anchoring is replay-identical and idempotent, and provenance without attribution projects no footer", () => {
    // Provenance attachment under law 9: attribution built
    // marker-by-marker (live) must project the same rows a snapshot seed
    // projects; re-application — even a drifted re-delivery naming a
    // different message — is a map-identity no-op; and a history whose
    // markers carry no attribution projects no footer anywhere, never a
    // synthesized one.
    const first: MemoryUpdated = {
      memoryId: "mem-1",
      scope: "user",
      summary: "Saved a note to memory.",
    };
    const second: MemoryUpdated = {
      memoryId: "mem-2",
      scope: "org",
      summary: "Saved a note to memory.",
    };
    let liveProvenance = EMPTY_MEMORY_PROVENANCE_ANCHORS;
    liveProvenance = withMemoryUpdateAnchored(liveProvenance, first);
    liveProvenance = withMemoryUpdateAnchored(liveProvenance, second);
    let liveAttribution = EMPTY_MEMORY_ATTRIBUTION_ANCHORS;
    liveAttribution = withMemoryAttributed(liveAttribution, "mem-1", "a2");
    liveAttribution = withMemoryAttributed(liveAttribution, "mem-2", "a2");
    // Idempotence is identity: the replayed duplicate — even flushed
    // against a drifted message list — returns the SAME maps.
    expect(withMemoryUpdateAnchored(liveProvenance, first)).toBe(
      liveProvenance,
    );
    expect(withMemoryAttributed(liveAttribution, "mem-1", "drifted")).toBe(
      liveAttribution,
    );

    const incremental: MarkerAnchorsSnapshot = {
      ...CANNED_ANCHORS,
      memoryProvenanceAnchors: liveProvenance,
      memoryAttributionAnchors: liveAttribution,
    };
    const snapshot: MarkerAnchorsSnapshot = {
      ...CANNED_ANCHORS,
      memoryProvenanceAnchors: new Map([
        ["mem-1", first],
        ["mem-2", second],
      ]),
      memoryAttributionAnchors: new Map([
        ["mem-1", "a2"],
        ["mem-2", "a2"],
      ]),
    };
    const incrementalRows = transcriptRowsOf(
      CANNED_MESSAGES,
      incremental,
      false,
    );
    // Anti-vacuity: the writes genuinely ride their message's own row,
    // coalesced in stream order — two empty projections would compare
    // equal without proving anything.
    const prose = incrementalRows.find(
      (row) => row.kind === "assistant-text" && row.key === "a2",
    );
    if (prose?.kind !== "assistant-text") {
      throw new Error("the attributed prose row did not project");
    }
    expect(prose.memoryUpdates?.map((update) => update.memoryId)).toEqual([
      "mem-1",
      "mem-2",
    ]);
    expect(incrementalRows).toEqual(
      transcriptRowsOf(CANNED_MESSAGES, snapshot, false),
    );

    // The old-history arm: the same provenance with NO attribution —
    // an older persistence — projects no footer on any row.
    const oldHistory: MarkerAnchorsSnapshot = {
      ...CANNED_ANCHORS,
      memoryProvenanceAnchors: liveProvenance,
    };
    const oldRows = transcriptRowsOf(CANNED_MESSAGES, oldHistory, false);
    expect(
      oldRows.every(
        (row) =>
          row.kind !== "assistant-text" || row.memoryUpdates === undefined,
      ),
    ).toBe(true);
  });

  it("TVC-082 the settled-state ladder is fixed: errored > denied > cancelled > refused > result-present > superseded > running/pending", () => {
    const call = (id: string): Message => ({
      id: `m-${id}`,
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id,
          type: "function",
          function: { name: "docs_search", arguments: "{}" },
        },
      ],
    });
    const result = (id: string): Message => ({
      id: `r-${id}`,
      role: "tool",
      toolCallId: id,
      content: "settled",
    });
    const messages = [
      call("t-err"),
      result("t-err"),
      // A member's denial arrives AS a cancel (the wire stamps the
      // receipt `cancelled`) — the denied rung must outrank the cancel
      // stamp it reclassifies, and yield to a recorded failure.
      call("t-denied"),
      result("t-denied"),
      call("t-cancel"),
      result("t-cancel"),
      // A refused call DOES have a result (the refusal envelope the
      // model read) — the refused rung must outrank result-present.
      call("t-refused"),
      result("t-refused"),
      call("t-done"),
      result("t-done"),
      // Severed by the retry whose anchor lands on m-resumed: errored,
      // cancelled and settled calls above must NOT drop to superseded
      // (each higher rung wins), while the resultless t-cut does.
      call("t-cut"),
      { id: "m-resumed", role: "assistant", content: "Retrying." } as Message,
      call("t-open"),
    ];
    const anchors: MarkerAnchorsSnapshot = {
      ...CANNED_ANCHORS,
      // t-err carries a denial too: the failure must still win.
      toolErrorAnchors: new Map([["t-err", "it broke"]]),
      toolCancelAnchors: new Set(["t-err", "t-denied", "t-cancel"]),
      toolDenialAnchors: new Set(["t-err", "t-denied"]),
      toolRefusalAnchors: new Map([["t-refused", "Results are waiting."]]),
      toolCallDisplayAnchors: new Map(),
      resumeAnchors: new Map([["m-resumed", { attempt: 2 }]]),
    };
    const statesOf = (running: boolean) =>
      transcriptRowsOf(messages, anchors, running)
        .filter((row) => row.kind === "tool-call")
        .map((row) => [row.toolCallId, row.state]);
    expect(statesOf(true)).toEqual([
      ["t-err", "output-error"],
      ["t-denied", "denied"],
      ["t-cancel", "cancelled"],
      ["t-refused", "refused"],
      ["t-done", "output-available"],
      ["t-cut", "superseded"],
      ["t-open", "input-available"],
    ]);
    // A settled run's unfinished call presents as still pending — the
    // receipt/card alongside owns the story, never a fake terminal state.
    expect(statesOf(false).at(-1)).toEqual(["t-open", "input-streaming"]);
  });

  it("TVC-083 row order and keys are a function of the history alone — the running flip never reorders or rekeys", () => {
    const shapeOf = (running: boolean) =>
      transcriptRowsOf(CANNED_MESSAGES, CANNED_ANCHORS, running).map((row) => [
        row.kind,
        row.key,
      ]);
    const liveShape = shapeOf(true);
    // Anti-vacuity: two empty projections would also compare equal.
    expect(liveShape.length).toBeGreaterThan(8);
    expect(liveShape).toEqual(shapeOf(false));
  });

  it("TVC-012 the settled fold duration derives from server-carried run metadata, identical live/reconnect/replay", () => {
    // Replay-stable metadata (docs/replay-metadata-contract.md): every
    // stored event carries an emit-side server timestamp, the block-timing
    // recorder folds boundaries into per-block pairs, and
    // settledFoldDurationOf reduces a fold's members to a typed duration —
    // a pure function of server timestamps, with no "now" parameter on the
    // settled path at all. The same event history is assembled three ways
    // — live (one delivery), reconnect (the history re-delivered in full
    // on top of the live map; the min/max fold is idempotent), and replay
    // (a from-scratch store) — and the derived label must be byte-equal
    // across all three, with the client clock never read.
    const FOLD_HISTORY = [
      { type: "TOOL_CALL_START", toolCallId: "t-fold", timestamp: 10_000 },
      { type: "TOOL_CALL_END", toolCallId: "t-fold", timestamp: 12_500 },
      {
        type: "REASONING_MESSAGE_START",
        messageId: "r-fold",
        timestamp: 13_000,
      },
      {
        type: "REASONING_MESSAGE_END",
        messageId: "r-fold",
        timestamp: 19_500,
      },
    ];
    const assemble = (
      events: object[],
      into = new Map<string, BlockTiming>(),
    ) => {
      const recorder = blockTimingRecorder((blockId, observedAtMs) => {
        foldBlockTimingObserved(into, blockId, observedAtMs);
      });
      for (const event of events) {
        void recorder.onEvent?.({ event } as never);
      }
      return into;
    };
    // The minimal deterministic spelling of the settled headline — the
    // fold owns the real formatter; byte-equality of the derivation is
    // what this law pins.
    const labelOf = (timings: Map<string, BlockTiming>) => {
      const duration = settledFoldDurationOf([...timings.values()]);
      expect(duration.kind).toBe("measured"); // anti-vacuity
      return duration.kind === "measured"
        ? `Worked for ${String(duration.durationMs)}ms`
        : "";
    };

    const clientClock = vi.spyOn(Date, "now");
    const live = assemble(FOLD_HISTORY);
    const reconnected = assemble(FOLD_HISTORY, assemble(FOLD_HISTORY));
    const replayed = assemble(FOLD_HISTORY);

    expect(labelOf(live)).toBe("Worked for 9500ms");
    expect(labelOf(reconnected)).toBe(labelOf(live));
    expect(labelOf(replayed)).toBe(labelOf(live));
    // No client-clock reading participated in any derivation.
    expect(clientClock).not.toHaveBeenCalled();
    clientClock.mockRestore();
  });

  it("TVC-084 episode grouping is replay-equivalent and the open→settled unification preserves the surviving fold's key", () => {
    // The completed-episode fold is a pure function of the projected
    // rows plus ONE bit — is the tail turn still open — and never the
    // tool-view registry. The same timestamped history assembled three
    // ways must group identically in BOTH modes, and the surviving fold
    // must keep the key its live cluster's <details> already wears, with
    // the client clock never read.
    const EPISODE_MESSAGES: Message[] = [
      { id: "u-e", role: "user", content: "Compare the guides." },
      { id: "th-e", role: "reasoning", content: "Check them first." },
      {
        id: "m-e1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "t-e1",
            type: "function",
            function: { name: "docs_search", arguments: "{}" },
          },
        ],
      },
      { id: "r-e1", role: "tool", toolCallId: "t-e1", content: "3 guides" },
      { id: "p-e-mid", role: "assistant", content: "Three guides so far." },
      {
        id: "m-e2",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "t-e2",
            type: "function",
            function: { name: "read_page", arguments: "{}" },
          },
        ],
      },
      { id: "r-e2", role: "tool", toolCallId: "t-e2", content: "the text" },
      { id: "p-e-final", role: "assistant", content: "They agree." },
    ];
    const EVENTS = [
      { type: "REASONING_MESSAGE_START", messageId: "th-e", timestamp: 5_000 },
      { type: "REASONING_MESSAGE_END", messageId: "th-e", timestamp: 6_000 },
      { type: "TOOL_CALL_START", toolCallId: "t-e1", timestamp: 6_000 },
      { type: "TOOL_CALL_END", toolCallId: "t-e1", timestamp: 20_000 },
      { type: "TOOL_CALL_START", toolCallId: "t-e2", timestamp: 30_000 },
      { type: "TOOL_CALL_END", toolCallId: "t-e2", timestamp: 47_000 },
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
    const groupingOf = (timings: Map<string, BlockTiming>) => {
      const shapeOf = (openTailTurn: boolean) =>
        runFoldsOf(
          transcriptRowsOf(
            EPISODE_MESSAGES,
            { ...CANNED_ANCHORS, blockTimingAnchors: timings },
            false,
          ),
          { openTailTurn },
        ).map((row) => [
          row.kind,
          row.key,
          row.kind === "run-fold" ? settledFoldHeadlineOf(row.duration) : "",
        ]);
      return { settled: shapeOf(false), open: shapeOf(true) };
    };

    const clientClock = vi.spyOn(Date, "now");
    const live = groupingOf(assemble());
    const reconnected = groupingOf(assemble(assemble()));
    const replayed = groupingOf(assemble());

    // Anti-vacuity: one unified measured episode when settled, two
    // per-cluster folds while open — the flip must actually regroup.
    const foldsOf = (shape: string[][]) =>
      shape.filter(([kind]) => kind === "run-fold");
    expect(foldsOf(live.settled).map(([, , headline]) => headline)).toEqual([
      "Worked for 42s",
    ]);
    expect(foldsOf(live.open)).toHaveLength(2);
    // The surviving fold: the settled episode keeps the live FIRST
    // cluster's key — never the second's — so its <details> never
    // remounts at the settle, and the second cluster's merges into it.
    expect(foldsOf(live.settled)).toHaveLength(1);
    expect(foldsOf(live.settled)[0][1]).toBe(foldsOf(live.open)[0][1]);
    expect(foldsOf(live.settled)[0][1]).not.toBe(foldsOf(live.open)[1][1]);
    expect(reconnected).toEqual(live);
    expect(replayed).toEqual(live);
    expect(clientClock).not.toHaveBeenCalled();
    clientClock.mockRestore();
  });
});

describe("law 4 — authored copy follows the state ladder", () => {
  it("TVC-031 error copy renders only on failure, completion copy only on completion, a cancelled call refuses authored copy, and a model-written caption is the label in every state", () => {
    expect(
      toolRowHeadlineOf(
        viewOf({ state: "output-available", display: AUTHORED }),
      ),
    ).toBe(AUTHORED.completeText);
    expect(
      toolRowHeadlineOf(viewOf({ state: "output-error", display: AUTHORED })),
    ).toBe(AUTHORED.errorText);
    // Success never wears error copy, failure never wears success copy:
    const errorOnly: ToolCallDisplay = {
      errorText: AUTHORED.errorText,
    };
    expect(
      toolRowHeadlineOf(
        viewOf({ state: "output-available", display: errorOnly }),
      ),
    ).toBe("Ran action compare guides");
    const successOnly: ToolCallDisplay = {
      completeText: AUTHORED.completeText,
    };
    expect(
      toolRowHeadlineOf(
        viewOf({ state: "output-error", display: successOnly }),
      ),
    ).toBe("action compare guides failed");
    // Cancelled refuses ALL authored copy — nothing authored about
    // running the call is true once it never ran.
    expect(
      toolRowHeadlineOf(viewOf({ state: "cancelled", display: AUTHORED })),
    ).toBe("Didn't run action compare guides");
    // The model's caption is intent, not a claim: it stays the label in
    // every state, with a quiet state word off the running/done path —
    // never the authored success or error sentence.
    const captioned: ToolCallDisplay = {
      ...AUTHORED,
      caption: "Comparing the guides",
    };
    expect(
      toolRowHeadlineOf(
        viewOf({ state: "output-available", display: captioned }),
      ),
    ).toBe("Comparing the guides");
    expect(
      toolRowHeadlineOf(viewOf({ state: "output-error", display: captioned })),
    ).toBe("Comparing the guides · failed");
    expect(
      toolRowHeadlineOf(viewOf({ state: "cancelled", display: captioned })),
    ).toBe("Comparing the guides · didn't run");
  });
});

describe("law 12 — known operations never default to raw JSON", () => {
  it("TVC-112 vocabulary resolution: an unknown icon token resolves to generic", () => {
    const unknownEverything = toolCallPresentationOf(
      viewOf({
        display: {
          icon: "kaleidoscope",
        },
      }),
    );
    expect(unknownEverything.icon).toBe("generic");
    const unannotated = toolCallPresentationOf(viewOf({}));
    expect(unannotated.icon).toBe("generic");
  });
});

describe("law 8 — subagent durations speak the house ladder", () => {
  it("TVC-073 a settled subagent duration derives from the house duration ladder — '0s' and 'Worked for 0s' are unrenderable", () => {
    // The roster's settled label IS durationLabelOf over the ledger's
    // span — asserted as equality across the ladder's rungs, so a
    // re-forked local ladder (a "0s" divergence) cannot come back
    // silently.
    const startedAt = "2026-08-21T10:00:00.000Z";
    const settledAtAfter = (durationMs: number) =>
      new Date(Date.parse(startedAt) + durationMs).toISOString();
    for (const durationMs of [0, 400, 999, 1_000, 41_000, 184_000, 4_020_000]) {
      expect(
        settledDurationLabelOf(startedAt, settledAtAfter(durationMs)),
      ).toBe(durationLabelOf(durationMs));
      expect(settledWorkedLabelOf(startedAt, settledAtAfter(durationMs))).toBe(
        settledFoldHeadlineOf({ kind: "measured", durationMs }),
      );
    }
    // The sub-second floor by name: never "0s", never "Worked for 0s".
    expect(settledDurationLabelOf(startedAt, settledAtAfter(400))).toBe("<1s");
    expect(settledWorkedLabelOf(startedAt, settledAtAfter(0))).toBe(
      "Worked for <1s",
    );
    // Clock skew clamps to a measured zero — a real sub-second span,
    // never a negative and never hidden.
    expect(
      settledDurationLabelOf("2026-08-21T10:00:41Z", "2026-08-21T10:00:00Z"),
    ).toBe("<1s");
    expect(
      settledWorkedLabelOf("2026-08-21T10:00:41Z", "2026-08-21T10:00:00Z"),
    ).toBe("Worked for <1s");
    // A live or unparseable span renders nothing — hidden, never
    // invented (the unknown-vs-sub-second law).
    expect(settledDurationLabelOf(startedAt, null)).toBeNull();
    expect(settledWorkedLabelOf(startedAt, null)).toBeNull();
    expect(settledDurationLabelOf("not a date", settledAtAfter(0))).toBeNull();
    expect(settledWorkedLabelOf(startedAt, "junk")).toBeNull();
  });
});

// The release gate. Every registered law's test runs: the registry has
// no status field and no parked state, so a law can only be parked in
// the tests — a skip modifier on its declaration, a skipped or
// conditional group around it, a runtime skip call, a declaration nested
// in a branch or helper, or a file the runner never selects. This law
// parses every test declaration statically for each of those
// (tests/tvc/law-tests.ts; the two Linux-only screenshot gates are the
// pinned exceptions), and tvc-meta.test.ts, which the scan excludes,
// asserts the same list so this declaration is vouched for in turn. A
// lane that wants to defer a law deletes it, with the PR-description
// callout the contract's prohibitions require, rather than parking it.
describe("the release gate", () => {
  it("TVC-180 every registered law's test runs — no skip modifier, skipped or conditional group, runtime skip or unreachable file parks one", () => {
    const registered = new Set(TVC_LAWS.map((law) => law.id));
    expect(
      parkedLawTests(scanLawTests(), registered),
      "parked law tests — there is no parked state; run the test or delete the law with a callout",
    ).toEqual([]);
  });
});
