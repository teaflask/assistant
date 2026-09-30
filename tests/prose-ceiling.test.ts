// The prose-ceiling law for the assistant package: a .ts/.tsx module of 50+
// code lines under src/ carries at most one comment line per two code lines.
// No allowlist, no baseline, no per-file exemption: a hit is fixed by keeping
// the intent line and moving the record to docs/<subject>.md or the
// monorepo's records home. The dashboard's architecture law holds this file's
// shared block byte-equal to its own.
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

// --- prose-ceiling law: shared block — byte-equal in the dashboard's architecture law and
// the package's prose-ceiling law, held by the frontend parity arm
// ("the prose-ceiling law is one text in both TypeScript trees") ---
/** Modules with fewer code lines are outside the law. */
const PROSE_CEILING_MIN_CODE_LINES = 50;

interface ProseDensity {
  comment: number;
  code: number;
}

/** The ceiling is one comment line per two code lines — integer arithmetic,
 *  so a module at exactly the ceiling is quiet. */
function overTheProseCeiling(density: ProseDensity): boolean {
  return 2 * density.comment > density.code;
}

/** The comment/code line split of one TS/TSX module, lexed by the compiler,
 *  never by a regex. A comment line is a non-blank line whose every
 *  non-whitespace character lies in a comment range or in the braces of an
 *  expression-less JsxExpression — the JSX comment form; any other non-blank
 *  line is code, so a trailing comment rides on a code line. A string, template
 *  or regex literal spelling `//` or `/*` is code. */
function proseDensityOf(text: string, fileName: string): ProseDensity {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.ESNext,
    true,
    kind,
  );
  // parseDiagnostics is internal but stable: an unlexable file must red the
  // law rather than silently count as code.
  const diagnostics = (
    source as unknown as { parseDiagnostics: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if (diagnostics.length > 0) {
    throw new Error(
      `${fileName} does not parse: ${ts.flattenDiagnosticMessageText(diagnostics[0].messageText, " ")}`,
    );
  }
  const prose = new Uint8Array(text.length);
  const seen = new Set<number>();
  const take = (ranges: readonly ts.CommentRange[] | undefined) => {
    for (const range of ranges ?? []) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      prose.fill(1, range.pos, range.end);
    }
  };
  // getChildren, not forEachChild: comments before a closing brace and at
  // the end of the file hang off tokens.
  const visit = (node: ts.Node) => {
    take(ts.getLeadingCommentRanges(text, node.getFullStart()));
    take(ts.getTrailingCommentRanges(text, node.getEnd()));
    if (ts.isJsxExpression(node) && node.expression === undefined) {
      prose.fill(1, node.getStart(source), node.getEnd());
    }
    for (const child of node.getChildren(source)) visit(child);
  };
  visit(source);
  const density: ProseDensity = { comment: 0, code: 0 };
  let position = 0;
  for (const line of text.split("\n")) {
    const end = position + line.length;
    let nonBlank = false;
    let code = false;
    for (let index = position; index < end; index += 1) {
      const char = text[index];
      if (char === " " || char === "\t" || char === "\r") continue;
      nonBlank = true;
      if (prose[index] === 0) {
        code = true;
        break;
      }
    }
    if (nonBlank) {
      if (code) density.code += 1;
      else density.comment += 1;
    }
    position = end + 1;
  }
  return density;
}

/** Whether a walk prunes a directory: every generated tree — generated/,
 *  generated-serving/, generated-agent-config/ — is orval or catalog output,
 *  regenerated wholesale and never authored. */
const isGeneratedDirectory = (name: string) => name.startsWith("generated");

/** The law's population: every authored .ts/.tsx module under root, never a
 *  .d.ts, never a generated tree. */
function proseCeilingFilesUnder(root: string): string[] {
  const files: string[] = [];
  const descend = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!isGeneratedDirectory(entry.name)) descend(full);
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        files.push(full);
      }
    }
  };
  descend(root);
  return files.sort();
}

/** The same set by a second, independent enumeration — a glob per class and
 *  a regex over the relative path — so a walk that stops recursing or a
 *  filter that drops a class disagrees with it instead of scanning less. */
