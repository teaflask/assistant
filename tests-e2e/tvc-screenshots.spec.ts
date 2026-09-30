/**
 * The screenshot laws of the transcript visual contract
 * (docs/transcript-visual-contract.md §7): Linux-only pixel baselines
 * over the deterministic fixture scenarios, at the three contract
 * widths — 390 (narrow embedded), 672 (palette measure), 1280 (full
 * page). Every law carries a committed baseline regenerated through
 * the pinned container (tests-e2e/README.md); there is no parked state
 * (TVC-180).
 */
import os from "node:os";

import { expect, test, type Page } from "@playwright/test";

import { emitFractionalProbe } from "./helpers/fractional-probe";
import {
  expectFollowedListsAtBottom,
  openScenarioAtFixedNow,
  openScenarioAtTickingNow,
  readListScrollers,
  SCENARIO_SURFACE,
  settleTwoFrames,
} from "./helpers/geometry";

const SCREENSHOTS_UNAVAILABLE = os.platform() !== "linux";

const NARROW = { width: 390, height: 1400 };
const PALETTE = { width: 672, height: 1400 };
const FULL_PAGE = { width: 1280, height: 1400 };

async function shoot(
  page: Page,
  name: string,
  scenario: string,
  viewport: { width: number; height: number },
  // No shiki pass-through: none of the screenshotted scenarios carries a
  // fenced block (only `fallbacks` does, and no screenshot law targets
  // it). A lane that adds one reaches openScenario's own shikiBlocks.
  options: { reduceMotion?: boolean } = {},
): Promise<void> {
  await page.setViewportSize(viewport);
  for (const theme of ["light", "dark"] as const) {
    await openScenarioAtTickingNow(page, scenario, {
      ...(theme === "dark" ? { theme } : {}),
      ...options,
    });
    // Soft, deliberately: a hard assert here aborts the test at the first
    // failing variant, so sibling baselines' drift goes unmeasured —
    // exactly how a 10-baseline stale inventory read as 4. Soft still
    // fails the test; it just reports every variant.
    const errorsBefore = test.info().errors.length;
    await expect
      .soft(page.locator(SCENARIO_SURFACE))
      .toHaveScreenshot(`${name}-${theme}.png`);
    // The residual's family carries a read-only fractional-geometry
    // probe, strictly after the comparator (the failing state is
    // bistable, so a post-comparator read still sees it).
    if (name === "active-states") {
      await emitFractionalProbe(page, test.info(), {
        name,
        theme,
        errorsBefore,
      });
    }
  }
}

