// The committed bundle baseline's refresh (TVC-162). Builds the
// script-tag element bundle in memory with the shared pipeline from
// build-element.mjs and rewrites tests/bundle-baseline.json — the known
// point every PR's bundle delta is measured from. Node-only: runs
// anywhere `npm ci` has run (no docker, unlike the screenshot regen).
//
//   npm run baseline:bundle            rewrite the baseline, print deltas
//   npm run baseline:bundle -- --check exit 1 on ANY byte drift from the
//                                      committed file — the byte-exact
//                                      instrument the band-move ritual
//                                      starts with (re-measure the noise
//                                      floor; see the band rationale in
//                                      tests/element-bundle-weight.test.ts).
//                                      The vitest gate there is the banded
//                                      budget; this probe is exact.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import {
  compiledElementCssText,
  elementBuildOptions,
  weighElementOutputs,
} from "./build-element.mjs";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const baselinePath = path.join(packageRoot, "tests", "bundle-baseline.json");

const MEASURE_KEYS = [
  "shellMinifiedBytes",
  "shellGzipBytes",
  "lazyPoolMinifiedBytes",
];

async function measured() {
  const result = await build(
    elementBuildOptions({ cssText: compiledElementCssText(), write: false }),
  );
  return weighElementOutputs(result);
}

function committed() {
  try {
    return JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch {
    return null;
  }
}

function signed(delta) {
  return delta >= 0 ? `+${String(delta)}` : String(delta);
}

async function main() {
  const check = process.argv.includes("--check");
  const fresh = await measured();
  const previous = committed();

  for (const key of MEASURE_KEYS) {
    const before = previous?.[key];
    const line =
      typeof before === "number"
        ? `${key}: ${String(before)} → ${String(fresh[key])} B (${signed(fresh[key] - before)} B)`
        : `${key}: ${String(fresh[key])} B (no committed baseline)`;
    console.info(line);
  }

  if (check) {
    const drifted = MEASURE_KEYS.filter(
      (key) => previous?.[key] !== fresh[key],
    );
    if (drifted.length > 0) {
      console.error(
        `bundle baseline drift on: ${drifted.join(", ")} — a fresh build ` +
          `does not match ${baselinePath}`,
      );
      process.exit(1);
    }
    console.info("bundle baseline matches a fresh build exactly.");
    return;
  }

  const payload = {
    $comment:
      "Committed baseline for the script-tag element bundle — the bytes a " +
      "customer's embedded page fetches (eager shell = assistant.js plus " +
      "static chunks with the real CSS baked in; pool = lazy chunks). " +
      "TVC-162 gates each measure within a pinned band of this file " +
      "(tests/element-bundle-weight.test.ts). Refresh with " +
      "`npm run baseline:bundle`.",
    measuredAt: new Date().toISOString().slice(0, 10),
    shellMinifiedBytes: fresh.shellMinifiedBytes,
    shellGzipBytes: fresh.shellGzipBytes,
    lazyPoolMinifiedBytes: fresh.lazyPoolMinifiedBytes,
  };
  writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`);
  console.info(`wrote ${baselinePath}`);
}

await main();
