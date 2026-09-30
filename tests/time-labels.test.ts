import { describe, expect, it } from "vitest";

import {
  conversationalTimeOf,
  startOfLocalDayMs,
} from "../src/core/time-labels";

// The recency rule is the thread list's calendar-day rule, but the
// weekday LABEL window is one day tighter (round-3 review): seven
// distinct calendar days, D-6 … D0, because weekday names stay unique
// only that long. Honest on unparseable and future stamps. These cases
// inject `now` so the boundary is exercised exactly; the
// container-facing determinism is the e2e clock pin (helpers/geometry.ts).

const NOW = Date.parse("2026-09-08T12:00:00");

describe("conversationalTimeOf — the recency window", () => {
  it("keeps the ticket's reference form inside the window", () => {
    const label = conversationalTimeOf("2026-09-07T19:19:00", NOW)?.label;
    expect(label).toMatch(/^[A-Z][a-z]+day\s/);
    expect(label).toContain("7:19");
  });

  it("switches to the dated form outside the window — a weekday three weeks later would read as this past week", () => {
    const label = conversationalTimeOf("2026-08-18T19:19:00", NOW)?.label;
    expect(label).not.toMatch(/^[A-Z][a-z]+day\s/);
    expect(label).toMatch(/^[A-Z][a-z]{2} \d{1,2}/);
    expect(label).toContain("7:19");
    // Same year as now: no year token.
    expect(label).not.toContain("2026");
  });

  it("adds the year across a year boundary", () => {
    const label = conversationalTimeOf("2025-09-07T19:19:00", NOW)?.label;
    expect(label).toContain("2025");
    expect(label).toContain("7:19");
  });

  it("bounds by CALENDAR day, not elapsed hours — the thread list's own rule, one day tighter for the label", () => {
    // The weekday LABEL window is the register's own cap — six days
    // back, seven unique weekday names (round-3 review; the final
    // review made the cap independent of the bucket constant, so this
    // test states it as the literal invariant too). D-6's local
    // midnight is the boundary: an hour past that midnight is more than
    // 6×24h ago — still labeled a weekday, proving the bound is the
    // calendar day, not elapsed hours; an hour before it is dated.
    const WEEKDAY_LABEL_DAYS_BACK = 6;
    const boundary = startOfLocalDayMs(new Date(NOW), WEEKDAY_LABEL_DAYS_BACK);
    const insideMs = boundary + 60 * 60 * 1000;
    const outsideMs = boundary - 60 * 60 * 1000;
    expect(insideMs).toBeLessThan(
      NOW - WEEKDAY_LABEL_DAYS_BACK * 24 * 3600 * 1000,
    );
    expect(
      conversationalTimeOf(new Date(insideMs).toISOString(), NOW)?.label,
    ).toMatch(/^[A-Z][a-z]+day\s/);
    expect(
      conversationalTimeOf(new Date(outsideMs).toISOString(), NOW)?.label,
    ).not.toMatch(/^[A-Z][a-z]+day\s/);
  });

  it("never lets two in-window stamps share today's weekday name — exactly a week ago is DATED (round-3, all three reviewers)", () => {
    // NOW is Tuesday 2026-09-08. Exactly one week earlier is also a
    // Tuesday: under the old full-window bound both rendered
    // "Tuesday …" side by side — the precise collision the dated arm
    // exists to prevent. The label must date itself.
    const weekAgo = conversationalTimeOf("2026-09-01T19:19:00", NOW)?.label;
    expect(weekAgo).not.toMatch(/^[A-Z][a-z]+day\s/);
    expect(weekAgo).toMatch(/^[A-Z][a-z]{2} \d{1,2}/);
    // Non-vacuous: the two stamps really do share a weekday name.
    expect(new Date("2026-09-01T19:19:00").getDay()).toBe(
      new Date(NOW).getDay(),
    );
  });

  it("reads a future stamp as recent — never filed under a day it did not happen", () => {
    const label = conversationalTimeOf("2026-09-09T09:00:00", NOW)?.label;
    expect(label).toMatch(/^[A-Z][a-z]+day\s/);
  });

  it("yields null for an unparsable stamp", () => {
    expect(conversationalTimeOf("not-a-date", NOW)).toBeNull();
  });

  it("the full title always carries the complete date", () => {
    const full = conversationalTimeOf("2026-09-07T19:19:00", NOW)?.full;
    expect(full).toContain("2026");
    expect(full).toContain("7:19");
  });
});
