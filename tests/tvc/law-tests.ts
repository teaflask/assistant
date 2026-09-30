// The law-test scanner shared by the honesty gate (tvc-meta.test.ts) and
// the release gate (TVC-180, tvc-pure.test.ts). It parses every test
// file under tests/ and tests-e2e/ statically (TypeScript AST, never
// executed) and reports every way a registered law's test could end up
// not running while the suite stays green: a skip/todo/fixme modifier on
// the declaration, a skipped or conditional group, a runtime skip call,
// a declaration nested in a branch, loop or helper function, a file the
// runner would not pick up, and `.only` anywhere. A commented-out
// declaration is not a declaration to a parser, so it simply goes
// missing — which the exactly-one-test check reports.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../..");
const TEST_ROOTS = ["tests", "tests-e2e"].map((dir) =>
  path.join(PACKAGE_ROOT, dir),
);
const META_TEST = path.join(PACKAGE_ROOT, "tests/tvc/tvc-meta.test.ts");
const SKIPPED_DIRECTORY_SUFFIXES = ["-snapshots", "results", "node_modules"];

export const TVC_ID = /TVC-\d{3}/g;

/** Playwright's default `testMatch`, as shipped in the installed runner
 *  (the meta-test pins this string against `playwright/lib/common`). */
export const PLAYWRIGHT_DEFAULT_TEST_MATCH =
  "**/*.@(spec|test).?(c|m)[jt]s?(x)";

/** The runner each root belongs to, and the file names it selects:
 *  vitest.config.mts includes exactly `tests/**\/*.test.{ts,tsx}` (the
 *  meta-test pins that line); Playwright's testDir is `tests-e2e` with
 *  its default match above — spec or test, any of .js/.ts/.mjs/.mts/
 *  .cjs/.cts, optionally x. A law declared in a file outside its runner's
 *  pattern would be found by this scan and run by nothing. */
const RUNNER_FILE_PATTERNS: Partial<Record<string, RegExp>> = {
  tests: /\.test\.tsx?$/,
  "tests-e2e": /\.(?:spec|test)\.[cm]?[jt]sx?$/,
};

/** The walker reads every file either runner could select — the union
 *  of both patterns above — so a law in a file only one runner would run
 *  is still seen, and judged against its own root's runner. */
const SCANNED_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

function scriptKindOf(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** The sanctioned runtime skips: the two Linux-only screenshot gates.
 *  Baselines are Linux renders, so on any other platform the screenshot
 *  groups skip at runtime through `test.skip(SCREENSHOTS_UNAVAILABLE, …)`
 *  with `SCREENSHOTS_UNAVAILABLE = os.platform() !== "linux"`. The
 *  meta-test pins this census exactly; a third runtime skip fails there
 *  until it is added here with its reason. */
export const SANCTIONED_RUNTIME_SKIPS: readonly {
  file: string;
  callee: string;
  condition: string;
}[] = [
  {
    file: "tests-e2e/transcript.spec.ts",
    callee: "test.skip",
    condition: "SCREENSHOTS_UNAVAILABLE",
  },
  {
    file: "tests-e2e/tvc-screenshots.spec.ts",
    callee: "test.skip",
    condition: "SCREENSHOTS_UNAVAILABLE",
  },
];
export const SANCTIONED_GATE_DEFINITION =
  /const SCREENSHOTS_UNAVAILABLE = os\.platform\(\) !== "linux";/;

const DECLARATION_MODIFIERS = new Set(["skip", "only", "todo", "fixme"]);
const SKIP_MODIFIERS = new Set(["skip", "todo", "fixme"]);
const GROUP_PARKERS = new Set(["skip", "todo", "fixme", "skipIf", "runIf"]);
const RUNTIME_PARKERS = new Set(["skip", "fixme", "skipIf", "runIf"]);

interface LawTest {
  id: string;
  file: string;
  title: string;
  skipped: boolean;
}

interface RuntimeSkip {
  file: string;
  line: number;
  callee: string;
  condition: string;
}

export interface LawTestScan {
  /** Every declaration whose plain-literal title carries a TVC id. */
  found: LawTest[];
  /** Every `it(` / `test(` declaration with a plain-literal title. */
  titleCount: number;
  /** Files carrying a `.only` in any it/test/describe chain. */
  onlyIn: string[];
  /** `describe.skip/todo/fixme/skipIf/runIf` (and test.describe.…) sites. */
  groupSkips: string[];
  /** Calls to skip/fixme/skipIf/runIf that are not a titled declaration:
   *  `test.skip(condition, …)`, `test.skip()`, `ctx.skip()`,
   *  `testInfo.skip()`, a destructured `skip()`, `it.skipIf(c)(…)`. */
  runtimeSkips: RuntimeSkip[];
  /** Law declarations nested in an if / ternary / && / || / loop /
   *  switch / try, or in a function that is not a describe callback. */
  conditional: string[];
  /** Law declarations in a file its runner's pattern would not run. */
  unreachable: string[];
  /** Titles claiming more than one id — one law per test. */
  multiIdTitles: string[];
}

export function testFilesUnder(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (
        SKIPPED_DIRECTORY_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))
      ) {
        continue;
      }
      files.push(...testFilesUnder(full));
      continue;
    }
    if (SCANNED_FILE.test(entry.name) && full !== META_TEST) {
      files.push(full);
    }
  }
  return files;
}

