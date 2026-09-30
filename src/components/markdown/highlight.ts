// The shiki LAZY BOUNDARY: the only door to the highlighter. Code blocks
// render as plain <pre><code> immediately and upgrade to highlighted
// HTML when (and only when) this dynamic import lands — the grammars and
// engine never ride the first expand (tests/bundle-weight.test.ts pins
// that). Module-level cache: one in-flight import serves every block.

let highlighterModule: Promise<
  typeof import("./shiki-highlighter.js") | null
> | null = null;

function loadHighlighter() {
  highlighterModule ??= import("./shiki-highlighter.js").catch(() => {
    // A chunk that fails to load (offline embed, blocked CDN path) is a
    // styling downgrade, never an error surface: the plain <pre> stands.
    highlighterModule = null;
    return null;
  });
  return highlighterModule;
}

/** Highlighted HTML for a fenced block, or null when highlighting is
 *  unavailable (unknown language, chunk failed) — the caller keeps its
 *  plain rendering. The HTML carries `--shiki-*` CSS variables, themed
 *  by styles.css in Graphite ink levels for both modes. */
export async function highlightToHtml(
  code: string,
  language: string,
): Promise<string | null> {
  const module = await loadHighlighter();
  if (module === null) {
    return null;
  }
  return module.highlightWithShiki(code, language);
}
