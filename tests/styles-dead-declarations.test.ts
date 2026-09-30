/**
 * The dead-declarations law: a declaration the built sheet can never
 * paint. Two arms over the sheet compiled FRESH (compiled-sheet.ts):
 *
 * Arm A (total over the sheet's text): every fallback-less `var(--X)`
 * read in the built sheet resolves to a `--X:` declaration or an
 * `@property --X` registration somewhere in the built sheet. The
 * package's tokens live in `@theme inline`, which inlines them into
 * utilities and never emits a custom property, so a hand-written
 * `var(--shadow-tf-…)` or `var(--text-tf-…)` is invalid at
 * computed-value time and paints nothing; `--theme(--token)` is the
 * spelling that resolves. Bound: resolution is textual, not cascaded —
 * the law catches a name the sheet never declares, not a declaration
 * scoped to the wrong ancestor. A read WITH a fallback is a contract with
 * the host (the public `--tf-*` tokens, the JS-set perch lift, the dark
 * bridge) and is outside the law.
 *
 * Arm B (partial, element-local): no JSX element whose className is
 * statically known declares a `tf:shadow-*` utility while its own static
 * attributes or classes satisfy the rightmost compound of a hand-written
 * `box-shadow` rule. Utilities and hand-written rules are both unlayered
 * and every hand-written rule follows the LAST utility in the built sheet
 * (pinned below), so such a rule beats the utility at any specificity —
 * the ancestor part of the selector is treated as satisfiable, and the
 * element must drop the utility or the attribute. Today's tree has NO
 * statically classed `tf:shadow-*` carrier at all (the companion perch
 * plate, the last one, left with its Portal token), so over the real
 * tree Arm B is a tripwire that fires on the first future carrier a
 * hand-written rule kills; its machinery is held by the planted-carrier
 * controls below, which walk a real TSX snippet through the same
 * functions and must red on a glass carrier and stay green on a
 * plate-shaped one. NOT covered: utilities
 * that arrive through a component's variant table or spread props (the
 * subagent pill's outline wash under its glass, superseded by design),
 * dynamic className expressions, variant (`tf:hover:shadow-*`) and
 * important utilities, `tf:ring-*` utilities, compounds with
 * pseudo-classes, type or id selectors, rules that exist only under
 * `@media`, conflicts between two hand-written rules, conflicts that
 * depend on runtime ancestors, and components that add or drop
 * attributes internally.
 *
 * Arm A's resolution is decided on the sheet's text; whether that answer
 * holds in a shipping environment depends on how each mechanism it counts
 * behaves there. Two environments ship: the dashboard's light DOM and the
 * script-tag element's adopted-stylesheet shadow root. A `--_tf-*` alias
 * declared by a hand-written rule and a `--tw-*` set by a utility are
 * plain declarations and hold in both. A `--tw-*` registered by
 * `@property` holds in document stylesheets only: Chromium ignores
 * `@property` inside the element's adopted shadow-root sheet, and
 * Tailwind's `@layer properties` fallback (the `--tw-*` names on `*`) is
 * gated to engines without `@property`, so neither covers the `--tw-*`
 * chain there. What makes the text's answer hold in the element is the
 * ungated copy of that fallback body the bake stage appends to the
 * element's sheet (scripts/build-element.mjs; measured inside the real
 * element by tests-e2e/tvc-motion.spec.ts). The bound that remains: an
 * engine that does none of these is a browser fact, outside this law.
 *
 * The walker under both arms handles nested blocks (a declaration before
 * or after a nested `&` rule or at-rule stays in its own block's body) —
 * today's built sheet has none, and the nesting controls below prove the
 * walker rather than the sheet. Every offset the law compares comes from
 * the same comment-stripped, string-blanked text. The censuses behind
 * both arms, and the claim-by-claim audit of this file's own assertions:
 * the dead-declarations law record.
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

const sourceSheet = readFileSync(
  path.join(packageRoot, "src", "styles", "styles.css"),
  "utf8",
);
const sheet = compiledSheet();

// --- the rule walker -------------------------------------------------------

interface Block {
  /** The preludes of every enclosing block, outermost first. */
  context: readonly string[];
  /** The block's own prelude: a selector list, or an at-rule. */
  prelude: string;
  /** The block's own declarations — nested blocks excluded, declarations
   *  before AND after a nested block included. */
  body: string;
  /** Offset of the opening brace in the scanned (comment-stripped,
   *  string-blanked) text. */
  start: number;
}

