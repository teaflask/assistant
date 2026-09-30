import { describe, expect, it } from "vitest";
import { activityTitleOf } from "../src/core/activity-title";

describe("activity titles from dispatch excerpts", () => {
  it("shows a short label whole", () => {
    expect(activityTitleOf("Audit the billing exports.")).toBe(
      "Audit the billing exports.",
    );
  });

  it("clips a long label to a 64-character prefix with an ellipsis", () => {
    const label = activityTitleOf("n".repeat(200));
    expect(label).toBe(`${"n".repeat(63)}…`);
    expect(label).toHaveLength(64);
  });

  it("collapses whitespace and never leaves a space before the ellipsis", () => {
    expect(activityTitleOf("  Audit\n\nthe   exports.  ")).toBe(
      "Audit the exports.",
    );
    const words = `${"word ".repeat(12)}and more`;
    const clipped = activityTitleOf(words);
    expect(clipped.endsWith("…")).toBe(true);
    expect(clipped).not.toMatch(/\s…$/);
  });
});
