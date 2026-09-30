import { afterEach, describe, expect, it } from "vitest";

import {
  closeCompanionDrawer,
  companionDrawerOpen,
  openCompanionDrawer,
} from "../src/core/companion-drawer-flag";

afterEach(() => {
  closeCompanionDrawer();
});

describe("the companion drawer flag", () => {
  it("starts closed and follows open/close", () => {
    expect(companionDrawerOpen.get()).toBe(false);
    openCompanionDrawer();
    expect(companionDrawerOpen.get()).toBe(true);
    closeCompanionDrawer();
    expect(companionDrawerOpen.get()).toBe(false);
  });

  it("notifies once per real change, never on a repeat write", () => {
    let notifications = 0;
    const unsubscribe = companionDrawerOpen.subscribe(() => {
      notifications += 1;
    });

    openCompanionDrawer();
    openCompanionDrawer();
    expect(notifications).toBe(1);
    closeCompanionDrawer();
    expect(notifications).toBe(2);

    unsubscribe();
    openCompanionDrawer();
    expect(notifications).toBe(2);
  });
});
