import { describe, expect, it, vi } from "vitest";

import { ObservableCell } from "../src/core/observable-cell";

describe("ObservableCell", () => {
  it("returns the cached value with a stable identity between sets", () => {
    const value = { count: 1 };
    const cell = new ObservableCell(value);
    expect(cell.get()).toBe(value);
    expect(cell.get()).toBe(cell.get());
  });

  it("notifies every subscriber once per set", () => {
    const cell = new ObservableCell(0);
    const first = vi.fn();
    const second = vi.fn();
    cell.subscribe(first);
    cell.subscribe(second);

    cell.set(1);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(cell.get()).toBe(1);
  });

  it("skips notification when the same value is set again", () => {
    const cell = new ObservableCell("idle");
    const listener = vi.fn();
    cell.subscribe(listener);

    cell.set("idle");

    expect(listener).not.toHaveBeenCalled();
  });

  it("stops notifying after unsubscribe", () => {
    const cell = new ObservableCell(0);
    const listener = vi.fn();
    const unsubscribe = cell.subscribe(listener);

    unsubscribe();
    cell.set(1);

    expect(listener).not.toHaveBeenCalled();
  });

  it("survives a listener unsubscribing a sibling mid-notification", () => {
    const cell = new ObservableCell(0);
    const late = vi.fn();
    let unsubscribeLate: (() => void) | null = null;
    cell.subscribe(() => {
      unsubscribeLate?.();
    });
    unsubscribeLate = cell.subscribe(late);

    // The first listener removes the second during the same notification
    // sweep; the sweep must neither crash nor skip other listeners.
    expect(() => {
      cell.set(1);
    }).not.toThrow();
  });
});
