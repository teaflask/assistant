// A settled run means the thread's REST truth moved (busy flag, turn
// statuses, maybe the title). Full replays settle every historical run in
// a burst, so the re-read waits out the burst.
export const SETTLE_REFRESH_DELAY_MS = 400;

/**
 * The settle re-read's debounce: every settled run re-arms one timer, and
 * the re-read fires once the burst has been quiet for
 * SETTLE_REFRESH_DELAY_MS. What a settle refreshes is the owner's
 * (`onSettle`): the widget store re-reads the thread, the history list and
 * the funding gate; the playground hook re-reads the thread and
 * invalidates its thread-list query. The timing policy lives here, once.
 */
export class SettleRefreshScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly onSettle: () => void) {}

  noteRunSettled(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onSettle();
    }, SETTLE_REFRESH_DELAY_MS);
  }

  dispose(): void {
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
