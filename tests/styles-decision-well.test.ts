// The decision scroll well's stylesheet contract: the well's bound and
// fold cue live in styles.css so constrained and glass hosts stay
// correct, and this pin keeps the host values from silently vanishing
// or losing their panel-relative dvh terms (round 4: a bare rem is
// correct only at tall viewports). Honest scope, stated: these are
// TEXTUAL pins — the geometry itself is exercised by TVC-067, which
// since round 4 probes BOTH constrained hosts (real hooks, real height
// formulas) at tall AND short viewports. The full evidence ledger per
// host is the decision-surface coverage record's host-compliance
// table.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const STYLES = readFileSync(
  path.resolve(import.meta.dirname, "../src/styles/styles.css"),
  "utf8",
);

describe("the decision scroll well's stylesheet rules", () => {
  it("bounds the well through the host-sizable custom property, with the viewport-tied default", () => {
    expect(STYLES).toMatch(
      /\[data-tf-decision-scroll-well\]\s*\{\s*max-height:\s*var\(\s*--_tf-suspension-well-max-height,\s*min\(45dvh,\s*36rem\)\s*\);/,
    );
  });

  it("pins the generic approval banner to the well's budget; a pathological prompt scrolls the banner as a whole", () => {
    const cardRule =
      /\[data-tf-approval-card\]\s*\{[^}]*\}/.exec(STYLES)?.[0] ?? "";
    // The same custom property the well reads: a height-capped host
    // squeezes the banner with the well instead of a literal 36rem
    // laying out inside a 20rem well.
    expect(cardRule.replace(/\s+/g, " ")).toContain(
      "max-height: calc( var(--_tf-suspension-well-max-height, min(45dvh, 36rem)) - 1rem )",
    );
    // Never `overflow: hidden`: a long consent prompt on a short
    // viewport would clip the Approve/Deny row out of reach — the
    // banner scrolls as a whole instead. No flex machinery: the banner
    // has no shrinkable middle (the banner renders no argument
    // summary).
    expect(cardRule).toContain("overflow-y: auto");
    expect(cardRule).not.toContain("display: flex");
    expect(STYLES).not.toContain("[data-tf-approval-prompt]");
  });

  it("pins the question panel to the well's budget: its answer list scrolls first, and the panel as a whole is the fallback", () => {
    const panelRule =
      /\[data-tf-question-panel\]\s*\{[^}]*\}/.exec(STYLES)?.[0] ?? "";
    expect(panelRule).toContain("display: flex");
    expect(panelRule.replace(/\s+/g, " ")).toContain(
      "max-height: calc( var(--_tf-suspension-well-max-height, min(45dvh, 36rem)) - 1rem )",
    );
    // The approval frame's rule, mirrored (round-4 finding 1): the panel
    // is never `overflow: hidden` and never overflow-visible — once the
    // answer list has shrunk to nothing on a short host, the whole panel
    // scrolls so the Cancel/Submit footer stays reachable instead of
    // laying out past the panel's edge.
    expect(panelRule).toContain("overflow-y: auto");
    expect(panelRule).not.toContain("overflow: hidden");
    const answersRule =
      /\[data-tf-question-panel\]\s*\[data-tf-question-answers\]\s*\{[^}]*\}/.exec(
        STYLES,
      )?.[0] ?? "";
    // The list's floor (round 4): never 0 — a zero-height list is
    // unreachable under the panel's own fallback scroll — and following
    // the content (round-4 verification): one row bare, two rows once the
    // question carries suggestions.
    expect(answersRule).toContain("min-height: 2.75rem");
    expect(answersRule).not.toContain("min-height: 0");
    expect(answersRule).toContain("overflow-y: auto");
    const withOptionsRule =
      /\[data-tf-question-panel\]\s*\[data-tf-question-answers\]\[data-tf-has-options\]\s*\{[^}]*\}/.exec(
        STYLES,
      )?.[0] ?? "";
    expect(withOptionsRule).toContain("min-height: 6rem");
  });

  it("sizes the well under the palette's panel — WITH the dvh term (round-4: the panel tracks the viewport below its 36rem cap)", () => {
    expect(STYLES).toMatch(
      /\[data-tf-assistant-palette\]\s*\{\s*--_tf-suspension-well-max-height:\s*min\(20rem,\s*100dvh\s*-\s*25rem\);/,
    );
  });

  it("sizes the well under the floating companion card — WITH its panel-relative dvh term", () => {
    expect(STYLES).toMatch(
      /\[data-tf-panel-dock="floating"\]\s*\{\s*--_tf-suspension-well-max-height:\s*min\(26rem,\s*68dvh\s*-\s*13rem\);/,
    );
  });

  it("declares the fold as a mask on the well — never a painted band that would re-opaque a glass host", () => {
    const rule =
      /\[data-tf-decision-scroll-well\]\[data-tf-fold-below\]\s*\{[^}]*\}/.exec(
        STYLES,
      );
    expect(rule).not.toBeNull();
    expect(rule?.[0]).toContain("mask-image");
    expect(rule?.[0]).toContain("linear-gradient");
    expect(rule?.[0]).not.toContain("background");
  });
});
