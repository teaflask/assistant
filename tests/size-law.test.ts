// The size law for the assistant package: eslint.config.mjs caps a src
// module at SIZE_LAW.maxLines code lines, a function at
// SIZE_LAW.maxLinesPerFunction and nesting at SIZE_LAW.maxDepth. Over the
// line means split — so no disable directive may name the three rules, and
// no second config block may turn one off, raise it or rescope it. The
// dashboard's architecture law holds its own copy of these checks.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import eslintConfig, { SIZE_LAW } from "../eslint.config.mjs";
import { sourceFilesOf } from "./source-walk";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(PACKAGE_ROOT, "src");

// --- size law: the checks both TypeScript trees run over their eslint config
// and their src/ tree ---
const SIZE_LAW_RULES = [
  "max-lines",
  "max-lines-per-function",
  "max-depth",
] as const;

/** A disable directive that names one of the three size rules. */
const SIZE_LAW_DISABLE =
  /eslint-disable[^\n]*\b(?:max-lines(?:-per-function)?|max-depth)\b/;

interface SizeLawNumbers {
  maxLines: number;
  maxLinesPerFunction: number;
  maxDepth: number;
}

interface SizeLawScope {
  files: readonly string[];
  ignores?: readonly string[];
}

/** What each rule's entry must be for the law to be the law. */
function sizeLawEntriesOf(
  law: SizeLawNumbers,
): Record<(typeof SIZE_LAW_RULES)[number], unknown> {
  return {
    "max-lines": [
      "error",
      { max: law.maxLines, skipBlankLines: true, skipComments: true },
    ],
    "max-lines-per-function": [
      "error",
      {
        max: law.maxLinesPerFunction,
        skipBlankLines: true,
        skipComments: true,
        IIFEs: true,
      },
    ],
    "max-depth": ["error", law.maxDepth],
  };
}

/** One block per rule, that block scoped exactly to the law's globs, its
 *  entry exactly the law's — so an "off", a raised max or a second scope
 *  anywhere in the config is named. */
function sizeLawScopeViolationsOf(
  config: readonly {
    files?: unknown;
    ignores?: unknown;
    rules?: Record<string, unknown>;
  }[],
  law: SizeLawNumbers,
  scope: SizeLawScope,
): string[] {
  const violations: string[] = [];
  const expected = sizeLawEntriesOf(law);
  for (const rule of SIZE_LAW_RULES) {
    const blocks = config.filter(
      (block) => block.rules !== undefined && rule in block.rules,
    );
    if (blocks.length !== 1) {
      violations.push(
        `${rule} is set by ${String(blocks.length)} config blocks — the law is exactly one`,
      );
      continue;
    }
    const [block] = blocks;
    if (JSON.stringify(block.files) !== JSON.stringify(scope.files)) {
      violations.push(
        `${rule} is scoped to ${JSON.stringify(block.files)}, not ${JSON.stringify(scope.files)}`,
      );
    }
    if (JSON.stringify(block.ignores) !== JSON.stringify(scope.ignores)) {
      violations.push(
        `${rule} ignores ${JSON.stringify(block.ignores)}, not ${JSON.stringify(scope.ignores)}`,
      );
    }
    if (
      JSON.stringify(block.rules?.[rule]) !== JSON.stringify(expected[rule])
    ) {
      violations.push(
        `${rule} is ${JSON.stringify(block.rules?.[rule])}, not the law's ${JSON.stringify(expected[rule])}`,
      );
    }
  }
  return violations;
}

/** Every src file whose text carries a disable directive naming a size rule. */
function sizeLawSuppressionsOf(
  files: readonly { path: string; text: string }[],
): string[] {
  return files
    .filter((file) => SIZE_LAW_DISABLE.test(file.text))
    .map((file) => `${file.path} suppresses a size rule`);
}

/** The controls: a config that turns a rule off for one file, a config that
 *  raises a max, and a source that disables a rule — each must be named. */
function theSizeLawCanFail(law: SizeLawNumbers, scope: SizeLawScope): void {
  const lawBlock = {
    files: [...scope.files],
    ignores: scope.ignores === undefined ? undefined : [...scope.ignores],
    rules: sizeLawEntriesOf(law),
  };
  if (lawBlock.ignores === undefined)
    delete (lawBlock as { ignores?: unknown }).ignores;
  const clean = [{ rules: { "no-restricted-syntax": "error" } }, lawBlock];
  expect(sizeLawScopeViolationsOf(clean, law, scope)).toEqual([]);
  const off = [
    ...clean,
    { files: ["src/one.ts"], rules: { "max-lines": "off" } },
  ];
  expect(sizeLawScopeViolationsOf(off, law, scope)).toEqual([
    "max-lines is set by 2 config blocks — the law is exactly one",
  ]);
  const raised = [
    clean[0],
    {
      ...lawBlock,
      rules: {
        ...lawBlock.rules,
        "max-lines-per-function": [
          "error",
          {
            max: law.maxLinesPerFunction + 50,
            skipBlankLines: true,
            skipComments: true,
            IIFEs: true,
          },
        ],
      },
    },
  ];
  expect(sizeLawScopeViolationsOf(raised, law, scope)).toHaveLength(1);
  const rescoped = [clean[0], { ...lawBlock, files: ["src/components/**"] }];
  expect(sizeLawScopeViolationsOf(rescoped, law, scope)).toHaveLength(3);
  expect(
    sizeLawSuppressionsOf([
      {
        path: "a.ts",
        text: "// eslint-disable-next-line max-lines-per-function -- probe\nfunction f() {}\n",
      },
      { path: "b.ts", text: "/* eslint-disable max-depth -- probe */\n" },
      {
        path: "c.tsx",
        text: "// eslint-disable-next-line react-hooks/purity -- fine\n",
      },
      {
        path: "d.ts",
        text: "// the max-lines law lives in eslint.config.mjs\n",
      },
    ]),
  ).toEqual(["a.ts suppresses a size rule", "b.ts suppresses a size rule"]);
}
// --- end of the size law's shared checks ---

const SIZE_LAW_SCOPE: SizeLawScope = { files: ["src/**/*.{ts,tsx}"] };

describe("the size law has one scope and no suppression", () => {
  it("exactly one config block sets each size rule, scoped to src/ and set to the law's numbers", () => {
    expect(
      sizeLawScopeViolationsOf(eslintConfig, SIZE_LAW, SIZE_LAW_SCOPE),
    ).toEqual([]);
  });

  it("no src file suppresses a size rule", () => {
    const files = sourceFilesOf(SRC)
      .filter((file) => !file.includes(`${path.sep}generated${path.sep}`))
      .map((file) => ({
        path: path.relative(SRC, file),
        text: readFileSync(file, "utf8"),
      }));
    expect(files.length).toBeGreaterThan(0);
    expect(sizeLawSuppressionsOf(files)).toEqual([]);
  });

  it("the size law can fail — an off block, a raised max, a rescoped block and a disable directive are each named", () => {
    theSizeLawCanFail(SIZE_LAW, SIZE_LAW_SCOPE);
  });
});
