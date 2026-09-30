/**
 * The transcript's browser contracts: the Linux-only screenshot
 * bench, plus cross-platform interaction probes whose geometry is
 * independent of font rasterization.
 */
import os from "node:os";

import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  bottomGapOf,
  openScenario,
  openScenarioAtFixedNow,
  settleTwoFrames,
} from "./helpers/geometry";

const SCREENSHOTS_UNAVAILABLE = os.platform() !== "linux";

const BENCH = '[data-testid="bench-gallery"]';

test.describe("the transcript screenshot regression", () => {
  test.skip(
    SCREENSHOTS_UNAVAILABLE,
    "screenshot baselines are Linux (CI) renders — regenerate via the Playwright container",
  );

  test.beforeEach(async ({ page }) => {
    await page.goto("http://127.0.0.1:8787/fixtures/transcript/");
    // Belt and braces beside the config's animations:"disabled" — the
    // package's own reduced-motion switch collapses the dots and shimmer.
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-reduce-motion", "true");
    });
    await expect(
      page.getByRole("heading", { name: "Steeping sencha" }).first(),
    ).toBeVisible();
    // The fenced code blocks upgrade in place when shiki's lazy chunk
    // lands (markdown/code-block.tsx) — 26px shorter per block once
    // highlighted. toHaveScreenshot's stabilization absorbs the settle on
    // a fast box, but a slow runner can land two consecutive mid-settle
    // captures that agree with each other and disagree with the settled
    // baseline by 52px (both blocks). Gate the capture on the settled
    // state: the canned content renders the kitchen-sink markdown's one
    // fenced block twice (the gallery slot and the full-transcript flow).
    await expect(page.locator("pre.shiki")).toHaveCount(2);
  });

  test("TVC-150 the transcript components render in the adopted register", async ({
    page,
  }) => {
    await expect
      .soft(page.locator(BENCH))
      .toHaveScreenshot("transcript-light.png");
  });

  test("TVC-151 dark mode keeps the same structure and contrast", async ({
    page,
  }) => {
    await page.getByLabel("dark", { exact: true }).check();
    await expect
      .soft(page.locator(BENCH))
      .toHaveScreenshot("transcript-dark.png");
  });
});

test("transcript disclosure chevrons reveal on hover and stay visible while open", async ({
  page,
}) => {
  await openScenario(page, "rhythm");
  const fold = page.locator("[data-tf-activity-group] > details").first();
  const foldSummary = fold.locator(":scope > summary");
  const foldChevron = foldSummary.locator(":scope > svg");

  await expect(fold).not.toHaveAttribute("open", "");
  await expect(foldChevron).toHaveCSS("opacity", "0");
  await foldSummary.hover();
  await expect(foldChevron).toHaveCSS("opacity", "1");
  await foldSummary.click();
  await page.mouse.move(0, 0);
  await expect(fold).toHaveAttribute("open", "");
  await expect(foldChevron).toHaveCSS("opacity", "1");

  const operation = fold.locator("[data-tf-activity-rail] details").first();
  const operationSummary = operation.locator(":scope > summary");
  const operationChevron = operationSummary.locator(":scope > svg");
  await expect(operationChevron).toHaveCSS("opacity", "0");
  await operationSummary.hover();
  await expect(operationChevron).toHaveCSS("opacity", "1");
  await operationSummary.click();
  await page.mouse.move(0, 0);
  await expect(operation).toHaveAttribute("open", "");
  await expect(operationChevron).toHaveCSS("opacity", "1");
});

test("TVC-042 a closed activity fold keeps its rail in the DOM but out of layout", async ({
  page,
}) => {
  await openScenario(page, "rhythm");
  const fold = page.locator("[data-tf-activity-group] > details").first();
  const summary = fold.locator(":scope > summary");
  const contentDisplay = () =>
    fold.evaluate(
      (details) => getComputedStyle(details, "::details-content").display,
    );

  // The closed-disclosure rule (styles.css): a closed transcript details'
  // ::details-content box computes to display:none, so its nested rail
  // holds no layout box; the rail stays mounted, and the native open
  // attribute re-admits the box.
  await expect(fold).not.toHaveAttribute("open");
  await expect(fold.locator("[data-tf-activity-rail]")).toHaveCount(1);
  await expect.poll(contentDisplay).toBe("none");

  await summary.click();
  await expect(fold).toHaveAttribute("open", "");
  await expect.poll(contentDisplay).not.toBe("none");
  await expect(fold.locator("[data-tf-activity-rail]")).toBeVisible();

  await summary.click();
  await expect(fold).not.toHaveAttribute("open");
  await expect.poll(contentDisplay).toBe("none");
});

