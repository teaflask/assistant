// The one source walk the census-style laws share. The prefixed-
// stylesheet law (styles-prefix.test.ts) and the authored-rem law
// (rem-in-source.test.ts) both claim to walk "the same pair" — src/**
// and fixtures/** — and this module is what makes that claim true by
// construction instead of by two verbatim copies drifting apart.
// (surface-boundary-census.test.ts keeps its own walk on purpose: it
// filters .tsx only and takes no directory skips.)
import { readdirSync } from "node:fs";
import path from "node:path";

export function sourceFilesOf(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "out") {
        continue;
      }
      files.push(...sourceFilesOf(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}
