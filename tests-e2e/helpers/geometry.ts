// The shared geometry assertion vocabulary of the transcript visual
// contract (docs/transcript-visual-contract.md §6). Six lanes call
// these instead of copy-pasting measurement blocks. Every helper is
// font-independent (bounding boxes, never text metrics) and
// token-relative (indent steps are MEASURED from the DOM, never
// hard-coded pixels); the default tolerance absorbs sub-pixel rounding.

import { expect, type Locator, type Page } from "@playwright/test";

const DEFAULT_TOLERANCE_PX = 1;

/** How far the viewport sits above its own bottom — 0-ish means pinned. */
export const bottomGapOf = (viewport: Locator) =>
  viewport.evaluate(
    (element) =>
      element.scrollHeight - element.clientHeight - element.scrollTop,
  );

/** Two settled animation frames — the contract's measurement gate. */
export const settleTwoFrames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );

async function boxOf(subject: Locator) {
  const box = await subject.boundingBox();
  if (box === null) {
    throw new Error("the element under measurement has no box");
  }
  return box;
}

/** The left x-origin of every element the locator matches, in DOM order. */
export function xOriginsOf(items: Locator): Promise<number[]> {
  return items.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().x),
  );
}

/** All matched elements share one x-origin (a rail column). */
export async function expectSharedXOrigin(
  items: Locator,
  tolerancePx: number = DEFAULT_TOLERANCE_PX,
): Promise<void> {
  const origins = await xOriginsOf(items);
  expect(
    origins.length,
    "a shared-column assertion needs at least two elements",
  ).toBeGreaterThan(1);
  const [first, ...rest] = origins;
  for (const origin of rest) {
    expect(Math.abs(origin - first)).toBeLessThanOrEqual(tolerancePx);
  }
}

/** The subject begins at the given column x (e.g. technical detail under
 *  the label column, not the icon column). */
export async function expectStartsAtColumn(
  subject: Locator,
  columnX: number,
  tolerancePx: number = DEFAULT_TOLERANCE_PX,
): Promise<void> {
  const box = await boxOf(subject);
  expect(Math.abs(box.x - columnX)).toBeLessThanOrEqual(tolerancePx);
}

/** The card holds the same measure as the reference column: both edges
 *  inside it, and the width within one step of the reference's. */
export async function expectAlignedToMeasure(
  card: Locator,
  measure: Locator,
  tolerancePx: number = DEFAULT_TOLERANCE_PX,
): Promise<void> {
  const cardBox = await boxOf(card);
  const measureBox = await boxOf(measure);
  expect(cardBox.x).toBeGreaterThanOrEqual(measureBox.x - tolerancePx);
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(
    measureBox.x + measureBox.width + tolerancePx,
  );
  expect(Math.abs(cardBox.width - measureBox.width)).toBeLessThanOrEqual(
    tolerancePx,
  );
}

/** The child sits exactly one measured rail level right of the parent —
 *  no more (the one-hierarchy-level law). */
export function expectOneIndentLevel(
  parentX: number,
  childX: number,
  levelStepPx: number,
  tolerancePx: number = DEFAULT_TOLERANCE_PX,
): void {
  expect(Math.abs(childX - (parentX + levelStepPx))).toBeLessThanOrEqual(
    tolerancePx,
  );
}

/** The two elements' boxes never intersect (overlays vs composer). */
export async function expectNoOverlap(
  first: Locator,
  second: Locator,
): Promise<void> {
  const a = await boxOf(first);
  const b = await boxOf(second);
  const separated =
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y;
  expect(
    separated,
    `expected no overlap, got ${JSON.stringify(a)} vs ${JSON.stringify(b)}`,
  ).toBe(true);
}

/** Performing `action` must not move a scrolled-away reader — scrollTop
 *  holds through two settled frames. */
export async function expectScrollUndisturbed(
  page: Page,
  viewport: Locator,
  action: () => Promise<void>,
  tolerancePx: number = DEFAULT_TOLERANCE_PX,
): Promise<void> {
  const before = await viewport.evaluate((element) => element.scrollTop);
  await action();
  await settleTwoFrames(page);
  const after = await viewport.evaluate((element) => element.scrollTop);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(tolerancePx);
}

/** The x-origin of an element's CONTENT — where its ink actually starts.
 *  boundingBox() reads the border box, which padding does not move: an
 *  alignment law measured on boxes is a no-op against a padding
 *  regression (a negative control proved it live). A Range over the
 *  node's contents measures the laid-out content edge instead — still
 *  layout, not text metrics: the first box's left edge is the content
 *  origin regardless of font. */
export async function contentXOriginOf(subject: Locator): Promise<number> {
  return subject.evaluate((element) => {
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().x;
  });
}

