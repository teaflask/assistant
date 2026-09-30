"use client";

// The widget transcript's ledger read: the thread's dispatch family
// through the serving door, joined onto the subagent group rows so a
// child that outlives its turn reads settled instead of spinning on its
// frozen wire receipt. The read lives in a session-scoped registry cell:
// every mounted surface shares ONE map and ONE 10s single-flight poll,
// the union of demands drives the timer, and the last demand leaving
// stops it. Design record: docs/thread-dispatches.md.

import { useCallback, useEffect, useMemo } from "react";

import {
  dispatchIsPaused,
  dispatchIsRunning,
  type ThreadDispatch,
} from "../contract/dispatches.js";
import { ObservableCell } from "../core/observable-cell.js";
import { dispatchReceiptOf } from "../core/subagent-rows.js";
import type { TranscriptRow } from "../core/transcript-rows.js";
import { listThreadDispatches } from "../transport/serving-api.js";
import type { TokenSession } from "../transport/token-session.js";
import { resolvedSubagentEntryOf } from "./subagent-group-row.js";
import { useCell } from "./use-store-cell.js";

// The dashboard's watch-poll interval — a live view, faster than a safety
// net; the demand union stops it the moment nothing can move anymore.
const POLL_INTERVAL_MS = 10_000;

// The persistent-failure trip (the dashboard twin's fail-closed stance): a
// read that keeps failing — revoked key, expired token, a gone thread —
// must not retry every 10s for the life of the page. After this many
// consecutive failures on one thread the timer stops; a demand change re-arms.
const MAX_CONSECUTIVE_READ_FAILURES = 3;

// The roster read's bound: nothing in this transport aborts a stalled GET,
// so the flight settles at two poll windows and counts toward the trip —
// docs/thread-dispatches.md, "The read bound".
const READ_BOUND_MS = 2 * POLL_INTERVAL_MS;

const EMPTY_LEDGER: ReadonlyMap<number, ThreadDispatch> = new Map();

// The resume door's tool name. Local on purpose: a resume renders as a
// PLAIN tool call (grouping collapses dispatch_subagent alone), so the poll
// reads it off tool-call rows itself; a single-consumer constant lives
// here.
const RESUME_SUBAGENT_TOOL_NAME = "resume_subagent";

/** Whether any resume call on the transcript still awaits the ledger's
 *  truth — the read that DISCOVERS a resume row, since the ledger arm only
 *  keeps a poll alive once the row has been read. A resume receipt carries
 *  the new row's ORDINAL, so a landed receipt whose ordinal is absent from
 *  the map or maps to a still-dispatched row is the signal. A result that
 *  parses to no receipt has no join key and never pins the page to an
 *  indefinite poll; an already_settled receipt was answered in place. */
function aResumeAwaitsLedgerTruth(
  rows: readonly TranscriptRow[],
  ledger: ReadonlyMap<number, ThreadDispatch>,
): boolean {
  return rows.some((row) => {
    if (
      row.kind !== "tool-call" ||
      row.toolName !== RESUME_SUBAGENT_TOOL_NAME
    ) {
      return false;
    }
    const receipt = dispatchReceiptOf(row.result);
    if (receipt === null || receipt.outcome === "already_settled") {
      return false;
    }
    const dispatched = ledger.get(receipt.ordinal);
    return dispatched === undefined || dispatchIsRunning(dispatched);
  });
}

/** The chain's newest row for one child session: a resumed child has
 *  several ledger rows sharing its handle, and a per-session consumer (the
 *  drill-in panel) wants the child's CURRENT state — the highest ordinal,
 *  exactly what the backend's session-keyed fence answers. Linear over a
 *  per-thread map that is small by construction. */
function newestRowForSession(
  map: ReadonlyMap<number, ThreadDispatch>,
  childSessionId: string,
): ThreadDispatch | undefined {
  let newest: ThreadDispatch | undefined;
  for (const dispatch of map.values()) {
    if (dispatch.child_session_id !== childSessionId) {
      continue;
    }
    if (newest === undefined || dispatch.ordinal > newest.ordinal) {
      newest = dispatch;
    }
  }
  return newest;
}

