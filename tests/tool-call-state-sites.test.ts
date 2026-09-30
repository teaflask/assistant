// THE TOOL-CALL STATE SITE CENSUS — the committed enumeration.
//
// `ToolCallState` gained a member (`denied`), so every site that
// discriminates on the union is a site the new member had to be decided
// at. The type-checker closes the exhaustive switches and the
// `Record<ToolCallState, …>` tables, but an `if`/`||` chain over string
// literals compiles fine with a member missing — so this suite executes
// the census instead of leaving it to be authored by hand: every source
// file that names the `"cancelled"` member as a literal must be
// classified below, and every classified-as-handled file must also name
// `"denied"`. A new site goes red here until it is classified.
//
// The classification, stated so it can be verified, not re-derived:
//
// HANDLED — a ToolCallState site; `denied` decided in code:
//   core/tool-call-display.ts      the union; toolRowHeadlineOf ("You didn't
//                                  approve X"); _displayTextFor (refuses copy)
//   core/transcript-rows.ts        _toolStateOf (errored > denied > cancelled
//                                  > refused > result > superseded > running);
//                                  _asDispatchCall (a denied dispatch is a
//                                  plain row, never a group entry)
//   components/operation-icons.tsx STATE_WORDS ("Not approved"); the ink rule
//                                  stays destructive iff output-error —
//                                  denied is deliberately neutral
//   components/tool-row.tsx        the pill chain ("Not approved")
//   components/tool-call-rows.tsx  _mandatoryStateWordOf; _toolViewOf's
//                                  offloaded guard and output suppression
//   components/activity-rail.tsx   FoldHeadline JSDoc (the four pill
//                                  words; the headline renders no tally)
//   components/tool-views/view-dom.ts  settledOutcomeNotesOf ("Not approved
//                                  — the call didn't run.")
//
// EXCLUDED — the literal "cancelled" names a DIFFERENT vocabulary:
//   components/question-panel.tsx          an elicitation card's status word
//   core/question-receipt.ts an elicitation answer's kind
//   core/elicitation-cards.ts              the elicitation answer kind union
//   core/elicitation-answers.ts             an elicitation answer literal
//   core/tool-flag-anchors.ts              the wire's TOOL_CALL_RESULT field
//   core/tool-cancel-anchors.ts            the same wire field, bound
//   core/subagent-rows.ts                  DispatchCall's `cancelled` flag (a
//                                          settled dispatch's shape, fed by
//                                          _asDispatchCall — which never emits
//                                          a denied dispatch) and prose
//   components/subagent-group-row.tsx      the same dispatch-entry flag
//
// UNREACHABLE / DELIBERATELY ABSENT — reads the union without naming
// the member, and needs no arm:
//   core/subagent-presence.ts      only input-available counts as live; a
//                                  denied call is settled
//   core/subagent-rows.ts          counts DispatchCall flags; a denied
//                                  dispatch never becomes one (see
//                                  _asDispatchCall above)
//   core/tool-call-presentation.ts passes `state` through as `status`
//   core/tool-view.ts              the ToolViewCall.status type only
//   components/tool-views/{action,command,docs-search,file-edit}-view.ts
//                                  reach the state only via
//                                  settledOutcomeNotesOf (handled above)
//   components/child-transcript.tsx an empty toolDenialAnchors ruling — a
//                                  child call never carries an approval
//
// The dashboard tree's twin census lives in its own agent-run tests.
//
// THE PROSE CLASS: a comment, docblock or doc sentence that ENUMERATES
// the state members, the fold's suffix counts or the settled-outcome
// arms names no literal, so the code census above cannot see it. The
// class was swept in both trees; every site, classified:
//
// TOTAL enumerations — must name every settled member (or every
// suffix), and are MECHANISED below (`the prose census`): a member added
// to the union, or a count added to the fold, goes red at each until
// the prose is updated.
//   components/tool-views/view-dom.ts        REACHABILITY note (amended)
//   components/tool-views/action-view.ts     reachability note (amended)
//   components/tool-views/command-view.ts    reachability note (amended)
//   components/tool-views/file-edit-view.ts  reachability note (amended)
//   core/transcript-rows.ts                  the _toolStateOf ladder
//                                            comment (amended)
//   components/tool-call-rows.tsx            _mandatoryStateWordOf JSDoc
//                                            (amended);
//   components/activity-rail.tsx             FoldHeadline JSDoc (amended)
//   tests/tvc/registry.ts                    the TVC-082 assertion (amended)
//   docs/transcript-visual-contract.md       the TVC-082 bullet; the §8
//                                            vocabulary table; the fold-
//                                            suffix paragraph (all amended)
//
// PARTIAL enumerations — deliberately name a subset; correct as written,
// each with the reason, not mechanised (a subset has no total to check):
//   core/tool-view.ts            resultText doc: "withheld upstream on
//                                errored, denied, cancelled, refused and
//                                offloaded" (amended) — superseded is
//                                absent on purpose: a severed call's
//                                result never lands, so nothing is
//                                withheld. Also a WITHHELD-RESULT total
//                                site (mechanised: every settled
//                                member but superseded), with the README's
//                                twin sentence
//   core/tool-call-display.ts    the union's docblock explains the four
//                                non-AI-SDK extras (cancelled, superseded,
//                                refused, denied) — errored is the SDK's
//                                output-error; refused is the door's
//                                refusal, no SDK state
//   components/tool-row.tsx      header: "an inline state pill for
//                                failure / interruption / the door's
//                                refusal / a member's denial /
//                                awaiting-input" (amended)
//   components/operation-icons.tsx  header ink rule: "a cancelled,
//                                refused or member-denied call stays
//                                neutral" (amended); the STATE_WORDS
//                                table itself is code (census above)
//   components/tool-call-rows.tsx  the filledAnnex comment ("cannot mute an
//                                error, an interruption, a refusal, a
//                                member's denial, or a pending decision"
//                                — amended); the _toolViewOf comments
//                                (amended in the main change)
//   components/tool-views/action-view.ts:~198  "withholds output on
//                                errored calls" — about one guard, correct
//   core/tool-call-presentation.ts  settledSummary doc (amended)
//   core/subagent-rows.ts        the dispatch counts' "interrupted" word —
//                                dispatch vocabulary, out of class
//   components/markdown/reveal-pacer.ts  "finished, cancelled, parked or
//                                superseded" — the STREAM's states, out
//                                of class
//   fixtures/transcript/scenarios.tsx, docs §7 `states` row — the POSED
//                                rows of the state matrix (amended): refused
//                                is deliberately not posed, so neither is
//                                total
//   docs/tool-views.md "Lifecycle honesty" (amended); TVC-033 / TVC-038
//                                prose — single-state laws, correct
//   the class-level surface inventory record  a historical inventory, correct
//                                as a record of its date
//
// THE README's withheld-result sentence ("on errored, denied, cancelled,
//                  refused and offloaded settles the result stays
//                  withheld") is a registered WITHHELD-RESULT total site
//                  below — the causal scan alone cannot see it (a sentence
//                  that drops a member names no denial), so the
//                  enumeration check is what guards it.
//
// THE CLASS, widened: any factual claim in PROSE — a comment, docblock,
// JSDoc, fixture docblock, test prose, doc sentence or user-facing
// string — that this diff falsified. Four shapes, not one:
//   (1) an ENUMERATION of the state set, the suffix set or the settled
//       arms (mechanised above as the total sites);
//   (2) a CAUSAL claim about what a member's denial settles or reads as
//       ("a denial settles as cancelled / Interrupted / Didn't run") —
//       mechanised below (`the falsified-claim scan`) with a sanction
//       window, the repo's own precedent
//       (the serving side's retired-vocabulary law);
//   (3) a COUNT claim about something this diff touched — how many
//       consumers a helper has, how many fields an interface has, how
//       many recorders an entry ships — mechanised below (`the count
//       claims`): the numbers are counted from source and the words read
//       back;
//   (4) a USER-FACING SENTENCE naming the decision in a different word
//       than the row beside it — mechanised in the frontend census (the
//       receipt sentence and the row label must share the word).
//
// DIRECTORIES: the scan walks, in this tree,
//   src/, fixtures/, tests/, tests-e2e/, docs/, CHANGELOG.md, README.md
// and, in the frontend tree (its own census),
//   src/components/agent-run, src/components/agents/playground,
//   tests/agent-run, tests/playground.
// Excluded, with reasons: src/generated (generated), dist/ out/ results/
// node_modules (build products), the serving side and the repo-root
// contracts (the serving contract's `cancelled` clause describes the
// WIRE, where a denial IS a cancelled result — true, and the backend's
// file).
//
// THE WIDENED SITES, classified:
//   fixtures/transcript/canned-data.ts  CANCELLED_TOOL_CALL's docblock said
//                                the "Didn't run" register is what "a
//                                denial" settles as (amended; it wrapped
//                                across two lines, which a line-based grep
//                                misses, so the scan below joins line
//                                pairs)
//   core/approval-resolved.ts    "the one consumer" → two (amended); the
//                                field-set reasoning stands
//   tests/approval-resolved.test.ts  the same consumer claim in the test's
//                                prose and title (amended)
//   transcript.ts                fourteen/six/eight → fifteen/six/nine
//                                (amended)
//   core/transcript-rows.ts      "A cancelled tool (a denial, a steering
//                                guide)" — true at the wire only; now says
//                                so (amended)
//   the decision-surface coverage record  "(a denied call's cancelled
//                                receipt/pill)" — the pill is "Not
//                                approved" now (amended)
//   frontend agent-run/approval-resolved-row.tsx  "Request denied" beside a
//                                "Not approved" row → "Request not
//                                approved" (amended; premise and register
//                                decision in the file)
//   tests/transcript-sentinel-law.test.tsx  "control strings into cancelled
//                                tool results (CONFIRMATION_FAILED:,
//                                DENIED:…)" — the WIRE content of a denied
//                                approval's result, still cancelled there;
//                                correct
//   tests/tvc/tvc-dom.test.tsx, transcript-rows.test.ts, tvc-pure.test.ts,
//   message-list-activity-group.test.tsx  test prose written by this
//                                change ("the wire's cancelled stamp", "a
//                                denial arrives AS a cancel") — correct,
//                                and each sanctioned by its own wire word
//   docs/tool-views.md, CHANGELOG.md  "used to render cancelled" — correct
//   the class-level surface inventory and marker-projection audit records
//                                dated inventories with no denial claim;
//                                "fourteen marker kinds" counts the wire's
//                                markers, which this change did not add to
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../src");