/** The scenario clocks' shared "now" — the seed BOTH wrappers below
 *  anchor to, frozen or ticking: the user bubbles' timestamps render
 *  through a RECENCY window, so their labels are a function of the wall
 *  clock — a fixed-ISO stamp reads "Monday 7:19 PM" this week and "Sep 7,
 *  7:19 PM" a month later, which would rot every user-bubble baseline on
 *  schedule. Anchoring Date here makes the fixtures' fixed stamps render
 *  the same classification forever (the ticking regime holds it too:
 *  classification is calendar-day-scale, and this seed sits half a day
 *  from the nearest boundary). One day after the rhythm stamps: inside
 *  the window, so the ticket's reference form is what the baselines show. */
const SCENARIO_FIXED_NOW = new Date("2026-09-08T12:00:00Z");

/** openScenario with the clock FROZEN — for probes that assert a
 *  rendered time label at an exact instant, or that pose a clock which
 *  cannot elapse. The full caller set is a PINNED CENSUS in
 *  tvc-meta.test.ts, derived by a scan of every .ts under tests-e2e
 *  (helper modules included, this declaration pinned rather than
 *  excluded), so the wrapper's call sites cannot rot unseen — a direct
 *  page.clock call is outside that text scan, a stated limit the
 *  census records: TVC-146's three poses; TVC-148's pinned open
 *  (un-pinned mid-test to prove the flush); transcript.spec.ts's
 *  dated-register probe; TVC-190's negative control. DELIBERATELY not
 *  the default: a frozen Date disables
 *  use-stick-to-bottom's follow machinery outright (every follow it
 *  starts for itself waits on `Date.now() + 1 > Date.now()`, which
 *  never elapses — the TVC-120/123 jump-affordance probes went red
 *  under a blanket pin, measured, not theorized). The scenario
 *  captures do NOT use this: a capture under a frozen clock
 *  photographs "initial follow never ran", a state no production
 *  reader reaches — they open through openScenarioAtTickingNow
 *  instead. */
export async function openScenarioAtFixedNow(
  page: Page,
  name: string,
  options: Parameters<typeof openScenario>[2] = {},
): Promise<void> {
  await page.clock.setFixedTime(SCENARIO_FIXED_NOW);
  await openScenario(page, name, options);
}

/** The capture clock: a deterministic STARTING now with a
 *  live-ticking Date. setSystemTime seeds the same instant every run,
 *  so the recency-classified timestamp labels stay byte-stable — the
 *  classification is calendar-day-scale (core/time-labels.ts:
 *  startOfLocalDayMs against the weekday window; labels format the
 *  STAMP at minute granularity, and no sub-minute register exists), and
 *  the fixture stamps sit half a day from the nearest boundary, so the
 *  seconds a capture takes cannot recross a label. The tick is the
 *  point: use-stick-to-bottom's mount follow (wait: true — a 1ms
 *  budget) can elapse, so every overflowing list lands at its bottom,
 *  the state a production reader actually sees. Every SCENARIO capture
 *  opens through this; the bench pair (TVC-150/151 in
 *  transcript.spec.ts) is the deliberate remainder — it navigates the
 *  plain fixture page on the browser's real clock, already the ticking
 *  regime, and renders nothing clock-derived.
 *
 *  The TVC-190 gate RIDES this wrapper (round 2): a capture site cannot
 *  open ticking and forget the gate, because the open IS the gate. Hard
 *  where the pixel asserts are soft, deliberately — a capture taken
 *  while an overflowing list has not landed its follow photographs a
 *  state no reader reaches, so there is nothing worth reporting past
 *  it. The gate observes the OPEN — a capture that clicks content into
 *  existence afterwards must re-gate after settling, and tvc-meta scans
 *  for exactly that. tvc-meta pins the rest of the coverage claim:
 *  this body calls the gate; the capture spec opens frozen only in
 *  TVC-190's negative control and never through bare openScenario; and
 *  captures live only in the two files it pins, which bounds those
 *  scans' scope. */
export async function openScenarioAtTickingNow(
  page: Page,
  name: string,
  options: Parameters<typeof openScenario>[2] = {},
): Promise<void> {
  await page.clock.setSystemTime(SCENARIO_FIXED_NOW);
  await openScenario(page, name, options);
  await expectFollowedListsAtBottom(page);
}

/** The scenario surface — the root every scenario capture screenshots
 *  and every scroller reading queries under. One exported spelling;
 *  the capture spec and the TVC-190 gate both import it. */
export const SCENARIO_SURFACE = '[data-testid="scenario-surface"]';

/** The library's scroll viewport — StickToBottom.Content's scroller,
 *  the element ScrollFollowGuards' guard 1 observes and the TVC-190
 *  gate measures. ONE exported spelling, deliberately: the gate passes
 *  vacuously on an empty match, so a privately re-spelled copy that
 *  rots would turn it into a silent no-op. Everything that queries the
 *  scroller — the gate, its TVC-190 negative control, the
 *  scroll-follow-guards poses — imports this constant, so selector rot
 *  hits them all at once and TVC-190's precondition (at least two
 *  overflowing lists in the suspensions scene) goes red instead of the
 *  suite quietly measuring nothing. */