/** Comments removed and quoted strings blanked (quotes kept): the one
 *  text the walker scans, so a `var(` or a brace spelled inside a
 *  `content:` value, an attribute value or a comment is never read. */
function scannable(css: string): string {
  return css
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(
      /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g,
      (quoted) => quoted[0] + quoted[0],
    );
}

/** The last `;` outside parentheses, or -1. */
function lastTopLevelSemicolon(text: string): number {
  let depth = 0;
  let found = -1;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "\\") {
      i += 1;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    } else if (char === ";" && depth === 0) {
      found = i;
    }
  }
  return found;
}

/** Every brace block of a stylesheet, minified or not, over `scannable`
 *  text. On an opening brace the buffer is split at its last top-level
 *  `;`: the prefix is the enclosing block's own declarations, the rest
 *  is the new block's prelude — so a declaration that precedes a nested
 *  block is never lost into the nested prelude. Escapes and parentheses
 *  are tracked so a brace inside `url()` never desyncs the walk. */
function blocksOf(css: string): Block[] {
  const blocks: Block[] = [];
  const open: { prelude: string; start: number; body: string }[] = [];
  let buffer = "";
  let parens = 0;
  for (let i = 0; i < css.length; i += 1) {
    const char = css[i];
    if (char === "\\") {
      buffer += char + (css[i + 1] ?? "");
      i += 1;
    } else if (char === "(") {
      parens += 1;
      buffer += char;
    } else if (char === ")") {
      parens = Math.max(0, parens - 1);
      buffer += char;
    } else if (char === "{" && parens === 0) {
      const split = lastTopLevelSemicolon(buffer);
      const parent = open.at(-1);
      if (split !== -1 && parent !== undefined) {
        parent.body += buffer.slice(0, split + 1);
      }
      open.push({
        prelude: buffer.slice(split + 1).trim(),
        start: i,
        body: "",
      });
      buffer = "";
    } else if (char === "}" && parens === 0) {
      const top = open.pop();
      if (top === undefined) {
        throw new Error(`unbalanced "}" at ${String(i)}`);
      }
      top.body += buffer;
      buffer = "";
      blocks.push({
        context: open.map((block) => block.prelude),
        prelude: top.prelude,
        body: top.body,
        start: top.start,
      });
    } else {
      buffer += char;
    }
  }
  if (open.length > 0) {
    throw new Error(`unclosed "{" at ${String(open[0].start)}`);
  }
  return blocks;
}

/** A Tailwind-generated utility block: its selector carries a `tf:`
 *  class (`.tf\:…`, also `:where(.tf\:…)`). The source sheet spells no
 *  such selector (pinned below), so the test is exact for this sheet. */
function isUtility(block: Block): boolean {
  return block.prelude.includes(".tf\\:");
}

function isStyleRule(block: Block): boolean {
  return !block.prelude.startsWith("@");
}

function declarationsOf(block: Block): string[] {
  return block.body
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration !== "");
}

// --- Arm A: every fallback-less var() read resolves ------------------------

/** Names the sheet declares: a `--X:` declaration in any block body, or
 *  an `@property --X` registration. Read from the walker's blocks, so a
 *  declaration after a nested block counts exactly as one before it. */
function declaredNames(blocks: readonly Block[]): Set<string> {
  const names = new Set<string>();
  for (const block of blocks) {
    const registered = /^@property\s+(--[\w-]+)/.exec(block.prelude);
    if (registered !== null) names.add(registered[1]);
    for (const declaration of declarationsOf(block)) {
      const declared = /^(--[\w-]+)\s*:/.exec(declaration);
      if (declared !== null) names.add(declared[1]);
    }
  }
  return names;
}

interface Read {
  name: string;
  /** `selector{declaration}` — the compiled rule is the source rule with
   *  its whitespace stripped, so this is what to grep the source for. */
  where: string;
}

/** Every `var(--X)` with no fallback. A nested `var(--a, var(--b))`
 *  reads `--b` without a fallback, by design. */
function fallbackLessReads(blocks: readonly Block[]): Read[] {
  const reads: Read[] = [];
  for (const block of blocks) {
    for (const declaration of declarationsOf(block)) {
      for (const match of declaration.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
        reads.push({
          name: match[1],
          where: `${block.prelude}{${declaration}}`,
        });
      }
    }
  }
  return reads;
}

