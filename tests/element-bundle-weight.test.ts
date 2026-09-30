/**
 * The script-tag distribution's weight ledger and its per-PR delta
 * budget (TVC-162). The element bundle ships React inside and
 * splits: the eager shell — what every host page parses just to show
 * a minimized companion — must stay lean, with the transcript stack
 * and the highlighter behind dynamic imports (the bundle discipline:
 * a surface at rest must not pull the chat). Measured with the build
 * script's own options, so the budget can never drift from what
 * actually ships.
 *
 * The delta gate lives in this file so the memoized build is paid once
 * per `npm test`: the ceiling catches a breach; the delta band catches
 * the creep that precedes one — no single feature trips an 800 KB
 * ceiling, several do, and the PR that finally does gets blamed for
 * its predecessors. Each measure of the shipped artifact must stay
 * within a pinned band of the committed baseline
 * (tests/bundle-baseline.json), so growth is justified by the PR that
 * introduces it, visible as a baseline diff in review.
 *
 * Why a committed baseline instead of building the merge-base: CI's
 * checkout is depth-1 with no origin/main fetched, and a ref rebuild
 * would need a second npm ci inside the job's 15-minute budget plus the
 * baseline-ref traps scripts/check-contract-shrink.py documents. The
 * committed file costs one build and puts the delta in the diff itself.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { build, type Metafile, type OutputFile } from "esbuild";
import { describe, expect, it } from "vitest";

import {
  compiledElementCssText,
  elementBuildOptions,
  shellOutputKeysOf,
  weighElementOutputs,
} from "../scripts/build-element.mjs";

const BUNDLE_TEST_TIMEOUT_MS = 120_000;

// Measured 2026-09-24 with the real stylesheet baked in and the AG-UI 1.0
// chassis: 965,254 B minified / 240,951 B gzip — react-dom 19.3.0 ~210
// KB, the package's own core ~204 KB, the AG-UI transport stack ~190 KB,
// zod's v4 (locale table included) ~243 KB, ~52 KB CSS text, react +
// scheduler ~12 KB (the AG-UI 1.0 migration record). Headroom ~35 KB
// under a strict less-than. Crossing it means a transcript-sized leak
// into the static graph, or React's own growth — which the band below
// reports one bump at a time.
const ELEMENT_SHELL_MAX_MINIFIED_BYTES = 1_000_000;

// The delta bands, grounded in measurement (the rule: measure the noise
// floor before choosing the number, state absolute bytes, never a ratio).
// Measured 2026-08-31 on Node 22 (CI resolves the dashboard's .nvmrc =
// 22, the same line): three builds from an identical tree were byte-exact
// on all three measures — the noise floor is 0 B; a one-word string
// change measured +7 B minified / +8 B gzip; a comment-only change
// measured 0 B. The band is therefore a review cadence, not a noise
// allowance: copy-level drift accumulates against the FIXED committed
// baseline until it sums past the band and demands one reviewed refresh,
// while a new static dependency or asset (multi-KB — the transcript
// milestone moved the shell +11,767 B) fires on the PR that adds it. The
// gzip band also absorbs any residual zlib wobble across Node 22.x patch
// versions (none observed; zlib 1.3.1 here). Moving a band is a declared
// decision with a PR-description callout, never a silent edit (the
// contract's TVC-160 rule) — and it starts by re-measuring the noise
// floor with the byte-exact probe, `npm run baseline:bundle -- --check`.
const SHELL_MINIFIED_DELTA_BAND_BYTES = 4_096;
const SHELL_GZIP_DELTA_BAND_BYTES = 2_048;
const LAZY_POOL_DELTA_BAND_BYTES = 16_384;

// import.meta.dirname (the tvc-meta convention), not URL.pathname —
// the latter percent-encodes, so a space in the checkout path ENOENTs.
const BASELINE_PATH = path.join(import.meta.dirname, "bundle-baseline.json");

interface BundleBaseline {
  shellMinifiedBytes: number;
  shellGzipBytes: number;
  lazyPoolMinifiedBytes: number;
}

function committedBaseline(): BundleBaseline {
  const parsed: unknown = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const record = parsed as Record<string, unknown>;
  for (const key of [
    "shellMinifiedBytes",
    "shellGzipBytes",
    "lazyPoolMinifiedBytes",
  ]) {
    const value = record[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      throw new Error(
        `${BASELINE_PATH} is mangled: ${key} must be a positive integer — ` +
          `regenerate it with \`npm run baseline:bundle\``,
      );
    }
  }
  return record as unknown as BundleBaseline;
}

function bandViolation(
  measure: string,
  fresh: number,
  base: number,
  band: number,
): string | null {
  const delta = fresh - base;
  if (delta > band) {
    return (
      `${measure} grew +${String(delta)} B past the committed baseline ` +
      `${String(base)} B (band ±${String(band)} B) — justify the growth in ` +
      `the PR description and run \`npm run baseline:bundle\``
    );
  }
  if (delta < -band) {
    return (
      `${measure} shrank ${String(-delta)} B below the committed baseline ` +
      `${String(base)} B (band ±${String(band)} B) — run ` +
      `\`npm run baseline:bundle\` so the recorded headroom stays honest`
    );
  }
  return null;
}

// The transcript-stack markers the shell must never statically reach —
// the same vocabulary as tests/bundle-closure.test.ts.
const TRANSCRIPT_MARKERS = [
  "react-markdown",
  "node_modules/marked/",
  "shiki",
  "use-stick-to-bottom",
  "lucide-react",
  "src/components/transcript",
  // The lifted surface: a distinct basename the marker above does not
  // substring-match — without this row, an eager-shell import of
  // AssistantTranscript would drag the whole transcript machinery into
  // the shell unseen.
  "src/components/assistant-transcript",
  // The page surface reaches the transcript statically, so it must ride
  // the same dynamic edge — a widget-only host never downloads it.
  "src/components/assistant-page",
];

interface BundleResult {
  metafile: Metafile;
  outputFiles: OutputFile[];
}

let _bundle: Promise<BundleResult> | null = null;

function elementBundle(): Promise<BundleResult> {
  // The real stylesheet, compiled fresh by the shared pipeline — the
  // shipped entry bakes it in as text, so the byte ledger must weigh it
  // (the stub it replaced undercounted the artifact by ~50 KB).
  _bundle ??= build(
    elementBuildOptions({ cssText: compiledElementCssText(), write: false }),
  ) as Promise<BundleResult>;
  return _bundle;
}

describe("the element bundle's weight (the script-tag ledger)", () => {
  it(
    "keeps the eager shell under budget, and prints the ledger",
    async () => {
      const { shellMinifiedBytes, shellGzipBytes, lazyPoolMinifiedBytes } =
        weighElementOutputs(await elementBundle());

      console.info(
        `element eager shell: ${String(shellMinifiedBytes)} B minified / ` +
          `${String(shellGzipBytes)} B gzip (react bundled, css baked in); ` +
          `on-demand pool ${String(lazyPoolMinifiedBytes)} B minified.`,
      );

      expect(shellMinifiedBytes).toBeGreaterThan(0);
      expect(shellMinifiedBytes).toBeLessThan(ELEMENT_SHELL_MAX_MINIFIED_BYTES);
    },
    BUNDLE_TEST_TIMEOUT_MS,
  );

  it(
    "keeps the transcript stack and the highlighter out of the eager shell",
    async () => {
      const { metafile } = await elementBundle();
      const closure = shellOutputKeysOf(metafile);

      const staticModules = [...closure].flatMap((key) =>
        Object.keys(metafile.outputs[key].inputs),
      );
      for (const marker of TRANSCRIPT_MARKERS) {
        expect(
          staticModules.filter((module) => module.includes(marker)),
        ).toEqual([]);
      }

      // Anti-vacuity: the transcript genuinely ships, just on demand —
      // the full input graph must still contain it, or the boundary
      // went vacuous (the chat fell out of the build entirely).
      const allModules = Object.keys(metafile.inputs);
      expect(
        allModules.some((module) => module.includes("react-markdown")),
      ).toBe(true);
      expect(allModules.some((module) => module.includes("shiki"))).toBe(true);
      expect(
        allModules.some((module) =>
          module.includes("src/components/assistant-page"),
        ),
      ).toBe(true);
    },
    BUNDLE_TEST_TIMEOUT_MS,
  );

  it(
    "bundles react itself — the self-containment law of this distribution",
    async () => {
      const { metafile } = await elementBundle();
      const closure = shellOutputKeysOf(metafile);

      const staticModules = [...closure].flatMap((key) =>
        Object.keys(metafile.outputs[key].inputs),
      );
      // A silent regression to external react would build green and
      // break every host that (by definition) ships no React.
      expect(
        staticModules.some((module) =>
          module.includes("node_modules/react-dom/"),
        ),
      ).toBe(true);
      expect(
        staticModules.some((module) => module.includes("node_modules/react/")),
      ).toBe(true);
    },
    BUNDLE_TEST_TIMEOUT_MS,
  );

  it(
    "TVC-162: the element bundle's shipped bytes stay within the pinned delta band of the committed baseline",
    async () => {
      const fresh = weighElementOutputs(await elementBundle());
      const base = committedBaseline();

      // Anti-vacuity: the build genuinely produced the shipped shell —
      // a measurement this small means the gate is weighing nothing.
      expect(fresh.shellMinifiedBytes).toBeGreaterThan(100_000);

      const violations = [
        bandViolation(
          "shellMinifiedBytes",
          fresh.shellMinifiedBytes,
          base.shellMinifiedBytes,
          SHELL_MINIFIED_DELTA_BAND_BYTES,
        ),
        bandViolation(
          "shellGzipBytes",
          fresh.shellGzipBytes,
          base.shellGzipBytes,
          SHELL_GZIP_DELTA_BAND_BYTES,
        ),
        bandViolation(
          "lazyPoolMinifiedBytes",
          fresh.lazyPoolMinifiedBytes,
          base.lazyPoolMinifiedBytes,
          LAZY_POOL_DELTA_BAND_BYTES,
        ),
      ].filter((violation) => violation !== null);

      expect(violations).toEqual([]);
    },
    BUNDLE_TEST_TIMEOUT_MS,
  );
});