const HANDLED: readonly string[] = [
  "core/tool-call-display.ts",
  "core/transcript-rows.ts",
  "components/operation-icons.tsx",
  "components/tool-row.tsx",
  "components/tool-call-rows.tsx",
  "components/tool-views/view-dom.ts",
];

const EXCLUDED: ReadonlyMap<string, string> = new Map([
  ["components/question-panel.tsx", "an elicitation card's status word"],
  ["core/question-receipt.ts", "an elicitation answer's kind"],
  ["core/elicitation-cards.ts", "the elicitation answer kind union"],
  ["core/elicitation-answers.ts", "an elicitation answer literal"],
  ["core/tool-flag-anchors.ts", "the wire's TOOL_CALL_RESULT field name"],
  ["core/tool-outcome.ts", "the wire's TOOL_CALL_RESULT field names, lifted"],
  ["core/tool-cancel-anchors.ts", "the same wire field, bound"],
  [
    "core/subagent-rows.ts",
    "DispatchCall's cancelled flag — a denied dispatch never becomes one",
  ],
  ["components/subagent-group-row.tsx", "the same dispatch-entry flag"],
]);

/** A file NAMES a member when it carries the quoted literal (a
 *  comparison, a union arm, a case label) or the bare object key (a
 *  Record table's row, a flag field) — both spellings a string-typed
 *  discriminant takes in this tree. */