/** Whether any coworker the TRANSCRIPT joins is still unsettled after the
 *  ledger's word. Transcript-joined rows ONLY, never a bare sweep of the
 *  ledger: a row nothing joins may be one nothing will ever settle (the
 *  backend's unreached-start refusal leaves its row DISPATCHED), and an
 *  entry with no receipt has no join key (the ORDINAL), so its frozen wire
 *  `running` renders as the wire says and the poll ignores it. The
 *  argument: docs/thread-dispatches.md, "The demand predicates". */
function anySubagentStillRunning(
  rows: readonly TranscriptRow[],
  ledger: ReadonlyMap<number, ThreadDispatch>,
): boolean {
  return rows.some(
    (row) =>
      row.kind === "subagent-group" &&
      row.entries.some(
        (entry) =>
          entry.receipt != null &&
          resolvedSubagentEntryOf(entry, ledger).running,
      ),
  );
}

interface LedgerRead {
  threadId: string;
  // Keyed by ORDINAL: the ask's identity — a resume chain shares
  // one child_session_id, so a session-keyed map would collapse it.
  // Per-session reads take the chain's NEWEST row instead.
  map: ReadonlyMap<number, ThreadDispatch>;
}

interface LedgerDemand {
  threadId: string;
  /** A delegation exists on the transcript at all — the one-shot read's
   *  trigger, so settled history still gets failed/error truth. */
  delegated: boolean;
  /** anySubagentStillRunning's answer — what keeps the timer armed. */
  stillMoving: boolean;
}

/** One session's shared dispatch-ledger read: the cell every mounted
 *  surface renders from, plus the demand-driven poll behind it. */
class ThreadDispatchLedger {
  readonly cell = new ObservableCell<LedgerRead | null>(null);

  private readonly demands = new Map<object, LedgerDemand>();
  private timer: number | null = null;
  private timerThreadId: string | null = null;
  // One request in flight at a time — a slow read must not stack a
  // second behind it when the interval fires.
  private busy = false;
  /** The thread the newest read (landed or in flight) was for — the
   *  one-shot's "already read" mark. A failed read whose thread never
   *  landed un-marks itself so a later demand change retries. */
  private readThreadId: string | null = null;
  /** A different thread asked while a read was in flight (a thread
   *  switch): remembered and retried once the flight ends — dropping it
   *  would strand a settled thread's one-shot read forever, since
   *  nothing else would re-trigger it. */
  private pendingThreadId: string | null = null;
  /** The persistent-failure trip's memory: which thread keeps failing,
   *  and how many times in a row. Reset by any success. */
  private failedThreadId: string | null = null;
  private consecutiveFailures = 0;

  constructor(private readonly session: TokenSession) {}

  /** Settle listeners: fired once per read that OBSERVES a dispatch
   *  settle — the signal that a delivery turn may be about to open.
   *  Plain callbacks, not a store dependency: the ledger stays
   *  session-only; the transcript hands its store method in. Invoked by
   *  VALUE through a Set, so N surfaces registering the same stable
   *  method collapse to one invocation per observed settle. */
  private readonly settleListeners = new Map<object, () => void>();

  setSettleListener(token: object, listener: (() => void) | null): void {
    if (listener === null) {
      this.settleListeners.delete(token);
    } else {
      this.settleListeners.set(token, listener);
    }
  }

  /** Pause listeners: fired once per read that OBSERVES a row paused —
   *  its request is on the dispatching turn's snapshot, so the store
   *  re-reads the conversation. Same shape as the settle relay. */
  private readonly pauseListeners = new Map<object, () => void>();

  setPauseListener(token: object, listener: (() => void) | null): void {
    if (listener === null) {
      this.pauseListeners.delete(token);
    } else {
      this.pauseListeners.set(token, listener);
    }
  }

