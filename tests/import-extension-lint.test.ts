// The lint fixture for the import-extension law, proving both directions
// against the REAL eslint.config.mjs: (1) the config carries the
// extension rule for src files — deleting the rule config turns this
// file red — and (2) the extracted rule entries, run through a bare
// Linter, flag exactly the extensionless relative forms and stay silent
// on extended, bare and virtual specifiers. The no-rules control on each
// flagged snippet proves the finding comes from the rule config, not the
// parser or an unrelated rule.
import { fileURLToPath } from "node:url";

import { ESLint, Linter } from "eslint";
import tseslint from "typescript-eslint";
import { beforeAll, describe, expect, it } from "vitest";

const PKG_ROOT = fileURLToPath(new URL("..", import.meta.url));
// Pattern-based lookup — the probe file does not need to exist, it only
// needs to match the src/**/*.{ts,tsx} scoping of the rule blocks.
const PROBE_PATH = fileURLToPath(
  new URL("../src/components/extension-probe.tsx", import.meta.url),
);

interface RestrictedImportPattern {
  regex?: string;
  group?: string[];
  message?: string;
}
interface RestrictedSyntaxSelector {
  selector: string;
  message: string;
}

let importsEntry: [number, { patterns?: RestrictedImportPattern[] }];
let syntaxEntry: [number, ...RestrictedSyntaxSelector[]];

beforeAll(async () => {
  const eslint = new ESLint({ cwd: PKG_ROOT });
  const config = (await eslint.calculateConfigForFile(PROBE_PATH)) as {
    rules?: Record<string, unknown>;
  };
  importsEntry = config.rules?.["no-restricted-imports"] as typeof importsEntry;
  syntaxEntry = config.rules?.["no-restricted-syntax"] as typeof syntaxEntry;
});

describe("the import-extension rule in the real config", () => {
  it("carries the extension pattern in no-restricted-imports at error severity", () => {
    expect(importsEntry).toBeDefined();
    expect(importsEntry[0]).toBe(2);
    const pattern = importsEntry[1].patterns?.find((p) =>
      p.regex?.startsWith("^\\.(?!"),
    );
    expect(pattern).toBeDefined();
    expect(pattern?.message).toContain('needs "./x.js"');
  });

  it("carries the dynamic-import and typeof-import selectors in no-restricted-syntax at error severity", () => {
    expect(syntaxEntry).toBeDefined();
    expect(syntaxEntry[0]).toBe(2);
    const selectors = syntaxEntry.slice(1) as RestrictedSyntaxSelector[];
    const dynamic = selectors.find((s) =>
      s.selector.startsWith("ImportExpression"),
    );
    const typePosition = selectors.find((s) =>
      s.selector.startsWith("TSImportType"),
    );
    expect(dynamic?.message).toContain("append .js");
    expect(typePosition?.message).toContain("append .js");
  });
});

describe("the extracted rule entries against the sweep enumeration", () => {
  const linter = new Linter();
  const lint = (code: string, rules: Linter.RulesRecord) =>
    linter.verify(
      code,
      [
        {
          // Flat-config matching is explicit: without a files pattern the
          // .tsx probe filename matches no configuration at all.
          files: ["**/*.tsx"],
          languageOptions: {
            parser: tseslint.parser,
            sourceType: "module",
          },
          rules,
        },
      ],
      "probe.tsx",
    );
  const extensionRules = (): Linter.RulesRecord => ({
    "no-restricted-imports": importsEntry as Linter.RuleEntry,
    "no-restricted-syntax": syntaxEntry as Linter.RuleEntry,
  });

  const FLAGGED: [code: string, expectedRuleId: string][] = [
    ['import { a } from "./a";', "no-restricted-imports"],
    ['import type { T } from "../t";', "no-restricted-imports"],
    ['export * from "./m";', "no-restricted-imports"],
    ['export { x } from "./b";', "no-restricted-imports"],
    ['export type { C } from "./c";', "no-restricted-imports"],
    ['import { M } from "../generated/models";', "no-restricted-imports"],
    ['const p = import("./lazy");', "no-restricted-syntax"],
    ['type H = typeof import("./s");', "no-restricted-syntax"],
  ];

  const CLEAN: string[] = [
    'import { a } from "./a.js";',
    'import { M } from "../generated/models/index.js";',
    'import "./s.css";',
    'import d from "./d.json";',
    'import { filter } from "rxjs";',
    'import cssText from "virtual:tf-element-styles";',
    'const p = import("./lazy.js");',
    'type H = typeof import("./s.js");',
  ];

  it.each(FLAGGED)("flags %s via %s", (code, expectedRuleId) => {
    const messages = lint(code, extensionRules());
    expect(messages.some((m) => m.ruleId === expectedRuleId)).toBe(true);
    expect(messages.every((m) => m.fatal !== true)).toBe(true);
    // The no-rules control: the same snippet parses clean, so the finding
    // above is the rule's, not a parse artifact.
    expect(lint(code, {})).toEqual([]);
  });

  it.each(CLEAN)("stays silent on %s", (code) => {
    expect(lint(code, extensionRules())).toEqual([]);
  });
});