function namesMember(text: string, member: string): boolean {
  return new RegExp(`["']${member}["']|\\b${member}:`).test(text);
}

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "generated") {
        yield* sourceFiles(full);
      }
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) {
      yield full;
    }
  }
}

function relative(file: string): string {
  return path.relative(SRC, file).split(path.sep).join("/");
}

describe("the ToolCallState site census", () => {
  const filesNaming = (member: string) =>
    [...sourceFiles(SRC)]
      .filter((file) => namesMember(readFileSync(file, "utf8"), member))
      .map(relative)
      .sort();
  const filesContaining = (text: string) =>
    [...sourceFiles(SRC)]
      .filter((file) => readFileSync(file, "utf8").includes(text))
      .map(relative)
      .sort();

  it('every file naming the "cancelled" member is classified — handled or excluded — and nothing else is', () => {
    const named = filesNaming("cancelled");
    const classified = [...HANDLED, ...EXCLUDED.keys()].sort();
    // Anti-vacuity: the census genuinely covers the ladder's home.
    expect(named).toContain("core/transcript-rows.ts");
    expect(named).toEqual(classified);
  });

  it('every handled site also names the "denied" member', () => {
    const naming = new Set(filesNaming("denied"));
    for (const site of HANDLED) {
      expect(naming.has(site), site).toBe(true);
    }
  });

  it("the excluded sites do not name the member — a reclassification, not a drift", () => {
    const naming = new Set(filesNaming("denied"));
    for (const [site, reason] of EXCLUDED) {
      expect(naming.has(site), `${site} — ${reason}`).toBe(false);
    }
  });

  it("the union's one Record table is the state-word table", () => {
    expect(filesContaining("Record<ToolCallState")).toEqual([
      "components/operation-icons.tsx",
    ]);
  });

  it("the fold model carries no outcome count, and the headline renders no tally", () => {
    const folds = readFileSync(path.join(SRC, "core/run-folds.ts"), "utf8");
    // The four counts left with their last renderer: a step's word is its
    // own row pill's, read by the member who opens the fold.
    expect(folds.includes("StepCount")).toBe(false);
    const headline = readFileSync(
      path.join(SRC, "components/activity-rail.tsx"),
      "utf8",
    );
    for (const suffix of [
      " failed`",
      " interrupted`",
      " declined`",
      " not approved`",
    ]) {
      expect(headline.includes(suffix), suffix).toBe(false);
    }
    expect(headline.includes("StepCount")).toBe(false);
  });
});