test("TVC-140 a giant approval arriving late lands its footer in the viewport", async ({
  page,
}) => {
  await page.goto(
    "http://127.0.0.1:8787/fixtures/transcript/?late-approval-probe",
  );
  await page.getByRole("button", { name: "Render giant approval" }).click();
  await expect(page.getByRole("button", { name: "Approve" })).toBeAttached();

  const metrics = await page.evaluate(
    () =>
      new Promise<{
        bottomGap: number;
        approveBottom: number;
        viewportBottom: number;
      }>((resolve, reject) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const log = document.querySelector<HTMLElement>('[role="log"]');
            const viewport = log?.firstElementChild;
            const approve = Array.from(
              log?.querySelectorAll("button") ?? [],
            ).find((button) => button.textContent.trim() === "Approve");
            if (!(viewport instanceof HTMLElement) || approve === undefined) {
              reject(new Error("the late approval probe did not render"));
              return;
            }
            resolve({
              bottomGap:
                viewport.scrollHeight -
                viewport.clientHeight -
                viewport.scrollTop,
              approveBottom: approve.getBoundingClientRect().bottom,
              viewportBottom: viewport.getBoundingClientRect().bottom,
            });
          });
        });
      }),
  );

  expect(metrics.bottomGap).toBeLessThanOrEqual(1);
  expect(metrics.approveBottom).toBeLessThanOrEqual(metrics.viewportBottom);
  await expect(
    page.getByRole("button", { name: "Scroll to bottom" }),
  ).toHaveCount(0);

  // Instant is only the followed-resize behavior. Once the visitor moves
  // into scrollback, a second large card resize must not drag them away
  // from what they are reading.
  const viewport = page.locator('[role="log"] > div').first();
  await viewport.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(
    page.getByRole("button", { name: "Scroll to bottom" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Grow approval more" }).click();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );

  expect(await viewport.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(
    page.getByRole("button", { name: "Scroll to bottom" }),
  ).toBeVisible();
});

// The follow-contract probes. The library observes only its content
// element and swallows most escape gestures while a resize is in flight,
// so each probe manufactures the exact adversarial condition: a viewport
// shrink with no content change, and escapes attempted while content
// grows every frame.

const GUARDS_PROBE_URL =
  "http://127.0.0.1:8787/fixtures/transcript/?scroll-guards-probe";

// Shared preamble: land on the probe, wait out shiki's in-place upgrade
// (a 26px content shrink that must not straddle a measurement), confirm
// the transcript opened pinned.
const openGuardsProbe = async (page: Page) => {
  await page.goto(GUARDS_PROBE_URL);
  await expect(page.locator("pre.shiki")).toHaveCount(1);
  const viewport = page.locator('[role="log"] > div').first();
  await expect.poll(() => bottomGapOf(viewport)).toBeLessThanOrEqual(1);
  return viewport;
};

// Start the per-frame growth engine and prove it is actually running —
// the concurrency IS the regression: without a resize in flight the
// library's own scroll handler processes escapes fine.
const startGrowth = async (page: Page, viewport: Locator) => {
  await page.getByRole("button", { name: "Start growth" }).click();
  await settleTwoFrames(page);
  const heightBefore = await viewport.evaluate(
    (element) => element.scrollHeight,
  );
  await settleTwoFrames(page);
  expect(
    await viewport.evaluate((element) => element.scrollHeight),
  ).toBeGreaterThan(heightBefore);
};

// Once escaped, the lock must be GENUINELY released: while content keeps
// growing, the visitor stays out at scrollback. Scroll anchoring may hold
// the gap constant (Chrome bumps scrollTop as rows land above the reading
// position, keeping the view still — the point of escaping), but a
// re-engaged lock would snap the gap to <= 1 on the next follow tick.
const expectLockReleased = async (page: Page, viewport: Locator) => {
  await expect(
    page.getByRole("button", { name: "Scroll to bottom" }),
  ).toBeVisible();
  const escaped = await viewport.evaluate((element) => ({
    gap: element.scrollHeight - element.clientHeight - element.scrollTop,
    scrollHeight: element.scrollHeight,
  }));
  expect(escaped.gap).toBeGreaterThan(10);
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollHeight))
    .toBeGreaterThan(escaped.scrollHeight + 200);
  expect(await bottomGapOf(viewport)).toBeGreaterThanOrEqual(escaped.gap - 2);
  await expect(
    page.getByRole("button", { name: "Scroll to bottom" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop growth" }).click();
};

test("TVC-141 a growing composer never strands a pinned transcript below the fold", async ({
  page,
}) => {
  const viewport = await openGuardsProbe(page);

  // First walk the escape → jump-button → followed-again path: the
  // library's scrollToBottom never clears escapedFromLock, so the flag is
  // deliberately stale-true when the composer grows below. The guard must
  // key off isAtBottom alone — the one flag the follow loop consults.
  await viewport.evaluate((element) => {
    element.scrollTop -= 200;
  });
  const jump = page.getByRole("button", { name: "Scroll to bottom" });
  await expect(jump).toBeVisible();
  await jump.click();
  await expect.poll(() => bottomGapOf(viewport)).toBeLessThanOrEqual(1);

  // The composer stand-in steals 150px from the scroll viewport without
  // touching content height — invisible to the library's content
  // observer. Pinned, the transcript must land back at its bottom within
  // two frames, and the jump button must not lie about it.
  await page.getByRole("button", { name: "Grow composer" }).click();
  await settleTwoFrames(page);

  expect(await bottomGapOf(viewport)).toBeLessThanOrEqual(1);
  await expect(
    page.getByRole("button", { name: "Scroll to bottom" }),
  ).toHaveCount(0);
});

test("TVC-142 wheeling up over a code block releases the follow lock", async ({
  page,
}) => {
  const viewport = await openGuardsProbe(page);
  await startGrowth(page, viewport);

  // The pointer sits over the <pre> — the library's overflow walk dies
  // there (overflow-x-auto computes overflow:auto) and never escapes.
  // Aim inside both the code block and the visible viewport: the block
  // is taller than the viewport and glued to the content bottom.
  const codeBox = await page.locator('[role="log"] pre.shiki').boundingBox();
  const viewportBox = await viewport.boundingBox();
  if (codeBox === null || viewportBox === null) {
    throw new Error("the scroll-guards probe did not render");
  }
  await page.mouse.move(
    codeBox.x + codeBox.width / 2,
    viewportBox.y + viewportBox.height - 80,
  );
  await page.mouse.wheel(0, -120);
  await page.mouse.wheel(0, -120);

  await expectLockReleased(page, viewport);
});

test("TVC-143 a non-wheel upward scroll escapes even while content is resizing", async ({
  page,
}) => {
  const viewport = await openGuardsProbe(page);
  await startGrowth(page, viewport);

  // Move scrollTop upward with no wheel event — a scrollbar drag's wire
  // form — inside rAF callbacks on three consecutive frames, so at least
  // one lands while resizeDifference is hot. (The giant-approval test's
  // scrollTop = 0 is NOT this case: nothing is resizing at that moment,
  // so the library's own handler processes it.)
  await viewport.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        let remaining = 3;
        const nudge = () => {
          element.scrollTop -= 150;
          remaining -= 1;
          if (remaining === 0) {
            resolve();
            return;
          }
          requestAnimationFrame(nudge);
        };
        requestAnimationFrame(nudge);
      }),
  );

  await expectLockReleased(page, viewport);
});