  setDemand(token: object, demand: LedgerDemand | null): void {
    if (demand === null) {
      this.demands.delete(token);
    } else {
      this.demands.set(token, demand);
    }
    this._reconcile();
  }

  /** The settle tap: a child stream that watched its own ending asks the
   *  ledger to catch up NOW. Resolves once a read whose snapshot
   *  POSTDATES the tap has landed — or its bound fired. A busy tap chains
   *  ONE fresh read behind the flight (a joined flight may predate the
   *  settle); concurrent taps share it. docs/thread-dispatches.md. */
  refresh(threadId: string): Promise<void> {
    if (!this.busy) {
      return this._readOnce(threadId);
    }
    if (this.followUp === null || this.followUpThreadId !== threadId) {
      this.followUpThreadId = threadId;
      this.followUp = (this.flight ?? Promise.resolve()).then(() => {
        this.followUp = null;
        this.followUpThreadId = null;
        return this._readOnce(threadId);
      });
    }
    return this.followUp;
  }

  /** The one chained catch-up a busy settle tap queues (and shares). */
  private followUp: Promise<void> | null = null;
  private followUpThreadId: string | null = null;

  private _reconcile(): void {
    // Every surface renders the same store cells, so all demands name the
    // same thread; the union only genuinely varies on the booleans.
    let threadId: string | null = null;
    let delegated = false;
    let stillMoving = false;
    for (const demand of this.demands.values()) {
      threadId ??= demand.threadId;
      delegated ||= demand.delegated;
      stillMoving ||= demand.stillMoving;
    }
    // A parked switch is honored only while it is still the demanded
    // thread: the demand moving on invalidates it here, on the same change
    // that made it stale. Left standing, it would fire after the flight
    // lands and overwrite the demanded thread's fresh read with another's.
    if (this.pendingThreadId !== null && this.pendingThreadId !== threadId) {
      this.pendingThreadId = null;
    }
    if (threadId === null || !delegated) {
      this._stopTimer();
      return;
    }
    if (this.readThreadId !== threadId) {
      void this._readOnce(threadId);
    }
    if (!stillMoving) {
      this._stopTimer();
      return;
    }
    if (this.timer === null || this.timerThreadId !== threadId) {
      this._stopTimer();
      // Arming reads immediately — a coworker that just appeared (or a
      // thread switch mid-flight) must not wait a whole tick for its
      // first ledger word.
      void this._readOnce(threadId);
      this.timerThreadId = threadId;
      this.timer = window.setInterval(() => {
        void this._readOnce(threadId);
      }, POLL_INTERVAL_MS);
    }
  }

  private _sameAsCurrent(next: LedgerRead): boolean {
    const current = this.cell.get();
    if (current?.threadId !== next.threadId) {
      return false;
    }
    if (current.map.size !== next.map.size) {
      return false;
    }
    for (const [ordinal, dispatch] of next.map) {
      const held = current.map.get(ordinal);
      // label is authored at the open and never rewritten; status, error
      // and updated_at are everything a settle can move that any surface
      // reads. summary is deliberately not compared: no transcript
      // surface displays it, and its settle moves updated_at.
      if (
        held?.status !== dispatch.status ||
        held.error !== dispatch.error ||
        held.updated_at !== dispatch.updated_at
      ) {
        return false;
      }
    }
    return true;
  }

