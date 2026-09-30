// The theme prop's mapping law (camelCase key -> --tf-* declaration,
// dark values -> the private --_tf-dark-* mechanism variables) and the
// parity pins that keep this module and the stylesheet describing the
// same 21-token contract.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../src/styles/styles.css", import.meta.url),
  "utf8",
);

import {
  DARK_THEME_TOKEN_KEYS,
  THEME_TOKEN_KEYS,
  themeToStyleVars,
  type AssistantTheme,
  type AssistantThemeDarkTokens,
  type AssistantThemeTokens,
} from "../src/appearance/theme";

describe("themeToStyleVars", () => {
  it("maps camelCase keys to the public kebab-case tokens", () => {
    expect(
      themeToStyleVars({ background: "#fff", primaryForeground: "#0a0a0a" }),
    ).toEqual({
      "--tf-background": "#fff",
      "--tf-primary-foreground": "#0a0a0a",
    });
  });

  it("treats a bare radius number as pixels and keeps strings verbatim", () => {
    expect(themeToStyleVars({ radius: 12 })).toEqual({ "--tf-radius": "12px" });
    expect(themeToStyleVars({ radius: "0.25rem" })).toEqual({
      "--tf-radius": "0.25rem",
    });
  });

  it("maps dark values to the private --_tf-dark-* variables", () => {
    expect(
      themeToStyleVars({
        background: "#fff",
        dark: { background: "#111", mutedForeground: "#a0a0a0" },
      }),
    ).toEqual({
      "--tf-background": "#fff",
      "--_tf-dark-background": "#111",
      "--_tf-dark-muted-foreground": "#a0a0a0",
    });
  });

  it("skips undefined values and maps an empty theme to nothing", () => {
    expect(themeToStyleVars({})).toEqual({});
    expect(themeToStyleVars({ background: undefined, dark: {} })).toEqual({});
  });
});

describe("parity with styles.css", () => {
  // The variable names the mapping emits for a fully-set theme — derived
  // from the mapping itself so the pin cannot drift from the code.
  const baseValues: AssistantThemeTokens = {};
  for (const key of THEME_TOKEN_KEYS) {
    baseValues[key] = "x";
  }
  const darkValues: AssistantThemeDarkTokens = {};
  for (const key of DARK_THEME_TOKEN_KEYS) {
    darkValues[key] = "x";
  }
  const fullTheme: AssistantTheme = { ...baseValues, dark: darkValues };
  const emitted = Object.keys(themeToStyleVars(fullTheme));
  const emittedPublic = emitted.filter((name) => name.startsWith("--tf-"));
  const emittedDark = emitted.filter((name) => name.startsWith("--_tf-dark-"));

  it("names exactly the public tokens the alias layer reads", () => {
    const aliased = new Set(
      [...styles.matchAll(/var\(\s*(--tf-[a-z-]+)\s*[,)]/g)].map(
        (match) => match[1],
      ),
    );
    expect(new Set(emittedPublic)).toEqual(aliased);
    expect(emittedPublic).toHaveLength(THEME_TOKEN_KEYS.length);
  });

  it("names exactly the dark variables the dark blocks read first", () => {
    const darkRead = new Set(
      [...styles.matchAll(/var\(\s*(--_tf-dark-[a-z-]+)\s*,/g)].map(
        (match) => match[1],
      ),
    );
    expect(new Set(emittedDark)).toEqual(darkRead);
    expect(emittedDark).toHaveLength(DARK_THEME_TOKEN_KEYS.length);
  });

  it("keeps every dark read chained to the public token before its default", () => {
    for (const name of emittedDark) {
      const publicName = name.replace("--_tf-dark-", "--tf-");
      expect(styles).toMatch(
        new RegExp(`var\\(\\s*${name},\\s*var\\(\\s*${publicName},`),
      );
    }
  });

  it("carries the mode blocks the provider's data-tf-theme values select", () => {
    expect(styles).toContain('[data-tf-assistant][data-tf-theme="dark"]');
    expect(styles).toContain('[data-tf-assistant][data-tf-theme="light"]');
    expect(styles).toContain('[data-tf-assistant][data-tf-theme="auto"]');
    expect(styles).toMatch(
      /@media \(prefers-color-scheme: dark\) \{\s*\[data-tf-assistant\]\[data-tf-theme="auto"\]/,
    );
  });

  // Dark flips colors, never geometry or the typeface — if the CSS dark
  // block ever grows one of these, the types must grow with it.
  it("keeps radius, fontSans, and colorScheme out of the dark token set", () => {
    expect(DARK_THEME_TOKEN_KEYS).not.toContain("radius");
    expect(DARK_THEME_TOKEN_KEYS).not.toContain("fontSans");
    // colorScheme is mode-independent by construction: the stylesheet's
    // dark blocks read no --_tf-dark-color-scheme (they already default
    // the scheme to dark), so a dark-set entry would be an inert var.
    expect(DARK_THEME_TOKEN_KEYS).not.toContain("colorScheme");
    expect(DARK_THEME_TOKEN_KEYS).toHaveLength(THEME_TOKEN_KEYS.length - 3);
  });
});
