/**
 * The tail-slot pool: the child-stream budget's laws — idempotent
 * grants (StrictMode's double effect), a hard capacity, FIFO promotion
 * where the freed slot is handed on BEFORE the announcement, and
 * departed waiters leaving the queue.
 */
import { describe, expect, it } from "vitest";

import { TailSlotPool } from "../src/core/tail-slot-pool";

describe("the tail slot pool", () => {
  it("grants idempotently up to capacity and queues the overflow", () => {
    const pool = new TailSlotPool(1);
    expect(pool.acquire("a")).toBe(true);
    // StrictMode's double effect: the same lease re-acquired is a no-op.
    expect(pool.acquire("a")).toBe(true);
    expect(pool.acquire("b")).toBe(false);
    expect(pool.holds("a")).toBe(true);
    expect(pool.holds("b")).toBe(false);
  });

  it("hands a released slot to the oldest waiter before announcing", () => {
    const pool = new TailSlotPool(1);
    pool.acquire("a");
    pool.acquire("b");
    pool.acquire("c");
    const promotedAtAnnounce: boolean[] = [];
    pool.subscribe(() => {
      promotedAtAnnounce.push(pool.holds("b"));
    });
    pool.release("a");
    expect(pool.holds("b")).toBe(true);
    expect(pool.holds("c")).toBe(false);
    // By the time subscribers re-read, the promoted lease already holds.
    expect(promotedAtAnnounce).toEqual([true]);
  });

  it("drops a waiter that stops wanting before its turn", () => {
    const pool = new TailSlotPool(1);
    pool.acquire("a");
    pool.acquire("b");
    pool.acquire("c");
    pool.release("b");
    pool.release("a");
    expect(pool.holds("c")).toBe(true);
    expect(pool.holds("b")).toBe(false);
  });

  it("defaults to the in-tree tail budget when built uncapped", () => {
    const pool = new TailSlotPool();
    expect(pool.acquire("a")).toBe(true);
    expect(pool.acquire("b")).toBe(true);
    expect(pool.acquire("c")).toBe(true);
    expect(pool.acquire("d")).toBe(false);
  });
});