  private _stopTimer(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
      this.timerThreadId = null;
    }
  }

  private _readOnce(threadId: string): Promise<void> {
    if (this.busy) {
      // Same thread: the tick's normal single-flight skip, joining the
      // in-flight read (the settle tap never lands here — refresh()
      // chains a fresh read instead, since a joined flight's snapshot
      // may predate the settle). A DIFFERENT thread is a switch
      // mid-flight — park it for the finally below.
      if (threadId !== this.readThreadId) {
        this.pendingThreadId = threadId;
      }
      return this.flight ?? Promise.resolve();
    }
    this.busy = true;
    this.readThreadId = threadId;
    this.generation += 1;
    const generation = this.generation;
    // THE FLIGHT IS THE BOUNDED DEFERRED, NOT THE GET: every joiner holds
    // a hand-settled deferred that settles at READ_BOUND_MS even if the
    // GET never does; the generation retires a bounded-out read's DUTIES,
    // and any rejection releases busy through the live finally. Why, and
    // what breaks otherwise: docs/thread-dispatches.md.
    let settleFlight!: () => void;
    const flight = new Promise<void>((resolve) => {
      settleFlight = resolve;
    });
    this.flight = flight;
    window.setTimeout(() => {
      this._releaseBoundedOutRead(threadId, generation);
      settleFlight();
    }, READ_BOUND_MS);
    void this._read(threadId, generation, settleFlight);
    return flight;
  }

  /** The current in-flight read — what the busy path hands back. */
  private flight: Promise<void> | null = null;

  /** Mints per flight; bumped by a bound-out to retire the flight. A
   *  retired flight loses its DUTIES (busy, trip, replay — the bound
   *  performs them); its payload is arbitrated by adoptedThrough. */
  private generation = 0;

  /** The bound fired first: perform exactly the duties the dead flight's
   *  catch/finally may no longer perform — release busy, count the stall
   *  toward the trip, un-mark the one-shot, replay the parked switch. */
  private _releaseBoundedOutRead(threadId: string, generation: number): void {
    if (generation !== this.generation || !this.busy) {
      // The read settled inside the bound; this timer is a no-op.
      return;
    }
    this.generation += 1;
    this.busy = false;
    this.flight = null;
    // The stall counts toward the trip: a wedged endpoint must fail
    // closed after three bound-outs, not accrete one new wedged socket
    // per tick forever.
    this._noteReadFailure(threadId);
    this._replayParkedSwitch();
  }

  /** The trip's one accounting rule, shared by a settled failure and a
   *  bound-out. Count toward the same-thread streak; stop ONLY the timer
   *  the trip belongs to — a stale flight's failure landing after a switch
   *  must not kill the new thread's poll, since nothing would re-arm it;
   *  un-mark the one-shot only when this thread's truth never landed. */
  private _noteReadFailure(threadId: string): void {
    this.consecutiveFailures =
      this.failedThreadId === threadId ? this.consecutiveFailures + 1 : 1;
    this.failedThreadId = threadId;
    if (
      this.consecutiveFailures >= MAX_CONSECUTIVE_READ_FAILURES &&
      this.timerThreadId === threadId
    ) {
      this._stopTimer();
    }
    if (this.cell.get()?.threadId !== threadId) {
      this.readThreadId = null;
    }
  }

  /** A parked switch runs exactly once, and only for a thread the ended
   *  flight didn't just cover — never a bare reconcile, which would
   *  tight-loop with the failure path's un-mark. Shared by the live
   *  flight's finally and the bound-out. */
  private _replayParkedSwitch(): void {
    const pending = this.pendingThreadId;
    this.pendingThreadId = null;
    if (pending !== null && pending !== this.readThreadId) {
      void this._readOnce(pending);
    }
  }

  // ADOPTION IS MONOTONIC IN ISSUE ORDER: the newest generation whose
  // payload adopted. A retired flight's success still ADOPTS when
  // nothing newer has and the ledger's interest has not moved to another
  // thread — the bound retires a flight's DUTIES, never its truth. Both
  // failure directions: docs/thread-dispatches.md, "Adoption".
  private adoptedThrough = 0;

  private async _read(
    threadId: string,
    generation: number,
    settleFlight: () => void,
  ): Promise<void> {
    // A retired (bounded-out) flight has lost its DUTIES to the bound —
    // busy/flight release, the trip, the parked-switch replay all belong
    // to _releaseBoundedOutRead or a newer flight — but its payload is
    // arbitrated by adoptedThrough above, not discarded outright.
    const live = () => generation === this.generation;
    try {
      const dispatches = await listThreadDispatches(this.session, threadId);
      const adopts =
        live() ||
        (generation > this.adoptedThrough &&
          (this.readThreadId === threadId || this.readThreadId === null));
      if (!adopts) {
        // OUTRUN — fresher truth already adopted, or the interest moved to
        // another thread. Still proof the endpoint answers, so it clears
        // the trip's memory for its OWN thread only (a switch's stale
        // success must not launder the demanded thread's streak).
        if (this.failedThreadId === threadId) {
          this.failedThreadId = null;
          this.consecutiveFailures = 0;
        }
        return;
      }
      // A null readThreadId is the bound-out's un-mark of a one-shot
      // whose truth never landed; this landing IS that truth — re-mark
      // it, or the next demand change re-reads a thread the cell
      // already answers.
      this.readThreadId ??= threadId;
      this.adoptedThrough = generation;
      const previous = this.cell.get();
      const next: LedgerRead = {
        threadId,
        map: new Map(
          dispatches.map((dispatch) => [dispatch.ordinal, dispatch]),
        ),
      };
      // The cell's own invariant: publishers set only on real change. An
      // unchanged ledger must not notify — in exactly this feature's
      // window (turn ended, stream idle, a child still finishing) every
      // tick would otherwise re-render the whole transcript for nothing.
      if (!this._sameAsCurrent(next)) {
        this.cell.set(next);
      }
      this.failedThreadId = null;
      this.consecutiveFailures = 0;
      // After the cell moved, so a listener re-reading the map sees the
      // settle it is being told about.
      if (_observedASettle(previous, next)) {
        _fireEach(this.settleListeners);
      }
      if (_observedAPause(previous, next)) {
        _fireEach(this.pauseListeners);
      }
    } catch {
      if (!live()) {
        // The bound already counted this flight's failure and released;
        // its late rejection must not double-count nor trip a newer
        // thread's timer.
        return;
      }
      // Transient by stance: keep the last good read — the wire receipts
      // stay the honest fallback — and let the next tick retry. But only
      // transient: a PERSISTENT failure (revoked key, expired token, a gone
      // thread) never lands a map, so the frozen receipts would keep
      // stillMoving true forever; the trip fails closed and the next
      // demand change re-arms.
      this._noteReadFailure(threadId);
    } finally {
      if (live()) {
        this.busy = false;
        this.flight = null;
        // Settled inside the bound: resolve the flight's deferred. The
        // joiners run as microtasks AFTER this finally block, so the
        // parked-switch replay re-pointing this.flight is harmless —
        // settleFlight closes over THIS flight's resolver.
        settleFlight();
        this._replayParkedSwitch();
      }
    }
  }
}

