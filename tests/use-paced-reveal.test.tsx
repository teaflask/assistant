// @vitest-environment jsdom
/**
 * The hook's wiring, not the math (reveal-pacer.test.ts owns the math):
 * mount paints whole, growth animates across frames and ends complete,
 * a stream ending mid-buffer drains within the flush window, either
 * reduced-motion channel reveals instantly, and unmount cancels the
 * frame loop.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePacedReveal } from "../src/components/markdown/use-paced-reveal";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let reducedMotionMatches = false;

function Probe({ text, streaming }: { text: string; streaming: boolean }) {
  const { revealed, revealHostRef } = usePacedReveal(text, streaming);
  return <div ref={revealHostRef} data-revealed={revealed} />;
}

function revealedText(): string {
  return (
    host.querySelector("[data-revealed]")?.getAttribute("data-revealed") ?? ""
  );
}

function render(text: string, streaming: boolean): void {
  act(() => {
    root.render(<Probe text={text} streaming={streaming} />);
  });
}

async function framesPass(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "Date",
      "performance",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
  reducedMotionMatches = false;
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: reducedMotionMatches,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const FIRST_CHUNK = "Steep the leaves for three minutes, ";
const SECOND_CHUNK = "then pour over a warmed cup and wait for the aroma. ";

describe("usePacedReveal", () => {
  it("the first render paints the full initial text", () => {
    render(FIRST_CHUNK, true);
    expect(revealedText()).toBe(FIRST_CHUNK);
  });

  it("streamed growth reveals across frames, ending complete", async () => {
    render(FIRST_CHUNK, true);
    await framesPass(400);
    const grown = FIRST_CHUNK + SECOND_CHUNK;
    render(grown, true);
    expect(revealedText()).toBe(FIRST_CHUNK);
    await framesPass(160);
    const midway = revealedText();
    expect(midway.length).toBeGreaterThan(FIRST_CHUNK.length);
    expect(midway.length).toBeLessThan(grown.length);
    expect(grown.startsWith(midway)).toBe(true);
    await framesPass(2000);
    expect(revealedText()).toBe(grown);
  });

  it("growth and stream-end in one committed render still reveal the whole text", async () => {
    // The final content delta and the run terminal often share a network
    // chunk; React batches the recorder's two publishes, so the leaf sees
    // the text grow and streaming flip false in a single render. The tail
    // must still drain to completion — this was a permanent-truncation bug.
    render(FIRST_CHUNK, true);
    await framesPass(400);
    const grown = FIRST_CHUNK + SECOND_CHUNK;
    render(grown, true);
    await framesPass(48);
    const finalGrowth = grown + SECOND_CHUNK;
    render(finalGrowth, false);
    await framesPass(300);
    expect(revealedText()).toBe(finalGrowth);
  });

  it("streaming ending mid-buffer drains to the full text within the flush window", async () => {
    render(FIRST_CHUNK, true);
    await framesPass(400);
    const grown = FIRST_CHUNK + SECOND_CHUNK + SECOND_CHUNK;
    render(grown, true);
    await framesPass(48);
    expect(revealedText().length).toBeLessThan(grown.length);
    render(grown, false);
    await framesPass(232);
    expect(revealedText()).toBe(grown);
  });

  it("no revealed frame ever splits a surrogate pair", async () => {
    // Emoji are two UTF-16 code units; a boundary landing between them
    // would paint a lone surrogate (�) for a frame.
    render(FIRST_CHUNK, true);
    await framesPass(400);
    render(FIRST_CHUNK + "🍵🫖🌿".repeat(30), true);
    // With /u, a paired surrogate is one code point — \p{Surrogate}
    // matches only a lone (split) half.
    const loneSurrogate = /\p{Surrogate}/u;
    for (let frame = 0; frame < 40; frame += 1) {
      await framesPass(16);
      expect(loneSurrogate.test(revealedText())).toBe(false);
    }
    expect(revealedText()).toBe(FIRST_CHUNK + "🍵🫖🌿".repeat(30));
  });

  it("the OS reduced-motion preference reveals growth instantly", async () => {
    reducedMotionMatches = true;
    render(FIRST_CHUNK, true);
    await framesPass(400);
    const grown = FIRST_CHUNK + SECOND_CHUNK;
    render(grown, true);
    expect(revealedText()).toBe(grown);
  });

  it("a data-reduce-motion ancestor reveals growth instantly", async () => {
    host.dataset.reduceMotion = "true";
    render(FIRST_CHUNK, true);
    await framesPass(400);
    const grown = FIRST_CHUNK + SECOND_CHUNK;
    render(grown, true);
    expect(revealedText()).toBe(grown);
  });

  it("unmounting cancels the frame loop", async () => {
    render(FIRST_CHUNK, true);
    await framesPass(400);
    render(FIRST_CHUNK + SECOND_CHUNK, true);
    await framesPass(16);
    act(() => {
      root.unmount();
    });
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(host);
  });
});