// --- the prose census: the TOTAL enumerations, mechanised -----------------
//
// Cheap and unfragile by construction: the members come from the union's
// own source text, the pill words from STATE_WORDS' source, the suffix
// words from the fold's count fields — nothing is duplicated here that
// the code already states. Each registered site is an excerpt between
// two distinctive markers (or the doc block above a declaration), and
// must name every settled member in its own vocabulary — by STEM, so a
// comment may say "supersession" or "a denial" and still count. A site
// whose markers move fails with the marker named, never silently.

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** The members, parsed from the union — never a hand copy. */
function stateMembers(): string[] {
  const source = read("src/core/tool-call-display.ts");
  const union = /export type ToolCallState =\s*((?:\|\s*"[^"]+"\s*)+);/.exec(
    source,
  );
  if (union === null) {
    throw new Error("the ToolCallState union was not found");
  }
  return [...union[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

/** Running and settled-clean: the members no settled-arm enumeration
 *  names. Everything else in the union is a settled arm. */
const NOT_A_SETTLED_ARM = new Set([
  "input-streaming",
  "input-available",
  "output-available",
]);

/** Each member's prose stem — the regex an enumeration must match. A
 *  member without an entry falls back to its own spelling, so a NEW
 *  member is looked for verbatim until someone records its prose. */
const PROSE_STEM: Partial<Record<string, RegExp>> = {
  "output-error": /\b(errored|output-error|failed|failure)\b/i,
  denied: /\b(denied|denial)\b/i,
  cancelled: /\b(cancelled|cancellation|cancel)\b/i,
  refused: /\b(refused|refusal)\b/i,
  superseded: /\b(superseded|supersession|severed)\b/i,
};

function stemOf(member: string): RegExp {
  return PROSE_STEM[member] ?? new RegExp(`\\b${member}\\b`, "i");
}

/** The pill words, parsed from STATE_WORDS' source. */
function pillWords(): Map<string, string> {
  const source = read("src/components/operation-icons.tsx");
  const table =
    /const STATE_WORDS: Record<ToolCallState, string> = \{([^}]*)\}/.exec(
      source,
    );
  if (table === null) {
    throw new Error("STATE_WORDS was not found");
  }
  const words = new Map<string, string>();
  for (const match of table[1].matchAll(/^\s*"?([\w-]+)"?:\s*"([^"]+)",?$/gm)) {
    words.set(match[1], match[2]);
  }
  return words;
}

/** The pill words a settled step can wear inside a fold — the words the
 *  headline once tallied and now leaves to each row. Where the headline's
 *  silence is explained, every one of them must still be named. */
const PILL_WORDS = ["failed", "interrupted", "declined", "not approved"];

function excerpt(
  text: string,
  start: string,
  end: string,
  site: string,
): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  if (from === -1 || to === -1) {
    throw new Error(`${site}: the excerpt markers moved (${start} … ${end})`);
  }
  return text.slice(from, to);
}