function _fireEach(listeners: ReadonlyMap<object, () => void>): void {
  for (const listener of new Set(listeners.values())) {
    try {
      listener();
    } catch {
      // A listener's failure is never the read's (it would trip the
      // roster poll over a consumer bug) and must not rob the
      // listeners behind it.
    }
  }
}

/** Edge-triggered pause observation: a row now paused that the previous
 *  read of the SAME thread did not hold paused WITH THIS STAMP — or a
 *  first read that already holds one, since the request it names may
 *  postdate the conversation read the mount adopted. THE PREMISE: the
 *  ledger re-stamps updated_at on every row update (the table's
 *  set_updated_at trigger), and a coworker's second pause is two flips
 *  (paused → dispatched → paused) that can both land inside one poll
 *  window — status alone would read it as no edge, so the stamp is part of
 *  the observed identity. */
function _observedAPause(
  previous: LedgerRead | null,
  next: LedgerRead,
): boolean {
  const comparable = previous?.threadId === next.threadId ? previous : null;
  for (const [ordinal, dispatch] of next.map) {
    if (!dispatchIsPaused(dispatch)) {
      continue;
    }
    const held = comparable?.map.get(ordinal);
    if (
      held === undefined ||
      !dispatchIsPaused(held) ||
      held.updated_at !== dispatch.updated_at
    ) {
      return true;
    }
  }
  return false;
}

