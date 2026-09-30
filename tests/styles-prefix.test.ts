/**
 * The prefixed-stylesheet law: the shipped sheet carries no
 * unprefixed generic utility — every generated class selector is
 * `tf:`-prefixed (selector `.tf\:…`), so a host page's own `.flex`,
 * `.container` or `.hidden` can never collide with ours and no
 * cascade-layer quarantine is needed on import.
 *
 * The sheet is compiled FRESH from the source (the build-element.mjs
 * mechanism — the v4 CLI to stdout), never read from dist/: CI runs
 * tests before `npm run build`, so a dist/ read would silently skip
 * there and the law would be vacuous exactly where it matters.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  compiledSheet,
  compiledSheetOf,
  packageRoot,
  probePathIsOutsideWalkedRoots,
  removeProbesFromDeadWorkers,
} from "./compiled-sheet";
import { sourceFilesOf } from "./source-walk";

// Hand-written classes the source sheet declares deliberately; everything
// else must wear the prefix. (The `@layer properties` block's `--tw-*`
// custom properties and `@property` rules are variable machinery, not
// class selectors — prefix() deliberately does not rename them, and the
// extractor below never sees them.)
const HAND_WRITTEN_ALLOWLIST = new Set(["tf-highlight-ring"]);

/** Every class selector name in the sheet, unescaped (`.tf\:flex` →
 *  `tf:flex`), including ones nested inside `@media`/`@supports`/`@layer`
 *  — the regex walks raw text, so no nesting hides a selector. Values
 *  like `0.25rem` also match the dot; the leading-letter filter drops
 *  those numeric fragments (no real class starts with a digit), and the
 *  census floor below proves the extractor still sees the real classes. */
function classNamesOf(css: string): string[] {
  const raw = css.matchAll(/\.((?:[\w-]|\\.)+)/g);
  const names = new Set<string>();
  for (const match of raw) {
    const name = match[1].replaceAll(/\\(.)/g, "$1");
    if (/^[A-Za-z_]/.test(name)) {
      names.add(name);
    }
  }
  return [...names];
}

function unprefixed(names: string[]): string[] {
  return names.filter(
    (name) =>
      !name.startsWith("tf:") &&
      !HAND_WRITTEN_ALLOWLIST.has(name) &&
      // A URL inside a declaration value ("api.teaflask.com") matches the
      // dot-extractor; anything that is not utility-shaped noise must be
      // a class, so only the known value-text artifacts are dropped.
      name !== "com",
  );
}

