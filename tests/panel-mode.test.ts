// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readPanelMode,
  subscribePanelMode,
  writePanelMode,
} from "../src/persistence/panel-mode";
import { resetAssistant } from "../src/persistence/stored-thread";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("panel mode persistence", () => {
  it("round-trips per publishable key", () => {
    writePanelMode("pk_test_a", "sidebar");

    expect(readPanelMode("pk_test_a")).toBe("sidebar");
    expect(readPanelMode("pk_test_b")).toBe("floating");

    writePanelMode("pk_test_a", "floating");

    expect(readPanelMode("pk_test_a")).toBe("floating");
  });

  it("stores under the package's namespaced key; the floating default keeps no record", () => {
    writePanelMode("pk_test_a", "sidebar");

    expect(
      window.localStorage.getItem("tf-assistant:pk_test_a:panel-mode"),
    ).toBe("sidebar");

    writePanelMode("pk_test_a", "floating");

    expect(
      window.localStorage.getItem("tf-assistant:pk_test_a:panel-mode"),
    ).toBeNull();
  });

  it("reads anything but the exact opt-in string as floating", () => {
    for (const garbage of ["Sidebar", "1", "true", "docked", ""]) {
      window.localStorage.setItem("tf-assistant:pk_test_a:panel-mode", garbage);
      expect(readPanelMode("pk_test_a")).toBe("floating");
    }
  });

  it("notifies same-tab subscribers on every write", () => {
    const heard: string[] = [];
    const unsubscribe = subscribePanelMode(() => {
      heard.push(readPanelMode("pk_test_a"));
    });

    writePanelMode("pk_test_a", "sidebar");
    writePanelMode("pk_test_a", "floating");
    unsubscribe();
    writePanelMode("pk_test_a", "sidebar");

    expect(heard).toEqual(["sidebar", "floating"]);
  });

  it("survives blocked storage without throwing", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => {
      writePanelMode("pk_test_a", "sidebar");
    }).not.toThrow();
    expect(readPanelMode("pk_test_a")).toBe("floating");
  });

  it("still notifies subscribers when storage is blocked", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("blocked");
    });
    const listener = vi.fn();
    const unsubscribe = subscribePanelMode(listener);

    writePanelMode("pk_test_a", "sidebar");
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("survives resetAssistant — the mode is a device preference, not identity state", () => {
    writePanelMode("pk_test_a", "sidebar");

    resetAssistant({ publishableKey: "pk_test_a" });

    expect(readPanelMode("pk_test_a")).toBe("sidebar");
  });
});
