/**
 * The pacer's contract, in the ticket's words: never delay the first
 * paint, empty the buffer roughly when the next chunk is expected, wait
 * honestly when it runs dry, sweep the tail fast on a terminal, and let
 * a replay burst through untouched. The clock is injected, so every case
 * below is explicit timestamps — no timers.
 *
 * The numbers assert against the module's constants: 400ms nominal gap,
 * EWMA alpha 0.3, gap clamps 120/1500, burst threshold 50ms, rate clamps
 * 0.08/4 chars-per-ms, 200ms drain.
 */
import { describe, expect, it } from "vitest";

import { RevealPacer } from "../src/components/markdown/reveal-pacer";

describe("first paint and replay", () => {
  it("the construction snapshot is revealed whole", () => {
    const pacer = new RevealPacer(120, 1000);
    expect(pacer.revealedLength(1000)).toBe(120);
    expect(pacer.isCaughtUp(1000)).toBe(true);
  });

  it("a mount burst of back-to-back frames reveals instantly", () => {
    const pacer = new RevealPacer(0, 1000);
    pacer.observe(400, 1002);
    expect(pacer.revealedLength(1002)).toBe(400);
    pacer.observe(900, 1005);
    expect(pacer.revealedLength(1005)).toBe(900);
  });

  it("a mount burst teaches the EWMA nothing", () => {
    const withBurst = new RevealPacer(0, 1000);
    withBurst.observe(400, 1001);
    withBurst.observe(800, 1002);
    withBurst.observe(900, 1402); // first real gap: 400ms after the burst
    const withoutBurst = new RevealPacer(800, 1002);
    withoutBurst.observe(900, 1402);
    // Same buffer, same gap history that counts — identical pacing. Had
    // the ~1ms burst gaps folded in, withBurst's expectation would have
    // collapsed to the 120ms floor and revealed ~3x faster.
    for (const at of [1402, 1500, 1600, 1700, 1802]) {
      expect(withBurst.revealedLength(at)).toBe(
        withoutBurst.revealedLength(at),
      );
    }
  });
});

describe("pacing", () => {
  it("growth after the first real gap is paced linearly, not lumped", () => {
    const pacer = new RevealPacer(10, 0);
    pacer.observe(110, 400); // 100 chars over an expected 400ms → 0.25/ms
    expect(pacer.revealedLength(400)).toBe(10);
    expect(pacer.revealedLength(500)).toBe(35);
    expect(pacer.revealedLength(600)).toBe(60);
    expect(pacer.revealedLength(700)).toBe(85);
  });

  it("the buffer runs dry at the expected next arrival", () => {
    const pacer = new RevealPacer(10, 0);
    pacer.observe(110, 400);
    expect(pacer.revealedLength(799)).toBeLessThan(110);
    expect(pacer.revealedLength(800)).toBe(110);
    expect(pacer.isCaughtUp(800)).toBe(true);
  });

  it("slower chunk cadence stretches the expectation toward the observed gap", () => {
    const pacer = new RevealPacer(0, 0);
    pacer.observe(100, 800); // gap 800 → expectation 0.3*800 + 0.7*400 = 520
    // 100 buffered chars over 520ms → ~0.1923/ms.
    expect(pacer.revealedLength(1320)).toBe(100);
    expect(pacer.revealedLength(1060)).toBe(50);
  });

  it("a long silence teaches at most the gap ceiling", () => {
    const pacer = new RevealPacer(0, 0);
    pacer.observe(1000, 10_000); // gap 10s clamps to 1500 → 0.3*1500 + 0.7*400 = 730
    // 1000 chars over 730ms → ~1.3699/ms; well below the 4/ms ceiling.
    expect(pacer.revealedLength(10_365)).toBe(500);
    expect(pacer.revealedLength(10_730)).toBe(1000);
  });

  it("a burst mid-stream never drops the expectation below the floor", () => {
    const pacer = new RevealPacer(0, 0);
    pacer.observe(100, 400); // calibrated at 400ms
    pacer.observe(300, 410); // burst gap: folds into the buffer, not the EWMA
    // Buffer at 410: 300 - 2.5 already revealed = 297.5 over 400ms → ~0.744/ms.
    // Had the 10ms gap been taught (clamped to 120ms), the expectation
    // would collapse and 610 would already show far more.
    expect(pacer.revealedLength(610)).toBe(151);
    expect(pacer.revealedLength(810)).toBe(300);
  });

  it("a tiny buffer finishes early at the rate floor and then waits", () => {
    const pacer = new RevealPacer(0, 0);
    pacer.observe(10, 400); // raw rate 10/400 = 0.025 → floored to 0.08
    expect(pacer.revealedLength(450)).toBe(4);
    expect(pacer.revealedLength(525)).toBe(10);
    expect(pacer.isCaughtUp(525)).toBe(true);
  });

  it("a huge chunk is capped at the rate ceiling", () => {
    const pacer = new RevealPacer(0, 0);
    pacer.observe(4000, 400); // raw rate 10/ms → capped at 4/ms
    expect(pacer.revealedLength(900)).toBe(2000);
    expect(pacer.revealedLength(1400)).toBe(4000);
  });

  it("a dry buffer holds still until the next observation", () => {
    const pacer = new RevealPacer(0, 0);
    pacer.observe(100, 400);
    expect(pacer.revealedLength(800)).toBe(100);
    expect(pacer.revealedLength(5000)).toBe(100);
    expect(pacer.isCaughtUp(5000)).toBe(true);
    pacer.observe(200, 5000);
    expect(pacer.revealedLength(5000)).toBe(100);
    expect(pacer.isCaughtUp(5000)).toBe(false);
  });
});

