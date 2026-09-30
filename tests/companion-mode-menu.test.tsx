// @vitest-environment jsdom
/**
 * The drawer header's mode switcher: an icon in the reserved slot drops
 * a two-row menu (Floating / Sidebar, check on the active row), the pick
 * persists per publishable key and re-geometries the panel, and below
 * the sidebar's viewport floor the switcher disappears and floating is
 * forced — the stored preference untouched. jsdom has no popover API, so
 * the reflow itself never runs here (see dock-reflow.test.ts); this
 * suite pins the chrome: attributes, persistence, and menu discipline.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantCompanion } from "../src/components/assistant-companion";
import { TeaflaskAssistantProvider } from "../src/components/teaflask-assistant-provider";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../src/transport/token-session", () => ({
  TokenSession: class {
    dispose(): void {
      // Nothing to release — the suite never opens anything.
    }
    authorizedFetch(): Promise<never> {
      return Promise.reject(
        new Error("The mode-menu suite never touches the network."),
      );
    }
  },
}));

vi.mock("../src/transport/serving-api", () => ({
  getAssistantThread: vi.fn(() => new Promise(() => undefined)),
  listAssistantThreads: vi.fn(() => Promise.resolve([])),
  sendAssistantMessage: vi.fn(),
  resolveTurnApproval: vi.fn(),
  resolveTurnToolResults: vi.fn(),
  streamUrlForThread: vi.fn(
    () => "https://api.example.test/serving/v1/assistant-threads/x/stream",
  ),
}));

// The drawer body is the lazy CopilotKit-reaching half — stubbed so the
// suite exercises the header, not the transcript.
vi.mock("../src/components/companion-drawer-body", () => ({
  default: () => <div data-testid="drawer-body" />,
}));

let container: HTMLDivElement;
let root: Root;
// The session registry is a module singleton keyed on publishableKey —
// a fresh key per test keeps one test's store from bleeding into the
// next.
let testSerial = 0;

function publishableKey(): string {
  return `pk_test_mode_${String(testSerial)}`;
}

/** A live viewport stub: min-width queries read the mutable flag and
 *  hear change events, so a test can cross the sidebar floor mid-render
 *  the way a real resize does. Every other query — reduced motion —
 *  stays false. */
let sidebarFits = true;
const viewportListeners = new Set<() => void>();

function stubViewport(): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        get matches() {
          return query.includes("min-width") && sidebarFits;
        },
        media: query,
        addEventListener: (_type: string, listener: () => void) => {
          if (query.includes("min-width")) {
            viewportListeners.add(listener);
          }
        },
        removeEventListener: (_type: string, listener: () => void) => {
          viewportListeners.delete(listener);
        },
      }) as unknown as MediaQueryList,
  );
}

function resizeViewport(fits: boolean): void {
  sidebarFits = fits;
  act(() => {
    for (const listener of [...viewportListeners]) {
      listener();
    }
  });
}

