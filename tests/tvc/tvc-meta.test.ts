// The registry's honesty gate. The visual contract's laws live in
// registry.ts; their tests live across tests/ and tests-e2e/. This
// suite fails when either side drifts — a law with no test, a test
// claiming an unregistered id, an id claimed twice, a parked law test
// (any form law-tests.ts detects), an unpinned runtime skip, a runner
// that would not select a law file, or a `.only` anywhere. The scan
// (law-tests.ts) parses the test files statically, never executes
// them, and is shared with TVC-180 (tvc-pure.test.ts); this file is
// excluded from the scan, so its parked-law arm vouches for TVC-180's
// own declaration.

import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  PLAYWRIGHT_DEFAULT_TEST_MATCH,
  SANCTIONED_GATE_DEFINITION,
  SANCTIONED_RUNTIME_SKIPS,
  parkedLawTests,
  scanLawTests,
  testFilesUnder,
  TVC_ID,
} from "./law-tests";
import { TVC_BINDINGS, TVC_LAWS } from "./registry";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../..");
const CONTRACT_DOC = path.join(
  PACKAGE_ROOT,
  "docs/transcript-visual-contract.md",
);
const PLAYWRIGHT_COMMON_SUBPATH = "playwright/lib/common/index.js";

/** Playwright's config defaults live in `lib/common/index.js`, which the
 *  package's exports map does not expose, so the file is located through
 *  `playwright/package.json` as resolved FROM `@playwright/test` — the
 *  copy the runner actually loads, whether hoisted beside it or nested
 *  under it. Every failure mode names the file and the constants to
 *  re-pin instead of surfacing as a broken read. */
function readPlaywrightCommon(): string {
  const requireHere = createRequire(import.meta.url);
  let playwrightPackageJson: string;
  try {
    const requireFromPlaywrightTest = createRequire(
      requireHere.resolve("@playwright/test/package.json"),
    );
    playwrightPackageJson = requireFromPlaywrightTest.resolve(
      "playwright/package.json",
    );
  } catch (error) {
    throw new Error(
      `cannot resolve playwright/package.json from @playwright/test (${String(error)}) — @playwright/test no longer depends on playwright the way this pin assumes: find where the default testMatch now lives, re-point readPlaywrightCommon in tests/tvc/tvc-meta.test.ts, and re-check RUNNER_FILE_PATTERNS["tests-e2e"] in tests/tvc/law-tests.ts`,
    );
  }
  const file = path.join(
    path.dirname(playwrightPackageJson),
    "lib/common/index.js",
  );
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(
      `cannot read ${PLAYWRIGHT_COMMON_SUBPATH} at ${file} (${String(error)}) — the installed Playwright restructured its lib: find where the default testMatch now lives, re-point readPlaywrightCommon in tests/tvc/tvc-meta.test.ts, and re-check RUNNER_FILE_PATTERNS["tests-e2e"] in tests/tvc/law-tests.ts`,
    );
  }
}

// Every law says which transcript it binds. The read is deliberately
// loose — `binds?: unknown`, never the registry's own union — so this
// check still fires at runtime if a future lane widens the field to
// optional or renames a token, instead of narrowing itself into vacuity
// alongside the type.
function bindingDefectOf(law: { id: string; binds?: unknown }): string | null {
  if (law.binds === undefined) {
    return `${law.id} declares no binding`;
  }
  if (
    typeof law.binds !== "string" ||
    !(TVC_BINDINGS as readonly string[]).includes(law.binds)
  ) {
    return `${law.id} declares an unknown binding token: ${JSON.stringify(law.binds)}`;
  }
  return null;
}

