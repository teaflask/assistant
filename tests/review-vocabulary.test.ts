// The review-vocabulary law for the assistant package: the comment rule's
// first sentence (the serving side's architecture doc, "Records") — a
// comment in src/ states intent and the current invariant, and review-round
// provenance is a record — enforced for src/**. No allowlist, no per-file
// exemption: a hit is fixed by keeping the invariant and dropping the
// clause, or by moving the paragraph to the monorepo's records home.
import {
  globSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(PACKAGE_ROOT, "src");

// --- review-vocabulary law: shared block — byte-equal in the dashboard's architecture law and
// the package's review-vocabulary law, held by the backend parity arm
// (test_the_review_vocabulary_pattern_is_the_same_in_every_tree) ---
// The same literal is spelled in the backend's test_architecture.py
// (_REVIEW_PROCESS_ARMS) and in the other TypeScript tree's law; the backend
// parity arm holds the three spellings byte-equal. It names review-PROCESS
// shapes only, so the product's own nouns stay nameable: the reviewer who
// approves a proposal, the agent loop's round 0 / round 900 / "every
// round", the Verifier agent, and the doc-authoring flow ("contradicted at
// authoring").
const REVIEW_PROCESS_VOCABULARY_SOURCE = String.raw`\breview[ -]round|\brounds?[ -][1-9][0-9]?\b|\bfindings?[ -][0-9]+\b|\br[0-9]+ (finding|review|ordering)|\baudit pair [0-9]+\b|\b(both|two|three|all|[0-9]+/[0-9]+) reviewers|×[0-9]+ reviewers|\breviewers? [0-9]+\b|\breviewers? (verif|contradict|independently|unanimous)|\bnext reviewer|\bterminal verifier|\bverifier's correction|\b(red|verified|proven|stall) at authoring|\b[0-9]+ at authoring`;
const REVIEW_PROCESS_VOCABULARY = new RegExp(
  REVIEW_PROCESS_VOCABULARY_SOURCE,
  "i",
);

interface ProseLine {
  line: number;
  text: string;
}

/** Every comment line of a TS/TSX module — line, block, JSDoc and JSX
 *  comment forms alike — lexed by the compiler, never by a regex (styles-prefix's
 *  six recorded blind spots). A string or regex literal carrying the
 *  words is code, not prose, and is not returned. */
function commentsOf(text: string, fileName: string): ProseLine[] {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.ESNext,
    true,
    kind,
  );
  // parseDiagnostics is internal but stable: an unlexable file must red the
  // law rather than silently shrink its input.
  const diagnostics = (
    source as unknown as { parseDiagnostics: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if (diagnostics.length > 0) {
    throw new Error(
      `${fileName} does not parse: ${ts.flattenDiagnosticMessageText(diagnostics[0].messageText, " ")}`,
    );
  }
  const seen = new Set<number>();
  const lines: ProseLine[] = [];
  const take = (ranges: readonly ts.CommentRange[] | undefined) => {
    for (const range of ranges ?? []) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      const start = source.getLineAndCharacterOfPosition(range.pos).line + 1;
      text
        .slice(range.pos, range.end)
        .split("\n")
        .forEach((piece, offset) => {
          lines.push({ line: start + offset, text: piece });
        });
    }
  };
  // getChildren, not forEachChild: comments before a closing brace and at
  // the end of the file hang off tokens.
  const visit = (node: ts.Node) => {
    take(ts.getLeadingCommentRanges(text, node.getFullStart()));
    take(ts.getTrailingCommentRanges(text, node.getEnd()));
    for (const child of node.getChildren(source)) visit(child);
  };
  visit(source);
  return lines.sort((a, b) => a.line - b.line);
}

/** Every block-comment line of a stylesheet (CSS has no regex literals). */
function cssCommentsOf(text: string): ProseLine[] {
  const lines: ProseLine[] = [];
  for (const match of text.matchAll(/\/\*[\s\S]*?\*\//g)) {
    const start = text.slice(0, match.index).split("\n").length;
    match[0].split("\n").forEach((piece, offset) => {
      lines.push({ line: start + offset, text: piece });
    });
  }
  return lines;
}

const COMMENT_LEADER = /^\s*(?:\/\/|\/\*+|\*+\/?|\{\/\*)\s?/;
const stripLeader = (line: string) =>
  line
    .replace(COMMENT_LEADER, "")
    .replace(/\*\/\s*\}?\s*$/, "")
    .trim();

/** Prose lines carrying review-process vocabulary. A phrase wrapped across
 *  a line and the very next prose line is reported once, on the first line,
 *  with the joined text — and only when neither half matches alone. */
function reviewProcessHits(prose: ProseLine[]): ProseLine[] {
  const hits: ProseLine[] = [];
  prose.forEach((own, index) => {
    const matches = REVIEW_PROCESS_VOCABULARY.test(own.text);
    if (matches) hits.push({ line: own.line, text: own.text.trim() });
    if (index + 1 >= prose.length) return;
    const next = prose[index + 1];
    if (next.line !== own.line + 1) return;
    const tail = stripLeader(next.text);
    const joined = `${stripLeader(own.text)} ${tail}`;
    if (
      !matches &&
      !REVIEW_PROCESS_VOCABULARY.test(tail) &&
      REVIEW_PROCESS_VOCABULARY.test(joined)
    ) {
      hits.push({ line: own.line, text: joined });
    }
  });
  return hits;
}

// The file classes the law covers. A class the tree holds but the scan
// skips is the silent-green defect the arms below exist to catch.
const COVERED_EXTENSIONS = [".ts", ".tsx", ".css"] as const;
// Everything else the three trees hold: images, an icon, a JSON fixture. A
// new extension is a decision — a comment-bearing class (.mjs, .mts, .js,
// .jsx, .scss) must join COVERED_EXTENSIONS or be named here — never a
// silent skip.
const KNOWN_NON_PROSE_EXTENSIONS = [".svg", ".ico", ".json"] as const;

/** Every extension of every file under root. */
function extensionsUnder(root: string): Set<string> {
  const found = new Set<string>();
  for (const entry of readdirSync(root, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isFile()) found.add(path.extname(entry.name));
  }
  return found;
}

/** The extensions under root that the law neither scans nor names. */
function unknownExtensionsUnder(root: string): string[] {
  return [...extensionsUnder(root)]
    .filter(
      (extension) =>
        !(COVERED_EXTENSIONS as readonly string[]).includes(extension) &&
        !(KNOWN_NON_PROSE_EXTENSIONS as readonly string[]).includes(extension),
    )
    .sort();
}

function proseFilesUnder(root: string): string[] {
  return (readdirSync(root, { recursive: true }) as string[])
    .filter((entry) => /\.(ts|tsx|css)$/.test(entry))
    .map((entry) => path.join(root, entry))
    .sort();
}

/** The same set by a second, independent enumeration (a glob per class),
 *  so a walk that stops recursing or a filter that drops a class disagrees
 *  with it instead of quietly scanning less. */
function crossEnumerationUnder(root: string): string[] {
  return COVERED_EXTENSIONS.flatMap((extension) =>
    globSync(`**/*${extension}`, { cwd: root }).map((entry) =>
      path.join(root, entry),
    ),
  ).sort();
}

/** Every covered extension the tree actually holds. */
function coveredExtensionsPresentUnder(root: string): Set<string> {
  const present = new Set<string>();
  for (const entry of readdirSync(root, { recursive: true }) as string[]) {
    const extension = path.extname(entry);
    if ((COVERED_EXTENSIONS as readonly string[]).includes(extension)) {
      present.add(extension);
    }
  }
  return present;
}

/** The law's scan, with the anti-vacuity arms that make a shrunken scan
 *  red: the walk agrees with an independent enumeration; every covered
 *  class present in the tree was scanned; the tree holds at least `floor`
 *  files; every scanned class yielded comment lines; and the tree yielded
 *  more comment lines than files. An unparseable file throws (commentsOf).
 *  What these do not guarantee is that a comment shape the lexer never
 *  sees is caught — the synthetic control proves that. */
function reviewProcessViolationsUnder(
  label: string,
  root: string,
  floor: number,
): string[] {
  const files = proseFilesUnder(root);
  expect(
    files,
    `${label}: the walk and an independent glob disagree on the file set`,
  ).toEqual(crossEnumerationUnder(root));
  const present = coveredExtensionsPresentUnder(root);
  expect(
    new Set(files.map((file) => path.extname(file))),
    `${label}: a covered file class the tree holds was not scanned`,
  ).toEqual(present);
  expect(
    unknownExtensionsUnder(root),
    `${label}: the tree holds a file class the law neither scans nor names`,
  ).toEqual([]);
  expect(
    files.length,
    `${label}: fewer files than the tree is known to hold`,
  ).toBeGreaterThanOrEqual(floor);
  const proseLinesByExtension = new Map<string, number>();
  const violations: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const prose = file.endsWith(".css")
      ? cssCommentsOf(text)
      : commentsOf(text, file);
    const extension = path.extname(file);
    proseLinesByExtension.set(
      extension,
      (proseLinesByExtension.get(extension) ?? 0) + prose.length,
    );
    for (const hit of reviewProcessHits(prose)) {
      violations.push(
        `${label}/${path.relative(root, file)}:${String(hit.line)}: ${hit.text.slice(0, 110)}`,
      );
    }
  }
  for (const extension of present) {
    expect(
      proseLinesByExtension.get(extension) ?? 0,
      `${label}: no comment line was read from any ${extension} file`,
    ).toBeGreaterThan(0);
  }
  const totalProseLines = [...proseLinesByExtension.values()].reduce(
    (sum, count) => sum + count,
    0,
  );
  expect(
    totalProseLines,
    `${label}: fewer comment lines than files — the extractor is not reading`,
  ).toBeGreaterThan(files.length);
  return violations;
}

// Each planted comment names the arm it exercises; the quiet set is the
// product vocabulary the pattern must leave alone, by name.
const PLANTED_REVIEW_PROSE: readonly (readonly [string, boolean])[] = [
  ["// the guard rides here (review round 3, finding 2)", true],
  ["// the 2026-08 review-round sweep closed it", true],
  ["// folded onto DISPATCH (ticket 565 round 4)", true],
  ["// a wider block would swallow it (round-4 finding)", true],
  ["// THE METERS (ticket 943 rounds 2-3; the volume rule)", true],
  ["// stuck on screen (finding 4's fix)", true],
  ["// the cursor law (findings 3+4's shared premise)", true],
  ["// The measured r4 ordering applies first", true],
  ["// the guard went dead (r1 finding 2)", true],
  ["// the ONE voider (audit pair 1)", true],
  ["// found unanimously by three reviewers", true],
  ["// empty stream (both reviewers)", true],
  ["// the explicit label (×3 reviewers): the identity mark", true],
  ["// the promise sweep (reviewer 3): every notice", true],
  ["// reviewers verify this list rather than re-derive it", true],
  ["// reviewers contradicted each other on it", true],
  ["// three reviewers independently confirmed the drop", true],
  ["// reviewers unanimously found the arm dropped", true],
  ["// delete with its next reviewer", true],
  ["// ticket 935's terminal verifier replicated the guard", true],
  ["// the verifier's correction: not a narration", true],
  ["// proven red at authoring with the strip reverted", true],
  ["// the modules carry it (verified at authoring)", true],
  ["// factories in the tree — 27 at authoring", true],
  ["// a 3 s stall at authoring, the deterministic control", true],
  ["// the reviewer approves the exact payload they read", false],
  ["// round 0 stamps the carry; round 900 fires the pressure event", false],
  ["// every round re-reads the stamp; the round infix rides the id", false],
  ["// a doc (contradicted at authoring) has no run", false],
  ["// the scripted verifier plays the manifest's repair part", false],
  ["// round-trip the payload; round-robin across the pool", false],
  [
    "// considered at authoring, the pins were HEAD; install at authoring",
    false,
  ],
  [
    "// the preview round-trips the draft; the small reviewers' queue drains",
    false,
  ],
];

/** The pattern's alternatives, split at depth zero — so the control can
 *  prove every arm is exercised by a planted line. */
function armsOf(source: string): string[] {
  const arms: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of source) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "|" && depth === 0) {
      arms.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  arms.push(current);
  return arms;
}

