import { describe, expect, it } from "vitest";

import {
  boundedTextOf,
  doorLengthCeilingOf,
  escapedCostOf,
} from "../src/transport/door-budget";

// The door's own measure of a string payload: len(json.dumps(text)) with
// Python's defaults (ensure_ascii). The independent spec the bounded
// texts are asserted against.
function pythonStringLengthOf(text: string): number {
  const shortEscapes = [0x08, 0x09, 0x0a, 0x0c, 0x0d];
  let length = 2;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code > 0x7f) {
      length += 6;
    } else if (code === 0x22 || code === 0x5c) {
      length += 2;
    } else if (code < 0x20) {
      length += shortEscapes.includes(code) ? 2 : 6;
    } else {
      length += 1;
    }
  }
  return length;
}

// What the door measures for a whole serialized JSON value:
// len(json.dumps(value)) with default separators (", " / ": ").
function pythonSerializedLengthOf(value: unknown): number {
  const serialized = (JSON.stringify(value) as string | undefined) ?? "null";
  let length = 0;
  let inString = false;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    if (code === 0x22 && serialized.charCodeAt(index - 1) !== 0x5c) {
      inString = !inString;
    }
    if (code > 0x7f) {
      length += 6;
    } else if (!inString && (code === 0x2c || code === 0x3a)) {
      length += 2;
    } else {
      length += 1;
    }
  }
  return length;
}

describe("doorLengthCeilingOf", () => {
  it("never measures under the door's own serialization", () => {
    const payloads: unknown[] = [
      { plain: "ascii text", n: 12 },
      { cjk: "何かのエラーが発生しました、再試行してください" },
      { emoji: "🫖🍵".repeat(40), nested: { list: [1, 2, 3] } },
      ["a,b:c", '"quoted"', "back\\slash"],
    ];
    for (const payload of payloads) {
      const serialized = JSON.stringify(payload);
      expect(doorLengthCeilingOf(serialized)).toBeGreaterThanOrEqual(
        pythonSerializedLengthOf(payload),
      );
    }
  });

  it("counts ascii text one to one", () => {
    expect(doorLengthCeilingOf("plain")).toBe(5);
  });
});

describe("boundedTextOf", () => {
  it("returns short text untouched", () => {
    expect(boundedTextOf("hello", 100)).toBe("hello");
  });

  it("bounds by the door's escaped footprint, not raw length", () => {
    const text = "茶".repeat(100); // 6 door-chars each
    const bounded = boundedTextOf(text, 60);
    expect(bounded).toBe("茶".repeat(10));
    expect(pythonStringLengthOf(bounded)).toBeLessThanOrEqual(60 + 2);
  });

  it("charges quotes and backslashes their re-escaped cost", () => {
    const text = '"'.repeat(50);
    const bounded = boundedTextOf(text, 20);
    expect(bounded).toBe('"'.repeat(10));
  });

  it("never splits a surrogate pair", () => {
    const text = "ab" + "🫖"; // the emoji is a surrogate pair, 12 door-chars
    const bounded = boundedTextOf(text, 2 + 6);
    expect(bounded).toBe("ab");
  });
});

describe("escapedCostOf", () => {
  it("prices non-ascii and control units at the six-char escape", () => {
    expect(escapedCostOf("茶".charCodeAt(0))).toBe(6);
    expect(escapedCostOf(0x01)).toBe(6);
  });

  it("prices quote and backslash at two and plain ascii at one", () => {
    expect(escapedCostOf(0x22)).toBe(2);
    expect(escapedCostOf(0x5c)).toBe(2);
    expect(escapedCostOf("a".charCodeAt(0))).toBe(1);
  });
});
