// The lazy chunk behind markdown/highlight.ts — nothing outside that
// boundary may import this module (the bundle-weight tripwire enforces
// it). Fine-grained shiki/core with the JavaScript regex engine: no
// oniguruma wasm, and only the grammar set below — a fenced block in any
// other language keeps its plain <pre>. This module ships NO CSS (the
// esbuild-hoists-lazy-CSS trap): tokens carry `--shiki-*` variables that
// styles.css maps onto the Graphite ink ladder for both modes.

import {
  createCssVariablesTheme,
  createHighlighterCore,
  type HighlighterCore,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

const GRAMMARS = [
  import("@shikijs/langs/typescript"),
  import("@shikijs/langs/tsx"),
  import("@shikijs/langs/javascript"),
  import("@shikijs/langs/jsx"),
  import("@shikijs/langs/json"),
  import("@shikijs/langs/bash"),
  import("@shikijs/langs/python"),
  import("@shikijs/langs/html"),
  import("@shikijs/langs/css"),
  import("@shikijs/langs/yaml"),
  import("@shikijs/langs/markdown"),
  import("@shikijs/langs/sql"),
];

// Aliases shiki resolves itself (ts→typescript, sh→shellscript…) ride
// the grammar registrations; this set is what `loadedLanguages` reports.
const THEME = createCssVariablesTheme({
  name: "tf-css-variables",
  variablePrefix: "--shiki-",
  variableDefaults: {},
  fontStyle: true,
});

let highlighter: Promise<HighlighterCore> | null = null;

function loadedHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [THEME],
    langs: GRAMMARS,
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return highlighter;
}

export async function highlightWithShiki(
  code: string,
  language: string,
): Promise<string | null> {
  const core = await loadedHighlighter();
  const resolved = language.toLowerCase();
  if (!core.getLoadedLanguages().includes(resolved)) {
    return null;
  }
  return core.codeToHtml(code, { lang: resolved, theme: "tf-css-variables" });
}