test("TVC-144 an axis-mixed horizontal pan over a code block never releases the lock", async ({
  page,
}) => {
  const viewport = await openGuardsProbe(page);
  await startGrowth(page, viewport);

  // A trackpad horizontal pan: deltaX-dominant with small negative
  // deltaY jitter. The wheel guard must ignore it (axis dominance), and
  // the jitter the browser chains into the transcript as an upward
  // scroll of a couple of pixels must not trip the scroll guard either —
  // the follow's per-frame re-bottoming resets the takeover accumulator
  // before jitter can accrue.
  const codeBox = await page.locator('[role="log"] pre.shiki').boundingBox();
  const viewportBox = await viewport.boundingBox();
  if (codeBox === null || viewportBox === null) {
    throw new Error("the scroll-guards probe did not render");
  }
  await page.mouse.move(
    codeBox.x + codeBox.width / 2,
    viewportBox.y + viewportBox.height - 80,
  );
  await page.mouse.wheel(-240, -6);
  await page.mouse.wheel(-240, -6);
  await page.mouse.wheel(-240, -6);
  await settleTwoFrames(page);

  // This probe pins the WHEEL guard's axis call (without it, the first
  // dispatch above would stopScroll and the assertions below go red).
  // The scroll guard's jitter absorption — the chained deltaY the pan
  // leaks into the transcript — is deliberately not probed here: the
  // library's own scroll handler escapes on any upward event whenever
  // its resizeDifference gate happens to be open (a pre-existing timing
  // lottery beneath every from-outside guard), so no deterministic
  // assertion about synthetic upward writes exists. The accumulator's
  // contract is stated at its definition; the escape probes above prove
  // deliberate gestures still cross it.

  // Still following: pinned through continued growth, no jump button.
  await expect.poll(() => bottomGapOf(viewport)).toBeLessThanOrEqual(1);
  await expect(
    page.getByRole("button", { name: "Scroll to bottom" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Stop growth" }).click();
});

test("TVC-145 dragging back to the bottom mid-stream re-engages the follow", async ({
  page,
}) => {
  const viewport = await openGuardsProbe(page);
  await startGrowth(page, viewport);

  // Escape first (the non-wheel path), then come home. The library's own
  // re-engage sits behind its resizeDifference gate, so mid-stream a
  // visitor who returned to the bottom would hug it unfollowed with the
  // jump button hidden — the mirror of the escapes above.
  await viewport.evaluate((element) => {
    element.scrollTop -= 400;
  });
  await expect(
    page.getByRole("button", { name: "Scroll to bottom" }),
  ).toBeVisible();

  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await settleTwoFrames(page);
  await expect.poll(() => bottomGapOf(viewport)).toBeLessThanOrEqual(1);
  await expect(
    page.getByRole("button", { name: "Scroll to bottom" }),
  ).toHaveCount(0);

  // Hugging the bottom is not proof — with the growth landing above the
  // trailing code block, scroll anchoring holds even an UNFOLLOWED
  // reader glued there. The viewport-shrink guard is the discriminator:
  // it only acts while the library considers itself followed, so the
  // composer landing its 150px proves the re-engage genuinely flipped
  // the follow state back on.
  await page.getByRole("button", { name: "Grow composer" }).click();
  await settleTwoFrames(page);
  await expect.poll(() => bottomGapOf(viewport)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Stop growth" }).click();
});

test("a subagent park shows no human-input copy and no empty actionable surface", async ({
  page,
}) => {
  await page.setViewportSize({ width: 672, height: 900 });
  await openScenario(page, "activity-shelf");
  const scene = page.locator('[data-testid="parked-on-subagents"]');
  await expect(scene.locator("[data-tf-subagent-pill]")).toBeVisible();
  // Nothing claims the member: no wait copy, no busy placeholder, no
  // Stop control — the a70b4b5 combination is unbuildable.
  await expect(scene).not.toContainText("Waiting for your input");
  await expect(scene).not.toContainText("answering");
  await expect(scene.locator("textarea")).toHaveAttribute(
    "placeholder",
    "Ask anything",
  );
  await expect(
    scene.getByRole("button", { name: "Stop generating" }),
  ).toHaveCount(0);
  // No empty actionable surface: the suspension slot holds no tenant
  // and its :empty collapse leaves it zero-height.
  const slot = scene.locator("[data-tf-suspension-slot]");
  const slotBox = await slot.boundingBox();
  expect(slotBox === null || slotBox.height === 0).toBe(true);
});

test("an approval settles in place: the card leaves, the slot collapses, and no receipt renders (the quiet extends to every decision)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 672, height: 900 });
  await openScenario(page, "suspensions");
  const scene = page.locator('[data-testid="settle-in-place"]');
  // The pending state: the card is the one actionable surface, with no
  // wait label above it.
  const surface = scene.locator("[data-tf-suspension-surfaces]");
  await expect(surface).toBeVisible();
  await expect(scene).not.toContainText("Waiting for your input");
  await expect(scene).not.toContainText("Request approved");

  await surface.getByRole("button", { name: "Approve", exact: true }).click();
  await settleTwoFrames(page);

  // Settled in place: the surface leaves the slot (which collapses),
  // and an approved decision stays quiet — its durable marker is
  // recorded, but no receipt line renders anywhere (TVC-062).
  await expect(scene.locator("[data-tf-suspension-surfaces]")).toHaveCount(0);
  const receipts = scene.getByText("Request approved", { exact: true });
  await expect(receipts).toHaveCount(0);
  const slotBox = await scene
    .locator("[data-tf-suspension-slot]")
    .boundingBox();
  expect(slotBox === null || slotBox.height === 0).toBe(true);
  // Nor does the operation's own group grow a receipt: the row simply
  // settles, with no consent line beneath it.
  const group = scene.locator("[data-tf-activity-group]");
  await expect(
    group.getByText("Request approved", { exact: true }),
  ).toHaveCount(0);
});

test("the expanded rail grows to its content — no inner scroller, no height cap, no fold cue", async ({
  page,
}) => {
  // A long open fold shows every step in the transcript's own flow: the
  // rail is exactly as tall as its content, overflow stays visible, and
  // nothing declares a clipped edge. The message list is the one scroller.
  await page.setViewportSize({ width: 672, height: 900 });
  await openScenario(page, "operations");
  const longRail = page.locator(
    '[data-testid="long-rail-scene"] [data-tf-activity-rail]',
  );
  await expect(longRail).toBeAttached();
  await settleTwoFrames(page);
  const metrics = await longRail.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
    maxHeight: getComputedStyle(element).maxHeight,
    foldBelow: element.hasAttribute("data-tf-fold-below"),
    foldAbove: element.hasAttribute("data-tf-fold-above"),
  }));
  expect(metrics.overflowY).toBe("visible");
  expect(metrics.maxHeight).toBe("none");
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
  expect(metrics.foldBelow).toBe(false);
  expect(metrics.foldAbove).toBe(false);
  // The nested step disclosures still expand in place.
  const firstStepDetails = longRail.locator("details").first();
  await firstStepDetails.evaluate((pane) => {
    (pane as HTMLDetailsElement).open = true;
  });
  await expect(firstStepDetails).toHaveAttribute("open", "");
});

