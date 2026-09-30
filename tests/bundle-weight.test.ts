import { gzipSync } from "node:zlib";

import { build, type Metafile, type OutputFile } from "esbuild";
import { describe, expect, it } from "vitest";

// The fork-arithmetic instrument. The chassis era's first expand
// measured 2,316,532 B minified / 624,634 B gzip; the chassis drop was
// justified by that number, so this test KEEPS measuring it — the root
// entry's static closure is what a host pays for the full package, and
// the ledger below prints on every run so the number never goes stale
// silently. Two tripwires ride along:
//
// - The byte bound: the whole root closure must stay far under the
//   chassis-era first expand. Crossing it means something
//   transcript-sized leaked into the static graph.
// - The shiki law: the highlighter (engine + grammars) is lazy by
//   construction (markdown/highlight.ts is the only door), so no shiki
//   module may be statically reachable from the root entry.

const BUNDLE_TEST_TIMEOUT_MS = 120_000;

// Headroom over the measured closure, loud against the chassis-era 2,316
// KB. The bound moved with the AG-UI 1.0 chassis, whose client carries
// zod's v4 locale table and the proto codec into every closure that holds
// the transport (~+250 KB minified; the per-package ledger is the AG-UI
// 1.0 migration record). THE COST, stated: at ~1,063 KB the guard fires
// on a leak of about 37 KB or more — a transcript-sized leak (a renderer,
// a grammar, a markdown pipeline) is tens to hundreds of KB, so the bound
// still catches the class it names; the shiki law below guards the
// largest such leak by construction.
const ROOT_CLOSURE_MAX_MINIFIED_BYTES = 1_100_000;

interface BundleResult {
  metafile: Metafile;
  outputFiles: OutputFile[];
}

let _bundle: Promise<BundleResult> | null = null;

function rootBundle(): Promise<BundleResult> {
  _bundle ??= build({
    entryPoints: [new URL("../src/index.ts", import.meta.url).pathname],
    bundle: true,
    splitting: true,
    write: false,
    minify: true,
    metafile: true,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    outdir: "out",
    external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
    loader: {
      ".woff": "empty",
      ".woff2": "empty",
      ".ttf": "empty",
      ".css": "empty",
    },
  });
  return _bundle;
}

function staticClosureOf(metafile: Metafile, entry: string): string[] {
  const entryKey = Object.keys(metafile.outputs).find((key) =>
    metafile.outputs[key].entryPoint?.endsWith(entry),
  );
  if (entryKey === undefined) {
    throw new Error(`no output chunk for entry ${entry}`);
  }
  const visited = new Set<string>([entryKey]);
  const queue = [entryKey];
  while (queue.length > 0) {
    const key = queue.shift();
    if (key === undefined) {
      break;
    }
    for (const edge of metafile.outputs[key].imports) {
      if (
        edge.kind !== "dynamic-import" &&
        !visited.has(edge.path) &&
        edge.path in metafile.outputs
      ) {
        visited.add(edge.path);
        queue.push(edge.path);
      }
    }
  }
  return [...visited];
}

describe("the root bundle's weight (the fork-arithmetic ledger)", () => {
  it(
    "stays far under the chassis-era first expand, and prints the ledger",
    async () => {
      const { metafile, outputFiles } = await rootBundle();
      const closure = staticClosureOf(metafile, "src/index.ts");

      let minified = 0;
      let gzip = 0;
      let lazyMinified = 0;
      for (const file of outputFiles) {
        // esbuild output paths are absolute; metafile keys are
        // outdir-relative — suffix-match the two.
        const key = Object.keys(metafile.outputs).find(
          (candidate) =>
            candidate.endsWith(".js") && file.path.endsWith(candidate),
        );
        if (key === undefined) {
          continue;
        }
        if (closure.includes(key)) {
          minified += file.contents.byteLength;
          gzip += gzipSync(Buffer.from(file.contents)).byteLength;
        } else {
          lazyMinified += file.contents.byteLength;
        }
      }

      console.info(
        `root static closure: ${String(minified)} B minified / ${String(gzip)} B gzip ` +
          `(react external, deps bundled); lazy pool ${String(lazyMinified)} B minified. ` +
          "Chassis era (2026-07-29): 2,316,532 B minified / 624,634 B gzip first expand.",
      );

      expect(minified).toBeGreaterThan(0);
      expect(minified).toBeLessThan(ROOT_CLOSURE_MAX_MINIFIED_BYTES);
    },
    BUNDLE_TEST_TIMEOUT_MS,
  );

  it(
    "keeps shiki (engine and grammars) out of the static closure — the lazy-boundary law",
    async () => {
      const { metafile } = await rootBundle();
      const closure = staticClosureOf(metafile, "src/index.ts");

      const staticModules = closure.flatMap((key) =>
        Object.keys(metafile.outputs[key].inputs),
      );
      expect(
        staticModules.filter((module) => module.includes("shiki")),
      ).toEqual([]);

      // Anti-vacuity: shiki genuinely ships, just never statically — the
      // lazy pool must contain it, or the boundary went vacuous (the
      // highlighter fell out of the build entirely).
      const allModules = Object.keys(metafile.inputs);
      expect(allModules.some((module) => module.includes("shiki"))).toBe(true);
    },
    BUNDLE_TEST_TIMEOUT_MS,
  );
});
