// The one fresh compile the stylesheet laws share (the source-walk.ts
// stance: one spelling, not two copies drifting apart), and the one home
// of the probe discipline those laws use when they compile a MUTATED
// sheet. The sheet is compiled FRESH from the source through the v4 CLI
// to stdout — never read from dist/: CI runs tests before `npm run
// build`, so a dist/ read would silently skip there and every law over
// it would be vacuous exactly where it matters.
import { execFileSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = fileURLToPath(new URL("..", import.meta.url));

/** Anti-vacuity floor, build-element.mjs's own: an empty compile would
 *  make every assertion over the sheet pass for the wrong reason. */
const MIN_COMPILED_CSS_CHARS = 10_000;

/** Compile a stylesheet at `inputPath` (package-root-relative) with the
 *  package's Tailwind CLI, minified, to a string. Uncached: the probe
 *  compiles pass a different input each time. */
export function compiledSheetOf(inputPath: string): string {
  const cssText = execFileSync(
    path.join(packageRoot, "node_modules", ".bin", "tailwindcss"),
    ["--input", inputPath, "--minify"],
    { cwd: packageRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (cssText.length < MIN_COMPILED_CSS_CHARS) {
    throw new Error(
      `tailwind produced ${String(cssText.length)} chars of CSS from ` +
        `${inputPath} — suspiciously little; a law over it would be vacuous.`,
    );
  }
  return cssText;
}

let shippedSheet: string | undefined;

/** The package's shipped sheet, compiled fresh once per worker: the
 *  source is fixed for the run, so every law reads the same compile. */
export function compiledSheet(): string {
  shippedSheet ??= compiledSheetOf("src/styles/styles.css");
  return shippedSheet;
}

/** The roots the census laws walk (styles-prefix, rem-in-source,
 *  review-vocabulary, prose-ceiling). A probe file
 *  must never land inside one: a census that readdirs a tree while a
 *  probe is written into it reads a file that vanishes under it. This
 *  list mirrors the walkers' own constants — one home, so a new walked
 *  root is added here once. */
const WALKED_ROOTS = ["src", "tests", "tests-e2e", "fixtures", "docs"];

export function probePathIsOutsideWalkedRoots(probePath: string): boolean {
  return !WALKED_ROOTS.some((root) =>
    probePath.startsWith(path.join(packageRoot, root) + path.sep),
  );
}

/** Self-healing for pid-suffixed probes: the suffix stops overlapping
 *  invocations clobbering each other, but it also means no later run
 *  reuses a killed worker's probe name, so a worker killed mid-compile
 *  would leak its probe permanently. Sweep the probes whose embedded pid
 *  is dead. The premise that makes this safe, stated: a concurrently
 *  running invocation's probe always carries a LIVE pid, and only ESRCH
 *  ("no such process") marks a file stale — so the sweep can never
 *  delete a live probe. Pid reuse errs the safe way: the stale file is
 *  kept until that pid dies, and a same-pid successor overwrites it in
 *  place. This readdir is not a census walk: it stats and reads nothing,
 *  and rmSync(force) tolerates a concurrent sweeper winning the delete.
 *  `pattern` captures the pid as its first group. */
export function removeProbesFromDeadWorkers(
  root: string,
  pattern: RegExp,
): void {
  for (const entry of readdirSync(root)) {
    const stale = pattern.exec(entry);
    if (!stale || Number(stale[1]) === process.pid) {
      continue;
    }
    try {
      process.kill(Number(stale[1]), 0); // throws ESRCH iff the pid is dead
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") {
        rmSync(path.join(root, entry), { force: true });
      }
    }
  }
}