test("a long collapsed live headline ellipsizes at the narrow width — no wrap, no horizontal overflow", async ({
  page,
}) => {
  // The 390px narrow contract: an authored progressText can reach the
  // 64-char cap, wider than the transcript column. The summary must
  // stay one line, ellipsized inside the shimmer, without pushing the
  // scroll element into horizontal overflow.
  await page.setViewportSize({ width: 390, height: 900 });
  // Pinned clock: this probe asserts the DATED time register.
  await openScenarioAtFixedNow(page, "operations");
  const scene = page.locator('[data-testid="long-label-scene"]');
  const fold = scene.locator("[data-tf-activity-group] details").first();
  const summary = fold.locator("summary").first();
  await expect(summary).toBeVisible();
  // The working fold is the expanded one by default, and expanded it
  // reads the generic "Working…"; the law under test is the COLLAPSED
  // live headline, which reads the latest step's own label — so the
  // member collapses it (the explicit toggle outranks every default).
  await expect(fold).toHaveAttribute("open", "");
  await summary.click();
  await expect(fold).not.toHaveAttribute("open", "");
  await settleTwoFrames(page);
  const metrics = await summary.evaluate((element) => {
    const scroller = element.closest('[role="log"]')?.firstElementChild;
    const label = element.querySelector("[data-tf-shimmer-base] > span");
    if (!(scroller instanceof HTMLElement) || !(label instanceof HTMLElement)) {
      throw new Error("the long-label scene did not render its probe shape");
    }
    return {
      summaryRight: element.getBoundingClientRect().right,
      scrollerRight: scroller.getBoundingClientRect().right,
      scrollerOverflowX: scroller.scrollWidth - scroller.clientWidth,
      labelClipped: label.scrollWidth > label.clientWidth,
      labelLines: Math.round(
        label.getBoundingClientRect().height /
          parseFloat(getComputedStyle(label).lineHeight),
      ),
    };
  });
  expect(metrics.summaryRight).toBeLessThanOrEqual(metrics.scrollerRight + 1);
  expect(metrics.scrollerOverflowX).toBeLessThanOrEqual(0);
  // The ellipsis actually engaged (the case is not vacuous)…
  expect(metrics.labelClipped).toBe(true);
  // …and the label stayed on one line.
  expect(metrics.labelLines).toBe(1);
  // The scene's bubble poses the recency window's DATED register under
  // the pinned clock (round-2 finding 4): an out-of-window stamp reads
  // its date, never a weekday that would read as this past week.
  await expect(scene.locator("time").first()).toHaveText(/^Aug 24/);
});

