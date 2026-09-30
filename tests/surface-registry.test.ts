import { describe, expect, it } from "vitest";

import {
  closeCompanionDrawer,
  companionDrawerOpen,
  openCompanionDrawer,
} from "../src/core/companion-drawer-flag";
import {
  AssistantSurfaceRegistry,
  assistantSurfaceRegistry,
} from "../src/core/surface-registry";

describe("AssistantSurfaceRegistry", () => {
  it("reports no surfaces when nothing has registered", () => {
    const registry = new AssistantSurfaceRegistry();

    expect(registry.getSnapshot()).toEqual({
      fullSurfaceMounted: false,
      transientOpen: false,
    });
    // The useSyncExternalStore contract: no change, same object.
    expect(registry.getSnapshot()).toBe(registry.getSnapshot());
  });

  it("flips fullSurfaceMounted for the lifetime of a full-surface registration", () => {
    const registry = new AssistantSurfaceRegistry();

    const unregister = registry.register("full-surface");
    expect(registry.getSnapshot()).toEqual({
      fullSurfaceMounted: true,
      transientOpen: false,
    });

    unregister();
    expect(registry.getSnapshot()).toEqual({
      fullSurfaceMounted: false,
      transientOpen: false,
    });
  });

  it("tracks the kinds independently", () => {
    const registry = new AssistantSurfaceRegistry();

    const unregisterTransient = registry.register("transient");
    expect(registry.getSnapshot()).toEqual({
      fullSurfaceMounted: false,
      transientOpen: true,
    });

    const unregisterFull = registry.register("full-surface");
    expect(registry.getSnapshot()).toEqual({
      fullSurfaceMounted: true,
      transientOpen: true,
    });

    unregisterTransient();
    expect(registry.getSnapshot()).toEqual({
      fullSurfaceMounted: true,
      transientOpen: false,
    });

    unregisterFull();
    expect(registry.getSnapshot()).toEqual({
      fullSurfaceMounted: false,
      transientOpen: false,
    });
  });

  it("treats a second same-kind registration as a silent no-op", () => {
    const registry = new AssistantSurfaceRegistry();
    let notifications = 0;
    registry.subscribe(() => {
      notifications += 1;
    });

    const unregisterFirst = registry.register("full-surface");
    const afterFirst = registry.getSnapshot();
    expect(notifications).toBe(1);

    const unregisterSecond = registry.register("full-surface");
    // Nothing observable changed: same snapshot object, no notify.
    expect(registry.getSnapshot()).toBe(afterFirst);
    expect(notifications).toBe(1);

    unregisterFirst();
    expect(registry.getSnapshot()).toBe(afterFirst);
    expect(registry.getSnapshot().fullSurfaceMounted).toBe(true);
    expect(notifications).toBe(1);

    unregisterSecond();
    expect(registry.getSnapshot().fullSurfaceMounted).toBe(false);
    expect(notifications).toBe(2);
  });

  it("survives StrictMode's register/unregister/register interleaving", () => {
    const registry = new AssistantSurfaceRegistry();

    const unregisterFirst = registry.register("full-surface");
    unregisterFirst();
    const unregisterSecond = registry.register("full-surface");
    expect(registry.getSnapshot().fullSurfaceMounted).toBe(true);

    unregisterSecond();
    expect(registry.getSnapshot().fullSurfaceMounted).toBe(false);
  });

  it("makes unregistering idempotent without evicting same-kind siblings", () => {
    const registry = new AssistantSurfaceRegistry();
    let notifications = 0;
    registry.subscribe(() => {
      notifications += 1;
    });

    const unregisterFirst = registry.register("full-surface");
    registry.register("full-surface");

    unregisterFirst();
    unregisterFirst();
    expect(registry.getSnapshot().fullSurfaceMounted).toBe(true);
    expect(notifications).toBe(1);
  });

  it("notifies once per real change and stops after unsubscribe", () => {
    const registry = new AssistantSurfaceRegistry();
    let notifications = 0;
    const unsubscribe = registry.subscribe(() => {
      notifications += 1;
    });

    const unregister = registry.register("full-surface");
    expect(notifications).toBe(1);
    unregister();
    expect(notifications).toBe(2);

    unsubscribe();
    registry.register("full-surface");
    expect(notifications).toBe(2);
  });

  it("keeps delivering to later listeners when one unsubscribes itself mid-notify", () => {
    const registry = new AssistantSurfaceRegistry();
    const delivered: string[] = [];
    const unsubscribeFirst = registry.subscribe(() => {
      delivered.push("first");
      unsubscribeFirst();
    });
    registry.subscribe(() => {
      delivered.push("second");
    });

    registry.register("full-surface");

    expect(delivered).toEqual(["first", "second"]);
  });

  it("replaces the snapshot object only when presence actually changes", () => {
    const registry = new AssistantSurfaceRegistry();

    const empty = registry.getSnapshot();
    const unregister = registry.register("transient");
    const withTransient = registry.getSnapshot();

    expect(withTransient).not.toBe(empty);
    expect(registry.getSnapshot()).toBe(withTransient);

    unregister();
    expect(registry.getSnapshot()).not.toBe(withTransient);
  });

  it("a full surface taking the floor closes the companion drawer; a transient one leaves it", () => {
    const registry = new AssistantSurfaceRegistry();
    openCompanionDrawer();

    const unregisterTransient = registry.register("transient");
    expect(companionDrawerOpen.get()).toBe(true);
    unregisterTransient();

    registry.register("full-surface");
    expect(companionDrawerOpen.get()).toBe(false);

    closeCompanionDrawer();
  });

  it("exports a shared singleton that starts with no surfaces", () => {
    expect(assistantSurfaceRegistry.getSnapshot()).toEqual({
      fullSurfaceMounted: false,
      transientOpen: false,
    });
  });
});
