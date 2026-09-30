// Type surface for tests/size-law.test.ts, which pins the config's size-law
// block to SIZE_LAW.
import type { Linter } from "eslint";

declare const config: Linter.Config[];
export default config;
export declare const SIZE_LAW: {
  maxLines: number;
  maxLinesPerFunction: number;
  maxDepth: number;
};
