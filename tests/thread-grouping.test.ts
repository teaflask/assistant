import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { ServingAssistantThread } from "../src/contract/threads";
import { groupThreadsByRecency } from "../src/components/thread-list";

// Local midnight is the boundary, not a rolling 24 hours: a conversation
// from 11pm last night is "Yesterday" at 8am, and a rolling window would
// call it "Today" for another two hours.
const NOW = new Date("2026-07-26T14:00:00");

function thread(id: string, updatedAt: string): ServingAssistantThread {
  return {
    id,
    title: id,
    busy: false,
    stream_thread_id: `stream-${id}`,
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

function labelsOf(threads: ServingAssistantThread[]): string[] {
  return groupThreadsByRecency(threads, NOW).map((group) => group.label);
}

describe("groupThreadsByRecency", () => {
  it("files a stamp from earlier today under Today", () => {
    expect(labelsOf([thread("a", "2026-07-26T00:05:00")])).toEqual(["Today"]);
  });

  it("files last night under Yesterday, not Today", () => {
    expect(labelsOf([thread("a", "2026-07-25T23:30:00")])).toEqual([
      "Yesterday",
    ]);
  });

  it("separates the last week from everything older", () => {
    const groups = groupThreadsByRecency(
      [
        thread("old", "2026-06-01T09:00:00"),
        thread("recent", "2026-07-22T09:00:00"),
      ],
      NOW,
    );
    expect(groups.map((group) => group.label)).toEqual([
      "Previous 7 days",
      "Older",
    ]);
  });

  it("orders groups and their rows newest first, whatever order it got", () => {
    const groups = groupThreadsByRecency(
      [
        thread("older", "2026-05-01T09:00:00"),
        thread("today-early", "2026-07-26T08:00:00"),
        thread("week", "2026-07-21T09:00:00"),
        thread("today-late", "2026-07-26T13:00:00"),
      ],
      NOW,
    );
    expect(
      groups.map((group) => [
        group.label,
        group.threads.map((each) => each.id),
      ]),
    ).toEqual([
      ["Today", ["today-late", "today-early"]],
      ["Previous 7 days", ["week"]],
      ["Older", ["older"]],
    ]);
  });

  it("floats an unparseable stamp to Today rather than filing it wrongly", () => {
    expect(labelsOf([thread("a", "not-a-date")])).toEqual(["Today"]);
  });

  // One thread can't catch this: the headings come out in the order their
  // first thread lands, so an unparseable stamp that fails to sort takes
  // its whole group with it and Older ends up above Today.
  it("keeps the headings in order when one stamp will not parse", () => {
    expect(
      labelsOf([
        thread("old", "2026-05-01T09:00:00"),
        thread("broken", "not-a-date"),
        thread("today", "2026-07-26T09:00:00"),
      ]),
    ).toEqual(["Today", "Older"]);
  });

  it("answers no groups at all for no threads", () => {
    expect(groupThreadsByRecency([], NOW)).toEqual([]);
  });
});

// The clocks moving is the case that catches a boundary counted in hours
// pretending to be one counted in days. New York springs forward at 2am on
// 8 March 2026, so the day before "today" is 23 hours long: a boundary set
// a flat 24 hours back lands at 11pm on the 7th and drags that evening's
// conversations up into Yesterday, a day they did not happen on.
describe("across a daylight-saving transition", () => {
  // Node re-reads TZ on assignment, so stubbing it moves what "local
  // midnight" means for the duration of this block.
  beforeAll(() => {
    vi.stubEnv("TZ", "America/New_York");
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("keeps Yesterday on the calendar day the clocks moved", () => {
    const monday = new Date("2026-03-09T14:00:00");
    expect(
      groupThreadsByRecency(
        [
          thread("day-before", "2026-03-07T23:30:00"),
          thread("yesterday", "2026-03-08T09:00:00"),
        ],
        monday,
      ).map((group) => [group.label, group.threads.map((each) => each.id)]),
    ).toEqual([
      ["Yesterday", ["yesterday"]],
      ["Previous 7 days", ["day-before"]],
    ]);
  });
});