/** The doc block immediately above a declaration. */
function docBlockAbove(
  text: string,
  declaration: string,
  site: string,
): string {
  const at = text.indexOf(declaration);
  const open = text.lastIndexOf("/**", at);
  if (at === -1 || open === -1) {
    throw new Error(`${site}: the declaration or its doc block moved`);
  }
  return text.slice(open, at);
}

interface TotalSite {
  site: string;
  text: () => string;
}

const SETTLED_ARM_SITES: TotalSite[] = [
  {
    site: "view-dom.ts REACHABILITY note",
    text: () =>
      excerpt(
        read("src/components/tool-views/view-dom.ts"),
        "REACHABILITY, recorded",
        "export function settledOutcomeNotesOf",
        "view-dom.ts",
      ),
  },
  // Each built-in's note runs from its "settledOutcomeNotesOf arms" entry
  // to the next entry of its own reachability list.
  ...(
    [
      ["action-view", "//   resultText === undefined"],
      ["command-view", "//   call.truncated arm"],
      ["docs-search-view", "//   call.truncated arm"],
      ["file-edit-view", "//   elision marking"],
    ] as const
  ).map(([view, nextEntry]) => ({
    site: `${view}.ts reachability note`,
    text: () =>
      excerpt(
        read(`src/components/tool-views/${view}.ts`),
        "settledOutcomeNotesOf arms — REACHABLE",
        nextEntry,
        `${view}.ts`,
      ),
  })),
  {
    site: "transcript-rows.ts _toolStateOf ladder comment",
    text: () =>
      excerpt(
        read("src/core/transcript-rows.ts"),
        "// A recorded error → the call failed",
        "function _toolStateOf(",
        "transcript-rows.ts",
      ),
  },
  {
    site: "registry.ts TVC-082 assertion",
    text: () =>
      excerpt(
        read("tests/tvc/registry.ts"),
        'id: "TVC-082"',
        'id: "TVC-083"',
        "registry.ts",
      ),
  },
  {
    site: "transcript-visual-contract.md TVC-082 bullet",
    text: () =>
      excerpt(
        read("docs/transcript-visual-contract.md"),
        "**TVC-082**",
        "**TVC-083**",
        "TVC-082 bullet",
      ),
  },
];