function proseCeilingCrossEnumerationUnder(root: string): string[] {
  return [".ts", ".tsx"]
    .flatMap((extension) => globSync(`**/*${extension}`, { cwd: root }))
    .filter(
      (entry) =>
        !/(^|[\\/])generated[^\\/]*[\\/]/.test(entry) &&
        !entry.endsWith(".d.ts"),
    )
    .map((entry) => path.join(root, entry))
    .sort();
}

/** Every module over the ceiling as `label/rel: comment/code (+excess)`, worst
 *  ratio first, with the anti-vacuity arms that make a shrunken scan red: the
 *  walk agrees with an independent enumeration; the tree holds at least
 *  `floor` modules; some module reaches the code-line floor (the counter reads
 *  code); and the tree holds more comment lines than modules (the lexer reads
 *  prose). An unparseable module throws (proseDensityOf). */
function proseCeilingViolationsUnder(
  label: string,
  root: string,
  floor: number,
): string[] {
  const files = proseCeilingFilesUnder(root);
  expect(
    files,
    `${label}: the walk and an independent glob disagree on the file set`,
  ).toEqual(proseCeilingCrossEnumerationUnder(root));
  expect(
    files.length,
    `${label}: fewer files than the tree is known to hold`,
  ).toBeGreaterThanOrEqual(floor);
  const measured = files.map((file) => ({
    file,
    density: proseDensityOf(readFileSync(file, "utf8"), file),
  }));
  expect(
    measured.some(
      ({ density }) => density.code >= PROSE_CEILING_MIN_CODE_LINES,
    ),
    `${label}: no file reaches the ${String(PROSE_CEILING_MIN_CODE_LINES)}-code-line floor — the counter is not reading code`,
  ).toBe(true);
  expect(
    measured.reduce((sum, { density }) => sum + density.comment, 0),
    `${label}: fewer comment lines than files — the lexer is not reading prose`,
  ).toBeGreaterThan(files.length);
  return measured
    .filter(
      ({ density }) =>
        density.code >= PROSE_CEILING_MIN_CODE_LINES &&
        overTheProseCeiling(density),
    )
    .sort(
      (a, b) =>
        b.density.comment / b.density.code -
          a.density.comment / a.density.code || a.file.localeCompare(b.file),
    )
    .map(
      ({ file, density }) =>
        `${label}/${path.relative(root, file)}: ${String(density.comment)}/${String(density.code)} (+${String(density.comment - Math.floor(density.code / 2))})`,
    );
}

const proseCeilingCodeLines = (count: number) =>
  Array.from(
    { length: count },
    (_, i) => `export const c${String(i)} = ${String(i)};`,
  );
const proseCeilingCommentLines = (count: number) =>
  Array.from({ length: count }, (_, i) => `// comment ${String(i)}`);
const proseCeilingModule = (code: number, comment: number) =>
  `${[...proseCeilingCommentLines(comment), ...proseCeilingCodeLines(code)].join("\n")}\n`;

