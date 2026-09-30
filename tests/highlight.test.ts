import { describe, expect, it } from "vitest";

import { highlightToHtml } from "../src/components/markdown/highlight";

// The engine/grammar handshake, pinned. highlightToHtml swallows every
// failure by design (a broken chunk must degrade to the plain <pre>,
// never an error surface) — which means a version mismatch between
// shiki's core and the directly-imported @shikijs/langs grammars would
// fail QUIETLY: every block plain, and a screenshot baseline regenerated
// in that state would happily pin the unhighlighted render. This test is
// the loud check the swallowing forbids elsewhere.

describe("the shiki lazy boundary", () => {
  it("actually highlights a known language — the quiet-degrade guard", async () => {
    const html = await highlightToHtml("const steep = 1;", "ts");

    expect(html).not.toBeNull();
    // Tokenized output, not a passthrough: the keyword rides its own
    // ink-carrying span.
    expect(html).toContain("<span");
    expect(html).toContain("--shiki-");
  });

  it("returns null for a language outside the grammar set", async () => {
    expect(await highlightToHtml("PROC SORT DATA=x;", "sas")).toBeNull();
  });
});