describe("the prose census — total enumerations name every settled member", () => {
  const settled = stateMembers().filter(
    (member) => !NOT_A_SETTLED_ARM.has(member),
  );

  it("the union parse is live: five settled arms today, denied among them", () => {
    expect(settled).toContain("denied");
    expect(settled.length).toBeGreaterThanOrEqual(5);
  });

  for (const { site, text } of SETTLED_ARM_SITES) {
    it(`${site} names every settled member`, () => {
      const prose = text();
      for (const member of settled) {
        expect(
          stemOf(member).test(prose),
          `${site} does not name ${member}`,
        ).toBe(true);
      }
    });
  }

  // The WITHHELD-RESULT sites: the two sentences that enumerate the
  // settles on which the result stays withheld. Total over every settled
  // member EXCEPT superseded — a severed call's result never lands, so
  // there is nothing to withhold; that one exclusion is the sentence's
  // meaning, not a gap.
  const WITHHELD_RESULT_SITES: TotalSite[] = [
    {
      site: "README.md — the view-author contract's withheld-result sentence",
      text: () =>
        excerpt(
          read("README.md"),
          "Views and **icons** both mount",
          "the mount slot.",
          "README.md",
        ),
    },
    {
      site: "tool-view.ts resultText doc",
      text: () =>
        excerpt(
          read("src/core/tool-view.ts"),
          "The result verbatim from the wire",
          "resultText?: string;",
          "tool-view.ts",
        ),
    },
  ];

  for (const { site, text } of WITHHELD_RESULT_SITES) {
    it(`${site} names every settled member whose result is withheld`, () => {
      const prose = text();
      for (const member of settled.filter((each) => each !== "superseded")) {
        expect(
          stemOf(member).test(prose),
          `${site} does not name ${member}`,
        ).toBe(true);
      }
    });
  }

  it("the §8 vocabulary table maps every settled member the migration named", () => {
    const table = excerpt(
      read("docs/transcript-visual-contract.md"),
      "## 8. State and vocabulary mapping",
      "**The `todo` vocabulary member.**",
      "§8 table",
    );
    // The table maps the MIGRATION's product terms onto the protocol
    // vocabulary; "failed" predates that vocabulary and has no row (its
    // law is TVC-033, and adding a row is the documentation lane's
    // prose). Recorded here as the one exclusion, so a NEW member still
    // fails until the table maps it.
    const NOT_A_MIGRATION_TERM = new Set(["output-error"]);
    for (const member of settled) {
      if (NOT_A_MIGRATION_TERM.has(member)) {
        continue;
      }
      expect(table.includes(`"${member}"`), `§8 does not map "${member}"`).toBe(
        true,
      );
    }
  });

  it("_mandatoryStateWordOf's JSDoc names every settled member's pill word", () => {
    const words = pillWords();
    const doc = docBlockAbove(
      read("src/components/tool-call-rows.tsx"),
      "function _mandatoryStateWordOf(",
      "_mandatoryStateWordOf",
    );
    for (const member of settled) {
      const word = words.get(member);
      expect(word, `STATE_WORDS has no word for ${member}`).toBeDefined();
      expect(
        doc.includes(word ?? ""),
        `the JSDoc omits ${word ?? "?"} (${member})`,
      ).toBe(true);
    }
  });

  it("the pill words are still enumerated where the headline's silence is explained — FoldHeadline's JSDoc and the contract's fold paragraph", () => {
    const words = PILL_WORDS;
    const jsdoc = docBlockAbove(
      read("src/components/activity-rail.tsx"),
      "function FoldHeadline(",
      "FoldHeadline",
    );
    const paragraph = excerpt(
      read("docs/transcript-visual-contract.md"),
      "The settled register reads the typed duration",
      "- **TVC-010**",
      "fold paragraph",
    );
    for (const word of words) {
      expect(jsdoc.includes(word), `FoldHeadline's JSDoc omits "${word}"`).toBe(
        true,
      );
      expect(
        paragraph.includes(word),
        `the fold paragraph omits "${word}"`,
      ).toBe(true);
      expect(
        paragraph.includes(`· N ${word}`),
        `the fold paragraph still promises a "· N ${word}" tally`,
      ).toBe(false);
    }
  });
});

