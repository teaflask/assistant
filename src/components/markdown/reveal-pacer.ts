// Streamed assistant text arrives in poll-sized lumps (the backend tails
// persisted rows on a fixed interval), so painting each arrival whole
// reads as chunky. The pacer buffers arrivals and reveals characters at a
// rate calibrated to empty the buffer just as the next chunk is expected —
// the expectation an EWMA over observed inter-arrival gaps, clamped so a
// long silence cannot teach a crawl nor a burst a flash. Clock-injected
// and DOM-free so the math is testable with explicit timestamps.

/** The backend tail-poll interval — the correct prior before evidence. */
const NOMINAL_GAP_MS = 400;
/** ~90% converged after ~7 chunks if the cadence shifts; one outlier
 *  moves the estimate at most 30%. */
const GAP_EWMA_ALPHA = 0.3;
const MIN_GAP_MS = 120;
const MAX_GAP_MS = 1500;
/** Gaps below this are frames of the same poll lump — a mounted replay
 *  delivers its whole backlog this way. Revealed instantly, never taught
 *  to the EWMA, so a replay cannot poison the expectation into a flash. */
const BURST_GAP_MS = 50;
/** 80 chars/s: a small buffer finishes early and dry-waits honestly
 *  instead of crawling below reading speed. */
const MIN_RATE_CHARS_PER_MS = 0.08;
/** 4000 chars/s: beyond visual distinction from instant, and bounds the
 *  per-frame markdown re-parse churn a huge chunk could cause. */
const MAX_RATE_CHARS_PER_MS = 4;
/** Terminal flush is constant-time: a 40-char and a 400-char tail both
 *  finish in 200ms, so short tails don't lurch and long tails don't
 *  typewriter an answer the server already completed. */
const DRAIN_MS = 200;

export class RevealPacer {
  private arrived: number;
  /** Fractional revealed length at `committedAt`; advances at `ratePerMs`. */
  private position: number;
  private committedAt: number;
  private ratePerMs = 0;
  private expectedGapMs = NOMINAL_GAP_MS;
  private lastArrivalAt: number;
  /** False until the first real (non-burst) gap: the mount-burst window,
   *  where everything reveals instantly. */
  private calibrated = false;
  private instant = false;

  constructor(arrivedLength: number, nowMs: number) {
    this.arrived = arrivedLength;
    this.position = arrivedLength;
    this.committedAt = nowMs;
    this.lastArrivalAt = nowMs;
  }

  observe(arrivedLength: number, nowMs: number): void {
    if (this._arrivalShrankBelowRevealed(arrivedLength, nowMs)) {
      this.arrived = arrivedLength;
      this.revealInstantly();
      return;
    }
    this._commitRevealedAt(nowMs);
    const gapMs = nowMs - this.lastArrivalAt;
    this.lastArrivalAt = nowMs;
    this.arrived = arrivedLength;
    if (this.instant || this._isStillInTheMountBurst(gapMs)) {
      this.position = arrivedLength;
      return;
    }
    this.calibrated = true;
    if (gapMs >= BURST_GAP_MS) {
      this._foldGapIntoExpectation(gapMs);
    }
    this.ratePerMs = _clamp(
      (this.arrived - this.position) / this.expectedGapMs,
      MIN_RATE_CHARS_PER_MS,
      MAX_RATE_CHARS_PER_MS,
    );
  }

  /** The stream is over (finished, cancelled, parked or superseded):
   *  stop gap-calibrated withholding and sweep the remainder within
   *  DRAIN_MS. Never decelerates an already-faster reveal. */
  beginDrain(nowMs: number): void {
    if (this.instant) {
      return;
    }
    this._commitRevealedAt(nowMs);
    const remaining = this.arrived - this.position;
    if (remaining <= 0) {
      return;
    }
    this.ratePerMs = Math.max(this.ratePerMs, remaining / DRAIN_MS);
  }

  revealInstantly(): void {
    this.instant = true;
    this.position = this.arrived;
    this.ratePerMs = 0;
  }

  revealedLength(nowMs: number): number {
    const advanced =
      this.position + this.ratePerMs * Math.max(0, nowMs - this.committedAt);
    return Math.min(this.arrived, Math.floor(advanced));
  }

  isCaughtUp(nowMs: number): boolean {
    return this.revealedLength(nowMs) >= this.arrived;
  }

  private _arrivalShrankBelowRevealed(
    arrivedLength: number,
    nowMs: number,
  ): boolean {
    return arrivedLength < this.revealedLength(nowMs);
  }

  private _isStillInTheMountBurst(gapMs: number): boolean {
    return !this.calibrated && gapMs < BURST_GAP_MS;
  }

  private _foldGapIntoExpectation(gapMs: number): void {
    const taught = _clamp(gapMs, MIN_GAP_MS, MAX_GAP_MS);
    this.expectedGapMs =
      GAP_EWMA_ALPHA * taught + (1 - GAP_EWMA_ALPHA) * this.expectedGapMs;
  }

  private _commitRevealedAt(nowMs: number): void {
    this.position = Math.min(
      this.arrived,
      this.position + this.ratePerMs * Math.max(0, nowMs - this.committedAt),
    );
    this.committedAt = nowMs;
  }
}

function _clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
