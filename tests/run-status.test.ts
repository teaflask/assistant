import { describe, expect, it } from "vitest";

import type { TurnStatus } from "../src/contract/threads";
import { announcedStatusOf, runReadsAsWorking } from "../src/core/run-status";

describe("announcedStatusOf — the announcer's honesty ladder", () => {
  it("maps every wire status; a pause is the member's time only when a decision pends", () => {
    const expected: Record<TurnStatus, "working" | "waiting" | null> = {
      queued: "working",
      working: "working",
      awaiting_input: "waiting",
      parked: "waiting",
      succeeded: null,
      failed: null,
      superseded: null,
      stopped: null,
    };
    for (const [status, state] of Object.entries(expected)) {
      expect(announcedStatusOf(status as TurnStatus, true)).toBe(state);
    }
  });

  it("never claims waiting while no actionable decision exists — a subagent park is the machine's time", () => {
    // The status enum records lifecycle, not who the run waits on: a
    // subagent park ships the same "parked" as a HITL pause, with zero
    // pending decisions. Announcing "Waiting for your input" there
    // would be a lie.
    for (const status of ["awaiting_input", "parked"] as const) {
      expect(announcedStatusOf(status, false)).toBe("working");
      expect(announcedStatusOf(status, true)).toBe("waiting");
    }
  });

  it("maps terminal statuses and no turn to null — status disappears at settle", () => {
    for (const status of [
      "succeeded",
      "failed",
      "superseded",
      "stopped",
    ] as const) {
      expect(announcedStatusOf(status, true)).toBeNull();
      expect(announcedStatusOf(status, false)).toBeNull();
    }
    expect(announcedStatusOf(null, true)).toBeNull();
  });
});

describe("runReadsAsWorking — the visible liveness register", () => {
  const STATUSES: readonly TurnStatus[] = [
    "queued",
    "working",
    "awaiting_input",
    "parked",
    "succeeded",
    "failed",
    "superseded",
    "stopped",
  ];

  it("is the machine's time: queued/working regardless, a pause only without a live decision, terminals never", () => {
    for (const decisionsPending of [false, true]) {
      expect(runReadsAsWorking("queued", decisionsPending)).toBe(true);
      expect(runReadsAsWorking("working", decisionsPending)).toBe(true);
      expect(runReadsAsWorking("awaiting_input", decisionsPending)).toBe(
        !decisionsPending,
      );
      expect(runReadsAsWorking("parked", decisionsPending)).toBe(
        !decisionsPending,
      );
      for (const status of [
        "succeeded",
        "failed",
        "superseded",
        "stopped",
      ] as const) {
        expect(runReadsAsWorking(status, decisionsPending)).toBe(false);
      }
      expect(runReadsAsWorking(null, decisionsPending)).toBe(false);
    }
  });

  it("never disagrees with the announcer's register — one function, two carriers", () => {
    for (const status of [...STATUSES, null]) {
      for (const decisionsPending of [false, true]) {
        expect(runReadsAsWorking(status, decisionsPending)).toBe(
          announcedStatusOf(status, decisionsPending) === "working",
        );
      }
    }
  });
});
