// The liquid-glass material's structural pins (the visual spec, the
// Portal Lift Rule's third carved exception): the laws that keep the
// glass rendering are invisible in a review diff — a missing -webkit-
// twin, a lost fallback baseline, or an opacity crept back into a glass
// surface's transition all fail silently in Chromium on a fast machine.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../src/styles/styles.css", import.meta.url),
  "utf8",
);

// The declaration checks below must not trip on prose: the stylesheet's
// comments explain the very laws being pinned, in the words the pins
// search for.
const declarations = styles.replace(/\/\*[\s\S]*?\*\//g, "");

// A rule that hangs on a data attribute is only half the law; the other
// half is the component that still emits it.
function sourceOf(component: string): string {
  return readFileSync(
    new URL(`../src/components/${component}`, import.meta.url),
    "utf8",
  );
}

describe("the liquid-glass material", () => {
  it("pairs every backdrop-filter with its -webkit- twin", () => {
    const standard = styles.match(/^\s*backdrop-filter:/gm) ?? [];
    const webkit = styles.match(/^\s*-webkit-backdrop-filter:/gm) ?? [];
    expect(standard.length).toBeGreaterThan(0);
    expect(webkit.length).toBe(standard.length);
  });

  it("gates the glass on backdrop-filter AND color-mix together", () => {
    // A coat built on an unsupported color-mix fails at computed-value
    // time and leaves no background at all — the opaque baseline must
    // survive wherever either feature is missing.
    expect(styles).toMatch(
      /@supports \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)\s+and\s+\(background: color-mix\(in srgb, red 50%, transparent\)\)/,
    );
  });

  it("keeps an opaque baseline on the glass surfaces outside the gate", () => {
    const gateAt = styles.indexOf("@supports");
    const baseline = styles.slice(0, gateAt);
    expect(baseline).toMatch(
      /\[data-tf-assistant\]\[data-tf-glass\],\s*\[data-tf-assistant\] \[data-tf-glass\] \{\s*background: var\(--_tf-background\);/,
    );
  });

  it("reads only resolved aliases, never the public token names", () => {
    // Glass values derive from --_tf-* so hosts that bridge dark tokens
    // without data-tf-theme (the dashboard) still get dark glass — and
    // so the material never widens the 21-token public contract.
    const sectionStart = styles.indexOf("The liquid-glass material");
    const sectionEnd = styles.indexOf("The widget's own base");
    const section = styles.slice(sectionStart, sectionEnd);
    expect(sectionStart).toBeGreaterThan(-1);
    expect(section).not.toMatch(/var\(\s*--tf-/);
  });

  it("never lets a glass surface's transition carry opacity", () => {
    // Glass moves, it never dissolves: a fractional-opacity glass
    // surface composites the sharp host page through its own blurred
    // copy. The docked sidebar is the one panel variant allowed a fade —
    // it is opaque page furniture, not glass.
    const panelRule = /\[data-tf-floating-panel\] \{[^}]*\}/.exec(
      declarations,
    )?.[0];
    expect(panelRule).toBeDefined();
    expect(panelRule).not.toContain("opacity");
  });

  it("defocuses the conversation behind a dropped-open menu, and by blur", () => {
    // The menu's own glass cannot do this reading: an element carrying
    // backdrop-filter is a backdrop root, so its blur samples the page
    // under the panel and never the transcript painted inside it — the
    // coat tints that text without softening it at any radius. Blurring
    // the conversation itself is the fix, and it must stay a filter: an
    // ancestor at fractional opacity is a backdrop root of its own and
    // would show the sharp host page through the panel's blurred copy.
    const defocus =
      /\[data-tf-floating-panel\]:has\(> \[data-tf-disclosure\]\) \[data-tf-conversation\] \{[^}]*\}/.exec(
        declarations,
      )?.[0];
    expect(defocus).toBeDefined();
    expect(defocus).toMatch(/filter: blur\(/);
    expect(defocus).not.toContain("opacity");
    // Both hooks the selector hangs on: a renamed attribute leaves the
    // rule matching nothing, and nothing about that is visible in a diff.
    expect(sourceOf("companion-header-disclosure.tsx")).toContain(
      "data-tf-disclosure",
    );
    expect(sourceOf("conversation-view.tsx")).toContain("data-tf-conversation");
  });

  it("defocuses the conversation around an open subagent roster", () => {
    const defocus =
      /\[data-tf-conversation\]:has\(\[data-tf-subagent-disclosure\]\)[^{]*\{[^}]*\}/.exec(
        declarations,
      )?.[0];
    expect(defocus).toBeDefined();
    expect(defocus).toMatch(/:not\(\[data-tf-subagent-pill\]\)/);
    // The shelf+composer anchor escapes the sibling blur so its
    // zero-flow activity overlay stays crisp; the anchor's in-flow
    // children (the shelf's decision tenants, the composer) and any
    // non-pill activity tenant recede like the transcript — each
    // exactly once, never a composed double blur (round-3 review: the
    // old shelf-item selector stacked blur(8px) on the ancestor's).
    expect(defocus).toMatch(/:not\(\[data-tf-composer-anchor\]\)/);
    expect(defocus).toMatch(
      /\[data-tf-composer-anchor\][\s\S]*:not\(\[data-tf-activity-slot\]\)/,
    );
    expect(defocus).not.toMatch(
      /\[data-tf-activity-shelf\][\s\S]*\[data-tf-shelf-item\]/,
    );
    expect(defocus).toMatch(
      /\[data-tf-shelf-item\]:not\(\[data-tf-subagent-pill\]\)/,
    );
    expect(defocus).toMatch(/filter: blur\(/);
    expect(defocus).toContain("pointer-events: none");
    expect(sourceOf("subagent-count-pill.tsx")).toContain(
      "data-tf-subagent-disclosure",
    );
    expect(sourceOf("subagent-count-pill.tsx")).toContain(
      "data-tf-subagent-pill",
    );
    expect(sourceOf("subagent-count-pill.tsx")).toContain("data-tf-shelf-item");
    expect(sourceOf("activity-shelf.tsx")).toContain("data-tf-activity-shelf");
    expect(sourceOf("conversation-view.tsx")).toContain(
      "data-tf-conversation-body",
    );
  });

  it("strips the portal costume off a menu that opens inside a panel", () => {
    // Specular edge and deep lift are what a surface wears because it
    // floats over the HOST's pixels. A header menu floats over ours, and
    // in that costume it reads as a second, shinier surface parked on
    // the first — the complaint the quiet register answers. It keeps the
    // coat (same tint as its host) and takes a short shadow instead.
    const menuRule =
      /\[data-tf-assistant\] \[data-tf-disclosure\] \{[^}]*\}/.exec(
        declarations,
      )?.[0];
    expect(menuRule).toBeDefined();
    expect(menuRule).toMatch(/box-shadow: 0 8px 24px/);
    expect(menuRule).not.toContain("inset");
    // Declared outside the glass gate, so the docked pane's menus — the
    // same object on an opaque surface — are covered by the same rule.
    expect(
      styles.indexOf("[data-tf-assistant] [data-tf-disclosure]"),
    ).toBeGreaterThan(
      styles.indexOf("[data-tf-glass] [data-tf-composer-ground]"),
    );
  });
});

describe("the subagent pill's chip-scale lift", () => {
  const CHIP_SELECTOR =
    "[data-tf-assistant] [data-tf-subagent-pill] > [data-tf-glass]";

  it("corrects the baseline half: the short ladder outside the gate", () => {
    const gateAt = declarations.indexOf("@supports");
    const baseline = declarations.slice(0, gateAt);
    const rule = baseline.slice(baseline.indexOf(CHIP_SELECTOR)).split("}")[0];
    expect(baseline).toContain(CHIP_SELECTOR);
    expect(rule.replace(/\s+/g, " ")).toContain(
      "box-shadow: 0px 1px 1px rgba(0, 0, 0, 0.1), 0px 2px 8px rgba(0, 0, 0, 0.1)",
    );
    // ONLY the shadow: the opaque baseline background stays the generic
    // rule's, so the correction can never fork the material.
    expect(rule).not.toContain("background");
  });

  it("corrects the gated half: specular edge kept, the portal lift traded for a chip's", () => {
    const gateAt = declarations.indexOf("@supports");
    const gated = declarations.slice(gateAt);
    const rule = gated.slice(gated.indexOf(CHIP_SELECTOR)).split("}")[0];
    expect(gated).toContain(CHIP_SELECTOR);
    expect(rule.replace(/\s+/g, " ")).toContain(
      "box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.3), 0 8px 24px rgb(0 0 0 / 0.12)",
    );
    // Coat, blur and the gate's --_tf-muted stay from the generic rule.
    expect(rule).not.toContain("backdrop-filter");
    expect(rule).not.toContain("--_tf-muted");
  });

  it("scopes the correction to the trigger chip alone — the roster card keeps the portal lift by structure", () => {
    // The child combinator is the scope: the trigger TfButton is a
    // DIRECT child of the pill wrapper, while the roster card sits a
    // level deeper (inside the disclosure positioner) and must keep the
    // full portal costume.
    const pill = sourceOf("subagent-count-pill.tsx");
    expect(declarations).toContain("[data-tf-subagent-pill] > [data-tf-glass]");
    // The wrapper still emits the hook, and the trigger is its direct
    // glass child.
    expect(pill).toContain("data-tf-subagent-pill=");
    expect(pill).toContain("data-tf-glass=");
  });
});
