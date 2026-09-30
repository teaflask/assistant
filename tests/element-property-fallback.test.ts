/**
 * The shadow-root edition of Tailwind's `--tw-*` fallback
 * (scripts/build-element.mjs, withUngatedPropertyFallback): the element's
 * baked sheet re-emits Tailwind's own `@layer properties` fallback body
 * ungated, so every `--tw-*` chain resolves inside the adopted-sheet
 * shadow root where `@property` registrations do not apply — without the
 * element writing anything to the host document. Measured against the
 * real compiled sheet, never a stub; the browser-side half is the
 * shadow-root control in tests-e2e/tvc-motion.spec.ts.
 */
import { describe, expect, it } from "vitest";

import { withUngatedPropertyFallback } from "../scripts/build-element.mjs";
import { compiledSheet } from "./compiled-sheet";

const GATED_BLOCK =
  /@layer properties\{@supports [^{]*\{(\*,:before,:after,::backdrop\{([^}]*)\})\}\}/;
const UNGATED_RULE = /(?:^|\})(\*,:before,:after,::backdrop\{([^}]*)\})/;

describe("the element sheet's ungated --tw-* fallback", () => {
  const sheet = compiledSheet();
  const baked = withUngatedPropertyFallback(sheet);
  const gated = GATED_BLOCK.exec(baked);
  const ungated = UNGATED_RULE.exec(
    baked.slice((gated?.index ?? 0) + (gated?.[0].length ?? 0)),
  );

  it("re-emits Tailwind's gated fallback body, ungated, right after the gated block", () => {
    expect(gated).not.toBeNull();
    expect(ungated).not.toBeNull();
    expect(ungated?.index).toBe(0);
    expect(ungated?.[2]).toBe(gated?.[2]);
    // Unlayered and earlier than every utility: a utility that sets the
    // same name wins by specificity or by order, never the fallback.
    expect(baked.indexOf(".tf\\:")).toBeGreaterThan(
      (gated?.index ?? 0) + (gated?.[0].length ?? 0),
    );
  });

  it("declares every name the sheet registers with @property", () => {
    const registered = [...sheet.matchAll(/@property\s+(--[\w-]+)/g)].map(
      (match) => match[1],
    );
    const declared = new Set(
      [...(ungated?.[2] ?? "").matchAll(/(--[\w-]+)\s*:/g)].map(
        (match) => match[1],
      ),
    );
    expect(registered.length).toBeGreaterThan(20);
    for (const name of registered) {
      expect(declared.has(name)).toBe(true);
    }
    expect(declared.has("--tw-shadow")).toBe(true);
    expect(declared.has("--tw-inset-shadow")).toBe(true);
    expect(declared.has("--tw-border-style")).toBe(true);
  });

  it("the sheet itself carries the fallback only under the gate — the bake adds the ungated copy", () => {
    const gatedInSheet = GATED_BLOCK.exec(sheet);
    expect(gatedInSheet).not.toBeNull();
    const afterGate = sheet.slice(
      (gatedInSheet?.index ?? 0) + (gatedInSheet?.[0].length ?? 0),
    );
    expect(UNGATED_RULE.exec(afterGate)?.index).not.toBe(0);
  });

  it("negative control — a sheet without the gated block, or with two, cannot be baked", () => {
    expect(() => withUngatedPropertyFallback(".a{color:red}")).toThrow(
      /found 0/,
    );
    const block = gated?.[0] ?? "";
    expect(() => withUngatedPropertyFallback(block + block)).toThrow(/found 2/);
  });
});
