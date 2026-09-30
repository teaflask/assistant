// The turn-status union binding: every module in the package that spells a
// turn status word binds it through the generated union, never through bare
// string. THE GENERATING MECHANISM: a renamed status word in the spec must
// fail the compile at every site that compares it (contract/dispatches.ts
// states the rule for the ledger's words), and a `ReadonlySet<string>` of
// status literals or a `status: string` view field compiles clean through
// the rename — the predicate then silently matches nothing. The execution
// inbox's ledger's-word close carried exactly that shape, and since a
// RUN_FINISHED closes nothing by itself, that reconcile is the only close
// the assistant's entries have on a terminal run.
//
// The independent answer this table is checked against: renaming every
// value of the generated AssistantTurnStatus at once and type-checking the
// package must red every module below at a site of its own — except a
// module marked transitive, whose only comparison operand is a DERIVED
// union that collapses to never under the rename (a never-typed operand
// is never flagged); there the rename reds the derivation's assignments in
// the module that owns it instead. Recorded per module in the
// coworker-request-reaches-the-client record.
//
// Derived from the source, held to the table, nothing counted: every
// module under src (generated excluded) whose comment-stripped source
// spells a turn-only status word has a row naming the carrier through
// which the union reaches it, and the carrier's name must appear in the
// module; no module holds a string-typed set of status words; no module
// respells a literal union of status words; no module that spells one
// declares a string-typed status field or parameter.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "../src");

// The words no other vocabulary in the package shares (failed, superseded,
// working and cancelled also name tool-call and attachment states).
const TURN_ONLY_WORDS = /"(queued|awaiting_input|parked|succeeded|stopped)"/;
const TURN_WORDS = new Set([
  "queued",
  "working",
  "awaiting_input",
  "succeeded",
  "failed",
  "parked",
  "superseded",
  "stopped",
]);

interface Binding {
  /** The identifier(s) in the module's own source that carry the union. */
  via: readonly string[];
  /** What reds in this module when a generated value is renamed. */
  how: string;
  /** Bound only through another module's derivation (see the header). */
  transitive?: true;
}

const BINDINGS: Record<string, Binding> = {
  "core/activity.ts": {
    via: ["TurnStatus", "ServingAssistantTurn"],
    how: "isTerminalTurnStatus(status: TurnStatus) — the one settled-turn predicate both inboxes read — and settledResultOf(turn: ServingAssistantTurn)",
  },
  "core/approval-decision.ts": {
    via: ["ServingAssistantTurn"],
    how: "_turnAwaitsInterrupt(turn: ServingAssistantTurn | null)",
  },
  "core/approval-inbox.ts": {
    via: ["ApprovalTurnRecord", "TurnStatus"],
    how: "ApprovalTurnRecord.status: TurnStatus at the hydrate, reconcile and answerable sites; answerablePauseOf<T extends { status: TurnStatus }>",
  },
  "core/connection-driver.ts": {
    via: ["_newestTurn"],
    how: "store._newestTurn?.status — the store's newest turn is a ServingAssistantTurn",
  },
  "core/conversation-adoption.ts": {
    via: ["ServingAssistantTurn"],
    how: "_someTurnIsLive and _newestAnswerableTurnOf over readonly ServingAssistantTurn[]",
  },
  "core/conversation-publish.ts": {
    via: ["_newestTurn"],
    how: "store._newestTurn?.status in busyOf",
  },
  "core/epoch-sync.ts": {
    via: ["_newestTurn", "ServingAssistantTurn"],
    how: "store._newestTurn.status in theAnswerablePause; turn: ServingAssistantTurn | null at the two gate sites",
  },
  "core/execution-driver.ts": {
    via: ["ServingAssistantTurn"],
    how: "_turnStillHoldsThisPause(turn: ServingAssistantTurn, …)",
  },
  "core/pending-decision-gap.ts": {
    via: ["GapJudgeableTurn", "AssistantTurnStatus"],
    how: "GapJudgeableTurn.status: AssistantTurnStatus",
  },
  "core/run-status.ts": {
    via: ["TurnStatus"],
    how: "announcedStatusOf(status: TurnStatus | null, …)",
  },
  "core/stream-trouble.ts": {
    via: ["ServingAssistantTurn"],
    how: 'detail.turns.at(-1)?.status off the thread detail; _workflowStillOwnsTurn(status: ServingAssistantTurn["status"] | undefined)',
  },
};