test.describe("the scenario screenshot regression", () => {
  test.skip(
    SCREENSHOTS_UNAVAILABLE,
    "screenshot baselines are Linux (CI) renders — regenerate via the Playwright container",
  );

  test("TVC-152 the real shipping composer renders at the narrow and full-page widths", async ({
    page,
  }) => {
    await shoot(page, "composer-narrow", "composer", NARROW);
    await shoot(page, "composer-full", "composer", FULL_PAGE);
  });

  test("TVC-153 the conversation rhythm reads prose-first at page width", async ({
    page,
  }) => {
    await shoot(page, "conversation-rhythm", "rhythm", FULL_PAGE);
  });

  test("TVC-154 decision surfaces hold the palette measure", async ({
    page,
  }) => {
    await shoot(page, "decision-approvals", "approvals", PALETTE);
    await shoot(page, "decision-elicitations", "elicitations", PALETTE);
  });

  test("answered questions expand through the shared tool disclosure", async ({
    page,
  }) => {
    for (const [width, viewport] of [
      ["narrow", NARROW],
      ["palette", PALETTE],
    ] as const) {
      await page.setViewportSize(viewport);
      for (const theme of ["light", "dark"] as const) {
        await openScenarioAtTickingNow(
          page,
          "elicitations",
          theme === "dark" ? { theme } : {},
        );
        const row = page.locator("details").filter({
          has: page.locator("[data-tf-questions-receipt]"),
        });
        await expect(row).not.toHaveAttribute("open");
        const summary = row.locator(":scope > summary");
        await summary.focus();
        await summary.press("Enter");
        await expect(row).toHaveAttribute("open", "");
        await expect(
          row.locator("[data-tf-elicitation-receipt-answer]").first(),
        ).toBeVisible();
        await summary.blur();
        await page.mouse.move(0, 0);
        await expect
          .soft(row)
          .toHaveScreenshot(`questions-expanded-${width}-${theme}.png`);
      }
    }
  });

  test("the suspension queue composition renders at the palette measure (non-law regression)", async ({
    page,
  }) => {
    // The shipping decision composition: rows keep the chronology while
    // the tenant holds the queue (pager visible) above the composer.
    await shoot(page, "suspension-queue", "suspensions", PALETTE);
  });

  test("the tool-view ladder and the placement holds render at the palette measure (non-law regression)", async ({
    page,
  }) => {
    // This capture pictures the one visual path no other baseline shows — the
    // rung-4 terminal reaching the row body after an exhausted ladder — and
    // pins the whole ladder as rendered in the row: rung-1 readings, version
    // drift and a throwing view landing on the row-variant default reading (no
    // card chrome, no "Result:" over an input reading), and the placement
    // scene's held-open current turn above a decayed one. Suite size note:
    // every committed PNG across BOTH snapshot directories is written by a
    // test — an orphaned baseline is deleted, never folded into the count.
    await shoot(page, "tool-view-ladder", "renderers", PALETTE);
  });

  test("TVC-155 active states settle to static equivalents under reduced motion", async ({
    page,
  }) => {
    await shoot(page, "active-states", "states", NARROW, {
      reduceMotion: true,
    });
  });

  test("TVC-156 the settled fold header wears the duration register", async ({
    page,
  }) => {
    // "Worked for …", no step count — the fold header crop.
    await page.setViewportSize(FULL_PAGE);
    await openScenarioAtTickingNow(page, "rhythm");
    await expect
      .soft(page.locator("[data-tf-activity-group]").first())
      .toHaveScreenshot("run-fold-settled-header-light.png");
  });

  // Non-law fold coverage: the acceptance matrix asks for light/dark
  // and wide/narrow baselines over active, expanded-settled, and
  // collapsed-settled folds. TVC-153 carries the wide light/dark pair
  // (active + collapsed-settled) and TVC-156 the settled header crop;
  // these pin the remaining cells without minting new law ids.
  test("the settled fold header wears the duration register in dark", async ({
    page,
  }) => {
    await page.setViewportSize(FULL_PAGE);
    await openScenarioAtTickingNow(page, "rhythm", { theme: "dark" });
    await expect
      .soft(page.locator("[data-tf-activity-group]").first())
      .toHaveScreenshot("run-fold-settled-header-dark.png");
  });

  test("an expanded settled fold keeps one rail at the header's own x-origin", async ({
    page,
  }) => {
    await page.setViewportSize(FULL_PAGE);
    for (const theme of ["light", "dark"] as const) {
      await openScenarioAtTickingNow(
        page,
        "rhythm",
        theme === "dark" ? { theme } : {},
      );
      const fold = page.locator("[data-tf-activity-group]").first();
      await fold.locator("summary").first().click();
      await settleTwoFrames(page);
      // Re-gate (round 3): the click grew content after the open's
      // gate — TVC-190 holds "before capture", not "at open".
      await expectFollowedListsAtBottom(page);
      // Soft for the same reason as shoot(): both themes must report.
      await expect
        .soft(fold)
        .toHaveScreenshot(`run-fold-expanded-settled-${theme}.png`);
    }
  });

  test("the conversation rhythm holds at the narrow width", async ({
    page,
  }) => {
    await shoot(page, "run-fold-rhythm-narrow", "rhythm", NARROW);
  });

  // Non-law episode coverage: the acceptance matrix asks for visual
  // evidence over an interleaved turn — three narration passages, three
  // action clusters — settled into ONE "Worked for …" disclosure above
  // the visible final response, collapsed and expanded, light and dark.
  // TVC-015/016 carry the structure at the DOM layer; these pin the
  // pixels without minting new law ids (the sanctioned pattern above).
  test("a completed interleaved turn settles into one episode above its final response", async ({
    page,
  }) => {
    await shoot(
      page,
      "episode-interleaved-collapsed",
      "interleaved",
      FULL_PAGE,
    );
  });

  test("an expanded episode restores the interleaved chronology in place", async ({
    page,
  }) => {
    await page.setViewportSize(FULL_PAGE);
    for (const theme of ["light", "dark"] as const) {
      await openScenarioAtTickingNow(
        page,
        "interleaved",
        theme === "dark" ? { theme } : {},
      );
      await page.locator("[data-tf-activity-group] summary").first().click();
      await settleTwoFrames(page);
      // Re-gate (round 3): the click grew content after the open's
      // gate — TVC-190 holds "before capture", not "at open".
      await expectFollowedListsAtBottom(page);
      // Soft for the same reason as shoot(): both themes must report.
      await expect
        .soft(page.locator(SCENARIO_SURFACE))
        .toHaveScreenshot(`episode-interleaved-expanded-${theme}.png`);
    }
  });

  test("TVC-157 the process rail holds its two columns over every semantic operation", async ({
    page,
  }) => {
    // Semantic icons in one column, labels in the other.
    await shoot(page, "process-rail-columns", "operations", FULL_PAGE);
  });

  test("TVC-158 the subagent tree renders running, failed, and completed children", async ({
    page,
  }) => {
    await shoot(page, "subagent-tree", "subagents", FULL_PAGE);
  });

  // Non-law provenance coverage: the acceptance matrix asks for
  // light/dark evidence over the memory footer and the system
  // notices; TVC-130/132 carry the structure, these pin the pixels
  // without minting new law ids (the sanctioned pattern above).
  test("the memory footer and system notices hold their quiet register", async ({
    page,
  }) => {
    await shoot(page, "provenance-notices", "notices", FULL_PAGE);
  });

  test("the memory footer's reveal lists each write with its destination", async ({
    page,
  }) => {
    await page.setViewportSize(FULL_PAGE);
    for (const theme of ["light", "dark"] as const) {
      await openScenarioAtTickingNow(
        page,
        "notices",
        theme === "dark" ? { theme } : {},
      );
      await page.locator("[data-tf-memory-footer] button").click();
      await settleTwoFrames(page);
      // Re-gate (round 3): the click grew content after the open's
      // gate — TVC-190 holds "before capture", not "at open".
      await expectFollowedListsAtBottom(page);
      // The card itself, not the footer: the reveal opens upward
      // (bottom-full), OUTSIDE the footer's own box — an element shot of
      // the footer would clip the very surface this baseline pins.
      // Soft for the same reason as shoot(): both themes must report.
      await expect
        .soft(page.locator("[data-tf-memory-footer] [role='note']"))
        .toHaveScreenshot(`memory-footer-open-${theme}.png`);
    }
  });

  test("TVC-159 subagent identity marks render as colored TeaFlask marks", async ({
    page,
  }) => {
    // A full-surface shot of the rhythm scenario would be
    // byte-identical to TVC-153's baseline — a law whose baseline
    // duplicates another's pins nothing of its own, and a mark-sized
    // regression hides inside a page of prose. The marks are
    // photographed at MARK scale instead, one baseline per register, so
    // any glyph change fills the frame — and the subagent register
    // (absent from rhythm entirely) finally has pixels. TVC-092 remains
    // the DOM companion for structure and order.
    await page.setViewportSize(FULL_PAGE);
    await openScenarioAtTickingNow(page, "subagents");
    const subagentMarks = page
      .locator('[data-tf-subagent-entry] [data-tf-agent-mark="subagent"]')
      .filter({ visible: true });
    const firstMark = subagentMarks.nth(0);
    const secondMark = subagentMarks.nth(1);
    await expect(firstMark).toBeVisible();
    await expect(secondMark).toBeVisible();
    await expect
      .soft(firstMark)
      .toHaveScreenshot("subagent-identity-mark-1-light.png");
    await expect
      .soft(secondMark)
      .toHaveScreenshot("subagent-identity-mark-2-light.png");
  });
});

