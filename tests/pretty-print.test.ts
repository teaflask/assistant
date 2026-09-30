import { describe, expect, it } from "vitest";

import { prettyPrintParameters } from "../src/components/pretty-print";

// The package ships no determinism edition (stablePrettyPrint): the
// approval banner renders no technical-details pane, so nothing needs
// one.
describe("prettyPrintParameters", () => {
  it("passes strings through and blanks nullish", () => {
    expect(prettyPrintParameters("already text")).toBe("already text");
    expect(prettyPrintParameters(null)).toBe("");
    expect(prettyPrintParameters(undefined)).toBe("");
  });

  it("prints records as indented JSON in arrival order", () => {
    expect(prettyPrintParameters({ b: 1, a: 2 })).toBe(
      '{\n  "b": 1,\n  "a": 2\n}',
    );
  });
});