function theReviewVocabularyLawCanFail(): void {
  const arms = armsOf(REVIEW_PROCESS_VOCABULARY_SOURCE);
  expect(arms.length).toBeGreaterThanOrEqual(12);
  for (const arm of arms) {
    const alone = new RegExp(arm, "i");
    expect(
      PLANTED_REVIEW_PROSE.some(([text, hit]) => hit && alone.test(text)),
      `no planted line exercises the arm ${arm}`,
    ).toBe(true);
  }
  const planted = `${PLANTED_REVIEW_PROSE.map(([text]) => text).join("\n")}\nexport const x = 1;\n`;
  const caught = reviewProcessHits(commentsOf(planted, "planted.ts")).map(
    (hit) => hit.line,
  );
  const expected = PLANTED_REVIEW_PROSE.flatMap(([, hit], index) =>
    hit ? [index + 1] : [],
  );
  expect(caught).toEqual(expected);

  // Every comment shape the lexer must see, and the code shapes it must not.
  const shapes = [
    "/** THE RULE (round-4 finding): the fill declines. */",
    "export function C() {",
    "  const y = 4 / 2; // (round 3)",
    "  const re = /\\/\\/ (review round 9)/;",
    '  const s = "review round 3, finding 2 — round 4 finding 1";',
    "  return (",
    "    <div>",
    "      {/* round 2's ordering applies before the fill */}",
    '      <span>{"review round 3"}</span>',
    "    </div>",
    "  );",
    "}",
    "// found unanimously by all",
    "// reviewers in the roster",
    "void y; void re; void s;",
  ].join("\n");
  expect(reviewProcessHits(commentsOf(shapes, "shapes.tsx"))).toEqual([
    { line: 1, text: "/** THE RULE (round-4 finding): the fill declines. */" },
    { line: 3, text: "// (round 3)" },
    { line: 8, text: "/* round 2's ordering applies before the fill */" },
    { line: 13, text: "found unanimously by all reviewers in the roster" },
  ]);

  const css = [
    "/* The hovered band (round-2 review, finding 1): every",
    "   row recedes once. */",
    '.a { content: "review round 3"; }',
    "/* the reviewer's queue */",
  ].join("\n");
  expect(reviewProcessHits(cssCommentsOf(css))).toEqual([
    { line: 1, text: "/* The hovered band (round-2 review, finding 1): every" },
  ]);

  // An unparseable file reds the law instead of shrinking its input.
  expect(() => commentsOf("const = ;", "broken.ts")).toThrow(/does not parse/);

  // The walk reaches nested files, takes exactly the covered classes, and
  // agrees with its independent cross-enumeration.
  const dir = mkdtempSync(path.join(tmpdir(), "review-vocabulary-"));
  try {
    mkdirSync(path.join(dir, "nested"));
    for (const name of [
      "a.ts",
      "b.tsx",
      "c.css",
      "d.md",
      "e.json",
      "nested/f.ts",
    ]) {
      writeFileSync(path.join(dir, name), "");
    }
    expect(
      proseFilesUnder(dir).map((file) => path.relative(dir, file)),
    ).toEqual(["a.ts", "b.tsx", "c.css", "nested/f.ts"]);
    expect(proseFilesUnder(dir)).toEqual(crossEnumerationUnder(dir));
    expect([...coveredExtensionsPresentUnder(dir)].sort()).toEqual([
      ".css",
      ".ts",
      ".tsx",
    ]);
    expect([...extensionsUnder(dir)].sort()).toEqual([
      ".css",
      ".json",
      ".md",
      ".ts",
      ".tsx",
    ]);
    expect(unknownExtensionsUnder(dir)).toEqual([".md"]);

    // Every anti-vacuity arm's RED path, driven through the law's own scan
    // function against the synthetic tree: an unnamed file class; a floor
    // the tree cannot meet; an extractor that read no prose; and, once the
    // tree holds real prose, a planted hit reported by path and line.
    expect(() => reviewProcessViolationsUnder("fixture", dir, 1)).toThrow(
      /neither scans nor names/,
    );
    rmSync(path.join(dir, "d.md"));
    expect(() => reviewProcessViolationsUnder("fixture", dir, 10)).toThrow(
      /fewer files than the tree is known to hold/,
    );
    expect(() => reviewProcessViolationsUnder("fixture", dir, 1)).toThrow(
      /no comment line was read from any/,
    );
    writeFileSync(
      path.join(dir, "a.ts"),
      "// a clean comment\n// and another\n",
    );
    writeFileSync(path.join(dir, "b.tsx"), "// fine\nexport const b = 1;\n");
    writeFileSync(path.join(dir, "c.css"), "/* a clean rule */\n.a {}\n");
    writeFileSync(
      path.join(dir, "nested/f.ts"),
      "// fine\n// folded onto DISPATCH (ticket 565 round 4)\n",
    );
    expect(reviewProcessViolationsUnder("fixture", dir, 1)).toEqual([
      "fixture/nested/f.ts:2: // folded onto DISPATCH (ticket 565 round 4)",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
// --- end of the review-vocabulary law's shared block ---

describe("src prose never records its review process", () => {
  it(
    "no comment under src numbers a review round or a finding, or names its reviewers",
    { timeout: 30_000 },
    () => {
      // The floor sits at ~90% of the measured tree (389 covered files on
      // 2026-09-14): the backstop for a change that shrinks every
      // enumeration at once.
      expect(reviewProcessViolationsUnder("src", SRC, 350)).toEqual([]);
    },
  );

  it("the review-vocabulary law can fail — every planted arm is caught, every product noun and code literal stays quiet", () => {
    theReviewVocabularyLawCanFail();
  });
});