describe("drain", () => {
  it("beginDrain sweeps the remainder within the flush window, monotonically", () => {
    const pacer = new RevealPacer(0, 0);
    pacer.observe(100, 400);
    pacer.beginDrain(500); // 25 revealed, 75 remaining → 0.375/ms
    let previous = 0;
    for (const at of [500, 550, 600, 650, 700]) {
      const revealed = pacer.revealedLength(at);
      expect(revealed).toBeGreaterThanOrEqual(previous);
      previous = revealed;
    }
    expect(pacer.revealedLength(700)).toBe(100);
    expect(pacer.isCaughtUp(700)).toBe(true);
  });

  it("drain never decelerates a faster ongoing rate", () => {
    const pacer = new RevealPacer(0, 0);
    pacer.observe(4000, 400); // capped at 4/ms — faster than any drain of the tail
    pacer.beginDrain(1300); // 3600 revealed, 400 left; 400/200 = 2/ms < 4/ms
    expect(pacer.revealedLength(1400)).toBe(4000);
  });

  it("draining an already-dry buffer changes nothing", () => {
    const pacer = new RevealPacer(0, 0);
    pacer.observe(100, 400);
    pacer.beginDrain(900);
    expect(pacer.revealedLength(900)).toBe(100);
  });
});

describe("instant reveal", () => {
  it("revealInstantly ends pacing for good", () => {
    const pacer = new RevealPacer(0, 0);
    pacer.observe(100, 400);
    pacer.revealInstantly();
    expect(pacer.revealedLength(400)).toBe(100);
    pacer.observe(500, 800); // a real gap that would otherwise pace
    expect(pacer.revealedLength(800)).toBe(500);
  });

  it("a shrinking arrival resets to instant reveal", () => {
    const pacer = new RevealPacer(0, 0);
    pacer.observe(100, 400);
    pacer.observe(20, 500); // below what is already revealed
    expect(pacer.revealedLength(500)).toBe(20);
    expect(pacer.isCaughtUp(500)).toBe(true);
  });
});

describe("monotonicity", () => {
  it("revealedLength never decreases across interleaved observe/drain calls", () => {
    const pacer = new RevealPacer(5, 0);
    const moments: (() => void)[] = [
      () => {
        pacer.observe(80, 380);
      },
      () => {
        pacer.observe(90, 395);
      },
      () => {
        pacer.observe(210, 810);
      },
      () => {
        pacer.beginDrain(950);
      },
    ];
    let previous = 0;
    let at = 0;
    for (const advance of moments) {
      advance();
      for (let step = 0; step < 5; step += 1) {
        at += 37;
        const revealed = pacer.revealedLength(at);
        expect(revealed).toBeGreaterThanOrEqual(previous);
        previous = revealed;
      }
    }
    expect(pacer.revealedLength(2000)).toBe(210);
  });
});