function theProseCeilingLawCanFail(): void {
  // The ceiling itself, at the boundary.
  expect(overTheProseCeiling({ comment: 25, code: 50 })).toBe(false);
  expect(overTheProseCeiling({ comment: 26, code: 50 })).toBe(true);
  expect(overTheProseCeiling({ comment: 25, code: 51 })).toBe(false);
  expect(overTheProseCeiling({ comment: 26, code: 51 })).toBe(true);

  // Every code shape a naive matcher mistakes for prose is code; every
  // comment shape the lexer must see is prose.
  const lookalikes = [
    'export const a = "// not a comment";',
    "export const b = `/* nor this ${String(1)} */`;",
    "export const c = /\\/\\/ x/;",
    'export const d = "https://x.example/*/y";',
  ].join("\n");
  expect(proseDensityOf(lookalikes, "lookalikes.ts")).toEqual({
    comment: 0,
    code: 4,
  });
  expect(
    proseDensityOf("const y = 1; // trailing\nvoid y;", "trailing.ts"),
  ).toEqual({ comment: 0, code: 2 });
  expect(
    proseDensityOf(
      "const z = Math.max(1, /* first\n  second\n  third */ 2);\nvoid z;",
      "block.ts",
    ),
  ).toEqual({ comment: 1, code: 3 });
  expect(
    proseDensityOf(
      "/** doc */\n// line\n/* block\n   more */\nexport const e = 1;",
      "forms.ts",
    ),
  ).toEqual({ comment: 4, code: 1 });
  const jsx = [
    "export function J() {",
    "  return (",
    "    <div>",
    ...Array.from({ length: 44 }, (_, i) => `      <i>{${String(i)}}</i>`),
    ...Array.from(
      { length: 26 },
      (_, i) => `      {/* jsx comment ${String(i)} */}`,
    ),
    "      <b>{/* inline */}text</b>",
    "    </div>",
    "  );",
    "}",
  ].join("\n");
  expect(proseDensityOf(jsx, "jsx.tsx")).toEqual({ comment: 26, code: 51 });
  expect(() => proseDensityOf("const = ;", "broken.ts")).toThrow(
    /does not parse/,
  );

  // The walk takes exactly the authored .ts/.tsx modules, agrees with its
  // independent enumeration, and the scan reports exactly the modules over
  // the ceiling — each anti-vacuity arm's RED path driven through the law's
  // own scan function first.
  const dir = mkdtempSync(path.join(tmpdir(), "prose-ceiling-"));
  try {
    writeFileSync(path.join(dir, "under-floor.ts"), proseCeilingModule(49, 49));
    expect(() => proseCeilingViolationsUnder("fixture", dir, 1)).toThrow(
      /no file reaches the 50-code-line floor/,
    );
    writeFileSync(path.join(dir, "at-ceiling.ts"), proseCeilingModule(50, 25));
    expect(() => proseCeilingViolationsUnder("fixture", dir, 10)).toThrow(
      /fewer files than the tree is known to hold/,
    );
    writeFileSync(path.join(dir, "silent.ts"), proseCeilingModule(50, 0));
    writeFileSync(path.join(dir, "at-ceiling.ts"), proseCeilingModule(50, 0));
    writeFileSync(path.join(dir, "under-floor.ts"), proseCeilingModule(49, 2));
    expect(() => proseCeilingViolationsUnder("fixture", dir, 1)).toThrow(
      /fewer comment lines than files/,
    );
    rmSync(path.join(dir, "silent.ts"));
    writeFileSync(path.join(dir, "under-floor.ts"), proseCeilingModule(49, 49));
    writeFileSync(path.join(dir, "at-ceiling.ts"), proseCeilingModule(50, 25));
    writeFileSync(path.join(dir, "over.ts"), proseCeilingModule(50, 26));
    writeFileSync(path.join(dir, "jsx.tsx"), `${jsx}\n`);
    writeFileSync(
      path.join(dir, "literals.ts"),
      `${Array.from({ length: 50 }, (_, i) => `export const s${String(i)} = "// ${String(i)} /* not prose */";`).join("\n")}\n`,
    );
    for (const skipped of [
      "types.d.ts",
      "generated/x.ts",
      "generated-serving/y.ts",
      "lib/generated-agent-config/z.ts",
    ]) {
      mkdirSync(path.dirname(path.join(dir, skipped)), { recursive: true });
      writeFileSync(path.join(dir, skipped), proseCeilingModule(50, 50));
    }
    writeFileSync(path.join(dir, "lib", "notes.md"), "# not a module\n");
    expect(
      proseCeilingFilesUnder(dir).map((file) => path.relative(dir, file)),
    ).toEqual([
      "at-ceiling.ts",
      "jsx.tsx",
      "literals.ts",
      "over.ts",
      "under-floor.ts",
    ]);
    expect(proseCeilingFilesUnder(dir)).toEqual(
      proseCeilingCrossEnumerationUnder(dir),
    );
    expect(proseCeilingViolationsUnder("fixture", dir, 5)).toEqual([
      "fixture/over.ts: 26/50 (+1)",
      "fixture/jsx.tsx: 26/51 (+1)",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
// --- end of the prose-ceiling law's shared block ---

describe("src prose stays under the ceiling", () => {
  it(
    "no .ts/.tsx module of 50+ code lines under src carries more than one comment line per two code lines",
    { timeout: 30_000 },
    () => {
      // The floor sits at ~90% of the measured tree (239 authored modules on
      // 2026-09-14): the backstop for a change that shrinks every
      // enumeration at once.
      expect(proseCeilingViolationsUnder("src", SRC, 215)).toEqual([]);
    },
  );

  it("the prose-ceiling law can fail — a module over the ceiling is named with its counts; the floor, the skipped classes and every code-shaped comment lookalike stay quiet", () => {
    theProseCeilingLawCanFail();
  });
});
