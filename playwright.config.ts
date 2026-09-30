import { defineConfig } from "@playwright/test";

// The transcript browser harness. It drives the owned renderer stack over
// canned content for two contracts: Linux-only pixel baselines and
// font-independent interaction/geometry probes that run everywhere.
// Regenerate the screenshot baselines through the pinned Playwright
// container documented in tests-e2e/README.md.
export default defineConfig({
  testDir: "tests-e2e",
  outputDir: "tests-e2e/results",
  fullyParallel: false,
  use: {
    deviceScaleFactor: 1,
    viewport: { width: 390, height: 1400 },
    // Pinned, not assumed: the user bubbles render their turn's created_at
    // through Intl.DateTimeFormat(undefined, …), so the baselined "Monday
    // 7:19 PM" labels depend on the browser context's resolved locale and
    // timezone. Under maxDiffPixels: 0 any drift fails every user-bubble
    // baseline with no obvious cause — so the premise the fixtures' fixed
    // ISO stamps rely on is enforced here rather than inherited from
    // whatever the host or container defaults to.
    locale: "en-US",
    timezoneId: "UTC",
  },
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      // Zero differing pixels, deliberately. Precisely: the comparator
      // still judges each pixel at pixelmatch's default per-pixel
      // color-distance threshold (0.2), so this is exactness at the
      // pixel-count level, not byte equality of the PNGs. The pinned
      // container renders deterministically at that comparator — three
      // consecutive runs against the same baselines produced identical
      // per-snapshot diff counts — so any pixel change is a design
      // decision and re-blessing is the sanctioned path. The old
      // maxDiffPixelRatio: 0.01 was measured blind at scene scale (a
      // 16×16 glyph swap and a 28px indent collapse both passed; four
      // baselines had silently gone stale under it), and a ratio's
      // blindness grows with scene area — 0.01 bought ~2px on the
      // identity-mark crops and ~39,000px on the component bench. If a
      // future container repin introduces real rasterizer wobble, loosen
      // PER SNAPSHOT with a written justification (maxDiffPixels on that
      // call, sized well below one glyph) — never a suite-wide ratio.
      // The full decision record: docs/transcript-visual-contract.md §7.
      maxDiffPixels: 0,
    },
  },
  webServer: {
    // esbuild's serve exits when its stdin reaches EOF; the tail pipe
    // keeps it open for the run (the fixture trap).
    command: "tail -f /dev/null | npm run fixture:transcript",
    url: "http://127.0.0.1:8787/fixtures/transcript/",
    reuseExistingServer: true,
    // fixture:transcript also builds the element bundle (the shadow
    // probe loads the real dist/element/assistant.js), so the old
    // 120s budget gets headroom for the extra esbuild pass.
    timeout: 180_000,
  },
});
