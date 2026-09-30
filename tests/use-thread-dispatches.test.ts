// @vitest-environment jsdom
/**
 * The widget's dispatch ledger poll: one read when a delegation exists, a
 * 10s interval only while any join-keyed coworker is still unsettled
 * after the ledger's word, a hard stop once the family settled (and on
 * unmount), one shared poll across concurrently mounted surfaces, no poll
 * at all for an entry the ledger can never correct (an interruption that
 * cut the receipt off), single-flight under a slow read, and a transient
 * failure keeping the last good map.
 */
import { Fragment, act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ThreadDispatch } from "../src/contract/dispatches";
import type { TranscriptRow } from "../src/core/transcript-rows";
import type { TokenSession } from "../src/transport/token-session";
import {
  useChildDispatch,
  useThreadDispatches,
} from "../src/components/use-thread-dispatches";

vi.mock("../src/transport/serving-api", () => ({
  listThreadDispatches: vi.fn(),
}));

import { listThreadDispatches } from "../src/transport/serving-api";

const listMock = vi.mocked(listThreadDispatches);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
// Fresh per test: the ledger registry is keyed by session identity, so a
// shared object would leak one test's poll state into the next.
let session: TokenSession;
// The hook's latest answer, captured from an effect — a render may not
// write outside itself, and every assertion below runs after an act
// flush, so the effect has always landed first.
const seen: { latest: ReadonlyMap<number, ThreadDispatch> } = {
  latest: new Map(),
};

function Probe({
  threadId,
  rows,
  onDispatchSettled,
  onDispatchPaused,
}: {
  threadId: string | null;
  rows: readonly TranscriptRow[];
  onDispatchSettled?: () => void;
  onDispatchPaused?: () => void;
}) {
  const latest = useThreadDispatches(
    session,
    threadId,
    rows,
    onDispatchSettled,
    onDispatchPaused,
  );
  useEffect(() => {
    seen.latest = latest;
  });
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  listMock.mockReset();
  session = {} as TokenSession;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  vi.useRealTimers();
});

function _groupRows(): TranscriptRow[] {
  return [
    {
      kind: "subagent-group",
      key: "subagents:call-1",
      entries: [
        {
          toolCallId: "call-1",
          receipt: {
            outcome: "launched",
            ordinal: 0,
            label: "Survey the corpus.",
            childSessionId: "subagent-run-0",
            settled: null,
          },
          label: "Survey the corpus.",
          running: true,
          failed: false,
          cancelled: false,
          note: null,
        },
      ],
    },
  ];
}

function _settledRows(): TranscriptRow[] {
  // Wire receipts all read settled — the one-shot read's whole audience
  // (the ledger may still say failed where the wire says finished).
  return [
    {
      kind: "subagent-group",
      key: "subagents:call-1",
      entries: [
        {
          toolCallId: "call-1",
          receipt: {
            outcome: "launched",
            ordinal: 0,
            label: "Survey the corpus.",
            childSessionId: "subagent-run-0",
            settled: { failed: false, note: null },
          },
          label: "Survey the corpus.",
          running: false,
          failed: false,
          cancelled: false,
          note: null,
        },
      ],
    },
  ];
}

function _interruptedRows(): TranscriptRow[] {
  // The interruption shape: the dispatch call streamed but the run ended
  // before its receipt — no childSessionId, wire running frozen true.
  return [
    {
      kind: "subagent-group",
      key: "subagents:call-1",
      entries: [
        {
          toolCallId: "call-1",
          receipt: null,
          label: "Survey the corpus.",
          running: true,
          failed: false,
          cancelled: false,
          note: null,
        },
      ],
    },
  ];
}

function _dispatch(status: ThreadDispatch["status"]): ThreadDispatch {
  return {
    ordinal: 0,
    label: "Survey the corpus.",
    status,
    error: status === "failed" ? "Died." : null,
    child_session_id: "subagent-run-0",
    created_at: "2026-08-19T10:00:00Z",
    updated_at: "2026-08-19T10:02:30Z",
  };
}

async function _mount(
  threadId: string | null,
  rows: TranscriptRow[],
  onDispatchSettled?: () => void,
  onDispatchPaused?: () => void,
) {
  await act(async () => {
    root.render(
      createElement(Probe, {
        threadId,
        rows,
        onDispatchSettled,
        onDispatchPaused,
      }),
    );
    // The mount effect's first read is a microtask; flush it inside act.
    await Promise.resolve();
  });
}

