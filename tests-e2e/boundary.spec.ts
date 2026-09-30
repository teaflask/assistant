/**
 * The surface boundary's browser contracts. DOM and computed-style
 * assertions only, deliberately: no toHaveScreenshot, so this spec adds
 * no pixel baselines.
 *
 * 1. Blast radius (round-3 finding 3): a poisoned row field degrades ONE
 *    tool row — the projection runs inside the per-row boundary — while
 *    the sibling row in the same list, the healthy list beside it, and
 *    the host page all survive; onError hears it; nothing escapes.
 * 2. The fallback card (round-6 ruling 1): CASCADE-INDEPENDENT — its
 *    appearance comes from its own inline literals, wherever it lands
 *    and whatever the widget mode or host sheet does. Asserted by
 *    computed style across the adversarial matrix below.
 */
import { expect, test } from "@playwright/test";

test("a poisoned row degrades one tool row; siblings, the list and the host page survive; onError fires", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("http://127.0.0.1:8787/fixtures/transcript/?boundary-probe");

  // The host page survived the throw…
  await expect(page.getByTestId("host-alive")).toBeVisible();
  // …exactly one ROW degraded — the tool-row fallback, not the list's.
  // The row lives inside the settled run's collapsed fold (the fold
  // rendered fine — more proof the radius is one row); open it to see
  // the card.
  const rowFallback = page
    .getByTestId("poisoned-list")
    .locator('[data-tf-surface-fallback="tool-row"]');
  await expect(rowFallback).toBeAttached();
  await page
    .getByTestId("poisoned-list")
    .locator("details > summary")
    .first()
    .click();
  await expect(rowFallback).toBeVisible();
  await expect(rowFallback).toHaveAttribute("role", "alert");
  await expect(
    page.getByTestId("poisoned-list").locator("[data-tf-surface-fallback]"),
  ).toHaveCount(1);
  // …the poisoned row's SIBLING in the same list still renders (the
  // census's one-tool-row blast radius, proven where it ships)…
  await expect(page.getByTestId("poisoned-list")).toContainText(
    "Poison the next row.",
  );
  // …the healthy list beside it is untouched…
  await expect(page.getByTestId("healthy-list")).toContainText(
    "Steeping sencha",
  );
  await expect(
    page.getByTestId("healthy-list").locator("[data-tf-surface-fallback]"),
  ).toHaveCount(0);
  // …the report was not swallowed. The per-row boundary reports through
  // the SESSION's reportError (unit-proven in transcript-boundary-wiring
  // and surface-boundary tests); this providerless bench observes the
  // other non-negotiable channel — the console names the failed surface.
  expect(
    consoleErrors.filter((text) =>
      text.includes("tool-row surface failed to render"),
    ).length,
  ).toBeGreaterThanOrEqual(1);
  // The chrome-root section's explicit onError DID hear its bomb (the
  // sentinel is wired there), and nothing else landed in it.
  const reported = await page.evaluate(
    () =>
      (window as Window & { __tfBoundaryProbeErrors?: string[] })
        .__tfBoundaryProbeErrors ?? [],
  );
  expect(
    reported.filter((message) => message.includes("chrome-root bomb")).length,
  ).toBeGreaterThanOrEqual(1);
  for (const message of reported) {
    expect(message).toContain("boundary-probe:");
  }
  // …and nothing escaped to the page: the boundary caught, not the host.
  expect(pageErrors).toEqual([]);
});

test("a chrome-root fallback carries its own ink, ground and shape — never the host's", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:8787/fixtures/transcript/?boundary-probe");

  const fallback = page
    .getByTestId("chrome-root")
    .locator('[data-tf-surface-fallback="page"]');
  await expect(fallback).toBeVisible();

  const styles = await fallback.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      borderRadius: computed.borderRadius,
      color: computed.color,
      fontFamily: computed.fontFamily,
    };
  });
  // The card's literals, not the host section's garish ink or serif —
  // the full matrix below asserts exact values; this original probe
  // keeps the round-0 shape (host page alive, card visible, host ink
  // rejected).
  expect(styles.borderRadius).toBe("10px");
  expect(styles.color).not.toBe("rgb(255, 0, 255)");
  expect(styles.fontFamily).toContain("ui-sans-serif");
});

