/**
 * The authored-rem law: no JS/TS-authored style carries a rem literal —
 * not a style={{…}} object, not a "--prop": "…rem" custom property, not
 * a .style.setProperty call, not a `${n}rem` template, not style text
 * destined for the shadow root. The CSS half of the rule lives in
 * scripts/rem-to-px.mjs (a host's html { font-size: 62.5% } must not
 * shrink the widget); that tripwire scans CSS text only, which is how a
 * fallback card shipped rem box metrics that tracked the host root font.
 * This law closes the JS/TS surface with scripts/rem-in-source.mjs.
 *
 * Scope: src/** and fixtures/** — the same pair the prefixed-stylesheet
 * law walks, via the shared walk in ./source-walk so the parity holds by
 * construction. Excluded, with reasons: tests/** and tests-e2e/**
 * legitimately hold rem as transform fixtures (tests/rem-to-px.test.ts
 * feeds rem to the converter on purpose) and as assertions about the
 * pre-transform sheet; scripts/** holds the converter and this scanner
 * themselves. The wider out-of-scope surfaces (the dashboard and the
 * marketing site's trees, node_modules, host-supplied theme strings, the
 * fixture harnesses' index.html host-page CSS) are stated in
 * scripts/rem-in-source.mjs's header, each with what does — or explicitly
 * does not — compensate.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { findAuthoredRemInSource } from "../scripts/rem-in-source.mjs";
import { sourceFilesOf } from "./source-walk";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

// Deliberate exceptions, enumerated and reasoned — never regex-weakened.
// Key: `relativeFile :: excerpt substring`; value: the reason. The
// staleness law below prunes rows the scan no longer produces. Premise
// of the key shape, exactly: every excerpt is the ±30/+20 window of
// SOURCE text around the match's own file position — for every branch,
// the short style-object literal and the bare unit included — so a row
// silences only violations whose surrounding code carries the fragment.
// Two sites are distinguishable whenever their surroundings differ;
// byte-identical duplicate sites would share a key, which is accepted:
// the row is written and reasoned by a human for that exact shape. The
// per-branch controls below execute this promise.
const AUTHORED_REM_ALLOWLIST = new Map<string, string>([]);

interface ScanResult {
  files: string[];
  violations: { key: string; rendered: string }[];
  excusedCount: number;
}

function scanTree(): ScanResult {
  const files = [
    ...sourceFilesOf(path.join(packageRoot, "src")),
    ...sourceFilesOf(path.join(packageRoot, "fixtures")),
  ];
  const violations: { key: string; rendered: string }[] = [];
  let excusedCount = 0;
  for (const file of files) {
    const relative = path.relative(packageRoot, file);
    const { violations: found, excused } = findAuthoredRemInSource(
      readFileSync(file, "utf8"),
      relative,
    );
    excusedCount += excused.length;
    for (const finding of found) {
      violations.push({
        key: `${relative} :: ${finding.excerpt}`,
        rendered: `${relative}:${String(finding.line)} — ${finding.excerpt}`,
      });
    }
  }
  return { files, violations, excusedCount };
}

const scanned = scanTree();

describe("no authored rem reaches JS/TS-authored styles", () => {
  it("the law: src/** and fixtures/** author no rem outside arbitrary-value class tokens", () => {
    const offenders = scanned.violations.filter((violation) => {
      for (const key of AUTHORED_REM_ALLOWLIST.keys()) {
        const [file, fragment] = key.split(" :: ");
        if (
          violation.key.startsWith(`${file} :: `) &&
          violation.key.includes(fragment)
        ) {
          return false;
        }
      }
      return true;
    });
    expect(offenders.map((offender) => offender.rendered)).toEqual([]);
  });

  it("allowlist staleness law: every row still occurs in the scan", () => {
    for (const key of AUTHORED_REM_ALLOWLIST.keys()) {
      const [file, fragment] = key.split(" :: ");
      const stillFound = scanned.violations.some(
        (violation) =>
          violation.key.startsWith(`${file} :: `) &&
          violation.key.includes(fragment),
      );
      expect(stillFound, `stale allowlist row: ${key}`).toBe(true);
    }
  });

  it("anti-vacuity: the walk sees the real tree and the survivor rule is exercised", () => {
    // An empty or misrooted walk would make the law pass for the wrong
    // reason; a floor, never a pin, so refactors don't stale it.
    expect(scanned.files.length).toBeGreaterThan(200);
    expect(
      scanned.files.some((file) =>
        path.relative(packageRoot, file).startsWith("fixtures"),
      ),
    ).toBe(true);
    // The excused bucket is the survivor rule running against the real
    // className shapes (h-[calc(100dvh-2rem)] and kin). If this floor
    // starves, either the classes left or the rule stopped seeing them —
    // both worth a human look.
    expect(scanned.excusedCount).toBeGreaterThanOrEqual(8);
  });
});

describe("the scanner flags every authoring shape the ticket names", () => {
  const violationShapes: [string, string][] = [
    [
      "a style object literal",
      `const x = <div style={{ maxWidth: "48rem" }} />;`,
    ],
    ["a setProperty call", `el.style.setProperty("--tf-pad", "0.75rem");`],
    ["a custom-property object entry", `const vars = { "--tf-x": "1.5rem" };`],
    ["a template computing the value", "const s = `${n}rem`;"],
    ["a direct DOM style assignment", `node.style.height = "2rem";`],
    ["injected style text", "style.textContent = `.x{margin:2rem}`;"],
    [
      "a concatenation's bare unit literal",
      `node.style.height = String(n) + "rem";`,
    ],
  ];
  for (const [label, sourceText] of violationShapes) {
    it(`flags ${label}`, () => {
      const { violations } = findAuthoredRemInSource(sourceText, "probe.tsx");
      expect(violations).toHaveLength(1);
    });
  }

  it("the bare-unit rule is exact-match: prose mentioning rem stays invisible", () => {
    const { violations, excused } = findAuthoredRemInSource(
      `const label = "about one rem of padding"; const note = "rems";`,
      "probe.tsx",
    );
    expect(violations).toEqual([]);
    expect(excused).toEqual([]);
  });
});

describe("every branch locates its finding in the FILE — the allowlist-key premise, executed per branch", () => {
  it("a short style-object literal: the excerpt carries surrounding code, the line is the rem's own", () => {
    const { violations } = findAuthoredRemInSource(
      `const before = 1;\nconst x = <div style={{ maxWidth: "48rem" }} />;`,
      "probe.tsx",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.excerpt).toContain("maxWidth");
    expect(violations[0]?.line).toBe(2);
  });

  it("a bare unit literal: the excerpt carries the join, the line is the literal's own", () => {
    const { violations } = findAuthoredRemInSource(
      `const before = 1;\nnode.style.height = String(n) + "rem";`,
      "probe.tsx",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.excerpt).toContain("String(n)");
    expect(violations[0]?.line).toBe(2);
  });

  it("a `${n}rem` template: the excerpt reaches back over the substitution", () => {
    const { violations } = findAuthoredRemInSource(
      "const a = `${width}rem`;\nconst filler = 1;\nconst b = `${height}rem`;",
      "probe.tsx",
    );
    expect(violations).toHaveLength(2);
    expect(violations[0]?.excerpt).toContain("width");
    expect(violations[0]?.excerpt).not.toContain("height");
    expect(violations[1]?.excerpt).toContain("height");
    expect(violations[0]?.line).toBe(1);
    expect(violations[1]?.line).toBe(3);
  });

  it("a multi-line injected-style template: the line is the rem's, not the template's opening", () => {
    const { violations } = findAuthoredRemInSource(
      "const s = `\n.a{margin:1px}\n.b{padding:2rem}\n`;",
      "probe.tsx",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(3);
    expect(violations[0]?.excerpt).toContain(".b{padding:2rem}");
  });

  it("two same-text sites in one file produce distinguishable keys", () => {
    const { violations } = findAuthoredRemInSource(
      `const a = { h: "2rem" };\nconst b = { w: "2rem" };`,
      "probe.tsx",
    );
    expect(violations).toHaveLength(2);
    expect(violations[0]?.excerpt).toContain('h: "2rem"');
    expect(violations[1]?.excerpt).toContain('w: "2rem"');
    expect(violations[0]?.excerpt).not.toContain('w: "2rem"');
  });
});

describe("the scanner excuses the real className survivors and only those", () => {
  // Verbatim from the living components — if these drift, the components
  // moved, and the anti-vacuity floor above is the change detector.
  const survivors: [string, string][] = [
    [
      "assistant-palette",
      `const c = "tf:m-auto tf:h-[calc(100dvh-2rem)] tf:w-[calc(100vw-2rem)] tf:flex-col " + "tf:sm:mt-24 tf:sm:h-[calc(100dvh-12rem)] tf:sm:max-h-144 tf:sm:w-full tf:sm:max-w-2xl";`,
    ],
    [
      "thread-list",
      `const c = cx(base, safe ? "tf:pb-[calc(0.5rem_+_env(safe-area-inset-bottom))]" : "tf:pb-2");`,
    ],
    [
      "sheet",
      `const c = "tf:m-0 tf:h-dvh tf:max-h-dvh tf:w-80 tf:max-w-[calc(100vw-3rem)] tf:flex-col";`,
    ],
    [
      "floating-panel pane",
      `const c = "tf:inset-y-0 tf:right-0 tf:left-auto tf:h-dvh tf:w-104 tf:max-w-[calc(100vw-2rem)] tf:rounded-none";`,
    ],
    [
      "floating-panel clamp",
      `const c = "tf:inset-auto tf:bottom-4 tf:w-[clamp(24rem,44vw,46rem)] tf:max-w-[calc(100vw-2rem)]";`,
    ],
    [
      "floating-panel min",
      `const c = "tf:h-[min(68dvh,52rem,calc(100dvh-6rem))]";`,
    ],
    [
      "tool-arguments-summary",
      `const c = "tf:grid tf:grid-cols-[minmax(min(6rem,35%),0.35fr)_minmax(0,1fr)] tf:gap-x-3";`,
    ],
    [
      "companion-history-menu",
      `const c = "tf:left-2.5 tf:w-80 tf:max-w-[calc(100%-1.25rem)] tf:pt-2";`,
    ],
    [
      "provider-chip",
      `const c = "tf:absolute tf:w-80 tf:max-w-[calc(100vw-2rem)] tf:flex-col tf:gap-3";`,
    ],
    [
      "model-picker-chip",
      `const c = "tf:absolute tf:max-h-[min(32rem,calc(100vh-6rem))] tf:w-80 tf:max-w-full";`,
    ],
  ];
  for (const [label, sourceText] of survivors) {
    it(`excuses ${label}`, () => {
      const { violations, excused } = findAuthoredRemInSource(
        sourceText,
        "probe.tsx",
      );
      expect(violations).toEqual([]);
      expect(excused.length).toBeGreaterThan(0);
    });
  }

  it("does not excuse an arbitrary-PROPERTY class (no `-` before the bracket) — fail-loud in the ambiguous middle", () => {
    const { violations } = findAuthoredRemInSource(
      `const c = "[margin:2rem] tf:flex";`,
      "probe.tsx",
    );
    expect(violations).toHaveLength(1);
  });
});

describe("invisible by construction, red on lex failure", () => {
  it("comments, regex literals and JSX text yield nothing", () => {
    const sourceText = [
      `// margin: 2rem is discussed here, and 36rem too`,
      `/* block prose: the panel is 52rem tall */`,
      `const pattern = /\\d+rem/;`,
      `const el = <p>about 2rem of padding</p>;`,
    ].join("\n");
    const { violations, excused } = findAuthoredRemInSource(
      sourceText,
      "probe.tsx",
    );
    expect(violations).toEqual([]);
    expect(excused).toEqual([]);
  });

  it("a file the parser cannot lex reddens the law instead of shrinking its input", () => {
    expect(() =>
      findAuthoredRemInSource(`const x = "unterminated`, "probe.ts"),
    ).toThrow(/cannot lex/);
  });

  it("REGRESSION CONTROL — the authored-rem defect, re-planted and re-caught on every run", () => {
    // The real find that proved this law red before anything was fixed:
    // fixtures/transcript/main.tsx's late-suspension probes carried
    // min(calc(100dvh - 12rem), 36rem) in a style object. The fix baked
    // the rem terms to px; this control reverts one of them in memory
    // and requires the scanner to flag it — the mutation is executed,
    // never read.
    const file = "fixtures/transcript/main.tsx";
    const text = readFileSync(path.join(packageRoot, file), "utf8");
    const fixed = findAuthoredRemInSource(text, file);
    expect(fixed.violations).toEqual([]);
    expect(text).toContain('"min(calc(100dvh - 192px), 576px)"');
    const replanted = text.replace(
      '"min(calc(100dvh - 192px), 576px)"',
      '"min(calc(100dvh - 192px), 36rem)"',
    );
    const { violations } = findAuthoredRemInSource(replanted, file);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.excerpt).toContain("36rem");
  });
});
