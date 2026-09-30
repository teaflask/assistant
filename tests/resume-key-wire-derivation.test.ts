/**
 * Resume anchors are keyed from WIRE data alone — the payload's own
 * (round, attempt) — and no client code reconstructs a per-run ordinal
 * (a per-run marker count reset at RUN_STARTED). The defect shape is a
 * counter variable, invisible to types — so, like the severance wiring
 * law, the cheapest honest gate is to read the source.
 *
 * Scoped to the files that carried the ordinal on purpose: "ordinal" is
 * a legitimate word elsewhere (subagent delivery results). With a
 * markerOrdinal threaded through all three, this test fails.
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
);

const FILES_THAT_CARRIED_THE_ORDINAL = [
  path.join("transport", "stream-resume.ts"),
  path.join("core", "connection-epoch.ts"),
  path.join("components", "child-transcript.tsx"),
  path.join("components", "use-child-replay-stream.ts"),
];

/** CODE only: the comments are allowed — required, even — to tell the
 *  ordinal's retirement story; the defect this gate holds shut is an
 *  identifier (a counter variable, a parameter, a key component), which
 *  only lives outside comments. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

describe("resume keys derive from the wire", () => {
  it("no client code reconstructs a per-run marker ordinal", () => {
    for (const file of FILES_THAT_CARRIED_THE_ORDINAL) {
      const source = withoutComments(
        readFileSync(path.join(SRC_ROOT, file), "utf8"),
      );
      const hits = source
        .split("\n")
        .map((line, index) => ({ line, number: index + 1 }))
        .filter(({ line }) => /ordinal/i.test(line))
        .map(({ line, number }) => `${file}:${String(number)}: ${line.trim()}`);
      expect(
        hits,
        "an ordinal remnant survived the retirement of per-run ordinals",
      ).toEqual([]);
    }
  });
});