// --- the falsified-claim scan (shape 2) --------------------------------------
//
// Every PROSE line pair in the widened directories that ties a member's
// denial to the cancelled / Interrupted / "Didn't run" reading must sit
// within a sanction window — a nearby word that makes the sentence a
// true one (the WIRE stamps a denial cancelled; the state OUTRANKS that
// stamp; a denial USED TO read Interrupted; NEVER / NOT / WOULD …). A
// claim with no such word is the stale shape — a fixture docblock
// carried it — and goes red here. Prose only: the union's adjacent
// `"denied" | "cancelled"` members and a test's state arrays are code,
// not claims. Pairs, not lines: that docblock wrapped across two.

const SCAN_ROOTS = [
  "src",
  "fixtures",
  "tests",
  "tests-e2e",
  "docs",
  "CHANGELOG.md",
  "README.md",
];
const SCAN_SKIP = new Set([
  "generated",
  "out",
  "results",
  "dist",
  "node_modules",
]);
// This census is the RECORD of the stale claims and quotes them; it is
// the one file the scan does not read.
const SCAN_SKIP_FILES = new Set(["tests/tool-call-state-sites.test.ts"]);
const DENIAL_WORD = /\b(denial|denials|denied|deny|denies)\b/i;
const STALE_READING = /\b(cancelled|interrupted)\b|didn't run/i;
// "model-facing": the sentinel law's prose — Strands writes control
// strings into the WIRE's cancelled results — is a wire truth.
const SANCTION =
  /\b(wire|stamp|stamped|stamps|receipt|TOOL_CALL_RESULT|model-facing|used to|no longer|never|not|would|outrank|outranks|above|instead|rather than|left this|TVC-039|reclassif\w*|predates|before|since|at the wire)\b/i;

function* proseFiles(dir: string): Generator<string> {
  if (statSync(dir).isFile()) {
    yield dir;
    return;
  }
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SCAN_SKIP.has(entry)) {
        yield* proseFiles(full);
      }
    } else if (/\.(ts|tsx|md)$/.test(entry)) {
      yield full;
    }
  }
}

/** The prose BLOCKS of a file — each a run of consecutive prose lines:
 *  in a markdown file a paragraph (blank-line separated); in a TypeScript
 *  file a run of adjacent comment lines (`//`, `*`, `/**`, `{/*`). Pairs
 *  are joined and the sanction window is judged WITHIN the block: a
 *  neighbouring docblock's sanction word must not vouch for this one (the
 *  first cut of this scan let exactly that happen — its own negative
 *  control caught it). */
function proseBlocksOf(file: string): { line: number; text: string }[][] {
  const lines = readFileSync(file, "utf8").split("\n");
  const isProse = file.endsWith(".md")
    ? (text: string) => text.trim() !== ""
    : (text: string) => /^\s*(\/\/|\*|\/\*\*?|\{\/\*)/.test(text);
  const blocks: { line: number; text: string }[][] = [];
  let current: { line: number; text: string }[] = [];
  lines.forEach((text, index) => {
    if (isProse(text)) {
      current.push({ line: index + 1, text });
    } else if (current.length > 0) {
      blocks.push(current);
      current = [];
    }
  });
  if (current.length > 0) {
    blocks.push(current);
  }
  return blocks;
}

/** The unsanctioned denial→stale-reading claims under a root. */
function unsanctionedDenialClaims(
  roots: readonly string[],
  base: string,
): string[] {
  const hits: string[] = [];
  for (const root of roots) {
    for (const file of proseFiles(path.join(base, root))) {
      if (
        SCAN_SKIP_FILES.has(path.relative(base, file).split(path.sep).join("/"))
      ) {
        continue;
      }
      for (const block of proseBlocksOf(file)) {
        for (let i = 0; i < block.length; i += 1) {
          const pair = `${block[i].text} ${block[i + 1]?.text ?? ""}`;
          if (!DENIAL_WORD.test(pair) || !STALE_READING.test(pair)) {
            continue;
          }
          const window = block
            .slice(Math.max(0, i - 2), i + 4)
            .map((entry) => entry.text)
            .join(" ");
          if (!SANCTION.test(window)) {
            hits.push(
              `${path.relative(base, file)}:${String(block[i].line)}: ${pair.trim().slice(0, 140)}`,
            );
          }
        }
      }
    }
  }
  return hits;
}

describe("the falsified-claim scan — no prose says a denial settles as cancelled or Interrupted", () => {
  it("walks every prose-bearing directory of this tree and finds no unsanctioned claim", () => {
    // Anti-vacuity: the walk covers the fixture that carried the stale claim.
    expect(
      [...proseFiles(path.join(ROOT, "fixtures"))].some((file) =>
        file.endsWith("canned-data.ts"),
      ),
    ).toBe(true);
    expect(unsanctionedDenialClaims(SCAN_ROOTS, ROOT)).toEqual([]);
  });
});

// --- the count claims (shape 3) ---------------------------------------------

const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
];

