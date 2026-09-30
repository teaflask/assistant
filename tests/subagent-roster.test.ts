// The shared roster module's laws — the sole home of these cases: entries
// keep dispatch order, buckets are exactly running/completed/failed (the
// ledger has no cancelled), the pill copy is null-when-empty and
// live-count-first, and the settled duration speaks the house ladder
// ("<1s", never "0s").
import { describe, expect, it } from "vitest";

import {
  rosterEntriesOf,
  settledDurationLabelOf,
  subagentPillLabelOf,
  subagentRosterOf,
  type RosterSourceDispatch,
  type RosterStatusPredicates,
} from "../src/core/subagent-roster";

interface FakeDispatch extends RosterSourceDispatch {
  status: "dispatched" | "succeeded" | "failed";
}

const _PREDICATES: RosterStatusPredicates<FakeDispatch> = {
  isRunning: (dispatch) => dispatch.status === "dispatched",
  hasFailed: (dispatch) => dispatch.status === "failed",
};

function _dispatch(
  ordinal: number,
  status: FakeDispatch["status"],
  overrides: Partial<FakeDispatch> = {},
): FakeDispatch {
  return {
    ordinal,
    status,
    label: `Task ${String(ordinal)}`,
    error: status === "failed" ? "The subagent died." : null,
    child_session_id: `child-${String(ordinal)}`,
    created_at: "2026-08-21T10:00:00Z",
    updated_at: "2026-08-21T10:00:41Z",
    ...overrides,
  };
}

function _rosterOf(dispatches: FakeDispatch[]) {
  return subagentRosterOf(rosterEntriesOf(dispatches, _PREDICATES));
}

describe("rosterEntriesOf", () => {
  it("sorts by ordinal regardless of arrival order", () => {
    const entries = rosterEntriesOf(
      [
        _dispatch(2, "succeeded"),
        _dispatch(0, "dispatched"),
        _dispatch(1, "failed"),
      ],
      _PREDICATES,
    );
    expect(entries.map((entry) => entry.ordinal)).toEqual([0, 1, 2]);
  });

  it("keeps separate fan-outs whole — dispatch time first, ordinal within a run", () => {
    // Ordinal is only unique per parent run: a thread whose first turn
    // dispatched three children and whose second dispatched two must not
    // interleave as A0, B0, A1, B1, A2.
    const first = { created_at: "2026-08-21T10:00:00Z" };
    const second = { created_at: "2026-08-21T10:05:00Z" };
    const entries = rosterEntriesOf(
      [
        _dispatch(0, "succeeded", { ...second, child_session_id: "b-0" }),
        _dispatch(2, "succeeded", { ...first, child_session_id: "a-2" }),
        _dispatch(1, "succeeded", { ...second, child_session_id: "b-1" }),
        _dispatch(0, "succeeded", { ...first, child_session_id: "a-0" }),
        _dispatch(1, "succeeded", { ...first, child_session_id: "a-1" }),
      ],
      _PREDICATES,
    );
    expect(entries.map((entry) => entry.childSessionId)).toEqual([
      "a-0",
      "a-1",
      "a-2",
      "b-0",
      "b-1",
    ]);
  });

  it("keys per ask, addresses per session, and falls back on an empty label", () => {
    // The render key is per-ASK (a resume chain shares the session
    // handle); the drill-in address stays the session.
    const entries = rosterEntriesOf(
      [_dispatch(0, "dispatched", { label: "" })],
      _PREDICATES,
    );
    expect(entries[0].key).toBe("child-0:0");
    expect(entries[0].childSessionId).toBe("child-0");
    expect(entries[0].label).toBe("Delegated task");
  });

  it("a running entry has no settle time and no note", () => {
    const [entry] = rosterEntriesOf([_dispatch(0, "dispatched")], _PREDICATES);
    expect(entry.running).toBe(true);
    expect(entry.settledAt).toBeNull();
    expect(entry.note).toBeNull();
  });

  it("a failed entry settles with its error sentence", () => {
    const [entry] = rosterEntriesOf([_dispatch(0, "failed")], _PREDICATES);
    expect(entry.failed).toBe(true);
    expect(entry.settledAt).toBe("2026-08-21T10:00:41Z");
    expect(entry.note).toBe("The subagent died.");
  });

  it("a failed entry with no error still carries a reason", () => {
    // error is nullable, and the roster has no wire receipt to fall
    // through to — the constant sentence is the guard.
    const [entry] = rosterEntriesOf(
      [_dispatch(0, "failed", { error: null })],
      _PREDICATES,
    );
    expect(entry.note).toBe("The subagent failed before it could report back.");
  });

  it("a succeeded entry settles quietly", () => {
    const [entry] = rosterEntriesOf([_dispatch(0, "succeeded")], _PREDICATES);
    expect(entry.running).toBe(false);
    expect(entry.failed).toBe(false);
    expect(entry.settledAt).toBe("2026-08-21T10:00:41Z");
    expect(entry.note).toBeNull();
  });
});