/** `test.describe.skip` → ["test", "describe", "skip"]; null when the
 *  callee is not a plain identifier chain (e.g. `it.each([…])(…)`). */
function calleeChainOf(callee: ts.Expression): string[] | null {
  const chain: string[] = [];
  let node: ts.Expression = callee;
  while (ts.isPropertyAccessExpression(node)) {
    chain.unshift(node.name.text);
    node = node.expression;
  }
  if (!ts.isIdentifier(node)) {
    return null;
  }
  chain.unshift(node.text);
  return chain;
}

function literalTitleOf(argument: ts.Expression | undefined): string | null {
  if (argument === undefined) {
    return null;
  }
  if (
    ts.isStringLiteral(argument) ||
    ts.isNoSubstitutionTemplateLiteral(argument)
  ) {
    return argument.text;
  }
  return null;
}

function isDescribeCallback(node: ts.Node): boolean {
  const parent = node.parent;
  if (!ts.isCallExpression(parent)) {
    return false;
  }
  // `describe(…)` and the curried `describe.skipIf(c)(…)` alike.
  const callee = ts.isCallExpression(parent.expression)
    ? parent.expression.expression
    : parent.expression;
  const chain = calleeChainOf(callee);
  return chain?.includes("describe") ?? false;
}

function conditionalAncestorOf(node: ts.Node): string | null {
  for (
    let cursor = node.parent;
    !ts.isSourceFile(cursor);
    cursor = cursor.parent
  ) {
    if (
      ts.isIfStatement(cursor) ||
      ts.isConditionalExpression(cursor) ||
      ts.isForStatement(cursor) ||
      ts.isForOfStatement(cursor) ||
      ts.isForInStatement(cursor) ||
      ts.isWhileStatement(cursor) ||
      ts.isDoStatement(cursor) ||
      ts.isSwitchStatement(cursor) ||
      ts.isTryStatement(cursor)
    ) {
      return ts.SyntaxKind[cursor.kind];
    }
    if (
      ts.isBinaryExpression(cursor) &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(cursor.operatorToken.kind)
    ) {
      return "short-circuit expression";
    }
    if (ts.isFunctionDeclaration(cursor)) {
      return "function declaration";
    }
    if (
      (ts.isArrowFunction(cursor) || ts.isFunctionExpression(cursor)) &&
      !isDescribeCallback(cursor)
    ) {
      return "function that is not a describe callback";
    }
  }
  return null;
}

