// The UA-scheme half of the theming contract: native form controls (the
// composer textarea, scrollbars) draw their indicators from
// `color-scheme`, and the contract promises a host can dark-theme the
// widget with tokens alone — no mode prop, no ancestor attribute. A
// pinned `color-scheme: light` on the base rule quietly voided that
// promise once (a token-only dark host rendered invisible near-black
// control chrome); these pins keep every declaration routed through the
// host-settable token.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../src/styles/styles.css", import.meta.url),
  "utf8",
);

// Comments explain the very law being pinned, in the words the pins
// search for — strip them before matching declarations.
const declarations = styles.replace(/\/\*[\s\S]*?\*\//g, "");

describe("the color-scheme token path", () => {
  it("every color-scheme declaration routes through --tf-color-scheme", () => {
    // Anchored to a declaration start: an unanchored /color-scheme:/
    // also matches `prefers-color-scheme:` in the auto media query and
    // swallows that arm's real declaration into one merged match — the
    // count then passes for the wrong reason (review round 3).
    const all = declarations.match(/(?<![\w-])color-scheme:[^;]*;/g) ?? [];
    // Base + explicit dark + explicit light/auto + the auto media-dark
    // arm: four homes, same as the token blocks they ride.
    expect(all.length).toBe(4);
    for (const declaration of all) {
      // One property, one line — a match spanning lines means the regex
      // swallowed something that isn't this declaration.
      expect(declaration).not.toContain("\n");
      expect(declaration).toContain("var(--tf-color-scheme,");
    }
  });

  it("defaults light on the base rule and dark only under the dark blocks", () => {
    // The default-light widget inside a dark host page must not inherit
    // the page's dark scheme; the explicit dark theme (attribute or the
    // auto media arm) flips the default; the host token wins everywhere.
    const light = declarations.match(
      /color-scheme: var\(--tf-color-scheme, light\);/g,
    );
    const dark = declarations.match(
      /color-scheme: var\(--tf-color-scheme, dark\);/g,
    );
    expect(light).toHaveLength(2);
    expect(dark).toHaveLength(2);
  });
});
