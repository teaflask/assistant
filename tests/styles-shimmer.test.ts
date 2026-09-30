// The shimmer band's per-mode peak: the band must move AWAY from the page,
// which is a different direction per mode — light lifts toward the page,
// dark toward its own foreground. These are TEXTUAL pins over styles.css
// (the glass-material test's idiom): the per-mode declarations sit beside
// --_tf-emphasis-mix in exactly its four blocks, the one band rule reads
// the variable, and both reduced-motion collapses stay whole (their
// structural placement — first rule inside the media block — is TVC-100's
// own pin).

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const STYLES = readFileSync(
  path.resolve(import.meta.dirname, "../src/styles/styles.css"),
  "utf8",
);

/** The declared values of one custom property, in source order, with
 *  every space dropped — prettier wraps color-mix() across four lines. */
function declaredValues(name: string): string[] {
  return [
    ...STYLES.matchAll(new RegExp("\\" + name + ":\\s*([^;]+);", "g")),
  ].map((match) => match[1].replace(/\s+/g, ""));
}

/** The peak the mode blocks spell: a mix of the muted ink toward the
 *  token that mode's band travels to, never a literal colour. */
function aMixOfTheMutedInkToward(target: string, percent: string): string {
  return `color-mix(inoklab,var(--_tf-muted-foreground)${percent},var(${target}))`;
}

const LIGHT_PEAK = aMixOfTheMutedInkToward("--_tf-background", "65%");
const DARK_PEAK = aMixOfTheMutedInkToward("--_tf-foreground", "20%");
const DARK_HOVER_PEAK = aMixOfTheMutedInkToward("--_tf-background", "80%");

describe("the shimmer band's per-mode peak", () => {
  it("declares the peak in exactly the four mode blocks, beside --_tf-emphasis-mix — light lifts toward the page, dark toward its foreground", () => {
    // Source order mirrors the emphasis-mix blocks: base (light), dark,
    // light/auto pin-back, prefers-dark auto. The fifth and last is the
    // summary:hover swap below, not a mode block.
    const declared = declaredValues("--_tf-shimmer-peak");
    expect(declared).toHaveLength(5);
    expect(declared.slice(0, 4)).toEqual([
      LIGHT_PEAK,
      DARK_PEAK,
      LIGHT_PEAK,
      DARK_PEAK,
    ]);
    // Beside the emphasis mix, not scattered: each block that declares
    // one declares the other.
    const mixCount = [...STYLES.matchAll(/--_tf-emphasis-mix:\s*\d+%/g)].length;
    expect(mixCount).toBe(4);
  });

  it("declares the HOVER peak in the same four blocks — dark reverses, light reuses its resting peak — and one summary:hover rule swaps to it", () => {
    expect(declaredValues("--_tf-shimmer-peak-hover")).toEqual([
      "var(--_tf-shimmer-peak)",
      DARK_HOVER_PEAK,
      "var(--_tf-shimmer-peak)",
      DARK_HOVER_PEAK,
    ]);
    expect(STYLES).toMatch(
      /\[data-tf-assistant\] summary:hover \{\s*--_tf-shimmer-peak: var\(--_tf-shimmer-peak-hover\);\s*\}/,
    );
  });

  it("the band is one gradient reading the variable — no second colour path, and no literal ink", () => {
    const band = /\[data-tf-shimmer-highlight\]\s*\{[^}]*\}/.exec(STYLES)?.[0];
    expect(band).toBeDefined();
    expect(band?.replace(/\s+/g, " ")).toContain(
      "transparent 25%, var(--_tf-shimmer-peak) 45% 55%, transparent 75%",
    );
    // The literal `white` and the relative-colour @supports fork are both
    // gone: a host that re-themes the ink must re-theme the band, and
    // color-mix() ships wider than `oklch(from …)` does, so the fork
    // bought nothing. Only one rule may paint this band.
    expect(STYLES).not.toContain("oklch(from");
    expect([
      ...STYLES.matchAll(/\[data-tf-shimmer-highlight\]\s*\{[^}]*\}/g),
    ]).toHaveLength(3); // the band, and the two reduced-motion collapses
  });

  it("both reduced-motion switches still collapse the band whole", () => {
    expect(STYLES).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\[data-tf-shimmer-highlight\] \{\s*animation: none;\s*background-image: none;/,
    );
    expect(STYLES).toMatch(
      /\[data-reduce-motion="true"\] \[data-tf-shimmer-highlight\] \{\s*animation: none;\s*background-image: none;/,
    );
  });
});