/**
 * THE CARD MATRIX (round-6 ruling 1): the fallback card is
 * CASCADE-INDEPENDENT — its appearance is a function of its own inline
 * literals and NOTHING else. Every arm below must therefore compute the
 * exact same values, asserted by COMPUTED STYLE (four rounds of markup
 * assertions each passed while the cascade won — "the rule exists but
 * something later wins" is invisible to markup checks). The arms:
 *
 *  - chrome root on a dark host page (the round-6 trigger: a ground-less
 *    card drew near-black ink onto the dark page)
 *  - interior of a LIGHT widget on a dark host page
 *  - interior of a DARK widget on a light host page   ← fills the
 *  - interior of an AUTO widget under OS dark          ← round-4 table's
 *    (emulated per test)                                  interior row
 *  - a hostile host stylesheet targeting [data-tf-surface-fallback]
 *    directly, unlayered, loaded after the package sheet
 *
 * Per-arm mutation controls (each proving THAT arm can lose) were run
 * red during implementation and are listed in the matrix test's comment.
 */
const CARD_LITERALS = {
  color: "rgb(23, 23, 23)",
  background: "rgb(255, 255, 255)",
  borderColor: "rgba(0, 0, 0, 0.14)",
  borderRadius: "10px",
};

const MATRIX_ARMS = [
  { section: "arm-chrome-dark-host", surface: "page" },
  { section: "arm-interior-light-widget-dark-host", surface: "message-list" },
  { section: "arm-interior-dark-widget-light-host", surface: "message-list" },
  { section: "arm-interior-auto-widget", surface: "message-list" },
  { section: "arm-hostile-host", surface: "page" },
] as const;

for (const arm of MATRIX_ARMS) {
  test(`card matrix — ${arm.section}: the card computes its own literals, nothing else`, async ({
    page,
  }) => {
    if (arm.section === "arm-interior-auto-widget") {
      await page.emulateMedia({ colorScheme: "dark" });
    }
    await page.goto(
      "http://127.0.0.1:8787/fixtures/transcript/?boundary-probe",
    );
    const card = page
      .getByTestId(arm.section)
      .locator(`[data-tf-surface-fallback="${arm.surface}"]`);
    await expect(card).toBeVisible();
    const styles = await card.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        color: computed.color,
        background: computed.backgroundColor,
        borderColor: computed.borderTopColor,
        borderRadius: computed.borderRadius,
        fontFamily: computed.fontFamily,
      };
    });
    expect(styles.color).toBe(CARD_LITERALS.color);
    expect(styles.background).toBe(CARD_LITERALS.background);
    expect(styles.borderColor).toBe(CARD_LITERALS.borderColor);
    expect(styles.borderRadius).toBe(CARD_LITERALS.borderRadius);
    expect(styles.fontFamily).toContain("ui-sans-serif");
  });
}

