/**
 * The streaming repair closes what the stream will close anyway (fences,
 * inline code, ** strong) and holds back what cannot render sensibly yet
 * (a half-streamed table row, a fence opener being typed) — and does
 * nothing else: settled markdown must pass through byte-identical, and
 * the constructs it deliberately leaves alone stay untouched.
 */
import { describe, expect, it } from "vitest";

import { repairedStreamingMarkdown } from "../src/components/markdown/streaming-repair";

describe("settled markdown passes through", () => {
  it.each([
    ["plain prose", "Steep for three minutes."],
    ["balanced strong", "This is **bold** and *italic* text."],
    ["balanced inline code", "Run `npm test` first."],
    ["a closed fence", "Before.\n```ts\nconst a = 1;\n```\nAfter."],
    ["a complete table", "| Tea | Time |\n| --- | --- |\n| Sencha | 2 min |"],
    ["a list", "- one\n- two\n- three"],
  ])("%s", (_name, text) => {
    expect(repairedStreamingMarkdown(text)).toBe(text);
  });
});

describe("mid-stream constructs are closed", () => {
  it("closes an open code fence", () => {
    const streamed = "Here is the fix:\n```ts\nconst a =";
    expect(repairedStreamingMarkdown(streamed)).toBe(`${streamed}\n\`\`\``);
  });

  it("closes dangling inline code", () => {
    expect(repairedStreamingMarkdown("Run `npm te")).toBe("Run `npm te`");
  });

  it("closes dangling strong emphasis", () => {
    expect(repairedStreamingMarkdown("This is **importa")).toBe(
      "This is **importa**",
    );
  });

  it("ignores backticks inside a closed fence when balancing", () => {
    const text = "```\na ` stray backtick\n```\nDone.";
    expect(repairedStreamingMarkdown(text)).toBe(text);
  });
});

describe("mid-stream constructs are held back", () => {
  it("holds back a table row missing its closing pipe", () => {
    const streamed = "| Tea | Time |\n| --- | --- |\n| Sencha";
    expect(repairedStreamingMarkdown(streamed)).toBe(
      "| Tea | Time |\n| --- | --- |",
    );
  });

  it("keeps a table row that just closed", () => {
    const streamed = "| Tea | Time |\n| --- | --- |\n| Sencha | 2 min |";
    expect(repairedStreamingMarkdown(streamed)).toBe(streamed);
  });

  it("holds back a fence opener being typed", () => {
    expect(repairedStreamingMarkdown("Here is the fix:\n``")).toBe(
      "Here is the fix:",
    );
  });
});

describe("deliberate non-goals stay untouched", () => {
  it("leaves a half-typed link alone", () => {
    const streamed = "See [the docs](https://exa";
    expect(repairedStreamingMarkdown(streamed)).toBe(streamed);
  });

  it("leaves single-asterisk emphasis alone (list bullets look the same)", () => {
    const streamed = "* one\n* two";
    expect(repairedStreamingMarkdown(streamed)).toBe(streamed);
  });
});