test("one activation toggles a held-open fold — the member pin never swallows the first click", async ({
  page,
}) => {
  // The real-browser twin of the jsdom-modelled member gesture: React
  // flushes a discrete update at the microtask checkpoint a user
  // gesture reaches DURING propagation — BEFORE the summary's
  // activation behaviour — an ordering jsdom cannot produce natively
  // (its script-dispatched activation runs synchronously inside
  // dispatchEvent). A capture-committed pin removed the open attribute
  // at that checkpoint and the activation toggled it straight back on,
  // swallowing the member's first collapse; only a real click on a real
  // held-open <details> exercises the whole ordering.
  //
  // STABLE HANDLES on purpose: a `details[open]` locator is live and
  // re-resolves to the NEXT open fold the moment the first collapses —
  // the fold under test is pinned by index instead.
  await page.setViewportSize({ width: 672, height: 1200 });
  await openScenario(page, "states");
  const folds = page.locator("[data-tf-activity-group] > details");
  const foldCount = await folds.count();
  let heldIndex = -1;
  for (let index = 0; index < foldCount; index += 1) {
    if ((await folds.nth(index).getAttribute("open")) !== null) {
      heldIndex = index;
      break;
    }
  }
  expect(heldIndex).toBeGreaterThanOrEqual(0);
  const heldFold = folds.nth(heldIndex);
  const summary = heldFold.locator(":scope > summary");
  // ONE activation collapses the decision-held fold…
  await summary.click();
  await expect(heldFold).not.toHaveAttribute("open");
  // …one more re-opens it (the pin releases to native, never latches)…
  await summary.click();
  await expect(heldFold).toHaveAttribute("open", "");
  // …and collapses again — the member owns it round after round.
  await summary.click();
  await expect(heldFold).not.toHaveAttribute("open");

  // The expand direction: the placement scene's DECAYED fold opens on a
  // single activation and stays the member's.
  await openScenario(page, "renderers");
  const placementFolds = page.locator("[data-tf-activity-group] > details");
  const placementCount = await placementFolds.count();
  let decayedIndex = -1;
  for (let index = 0; index < placementCount; index += 1) {
    if ((await placementFolds.nth(index).getAttribute("open")) === null) {
      decayedIndex = index;
      break;
    }
  }
  expect(decayedIndex).toBeGreaterThanOrEqual(0);
  const decayed = placementFolds.nth(decayedIndex);
  await decayed.locator(":scope > summary").click();
  await expect(decayed).toHaveAttribute("open", "");
});