/** Edge-triggered settle observation: a row now terminal that the previous
 *  read of the SAME thread held as running — or had not seen at all
 *  (dispatched and settled inside one poll window fires exactly once). A first
 *  read or a thread switch is historical truth, never an observation. */
function _observedASettle(
  previous: LedgerRead | null,
  next: LedgerRead,
): boolean {
  if (previous?.threadId !== next.threadId) {
    return false;
  }
  for (const [ordinal, dispatch] of next.map) {
    if (dispatchIsRunning(dispatch)) {
      continue;
    }
    const held = previous.map.get(ordinal);
    if (held === undefined || dispatchIsRunning(held)) {
      return true;
    }
  }
  return false;
}

// Session-keyed on purpose: the provider registry resolves same-identity
// surfaces to ONE shared TokenSession, so this is exactly "one poll per
// conversation store". WeakMap — the ledger's lifetime is the session's.
const _ledgers = new WeakMap<TokenSession, ThreadDispatchLedger>();

function _ledgerFor(session: TokenSession): ThreadDispatchLedger {
  let ledger = _ledgers.get(session);
  if (ledger === undefined) {
    ledger = new ThreadDispatchLedger(session);
    _ledgers.set(session, ledger);
  }
  return ledger;
}

/**
 * The thread's dispatch rows keyed by ordinal — the ask's identity (a
 * resume chain shares one child_session_id) — shared across every surface
 * of one session. Reads once when a delegation appears, polls while any
 * join-keyed coworker is unsettled, and stops when the family settled, the
 * last surface unmounts, or nothing could be corrected. Transient failures
 * keep the last good map; a persistent one trips the cap (fail closed)
 * until a demand change re-arms. Thread-keyed: a switch reads as the empty
 * map until the new thread's first read lands. onDispatchSettled fires
 * once per read observing a settle on the demanded thread; pass a stable
 * identity — same-valued listeners collapse to one.
 */
export function useThreadDispatches(
  session: TokenSession,
  threadId: string | null,
  rows: readonly TranscriptRow[],
  onDispatchSettled?: () => void,
  onDispatchPaused?: () => void,
): ReadonlyMap<number, ThreadDispatch> {
  // Render-safe like the registry's entryFor: constructs only, never boots.
  const ledger = _ledgerFor(session);
  const read = useCell(ledger.cell);
  const map =
    read !== null && read.threadId === threadId ? read.map : EMPTY_LEDGER;

  const delegated = useMemo(
    () =>
      rows.some((row) => row.kind === "subagent-group") ||
      aResumeAwaitsLedgerTruth(rows, EMPTY_LEDGER),
    [rows],
  );
  const stillMoving = useMemo(
    () =>
      anySubagentStillRunning(rows, map) || aResumeAwaitsLedgerTruth(rows, map),
    [rows, map],
  );
  // This mount's demand key — identity only, safe to recreate (the
  // cleanup closure holds the same object it registered).
  const token = useMemo(() => ({}), []);

  useEffect(() => {
    if (threadId === null) {
      return;
    }
    ledger.setDemand(token, { threadId, delegated, stillMoving });
    return () => {
      ledger.setDemand(token, null);
    };
  }, [ledger, token, threadId, delegated, stillMoving]);

  // The settle relay's registration — its own effect, so a demand flip
  // never churns the listener registry. Detection runs only during
  // ledger reads, so an unmounted listener is simply never invoked
  // again.
  useEffect(() => {
    if (onDispatchSettled === undefined) {
      return;
    }
    ledger.setSettleListener(token, onDispatchSettled);
    return () => {
      ledger.setSettleListener(token, null);
    };
  }, [ledger, token, onDispatchSettled]);
  useEffect(() => {
    if (onDispatchPaused === undefined) {
      return;
    }
    ledger.setPauseListener(token, onDispatchPaused);
    return () => {
      ledger.setPauseListener(token, null);
    };
  }, [ledger, token, onDispatchPaused]);

  // The delivery marker's settle tap: a delivery divider proves its
  // ordinals SETTLED, so a joined ledger row still reading DISPATCHED is
  // stale by definition — ledger staleness, never the marker's liveness,
  // is the trigger, which keeps replayed history quiet (every read
  // postdates mount, so it already reads a historical settle as settled).
  // Empty or missing join: quiet. docs/thread-dispatches.md.
  const staleDeliveredOrdinals = useMemo(() => {
    const delivered = new Set<number>();
    for (const row of rows) {
      if (row.kind === "subagent-delivery") {
        for (const result of row.results) {
          delivered.add(result.ordinal);
        }
      }
    }
    return [...delivered]
      .filter((ordinal) => {
        const ledgerRow = map.get(ordinal);
        return ledgerRow !== undefined && dispatchIsRunning(ledgerRow);
      })
      .sort((a, b) => a - b)
      .join(",");
  }, [rows, map]);
  useEffect(() => {
    if (threadId !== null && staleDeliveredOrdinals !== "") {
      void ledger.refresh(threadId);
    }
  }, [ledger, threadId, staleDeliveredOrdinals]);

  return map;
}

