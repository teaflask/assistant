/**
 * The element bundle's rem→px pass: every rem value in the built
 * stylesheet converts against the 16px standard root — so a host's
 * html{font-size:62.5%} can't shrink the widget — and anything the
 * pattern would miss fails the build loudly instead of shipping.
 */
import { describe, expect, it } from "vitest";

import { transformRemToPx as transform } from "../scripts/rem-to-px.mjs";

describe("transformRemToPx", () => {
  it("converts the stylesheet's real shapes against a 16px root", () => {
    expect(transform(".x{font-size:0.8125rem}")).toBe(".x{font-size:13px}");
    expect(transform(".x{margin:.5rem 1rem}")).toBe(".x{margin:8px 16px}");
    expect(transform(".x{top:-0.25rem}")).toBe(".x{top:-4px}");
    expect(transform(".x{width:calc(100% - 2rem)}")).toBe(
      ".x{width:calc(100% - 32px)}",
    );
    expect(transform("var(--tf-radius,0.5rem)")).toBe("var(--tf-radius,8px)");
    expect(transform("@media (min-width:48rem){.x{gap:1.5rem}}")).toBe(
      "@media (min-width:768px){.x{gap:24px}}",
    );
  });

  it("converts declarations but never the escaped class selector naming them", () => {
    // The arbitrary-value class name is what the component's className
    // carries verbatim — rewriting the selector would unhook the rule.
    expect(
      transform(
        String.raw`.h-\[calc\(100dvh-2rem\)\]{height:calc(100dvh - 2rem)}`,
      ),
    ).toBe(String.raw`.h-\[calc\(100dvh-2rem\)\]{height:calc(100dvh - 32px)}`);
    expect(
      transform(String.raw`.p-\[calc\(0\.5rem_\+_1px\)\]{padding:9px}`),
    ).toBe(String.raw`.p-\[calc\(0\.5rem_\+_1px\)\]{padding:9px}`);
  });

  it("leaves rem-shaped identifiers alone", () => {
    expect(transform("@media (prefers-reduced-motion:reduce){.x{top:0}}")).toBe(
      "@media (prefers-reduced-motion:reduce){.x{top:0}}",
    );
    expect(transform(".x{--lorem:1px;transition:transform 1s}")).toBe(
      ".x{--lorem:1px;transition:transform 1s}",
    );
  });

  it("throws instead of shipping a rem value it could not convert", () => {
    // A shape the value pattern deliberately skips (identifier-adjacent
    // digits) but the tripwire still sees.
    expect(() => transform(".x{padding:x2rem}")).toThrow(
      /left a rem value behind/,
    );
  });

  it("honors an explicit root font size", () => {
    expect(transform(".x{font-size:2rem}", 10)).toBe(".x{font-size:20px}");
  });

  it("converts the actual built stylesheet with no survivors", async () => {
    // The parity check against the real artifact when it exists (built
    // trees only — CI runs tests before `npm run build`).
    const { readFile } = await import("node:fs/promises");
    const cssText = await readFile(
      new URL("../dist/styles.css", import.meta.url),
      "utf8",
    ).catch(() => null);
    if (cssText === null) {
      return;
    }
    const transformed = transform(cssText);
    // The tripwire's own definition of a survivor, escaped-selector
    // shapes excepted (see scripts/rem-to-px.mjs).
    expect(transformed).not.toMatch(/\drem(?![\w\\_-])/);
    expect(transformed).toContain("px");
  });
});
