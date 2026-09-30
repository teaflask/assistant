// The route matcher mirrors the backend navigate fence's grammar
// (_a_prefix_covers): segment-aware, trailing slash cosmetic, all-slash
// covers everything — and the longest covering prefix wins, so "/docs"
// and "/docs/api" can both exist and the deeper page gets its own set.

import { describe, expect, it } from "vitest";

import type { ServedSuggestionsConfig } from "../src/contract/assistant-config";
import { servedSuggestionsForPath } from "../src/components/served-suggestions";

const DEFAULT_SET = [{ prompt: "Default opener", kind: "ask" as const }];

function configOf(
  routes: ServedSuggestionsConfig["routes"],
): ServedSuggestionsConfig {
  return { default: DEFAULT_SET, routes };
}

function promptsFor(
  config: ServedSuggestionsConfig,
  pathname: string,
): string[] {
  return servedSuggestionsForPath(config, pathname).map((s) => s.prompt);
}

describe("servedSuggestionsForPath", () => {
  it("answers the default set when no route covers the path", () => {
    const config = configOf([
      { path_prefix: "/docs", suggestions: [{ prompt: "Docs opener" }] },
    ]);
    expect(promptsFor(config, "/billing")).toEqual(["Default opener"]);
  });

  it("matches segment-aware: /docs covers /docs/x, never /docsy", () => {
    const config = configOf([
      { path_prefix: "/docs", suggestions: [{ prompt: "Docs opener" }] },
    ]);
    expect(promptsFor(config, "/docs")).toEqual(["Docs opener"]);
    expect(promptsFor(config, "/docs/getting-started")).toEqual([
      "Docs opener",
    ]);
    expect(promptsFor(config, "/docsy")).toEqual(["Default opener"]);
  });

  it("prefers the longest covering prefix", () => {
    const config = configOf([
      { path_prefix: "/docs", suggestions: [{ prompt: "Docs opener" }] },
      {
        path_prefix: "/docs/api",
        suggestions: [{ prompt: "API opener" }],
      },
    ]);
    expect(promptsFor(config, "/docs/api/auth")).toEqual(["API opener"]);
    expect(promptsFor(config, "/docs/guides")).toEqual(["Docs opener"]);
  });

  it("treats a trailing slash on the prefix as cosmetic", () => {
    const config = configOf([
      { path_prefix: "/docs/", suggestions: [{ prompt: "Docs opener" }] },
    ]);
    expect(promptsFor(config, "/docs")).toEqual(["Docs opener"]);
    expect(promptsFor(config, "/docs/x")).toEqual(["Docs opener"]);
  });

  it('lets "/" cover every path', () => {
    const config = configOf([
      { path_prefix: "/", suggestions: [{ prompt: "Everywhere" }] },
    ]);
    expect(promptsFor(config, "/anything/at/all")).toEqual(["Everywhere"]);
  });

  it("honors a matched route's empty set — authored suppression, no fallback", () => {
    const config = configOf([{ path_prefix: "/billing", suggestions: [] }]);
    expect(promptsFor(config, "/billing/invoices")).toEqual([]);
    expect(promptsFor(config, "/elsewhere")).toEqual(["Default opener"]);
  });

  it("survives a config with every optional key absent", () => {
    expect(servedSuggestionsForPath({}, "/anywhere")).toEqual([]);
  });

  it("carries each item's kind through to the suggestion shape", () => {
    const config = configOf([
      {
        path_prefix: "/docs",
        suggestions: [{ prompt: "Learn me", kind: "learn" }],
      },
    ]);
    expect(servedSuggestionsForPath(config, "/docs")).toEqual([
      { prompt: "Learn me", kind: "learn" },
    ]);
  });
});