// TVC-190's carrier lives OUTSIDE the Linux-only describe: it takes no
// pixels, so the capture clock regime is enforced on every platform. The
// two legs falsify each other — the pinned leg is the committed negative
// control (the exact defect shape: a frozen Date parks every follow on a
// wait that never elapses, so the baselines photograph "initial follow
// never ran"), and the ticking leg is the law. Both legs read the DOM
// through readListScrollers — the same exported selectors the gate
// itself measures — so the control also reds if LIST_SCROLLER rots (an
// empty match here fails the >= 2 overflow precondition, where the gate
// alone would pass vacuously).
test("TVC-190 the capture clock ticks — overflowing lists land their follow before capture; a pinned clock provably cannot", async ({
  page,
}) => {
  await page.setViewportSize(PALETTE);
  // Negative control: the suspensions composition (two overflowing lists
  // and one content-fit — the composition the follow flake fired in)
  // under the clock that cannot elapse a follow wait.
  await openScenarioAtFixedNow(page, "suspensions");
  await settleTwoFrames(page);
  const pinned = await readListScrollers(page);
  const overflowing = pinned.filter((reading) => reading.overflow > 1);
  if (overflowing.length < 2) {
    throw new Error(
      "TVC-190 precondition: the suspensions scene must carry at least " +
        `two overflowing lists — got ${JSON.stringify(pinned)}`,
    );
  }
  for (const reading of overflowing) {
    expect(reading.scrollTop).toBe(0);
  }
  // The law: under the capture clock, the same scene's follows complete
  // before any capture is taken. The wrapper gates internally (round 2),
  // so this explicit call is deliberately redundant: the law leg must
  // keep asserting even if the fold is ever removed from the wrapper.
  await openScenarioAtTickingNow(page, "suspensions");
  await expectFollowedListsAtBottom(page);
});