describe("the shipped stylesheet is fully prefixed", () => {
  const sheet = compiledSheet();
  const names = classNamesOf(sheet);

  it("carries no unprefixed generic utility", () => {
    expect(unprefixed(names)).toEqual([]);
  });

  it("census floor — the scan saw the real utilities, not an empty set", () => {
    const prefixed = names.filter((name) => name.startsWith("tf:"));
    expect(prefixed.length).toBeGreaterThan(150);
    // Spot anchors: the heaviest utilities in the source must be present
    // under the prefix — if these vanish, the compile ran against the
    // wrong input.
    expect(names).toContain("tf:flex");
    expect(names).toContain("tf:items-center");
    expect(names).toContain("tf-highlight-ring");
  });

  it("negative control — the scanner flags a synthetic bare utility", () => {
    const poisoned = sheet + ".flex{display:flex}.sm\\:hidden{display:none}";
    const flagged = unprefixed(classNamesOf(poisoned));
    expect(flagged).toContain("flex");
    expect(flagged).toContain("sm:hidden");
  });

  it("the @layer properties machinery survives unprefixed by design", () => {
    // prefix() namespaces utilities and theme variables, not the --tw-*
    // internal custom properties — pin that so a future Tailwind bump
    // changing the shape is noticed, not silently absorbed.
    expect(sheet).toContain("--tw-");
  });

  // THE GLOBAL-NAMESPACE CENSUS (round-7 review, finding 3): `prefix(tf)`
  // scopes class names and theme variables — nothing else. `@keyframes`
  // was the door found live: `tf:animate-pulse` pulled Tailwind's default
  // theme animation and the sheet shipped `@keyframes pulse`/`spin`
  // unlayered at top level, out-cascading a host's own layered pulse and
  // beating an unlayered one whenever our sheet loads later (the common
  // drop-in order). This census enumerates EVERY construct the built
  // sheet puts into a page-global namespace and classifies each:
  //   package-named          — `tf-` animation names (tf-pulse, tf-spin,
  //                            tf-shimmer, tf-highlight-pulse);
  //   reserved-and-documented — Tailwind's `--tw-*` machinery (@property
  //                            registrations plus the @supports-gated
  //                            universal fallback block): the same names
  //                            any host Tailwind v4 build registers with
  //                            identical definitions, so cohabitation is
  //                            inert; named in the README beside tf:/
  //                            data-tf-*/--tf-*. Likewise the five
  //                            canonical layer names (theme, base,
  //                            components, utilities, properties):
  //                            declaration order is set by whoever
  //                            declares first and our selectors are all
  //                            prefix-disjoint inside them;
  //   a leak                 — anything else, and the assertions below
  //                            turn red.
  describe("global-namespace census — what a class prefix does not scope", () => {
    it("every @keyframes name is package-named (tf-*)", () => {
      const names = [...sheet.matchAll(/@keyframes ([\w-]+)/g)].map(
        (match) => match[1],
      );
      // Anti-vacuity: the sheet really ships its animations.
      expect(names).toContain("tf-pulse");
      expect(names).toContain("tf-spin");
      expect(names.filter((name) => !name.startsWith("tf-"))).toEqual([]);
    });

    it("every @property registration is Tailwind's own --tw-* machinery", () => {
      const names = [...sheet.matchAll(/@property (--[\w-]+)/g)].map(
        (match) => match[1],
      );
      expect(names.length).toBeGreaterThan(10);
      expect(names.filter((name) => !name.startsWith("--tw-"))).toEqual([]);
    });

    it("layer names are the canonical five, nothing package-invented", () => {
      const names = new Set(
        [...sheet.matchAll(/@layer ([a-z, ]+)[;{]/g)].flatMap((match) =>
          match[1].split(",").map((name) => name.trim()),
        ),
      );
      expect([...names].sort()).toEqual([
        "base",
        "components",
        "properties",
        "theme",
        "utilities",
      ]);
    });

    it("no other globally-named construct ships at all", () => {
      for (const construct of [
        "@font-face",
        "@counter-style",
        "@font-palette-values",
        "@view-transition",
        "@position-try",
        "@scroll-timeline",
        "@page",
      ]) {
        expect(sheet.includes(construct), construct).toBe(false);
      }
    });

    it("negative control — a bare @keyframes would be flagged", () => {
      const poisoned = sheet + "@keyframes pulse{50%{opacity:.5}}";
      const names = [...poisoned.matchAll(/@keyframes ([\w-]+)/g)].map(
        (match) => match[1],
      );
      expect(names.filter((name) => !name.startsWith("tf-"))).toEqual([
        "pulse",
      ]);
    });
  });
});

// ---------------------------------------------------------------------------
// The other half of the law (round-1 review, findings by two reviewers):
// the sheet scan above is structurally BLIND to a dropped class, because
// under prefix() an unprefixed candidate emits NOTHING — no bare selector
// appears to flag, no warning is printed, and the component silently
// loses its styling (the shipped example: `aria-checked:bg-tf-emphasis`
// in the answerRow variant, whose absence unstyled the selected answer
// row while every scanner stayed green). So the detection must run
// against the SOURCES: extract every string-literal token from src/**
// and fixtures/** (comments stripped — prose mentions of class names are
// not class strings), and ask Tailwind itself — an unprefixed probe
// compile with the tokens as `@source inline()` candidates — which of
// them would generate a rule. Any that would, and is not on the
// enumerated allowlist below, is a class the shipped sheet silently
// dropped.
// ---------------------------------------------------------------------------

/** The committed enumeration (review process rule: the reviewer verifies
 *  this list, not re-derives it): every string token in the scanned trees
 *  that Tailwind would accept as a utility candidate but that is NOT a
 *  class. Each row must still occur in the scan — a vanished row is stale
 *  and must be deleted, so the ledger only ever reflects reality. */
const NON_CLASS_CANDIDATES: ReadonlyMap<string, string> = new Map([
  ["block", "DOM display value (reader/layout-probe visibility math)"],
  ["border", "host theme token key name (appearance/theme.ts mapping)"],
  ["contents", "DOM display value (reader/visibility.ts)"],
  ["fixed", "CSS position value in fixture scaffolding style objects"],
  ["grid", "ARIA role name (reader/roles.ts)"],
  ["hidden", "the DOM hidden attribute / visibility values (reader, prefill)"],
  // "ordinal" left this list with the round-7 regex-state fix: its only
  // occurrence was `"ordinal"` INSIDE the regex literal at
  // core/subagent-rows.ts — a phantom string the old code-state walk
  // hallucinated out of a regex body. Blanked regexes, no phantom.
  ["outline", 'a TfButton variant NAME (variant="outline"), not a class'],
  ["resize", "the window resize event name (listeners in three files)"],
  ["ring", "host theme token key name (appearance/theme.ts mapping)"],
  ["table", "ARIA role name (reader/roles.ts, accessible-name.ts)"],
  ["transition", "a CSS property NAME string (core/dock-reflow.ts)"],
  ["visible", "CSS visibility / DOM values (reader/*)"],
  // Nine rows left this list with the playground fork — flex, flex-col,
  // flex-1, mt-3, min-h-24, overflow-hidden, rounded-lg, border-tf-border,
  // bg-tf-muted/40 — the fork's byte-contract (the bare
  // CARD_SECTION_CLASSES in tool-arguments-summary.tsx, rendered only by
  // the forked approval card and pinned by default-tool-view.test.tsx). The
  // fork, the class and the pin are all deleted, so the tokens no longer
  // occur in the scan; the "only shrinks" case below reported exactly those
  // nine stale, and they were removed from that list, not from the reason
  // string.
]);

// THE EXTRACTION ORACLE (round-7 scoped verifier, final finding): string
// literal boundaries come from the TypeScript parser itself, not a
// hand-rolled scanner. This was the SIXTH control blind spot of the same
// shape on this ticket, and every instance had one generating mechanism:
// an approximation of the JS lexer that cannot see where it disagrees
// with the real one. Round 5: the regex-first block-comment pass
// false-opened on a `/*` in prose. Round 7: regex-as-code let quotes and
// backticks inside regex literals desync six files. The verifier's last
// find: `mutN++ / 2` (and JSX text like `Path: /usr/bin`) entered a
// phantom regex state off the `+`/`-`/`!`/`:` triggers, the newline rule
// closed it back to a healthy-looking `code` end state, and the rest of
// the line - live class strings included - was silently blanked while
// the end-state audit reported health. Narrowing the trigger set fixes
// the operator half but not the `:`/JSX-text half, and a blanked-count
// floor is a change detector that goes stale; neither closes the
// mechanism. The premise this fix rests on: the compiler's lexer is
// definitionally correct about where a string literal begins and ends -
// it is the grammar this code ships through - so comments, regex
// literals and JSX text are excluded BY CONSTRUCTION, not by heuristic,
// and there is no scanner state left to desync. The residual self-audit
// is parse-cleanliness (zero syntax diagnostics per file): a file the
// parser could not lex reddens the law instead of shrinking its input,
// and the regex floor in tokensOf() proves the parser really is lexing
// this tree's regex literals AS regexes rather than absorbing them into
// anything else. Template literals are now scanned in full (head,
// middle and tail text, multi-line included) where the old regex saw
// single-line spans only.
function stringLiteralTextsOf(
  fileName: string,
  text: string,
): { texts: string[]; regexLiteralCount: number } {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    false,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  // parseDiagnostics is internal but stable; the public routes need a
  // full Program, which this per-file lex check does not.
  const diagnostics = (
    source as unknown as { parseDiagnostics: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  expect(
    diagnostics.map(
      (diagnostic) =>
        fileName +
        ": " +
        ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
    ),
  ).toEqual([]);
  const texts: string[] = [];
  let regexLiteralCount = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      texts.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      texts.push(node.head.text);
      for (const span of node.templateSpans) {
        texts.push(span.literal.text);
      }
    } else if (ts.isRegularExpressionLiteral(node)) {
      regexLiteralCount += 1;
    }
    node.forEachChild(visit);
  };
  visit(source);
  return { texts, regexLiteralCount };
}

const CANDIDATE_SHAPE = /^[!A-Za-z0-9:[\]()/.%_#@&*,=<>~^$+-]+$/;

/** Every plausible candidate token in the scanned trees' string
 *  literals, with the files carrying it. Single-line literals only —
 *  prettier keeps class strings on one line. */
function tokensOf(): {
  bare: Map<string, Set<string>>;
  prefixed: Map<string, Set<string>>;
} {
  const bare = new Map<string, Set<string>>();
  const prefixed = new Map<string, Set<string>>();
  const files = [
    ...sourceFilesOf(path.join(packageRoot, "src")),
    ...sourceFilesOf(path.join(packageRoot, "fixtures")),
  ];
  expect(files.length).toBeGreaterThan(200); // anti-vacuity: the walk saw the tree
  let regexLiterals = 0;
  for (const file of files) {
    const { texts, regexLiteralCount } = stringLiteralTextsOf(
      file,
      readFileSync(file, "utf8"),
    );
    regexLiterals += regexLiteralCount;
    for (const literal of texts) {
      for (const token of literal.split(/\s+/)) {
        if (
          token.length === 0 ||
          token.length > 80 ||
          token.startsWith("bench-") ||
          token.startsWith("host-") ||
          token.includes("{") ||
          !CANDIDATE_SHAPE.test(token) ||
          !/[a-z]/.test(token)
        ) {
          continue;
        }
        const bucket = token.startsWith("tf:") ? prefixed : bare;
        const holders = bucket.get(token) ?? new Set<string>();
        holders.add(path.relative(packageRoot, file));
        bucket.set(token, holders);
      }
    }
  }
  // Anti-vacuity for the exclusion-by-construction: the parser must be
  // lexing this tree's regex literals AS regexes (the verifier counted
  // 56 in the read set) — a floor, not an exact pin, so a deleted regex
  // does not stale this law.
  expect(regexLiterals).toBeGreaterThan(40);
  return { bare, prefixed };
}

function bareTokensOf(): Map<string, Set<string>> {
  return tokensOf().bare;
}

// The writer/walker enumeration for this package's test-time filesystem.
// The race this block guards against: this probe, formerly written into
// src/styles/, vanished mid-walk under deleted-row-vocabulary's
// stat/read and killed that suite with ENOENT (~2-3% of full-suite runs
// on the react-18 required gate). WRITERS into any walked tree: this
// probe was the ONLY one. The others are safe by construction —
//   tests-e2e/helpers/fractional-probe.ts appends under gitignored
//   tests-e2e/results/ (inside every walker's skip list); Playwright
//   artifacts land in results/ and *-snapshots/ (skipped or
//   extension-filtered); the write-capable script helpers
//   (build-element.mjs, add-import-extensions.mjs) sit behind argv CLI
//   guards; refresh-bundle-baseline.mjs runs main() at top level but no
//   test imports it.
// WALKERS that stat-then-read with no ENOENT guard (correctly so — a
//   file vanishing mid-walk IS a bug to surface, never to tolerate):
//   tool-call-state-sites.test.ts twice (src + the prose roots). The
//   ticketed victim, deleted-row-vocabulary.test.ts, since moved to the
//   monorepo's frontend tree and out of this suite's run (its statSync
//   preceded its extension filter, so dodging by extension would not
//   have closed the race). Safe
//   by withFileTypes + extension filter: source-walk.ts callers,
//   ref-prop-surface, surface-boundary-census, tvc/tvc-meta.
// ALSO: build-element.mjs recursively hashes src/styles/** into its
//   freshness manifest — a probe leaked there (worker killed mid-compile)
//   would poison that ledger; one more reason the probe lives outside.
// No walker readdirs the package root, and node_modules is skipped by
//   name everywhere it is reachable — hence the probe's location below,
//   plus the executable guard that it never regresses into a walked root.
//
// RELOCATION PREMISES — every assumption the package-root location
// rests on, classified executed-or-prose. For each EXECUTED one: the
// exact edit its criterion exists to catch, and the mutation that
// FIRED it (each mutate → observed red → restored) — round 2 found a
// criterion nominally executed but too loose to catch the case it was
// named for, so firing on the named case is the bar:
//   1. The probe path sits outside every walked root — EXECUTED: the
//      WALKED_ROOTS guard. Catches: the path reverting under a walked
//      root. Fired: path reverted to src/styles/, deterministic red
//      (round 1). Known limit, recorded not silent: the root list is a
//      copy of the walkers' own constants (importing a test file to
//      share them would register its suites here), so a NEW walked
//      root added there must be mirrored — drift leaves this guard
//      narrower, never wrong about the five roots it names.
//   2. The surgered sheet's path directives are EXACTLY the two known
//      tailwindcss package imports, source(none) included — EXECUTED:
//      the pinned toEqual. Catches: any surviving/added path directive
//      (fired: surviving @source "./mutation-tree", round 1) AND a
//      dropped source(none), which would re-root automatic source
//      detection at the probe's own directory — the case round 2 found
//      the looser any-tailwindcss-import filter structurally could not
//      catch (fired: source(none) deleted from the sheet, round 2).
//      Round 3: comments are stripped before the scan — a commented
//      directive is inert and would red the pin as a phantom; the strip
//      was fired in both directions (a real relative @source outside a
//      comment still reds; the same text inside a comment is ignored).
//   3. Each surgery literal occurs exactly once, so first-occurrence
//      String.replace strips the whole class — EXECUTED: the
//      toHaveLength(1) asserts. Catches: a duplicated literal
//      surviving the surgery (a second " prefix(tf)" would re-prefix
//      the oracle and vacuously green the bare-candidate law). Fired:
//      duplicated " prefix(tf)"; duplicated @source line (round 1).
//   4. The surgered sheet enters the probe whole — holds by
//      construction: the criterion and the probe read the same
//      surgeredSheet binding; there is no separate edit to catch.
//   5. tailwindcss resolves identically through the node_modules
//      ancestor walk from the package root — EXECUTED every run: the
//      compile throws loudly on resolution failure (fired:
//      node_modules/tailwindcss renamed away → compile error, red,
//      round 2), and the negative control below proves the sheet's own
//      @theme tokens reach the oracle from the new location
//      (aria-checked:bg-tf-emphasis — the control that caught the
//      first cut compiling against the default theme).
//   6. Overlapping vitest invocations carry distinct pids — an OS
//      invariant, not expressible as a test law; stays prose.
//   7. A leaked probe is harmless and now self-healing: no census walk
//      sees the package root; the relocation controls ran every walker
//      suite green with a planted leak; .gitignore keeps it out of git
//      status and the prettier hook; and compiled-sheet.ts's
//      removeProbesFromDeadWorkers removes stale probes on the next run
//      (its never-delete-a-live-probe premise is stated on that helper,
//      which every probe-compiling law shares). Round 4:
//      _removePreRelocationProbeLeftover unconditionally removes a
//      probe leaked at the OLD pre-relocation path (src/styles/, no pid
//      segment — unmatched by the pid glob in .gitignore, so that file
//      carries its own ignore line), closing the migration gap on
//      checkouts that killed a pre-fix run; its safety premise is its
//      docblock. The harmlessness itself stays prose — premise 1
//      carries it.
//   8. No CENSUS walk readdirs the package root — prose: walker roots
//      are constants in OTHER files, so an executable criterion here
//      would be a cross-file census that drifts. (The dead-pid sweep
//      above does readdir the package root, but it stats/reads nothing
//      and force-removes only dead-pid probe-named entries — no ENOENT
//      window, in either direction. Its round-4 migration delete does
//      remove one path inside src/styles/, but only on the single
//      transition run where a pre-fix leftover exists; that one-shot
//      window is stated on the helper.) Residual risk is bounded: a
//      future package-root walker must also stat/read dot-named CSS
//      to collide, and this block is the record it would be breaking.
//   9. (Round-2 reviewers' addition.) package.json "files" whitelists
//      "src" — a probe leaked at the OLD location could ride a
//      published tarball; the package root is outside the whitelist,
//      so even a leaked probe cannot ship. Prose: npm's packing rules,
//      not this package's code, enforce it.
//
// FIRED-CONTROL TABLE — every control across all rounds, re-fired in
// full after the round-3 helper extraction (a refactor of guards whose
// whole value is that they fire is proven only by re-firing each on its
// own target edit; r1/r2/r3 = the review round it fired in):
//   premise 1 | probe path reverted under src/styles/       | red (r1, r3)
//   premise 2 | surviving @source "./mutation-tree"         | red (r1, r3)
//   premise 2 | source(none) deleted from the sheet         | red (r2, r3)
//   premise 2 | same relative @source inside a CSS comment  | ignored, suite green (r3)
//   premise 3 | duplicated " prefix(tf)"                    | red (r1, r3)
//   premise 3 | duplicated @source "../components";         | red (r1, r3)
//   premise 5 | node_modules/tailwindcss renamed away       | red (r2, r3)
//   sweep     | dead-pid probe removed, live-pid probe kept | verified (r2, r3)
//   migration | pre-fix probe planted at src/styles/        | removed next run (r4)
//   migration | old un-suffixed name in .gitignore          | check-ignore match (r4)

/** The relocation's load-bearing premise, EXECUTED and pinned: the
 *  surgered sheet's path directives must be exactly the two known
 *  tailwindcss package imports, modifiers included. The pin closes two
 *  doors at once: a surviving @source, a relative or bare-string
 *  @import, a url() reference, or a @plugin/@config/ @reference would
 *  resolve against the probe's OWN directory (the package root — the
 *  wrong tree) and reds here before anything touches disk; and a DROPPED
 *  source(none) — invisible to round 1's looser "any tailwindcss import
 *  passes" filter — would re-enable Tailwind's automatic source
 *  detection rooted at that same directory, silently changing the
 *  oracle's candidate set with the probe's location. A NEW directive in
 *  styles.css also lands here, so its location-sensitivity gets examined
 *  deliberately, not absorbed. Comments are stripped before the scan
 *  (round 3): a commented-out directive is inert, and a phantom match
 *  would red this law pointing at nothing path-sensitive — while a real
 *  directive outside a comment still fires (both directions
 *  mutation-proven; see the fired-control table above). The probe's
 *  appended @source inline() lines never pass through here and are
 *  location-independent by construction: inline content, no file read.
 */
function _assertOnlyLocationIndependentDirectives(surgeredSheet: string): void {
  const pathDirectives =
    surgeredSheet
      .replaceAll(/\/\*[\s\S]*?\*\//g, "")
      .match(/@(?:import|source|plugin|config|reference)\s+[^;\n]*|url\(/gi) ??
    [];
  expect(pathDirectives).toEqual([
    '@import "tailwindcss/theme" theme(reference)',
    '@import "tailwindcss/utilities" source(none)',
  ]);
}

/** Migration (round-4 review): the PRE-relocation probe name carried no
 *  pid and lived inside the walked tree, so a worker killed mid-compile
 *  on pre-fix code leaked it there permanently — keeping the exact
 *  ENOENT and manifest-hash hazards the relocation removed alive on
 *  that one checkout. The delete is UNCONDITIONAL because liveness
 *  cannot be checked (no pid in the name) and needs no check: only
 *  pre-fix code writes that name, and pre-fix code cannot be the
 *  checked-out test code of the same working tree as this sweep, so a
 *  leftover is orphaned by definition. It opens no window on OUR side —
 *  rmSync with force on one known path stats, reads, and readdirs
 *  nothing in src/styles/. Stated honestly: on the single transition
 *  run where a leftover exists, this delete can race a census walk once
 *  — the same one-shot ENOENT the rotting leftover itself risks — and
 *  afterwards the hazard is gone for good instead of permanent. */
function _removePreRelocationProbeLeftover(root: string): void {
  rmSync(path.join(root, "src/styles/.bare-candidate-probe.tmp.css"), {
    force: true,
  });
}

/** The oracle: which of these tokens would Tailwind emit a rule for?
 *  The probe is the package's REAL source sheet with prefix(tf) stripped
 *  (under the real prefix these candidates emit nothing — that silence
 *  is exactly the blindness this law closes) and the component scan
 *  replaced by the tokens as `@source inline()` candidates. Building on
 *  the real sheet keeps the package's own @theme tokens in play, so a
 *  dropped `bg-tf-emphasis`-style class is visible to the oracle — the
 *  first cut compiled against the default theme and the negative control
 *  below caught it blind to exactly the shipped miss. */
function liveCandidatesOf(tokens: Iterable<string>): Set<string> {
  const source = readFileSync(
    path.join(packageRoot, "src/styles/styles.css"),
    "utf8",
  );
  // Anti-vacuity on the surgery itself, upgraded from presence to
  // uniqueness (round-1 review): String.replace strips only the FIRST
  // occurrence — over the RAW text, comments included, which is why
  // these scan raw too — so each literal must occur exactly once or a
  // survivor changes what the probe tests: a second " prefix(tf)" would
  // re-prefix the oracle's output and vacuously green the bare-candidate
  // law below.
  expect(source.match(/ prefix\(tf\)/g)).toHaveLength(1);
  expect(source.match(/@source "\.\.\/components";/g)).toHaveLength(1);
  const surgeredSheet = source
    .replace(" prefix(tf)", "")
    .replace('@source "../components";', "");
  _assertOnlyLocationIndependentDirectives(surgeredSheet);
  const probeLines = [surgeredSheet];
  for (const token of tokens) {
    probeLines.push(`@source inline("${token}");`);
  }
  // The probe lives at the PACKAGE ROOT, which no census walk readdirs
  // (enumeration above): pid-suffixed so overlapping invocations never
  // clobber each other; dot-named, gitignored, outside the package.json
  // "files" whitelist, and force-removed in finally.
  const probePath = path.join(
    packageRoot,
    `.bare-candidate-probe.${String(process.pid)}.tmp.css`,
  );
  // The criterion, executed on every run: the probe must never return to
  // a tree any census test walks — that is the exact regression the
  // relocation removed, and this goes red deterministically if it comes
  // back. The root list and the dead-worker sweep live in
  // compiled-sheet.ts, one home for every law that compiles a probe.
  expect(probePathIsOutsideWalkedRoots(probePath)).toBe(true);
  _removePreRelocationProbeLeftover(packageRoot);
  removeProbesFromDeadWorkers(
    packageRoot,
    /^\.bare-candidate-probe\.(\d+)\.tmp\.css$/,
  );
  writeFileSync(probePath, probeLines.join("\n") + "\n");
  let compiled: string;
  try {
    compiled = compiledSheetOf(path.basename(probePath));
  } finally {
    // force: a probe that already vanished must not throw out of finally
    // and mask the real compile error.
    rmSync(probePath, { force: true });
  }
  return new Set(classNamesOf(compiled));
}

describe("no bare Tailwind candidate lurks in the sources", () => {
  const tokens = bareTokensOf();
  const live = liveCandidatesOf(tokens.keys());

  it("every string token Tailwind would style is either tf:-prefixed or an enumerated non-class", () => {
    const offenders = [...live]
      .filter(
        (name) =>
          tokens.has(name) &&
          !NON_CLASS_CANDIDATES.has(name) &&
          // The sheet's own hand-written classes ride the probe compile;
          // they are deliberately unprefixed and already lawed above.
          !HAND_WRITTEN_ALLOWLIST.has(name),
      )
      .sort()
      .map((name) => `${name} <- ${[...(tokens.get(name) ?? [])].join(", ")}`);
    expect(offenders).toEqual([]);
  });

  it("the enumeration only shrinks: every allowlist row still occurs in the scan", () => {
    const stale = [...NON_CLASS_CANDIDATES.keys()].filter(
      (name) => !tokens.has(name),
    );
    expect(stale).toEqual([]);
  });

  it("negative control — the shipped miss would be caught: an unprefixed aria-checked:bg-tf-emphasis flags", () => {
    // The exact class round-1 review found dropped from the answerRow
    // variant. Injected bare, the oracle must emit it and the comparator
    // must flag it — proving the whole pipeline (scan shape aside) is
    // alive on every run.
    const poisoned = liveCandidatesOf([
      ...tokens.keys(),
      "aria-checked:bg-tf-emphasis",
    ]);
    expect(poisoned.has("aria-checked:bg-tf-emphasis")).toBe(true);
    expect(NON_CLASS_CANDIDATES.has("aria-checked:bg-tf-emphasis")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The REVERSE direction (round-5 finding B; a round-3 reviewer named this
// blind spot and it came back as a live near-miss): under prefix() a
// tf:-prefixed token that Tailwind cannot generate — malformed, or used
// only in fixtures, which @source does not scan — emits NO rule and
// silently unstyles, exactly the failure class the bare-candidate law
// closes from the other side. So: every tf: token in src/** and
// fixtures/** string literals must resolve to a real selector in the
// freshly compiled SHIPPED sheet. This also turns the @source coverage
// gap into a law: a fixture-only class that no component generates fails
// here instead of depending on a component coincidence (the tf:gap-6
// near-miss).
// ---------------------------------------------------------------------------

describe("every tf:-prefixed token in the sources compiles to a real rule", () => {
  const sheetSelectors = new Set(classNamesOf(compiledSheet()));
  const { prefixed } = tokensOf();

  function unresolved(tokens: Map<string, Set<string>>): string[] {
    return [...tokens.entries()]
      .filter(([token]) => !sheetSelectors.has(token))
      .map(([token, holders]) => `${token} <- ${[...holders].join(", ")}`)
      .sort();
  }

  it("no tf: token is prefixed-but-never-generated", () => {
    expect(unresolved(prefixed)).toEqual([]);
  });

  it("anti-vacuity: the scan sees the real usage set, fixtures included", () => {
    expect(prefixed.size).toBeGreaterThan(250);
    const holders = [...prefixed.values()].flatMap((set) => [...set]);
    expect(holders.some((file) => file.startsWith("fixtures/"))).toBe(true);
  });

  it("negative control — a synthetic never-generated tf: token is flagged", () => {
    const poisoned = new Map(prefixed);
    poisoned.set("tf:bg-never-real-token", new Set(["synthetic"]));
    expect(unresolved(poisoned)).toEqual([
      "tf:bg-never-real-token <- synthetic",
    ]);
  });
});