beforeEach(() => {
  testSerial += 1;
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.clearAllMocks();
  sidebarFits = true;
  viewportListeners.clear();
  stubViewport();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

function renderCompanion(options?: { identified: boolean }): void {
  act(() => {
    root.render(
      <TeaflaskAssistantProvider
        publishableKey={publishableKey()}
        getEndUserToken={
          options?.identified === true ? () => "end-user-token" : undefined
        }
      >
        <AssistantCompanion />
      </TeaflaskAssistantProvider>,
    );
  });
}

function query(selector: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(selector);
}

function buttonByText(text: string): HTMLButtonElement | null {
  return (
    [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === text,
    ) ?? null
  );
}

async function openDrawer(): Promise<void> {
  await act(async () => {
    query('button[aria-label="Open assistant"]')?.click();
    await Promise.resolve();
  });
}

function modeTrigger(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(
    'button[aria-label="Panel position"]',
  );
}

function clickModeTrigger(): void {
  const trigger = modeTrigger();
  if (trigger === null) {
    throw new Error("No mode switcher in the header.");
  }
  act(() => {
    trigger.click();
  });
}

function menu(): HTMLElement | null {
  return query('[role="dialog"][aria-label="Panel position"]');
}

function panel(): HTMLElement | null {
  return query("[data-tf-floating-panel]");
}

describe("the mode switcher", () => {
  it("renders for anonymous visitors with disclosure wiring — mode is chrome, not history", async () => {
    renderCompanion();
    await openDrawer();

    const trigger = modeTrigger();
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(trigger?.getAttribute("aria-controls")).toBeTruthy();
    expect(panel()?.getAttribute("data-tf-panel-dock")).toBe("floating");
  });

  it("drops open a two-row menu with the check on the active mode", async () => {
    renderCompanion();
    await openDrawer();
    clickModeTrigger();

    expect(modeTrigger()?.getAttribute("aria-expanded")).toBe("true");
    expect(menu()).not.toBeNull();
    expect(buttonByText("Floating")?.getAttribute("aria-pressed")).toBe("true");
    expect(buttonByText("Sidebar")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("picking Sidebar docks the panel, persists the choice, and hands focus back to the trigger", async () => {
    renderCompanion();
    await openDrawer();
    clickModeTrigger();

    act(() => {
      buttonByText("Sidebar")?.click();
    });

    expect(menu()).toBeNull();
    expect(panel()?.getAttribute("data-tf-panel-dock")).toBe("sidebar");
    expect(
      window.localStorage.getItem(
        `tf-assistant:${publishableKey()}:panel-mode`,
      ),
    ).toBe("sidebar");
    expect(document.activeElement).toBe(modeTrigger());
  });

  it("picking Floating removes the stored record — the default keeps none", async () => {
    renderCompanion();
    await openDrawer();
    clickModeTrigger();
    act(() => {
      buttonByText("Sidebar")?.click();
    });
    clickModeTrigger();

    act(() => {
      buttonByText("Floating")?.click();
    });

    expect(panel()?.getAttribute("data-tf-panel-dock")).toBe("floating");
    expect(
      window.localStorage.getItem(
        `tf-assistant:${publishableKey()}:panel-mode`,
      ),
    ).toBeNull();
  });

  it("a persisted sidebar opens already docked", async () => {
    window.localStorage.setItem(
      `tf-assistant:${publishableKey()}:panel-mode`,
      "sidebar",
    );
    renderCompanion();
    await openDrawer();

    expect(panel()?.getAttribute("data-tf-panel-dock")).toBe("sidebar");
    expect(buttonByText("Sidebar")).toBeNull(); // menu closed until asked
  });

  it("Esc closes the menu but not the drawer", async () => {
    renderCompanion();
    await openDrawer();
    clickModeTrigger();

    act(() => {
      buttonByText("Floating")?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(menu()).toBeNull();
    expect(query('[data-testid="drawer-body"]')).not.toBeNull();
  });

  it("a press outside the menu closes it", async () => {
    renderCompanion();
    await openDrawer();
    clickModeTrigger();
    expect(menu()).not.toBeNull();

    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    expect(menu()).toBeNull();
    expect(query('[data-testid="drawer-body"]')).not.toBeNull();
  });

  it("one disclosure at a time: opening either menu takes the other down", async () => {
    renderCompanion({ identified: true });
    await openDrawer();

    // The title disclosure — the header's other aria-controls trigger.
    const historyTrigger = [
      ...container.querySelectorAll<HTMLButtonElement>("button[aria-controls]"),
    ].find((button) => button !== modeTrigger());
    expect(historyTrigger).not.toBeUndefined();

    act(() => {
      historyTrigger?.click();
    });
    expect(query('[aria-label="Conversation history"]')).not.toBeNull();

    clickModeTrigger();

    expect(menu()).not.toBeNull();
    expect(query('[aria-label="Conversation history"]')).toBeNull();

    act(() => {
      historyTrigger?.click();
    });

    expect(query('[aria-label="Conversation history"]')).not.toBeNull();
    expect(menu()).toBeNull();
  });

  it("a menu open when the viewport drops below the floor does not pop back open above it", async () => {
    renderCompanion();
    await openDrawer();
    clickModeTrigger();
    expect(menu()).not.toBeNull();

    resizeViewport(false);

    expect(modeTrigger()).toBeNull();
    expect(menu()).toBeNull();

    resizeViewport(true);

    expect(menu()).toBeNull();
    expect(modeTrigger()?.getAttribute("aria-expanded")).toBe("false");
  });

  it("below the viewport floor the switcher is gone and floating is forced — the preference survives", async () => {
    window.localStorage.setItem(
      `tf-assistant:${publishableKey()}:panel-mode`,
      "sidebar",
    );
    sidebarFits = false;
    renderCompanion();
    await openDrawer();

    expect(modeTrigger()).toBeNull();
    expect(panel()?.getAttribute("data-tf-panel-dock")).toBe("floating");
    expect(
      window.localStorage.getItem(
        `tf-assistant:${publishableKey()}:panel-mode`,
      ),
    ).toBe("sidebar");
  });
});