describe("subagentRosterOf", () => {
  it("buckets running, completed, and failed", () => {
    const roster = _rosterOf([
      _dispatch(0, "dispatched"),
      _dispatch(1, "succeeded"),
      _dispatch(2, "failed"),
      _dispatch(3, "dispatched"),
    ]);
    expect(roster.running.map((entry) => entry.ordinal)).toEqual([0, 3]);
    expect(roster.completed.map((entry) => entry.ordinal)).toEqual([1]);
    expect(roster.failed.map((entry) => entry.ordinal)).toEqual([2]);
    expect(roster.total).toBe(4);
  });

  it("is empty-safe", () => {
    const roster = _rosterOf([]);
    expect(roster.total).toBe(0);
    expect(roster.running).toEqual([]);
    expect(roster.completed).toEqual([]);
    expect(roster.failed).toEqual([]);
  });
});

describe("subagentPillLabelOf", () => {
  it("is null with no subagents — the pill renders nothing", () => {
    expect(subagentPillLabelOf(_rosterOf([]))).toBeNull();
  });

  it("leads with the live count while any child runs", () => {
    expect(subagentPillLabelOf(_rosterOf([_dispatch(0, "dispatched")]))).toBe(
      "1 running",
    );
    expect(
      subagentPillLabelOf(
        _rosterOf([
          _dispatch(0, "dispatched"),
          _dispatch(1, "dispatched"),
          _dispatch(2, "dispatched"),
          _dispatch(3, "succeeded"),
        ]),
      ),
    ).toBe("3 running");
  });

  it("settles to the total, singular and plural, with losses named", () => {
    expect(subagentPillLabelOf(_rosterOf([_dispatch(0, "succeeded")]))).toBe(
      "1 subagent",
    );
    // The pill is the roster's collapsed form: the loss survives.
    expect(
      subagentPillLabelOf(
        _rosterOf([
          _dispatch(0, "succeeded"),
          _dispatch(1, "failed"),
          _dispatch(2, "succeeded"),
        ]),
      ),
    ).toBe("3 subagents · 1 failed");
    expect(subagentPillLabelOf(_rosterOf([_dispatch(0, "failed")]))).toBe(
      "1 subagent · 1 failed",
    );
    expect(
      subagentPillLabelOf(
        _rosterOf(
          Array.from({ length: 33 }, (_, index) =>
            _dispatch(index, "succeeded"),
          ),
        ),
      ),
    ).toBe("33 subagents");
  });

  it("a live fan-out names its losses too — the suffix rides both arms", () => {
    expect(
      subagentPillLabelOf(
        _rosterOf([_dispatch(0, "dispatched"), _dispatch(1, "failed")]),
      ),
    ).toBe("1 running · 1 failed");
    expect(
      subagentPillLabelOf(
        _rosterOf([
          _dispatch(0, "dispatched"),
          _dispatch(1, "failed"),
          _dispatch(2, "failed"),
          _dispatch(3, "failed"),
          _dispatch(4, "failed"),
        ]),
      ),
    ).toBe("1 running · 4 failed");
  });
});

