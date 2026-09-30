// Type surface for the consumers outside this directory: the weight
// tests (tests/element-bundle-weight.test.ts) and the baseline refresh
// import the build options, the CSS pipeline, and the byte ledger so
// every budget measures exactly what ships.
import type { BuildOptions, Metafile, OutputFile } from "esbuild";

export function elementBuildOptions(options: {
  cssText: string;
  write: boolean;
}): BuildOptions & { metafile: true; write: boolean };

export function compiledElementCssText(): string;

export function shellOutputKeysOf(metafile: Metafile): Set<string>;

export function weighElementOutputs(result: {
  metafile: Metafile;
  outputFiles: OutputFile[];
}): {
  shellMinifiedBytes: number;
  shellGzipBytes: number;
  lazyPoolMinifiedBytes: number;
};

/** Re-emits Tailwind's gated `--tw-*` fallback body ungated, after the
 *  gated block; throws unless exactly one gated block exists. */
export function withUngatedPropertyFallback(cssText: string): string;
