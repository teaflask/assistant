// @vitest-environment jsdom
// The performance-budget laws. The migrated rows will be heavier —
// semantic icons, motion, badges, disclosures, subagent trees — and a
// long conversation must not silently become a regression discovered
// at integration time. The guard is a DOM element-count ceiling over
// a large deterministic transcript: node count is what jsdom measures
// reproducibly (wall-clock is CI noise), and it is the direct driver
// of layout/paint cost at conversation length. TVC-161 pins the
// projection's row arithmetic alongside, so the ceiling can never be
// "met" by silently dropping rows.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MessageList } from "../../src/components/message-list";
import { transcriptRowsOf } from "../../src/core/transcript-rows";
import {
  SYNTHETIC_ROWS_PER_TURN,
  SYNTHETIC_TURN_COUNT,
  syntheticAnchorsOf,
  syntheticMessagesOf,
} from "./synthetic-transcript";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
  ResizeObserverStub;

// The ceiling: 2× the settled render measured 2026-08-29 (2,243
// elements over 40 turns / 200 rows on the pre-migration components —
// ~11 elements per row). The headroom is the migration's budget for
// icons, badges, and disclosures; raising the ceiling further is a
// declared decision — the contract's prohibitions (§4) require a
// PR-description callout, never a silent edit.
const ELEMENT_COUNT_CEILING = 4_500;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
});

describe("the long-conversation budget", () => {
  const rows = transcriptRowsOf(
    syntheticMessagesOf(),
    syntheticAnchorsOf(),
    false,
  );

  it("TVC-161 the projection yields exactly the arithmetically expected row count", () => {
    expect(rows).toHaveLength(SYNTHETIC_TURN_COUNT * SYNTHETIC_ROWS_PER_TURN);
  });

  it("TVC-160 rendering the synthetic transcript stays under the DOM element-count ceiling", () => {
    act(() => {
      root.render(<MessageList rows={rows} cards={[]} />);
    });
    const elementCount = host.querySelectorAll("*").length;
    // Anti-vacuity: the render actually happened at scale.
    expect(elementCount).toBeGreaterThan(SYNTHETIC_TURN_COUNT * 10);
    expect(elementCount).toBeLessThanOrEqual(ELEMENT_COUNT_CEILING);
  });
});