export function scanLawTests(): LawTestScan {
  const scan: LawTestScan = {
    found: [],
    titleCount: 0,
    onlyIn: [],
    groupSkips: [],
    runtimeSkips: [],
    conditional: [],
    unreachable: [],
    multiIdTitles: [],
  };
  for (const file of TEST_ROOTS.flatMap(testFilesUnder)) {
    const relative = path.relative(PACKAGE_ROOT, file);
    const rootDir = relative.split(path.sep)[0];
    const runnerPattern = RUNNER_FILE_PATTERNS[rootDir];
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      scriptKindOf(file),
    );
    const lineOf = (node: ts.Node): number =>
      source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const chain = calleeChainOf(node.expression);
        if (chain !== null) {
          const [root, ...rest] = chain;
          const last = chain[chain.length - 1];
          const title = literalTitleOf(node.arguments[0]);
          if (
            chain.includes("only") &&
            ["it", "test", "describe"].includes(root)
          ) {
            scan.onlyIn.push(`${relative}:${String(lineOf(node))}`);
          }
          if (chain.includes("describe") && GROUP_PARKERS.has(last)) {
            scan.groupSkips.push(
              `${relative}:${String(lineOf(node))} ${chain.join(".")}`,
            );
          } else if (
            (root === "it" || root === "test") &&
            rest.every((part) => DECLARATION_MODIFIERS.has(part)) &&
            title !== null
          ) {
            scan.titleCount += 1;
            const ids = [...new Set(title.match(TVC_ID) ?? [])];
            if (ids.length > 1) {
              scan.multiIdTitles.push(
                `${relative}: "${title}" claims ${String(ids.length)} ids`,
              );
            }
            if (ids.length > 0) {
              scan.found.push({
                id: ids[0],
                file: relative,
                title,
                skipped: rest.some((part) => SKIP_MODIFIERS.has(part)),
              });
              const nesting = conditionalAncestorOf(node);
              if (nesting !== null) {
                scan.conditional.push(
                  `${ids[0]} (${relative}:${String(lineOf(node))}) inside ${nesting}`,
                );
              }
              if (!runnerPattern?.test(relative)) {
                scan.unreachable.push(
                  `${ids[0]} (${relative}) — no runner picks this file up`,
                );
              }
            }
          } else if (RUNTIME_PARKERS.has(last) && title === null) {
            scan.runtimeSkips.push({
              file: relative,
              line: lineOf(node),
              callee: chain.join("."),
              condition:
                node.arguments.length === 0
                  ? ""
                  : node.arguments[0].getText(source),
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return scan;
}

/** The runtime skips the census does not sanction. */
function unsanctionedRuntimeSkips(scan: LawTestScan): RuntimeSkip[] {
  return scan.runtimeSkips.filter(
    (skip) =>
      !SANCTIONED_RUNTIME_SKIPS.some(
        (gate) =>
          gate.file === skip.file &&
          gate.callee === skip.callee &&
          gate.condition === skip.condition,
      ),
  );
}

/** Every way a registered law's test could fail to run, in one list — the
 *  release gate (TVC-180) and the honesty gate assert it empty. */
export function parkedLawTests(
  scan: LawTestScan,
  registered: ReadonlySet<string>,
): string[] {
  return [
    ...scan.found
      .filter((test) => registered.has(test.id) && test.skipped)
      .map((test) => `${test.id} (${test.file}) wears a skip modifier`),
    ...scan.conditional.filter((entry) => registered.has(entry.slice(0, 7))),
    ...scan.unreachable.filter((entry) => registered.has(entry.slice(0, 7))),
    ...scan.groupSkips.map((entry) => `skipped group ${entry}`),
    ...unsanctionedRuntimeSkips(scan).map(
      (skip) =>
        `runtime skip ${skip.file}:${String(skip.line)} ${skip.callee}(${skip.condition})`,
    ),
  ];
}
