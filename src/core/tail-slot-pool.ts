// The live-tail budget. This is the sole copy:
// the dashboard's forked twin (and the parity test that held the two to
// one semantics) retired with the plan-run surface, the only dashboard
// host that ever tailed. Dependency-free on purpose: the widget's
// drill-in panel instantiates it with capacity 1 (one child stream
// beside the held-open parent stream and the dispatches poll).

// Each live tail is a full replay-then-tail SSE stream held open until
// the child settles, on the SAME API origin as the parent's own stream —
// and browsers cap HTTP/1.1 at six connections per origin. Three tails
// plus the parent stream leaves headroom for the dispatches poll and
// every ordinary read, whatever transport terminates the edge.
const MAX_LIVE_TAILS = 3;

/**
 * The live-tail budget. Consumers lease a slot by their OWN identity —
 * on this side the drill-in panel leases by its useId, one lease per
 * panel, never the child session id (two surfaces drilled into the same
 * child are two streams, and a shared key would collapse them into one
 * holder whose first release kills the survivor's tail) — idempotently,
 * so StrictMode's double effect is safe; the lease is released when the
 * stream ends or the panel closes. A consumer that finds the pool full
 * waits in arrival order: release() promotes the oldest waiter BEFORE
 * announcing, so a freed slot is genuinely handed on — a lease effect
 * only runs once per want-lifetime, and the promoted consumer learns it
 * holds through the store subscription, never through a re-run.
 */
export class TailSlotPool {
  private readonly holders = new Set<string>();
  // Denied leases, in arrival order. A waiter leaves the queue when its
  // row stops wanting (release covers both roles).
  private readonly waiters: string[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly capacity: number = MAX_LIVE_TAILS) {}

  /** An external-store subscription (useSyncExternalStore's shape), so a
   *  row re-reads its lease when any acquire/release moves the pool. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  holds = (leaseId: string): boolean => this.holders.has(leaseId);

  /** Whether this lease is queued behind a full pool — asked and DENIED,
   *  never merely not-yet-asked: the distinction any waiting copy must
   *  key on (an un-asked lease is not contention). */
  waiting = (leaseId: string): boolean => this.waiters.includes(leaseId);

  acquire(leaseId: string): boolean {
    if (this.holders.has(leaseId)) {
      return true;
    }
    if (this.holders.size >= this.capacity) {
      if (!this.waiters.includes(leaseId)) {
        this.waiters.push(leaseId);
        // Announce the enqueue: a denied consumer's snapshot must be
        // able to say "waiting", not just "not holding".
        this._emit();
      }
      return false;
    }
    this.holders.add(leaseId);
    this._emit();
    return true;
  }

  release(leaseId: string): void {
    const waiting = this.waiters.indexOf(leaseId);
    if (waiting !== -1) {
      this.waiters.splice(waiting, 1);
    }
    if (!this.holders.delete(leaseId)) {
      return;
    }
    // Hand the freed slot on before announcing: by the time subscribers
    // re-read their snapshots, the promoted row already holds.
    const promoted = this.waiters.shift();
    if (promoted !== undefined) {
      this.holders.add(promoted);
    }
    this._emit();
  }

  private _emit(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}
