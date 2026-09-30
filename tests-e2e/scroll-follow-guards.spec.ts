/**
 * ScrollFollowGuards' shrink re-follow laws (TVC-146…149 in
 * tests/tvc/registry.ts). DOM assertions only, deliberately: no
 * toHaveScreenshot, so this spec adds no pixel baselines.
 *
 * Guard 1 re-lands a follower when the viewport shrinks under them (a
 * composer growing, a virtual keyboard). The library's stale-flag
 * hole: its isAtBottom initialises true and is only made honest by its
 * follow machinery, and every follow the library starts for itself
 * carries wait:true, whose gate is `Date.now() + 1 > Date.now()` —
 * under a pinned clock (the page TVC-146's poses still run on) that
 * never elapses, so the flag sits stale-true with the reader at the
 * top and a transient viewport shrink teleported them to the bottom,
 * stably. Geometry cannot tell that reader from a genuine follower
 * whose content fit the viewport (both read scrollTop 0 with no gap),
 * and a follow call's settlement cannot either (the escape bail
 * settles one without the wait ever elapsing) — so the guard proves
 * liveness by observing the CLOCK itself across frames, and remembers
 * a shrink that beats the proof.
 *
 * The clock split is the contract. TVC-146 poses the page where follow
 * cannot complete: no re-land is ever safe there, in any of its three
 * reachable shapes. TVC-147…149 pose the product on a live clock: the
 * guard's designed re-landing must be untouched, including the
 * fit-content band that TVC-141 and TVC-124 never pose (both start
 * from an already-overflowing viewport). Positive re-landings are
 * asserted with expect.poll over the bottom gap — frames, never wall
 * time; fixed sleeps appear only inside the negative law, as
 * observation windows for "nothing may move".
 */
import { expect, test } from "@playwright/test";

import {
  bottomGapOf,
  LIST_SCROLLER,
  openScenario,
  openScenarioAtFixedNow,
} from "./helpers/geometry";

// The suspensions scenario carries two message lists whose content
// overflows their viewports and one whose content fits — the
// composition the flake fired in.
const PALETTE = { width: 672, height: 1400 };

/** Marker the in-page setup pins on the scroller under test so the
 *  test-side polls address exactly the element the pose manipulated. */
const PROBE = "[data-shrink-refollow-probe]";