describe("the TVC registry itself", () => {
  it("holds well-formed, unique, sorted ids", () => {
    const ids = TVC_LAWS.map((law) => law.id);
    for (const id of ids) {
      expect(id).toMatch(/^TVC-\d{3}$/);
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it("every law declares which transcript it binds", () => {
    for (const law of TVC_LAWS) {
      expect(bindingDefectOf(law), law.id).toBeNull();
    }
  });

  it("both binding tokens are in live use — the axis cannot rot into decoration", () => {
    const used = new Set<string>(TVC_LAWS.map((law) => law.binds));
    for (const token of TVC_BINDINGS) {
      expect(used.has(token), `no law binds ${token}`).toBe(true);
    }
  });

  // The committed negative controls: the binding check posed against
  // the two defects it exists to catch, kept in the suite so a
  // reviewer verifies falsifiability rather than authors it.
  it("the binding check can fail — a law with no binding, and an unknown token", () => {
    expect(bindingDefectOf({ id: "TVC-000" })).toBe(
      "TVC-000 declares no binding",
    );
    expect(bindingDefectOf({ id: "TVC-000", binds: "everything" })).toBe(
      'TVC-000 declares an unknown binding token: "everything"',
    );
  });

  // A one-word flip of `binds` narrows a law's reach as quietly as
  // deleting a sentence, and the well-formedness checks above cannot see
  // it. This pin holds the reviewed census exactly — a re-scope in
  // either direction fails here until the pin is edited beside it, so
  // the change is loud in the diff. Which side a law belongs on stays a
  // reviewed human judgment (the counterpart ledger's rule); narrowing
  // takes the same explicit PR-description callout as weakening an
  // assertion (the registry header).
  const PACKAGE_BOUND_CENSUS: readonly string[] = [
    "TVC-001",
    "TVC-041",
    "TVC-042",
    "TVC-050",
    "TVC-051",
    "TVC-052",
    "TVC-053",
    "TVC-060",
    "TVC-061",
    "TVC-063",
    "TVC-064",
    "TVC-067",
    "TVC-070",
    "TVC-071",
    "TVC-074",
    "TVC-075",
    "TVC-076",
    "TVC-092",
    "TVC-102",
    "TVC-103",
    "TVC-120",
    "TVC-121",
    "TVC-122",
    "TVC-123",
    "TVC-124",
    "TVC-125",
    "TVC-126",
    "TVC-140",
    "TVC-141",
    "TVC-142",
    "TVC-143",
    "TVC-144",
    "TVC-145",
    "TVC-146",
    "TVC-147",
    "TVC-148",
    "TVC-149",
    "TVC-150",
    "TVC-151",
    "TVC-152",
    "TVC-153",
    "TVC-154",
    "TVC-155",
    "TVC-156",
    "TVC-157",
    "TVC-158",
    "TVC-159",
    "TVC-160",
    "TVC-161",
    "TVC-162",
    "TVC-170",
    "TVC-171",
    "TVC-172",
    "TVC-173",
    "TVC-180",
    "TVC-190",
  ];

  it("the package-binder census is pinned exactly — a silent re-scope fails here", () => {
    const bound = TVC_LAWS.filter((law) => law.binds === "package-binder").map(
      (law) => law.id,
    );
    expect(bound).toEqual([...PACKAGE_BOUND_CENSUS]);
  });

  // The committed negative control for the pin: TVC-130 carries the
  // redaction floor — the exact law a silent narrowing would exempt
  // from the agent binder. Flip it in a copy and prove the census
  // comparison names it.
  it("the census pin can fail — a silent narrowing of the redaction floor is named", () => {
    const narrowed = TVC_LAWS.map((law) =>
      law.id === "TVC-130" ? { ...law, binds: "package-binder" as const } : law,
    );
    const bound = narrowed
      .filter((law) => law.binds === "package-binder")
      .map((law) => law.id);
    expect(bound).not.toEqual([...PACKAGE_BOUND_CENSUS]);
    expect(bound.filter((id) => !PACKAGE_BOUND_CENSUS.includes(id))).toEqual([
      "TVC-130",
    ]);
  });
});

describe("the registry and the tests stay in lockstep", () => {
  const scan = scanLawTests();
  const { found, titleCount, onlyIn, multiIdTitles } = scan;

  it("finds the test corpus at all — the scanner's own health check", () => {
    // A broken declaration regex would silently zero the scan and pass
    // every absence check; the suite is far larger than the registry.
    expect(titleCount).toBeGreaterThanOrEqual(TVC_LAWS.length);
  });

  it("no test file carries .only, and no title claims two laws", () => {
    expect(onlyIn, ".only in").toEqual([]);
    expect(multiIdTitles, "one law per test").toEqual([]);
  });

  // The release gate's own vouch: TVC-180 asserts the parked-law list
  // empty from tvc-pure.test.ts, a file the scan reads, so a skip on
  // TVC-180 itself would silence the check for every law. This file is
  // excluded from the scan and asserts the same list, TVC-180's own
  // declaration included.
  it("no registered law's test is parked — skip modifier, skipped or conditional group, runtime skip, unreachable file — TVC-180's own declaration included", () => {
    const registered = new Set(TVC_LAWS.map((law) => law.id));
    expect(
      parkedLawTests(scan, registered),
      "parked law tests — there is no parked state",
    ).toEqual([]);
  });

  // The two Linux-only screenshot gates are the only runtime skips, and
  // they are pinned by file, callee and condition — a third runtime skip
  // anywhere under tests/ or tests-e2e/ lands here until it is added to
  // the census with its reason. Anti-vacuity: both gates must exist and
  // define their condition as the Linux platform test.
  it("the runtime skip census is exactly the two Linux-only screenshot gates", () => {
    expect(
      scan.runtimeSkips
        .map((skip) => `${skip.file} ${skip.callee}(${skip.condition})`)
        .sort(),
    ).toEqual(
      SANCTIONED_RUNTIME_SKIPS.map(
        (gate) => `${gate.file} ${gate.callee}(${gate.condition})`,
      ).sort(),
    );
    for (const gate of SANCTIONED_RUNTIME_SKIPS) {
      expect(
        SANCTIONED_GATE_DEFINITION.test(
          readFileSync(path.join(PACKAGE_ROOT, gate.file), "utf8"),
        ),
        `${gate.file} must define SCREENSHOTS_UNAVAILABLE as os.platform() !== "linux"`,
      ).toBe(true);
    }
  });

  // The runner configuration is part of the claim: a law file the runner
  // never selects is as parked as a skipped one. The scan already reds a
  // law in a file outside its runner's pattern; these pins hold the
  // patterns themselves and the package scripts that invoke the runners
  // without exclusions.
  it("the runners select every law file — vitest include, Playwright testDir and the package scripts are pinned", () => {
    const vitestConfig = readFileSync(
      path.join(PACKAGE_ROOT, "vitest.config.mts"),
      "utf8",
    );
    expect(vitestConfig).toContain('include: ["tests/**/*.test.{ts,tsx}"]');
    expect(vitestConfig).not.toMatch(/\bexclude\b/);
    const playwrightConfig = readFileSync(
      path.join(PACKAGE_ROOT, "playwright.config.ts"),
      "utf8",
    );
    expect(playwrightConfig).toContain('testDir: "tests-e2e"');
    expect(playwrightConfig).not.toMatch(
      /\b(?:testMatch|testIgnore|grep|grepInvert|projects)\b/,
    );
    // The scan's e2e file pattern mirrors Playwright's DEFAULT testMatch,
    // pinned against the installed runner's own source so an upgrade that
    // changes the default lands here with the fix spelled out. `playwright`
    // is not a declared dependency (only `@playwright/test` is), so it is
    // resolved the way `@playwright/test` itself resolves it — hoisted or
    // nested — through the one subpath its exports map exposes, and a
    // restructured lib reds with a message rather than an ENOENT crash.
    const playwrightCommon = readPlaywrightCommon();
    expect(
      playwrightCommon.includes(`"${PLAYWRIGHT_DEFAULT_TEST_MATCH}"`),
      `the installed Playwright no longer ships "${PLAYWRIGHT_DEFAULT_TEST_MATCH}" as its default testMatch (${PLAYWRIGHT_COMMON_SUBPATH}) — an upgrade changed it: re-read the default there and update PLAYWRIGHT_DEFAULT_TEST_MATCH and RUNNER_FILE_PATTERNS["tests-e2e"] in tests/tvc/law-tests.ts together`,
    ).toBe(true);
    const scripts = (
      JSON.parse(
        readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
      ) as { scripts: Record<string, string> }
    ).scripts;
    expect(scripts.test).toBe("vitest run");
    expect(scripts["test:screenshot"]).toBe("playwright test");
  });

  it("every law has exactly one test carrying its id", () => {
    const claimed = new Map<string, string[]>();
    for (const test of found) {
      claimed.set(test.id, [
        ...(claimed.get(test.id) ?? []),
        `${test.file}: "${test.title}"`,
      ]);
    }
    for (const law of TVC_LAWS) {
      const sites = claimed.get(law.id) ?? [];
      expect(
        sites.length,
        `${law.id} ("${law.assertion}") must be carried by exactly one test; found ${String(sites.length)}: ${sites.join("; ")}`,
      ).toBe(1);
    }
  });

  it("every test id is a registered law", () => {
    const registered = new Set(TVC_LAWS.map((law) => law.id));
    for (const test of found) {
      expect(
        registered.has(test.id),
        `${test.file} claims unregistered ${test.id}: "${test.title}"`,
      ).toBe(true);
    }
  });

  // The prose contract is the artifact nine lanes read first, so its id
  // coverage is held in the same lockstep as the tests. Only PRESENCE is
  // machine-checked — sentences can't be — so a semantic drift in prose
  // remains a reviewed contract change (the document says so itself).
  it("every law appears in the contract document, and the document names no ghost laws", () => {
    const doc = readFileSync(CONTRACT_DOC, "utf8");
    const named = new Set(doc.match(TVC_ID) ?? []);
    for (const law of TVC_LAWS) {
      expect(
        named.has(law.id),
        `${law.id} ("${law.assertion}") has no entry in docs/transcript-visual-contract.md`,
      ).toBe(true);
    }
    const registered = new Set(TVC_LAWS.map((law) => law.id));
    for (const id of named) {
      expect(
        registered.has(id),
        `docs/transcript-visual-contract.md names unregistered ${id}`,
      ).toBe(true);
    }
  });

  // The binding tokens are contract vocabulary, so the document must
  // define both — derived from the registry's own array, in the
  // maxDiffPixels pin's idiom, so renaming a token edits both files or
  // fails here.
  it("the contract document names both binding tokens verbatim", () => {
    const doc = readFileSync(CONTRACT_DOC, "utf8");
    for (const token of TVC_BINDINGS) {
      expect(
        doc.includes(`\`${token}\``),
        `docs/transcript-visual-contract.md never names \`${token}\``,
      ).toBe(true);
    }
  });
});

// The counterpart ledger. The pixel layer's blind spots are measured
// (the contract, §7): a screenshot law's real enforcement often lives
// in dom/geometry/pure laws asserting the same property, so every
// screenshot law must DECLARE those counterparts — or an explicit
// empty list acknowledging the property is pixel-pinned only. This
// block keeps the ledger well-formed; which laws belong on each list
// is reviewed contract content, not machine-checkable.
describe("screenshot laws declare their non-pixel counterparts", () => {
  const registered = new Map(TVC_LAWS.map((law) => [law.id, law]));

  it("every screenshot law carries a counterparts ledger, and only screenshot laws do", () => {
    for (const law of TVC_LAWS) {
      if (law.layer === "screenshot") {
        expect(
          law.counterparts,
          `${law.id} is a screenshot law and must declare counterparts (an explicit [] acknowledges a pixel-only gap)`,
        ).toBeDefined();
      } else {
        expect(
          law.counterparts,
          `${law.id} (${law.layer}) must not declare counterparts — the ledger is the screenshot layer's shape`,
        ).toBeUndefined();
      }
    }
  });

  it("every declared counterpart is a registered law off the pixel layer", () => {
    for (const law of TVC_LAWS) {
      for (const id of law.counterparts ?? []) {
        const counterpart = registered.get(id);
        expect(
          counterpart,
          `${law.id} cites ${id}, which is not a registered law`,
        ).toBeDefined();
        expect(
          counterpart?.layer,
          `${law.id} cites ${id} — a counterpart must live off the pixel layer`,
        ).not.toBe("screenshot");
      }
    }
  });
});

// One mechanism, two symptoms — "the meta-test only checks id presence
// / shape, so nothing catches this": a stale budget claim in the
// contract prose and a newly minted decade-mate missing from a ledger.
// These two blocks close that mechanism where it CAN be closed
// mechanically. What stays human, and why: whether a law belongs in a
// ledger is semantic judgment — TVC-041 anchors its test on the rhythm
// scenario yet the property holds wherever a fold expands, so scenario-
// or decade-derived MEMBERSHIP would be both under- and over-inclusive.
// The rule below never decides membership; it only refuses silence:
// every decade-mate of a cited decade must be placed, on one side or
// the other, in writing. Likewise doc SENTENCES stay unreviewable by
// machine; the one numeric claim the doc makes about the comparator is
// pinned to the config verbatim.
describe("ledger content: decade completeness with written exclusions", () => {
  const registered = new Map(TVC_LAWS.map((law) => [law.id, law]));
  const decadeOf = (id: string) => id.slice(0, 6);

  it("every cited decade is fully placed — each enforced non-screenshot decade-mate is a counterpart or a reasoned exclusion", () => {
    for (const law of TVC_LAWS) {
      if (law.layer !== "screenshot") {
        continue;
      }
      const cited = new Set(law.counterparts ?? []);
      const excluded = new Set(
        (law.counterpartExclusions ?? []).map((exclusion) => exclusion.id),
      );
      const citedDecades = new Set([...cited].map(decadeOf));
      for (const other of TVC_LAWS) {
        if (
          other.id === law.id ||
          other.layer === "screenshot" ||
          !citedDecades.has(decadeOf(other.id))
        ) {
          continue;
        }
        expect(
          cited.has(other.id) || excluded.has(other.id),
          `${law.id}'s ledger cites decade ${decadeOf(other.id)}x but leaves ${other.id} unplaced — cite it as a counterpart or exclude it with a written reason`,
        ).toBe(true);
      }
    }
  });

  it("exclusions are well-formed: screenshot laws only, registered non-screenshot ids from cited decades, never doubled, each with a reason", () => {
    for (const law of TVC_LAWS) {
      if (law.layer !== "screenshot") {
        expect(
          law.counterpartExclusions,
          `${law.id} (${law.layer}) must not declare counterpartExclusions — the ledger is the screenshot layer's shape`,
        ).toBeUndefined();
        continue;
      }
      const cited = new Set(law.counterparts ?? []);
      const citedDecades = new Set([...cited].map(decadeOf));
      const seen = new Set<string>();
      for (const exclusion of law.counterpartExclusions ?? []) {
        const target = registered.get(exclusion.id);
        expect(
          target,
          `${law.id} excludes ${exclusion.id}, which is not a registered law`,
        ).toBeDefined();
        expect(
          target?.layer,
          `${law.id} excludes ${exclusion.id} — exclusions place non-pixel laws only`,
        ).not.toBe("screenshot");
        expect(
          cited.has(exclusion.id),
          `${law.id} both cites and excludes ${exclusion.id}`,
        ).toBe(false);
        expect(
          seen.has(exclusion.id),
          `${law.id} excludes ${exclusion.id} twice`,
        ).toBe(false);
        seen.add(exclusion.id);
        expect(
          exclusion.reason.trim().length,
          `${law.id}'s exclusion of ${exclusion.id} carries no reason`,
        ).toBeGreaterThan(0);
        expect(
          citedDecades.has(decadeOf(exclusion.id)),
          `${law.id} excludes ${exclusion.id} from a decade its ledger does not cite — noise, not a placement`,
        ).toBe(true);
      }
    }
  });
});

describe("the contract doc's budget claim matches the shipped config", () => {
  it("playwright.config.ts carries exactly one active screenshot budget, and the doc names it verbatim", () => {
    const config = readFileSync(
      path.join(PACKAGE_ROOT, "playwright.config.ts"),
      "utf8",
    );
    const activeLines = config
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"));
    const budgets =
      activeLines.join("\n").match(/maxDiffPixel(?:s|Ratio):\s*[\d.]+/g) ?? [];
    expect(
      budgets,
      "exactly one active screenshot budget in playwright.config.ts",
    ).toHaveLength(1);
    const budget = budgets[0];
    if (budget === undefined) {
      throw new Error("unreachable: the assertion above requires one budget");
    }
    const doc = readFileSync(CONTRACT_DOC, "utf8");
    expect(
      doc,
      `the contract doc must name the config's current budget verbatim (\`${budget}\`) — a budget change edits both or fails here`,
    ).toContain(`\`${budget}\``);
  });
});

// An out-of-order law entry (the since-retired 068 law filed before
// TVC-067) is the same prose-drift mechanism as the stale budget claim
// above, one more leg. The doc's real convention is NOT global ascent:
// screenshot laws are listed beside the laws they picture (TVC-156 sits
// in Law 2's list) and whole sections may reorder (the provenance 13x
// section precedes the overlays 12x section), so the machine-checkable
// invariant is per-run: within each contiguous run of entry lines from
// one decade, ids strictly ascend, and no id gets two entry lines. What
// stays review-held, and why: whether the SENTENCE beside an id — or a
// docstring above code — still tells the truth is prose meaning, not
// machine-checkable; the budget literal above is the one numeric claim
// that is pinned.
describe("the contract doc's law-entry ordering", () => {
  it("entries ascend within each same-decade run, one entry line per id", () => {
    const doc = readFileSync(CONTRACT_DOC, "utf8");
    const entries = [...doc.matchAll(/^- \*\*(TVC-\d{3})\*\*/gm)].map(
      (match) => match[1],
    );
    // Rot guard only — not every law gets an entry LINE (the follow
    // contract's 14x laws are prose-documented); presence of every id is
    // the earlier doc-coverage test's job.
    expect(entries.length).toBeGreaterThan(50);
    const registered = new Set(TVC_LAWS.map((law) => law.id));
    for (const id of entries) {
      expect(registered.has(id), `${id} has an entry line but no law`).toBe(
        true,
      );
    }
    expect(new Set(entries).size).toBe(entries.length);
    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1];
      const current = entries[index];
      if (previous.slice(0, 6) !== current.slice(0, 6)) {
        continue;
      }
      expect(
        current > previous,
        `${current} is filed after ${previous} in the contract doc — same-decade entries ascend`,
      ).toBe(true);
    }
  });

  it("adjacent same-decade entries never span a section heading", () => {
    // Round 3: the since-retired 068 law landed one SECTION too far
    // down while still
    // ascending (067 was Law 7's last entry, 068 became Law 8's first) —
    // the ordering rule above is blind exactly at section boundaries.
    // A decade's entries belong to one law's list, so two adjacent
    // same-decade entries with a heading between them mean one of them
    // is filed under the wrong law. (Scattered screenshot entries sit
    // beside the laws they picture, but no two of them are ever
    // ADJACENT, so the pairwise rule stays exact.)
    const doc = readFileSync(CONTRACT_DOC, "utf8");
    const lines = doc.split("\n");
    const positioned: { id: string; line: number }[] = [];
    const headingLines = new Set<number>();
    for (const [index, line] of lines.entries()) {
      const entry = /^- \*\*(TVC-\d{3})\*\*/.exec(line);
      if (entry !== null) {
        positioned.push({ id: entry[1], line: index });
      }
      if (/^#{2,}\s/.test(line)) {
        headingLines.add(index);
      }
    }
    for (let index = 1; index < positioned.length; index += 1) {
      const previous = positioned[index - 1];
      const current = positioned[index];
      if (previous.id.slice(0, 6) !== current.id.slice(0, 6)) {
        continue;
      }
      const spansHeading = [...headingLines].some(
        (headingLine) =>
          headingLine > previous.line && headingLine < current.line,
      );
      expect(
        spansHeading,
        `${current.id} sits in a different section than its decade-mate ${previous.id} — filed under the wrong law?`,
      ).toBe(false);
    }
  });
});

// Round 3: TVC-159 took two baselines under hard asserts in one test
// body — the exact first-failure blindness round 2 fixed in the capture
// LOOPS, missed because that sweep searched for loops rather than for
// multi-baseline test bodies. Closed uniformly: every screenshot
// assertion in tests-e2e is soft (soft still fails the test — for a
// single-baseline body the semantics are identical; for a multi-baseline
// body every variant reports), so no future shape — loop, straight-line
// sequence, or helper — can reintroduce it.
describe("browser screenshot assertions are soft", () => {
  it("every toHaveScreenshot in tests-e2e rides expect.soft", () => {
    const specRoot = path.join(PACKAGE_ROOT, "tests-e2e");
    let screenshotCalls = 0;
    for (const file of testFilesUnder(specRoot)) {
      const source = readFileSync(file, "utf8");
      for (const statement of source.split("await ")) {
        if (!statement.includes(".toHaveScreenshot(")) {
          continue;
        }
        screenshotCalls += 1;
        expect(
          statement.replace(/\s+/g, "").includes("expect.soft("),
          `a hard toHaveScreenshot in ${path.relative(PACKAGE_ROOT, file)} — soft is the law (a multi-baseline body must report every variant): ${statement.slice(0, 80)}`,
        ).toBe(true);
      }
    }
    // Anti-vacuity: the scan genuinely saw the suite's captures.
    expect(screenshotCalls).toBeGreaterThanOrEqual(9);
  });
});

// The capture clock regime's two coverage claims were prose in three
// places each, and a hand-maintained list drifts silently where a
// criterion cannot (the reasoning that already gave the scroller ONE
// exported spelling). Both claims are enforced here instead of
// asserted:
//   1. "TVC-190 gates every scenario capture" — structural plus scan:
//      the gate rides openScenarioAtTickingNow's body (the open IS the
//      gate), and the capture spec can neither open frozen outside
//      TVC-190's own negative control nor bypass the wrapper through
//      bare openScenario.
//   2. "who still opens a non-elapsing clock" — a pinned census of
//      openScenarioAtFixedNow call sites, derived by scan, so a new
//      frozen caller fails HERE until the pin — and the three prose
//      parentheticals it feeds (helpers/geometry.ts's
//      openScenarioAtFixedNow docstring, the contract doc's §7 capture
//      clock bullet, the CHANGELOG entry) — move beside it.
describe("the capture clock regime is enforced, not asserted", () => {
  const E2E_ROOT = path.join(PACKAGE_ROOT, "tests-e2e");
  const CAPTURE_SPEC = path.join(E2E_ROOT, "tvc-screenshots.spec.ts");
  const GEOMETRY_HELPERS = path.join(E2E_ROOT, "helpers", "geometry.ts");

  it("the TVC-190 gate rides openScenarioAtTickingNow — the open IS the gate", () => {
    const source = readFileSync(GEOMETRY_HELPERS, "utf8");
    const body =
      /export async function openScenarioAtTickingNow[\s\S]*?\n\}/.exec(
        source,
      )?.[0];
    expect(body, "openScenarioAtTickingNow not found").toBeDefined();
    expect(
      body?.includes("expectFollowedListsAtBottom("),
      "the fold is gone: openScenarioAtTickingNow no longer calls the " +
        "TVC-190 gate, so every scenario capture just went ungated",
    ).toBe(true);
  });

  it("the capture spec opens frozen only inside TVC-190's negative control, and never through bare openScenario", () => {
    const source = readFileSync(CAPTURE_SPEC, "utf8");
    const frozenCalls = [...source.matchAll(/openScenarioAtFixedNow\(/g)];
    expect(
      frozenCalls.length,
      "the capture spec may open frozen exactly once — TVC-190's " +
        "committed negative control; a capture under a pinned clock " +
        "photographs a state no reader reaches",
    ).toBe(1);
    const carrierStart = source.indexOf('test("TVC-190');
    expect(carrierStart, "the TVC-190 carrier is missing").toBeGreaterThan(-1);
    expect(
      frozenCalls[0].index,
      "a frozen open outside the TVC-190 carrier",
    ).toBeGreaterThan(carrierStart);
    expect(
      (source.match(/openScenario\(/g) ?? []).length,
      "a bare openScenario( in the capture spec bypasses both the clock " +
        "seed and the TVC-190 gate — open through openScenarioAtTickingNow",
    ).toBe(0);
    // Anti-vacuity: the scan genuinely saw the capture suite's opens.
    expect(
      (source.match(/openScenarioAtTickingNow\(/g) ?? []).length,
    ).toBeGreaterThanOrEqual(8);
  });

  it("the frozen-clock caller census is pinned exactly — a new pinned open fails here until the pin and the prose parentheticals move together", () => {
    // The reviewed census: where openScenarioAtFixedNow may be CALLED,
    // and why —
    //   helpers/geometry.ts: 1 — the wrapper's own declaration (pinned
    //     rather than excluded: a frozen open smuggled into a helper
    //     module runs specs on a non-elapsing clock all the same, and
    //     an excluded defining file is exactly the one-regime blind
    //     spot this ticket exists to remove)
    //   scroll-follow-guards.spec.ts: 4 — TVC-146's three poses and
    //     TVC-148's pinned open (un-pinned mid-test to prove the flush)
    //   transcript.spec.ts: 1 — the dated-register probe
    //   tvc-screenshots.spec.ts: 1 — TVC-190's negative control
    // The scan reads EVERY .ts under tests-e2e (round 3: spec-only
    // scanning left helper modules uncertifiable), so the derivation
    // matches the claim's scope. STATED LIMIT (round 4): it matches the
    // wrapper's spelling only. A direct page.clock.setFixedTime or
    // pauseAt produces the same non-elapsing regime and is outside any
    // text scan by construction — including the evasion where a
    // refreeze lands between a ticking open and its capture, past the
    // point the gate observed. Not reachable today: exactly three
    // page.clock. call sites exist in tests-e2e (both wrapper bodies
    // and TVC-148's documented un-pin), the capture spec has none, and
    // its only frozen open is the pixel-free carrier's control leg.
    // The limit is stated rather than closed; a lane that adds a
    // direct clock call owns re-deriving this reachability argument.
    const FROZEN_CALLER_CENSUS: Record<string, number> = {
      "tests-e2e/helpers/geometry.ts": 1,
      "tests-e2e/scroll-follow-guards.spec.ts": 4,
      "tests-e2e/transcript.spec.ts": 1,
      "tests-e2e/tvc-screenshots.spec.ts": 1,
    };
    const derived: Record<string, number> = {};
    for (const entry of readdirSync(E2E_ROOT, { recursive: true })) {
      const name = String(entry);
      if (!name.endsWith(".ts") || name.startsWith("results")) {
        continue;
      }
      const file = path.join(E2E_ROOT, name);
      const count = (
        readFileSync(file, "utf8").match(/openScenarioAtFixedNow\(/g) ?? []
      ).length;
      if (count > 0) {
        derived[path.relative(PACKAGE_ROOT, file).replaceAll(path.sep, "/")] =
          count;
      }
    }
    expect(derived).toEqual(FROZEN_CALLER_CENSUS);
  });

  it("every .click( in the capture spec re-gates before the next capture — the literal spelling, nothing wider", () => {
    // The wrapper's gate observes the OPEN; an interaction that grows
    // content afterwards is a state the gate never saw (round 3, the
    // recursion of this ticket's own defect). STATED LIMIT (round 4):
    // this is a text scan, and a text scan sees only the spelling it
    // names. `.click(` is the one interaction the capture spec uses
    // today; `.check(`, `.hover(`, `.fill(`, a `page.evaluate` mutation
    // — and any file other than the capture spec — are outside it by
    // construction. The verb list is unbounded, so it is not
    // enumerated; the limit is stated here and in §7 instead. (The
    // bench pair's TVC-151 really does drive `.check()` before its
    // dark baseline — measured landed at 1188/1187 and byte-stable
    // across every run this branch made; it is part of the NAMED bench
    // remainder, not of this scan's claim.) A click AFTER the file's
    // last capture endangers nothing and is not a violation. A capture
    // is either spelling this file has — the literal
    // `.toHaveScreenshot(` or the file's own `await shoot(` helper
    // (a closed two-spelling set, unlike the interaction verbs, which
    // is why widening here was right and enumerating verbs is not).
    const source = readFileSync(CAPTURE_SPEC, "utf8");
    let gatedClicks = 0;
    let cursor = 0;
    for (;;) {
      const click = source.indexOf(".click(", cursor);
      if (click === -1) {
        break;
      }
      cursor = click + 1;
      const captureAt = [
        source.indexOf(".toHaveScreenshot(", click),
        source.indexOf("await shoot(", click),
      ]
        .filter((index) => index !== -1)
        .sort((a, b) => a - b)
        .at(0);
      if (captureAt === undefined) {
        // No capture after this interaction — nothing to gate.
        continue;
      }
      const nextShot = captureAt;
      gatedClicks += 1;
      expect(
        source.slice(click, nextShot).includes("expectFollowedListsAtBottom("),
        "a .click( reaches its capture ungated — the click can grow " +
          "list content after the wrapper's gate; re-gate after " +
          "settleTwoFrames",
      ).toBe(true);
    }
    // Anti-vacuity: the scan genuinely saw the three interaction sites.
    expect(gatedClicks).toBeGreaterThanOrEqual(3);
  });

  it("captures live in exactly two designated files — a screenshot in a new spec is outside every regime scan until enrolled here", () => {
    // The regime scans above are scoped to the capture spec; the bench
    // pair is the named remainder. That scope is honest only while
    // those are the ONLY files taking screenshots — this pin is what
    // bounds the claim.
    const withShots: string[] = [];
    for (const file of testFilesUnder(E2E_ROOT)) {
      if (readFileSync(file, "utf8").includes(".toHaveScreenshot(")) {
        withShots.push(
          path.relative(PACKAGE_ROOT, file).replaceAll(path.sep, "/"),
        );
      }
    }
    expect(withShots.sort()).toEqual([
      "tests-e2e/transcript.spec.ts",
      "tests-e2e/tvc-screenshots.spec.ts",
    ]);
  });
});