/**
 * One coworker's ledger row, live, for the drill-in panel: the same
 * shared cell and demand-driven poll, but the demand is the panel's own —
 * a member can drill into a running child whose wire receipt never
 * streamed, and the transcript's rows-derived demand would not keep the
 * poll alive for it. refreshLedger is the settle tap: the panel's stream
 * watching its own ending must not wait a poll tick for the row to agree.
 */
export function useChildDispatch(
  session: TokenSession,
  threadId: string | null,
  childSessionId: string,
): {
  dispatch: ThreadDispatch | undefined;
  /** The settle tap. Resolves with the child's newest row AS THE
   *  CATCH-UP LANDED IT — the row a stream-end verdict judges against —
   *  or, when the read's bound fired, the last good snapshot; never
   *  rejects, so the judge always lands. */
  refreshLedger: () => Promise<ThreadDispatch | undefined>;
} {
  // Render-safe like the registry's entryFor: constructs only, never boots.
  const ledger = _ledgerFor(session);
  const read = useCell(ledger.cell);
  // The chain's NEWEST row for this session: the panel shows the
  // child's one extended transcript, and its current state is the
  // newest ask's — the backend's find_dispatch_for_parent_and_child
  // posture, mirrored.
  const dispatch =
    read !== null && read.threadId === threadId
      ? newestRowForSession(read.map, childSessionId)
      : undefined;

  const stillMoving = dispatch !== undefined && dispatchIsRunning(dispatch);
  const token = useMemo(() => ({}), []);
  useEffect(() => {
    if (threadId === null) {
      return;
    }
    // delegated: true — the panel only exists because a delegation did,
    // so the one-shot read must fire even before any group row rendered.
    ledger.setDemand(token, { threadId, delegated: true, stillMoving });
    return () => {
      ledger.setDemand(token, null);
    };
  }, [ledger, token, threadId, stillMoving]);

  const refreshLedger = useCallback(() => {
    // Read from the cell, not the render: the caller's verdict runs in a
    // promise callback, and the row THIS read landed is what it must
    // judge — a stale closure would judge the pre-settle row.
    const newestRow = () => {
      const now = ledger.cell.get();
      return now !== null && now.threadId === threadId
        ? newestRowForSession(now.map, childSessionId)
        : undefined;
    };
    if (threadId === null) {
      return Promise.resolve(newestRow());
    }
    return ledger.refresh(threadId).then(newestRow, newestRow);
  }, [ledger, threadId, childSessionId]);

  return { dispatch, refreshLedger };
}