function* sourceFiles(root: string): Generator<string> {
  for (const entry of readdirSync(root)) {
    const full = path.join(root, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "generated") continue;
      yield* sourceFiles(full);
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) {
      yield full;
    }
  }
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Every `Set<string>`/`ReadonlySet<string>` literal whose members are all
 *  turn status words — the shape the compile cannot guard. */
function stringTypedStatusSetsOf(source: string): string[] {
  return [
    ...source.matchAll(
      /(?:ReadonlySet<string>|Set<string>)[^;]*?new Set\(\[([^\]]*)\]/g,
    ),
  ]
    .map((match) => match[1])
    .filter((members) => {
      const words = [...members.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
      return words.length > 0 && words.every((word) => TURN_WORDS.has(word));
    });
}

/** A hand-respelled literal union of turn status words — `type X = "a" | "b"`
 *  with every member a status word, not derived from the union. */
function respelledStatusUnionsOf(source: string): string[] {
  return [...source.matchAll(/^type (\w+) =\s*((?:"[a-z_]+"\s*\|?\s*)+);/gm)]
    .filter((match) => {
      const words = [...match[2].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
      return words.every((word) => TURN_WORDS.has(word));
    })
    .map((match) => match[1]);
}

describe("the turn-status union binding", () => {
  const sources = new Map<string, string>();
  for (const file of sourceFiles(SRC)) {
    sources.set(
      path.relative(SRC, file),
      stripComments(readFileSync(file, "utf8")),
    );
  }
  const spelling = [...sources.entries()]
    .filter(([, source]) => TURN_ONLY_WORDS.test(source))
    .map(([name]) => name);

  it("anti-vacuity: the walk finds the predicates the probe redded", () => {
    for (const expected of [
      "core/activity.ts",
      "core/approval-inbox.ts",
      "core/run-status.ts",
    ]) {
      expect(spelling, expected).toContain(expected);
    }
  });

  it("every module that spells a turn status word has a row, and the row's carrier is really in the module", () => {
    expect(spelling.sort()).toEqual(Object.keys(BINDINGS).sort());
    for (const [name, binding] of Object.entries(BINDINGS)) {
      const source = sources.get(name) ?? "";
      expect(binding.how.length, `${name} needs its how`).toBeGreaterThan(0);
      for (const carrier of binding.via) {
        expect(
          source.includes(carrier),
          `${name}: the named carrier ${carrier} is not in the module`,
        ).toBe(true);
      }
    }
  });

  it("no module respells a literal union of turn status words — derive it with Extract<TurnStatus, …>", () => {
    for (const [name, source] of sources) {
      expect(
        respelledStatusUnionsOf(source),
        `${name}: a hand-written union of status words drifts out of the spec unnoticed`,
      ).toEqual([]);
    }
  });

  it("no module holds a string-typed set of turn status words", () => {
    for (const [name, source] of sources) {
      expect(
        stringTypedStatusSetsOf(source),
        `${name}: a Set<string> of status words compiles clean through a spec rename`,
      ).toEqual([]);
    }
  });

  it("no module that spells a turn status word declares a string-typed status field or parameter", () => {
    for (const name of spelling) {
      const source = sources.get(name) ?? "";
      expect(
        /\bstatus\??: string\b/.test(source),
        `${name}: a string-typed status drops the compile guard`,
      ).toBe(false);
    }
  });

  it("the settled-turn predicate is spelled once: the two inboxes read isTerminalTurnStatus", () => {
    for (const inbox of ["core/execution-inbox.ts", "core/approval-inbox.ts"]) {
      expect(
        sources.get(inbox)?.includes("isTerminalTurnStatus("),
        `${inbox} does not read the shared predicate`,
      ).toBe(true);
    }
  });
});
