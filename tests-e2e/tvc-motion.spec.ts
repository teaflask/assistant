// The motion primitives under the package's hardest host (contract law
// 11): the shimmer and the spinner inside an open shadow root whose
// only stylesheet is a constructed sheet — the script-tag element's
// pipeline — on a page whose CSP allows no other styling route
// (`style-src 'none'`). Both switches are exercised where a real host
// applies them: the OS media query via emulation, and the
// `data-reduce-motion` kill switch on a light-DOM ancestor OUTSIDE the
// shadow boundary, crossing it through the reflection bridge.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

const PROBE_URL = "http://127.0.0.1:8787/fixtures/transcript/shadow-probe/";
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

function sha256Of(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function openProbe(
  page: Page,
  options: { reduceMotion?: boolean } = {},
): Promise<void> {
  await page.goto(
    options.reduceMotion === true ? `${PROBE_URL}?reduce-motion` : PROBE_URL,
  );
  await expect(page.locator('body[data-probe-ready="true"]')).toBeAttached();
}

/** Computed animation-name — Playwright locators pierce the shadow
 *  root, and getComputedStyle resolves the adopted constructed sheet. */
function animationNameOf(page: Page, selector: string): Promise<string> {
  return page
    .locator(selector)
    .evaluate((element) => getComputedStyle(element).animationName);
}

test("TVC-102 the motion primitives run in a constructed-stylesheet shadow root under a strict CSP, and both reduced-motion switches collapse them from outside the boundary", async ({
  page,
}) => {
  // Arm 1 — the CSP + shadow proof: under style-src 'none' only the
  // adopted constructed sheet could have supplied these keyframes. If
  // either animation-name resolves none here, the element bundle could
  // not carry the primitive.
  await openProbe(page);
  expect(await animationNameOf(page, "[data-tf-shimmer-highlight]")).toBe(
    "tf-shimmer",
  );
  expect(await animationNameOf(page, "[data-tf-spinner]")).not.toBe("none");
  await expect(page.locator("[data-tf-shimmer-base]")).toHaveText("Working…");
  await expect(page.getByText("Sending…")).toBeVisible();

  // Arm 2 — the host kill switch, applied OUTSIDE the shadow root: the
  // reflection bridge must carry it across, and the state text must
  // survive the collapse.
  await openProbe(page, { reduceMotion: true });
  expect(await animationNameOf(page, "[data-tf-shimmer-highlight]")).toBe(
    "none",
  );
  expect(await animationNameOf(page, "[data-tf-spinner]")).toBe("none");
  await expect(page.locator("[data-tf-shimmer-base]")).toHaveText("Working…");
  await expect(page.getByText("Sending…")).toBeVisible();

  // Arm 3 — the OS media query, no attribute anywhere.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openProbe(page);
  expect(await animationNameOf(page, "[data-tf-shimmer-highlight]")).toBe(
    "none",
  );
  expect(await animationNameOf(page, "[data-tf-spinner]")).toBe("none");
  await expect(page.getByText("Sending…")).toBeVisible();
});

test("TVC-103 the shadow/CSP probe is styled by the built script-tag artifact — the upgraded element's one adopted sheet carries the bake-stage rem→px fingerprint no fetched stylesheet could", async ({
  page,
}) => {
  // A proof of a reproduction is evidence about the reproduction. This
  // law pins that the probe page's shadow root, its constructed sheet,
  // and its reflection wrapper are the BUILT artifact's own
  // (dist/element/assistant.js), not a bench reconstruction: the
  // element is genuinely upgraded, the sheet is the ONLY stylesheet in
  // the tree, and its text is the bake-stage rem→px output —
  // `.tf\:text-tf-label` (the prefixed selector) serializes at 13px, a
  // token the un-transformed dist/styles.css (the old probe's fetch
  // source, still `.8125rem`) could never supply.
  await openProbe(page);
  const fingerprint = await page.evaluate(() => {
    const host = document.getElementById("probe-host");
    const constructor = customElements.get("teaflask-assistant");
    const shadow = host?.shadowRoot ?? null;
    const sheet = shadow?.adoptedStyleSheets[0] ?? null;
    const ruleText =
      sheet === null
        ? ""
        : [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
    const scene = shadow?.querySelector("[data-tf-assistant]") ?? null;
    return {
      tag: host?.tagName ?? null,
      upgraded: constructor !== undefined && host instanceof constructor,
      adoptedCount: shadow?.adoptedStyleSheets.length ?? -1,
      treeSheetCount: shadow?.styleSheets.length ?? -1,
      ruleCount: sheet?.cssRules.length ?? 0,
      labelTokenPx: /\.tf\\:text-tf-label\s*\{[^}]*font-size:\s*13px/.test(
        ruleText,
      ),
      // Anchored to the label rule, NOT a whole-sheet "no rem" scan —
      // escaped arbitrary-value selectors legitimately keep rem through
      // the transform (and new ones may appear at any time). The label
      // token pair is the discriminator.
      labelTokenRem: /\.tf\\:text-tf-label\s*\{[^}]*8125rem/.test(ruleText),
      // The rendered scene lives INSIDE the artifact's own wrapper (the
      // reflection target), not in some second shadow root or beside it.
      sceneInsideArtifactWrapper:
        scene !== null && (shadow?.firstElementChild?.contains(scene) ?? false),
    };
  });
  expect(fingerprint.tag).toBe("TEAFLASK-ASSISTANT");
  expect(fingerprint.upgraded).toBe(true);
  // The constructed sheet is the ONLY stylesheet: exactly one adopted
  // (the widget element has no host sheet), zero tree sheets (a <style>
  // could not load under style-src 'none' anyway).
  expect(fingerprint.adoptedCount).toBe(1);
  expect(fingerprint.treeSheetCount).toBe(0);
  expect(fingerprint.ruleCount).toBeGreaterThan(0);
  expect(fingerprint.labelTokenPx).toBe(true);
  expect(fingerprint.labelTokenRem).toBe(false);
  expect(fingerprint.sceneInsideArtifactWrapper).toBe(true);
});

// Not a TVC law — the bench guard for the harness door:
// `reuseExistingServer: true` skips the webServer command, and
// esbuild's servedir serves whatever dist/element/ is on disk, so a
// reused server can silently hand the proof a STALE artifact (the
// missing-artifact case already fails loudly via the probe's named
// diagnosis; staleness is the quiet one). The build writes a ledger of
// every input's hash; this rehashes them against the current tree.
test("the served element artifact is the current build — a reused fixture server must not smuggle a stale dist/element/ past the proof", async ({
  request,
}) => {
  const restart = "restart `npm run fixture:transcript` to rebuild";
  const artifactPath = path.join(PACKAGE_ROOT, "dist/element/assistant.js");
  const manifestPath = path.join(
    PACKAGE_ROOT,
    "dist/element-build-manifest.json",
  );
  expect(
    existsSync(artifactPath),
    `dist/element/assistant.js is missing — ${restart}`,
  ).toBe(true);
  expect(
    existsSync(manifestPath),
    `dist/element-build-manifest.json is missing (artifact predates the freshness ledger) — ${restart}`,
  ).toBe(true);
  // The server serves the SAME bytes this tree holds — a reused server
  // rooted in another checkout/worktree would differ here.
  const served = await request.get(
    "http://127.0.0.1:8787/dist/element/assistant.js",
  );
  expect(served.ok()).toBe(true);
  expect(sha256Of(await served.body())).toBe(
    sha256Of(readFileSync(artifactPath)),
  );
  // Every input the build recorded still hashes the same — otherwise
  // dist/element/ is stale against the tree and the whole suite is
  // testing yesterday's artifact.
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    inputs: Record<string, string>;
  };
  const inputEntries = Object.entries(manifest.inputs);
  expect(inputEntries.length).toBeGreaterThan(0);
  const staleInputs = inputEntries
    .filter(([inputPath, recordedHash]) => {
      const absolute = path.join(PACKAGE_ROOT, inputPath);
      return (
        !existsSync(absolute) ||
        sha256Of(readFileSync(absolute)) !== recordedHash
      );
    })
    .map(([inputPath]) => inputPath);
  expect(
    staleInputs,
    `dist/element/assistant.js is STALE — these build inputs changed since ` +
      `it was built: ${staleInputs.slice(0, 5).join(", ")}` +
      `${staleInputs.length > 5 ? ` (+${String(staleInputs.length - 5)} more)` : ""} — ${restart}`,
  ).toEqual([]);
});

// Not a TVC law — the dead-declarations law's shadow-root arm
// (tests/styles-dead-declarations.test.ts decides the sheet's TEXT; this
// is the one place the text's resolution mechanisms meet the element's
// real environment). Every `tf:shadow-*` and `tf:border*` utility reads
// a `--tw-*` chain whose initial values come from the sheet's `@property`
// registrations. Chromium honours `@property` only in document
// stylesheets, and Tailwind's own `@layer properties` fallback is gated
// to engines WITHOUT `@property`, so inside the adopted-sheet shadow
// root every such chain is invalid at computed-value time unless the
// element's sheet re-declares the names itself (the ungated fallback the
// bake stage appends, scripts/build-element.mjs). Two controls, both
// through the adopted constructed sheet — the fixture's `style-src
// 'none'` drops a `style=""` attribute, so an inline control here would
// compute `none` for a reason unrelated to the chain: a literal rule
// that MUST paint (the route works) and a dangling-name rule that MUST
// not (the measurement can see an unresolved chain).
test("the adopted sheet's --tw-* chain resolves inside the element's shadow root — a shadow utility and a border utility paint, an unregistered name does not", async ({
  page,
}) => {
  await openProbe(page);
  const computed = await page.evaluate(() => {
    const host = document.getElementById("probe-host");
    const shadow = host?.shadowRoot ?? null;
    const wrapper = shadow?.firstElementChild ?? null;
    const sheet = shadow?.adoptedStyleSheets[0] ?? null;
    if (shadow === null || wrapper === null || sheet === null) {
      throw new Error("the probe element has no shadow root, wrapper or sheet");
    }
    const probe = document.createElement("div");
    probe.setAttribute("data-tf-assistant", "");
    probe.innerHTML =
      '<button data-probe-plate="" class="tf:shadow-tf-control">p</button>' +
      '<span data-probe-border="" class="tf:border">b</span>' +
      '<span data-probe-literal="">l</span>' +
      '<span data-probe-dangling="">d</span>';
    wrapper.appendChild(probe);
    const inserted = sheet.cssRules.length;
    sheet.insertRule(
      "[data-probe-literal]{box-shadow:0px 1px 2px rgba(0,0,0,0.5)}",
      inserted,
    );
    sheet.insertRule(
      "[data-probe-dangling]{box-shadow:var(--tw-never-registered)}",
      inserted + 1,
    );
    const styleOf = (selector: string) => {
      const element = shadow.querySelector(selector);
      if (element === null) throw new Error(`${selector} did not mount`);
      return getComputedStyle(element);
    };
    const result = {
      plate: styleOf("[data-probe-plate]").boxShadow,
      inset:
        styleOf("[data-probe-plate]").getPropertyValue("--tw-inset-shadow"),
      borderStyle: styleOf("[data-probe-border]").borderTopStyle,
      borderWidth: styleOf("[data-probe-border]").borderTopWidth,
      literal: styleOf("[data-probe-literal]").boxShadow,
      dangling: styleOf("[data-probe-dangling]").boxShadow,
    };
    sheet.deleteRule(inserted + 1);
    sheet.deleteRule(inserted);
    probe.remove();
    return result;
  });
  // The route paints, so `none` below means the chain, not the CSP.
  expect(computed.literal).toBe("rgba(0, 0, 0, 0.5) 0px 1px 2px 0px");
  expect(computed.dangling).toBe("none");
  expect(computed.inset.trim()).toBe("0 0 #0000");
  expect(computed.plate).toContain("rgba(0, 0, 0, 0.04) 0px 1px 2px 0px");
  expect(computed.borderStyle).toBe("solid");
  expect(computed.borderWidth).toBe("1px");
});

// Not a TVC law — the boundary the element must not write across. A
// host page built with its own Tailwind v4 registers the same `--tw-*`
// names through `@property` rules in its stylesheets; loading the
// element must leave the host's registrations, and so the host's own
// rendering, exactly as they were. The host here registers `--tw-shadow`
// through a document-level constructed sheet (the fixture's CSP allows
// no <style>), reads it on a light-DOM element, and the value must be
// the host's — a document-wide `CSS.registerProperty` from the element
// would win over the host's rule regardless of order and flip it.
test("loading the element leaves a host page's own @property registrations untouched — the host's initial value survives on the host's element", async ({
  page,
}) => {
  await openProbe(page);
  const hostValue = await page.evaluate(() => {
    const hostSheet = new CSSStyleSheet();
    hostSheet.replaceSync(
      "@property --tw-shadow{syntax:'*';inherits:false;initial-value:1px 1px rgb(255, 0, 0)}" +
        "[data-host-probe]{box-shadow:var(--tw-shadow)}",
    );
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, hostSheet];
    const probe = document.createElement("div");
    probe.setAttribute("data-host-probe", "");
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).boxShadow;
    probe.remove();
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
      (sheet) => sheet !== hostSheet,
    );
    return value;
  });
  expect(hostValue).toBe("rgb(255, 0, 0) 1px 1px 0px 0px");
});
