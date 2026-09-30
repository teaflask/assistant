// Clock-time labels for the conversation surface: a user bubble
// carries its turn's created_at as "Monday 7:19 PM" inside the weekday
// label window and as a dated form ("Sep 7, 7:19 PM"; the year added once
// it differs from now's) outside it — a bare weekday re-read weeks later
// reads as THIS past weekday. The recency rule is the thread list's own
// (RECENT_WINDOW_DAYS and the DST-safe startOfLocalDayMs — one spelling,
// never two); the weekday LABEL bound is one day tighter. A clock reading,
// not a cost — distinct from segment-timing's DURATION register. Unparsable
// → null (the caller renders nothing); a future stamp reads as recent.

/** The thread list's recency window (calendar days), shared verbatim. */
export const RECENT_WINDOW_DAYS = 7;

/** The weekday LABEL's own bound: seven unique weekday names, so seven
 *  calendar days — D-6 … D0. Deliberately NOT derived from
 *  RECENT_WINDOW_DAYS: the bucket heading may widen, but a wider weekday
 *  window would re-admit the D-7 collision (a week-old stamp, today's name). */
const WEEKDAY_LABEL_DAYS_BACK = 6;

/** A local midnight counted back in CALENDAR days, not 24-hour blocks: on
 *  the two days a year the clocks move, yesterday is 23 or 25 hours long,
 *  and fixed-day subtraction would slide every boundary. The Date
 *  constructor normalises an out-of-range day across months and years. */
export function startOfLocalDayMs(now: Date, daysBack: number): number {
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - daysBack,
  ).getTime();
}

// Module-cached: Intl.DateTimeFormat construction is the expensive
// half, and every bubble in a long transcript formats through these.
let recentFormat: Intl.DateTimeFormat | null = null;
let datedFormat: Intl.DateTimeFormat | null = null;
let datedWithYearFormat: Intl.DateTimeFormat | null = null;
let fullFormat: Intl.DateTimeFormat | null = null;

export interface ConversationalTime {
  /** "Monday 7:19 PM" inside the weekday label window; "Sep 7,
   *  7:19 PM" outside it ("Sep 7, 2025, 7:19 PM" across a year
   *  boundary). */
  label: string;
  /** "September 7, 2026 at 7:19 PM" (locale-shaped) — the <time>
   *  title's full spelling. */
  full: string;
}

export function conversationalTimeOf(
  iso: string,
  nowMs: number = Date.now(),
): ConversationalTime | null {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return null;
  }
  const date = new Date(parsed);
  const now = new Date(nowMs);
  fullFormat ??= new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
    timeStyle: "short",
  });
  const full = fullFormat.format(date);
  // Inside the weekday label window (future included — recent, honestly):
  // the register's own cap, never arithmetic on the bucket constant (D-7).
  if (parsed >= startOfLocalDayMs(now, WEEKDAY_LABEL_DAYS_BACK)) {
    recentFormat ??= new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
    });
    return { label: recentFormat.format(date), full };
  }
  if (date.getFullYear() === now.getFullYear()) {
    datedFormat ??= new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    return { label: datedFormat.format(date), full };
  }
  datedWithYearFormat ??= new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return { label: datedWithYearFormat.format(date), full };
}