describe("settledDurationLabelOf", () => {
  it("is null while running", () => {
    expect(settledDurationLabelOf("2026-08-21T10:00:00Z", null)).toBeNull();
  });

  it("speaks the house ladder (segment-timing's durationLabelOf)", () => {
    expect(
      settledDurationLabelOf("2026-08-21T10:00:00Z", "2026-08-21T10:00:41Z"),
    ).toBe("41s");
    expect(
      settledDurationLabelOf("2026-08-21T10:00:00Z", "2026-08-21T10:03:04Z"),
    ).toBe("3m 04s");
    expect(
      settledDurationLabelOf("2026-08-21T10:00:00Z", "2026-08-21T11:07:00Z"),
    ).toBe("1h 07m");
  });

  it("a sub-second span reads '<1s' — '0s' is not in the register", () => {
    expect(
      settledDurationLabelOf(
        "2026-08-21T10:00:00.000Z",
        "2026-08-21T10:00:00.400Z",
      ),
    ).toBe("<1s");
  });

  it("clamps a clock skew below zero and refuses garbage", () => {
    // A skewed pair clamps to a measured zero — a real sub-second span,
    // never "0s" and never hidden.
    expect(
      settledDurationLabelOf("2026-08-21T10:00:41Z", "2026-08-21T10:00:00Z"),
    ).toBe("<1s");
    expect(
      settledDurationLabelOf("not a date", "2026-08-21T10:00:00Z"),
    ).toBeNull();
  });
});

describe("a resume chain in the roster", () => {
  it("renders one entry per ask with unique keys and honest counts", () => {
    // One child asked twice: the original row and its resume row share
    // child_session_id but carry their own ordinals. A session-keyed
    // roster would render duplicate React keys and count the coworker
    // once per ask; the render key is per-ASK while the drill-in address
    // stays the shared session.
    const entries = rosterEntriesOf(
      [
        _dispatch(0, "succeeded", { child_session_id: "child-0" }),
        _dispatch(1, "dispatched", {
          child_session_id: "child-0",
          label: "How many are blue?",
        }),
      ],
      _PREDICATES,
    );

    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(2);
    expect(entries.map((entry) => entry.childSessionId)).toEqual([
      "child-0",
      "child-0",
    ]);
    expect(entries.map((entry) => entry.label)).toEqual([
      "Task 0",
      "How many are blue?",
    ]);

    const roster = subagentRosterOf(entries);
    expect(roster.total).toBe(2);
    expect(roster.running).toHaveLength(1);
    expect(roster.completed).toHaveLength(1);
  });

  it("the pill counts coworkers, never asks — 1 dispatch + 2 resumes reads '1 subagent' (round 10)", () => {
    const chain = _rosterOf([
      _dispatch(0, "succeeded", { child_session_id: "child-0" }),
      _dispatch(1, "succeeded", { child_session_id: "child-0" }),
      _dispatch(2, "succeeded", { child_session_id: "child-0" }),
    ]);
    // The roster honestly lists every ask…
    expect(chain.total).toBe(3);
    expect(chain.distinctSessions).toBe(1);
    // …while the pill's noun means what it says.
    expect(subagentPillLabelOf(chain)).toBe("1 subagent");

    // Beside a second coworker the noun counts 2 — and a failed ask
    // still names its loss per-ask.
    const two = _rosterOf([
      _dispatch(0, "succeeded", { child_session_id: "child-0" }),
      _dispatch(1, "failed", { child_session_id: "child-0" }),
      _dispatch(2, "succeeded", { child_session_id: "child-2" }),
    ]);
    expect(subagentPillLabelOf(two)).toBe("2 subagents · 1 failed");

    // A coworker with a running resume is running: the live arm counts
    // per-ask, which the one-live-run law makes per-coworker.
    const live = _rosterOf([
      _dispatch(0, "succeeded", { child_session_id: "child-0" }),
      _dispatch(1, "dispatched", { child_session_id: "child-0" }),
    ]);
    expect(subagentPillLabelOf(live)).toBe("1 running");
  });

  it("the loss count speaks coworkers too — newest ask decides (round 11)", () => {
    // A chain that failed twice is ONE lost coworker, never "2 of 1".
    const failedTwice = _rosterOf([
      _dispatch(0, "failed", { child_session_id: "child-0" }),
      _dispatch(1, "failed", { child_session_id: "child-0" }),
    ]);
    expect(failedTwice.failedSessions).toBe(1);
    expect(subagentPillLabelOf(failedTwice)).toBe("1 subagent · 1 failed");

    // A succeeded resume RECOVERS the coworker: the newest ask is its
    // current state, so the label reads clean while the per-ask rows
    // still name the lost original.
    const recovered = _rosterOf([
      _dispatch(0, "failed", { child_session_id: "child-0" }),
      _dispatch(1, "succeeded", { child_session_id: "child-0" }),
    ]);
    expect(recovered.failedSessions).toBe(0);
    expect(recovered.failed).toHaveLength(1);
    expect(subagentPillLabelOf(recovered)).toBe("1 subagent");
  });
});