describe("the count claims — numbers in prose are counted from source", () => {
  it("the ./transcript scope note's three counts match the snapshot's fields and the entry's recorders", () => {
    const snapshot = excerpt(
      read("src/core/connection-epoch.ts"),
      "export interface MarkerAnchorsSnapshot",
      "\n}",
      "MarkerAnchorsSnapshot",
    );
    const fields = [...snapshot.matchAll(/^\s+(\w+Anchors)\??:/gm)].length;
    const entry = read("src/transcript.ts");
    // The note counts the ANCHOR FAMILIES' recorders — the ones exported
    // from a core/*-anchors.js module and feeding MarkerAnchorsSnapshot —
    // because its third count subtracts them from the snapshot's fields.
    // The entry also ships the approval inbox's recorder
    // (approvalInboxRecorder, from core/approval-inbox.js), which feeds
    // the inbox and no snapshot field, so a bare "*Recorder," count would
    // make the subtraction lie; the export blocks are read by their
    // source module instead.
    const recorders = [
      ...entry.matchAll(
        /export \{\n([^}]*)\} from "\.\/core\/[\w-]+-anchors\.js";/g,
      ),
    ].reduce(
      (count, block) =>
        count + [...block[1].matchAll(/^\s+\w+Recorder,$/gm)].length,
      0,
    );
    const note = excerpt(
      entry,
      "Scope note: MarkerAnchorsSnapshot has",
      "export {",
      "scope note",
    ).toLowerCase();
    // Anti-vacuity: the parses are live.
    expect(fields).toBeGreaterThanOrEqual(15);
    expect(recorders).toBeGreaterThanOrEqual(6);
    expect(
      note.includes(`${NUMBER_WORDS[fields]} anchor fields`),
      `the note should say "${NUMBER_WORDS[fields]} anchor fields"`,
    ).toBe(true);
    expect(
      note.includes(`recorders for ${NUMBER_WORDS[recorders]}`),
      `the note should say "recorders for ${NUMBER_WORDS[recorders]}"`,
    ).toBe(true);
    expect(
      note.includes(`the other ${NUMBER_WORDS[fields - recorders]} are`),
      `the note should say "the other ${NUMBER_WORDS[fields - recorders]} are"`,
    ).toBe(true);
  });

  it("approval-resolved.ts names as many consumers as import it", () => {
    const importers = [...sourceFiles(SRC)].filter((file) =>
      /from "(\.|\.\.\/core|\.\/core)\/approval-resolved\.js"/.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(importers.length).toBeGreaterThanOrEqual(2);
    const header = read("src/core/approval-resolved.ts").toLowerCase();
    expect(
      header.includes(`the ${NUMBER_WORDS[importers.length]} consumers`),
      `the header should say "the ${NUMBER_WORDS[importers.length]} consumers"`,
    ).toBe(true);
  });
});
