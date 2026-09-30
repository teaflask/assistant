// The lint-layer laws: executable proof that the package's token and
// primitive gates still fire. Resolution is delegated to ESLint ITSELF:
// each probe's effective config comes from
// `ESLint.calculateConfigForFile` over the real eslint.config.mjs — the
// same last-write-wins cascade, files/ignores matching, and plugin
// merging the shipped `npm run lint` uses — so deleting a gate,
// loosening its rule options, widening its ignores, narrowing its
// files, or appending a later entry that turns the rule off all land in
// the resolved config and fail the law here, offline. The harness
// hand-resolves NOTHING; it substitutes exactly two things at the
// execution step: it runs the one rule under law (the others are not
// this law's business) and it parses without type information (sound —
// none of the gated rules are type-aware, and a projectService would
// reject these virtual probe filenames; no probe file exists on disk).

import { ESLint, Linter } from "eslint";
import path from "node:path";

import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../..");

/** The slice of ESLint's resolved flat config the harness reads. */
interface ResolvedFlatConfig {
  rules?: Record<string, unknown>;
  plugins?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  languageOptions?: { parser?: unknown };
}

const resolver = new ESLint({ cwd: PACKAGE_ROOT });
const linter = new Linter();

// Probe filenames: one inside the gated tree, one inside the primitives
// layer the element gate exempts. Virtual — the SHIPPED config's own
// resolution decides which gates reach each of them.
const IN_SRC = "src/components/tvc-lint-probe.tsx";
const IN_PRIMITIVES = "src/components/primitives/tvc-lint-probe.tsx";

async function ruleIdsFor(
  code: string,
  ruleId: string,
  filename: string,
): Promise<string[]> {
  const resolved = (await resolver.calculateConfigForFile(
    path.join(PACKAGE_ROOT, filename),
  )) as ResolvedFlatConfig | null | undefined;
  const ruleConfig = resolved?.rules?.[ruleId];
  if (resolved === null || resolved === undefined || ruleConfig === undefined) {
    // ESLint's own resolution says no such gate reaches this path — for
    // the primitives probe that is the law; for a violation probe it is
    // the law FAILING (the toContain below reports it).
    return [];
  }
  const messages = linter.verify(
    code,
    {
      files: ["**/*.{ts,tsx}"],
      languageOptions: {
        // The resolved config's own parser; only the type-aware project
        // service is dropped (the documented substitution).
        parser: resolved.languageOptions?.parser as never,
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      plugins: resolved.plugins as never,
      settings: resolved.settings,
      // The rule exactly as ESLint resolved it — final severity and
      // options after the whole cascade, so an appended "off" entry
      // arrives here as severity 0 and the violation probe goes silent.
      rules: { [ruleId]: ruleConfig } as never,
    },
    filename,
  );
  for (const message of messages) {
    expect(message.fatal, message.message).not.toBe(true);
  }
  return messages.map((message) => message.ruleId ?? "");
}

describe("the token and primitive gates fire (transcript visual contract, §1)", () => {
  it("TVC-170 a raw palette color class in package source is a lint error", async () => {
    const rule = "better-tailwindcss/no-restricted-classes";
    expect(
      await ruleIdsFor(
        'export const Probe = () => <div className="bg-red-500" />;',
        rule,
        IN_SRC,
      ),
    ).toContain(rule);
    expect(
      await ruleIdsFor(
        'export const Probe = () => <div className="bg-tf-muted text-tf-foreground" />;',
        rule,
        IN_SRC,
      ),
    ).toEqual([]);
  });

  it("TVC-172 an arbitrary numeric-literal utility value in package source is a lint error", async () => {
    const rule = "better-tailwindcss/no-restricted-classes";
    expect(
      await ruleIdsFor(
        'export const Probe = () => <div className="w-[347px]" />;',
        rule,
        IN_SRC,
      ),
    ).toContain(rule);
    // calc()/var() arbitrary values stay legal by design.
    expect(
      await ruleIdsFor(
        'export const Probe = () => <div className="w-[calc(100%-var(--tf-gap))]" />;',
        rule,
        IN_SRC,
      ),
    ).toEqual([]);
  });

  it("TVC-171 an inline style prop in package source is a lint error", async () => {
    const rule = "react/forbid-dom-props";
    expect(
      await ruleIdsFor(
        "export const Probe = () => <div style={{ paddingTop: 4 }} />;",
        rule,
        IN_SRC,
      ),
    ).toContain(rule);
    expect(
      await ruleIdsFor(
        'export const Probe = () => <div className="p-2" />;',
        rule,
        IN_SRC,
      ),
    ).toEqual([]);
  });

  it("TVC-173 a raw interactive element outside the primitives layer is a lint error", async () => {
    const rule = "react/forbid-elements";
    const violation = 'export const Probe = () => <button type="button" />;';
    expect(await ruleIdsFor(violation, rule, IN_SRC)).toContain(rule);
    // The OTHER half of the law: inside the primitives layer, ESLint's
    // own resolution must say the gate does not reach the file. Widening
    // the shipped ignore past the primitives directory silences the
    // in-src probe above instead — and turns this law red.
    expect(await ruleIdsFor(violation, rule, IN_PRIMITIVES)).toEqual([]);
    expect(
      await ruleIdsFor("export const Probe = () => <div />;", rule, IN_SRC),
    ).toEqual([]);
  });
});
