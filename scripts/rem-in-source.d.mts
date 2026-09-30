// Type surface for the consumers outside this directory:
// tests/rem-in-source.test.ts runs the scan as a law over src/** and
// fixtures/** and exercises the scanner directly.
export interface AuthoredRemFinding {
  file: string;
  line: number;
  excerpt: string;
  excused: boolean;
}
export function findAuthoredRemInSource(
  sourceText: string,
  filePath: string,
): { violations: AuthoredRemFinding[]; excused: AuthoredRemFinding[] };
