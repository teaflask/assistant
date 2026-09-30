// The script-tag distribution's bundle step. The npm build (tsc +
// tailwind CLI) stays exactly as it is; this second artifact bundles
// src/element.ts — React included, the built stylesheet baked in as
// text (rem→px transformed, Tailwind's `--tw-*` fallback appended
// ungated for the shadow root), ESM with code splitting so the
// transcript/highlighter stack stays behind the package's existing
// dynamic-import boundaries — into dist/element/, which `files` keeps
// OUT of the npm tarball. The dashboard stages dist/element/ onto the
// app origin at deploy (its stage-assistant-element script).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { build } from "esbuild";

import { transformRemToPx } from "./rem-to-px.mjs";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * Single-sourced build options: main() below builds with them, and
 * tests/element-bundle-weight.test.ts measures with them — the budget
 * can never drift from what actually ships.
 */
export function elementBuildOptions({ cssText, write }) {
  return {
    absWorkingDir: packageRoot,
    entryPoints: ["src/element.ts"],
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    minify: true,
    sourcemap: true,
    metafile: true,
    write,
    outdir: "dist/element",
    entryNames: "assistant",
    chunkNames: "chunks/[name]-[hash]",
    // React ships INSIDE this artifact — the whole point of the
    // distribution — so its dev branches must be compiled out.
    define: { "process.env.NODE_ENV": '"production"' },
    loader: {
      ".woff": "empty",
      ".woff2": "empty",
      ".ttf": "empty",
      ".css": "empty",
    },
    plugins: [_stylesheetTextPlugin(cssText)],
  };
}

// Resolves the entry's `virtual:tf-element-styles` import to the given
// stylesheet text (esbuild's text loader — the ?inline of the spike's
// Vite harness, done the esbuild way).
function _stylesheetTextPlugin(cssText) {
  return {
    name: "tf-element-styles",
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^virtual:tf-element-styles$/ }, () => ({
        path: "virtual:tf-element-styles",
        namespace: "tf-element-styles",
      }));
      pluginBuild.onLoad(
        { filter: /.*/, namespace: "tf-element-styles" },
        () => ({ contents: cssText, loader: "text" }),
      );
    },
  };
}

// A minified tailwind build of this package can only shrink so far —
// anything under this floor means the CLI ran against the wrong input
// (or a stub slipped back in) and the byte ledger would be vacuous.
const MIN_COMPILED_CSS_BYTES = 10_000;

/**
 * The stylesheet exactly as the shipped entry bakes it in: the tailwind
 * CLI's minified output (same input as `npm run build`, compiled fresh
 * so it can never be stale or missing), rem→px transformed, then
 * Tailwind's `--tw-*` fallback body appended ungated so every utility
 * chain resolves inside the shadow root (withUngatedPropertyFallback,
 * below). Exported so every measurement of the artifact — the build
 * itself, the weight tests, the baseline refresh — shares one CSS
 * pipeline.
 */