export const LIST_SCROLLER = "[data-tf-message-list] > div";

export interface ListScrollerReading {
  overflow: number;
  scrollTop: number;
  gap: number;
}

/** Every message-list scroller under `within`, read through the shared
 *  selectors — the ONE reader the TVC-190 gate's diagnostics and its
 *  negative control both call, so the control can never diverge from
 *  the gate it exists to falsify. Throws a named error if the surface
 *  is absent. */
export function readListScrollers(
  page: Page,
  within = SCENARIO_SURFACE,
): Promise<ListScrollerReading[]> {
  return page.evaluate(
    ({ within, scroller }) => {
      const root = document.querySelector(within);
      if (!root) {
        throw new Error(`no scenario surface matches ${within}`);
      }
      return ([...root.querySelectorAll(scroller)] as HTMLElement[]).map(
        (element) => ({
          overflow: element.scrollHeight - element.clientHeight,
          scrollTop: element.scrollTop,
          gap: element.scrollHeight - element.clientHeight - element.scrollTop,
        }),
      );
    },
    { within, scroller: LIST_SCROLLER },
  );
}

/** The capture gate (TVC-190): every StickToBottom scroller inside
 *  `within` whose content overflows (scrollHeight - clientHeight > 1,
 *  the scroll-follow-guards criterion) must rest within 1px of its
 *  bottom before a capture is taken. The gate is a live criterion, not
 *  a census — a scene with no overflow passes vacuously, and a scene
 *  that grows an overflowing list is enrolled by measurement, never by
 *  a hand-maintained list. TWO stated premises, both load-bearing:
 *  (1) no capture scene deliberately poses a message list parked
 *  mid-history (verified — no scenario writes
 *  scrollTop/scrollTo/scrollIntoView, and under the frozen clock every
 *  overflowing scroller read scrollTop 0, i.e. never-followed, not
 *  posed); a lane that adds a deliberately mid-history capture scene
 *  must rework this gate, not exempt itself quietly. (2) LIST_SCROLLER
 *  still matches the library's DOM — an empty match passes vacuously,
 *  which is why the selector has exactly one spelling and TVC-190's
 *  precondition is the committed control that reds on selector rot.
 *  Named error on timeout so a regression of the initial follow reads
 *  as itself, with per-scroller readings attached and the underlying
 *  rejection as the cause. */
export async function expectFollowedListsAtBottom(
  page: Page,
  within = SCENARIO_SURFACE,
  timeoutMs = 5_000,
): Promise<void> {
  try {
    await page.waitForFunction(
      // Self-contained by necessity: the predicate is serialized into
      // the page, so it cannot call readListScrollers — the selectors
      // are passed in (one spelling each, no rot seam) and only the
      // gap arithmetic is repeated here.
      ({ within, scroller }) => {
        const root = document.querySelector(within);
        if (!root) {
          return false;
        }
        const scrollers = [...root.querySelectorAll(scroller)] as HTMLElement[];
        return scrollers.every(
          (element) =>
            element.scrollHeight - element.clientHeight <= 1 ||
            element.scrollHeight - element.clientHeight - element.scrollTop <=
              1,
        );
      },
      { within, scroller: LIST_SCROLLER },
      { timeout: timeoutMs },
    );
  } catch (error) {
    // The named diagnosis presumes the timeout path; any other
    // rejection (a navigation, a closed page) rides along as the
    // cause rather than being swallowed — and the diagnostic read has
    // its own guard so it cannot throw over the original failure.
    let readings: ListScrollerReading[] | string;
    try {
      readings = await readListScrollers(page, within);
    } catch {
      readings = "unreadable — the page is gone or the surface never attached";
    }
    throw new Error(
      "capture follow-liveness gate (TVC-190): an overflowing message list " +
        "is not at its bottom — the initial follow did not run. " +
        `Per-scroller readings: ${JSON.stringify(readings)}`,
      { cause: error },
    );
  }
}

/** Open a fixture scenario (contract §5) and wait for its readiness
 *  gate. Scenarios with fenced code are gated by shiki instead — pass
 *  the expected settled count. */
export async function openScenario(
  page: Page,
  name: string,
  options: {
    theme?: "dark";
    reduceMotion?: boolean;
    shikiBlocks?: number;
  } = {},
): Promise<void> {
  const params = new URLSearchParams({ scenario: name });
  if (options.theme !== undefined) {
    params.set("theme", options.theme);
  }
  if (options.reduceMotion === true) {
    params.set("reduce-motion", "");
  }
  await page.goto(
    `http://127.0.0.1:8787/fixtures/transcript/?${params.toString()}`,
  );
  await expect(
    page.locator('[data-testid="scenario"][data-scenario-ready="true"]'),
  ).toBeAttached();
  if (options.shikiBlocks !== undefined) {
    await expect(page.locator("pre.shiki")).toHaveCount(options.shikiBlocks);
  }
}