function unresolvedReads(css: string): Read[] {
  const blocks = blocksOf(scannable(css));
  const declared = declaredNames(blocks);
  return fallbackLessReads(blocks).filter((read) => !declared.has(read.name));
}

/** The token names the source's `@theme inline` block declares. */
function inlineThemeTokens(source: string): string[] {
  const opener = source.indexOf("@theme inline {");
  const closer = source.indexOf("\n}", opener);
  expect(opener).toBeGreaterThan(-1);
  expect(closer).toBeGreaterThan(opener);
  const block = source
    .slice(opener, closer)
    .replaceAll(/\/\*[\s\S]*?\*\//g, "");
  return [...block.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((match) => match[1]);
}

const PROBE_PATTERN = /^\.dangling-var-probe\.(\d+)\.tmp\.css$/;

/** The source sheet plus one planted rule, compiled through the same
 *  CLI. The probe lives at the package root — outside every census
 *  walk, gitignored, pid-suffixed, force-removed in finally, and swept
 *  when a killed worker leaked one — and keeps the component scan
 *  (re-rooted), so the result is the real sheet plus the plant and
 *  nothing less. */
function compiledWithPlant(plant: string): string {
  const probeName = `.dangling-var-probe.${String(process.pid)}.tmp.css`;
  const probePath = path.join(packageRoot, probeName);
  expect(PROBE_PATTERN.test(probeName)).toBe(true);
  expect(probePathIsOutsideWalkedRoots(probePath)).toBe(true);
  removeProbesFromDeadWorkers(packageRoot, PROBE_PATTERN);
  expect(sourceSheet.match(/@source "\.\.\/components";/g)).toHaveLength(1);
  const rerooted = sourceSheet.replace(
    '@source "../components";',
    '@source "./src/components";',
  );
  writeFileSync(probePath, `${rerooted}\n${plant}\n`);
  try {
    return compiledSheetOf(probeName);
  } finally {
    rmSync(probePath, { force: true });
  }
}

const sheetBlocks = blocksOf(scannable(sheet));

describe("the rule walker", () => {
  it("keeps a declaration before a nested block in its own block's body", () => {
    const blocks = blocksOf(".a{box-shadow:var(--x);&:hover{color:blue}}");
    expect(blocks).toEqual([
      { context: [".a"], prelude: "&:hover", body: "color:blue", start: 30 },
      { context: [], prelude: ".a", body: "box-shadow:var(--x);", start: 2 },
    ]);
  });

  it("keeps a declaration after a nested at-rule in its own block's body", () => {
    const blocks = blocksOf(".a{@media (x){color:red}font-size:1px}");
    expect(blocks.at(-1)).toEqual({
      context: [],
      prelude: ".a",
      body: "font-size:1px",
      start: 2,
    });
  });

  it("never desyncs on a brace or semicolon inside a string, a comment or url()", () => {
    const blocks = blocksOf(
      scannable(
        '/* } */ .a{content:"{;}";background:url(a;b{c})}.b{color:red}',
      ),
    );
    expect(blocks.map((block) => block.prelude)).toEqual([".a", ".b"]);
    expect(blocks[0].body).toBe('content:"";background:url(a;b{c})');
  });

  it("premise — today's built sheet nests no block inside a style rule", () => {
    // Stated so the nesting controls are read as proving the walker, not
    // the sheet; a future nested rule changes this count and nothing else.
    expect(
      sheetBlocks.filter((block) =>
        block.context.some((prelude) => !prelude.startsWith("@")),
      ),
    ).toEqual([]);
  });
});

describe("every fallback-less var() read in the built sheet resolves", () => {
  const reads = fallbackLessReads(sheetBlocks);

  it("resolves to a declaration or an @property registration in the sheet", () => {
    expect(unresolvedReads(sheet).map((read) => read.where)).toEqual([]);
  });

  it("census floor — the scan saw the sheet's reads, declarations and tokens", () => {
    expect(reads.length).toBeGreaterThan(100);
    expect(new Set(reads.map((read) => read.name)).size).toBeGreaterThan(20);
    expect(declaredNames(sheetBlocks).size).toBeGreaterThan(50);
    expect(inlineThemeTokens(sourceSheet).length).toBeGreaterThanOrEqual(25);
  });

  it("premise — the theme is inline and its tokens reach no rule as custom properties", () => {
    expect(sourceSheet.match(/@theme inline \{/g)).toHaveLength(1);
    expect(sheet).not.toMatch(/:root\b/);
    const declared = declaredNames(sheetBlocks);
    for (const token of inlineThemeTokens(sourceSheet)) {
      expect(declared.has(token)).toBe(false);
    }
    // The control-wash utility is the one shadow utility the component
    // scan still emits (the TfButton variants carry it) — the anchor for
    // "an inline token is inlined, never read".
    const controlUtility = sheetBlocks.find(
      (block) => block.prelude === ".tf\\:shadow-tf-control",
    );
    expect(controlUtility).toBeDefined();
    expect(controlUtility?.body).not.toContain("var(--shadow");
  });

  it("negative control — a planted read of an inline token is reported by name and rule", () => {
    const planted = unresolvedReads(
      `${sheet}x{font-size:var(--text-tf-label)}`,
    );
    expect(planted).toEqual([
      { name: "--text-tf-label", where: "x{font-size:var(--text-tf-label)}" },
    ]);
  });

  it("negative control — a var() spelled inside a string or a comment is not a read", () => {
    expect(
      unresolvedReads(
        `${sheet}x{content:"var(--never-declared)"}/* var(--never-declared) */`,
      ),
    ).toEqual([]);
  });

  it("negative control — a dangling read before a nested rule is reported", () => {
    expect(
      unresolvedReads(
        `${sheet}x{box-shadow:var(--nested-dangling);&:hover{color:blue}}`,
      ),
    ).toEqual([
      {
        name: "--nested-dangling",
        where: "x{box-shadow:var(--nested-dangling)}",
      },
    ]);
  });

  it("negative control — a dangling read after a nested at-rule is reported", () => {
    expect(
      unresolvedReads(
        `${sheet}y{@media (min-width:1px){color:red}font-size:var(--after-nested)}`,
      ),
    ).toEqual([
      { name: "--after-nested", where: "y{font-size:var(--after-nested)}" },
    ]);
  });

  it("negative control — a declaration after a nested rule resolves a read", () => {
    expect(
      unresolvedReads(
        `${sheet}z{&:hover{color:red}--after-nested:1px}w{color:var(--after-nested)}`,
      ),
    ).toEqual([]);
  });

  it("negative control — a planted read survives the real compile and is caught there", () => {
    const probe = compiledWithPlant(
      "[data-tf-probe-plant]{box-shadow:var(--shadow-tf-control)}",
    );
    expect(probe).toContain(".tf\\:shadow-tf-control{");
    expect(unresolvedReads(probe)).toEqual([
      {
        name: "--shadow-tf-control",
        where: "[data-tf-probe-plant]{box-shadow:var(--shadow-tf-control)}",
      },
    ]);
  });
});

// --- Arm B: no static shadow utility is out-cascaded by a hand-written rule --

const SHADOW_UTILITY = /^tf:shadow-[\w-]+$/;

interface Carrier {
  file: string;
  line: number;
  utilities: string[];
  /** Statically-present attributes: no initializer reads as "true". */
  attributes: Map<string, string>;
  classes: Set<string>;
}

/** The text of a className initializer when it is static: a string or
 *  template literal, a `+` of those, or a `cx(…)` of those. */
function staticText(node: ts.Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isParenthesizedExpression(node)) return staticText(node.expression);
  if (ts.isJsxExpression(node)) return staticText(node.expression);
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = staticText(node.left);
    const right = staticText(node.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "cx"
  ) {
    const parts = node.arguments.map((argument) => staticText(argument));
    return parts.every((part) => part !== undefined)
      ? parts.join(" ")
      : undefined;
  }
  return undefined;
}

function parsed(file: string): ts.SourceFile {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TSX,
  );
  const diagnostics = (
    source as unknown as { parseDiagnostics: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if (diagnostics.length > 0) {
    throw new Error(
      `${file} does not parse: ${ts.flattenDiagnosticMessageText(diagnostics[0].messageText, " ")}`,
    );
  }
  return source;
}

function carrierOf(
  element: ts.JsxOpeningLikeElement,
  source: ts.SourceFile,
): Carrier | undefined {
  const properties = element.attributes.properties;
  const className = properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === "className",
  );
  const text = staticText(className?.initializer);
  if (text === undefined) return undefined;
  const classes = text.split(/\s+/).filter((token) => token !== "");
  const utilities = classes.filter((token) => SHADOW_UTILITY.test(token));
  if (utilities.length === 0) return undefined;
  const attributes = new Map<string, string>();
  for (const property of properties) {
    if (!ts.isJsxAttribute(property)) continue;
    const name = property.name.getText(source);
    if (property.initializer === undefined) {
      attributes.set(name, "true");
      continue;
    }
    const value = staticText(property.initializer);
    if (value !== undefined) attributes.set(name, value);
  }
  return {
    file: path.relative(packageRoot, source.fileName),
    line: source.getLineAndCharacterOfPosition(element.getStart()).line + 1,
    utilities,
    attributes,
    classes: new Set(classes),
  };
}

function carriersOf(sources: readonly ts.SourceFile[]): Carrier[] {
  const carriers: Carrier[] = [];
  for (const source of sources) {
    const visit = (node: ts.Node): void => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const carrier = carrierOf(node, source);
        if (carrier !== undefined) carriers.push(carrier);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return carriers;
}

interface Compound {
  /** Type and id selectors — never statically matched, so they block. */
  blocking: string[];
  classes: string[];
  attributes: { name: string; value?: string }[];
  pseudo: boolean;
}

/** Split on a separator character outside brackets and parentheses,
 *  honoring backslash escapes. */
function splitTopLevel(
  text: string,
  isSeparator: (c: string) => boolean,
): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "\\") {
      current += char + (text[i + 1] ?? "");
      i += 1;
    } else if (char === "[" || char === "(") {
      depth += 1;
      current += char;
    } else if (char === "]" || char === ")") {
      depth -= 1;
      current += char;
    } else if (depth === 0 && isSeparator(char)) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.filter((part) => part !== "");
}

const COMBINATORS = new Set([" ", ">", "+", "~"]);

function rightmostCompoundOf(complex: string): Compound {
  const compounds = splitTopLevel(complex.trim(), (c) => COMBINATORS.has(c));
  const compound = compounds.at(-1) ?? "";
  const parsedCompound: Compound = {
    blocking: [],
    classes: [],
    attributes: [],
    pseudo: false,
  };
  const simple =
    /\[\s*([\w-]+)\s*(?:=\s*("[^"]*"|'[^']*'|[^\]\s]+))?\s*\]|\.((?:[\w-]|\\.)+)|::?[\w-]+(?:\([^)]*\))?|#[\w-]+|\*|[a-zA-Z][\w-]*/g;
  let covered = 0;
  for (const match of compound.matchAll(simple)) {
    covered += match[0].length;
    if (match[0].startsWith("[")) {
      const rawValue = match.at(2);
      parsedCompound.attributes.push(
        rawValue === undefined
          ? { name: match[1] }
          : { name: match[1], value: rawValue.replaceAll(/^["']|["']$/g, "") },
      );
    } else if (match[0].startsWith(".")) {
      parsedCompound.classes.push(match[3].replaceAll(/\\(.)/g, "$1"));
    } else if (match[0].startsWith(":")) {
      parsedCompound.pseudo = true;
    } else if (match[0] !== "*") {
      parsedCompound.blocking.push(match[0]);
    }
  }
  if (covered !== compound.length) {
    throw new Error(`unparsed compound selector: ${compound}`);
  }
  return parsedCompound;
}

interface KillRule {
  selector: string;
  compounds: Compound[];
  gated: boolean;
  context: readonly string[];
  start: number;
}

/** Every hand-written rule declaring box-shadow, outside @keyframes and
 *  @media (a media-only rule kills only under its media). */
function handWrittenBoxShadowRules(blocks: readonly Block[]): KillRule[] {
  return blocks
    .filter(
      (block) =>
        isStyleRule(block) &&
        !isUtility(block) &&
        !block.context.some(
          (prelude) =>
            prelude.startsWith("@keyframes") || prelude.startsWith("@media"),
        ) &&
        declarationsOf(block).some((declaration) =>
          /^box-shadow\s*:/.test(declaration),
        ),
    )
    .map((block) => ({
      selector: block.prelude,
      compounds: splitTopLevel(block.prelude, (c) => c === ",").map(
        rightmostCompoundOf,
      ),
      gated: block.context.some((prelude) => prelude.startsWith("@supports")),
      context: block.context,
      start: block.start,
    }));
}

function satisfies(carrier: Carrier, compound: Compound): boolean {
  if (compound.pseudo || compound.blocking.length > 0) return false;
  return (
    compound.attributes.every(({ name, value }) => {
      const present = carrier.attributes.get(name);
      return (
        present !== undefined && (value === undefined || present === value)
      );
    }) && compound.classes.every((name) => carrier.classes.has(name))
  );
}

function deadUtilities(
  carriers: readonly Carrier[],
  rules: readonly KillRule[],
): string[] {
  const dead: string[] = [];
  for (const carrier of carriers) {
    const killers = rules
      .filter((rule) =>
        rule.compounds.some((compound) => satisfies(carrier, compound)),
      )
      .map((rule) => rule.selector);
    if (killers.length === 0) continue;
    for (const utility of carrier.utilities) {
      dead.push(
        `${carrier.file}:${String(carrier.line)} ${utility} is dead: ` +
          `${[...new Set(killers)].join(" | ")} declares box-shadow on this ` +
          "element — remove the utility or the attribute",
      );
    }
  }
  return dead;
}

const TSX_FILES = sourceFilesOf(path.join(packageRoot, "src")).filter((file) =>
  file.endsWith(".tsx"),
);

describe("no static shadow utility is out-cascaded by a hand-written box-shadow rule", () => {
  const sources = TSX_FILES.map(parsed);
  const carriers = carriersOf(sources);
  const rules = handWrittenBoxShadowRules(sheetBlocks);

  it("every statically-classed shadow utility survives every hand-written box-shadow rule", () => {
    expect(deadUtilities(carriers, rules)).toEqual([]);
  });

  it("census floor — the walk saw the sources and the sheet's rules; the carrier set is what the tree has", () => {
    expect(sources.length).toBeGreaterThan(50);
    // No floor on carriers: the tree may legitimately have none (it has
    // none today). The planted-carrier controls below hold the walk.
    expect(Array.isArray(carriers)).toBe(true);
    expect(rules.length).toBeGreaterThanOrEqual(8);
    const compounds = rules.flatMap((rule) => rule.compounds);
    expect(
      compounds.some((compound) =>
        compound.attributes.some(({ name }) => name === "data-tf-glass"),
      ),
    ).toBe(true);
    expect(
      compounds.some((compound) =>
        compound.attributes.some(
          ({ name }) => name === "data-tf-composer-wash",
        ),
      ),
    ).toBe(true);
  });

  it("premise — every unlayered hand-written rule follows the last utility, in one coordinate space", () => {
    // The source spells no utility selector, so a `.tf\:` in the built
    // sheet is Tailwind's — which makes `isUtility` exact for this sheet.
    expect(scannable(sourceSheet)).not.toMatch(/\.tf\\?:/);
    const utilities = sheetBlocks.filter(isUtility);
    expect(utilities.length).toBeGreaterThan(150);
    const lastUtilityStart = Math.max(...utilities.map((block) => block.start));
    expect(sheet).toContain("@layer components,utilities;");
    expect(sheet).not.toContain("@layer utilities{");
    const handWritten = sheetBlocks.filter(
      (block) =>
        isStyleRule(block) &&
        !isUtility(block) &&
        !block.context.some(
          (prelude) =>
            prelude.startsWith("@layer") || prelude.startsWith("@keyframes"),
        ),
    );
    expect(handWritten.length).toBeGreaterThan(50);
    for (const block of handWritten) {
      expect(block.start).toBeGreaterThan(lastUtilityStart);
    }
    for (const rule of rules) {
      expect(rule.start).toBeGreaterThan(lastUtilityStart);
      expect(rule.context.some((prelude) => prelude.startsWith("@layer"))).toBe(
        false,
      );
    }
    // A gated rule is a kill, not a conditional, because every gated
    // hand-written box-shadow selector also occurs ungated.
    const ungated = new Set(
      rules.filter((rule) => !rule.gated).map((rule) => rule.selector),
    );
    for (const rule of rules.filter((rule) => rule.gated)) {
      expect(ungated).toContain(rule.selector);
    }
  });

  const synthetic = (
    attributes: Record<string, string>,
    classes: string[],
    utilities = ["tf:shadow-tf-control"],
  ): Carrier => ({
    file: "synthetic.tsx",
    line: 1,
    utilities,
    attributes: new Map(Object.entries(attributes)),
    classes: new Set([...classes, ...utilities]),
  });

  it("negative control — a glass element declaring the portal utility is flagged by the glass rule", () => {
    const dead = deadUtilities([synthetic({ "data-tf-glass": "" }, [])], rules);
    expect(dead).toHaveLength(1);
    expect(dead[0]).toContain("[data-tf-assistant] [data-tf-glass]");
    expect(dead[0]).toContain("synthetic.tsx:1 tf:shadow-tf-control is dead");
  });

  it("negative control — the plate's shape is not flagged", () => {
    expect(
      deadUtilities([synthetic({ "data-tf-companion-body": "" }, [])], rules),
    ).toEqual([]);
  });

  it("negative control — a class carrier is matched by a class compound", () => {
    const dead = deadUtilities([synthetic({}, ["tf-highlight-ring"])], rules);
    expect(dead.join("\n")).toContain(".tf-highlight-ring");
  });

  it("negative control — a kill rule declared before a nested block is seen", () => {
    const nested = handWrittenBoxShadowRules(
      blocksOf(
        scannable(`${sheet}[data-tf-nest]{box-shadow:none;&:hover{color:red}}`),
      ),
    );
    expect(nested.map((rule) => rule.selector)).toContain("[data-tf-nest]");
    expect(
      deadUtilities([synthetic({ "data-tf-nest": "" }, [])], nested),
    ).toHaveLength(1);
  });

  it("negative control — a pseudo-class or type compound never kills", () => {
    const carrier = synthetic({ "data-tf-glass": "" }, []);
    expect(
      satisfies(carrier, rightmostCompoundOf("[data-tf-glass]:hover")),
    ).toBe(false);
    expect(satisfies(carrier, rightmostCompoundOf("div[data-tf-glass]"))).toBe(
      false,
    );
    expect(satisfies(carrier, rightmostCompoundOf("[data-tf-glass]"))).toBe(
      true,
    );
    expect(
      satisfies(carrier, rightmostCompoundOf('[data-tf-glass="true"]')),
    ).toBe(false);
    expect(satisfies(carrier, rightmostCompoundOf('[data-tf-glass=""]'))).toBe(
      true,
    );
  });

  it("negative control — Arm B fires on a planted glass carrier walked from real TSX, and not on a plate-shaped one", () => {
    const snippet = ts.createSourceFile(
      "planted.tsx",
      [
        'const glass = <div data-tf-glass="" className="tf:border tf:shadow-tf-control" />;',
        'const plate = <button data-tf-companion-body="" className="tf:rounded-tf tf:shadow-tf-control" />;',
      ].join("\n"),
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TSX,
    );
    const planted = carriersOf([snippet]);
    expect(planted.map((carrier) => carrier.line)).toEqual([1, 2]);
    const dead = deadUtilities(planted, rules);
    expect(dead).toHaveLength(1);
    expect(dead[0]).toContain("planted.tsx:1 tf:shadow-tf-control is dead");
    expect(dead[0]).toContain("[data-tf-assistant] [data-tf-glass]");
    expect(deadUtilities([planted[1]], rules)).toEqual([]);
  });

  it("negative control — the static boundary: a conditional className is invisible, a concatenation is read", () => {
    const snippet = ts.createSourceFile(
      "snippet.tsx",
      [
        'const a = <div className={cond ? "tf:shadow-tf-portal" : "b"} data-tf-glass="" />;',
        'const b = <div className={"a " + "tf:shadow-tf-portal"} data-tf-glass="" />;',
        'const c = <div className={cx("a", "tf:shadow-tf-portal")} data-tf-glass />;',
        'const d = <div className="tf:hover:shadow-tf-portal tf:shadow-none!" data-tf-glass="" />;',
      ].join("\n"),
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TSX,
    );
    const found = carriersOf([snippet]);
    expect(found.map((carrier) => carrier.line)).toEqual([2, 3]);
    expect(found[1].attributes.get("data-tf-glass")).toBe("true");
    expect(deadUtilities(found, rules)).toHaveLength(2);
  });
});