export function compiledElementCssText() {
  // The v4 CLI writes to stdout when no --output is given.
  const cssText = execFileSync(
    path.join(packageRoot, "node_modules", ".bin", "tailwindcss"),
    ["--input", "src/styles/styles.css", "--minify"],
    { cwd: packageRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (cssText.length < MIN_COMPILED_CSS_BYTES) {
    throw new Error(
      `tailwind produced ${String(cssText.length)} B of CSS — suspiciously ` +
        `little; the element measurement would be vacuous.`,
    );
  }
  return withUngatedPropertyFallback(transformRemToPx(cssText));
}

/**
 * The shadow-root edition of Tailwind's `--tw-*` fallback. Every shadow,
 * border, ring and transform utility reads a `--tw-*` chain whose initial
 * values come from the sheet's `@property` registrations; Chromium honours
 * `@property` only in document stylesheets, so inside the element's
 * adopted-sheet shadow root the registrations are ignored and each chain
 * is invalid at computed-value time. Tailwind ships the remedy itself —
 * `@layer properties{@supports (…){*,:before,:after,::backdrop{--tw-…}}}`
 * — but gated to engines without `@property`. This re-emits that block's
 * own body ungated, right after the block, so inside the shadow root the
 * names resolve as declarations. It touches nothing outside the shadow
 * root — no registration, rule or property reaches the host document —
 * and it never out-cascades a utility: the copy
 * is unlayered at specificity (0,0,0) and precedes every utility in
 * source order. Exactly one gated block must exist — a Tailwind bump that
 * changes the shape reds the build rather than shipping a silent hole.
 */
export function withUngatedPropertyFallback(cssText) {
  const gated =
    /@layer properties\{@supports [^{]*\{(\*,:before,:after,::backdrop\{[^}]*\})\}\}/g;
  const matches = [...cssText.matchAll(gated)];
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one @layer properties fallback block in the compiled ` +
        `sheet, found ${String(matches.length)} — the shadow-root fallback ` +
        `cannot be derived.`,
    );
  }
  const [match] = matches;
  const end = match.index + match[0].length;
  return cssText.slice(0, end) + match[1] + cssText.slice(end);
}

/**
 * The eager shell: the entry chunk plus everything it static-imports.
 * Dynamic edges are exactly what the splitting exists for (the
 * transcript/highlighter pool) — they stay out. Shared with the weight
 * tests so the walk can never drift from what the build reports.
 */
export function shellOutputKeysOf(metafile) {
  const entryKey = Object.keys(metafile.outputs).find((key) =>
    metafile.outputs[key].entryPoint?.endsWith("src/element.ts"),
  );
  if (entryKey === undefined) {
    throw new Error("no output chunk for src/element.ts");
  }
  const visited = new Set([entryKey]);
  const queue = [entryKey];
  while (queue.length > 0) {
    const key = queue.shift();
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
  return visited;
}

function _sha256OfFile(relativePath) {
  return createHash("sha256")
    .update(readFileSync(path.join(packageRoot, relativePath)))
    .digest("hex");
}

// The stale-artifact ledger: every file whose content shaped this
// build, hashed at build time. The shadow-probe suite's freshness
// guard rehashes them and goes red if dist/element/ no longer matches
// the tree — the reused-fixture-server hole (reuseExistingServer skips
// the build, and esbuild's servedir serves whatever is on disk). The
// ledger is bench tooling and must ship nowhere: it lives BESIDE
// dist/element/ so the frontend's wholesale staging of that directory
// onto the app origin never copies it, and package.json's files array
// negates it BY NAME ("!dist/element-build-manifest.json" — the
// "!dist/element" negation alone does NOT match this sibling path —
// npm pack proves it) so it stays out of the npm tarball too.
function _writeBuildManifest(metafile) {
  const inputs = {};
  const record = (relativePath) => {
    inputs[relativePath] = _sha256OfFile(relativePath);
  };
  // The bundle's own module graph, from esbuild's mouth. The virtual
  // stylesheet module has no disk path (existsSync skips it); its real
  // source — the fresh tailwind compile — is covered by the src/styles
  // tree below plus the component files already in the graph.
  for (const inputPath of Object.keys(metafile.inputs)) {
    if (existsSync(path.join(packageRoot, inputPath))) {
      record(inputPath);
    }
  }
  const stylesDir = path.join(packageRoot, "src/styles");
  for (const name of readdirSync(stylesDir, { recursive: true })) {
    const absolute = path.join(stylesDir, String(name));
    if (statSync(absolute).isFile()) {
      record(path.relative(packageRoot, absolute));
    }
  }
  // A stale transform or a bumped toolchain (the tailwind CLI runs
  // outside the module graph) is a stale artifact.
  record("scripts/build-element.mjs");
  record("scripts/rem-to-px.mjs");
  record("package-lock.json");
  writeFileSync(
    path.join(packageRoot, "dist", "element-build-manifest.json"),
    JSON.stringify(
      {
        note:
          "Freshness ledger — inputs hashed when dist/element/ " +
          "was built; the shadow-probe suite rehashes them. Kept out of " +
          "the npm tarball by package.json's files negation and out of " +
          "the app origin by the staging script copying dist/element/ " +
          "only.",
        inputs,
      },
      null,
      2,
    ),
  );
}

/**
 * The byte ledger of an element build — outputFiles as esbuild returns
 * them from a `write: false` build, or synthesized from disk after a
 * `write: true` one: the eager shell's minified and gzip weight, and
 * the on-demand pool's minified weight. gzip is per-chunk because that
 * is the wire — each chunk is a separate response, gzipped by the Next
 * origin (CloudFront edge compression is off; RUNBOOK "Dashboard
 * edge"), and zlib's default level approximates the origin's. The one
 * accounting shared by the build's printed ledger, the weight tests,
 * and the baseline refresh, so no measurement of the artifact can
 * drift from another.
 */
export function weighElementOutputs({ metafile, outputFiles }) {
  const shellOutputs = shellOutputKeysOf(metafile);
  let shellMinifiedBytes = 0;
  let shellGzipBytes = 0;
  let lazyPoolMinifiedBytes = 0;
  for (const file of outputFiles) {
    const key = Object.keys(metafile.outputs).find(
      (candidate) => candidate.endsWith(".js") && file.path.endsWith(candidate),
    );
    if (key === undefined) {
      continue;
    }
    if (shellOutputs.has(key)) {
      shellMinifiedBytes += file.contents.byteLength;
      shellGzipBytes += gzipSync(Buffer.from(file.contents)).byteLength;
    } else {
      lazyPoolMinifiedBytes += file.contents.byteLength;
    }
  }
  return { shellMinifiedBytes, shellGzipBytes, lazyPoolMinifiedBytes };
}

async function main() {
  const cssText = compiledElementCssText();
  const result = await build(elementBuildOptions({ cssText, write: true }));
  _writeBuildManifest(result.metafile);

  // A write: true build returns no outputFiles, so read the emitted
  // .js chunks (not their sourcemaps — the ledger never weighs those)
  // back off disk and weigh them with the shared ledger — the printed
  // numbers can never drift from what the TVC-162 gate and the
  // baseline refresh measure.
  const outputFiles = Object.keys(result.metafile.outputs)
    .filter((file) => file.endsWith(".js"))
    .map((file) => ({
      path: path.join(packageRoot, file),
      contents: readFileSync(path.join(packageRoot, file)),
    }));
  const { shellMinifiedBytes, shellGzipBytes, lazyPoolMinifiedBytes } =
    weighElementOutputs({ metafile: result.metafile, outputFiles });
  console.info(
    `element bundle: eager shell ${String(shellMinifiedBytes)} B minified / ` +
      `${String(shellGzipBytes)} B gzip (react bundled, css baked in); ` +
      `on-demand pool ${String(lazyPoolMinifiedBytes)} B minified in chunks/.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