test("ruling 2 — a host's LAYERED utility wins on its own tool-view content; the reset still owns widget DOM", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:8787/fixtures/transcript/?boundary-probe");
  // The host's element inside the [data-tf-host-view] mount: its layered
  // border utility must win — before the ruling the sheet's UNLAYERED
  // [data-tf-assistant] * reset beat any layered host rule here.
  // …in EVERY host slot: the tool-view mount, renderChrome's wrapper and
  // the welcomeMark wrapper (round-7 ruling 2 — one mechanism, three
  // doors), each held by the same contrast against the widget sibling.
  for (const slot of ["host-view-el", "host-chrome-el", "host-mark-el"]) {
    const hostBorder = await page
      .getByTestId(slot)
      .evaluate((element) => getComputedStyle(element).borderTopColor);
    expect(hostBorder, slot).toBe("rgb(210, 20, 20)");
  }
  // The in-test control: the SAME class on widget-owned DOM (outside the
  // marker) still takes the reset's hairline — the exclusion is scoped
  // to the extension point, not a general de-fanging of the reset.
  const widgetBorder = await page
    .getByTestId("widget-el")
    .evaluate((element) => getComputedStyle(element).borderTopColor);
  expect(widgetBorder).not.toBe("rgb(210, 20, 20)");
  // Round-7 review, finding 1: the companion welcome mark is PACKAGE
  // DOM — unmarked — so a bordered element under it takes the widget's
  // reset like any widget DOM, NOT the host utility. Marking that slot
  // (the reverted over-reach) turns this red: the host utility would
  // win and the reset would lose this subtree.
  const companionMarkBorder = await page
    .getByTestId("companion-mark-el")
    .evaluate((element) => getComputedStyle(element).borderTopColor);
  expect(companionMarkBorder).not.toBe("rgb(210, 20, 20)");
  expect(companionMarkBorder).toBe(widgetBorder);
});

test("keyframes namespace — a host's own @keyframes pulse/spin survive the package sheet; the package's tf- animations still run (round-7 review, finding 3)", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:8787/fixtures/transcript/?boundary-probe");
  // The host's definitions come FIRST in document order (head-prepended
  // by the fixture) and the package sheet after — exactly the order
  // under which the old sheet's global @keyframes pulse/spin, unlayered
  // at top level, silently replaced the host's. Each host element is
  // paused mid-animation at a value only the HOST's keyframes produce:
  // 0.25 / 0.75 — the package's old pulse would compute 0.5 here and
  // its old spin would leave opacity at 1.
  const hostPulse = await page
    .getByTestId("host-pulse-el")
    .evaluate((element) => getComputedStyle(element).opacity);
  expect(hostPulse).toBe("0.25");
  const hostSpin = await page
    .getByTestId("host-spin-el")
    .evaluate((element) => getComputedStyle(element).opacity);
  expect(hostSpin).toBe("0.75");
  // And the rename is not a de-animation: the package's own utilities
  // resolve to the tf- names AND their keyframes really ship — the
  // paused computed values prove the definitions applied (an
  // animation-name pointing at missing keyframes would compute the
  // resting 1 / none).
  const widgetPulse = await page
    .getByTestId("widget-pulse-el")
    .evaluate((element) => ({
      name: getComputedStyle(element).animationName,
      opacity: getComputedStyle(element).opacity,
    }));
  expect(widgetPulse.name).toBe("tf-pulse");
  expect(widgetPulse.opacity).toBe("0.5");
  const widgetSpin = await page
    .getByTestId("widget-spin-el")
    .evaluate((element) => ({
      name: getComputedStyle(element).animationName,
      transform: getComputedStyle(element).transform,
    }));
  expect(widgetSpin.name).toBe("tf-spin");
  expect(widgetSpin.transform).not.toBe("none");
});

test("card matrix — sixth arm: a host html { font-size: 62.5% } cannot resize the card (px, never rem)", async ({
  page,
}) => {
  // The round-7 ruling: the three box metrics are px literals, so a
  // host's root font-size — which scales every rem on the page — leaves
  // the card's box untouched. With the old rem values, 62.5% would
  // compute maxWidth 480px and margin 5px: exactly what the mutation
  // control restores to prove this arm can lose.
  await page.goto("http://127.0.0.1:8787/fixtures/transcript/?boundary-probe");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "62.5%";
  });
  const card = page
    .getByTestId("arm-chrome-dark-host")
    .locator('[data-tf-surface-fallback="page"]');
  await expect(card).toBeVisible();
  const box = await card.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      maxWidth: computed.maxWidth,
      marginTop: computed.marginTop,
      paddingTop: computed.paddingTop,
      paddingLeft: computed.paddingLeft,
    };
  });
  expect(box.maxWidth).toBe("768px");
  expect(box.marginTop).toBe("8px");
  expect(box.paddingTop).toBe("12px");
  expect(box.paddingLeft).toBe("16px");
});
