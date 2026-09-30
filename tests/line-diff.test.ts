import { describe, expect, it } from "vitest";

import { unifiedDiffOf } from "../src/reader/line-diff";

describe("unifiedDiffOf", () => {
  it("answers an empty diff for equal texts", () => {
    expect(unifiedDiffOf("a\nb\nc", "a\nb\nc")).toBe("");
  });

  it("describes a single changed line with context", () => {
    const before = ["one", "two", "three", "four", "five"].join("\n");
    const after = ["one", "two", "THREE", "four", "five"].join("\n");
    expect(unifiedDiffOf(before, after)).toBe(
      [
        "@@ -1,5 +1,5 @@",
        " one",
        " two",
        "-three",
        "+THREE",
        " four",
        " five",
      ].join("\n"),
    );
  });

  it("limits context to three lines each side", () => {
    const before = ["a", "b", "c", "d", "X", "e", "f", "g", "h"].join("\n");
    const after = ["a", "b", "c", "d", "Y", "e", "f", "g", "h"].join("\n");
    expect(unifiedDiffOf(before, after)).toBe(
      ["@@ -2,7 +2,7 @@", " b", " c", " d", "-X", "+Y", " e", " f", " g"].join(
        "\n",
      ),
    );
  });

  it("emits separate hunks for changes far apart", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${String(i)}`);
    const changed = [...lines];
    changed[2] = "changed early";
    changed[27] = "changed late";
    const diff = unifiedDiffOf(lines.join("\n"), changed.join("\n"));
    const hunkHeaders = diff
      .split("\n")
      .filter((line) => line.startsWith("@@"));
    expect(hunkHeaders).toHaveLength(2);
    expect(diff).toContain("-line 2");
    expect(diff).toContain("+changed early");
    expect(diff).toContain("-line 27");
    expect(diff).toContain("+changed late");
  });

  it("merges nearby changes into one hunk", () => {
    const before = ["a", "b", "c", "d", "e", "f"].join("\n");
    const after = ["a", "B", "c", "d", "E", "f"].join("\n");
    const diff = unifiedDiffOf(before, after);
    const hunkHeaders = diff
      .split("\n")
      .filter((line) => line.startsWith("@@"));
    expect(hunkHeaders).toHaveLength(1);
  });

  it("handles pure insertions and pure deletions", () => {
    expect(unifiedDiffOf("a\nb", "a\nnew\nb")).toBe(
      ["@@ -1,2 +1,3 @@", " a", "+new", " b"].join("\n"),
    );
    expect(unifiedDiffOf("a\nold\nb", "a\nb")).toBe(
      ["@@ -1,3 +1,2 @@", " a", "-old", " b"].join("\n"),
    );
  });

  it("survives fully-different texts", () => {
    const diff = unifiedDiffOf("only before", "only after");
    expect(diff).toContain("-only before");
    expect(diff).toContain("+only after");
  });
});