async function _tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("the widget dispatch poll", () => {
  it("never reads without a delegation on the transcript", async () => {
    await _mount("thread-1", []);
    await _tick(30_000);

    expect(listMock).not.toHaveBeenCalled();
    expect(seen.latest.size).toBe(0);
  });

  it("reads, joins by ordinal, and stops when the ledger says settled", async () => {
    listMock.mockResolvedValue([_dispatch("succeeded")]);
    await _mount("thread-1", _groupRows());
    await _tick(0);

    expect(seen.latest.get(0)?.status).toBe("succeeded");

    // The stale launched receipt alone must not keep the poll alive: the
    // ledger settled the child, so no further reads.
    const settledCalls = listMock.mock.calls.length;
    await _tick(60_000);
    expect(listMock.mock.calls.length).toBe(settledCalls);
  });

  it("polls at 10s while a row still runs, then stops once it settles", async () => {
    listMock.mockResolvedValue([_dispatch("dispatched")]);
    await _mount("thread-1", _groupRows());
    await _tick(0);
    expect(listMock).toHaveBeenCalledTimes(1);

    await _tick(10_000);
    expect(listMock).toHaveBeenCalledTimes(2);

    listMock.mockResolvedValue([_dispatch("succeeded")]);
    await _tick(10_000);
    const settledCalls = listMock.mock.calls.length;
    expect(settledCalls).toBeGreaterThanOrEqual(3);
    await _tick(60_000);
    expect(listMock.mock.calls.length).toBe(settledCalls);
  });

  it("a delivery divider appearing live refreshes the ledger immediately", async () => {
    // The delivery turn's cause marker proves its ordinal settled — the
    // ledger row still reading dispatched is stale, and a reported child
    // must not read as running until the next 10s tick.
    listMock.mockResolvedValue([_dispatch("dispatched")]);
    await _mount(null, []);
    await _mount("thread-1", _groupRows());
    expect(listMock).toHaveBeenCalledTimes(1);

    listMock.mockResolvedValue([_dispatch("succeeded")]);
    await _mount("thread-1", [
      {
        kind: "subagent-delivery",
        key: "a-delivery:delivery",
        results: [{ ordinal: 0, label: "Survey the corpus.", succeeded: true }],
      },
      ..._groupRows(),
    ]);

    expect(listMock).toHaveBeenCalledTimes(2);
    expect(seen.latest.get(0)?.status).toBe("succeeded");
    // The catch-up landed settled truth: the gate is quiet again and the
    // poll stood down with it.
    await _tick(30_000);
    expect(listMock).toHaveBeenCalledTimes(2);
  });

  it("historical delivery dividers arriving after mount add no read beyond the one-shot", async () => {
    // Production's real ordering: the first render has no thread and no
    // rows — history arrives OVER THE WIRE after mount (a fresh load's
    // first connection is a full replay, not a snapshot-seeded resume).
    // The replayed divider lands while the delegation one-shot is still
    // in flight, and must not chain a second read: any read this surface
    // makes postdates the historical settle already.
    let resolveRead: (rows: ThreadDispatch[]) => void = () => undefined;
    listMock.mockImplementation(
      () =>
        new Promise<ThreadDispatch[]>((resolve) => {
          resolveRead = resolve;
        }),
    );
    await _mount(null, []);
    await _mount("thread-1", []);
    expect(listMock).not.toHaveBeenCalled();

    await _mount("thread-1", [
      {
        kind: "subagent-delivery",
        key: "a-delivery:delivery",
        results: [{ ordinal: 0, label: "Survey the corpus.", succeeded: true }],
      },
      ..._settledRows(),
    ]);
    expect(listMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRead([_dispatch("succeeded")]);
      await Promise.resolve();
    });
    await _tick(30_000);

    expect(listMock).toHaveBeenCalledTimes(1);
    expect(seen.latest.get(0)?.status).toBe("succeeded");
  });

  it("a fresh resume DISCOVERS its ledger row from a settled map", async () => {
    // The built-for scenario the earlier tests missed: every coworker
    // already settled — the map is read and the poll stopped — THEN a
    // resume_subagent tool call lands on the transcript. Its receipt
    // (never a subagent-group entry) is what must fire the read that
    // discovers the new ledger row.
    listMock.mockResolvedValue([_dispatch("succeeded")]);
    await _mount("thread-1", _settledRows());
    await _tick(0);
    const settledCalls = listMock.mock.calls.length;
    await _tick(30_000);
    expect(listMock.mock.calls.length).toBe(settledCalls); // poll stopped

    // The resume call streams: a plain tool-call row whose result is the
    // launched receipt naming the NEW ordinal — absent from the map.
    listMock.mockResolvedValue([
      _dispatch("succeeded"),
      { ..._dispatch("dispatched"), ordinal: 1, label: "How many are blue?" },
    ]);
    await _mount("thread-1", [
      ..._settledRows(),
      {
        kind: "tool-call",
        key: "tool:call-2",
        toolCallId: "call-2",
        toolName: "resume_subagent",
        state: "output-available",
        offloaded: false,
        argsText: "{}",
        result:
          '{"outcome":"launched","ordinal":1,"label":"How many are blue?",' +
          '"child_session_id":"subagent-run-0","settled":null}',
      },
    ]);
    await _tick(10_000);
    expect(listMock.mock.calls.length).toBeGreaterThan(settledCalls);
    expect(seen.latest.get(1)?.status).toBe("dispatched");

    // …the ledger arm keeps polling, and the settle is seen and stops it.
    listMock.mockResolvedValue([
      _dispatch("succeeded"),
      { ..._dispatch("succeeded"), ordinal: 1, label: "How many are blue?" },
    ]);
    await _tick(10_000);
    expect(seen.latest.get(1)?.status).toBe("succeeded");
    const doneCalls = listMock.mock.calls.length;
    await _tick(60_000);
    expect(listMock.mock.calls.length).toBe(doneCalls);
  });

  it("a receiptless permanently-DISPATCHED row never pins the poll; a resume's own receipt still arms it", async () => {
    // The unreached-start refusal deliberately leaves its ledger row
    // DISPATCHED forever (the ambiguous failure may have actually
    // started the child) and raises, so no receipt ever reaches the
    // transcript. A ledger-wide arm would poll this thread at 10s for
    // the rest of its life on every view; the transcript-joined arms
    // must render the row as the ledger says and let the timer rest.
    listMock.mockResolvedValue([
      _dispatch("succeeded"),
      { ..._dispatch("dispatched"), ordinal: 1, label: "Unreached start." },
    ]);
    await _mount("thread-1", _settledRows());
    await _tick(0);
    expect(seen.latest.get(1)?.status).toBe("dispatched");
    expect(listMock).toHaveBeenCalledTimes(1); // the one truth read…
    await _tick(120_000);
    expect(listMock).toHaveBeenCalledTimes(1); // …and no poll.

    // The SAME still-dispatched ledger shape with the resume's own
    // receipt on the transcript is a real running resume — the join
    // key exists, so the poll arms and follows it down to its settle.
    await _mount("thread-1", [
      ..._settledRows(),
      {
        kind: "tool-call",
        key: "tool:call-2",
        toolCallId: "call-2",
        toolName: "resume_subagent",
        state: "output-available",
        offloaded: false,
        argsText: "{}",
        result:
          '{"outcome":"launched","ordinal":1,"label":"Unreached start.",' +
          '"child_session_id":"subagent-run-0","settled":null}',
      },
    ]);
    const armedCalls = listMock.mock.calls.length;
    await _tick(10_000);
    expect(listMock.mock.calls.length).toBeGreaterThan(armedCalls);

    // …and its settle is seen and stops it.
    listMock.mockResolvedValue([
      _dispatch("succeeded"),
      { ..._dispatch("succeeded"), ordinal: 1, label: "Unreached start." },
    ]);
    await _tick(10_000);
    const settledCalls = listMock.mock.calls.length;
    expect(seen.latest.get(1)?.status).toBe("succeeded");
    await _tick(60_000);
    expect(listMock.mock.calls.length).toBe(settledCalls);
  });

  it("reads once for an interrupted dispatch and never polls — no join key means no correction to wait for", async () => {
    listMock.mockResolvedValue([]);
    await _mount("thread-1", _interruptedRows());
    await _tick(0);

    // Settled history still gets its one truth read...
    expect(listMock).toHaveBeenCalledTimes(1);
    // ...but the frozen receipt-less "running" entry must not pin a
    // customer's page to an indefinite 10s poll.
    await _tick(120_000);
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("shares one poll across concurrently mounted surfaces", async () => {
    listMock.mockResolvedValue([_dispatch("dispatched")]);
    const rows = _groupRows();
    await act(async () => {
      root.render(
        createElement(
          Fragment,
          null,
          createElement(Probe, { threadId: "thread-1", rows }),
          createElement(Probe, { threadId: "thread-1", rows }),
        ),
      );
      await Promise.resolve();
    });
    await _tick(0);
    // Two mounted transcripts, ONE read and ONE timer.
    expect(listMock).toHaveBeenCalledTimes(1);
    await _tick(10_000);
    expect(listMock).toHaveBeenCalledTimes(2);

    // The last surface leaving stops the poll.
    act(() => {
      root.unmount();
    });
    await _tick(60_000);
    expect(listMock).toHaveBeenCalledTimes(2);
  });

  it("stops on unmount — no timer survives a dismissal", async () => {
    listMock.mockResolvedValue([_dispatch("dispatched")]);
    await _mount("thread-1", _groupRows());
    await _tick(10_000);
    const before = listMock.mock.calls.length;

    act(() => {
      root.unmount();
    });
    await _tick(60_000);
    expect(listMock.mock.calls.length).toBe(before);
  });

  it("keeps the last good map through a transient failure and retries next tick", async () => {
    listMock.mockResolvedValueOnce([_dispatch("dispatched")]);
    await _mount("thread-1", _groupRows());
    await _tick(0);
    expect(seen.latest.get(0)?.status).toBe("dispatched");

    listMock.mockRejectedValueOnce(new Error("blip"));
    await _tick(10_000);
    expect(seen.latest.get(0)?.status).toBe("dispatched");

    listMock.mockResolvedValue([_dispatch("succeeded")]);
    await _tick(10_000);
    expect(seen.latest.get(0)?.status).toBe("succeeded");
  });

  it("republishes nothing when the ledger comes back unchanged — ticks must not re-render idle transcripts", async () => {
    listMock.mockResolvedValue([_dispatch("dispatched")]);
    await _mount("thread-1", _groupRows());
    await _tick(0);
    const first = seen.latest;
    expect(first.get(0)?.status).toBe("dispatched");

    // Two ticks answering the identical family: the cell must not
    // notify, so the hook's map keeps its identity.
    await _tick(10_000);
    await _tick(10_000);
    expect(seen.latest).toBe(first);

    // A real change still lands.
    listMock.mockResolvedValue([_dispatch("succeeded")]);
    await _tick(10_000);
    expect(seen.latest).not.toBe(first);
    expect(seen.latest.get(0)?.status).toBe("succeeded");
  });

  it("a stale flight's failure trip never kills another thread's timer", async () => {
    // Thread A misses twice, its third read hangs, and the visitor
    // switches to thread B — whose timer the late failure must not stop:
    // nothing would re-arm it, and B's settling coworkers would spin on
    // frozen receipts for the rest of the page.
    listMock.mockRejectedValueOnce(new Error("gone"));
    await _mount("thread-A", _groupRows());
    await _tick(0);
    listMock.mockRejectedValueOnce(new Error("gone"));
    await _tick(10_000);
    expect(listMock).toHaveBeenCalledTimes(2);

    let rejectA: (error: Error) => void = () => undefined;
    listMock.mockImplementationOnce(
      () =>
        new Promise<ThreadDispatch[]>((_resolve, reject) => {
          rejectA = reject;
        }),
    );
    await _tick(10_000);
    expect(listMock).toHaveBeenCalledTimes(3);

    listMock.mockResolvedValue([_dispatch("dispatched")]);
    await _mount("thread-B", _groupRows());
    await _tick(0);
    await act(async () => {
      rejectA(new Error("gone"));
      await Promise.resolve();
    });
    await _tick(0);
    // The parked read for B landed after A's terminal failure...
    expect(seen.latest.get(0)?.status).toBe("dispatched");
    const afterLanding = listMock.mock.calls.length;

    // ...and B's poll is still alive.
    await _tick(10_000);
    expect(listMock.mock.calls.length).toBe(afterLanding + 1);
    expect(listMock).toHaveBeenLastCalledWith(session, "thread-B");
  });

  it("fails closed on a persistent failure — three straight misses stop the poll until a demand change", async () => {
    // A revoked key or gone thread never lands a map, so the frozen wire
    // receipts would keep stillMoving true forever — the trip is what
    // stands between that and an indefinite 10s retry on a customer's page.
    listMock.mockRejectedValue(new Error("revoked"));
    await _mount("thread-1", _groupRows());
    await _tick(0);
    await _tick(10_000);
    await _tick(10_000);
    expect(listMock).toHaveBeenCalledTimes(3);

    await _tick(120_000);
    expect(listMock).toHaveBeenCalledTimes(3);

    // A demand change re-arms for a fresh try; still failing, it trips
    // again immediately instead of resuming the indefinite retry.
    act(() => {
      root.unmount();
    });
    root = createRoot(host);
    await _mount("thread-1", _groupRows());
    await _tick(0);
    expect(listMock).toHaveBeenCalledTimes(4);
    await _tick(120_000);
    expect(listMock).toHaveBeenCalledTimes(4);
  });

  it("holds one request in flight at a time", async () => {
    let release: (rows: ThreadDispatch[]) => void = () => undefined;
    listMock.mockImplementationOnce(
      () =>
        new Promise<ThreadDispatch[]>((resolve) => {
          release = resolve;
        }),
    );
    await _mount("thread-1", _groupRows());
    await _tick(0);
    expect(listMock).toHaveBeenCalledTimes(1);

    // The first read is still in flight; ticks must not stack another.
    // Inside READ_BOUND_MS only: a flight held past two poll windows
    // is treated as wedged and retired — an indefinite hold is exactly
    // the latch this rules out (its stall behavior is pinned in the
    // wedged-read describe).
    await _tick(10_000);
    expect(listMock).toHaveBeenCalledTimes(1);

    listMock.mockResolvedValue([_dispatch("dispatched")]);
    await act(async () => {
      release([_dispatch("dispatched")]);
      // Let the resolved read land its state update inside act.
      await Promise.resolve();
    });
    await _tick(10_000);
    expect(listMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("retries a switch that landed mid-flight — the settled thread's one truth read still happens", async () => {
    let release: (rows: ThreadDispatch[]) => void = () => undefined;
    listMock.mockImplementationOnce(
      () =>
        new Promise<ThreadDispatch[]>((resolve) => {
          release = resolve;
        }),
    );
    await _mount("thread-1", _groupRows());
    await _tick(0);
    expect(listMock).toHaveBeenCalledTimes(1);

    // Switch to a settled thread while thread-1's read is in flight: no
    // timer will ever arm for it (wire says finished), so this one-shot
    // must be parked, not dropped.
    await _mount("thread-2", _settledRows());
    await _tick(0);
    expect(listMock).toHaveBeenCalledTimes(1);

    listMock.mockResolvedValue([_dispatch("failed")]);
    await act(async () => {
      release([_dispatch("dispatched")]);
      await Promise.resolve();
    });
    await _tick(0);
    expect(listMock).toHaveBeenCalledTimes(2);
    expect(listMock).toHaveBeenLastCalledWith(session, "thread-2");
    // The ledger's word outranks the wire's "finished": the row failed.
    expect(seen.latest.get(0)?.status).toBe("failed");
  });

  it("drops a stale park when the demand moves back — the landed read is never overwritten", async () => {
    // The round-3 repro: away-and-back while the original thread's read
    // is still in flight. The park made by the away-switch must die on
    // the back-switch, or it fires after the flight and overwrites the
    // demanded thread's fresh read with the other thread's.
    let release: (rows: ThreadDispatch[]) => void = () => undefined;
    listMock.mockImplementationOnce(
      () =>
        new Promise<ThreadDispatch[]>((resolve) => {
          release = resolve;
        }),
    );
    await _mount("thread-B", _groupRows());
    await _tick(0);
    expect(listMock).toHaveBeenCalledTimes(1);

    await _mount("thread-A", _settledRows());
    await _tick(0);
    await _mount("thread-B", _groupRows());
    await _tick(0);
    expect(listMock).toHaveBeenCalledTimes(1);

    listMock.mockResolvedValue([]);
    await act(async () => {
      release([_dispatch("succeeded")]);
      await Promise.resolve();
    });
    await _tick(0);
    // B's truth stands, and no stale read for thread-A ever fired.
    expect(seen.latest.get(0)?.status).toBe("succeeded");
    expect(listMock).toHaveBeenCalledTimes(1);
    await _tick(60_000);
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("honors only the demanded thread through an away-and-back during its own flight", async () => {
    // A in flight, demand A→B→A: the park for B is stale by the time the
    // flight ends — nothing may fetch a thread nobody demands.
    let release: (rows: ThreadDispatch[]) => void = () => undefined;
    listMock.mockImplementationOnce(
      () =>
        new Promise<ThreadDispatch[]>((resolve) => {
          release = resolve;
        }),
    );
    await _mount("thread-A", _groupRows());
    await _tick(0);
    await _mount("thread-B", _settledRows());
    await _tick(0);
    await _mount("thread-A", _groupRows());
    await _tick(0);
    expect(listMock).toHaveBeenCalledTimes(1);

    listMock.mockResolvedValue([_dispatch("dispatched")]);
    await act(async () => {
      release([_dispatch("dispatched")]);
      await Promise.resolve();
    });
    await _tick(0);
    expect(seen.latest.get(0)?.status).toBe("dispatched");
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(
      listMock.mock.calls.every(([, threadId]) => threadId === "thread-A"),
    ).toBe(true);
  });

  it("resets the map on a thread switch", async () => {
    listMock.mockResolvedValue([_dispatch("succeeded")]);
    await _mount("thread-1", _groupRows());
    await _tick(0);
    expect(seen.latest.size).toBe(1);

    listMock.mockResolvedValue([]);
    await _mount("thread-2", _groupRows());
    await _tick(0);
    expect(seen.latest.size).toBe(0);
  });
});

// The drill-in panel's half of the module: the real useChildDispatch
// over the real ledger — no mocked refreshLedger, so the
// single-flight machinery under the settle tap actually runs.
const childSeen: {
  dispatch: ThreadDispatch | undefined;
  refreshLedger: () => Promise<ThreadDispatch | undefined>;
} = { dispatch: undefined, refreshLedger: () => Promise.resolve(undefined) };

function ChildProbe({
  threadId,
  childSessionId,
}: {
  threadId: string | null;
  childSessionId: string;
}) {
  const { dispatch, refreshLedger } = useChildDispatch(
    session,
    threadId,
    childSessionId,
  );
  useEffect(() => {
    childSeen.dispatch = dispatch;
    childSeen.refreshLedger = refreshLedger;
  });
  return null;
}

function _deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

describe("the settle tap over the real ledger", () => {
  it("a tap arriving mid-arming-read judges on a FRESH read, never the stale flight", async () => {
    // The third iteration's law: the door emits its terminal only after
    // the row settled, but the arming read the panel's own demand fires
    // at mount may have queried BEFORE the settle. Joining that flight
    // would resolve the tap on a still-dispatched row — the interruption
    // banner over an honest failure. The tap must chain a fresh read.
    const arming = _deferred<ThreadDispatch[]>();
    const catchUp = _deferred<ThreadDispatch[]>();
    listMock.mockReturnValueOnce(arming.promise);
    listMock.mockReturnValueOnce(catchUp.promise);

    await act(async () => {
      root.render(
        createElement(ChildProbe, {
          threadId: "thread-1",
          childSessionId: "subagent-run-0",
        }),
      );
      await Promise.resolve();
    });
    expect(listMock).toHaveBeenCalledTimes(1);

    // The child fails while the arming read is in flight; its stream's
    // RUN_ERROR fires the settle tap.
    let tapLanded = false;
    let landedRow: ThreadDispatch | undefined;
    const tap = childSeen.refreshLedger().then((row) => {
      tapLanded = true;
      landedRow = row;
    });

    // The stale snapshot lands: taken before the settle, still
    // dispatched. The tap must NOT have resolved on it.
    await act(async () => {
      arming.resolve([_dispatch("dispatched")]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(tapLanded).toBe(false);
    // The chained fresh read went out the moment the flight ended.
    expect(listMock).toHaveBeenCalledTimes(2);

    // The fresh read lands the settled truth; only now does the tap
    // resolve — and the hook's row is already failed when it does, so
    // the panel's judge never accuses the connection.
    await act(async () => {
      catchUp.resolve([_dispatch("failed")]);
      await tap;
    });
    expect(tapLanded).toBe(true);
    expect(childSeen.dispatch?.status).toBe("failed");
    // The tap hands its caller the row it landed: the quiet-ending
    // judge reads THIS, never a closure's stale row.
    expect(landedRow?.status).toBe("failed");
  });

  it("concurrent taps mid-flight share ONE chained read", async () => {
    const arming = _deferred<ThreadDispatch[]>();
    listMock.mockReturnValueOnce(arming.promise);
    listMock.mockResolvedValue([_dispatch("failed")]);

    await act(async () => {
      root.render(
        createElement(ChildProbe, {
          threadId: "thread-1",
          childSessionId: "subagent-run-0",
        }),
      );
      await Promise.resolve();
    });
    const firstTap = childSeen.refreshLedger();
    const secondTap = childSeen.refreshLedger();

    await act(async () => {
      arming.resolve([_dispatch("dispatched")]);
      await Promise.all([firstTap, secondTap]);
    });
    // Arming read + the ONE shared catch-up: never a tap stampede.
    expect(listMock).toHaveBeenCalledTimes(2);
    expect(childSeen.dispatch?.status).toBe("failed");
  });
});

describe("the settle relay — an observed dispatch settle reaches the registered listener", () => {
  it("a dispatched→terminal transition fires exactly once; further reads stay quiet", async () => {
    const onSettled = vi.fn();
    listMock.mockResolvedValue([_dispatch("dispatched")]);
    await _mount("thread-1", _groupRows(), onSettled);
    await _tick(0);
    // The first read is historical truth, and an unchanged roster is not
    // a settle.
    await _tick(10_000);
    expect(onSettled).not.toHaveBeenCalled();

    listMock.mockResolvedValue([_dispatch("succeeded")]);
    await _tick(10_000);
    expect(onSettled).toHaveBeenCalledTimes(1);

    // Edge-triggered: the settled row is now the held truth, so later
    // reads (none here — the poll stopped with the family) re-fire nothing.
    await _tick(30_000);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("a first read landing already-terminal rows is replayed history — no fire", async () => {
    const onSettled = vi.fn();
    listMock.mockResolvedValue([_dispatch("succeeded")]);
    await _mount("thread-1", _settledRows(), onSettled);
    await _tick(0);
    expect(listMock).toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("a row unseen by the previous read that arrives already terminal still fires — settled inside one poll window", async () => {
    const onSettled = vi.fn();
    listMock.mockResolvedValue([_dispatch("dispatched")]);
    await _mount("thread-1", _groupRows(), onSettled);
    await _tick(0);

    listMock.mockResolvedValue([
      _dispatch("dispatched"),
      {
        ..._dispatch("succeeded"),
        ordinal: 1,
        child_session_id: "subagent-run-1",
      },
    ]);
    await _tick(10_000);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("a thread switch's first read never fires — another thread's history is not an observation", async () => {
    const onSettled = vi.fn();
    listMock.mockResolvedValue([_dispatch("dispatched")]);
    await _mount("thread-1", _groupRows(), onSettled);
    await _tick(0);

    listMock.mockResolvedValue([_dispatch("succeeded")]);
    await _mount("thread-2", _groupRows(), onSettled);
    await _tick(0);
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("N surfaces registering the same listener identity collapse to ONE invocation", async () => {
    const onSettled = vi.fn();
    listMock.mockResolvedValue([_dispatch("dispatched")]);
    await act(async () => {
      root.render(
        createElement(
          Fragment,
          null,
          createElement(Probe, {
            key: "page",
            threadId: "thread-1",
            rows: _groupRows(),
            onDispatchSettled: onSettled,
          }),
          createElement(Probe, {
            key: "palette",
            threadId: "thread-1",
            rows: _groupRows(),
            onDispatchSettled: onSettled,
          }),
        ),
      );
      await Promise.resolve();
    });
    await _tick(0);

    listMock.mockResolvedValue([_dispatch("succeeded")]);
    await _tick(10_000);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("the drill-in settle tap's fresh read fires detection too", async () => {
    const onSettled = vi.fn();
    listMock.mockResolvedValue([_dispatch("dispatched")]);
    await act(async () => {
      root.render(
        createElement(
          Fragment,
          null,
          createElement(Probe, {
            key: "page",
            threadId: "thread-1",
            rows: _groupRows(),
            onDispatchSettled: onSettled,
          }),
          createElement(ChildProbe, {
            key: "panel",
            threadId: "thread-1",
            childSessionId: "subagent-run-0",
          }),
        ),
      );
      await Promise.resolve();
    });
    await _tick(0);
    expect(onSettled).not.toHaveBeenCalled();

    listMock.mockResolvedValue([_dispatch("failed")]);
    await act(async () => {
      await childSeen.refreshLedger();
    });
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("a throwing listener neither counts toward the failure trip nor robs the listeners behind it", async () => {
    // Round-1 finding: the listeners used to run inside the read's
    // network try, so a consumer bug threw into the failure classifier —
    // three settles would trip MAX_CONSECUTIVE_READ_FAILURES and stop
    // the roster poll for the life of the page.
    const throwing = vi.fn(() => {
      throw new Error("consumer bug");
    });
    const counting = vi.fn();
    const stillRunning = () => _dispatch("dispatched");
    const secondRow = (status: ThreadDispatch["status"]) => ({
      ..._dispatch(status),
      ordinal: 1,
      child_session_id: "subagent-run-1",
    });
    listMock.mockResolvedValue([stillRunning(), secondRow("dispatched")]);
    await act(async () => {
      root.render(
        createElement(
          Fragment,
          null,
          createElement(Probe, {
            key: "a",
            threadId: "thread-1",
            rows: _groupRows(),
            onDispatchSettled: throwing,
          }),
          createElement(Probe, {
            key: "b",
            threadId: "thread-1",
            rows: _groupRows(),
            onDispatchSettled: counting,
          }),
        ),
      );
      await Promise.resolve();
    });
    await _tick(0);

    // Ordinal 1 settles while ordinal 0 keeps the poll alive; the first
    // registered listener throws on every settle it is told about — and
    // the one behind it still runs.
    listMock.mockResolvedValue([stillRunning(), secondRow("succeeded")]);
    await _tick(10_000);
    expect(throwing).toHaveBeenCalledTimes(1);
    expect(counting).toHaveBeenCalledTimes(1);

    // The throw was never a read failure: the poll is still alive well
    // past the trip's three-miss budget...
    const readsBefore = listMock.mock.calls.length;
    await _tick(30_000);
    expect(listMock.mock.calls.length).toBe(readsBefore + 3);

    // ...and a later settle still reaches every listener.
    listMock.mockResolvedValue([
      _dispatch("succeeded"),
      secondRow("succeeded"),
    ]);
    await _tick(10_000);
    expect(throwing).toHaveBeenCalledTimes(2);
    expect(counting).toHaveBeenCalledTimes(2);
  });

  it("an unmounted listener is never invoked — the surviving surface's settle stays its own", async () => {
    const onSettled = vi.fn();
    listMock.mockResolvedValue([_dispatch("dispatched")]);
    const withListener = () =>
      createElement(Probe, {
        key: "page",
        threadId: "thread-1",
        rows: _groupRows(),
        onDispatchSettled: onSettled,
      });
    const silent = () =>
      createElement(Probe, {
        key: "palette",
        threadId: "thread-1",
        rows: _groupRows(),
      });
    await act(async () => {
      root.render(createElement(Fragment, null, withListener(), silent()));
      await Promise.resolve();
    });
    await _tick(0);

    // The listening surface leaves; the silent one keeps the poll alive.
    await act(async () => {
      root.render(createElement(Fragment, null, silent()));
      await Promise.resolve();
    });
    listMock.mockResolvedValue([_dispatch("succeeded")]);
    await _tick(10_000);
    expect(onSettled).not.toHaveBeenCalled();
  });
});

describe("busy releases on every exit path", () => {
  // Mirrors READ_BOUND_MS in use-thread-dispatches.ts: two poll windows.
  const READ_BOUND_MS = 20_000;

  it("a never-resolving roster read releases busy at the bound — the poll survives and the next tick's read lands", async () => {
    // The ticket's ledger latch: busy was released only by _read's own
    // finally, and nothing in this transport aborts a stalled request —
    // one accepted-then-stalled GET killed every future roster read for
    // the life of the SESSION (ledgers are WeakMap-kept per TokenSession
    // and outlive every mount).
    listMock
      .mockImplementationOnce(() => new Promise<never>(() => undefined))
      .mockResolvedValue([_dispatch("succeeded")]);
    await _mount("thread-1", _groupRows());
    await _tick(0);
    expect(listMock).toHaveBeenCalledTimes(1);

    // A tick inside the bound joins the dead flight — single-flight
    // still holds.
    await _tick(10_000);
    expect(listMock).toHaveBeenCalledTimes(1);

    // The bound releases busy; the poll's next read lands fresh — no
    // reload needed.
    await _tick(READ_BOUND_MS);
    expect(seen.latest.get(0)?.status).toBe("succeeded");
    expect(listMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("a rejected roster read releases busy on the spot — an AbortError-shaped rejection identically (the scope-3 ruling pin)", async () => {
    // RULING PIN, NOT A FALSIFIED LATCH TEST: this case already passes at
    // pre-fix HEAD, because _read's finally runs on any settled
    // rejection. It is here because the ticket names it, and to pin the
    // scope-3 ruling: an aborted read releases busy IMMEDIATELY and is
    // never held for a successor. The falsified twin is the stall test
    // above.
    listMock
      .mockRejectedValueOnce(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      )
      .mockResolvedValue([_dispatch("succeeded")]);
    await _mount("thread-1", _groupRows());
    await _tick(0);
    expect(listMock).toHaveBeenCalledTimes(1);

    await _tick(10_000);
    expect(listMock).toHaveBeenCalledTimes(2);
    expect(seen.latest.get(0)?.status).toBe("succeeded");
  });

  it("a bounded-out read's late landing outrun by fresher truth adopts nothing — not the cell, not the listeners", async () => {
    // The other half of the bound's contract: releasing busy leaves the
    // GET pending, and this transport never settles a stalled request on
    // its own — so the response may land MINUTES late, after fresher
    // reads adopted. Adoption is monotonic in issue order: an OUTRUN
    // retired flight is barred from the cell and the settle listeners
    // (a retired success landing with nothing newer adopted does land —
    // the slow-endpoint tests below — but never over fresher truth).
    const stalled = _deferred<ThreadDispatch[]>();
    const onSettled = vi.fn();
    listMock
      .mockImplementationOnce(() => stalled.promise)
      .mockResolvedValueOnce([_dispatch("dispatched")])
      .mockResolvedValue([_dispatch("succeeded")]);
    await _mount("thread-1", _groupRows(), onSettled);
    await _tick(0);
    expect(listMock).toHaveBeenCalledTimes(1);

    // Past the bound the poll recovers: a fresh read lands the
    // dispatched row, the next observes the settle — exactly one relay.
    await _tick(40_000);
    expect(seen.latest.get(0)?.status).toBe("succeeded");
    expect(onSettled).toHaveBeenCalledTimes(1);

    // The dead flight lands with its stale dispatched row: no cell
    // movement, no spurious settle burst.
    await act(async () => {
      stalled.resolve([_dispatch("dispatched")]);
      await Promise.resolve();
    });
    expect(seen.latest.get(0)?.status).toBe("succeeded");
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("repeated bound-outs trip the persistent-failure stop — a wedged endpoint costs at most MAX_CONSECUTIVE_READ_FAILURES sockets", async () => {
    // Releasing busy without counting the stall would trade one latched
    // socket for one new wedged socket per tick — the per-host-budget
    // hazard, reopened. Each bound-out counts toward the trip, so a
    // wedged endpoint stops after three outstanding sockets.
    listMock.mockImplementation(() => new Promise<never>(() => undefined));
    await _mount("thread-1", _groupRows());
    await _tick(0);
    await _tick(200_000);
    expect(listMock).toHaveBeenCalledTimes(3);

    await _tick(200_000);
    expect(listMock).toHaveBeenCalledTimes(3);
  });

  it("a slow-but-working endpoint never trips the stop — and its retired successes still land their truth", async () => {
    // Round-1 review finding: a bound-out counts toward the trip, and a
    // retired flight's eventual SUCCESS was discarded whole by the
    // generation guard — so an endpoint that is merely slow (cold
    // serverless, a big roster on a bad link: every read answers past
    // the 20s bound) accrued three "failures" and stopped the poll for
    // the rest of the page, even though every request returned good
    // data. Round-2 review finding, on round 1's own residue: clearing
    // the streak but discarding the payload froze the cell permanently —
    // an unbounded GET loop throwing away good data on every cycle. The
    // rule is now the store half's own: adoption is monotonic in issue
    // order — a retired success adopts when nothing newer has adopted
    // for its thread.
    listMock.mockImplementation(
      () =>
        new Promise<ThreadDispatch[]>((resolve) => {
          window.setTimeout(() => {
            resolve([_dispatch("dispatched")]);
          }, 25_000);
        }),
    );
    await _mount("thread-1", _groupRows());
    await _tick(0);
    expect(listMock).toHaveBeenCalledTimes(1);

    // Ten minutes of 25s answers: bound-outs interleave with retired
    // successes, the streak oscillates 1 → 0, the poll stays alive —
    // and the data lands, 25s late each time, instead of never.
    await _tick(600_000);
    expect(listMock.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(seen.latest.get(0)?.status).toBe("dispatched");
  });

  it("a one-shot read landing past the bound still lands its truth — the ledger's word outranks the frozen wire receipt", async () => {
    // The no-poll shape of the same arbitration: settled wire receipts
    // fire one truth read and never arm a timer, so if that read's late
    // landing were discarded, nothing would ever correct the rows.
    listMock.mockImplementationOnce(
      () =>
        new Promise<ThreadDispatch[]>((resolve) => {
          window.setTimeout(() => {
            resolve([_dispatch("failed")]);
          }, 25_000);
        }),
    );
    await _mount("thread-1", _settledRows());
    await _tick(0);
    expect(listMock).toHaveBeenCalledTimes(1);

    await _tick(30_000);
    // The ledger says failed where the wire said finished — the read
    // landed past its bound, and its truth still counts.
    expect(seen.latest.get(0)?.status).toBe("failed");
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("a settle tap chained behind a stalled flight resolves at the bound and re-reads fresh", async () => {
    // refresh()'s followUp chains on the flight — the bounded deferred
    // the read or the bound settles, not the bare GET — so a tap behind
    // a wedged read settles at the bound and judges on a genuinely fresh
    // snapshot instead of hanging for the life of the session.
    listMock
      .mockImplementationOnce(() => new Promise<never>(() => undefined))
      .mockResolvedValue([_dispatch("failed")]);
    await act(async () => {
      root.render(
        createElement(ChildProbe, {
          threadId: "thread-1",
          childSessionId: "subagent-run-0",
        }),
      );
      await Promise.resolve();
    });
    expect(listMock).toHaveBeenCalledTimes(1);

    let tapLanded = false;
    void childSeen.refreshLedger().then(() => {
      tapLanded = true;
    });
    await _tick(0);
    expect(tapLanded).toBe(false);

    // The bound settles the dead flight; the chained fresh read fires
    // and the tap resolves on ITS snapshot.
    await _tick(READ_BOUND_MS);
    await _tick(0);
    expect(tapLanded).toBe(true);
    expect(listMock).toHaveBeenCalledTimes(2);
    expect(childSeen.dispatch?.status).toBe("failed");
  });
});

describe("the pause relay — an observed coworker pause reaches the registered listener", () => {
  it("a dispatched→paused transition fires exactly once; an unchanged paused roster stays quiet", async () => {
    const onPaused = vi.fn();
    listMock.mockResolvedValue([_dispatch("dispatched")]);
    await _mount("thread-1", _groupRows(), undefined, onPaused);
    await _tick(0);
    await _tick(10_000);
    expect(onPaused).not.toHaveBeenCalled();

    listMock.mockResolvedValue([_dispatch("paused")]);
    await _tick(10_000);
    expect(onPaused).toHaveBeenCalledTimes(1);

    // Edge-triggered: the paused row is now the held truth.
    await _tick(10_000);
    expect(onPaused).toHaveBeenCalledTimes(1);
  });

  it("a first read that already holds a paused row fires — the request may postdate the adopted conversation", async () => {
    const onPaused = vi.fn();
    listMock.mockResolvedValue([_dispatch("paused")]);
    await _mount("thread-1", _groupRows(), undefined, onPaused);
    await _tick(0);
    expect(onPaused).toHaveBeenCalledTimes(1);
  });

  it("a settle is not a pause and a pause is not a settle — the two relays fire independently", async () => {
    const onSettled = vi.fn();
    const onPaused = vi.fn();
    listMock.mockResolvedValue([_dispatch("dispatched")]);
    await _mount("thread-1", _groupRows(), onSettled, onPaused);
    await _tick(0);

    listMock.mockResolvedValue([_dispatch("paused")]);
    await _tick(10_000);
    expect(onPaused).toHaveBeenCalledTimes(1);
    expect(onSettled).not.toHaveBeenCalled();

    listMock.mockResolvedValue([_dispatch("succeeded")]);
    await _tick(10_000);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onPaused).toHaveBeenCalledTimes(1);
  });

  it("a coworker's SECOND pause inside one poll window is an edge — the re-stamped row, not the status, carries it", async () => {
    const onPaused = vi.fn();
    listMock.mockResolvedValue([
      { ..._dispatch("paused"), updated_at: "2026-08-19T10:05:00Z" },
    ]);
    await _mount("thread-1", _groupRows(), undefined, onPaused);
    await _tick(0);
    expect(onPaused).toHaveBeenCalledTimes(1);

    // Same status, same stamp: no edge.
    await _tick(10_000);
    expect(onPaused).toHaveBeenCalledTimes(1);

    // The answer landed and the coworker paused again before the next
    // read: still "paused", but the ledger re-stamped the row.
    listMock.mockResolvedValue([
      { ..._dispatch("paused"), updated_at: "2026-08-19T10:05:07Z" },
    ]);
    await _tick(10_000);
    expect(onPaused).toHaveBeenCalledTimes(2);
  });
});