test.describe("the shrink re-follow (guard 1)", () => {
  test("TVC-146 under a pinned clock the shrink re-follow never moves a reader — transient shrink, content-fit shrink, and the escape-bail re-arm", async ({
    page,
  }) => {
    await page.setViewportSize(PALETTE);

    // Pose 1 — the wild flake itself: a transient 4px shrink-and-regain
    // (what a late layout pass in the composer/shelf column does to the
    // flex-1 list; 4px reproduced 93% of the real artifact's deviation).
    await openScenarioAtFixedNow(page, "suspensions");
    const transient = await page.evaluate(
      async ({ selector }) => {
        const wait = (ms: number) =>
          new Promise((resolve) => setTimeout(resolve, ms));
        const scrollers = [...document.querySelectorAll(selector)].filter(
          (el) => el.scrollHeight - el.clientHeight > 1,
        ) as HTMLElement[];
        const before = scrollers.map((el) => el.scrollTop);
        const heightsBefore = scrollers.map((el) => el.clientHeight);
        for (const el of scrollers) {
          el.style.height = `${String(el.getBoundingClientRect().height - 4)}px`;
        }
        await wait(100);
        const during = scrollers.map((el) => el.scrollTop);
        const heightsDuring = scrollers.map((el) => el.clientHeight);
        for (const el of scrollers) {
          el.style.height = "100%";
        }
        await wait(100);
        const after = scrollers.map((el) => el.scrollTop);
        return {
          count: scrollers.length,
          before,
          during,
          after,
          heightsBefore,
          heightsDuring,
        };
      },
      { selector: LIST_SCROLLER },
    );
    // The scene must still carry the overflowing composition, and the
    // shrink must have actually landed in the viewport heights — a pose
    // whose stimulus silently stops posing must read as exactly that,
    // never as a green negative.
    expect(transient.count).toBeGreaterThanOrEqual(2);
    for (const [i, h] of transient.heightsDuring.entries()) {
      expect(h).toBeLessThanOrEqual(transient.heightsBefore[i] - 3);
    }
    expect(transient.before).toEqual(transient.before.map(() => 0));
    expect(transient.during).toEqual(transient.before);
    expect(transient.after).toEqual(transient.before);

    // Pose 2 — the wild sequence's timing: the shelf column's on-demand
    // chunks shrink a list viewport that until then FIT its content.
    await openScenarioAtFixedNow(page, "suspensions");
    const contentFit = await page.evaluate(
      async ({ selector }) => {
        const wait = (ms: number) =>
          new Promise((resolve) => setTimeout(resolve, ms));
        const el = [...document.querySelectorAll(selector)].find(
          (candidate) => candidate.scrollHeight - candidate.clientHeight > 1,
        );
        if (!(el instanceof HTMLElement)) {
          throw new Error("the suspensions scene carries no overflowing list");
        }
        const before = el.scrollTop;
        const heightBefore = el.clientHeight;
        el.style.height = `${String(el.scrollHeight)}px`;
        await wait(100);
        const overflowAtFit = el.scrollHeight - el.clientHeight;
        const heightAtFit = el.clientHeight;
        el.style.height = "100%";
        await wait(100);
        return {
          before,
          after: el.scrollTop,
          heightBefore,
          overflowAtFit,
          heightAtFit,
          heightRestored: el.clientHeight,
        };
      },
      { selector: LIST_SCROLLER },
    );
    // The stimulus: the grow genuinely reached content-fit, and the
    // restore genuinely shrank the viewport back into overflow.
    expect(contentFit.overflowAtFit).toBeLessThanOrEqual(1);
    expect(contentFit.heightAtFit).toBeGreaterThan(
      contentFit.heightBefore + 50,
    );
    expect(contentFit.heightRestored).toBeLessThan(contentFit.heightAtFit - 50);
    expect(contentFit.before).toBe(0);
    expect(contentFit.after).toBe(0);

    // Pose 3 — the escape-bail re-arm: a settled follow call is not
    // proof. The escape settles the parked mount follow through its
    // bail without the wait ever elapsing; the re-engage marks the
    // reader following again with clock-independent writes; content
    // growth the parked-dead follow cannot chase leaves isAtBottom
    // stale-true 200px above the bottom. A re-land on the shrink here
    // would be the teleport.
    await openScenarioAtFixedNow(page, "suspensions");
    const bail = await page.evaluate(
      async ({ selector }) => {
        const wait = (ms: number) =>
          new Promise((resolve) => setTimeout(resolve, ms));
        const el = [...document.querySelectorAll(selector)].find(
          (candidate) => candidate.scrollHeight - candidate.clientHeight > 1,
        );
        if (!(el instanceof HTMLElement)) {
          throw new Error("the suspensions scene carries no overflowing list");
        }
        el.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: -40,
            deltaX: 0,
            bubbles: true,
            cancelable: true,
          }),
        );
        await wait(100);
        el.scrollTop = el.scrollHeight;
        await wait(100);
        const atBottom = el.scrollTop;
        const content = el.firstElementChild;
        if (!(content instanceof HTMLElement)) {
          throw new Error("the overflowing list has no content element");
        }
        const spacer = document.createElement("div");
        spacer.style.height = "200px";
        content.appendChild(spacer);
        await wait(100);
        const gapBeforeShrink =
          el.scrollHeight - el.scrollTop - el.clientHeight;
        el.style.height = `${String(el.getBoundingClientRect().height - 4)}px`;
        await wait(100);
        const during = el.scrollTop;
        el.style.height = "100%";
        await wait(100);
        return { atBottom, gapBeforeShrink, during, after: el.scrollTop };
      },
      { selector: LIST_SCROLLER },
    );
    // The stale band must actually be posed, or the shrink asserts
    // nothing.
    expect(bail.gapBeforeShrink).toBeGreaterThan(150);
    expect(bail.during).toBe(bail.atBottom);
    expect(bail.after).toBe(bail.atBottom);
  });

  test("TVC-147 a genuine follower whose content fit the viewport is re-landed when the shrink creates the overflow", async ({
    page,
  }) => {
    await page.setViewportSize(PALETTE);
    await openScenario(page, "suspensions");
    // The fit-content band TVC-141 and TVC-124 never pose, on a page
    // where the follow machinery is alive: a list whose content NEVER
    // overflowed (the reader was watching the whole conversation, never
    // scrolled, never escaped) shrinks into overflow — a composer
    // auto-grow or a virtual keyboard at short-transcript scale. The
    // follower must be taken down with the tail, not stranded at the
    // top with the newest rows below the fold and no jump affordance.
    await page.evaluate(
      ({ selector }) => {
        const el = [...document.querySelectorAll(selector)].find(
          (candidate) =>
            candidate.scrollHeight - candidate.clientHeight <= 1 &&
            candidate.clientHeight > 200,
        );
        if (!(el instanceof HTMLElement)) {
          throw new Error(
            "the suspensions scene carries no content-fit list to shrink",
          );
        }
        const content = el.firstElementChild;
        if (!(content instanceof HTMLElement)) {
          throw new Error("the content-fit list has no content element");
        }
        // The shrink is sized from the MEASURED content, not a
        // constant, and a scene that can no longer pose the band throws
        // here — a missing stimulus must never read as a guard
        // regression.
        const contentHeight = content.getBoundingClientRect().height;
        if (contentHeight < 150) {
          throw new Error(
            `the content-fit list's content is only ${String(Math.round(contentHeight))}px tall — too short to pose the band`,
          );
        }
        el.setAttribute("data-shrink-refollow-probe", "");
        el.style.height = `${String(Math.max(40, Math.floor(contentHeight) - 120))}px`;
      },
      { selector: LIST_SCROLLER },
    );
    const probe = page.locator(PROBE);
    // First the stimulus (the shrink actually created the overflow),
    // then the law (the follower was taken down with the tail).
    await expect
      .poll(() => probe.evaluate((el) => el.scrollHeight - el.clientHeight), {
        timeout: 5_000,
      })
      .toBeGreaterThan(99);
    await expect
      .poll(() => bottomGapOf(probe), { timeout: 5_000 })
      .toBeLessThanOrEqual(1);
    expect(await probe.evaluate((el) => el.scrollTop)).toBeGreaterThan(10);
  });

  test("TVC-148 a shrink that beats the liveness proof is re-landed when the clock proves live, never dropped", async ({
    page,
  }) => {
    await page.setViewportSize(PALETTE);
    // Opened pinned so the proof is still pending — and with the
    // library's parked mount follow deliberately SETTLED first (the
    // escape bails it; the drag back to the bottom re-engages through
    // no-wait paths that complete even under the pin). After that there
    // is no in-flight follow call left to recover a dropped shrink on
    // clock-resume, so this leg fails against a guard whose memory is
    // ablated: only the remembered shrink can land the reader.
    await openScenarioAtFixedNow(page, "suspensions");
    const posed = await page.evaluate(
      async ({ selector }) => {
        const wait = (ms: number) =>
          new Promise((resolve) => setTimeout(resolve, ms));
        const el = [...document.querySelectorAll(selector)].find(
          (candidate) => candidate.scrollHeight - candidate.clientHeight > 1,
        );
        if (!(el instanceof HTMLElement)) {
          throw new Error("the suspensions scene carries no overflowing list");
        }
        el.setAttribute("data-shrink-refollow-probe", "");
        el.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: -40,
            deltaX: 0,
            bubbles: true,
            cancelable: true,
          }),
        );
        await wait(100);
        el.scrollTop = el.scrollHeight;
        await wait(100);
        const atBottom = el.scrollTop;
        // The shrink, while the proof is still pending.
        el.style.height = `${String(el.getBoundingClientRect().height - 100)}px`;
        await wait(100);
        return { atBottom };
      },
      { selector: LIST_SCROLLER },
    );
    await page.clock.setSystemTime(new Date("2026-09-08T13:00:00Z"));
    const probe = page.locator(PROBE);
    await expect
      .poll(() => bottomGapOf(probe), { timeout: 5_000 })
      .toBeLessThanOrEqual(1);
    expect(await probe.evaluate((el) => el.scrollTop)).toBeGreaterThan(
      posed.atBottom,
    );
  });

  test("TVC-149 a bottom-following reader is re-landed when the viewport shrinks", async ({
    page,
  }) => {
    await page.setViewportSize(PALETTE);
    await openScenario(page, "suspensions");
    await page.evaluate(
      ({ selector }) => {
        const el = [...document.querySelectorAll(selector)].find(
          (candidate) => candidate.scrollHeight - candidate.clientHeight > 1,
        );
        if (!(el instanceof HTMLElement)) {
          throw new Error("the suspensions scene carries no overflowing list");
        }
        el.setAttribute("data-shrink-refollow-probe", "");
        // The reader reads at the bottom (a real scroll, so the
        // library's own bookkeeping marks them following).
        el.scrollTop = el.scrollHeight;
      },
      { selector: LIST_SCROLLER },
    );
    const probe = page.locator(PROBE);
    await expect
      .poll(() => bottomGapOf(probe), { timeout: 5_000 })
      .toBeLessThanOrEqual(1);
    await probe.evaluate((el) => {
      (el as HTMLElement).style.height =
        `${String(el.getBoundingClientRect().height - 4)}px`;
    });
    // Without guard 1 the shrink would leave a 4px gap; the guard's
    // designed re-landing keeps the follower at the bottom.
    await expect
      .poll(() => bottomGapOf(probe), { timeout: 5_000 })
      .toBeLessThanOrEqual(1);
  });
});
