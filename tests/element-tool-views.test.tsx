// @vitest-environment jsdom
/**
 * The script-tag registration door, end to end through the page
 * element: a `toolViews` registry assigned as a JS property — before or
 * after the element upgrades — travels the real provider and context
 * into a real ToolRow, mounts a vanilla imperative adapter inside the
 * shadow root, stays scoped to its own element, drops garbage at the
 * door, and inherits exactly the React adapters' error boundary. The
 * page element is the vehicle because its lazy surface is mockable
 * while the provider stays real; the door itself (AssistantElementBase
 * + element-config) is shared with the widget verbatim.
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Force the mocked page chunk (an async factory with real imports of
// its own) to finish loading before any test runs, so a settle only has
// to drain React's lazy resolution, not the module graph.
import "../src/components/assistant-page";
import {
  defineTeaflaskAssistantPageElement,
  TeaflaskAssistantPageElement,
} from "../src/element/assistant-page-element";
import { PAGE_ELEMENT_TAG_NAME } from "../src/element/element-config";
import type { ToolViewAdapter, ToolViewRegistry } from "../src/core/tool-view";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// MessageList's viewport machinery observes element resizes; jsdom has
// no ResizeObserver, and this suite reads structure.
class ResizeObserverStub {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
  ResizeObserverStub;

vi.mock("../src/transport/token-session", () => ({
  TokenSession: class {
    dispose(): void {
      // Nothing to release — the suite never opens anything.
    }
    authorizedFetch(): Promise<never> {
      return Promise.reject(
        new Error("The element tool-view suite never touches the network."),
      );
    }
  },
}));

// The page surface is the element's lazy chunk; this suite swaps it for
// a REAL ToolRow over the canned completed call, annotated with a wire
// view ref — so the registry's whole journey (property → upgrade
// reclaim → resolver → provider → context → presenter → slot) runs on
// production code, and only the transcript around the row is stubbed.
vi.mock("../src/components/assistant-page", async () => {
  const { ToolRow } = await import("../src/components/tool-row");
  const { useAssistantAppearance } =
    await import("../src/components/appearance-context");
  const { COMPLETED_TOOL_CALL } =
    await import("../fixtures/transcript/canned-data");
  const ANNOTATED = {
    ...COMPLETED_TOOL_CALL,
    display: {
      ...COMPLETED_TOOL_CALL.display,
      view: { key: "northwind.inventory-check", version: 1 },
    },
  };
  return {
    // The real surface's contract inch that matters here: every
    // data-tf-assistant root spreads the provider's rootProps, which is
    // where the `mode` attribute lands as in-shadow data-tf-theme — the
    // stub must keep that carrier or no theme signal reaches the DOM.
    AssistantPage: () => {
      const { rootProps } = useAssistantAppearance();
      return (
        <div data-tf-assistant="" {...rootProps}>
          <ToolRow view={ANNOTATED} />
        </div>
      );
    },
  };
});

const VIEW_KEY = "northwind.inventory-check";
const STYLESHEET_TEXT = "[data-tf-assistant]{color:rgb(1,2,3)}";

// The upgrade-order test needs an element that existed BEFORE the
// definition loaded — so the definition happens lazily, inside the
// first test, not at module scope.
function defineElement(): void {
  defineTeaflaskAssistantPageElement({ cssText: STYLESHEET_TEXT });
}

function elementOf(publishableKey: string): TeaflaskAssistantPageElement {
  const element = document.createElement(
    PAGE_ELEMENT_TAG_NAME,
  ) as TeaflaskAssistantPageElement;
  element.setAttribute("publishable-key", publishableKey);
  return element;
}

/**
 * A vanilla imperative adapter — plain DOM, no React — with counters,
 * so a test can tell a live in-place update from a fresh mount.
 *
 * DELIVERY-SEMANTICS ENUMERATION. The slot calls `mount` with the
 * call's CURRENT props and delivers `update` only when the delivery
 * actually changes (`_sameDelivery`, tool-view-slot.tsx compares the
 * call fields AND context.themeMode) — so an example adapter must
 * render from mount's props (a late registration mounts onto an
 * already-settled call that may never update) and must re-read call
 * AND context on update. Every adapter this diff ships, classified
 * against that:
 *
 * - README "Custom tool views from a script tag" `inventoryView`:
 *   one render path fed at mount and passed whole to `update` — reads
 *   call at mount, re-reads the full delivery on update.
 * - fixtures/element/tool-views `inventoryView`: same shape — renders
 *   from mount props, `update: render` re-reads call and context.
 * - fixtures/element/tool-views `inventoryIcon`: paints from mount's
 *   props and repaints from the delivery on update (round 3 — its
 *   fallback color tracks context.themeMode, so a no-op update would
 *   now be an omission).
 * - this file's `countingAdapter`: renders from mount props; update
 *   re-reads next.call.status and next.context.themeMode.
 * - this file's icon adapter (static dot — genuinely reads no delivery
 *   field) and throwing `kaboom` adapter: no rendering to classify.
 *
 * The cases that would break the class, all exercised below:
 * "renders a registry assigned before the definition loaded" mounts
 * onto an already-settled call that never receives an update at all
 * (the mount-time text is the assertion); "delivers a context-only
 * theme change…" flips themeMode with the call unchanged via the
 * document root; and "delivers the element's OWN mode flip…" poses the
 * in-shadow signal a document-level observer cannot see.
 */
function countingAdapter(label: string) {
  const counters = { mounts: 0, updates: 0, destroys: 0 };
  const adapter: ToolViewAdapter = {
    mount(container, props) {
      counters.mounts += 1;
      const line = container.ownerDocument.createElement("p");
      line.dataset.vanillaView = label;
      line.textContent = `${label}: ${props.call.toolName} (${props.context.themeMode})`;
      container.append(line);
      return {
        update(next) {
          counters.updates += 1;
          line.textContent = `${label}: ${next.call.status} (${next.context.themeMode})`;
        },
        destroy() {
          counters.destroys += 1;
          line.remove();
        },
      };
    },
  };
  return { adapter, counters };
}

function registryOf(adapter: ToolViewAdapter): ToolViewRegistry {
  return { [VIEW_KEY]: { version: 1, view: adapter } };
}

/** The lazy chunk resolves on a microtask; the slot then defers each
 *  adapter call one more microtask past the commit — so a settle drains
 *  microtasks AND one macrotask before reading the shadow DOM. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let drain = 0; drain < 5; drain += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

async function connectAndSettle(element: HTMLElement): Promise<void> {
  await act(async () => {
    document.body.appendChild(element);
    await Promise.resolve();
  });
  await settle();
}

async function disconnectAndSettle(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.remove();
    await Promise.resolve();
  });
}

function slotIn(element: HTMLElement): Element | null {
  return (
    element.shadowRoot?.querySelector(`[data-tf-tool-view="${VIEW_KEY}"]`) ??
    null
  );
}

function headlineIn(element: HTMLElement): Element | undefined {
  return [...(element.shadowRoot?.querySelectorAll("span") ?? [])].find(
    (span) => span.textContent.startsWith("Searched your docs"),
  );
}

let mounted: HTMLElement[] = [];

function track<Tracked extends HTMLElement>(element: Tracked): Tracked {
  mounted.push(element);
  return element;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
});

afterEach(async () => {
  for (const element of mounted) {
    await disconnectAndSettle(element);
  }
  mounted = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the registration door", () => {
  it("renders a registry assigned before the definition loaded", async () => {
    const { adapter, counters } = countingAdapter("Inventory");
    const element = track(elementOf("pk_test_tool_views_upgrade"));
    // Before defineElement() this is a plain expando on an unknown
    // element — the exact shape a "register first, load the bundle
    // second" host page produces, script order being nobody's to
    // control.
    (element as { toolViews?: unknown }).toolViews = registryOf(adapter);
    document.body.appendChild(element);

    await act(async () => {
      defineElement();
      await Promise.resolve();
    });
    await settle();

    const slot = slotIn(element);
    expect(slot).not.toBeNull();
    expect(slot?.textContent).toContain("Inventory: docs_search (light)");
    expect(counters.mounts).toBe(1);
    // The expando was reclaimed through the accessor, not left shadowing
    // it.
    expect(Object.prototype.hasOwnProperty.call(element, "toolViews")).toBe(
      false,
    );
  });

  it("delivers a late registration to the already-mounted call in place", async () => {
    const { adapter, counters } = countingAdapter("Inventory");
    const element = track(elementOf("pk_test_tool_views_late"));
    await connectAndSettle(element);

    // Nothing registered: no slot, and the row shows the package default
    // reading of the call's input.
    expect(slotIn(element)).toBeNull();
    expect(element.shadowRoot?.textContent).toContain("steeping sencha");
    const headline = headlineIn(element);
    expect(headline).not.toBeUndefined();
    // Stamp the live React-owned node. If a late registration remounted
    // the tree instead of updating it, a fresh node would lose this — so
    // the stamp is what separates "reached the mounted call" from a
    // final state a fresh mount would also produce.
    (headline as HTMLElement).dataset.probe = "live";

    await act(async () => {
      element.toolViews = registryOf(adapter);
      await Promise.resolve();
    });
    await settle();

    expect(headlineIn(element)).toBe(headline);
    expect((headline as HTMLElement).dataset.probe).toBe("live");
    const slot = slotIn(element);
    expect(slot).not.toBeNull();
    expect(slot?.textContent).toContain("Inventory: docs_search (light)");
    expect(counters.mounts).toBe(1);
    expect(counters.destroys).toBe(0);
  });

  it("mounts a registered icon in the operation mark", async () => {
    const view = countingAdapter("Inventory");
    const icon: ToolViewAdapter = {
      mount(container) {
        const dot = container.ownerDocument.createElement("span");
        dot.dataset.vanillaIcon = "inventory-dot";
        container.append(dot);
        return {
          update: () => undefined,
          destroy: () => {
            dot.remove();
          },
        };
      },
    };
    const element = track(elementOf("pk_test_tool_views_icon"));
    element.toolViews = {
      [VIEW_KEY]: { version: 1, view: view.adapter, icon },
    };
    await connectAndSettle(element);

    const iconSlot = element.shadowRoot?.querySelector(
      `[data-tf-tool-view-icon="${VIEW_KEY}"]`,
    );
    expect(iconSlot).not.toBeNull();
    expect(
      iconSlot?.querySelector('[data-vanilla-icon="inventory-dot"]'),
    ).not.toBeNull();
  });

  it("delivers a context-only theme change to the mounted adapter", async () => {
    // The class-breaking case for adapters that only re-read the call:
    // the call does not change at all — only context.themeMode flips —
    // and the slot still delivers an update (_sameDelivery compares the
    // context too). An adapter that ignores next.context reports the
    // wrong mode forever.
    const { adapter, counters } = countingAdapter("Inventory");
    const element = track(elementOf("pk_test_tool_views_theme"));
    element.toolViews = registryOf(adapter);
    await connectAndSettle(element);
    expect(slotIn(element)?.textContent).toContain("(light)");
    expect(counters.mounts).toBe(1);

    try {
      await act(async () => {
        document.documentElement.dataset.tfTheme = "dark";
        await Promise.resolve();
      });
      await settle();

      expect(counters.updates).toBeGreaterThanOrEqual(1);
      expect(counters.mounts).toBe(1);
      expect(slotIn(element)?.textContent).toContain("(dark)");
    } finally {
      delete document.documentElement.dataset.tfTheme;
    }
  });

  it("delivers the element's OWN mode flip to the mounted adapter", async () => {
    // The shadow-side breaking case the documentElement flip above
    // cannot pose: `element.setAttribute("mode", "dark")` lands
    // data-tf-theme on the IN-SHADOW widget root, where a document-level
    // subtree observer cannot see — the mode resolver must watch the
    // slot's own shadow root too, or every mounted adapter keeps a stale
    // themeMode while the surface repaints dark around it.
    const { adapter, counters } = countingAdapter("Inventory");
    const element = track(elementOf("pk_test_tool_views_mode"));
    element.toolViews = registryOf(adapter);
    await connectAndSettle(element);
    expect(slotIn(element)?.textContent).toContain("(light)");
    expect(counters.mounts).toBe(1);

    await act(async () => {
      element.setAttribute("mode", "dark");
      await Promise.resolve();
    });
    await settle();

    expect(counters.mounts).toBe(1);
    expect(counters.updates).toBeGreaterThanOrEqual(1);
    expect(slotIn(element)?.textContent).toContain("(dark)");
  });

  it("delivers the element's mode flip to a LATE-registered icon adapter", async () => {
    // Round-4 dispute, settled by execution: one reviewer held that an
    // icon slot's ref is attached only while an icon is active, so the
    // shadow theme observer (sampled once at effect time) never installs
    // for an icon that resolves late; another traced that a late
    // registration mounts ToolViewIconSlot fresh — tool-row.tsx renders
    // it only when icon candidates exist and active is computed during
    // render — so the ref IS attached at the slot's first commit and the
    // observer installs then. This test poses the exact disputed
    // scenario: registry (view + icon) assigned late onto a call already
    // on screen, then the element's own mode flip, asserting the icon
    // adapter's delivered themeMode.
    const view = countingAdapter("Inventory");
    const iconCounters = { mounts: 0, updates: 0 };
    const icon: ToolViewAdapter = {
      mount(container, props) {
        iconCounters.mounts += 1;
        const dot = container.ownerDocument.createElement("span");
        dot.dataset.vanillaIcon = "themed-dot";
        dot.dataset.iconMode = props.context.themeMode;
        container.append(dot);
        return {
          update(next) {
            iconCounters.updates += 1;
            dot.dataset.iconMode = next.context.themeMode;
          },
          destroy() {
            dot.remove();
          },
        };
      },
    };
    const element = track(elementOf("pk_test_tool_views_late_icon"));
    await connectAndSettle(element);
    // Nothing registered: the package glyph, no icon slot at all.
    expect(
      element.shadowRoot?.querySelector("[data-tf-tool-view-icon]"),
    ).toBeNull();

    await act(async () => {
      element.toolViews = {
        [VIEW_KEY]: { version: 1, view: view.adapter, icon },
      };
      await Promise.resolve();
    });
    await settle();
    const dot = element.shadowRoot?.querySelector<HTMLElement>(
      '[data-vanilla-icon="themed-dot"]',
    );
    expect(dot?.dataset.iconMode).toBe("light");
    expect(iconCounters.mounts).toBe(1);

    await act(async () => {
      element.setAttribute("mode", "dark");
      await Promise.resolve();
    });
    await settle();

    expect(iconCounters.mounts).toBe(1);
    expect(
      element.shadowRoot?.querySelector<HTMLElement>(
        '[data-vanilla-icon="themed-dot"]',
      )?.dataset.iconMode,
    ).toBe("dark");
  });

  it("keeps two elements' registries separate", async () => {
    const alpha = countingAdapter("Alpha");
    const beta = countingAdapter("Beta");
    const first = track(elementOf("pk_test_tool_views_first"));
    first.toolViews = registryOf(alpha.adapter);
    const second = track(elementOf("pk_test_tool_views_second"));
    second.toolViews = registryOf(beta.adapter);
    await connectAndSettle(first);
    await connectAndSettle(second);

    expect(slotIn(first)?.textContent).toContain("Alpha:");
    expect(slotIn(first)?.textContent).not.toContain("Beta:");
    expect(slotIn(second)?.textContent).toContain("Beta:");
    expect(slotIn(second)?.textContent).not.toContain("Alpha:");
    // One mount each — neither adapter crossed into the other's shadow.
    expect(alpha.counters.mounts).toBe(1);
    expect(beta.counters.mounts).toBe(1);
  });

  it("drops garbage at the door: good keys work, bad ones warn, nothing reaches the boundary", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onError = vi.fn();
    const good = countingAdapter("Inventory");
    const evilMount = vi.fn();
    const element = track(elementOf("pk_test_tool_views_garbage"));
    element.onError = onError;
    element.toolViews = {
      ...registryOf(good.adapter),
      "teaflask.evil": { version: 1, view: { mount: evilMount } },
      broken: { version: 1, view: {} },
    } as unknown as ToolViewRegistry;
    await connectAndSettle(element);

    expect(slotIn(element)?.textContent).toContain("Inventory:");
    const warned = warn.mock.calls.map((call) => String(call[0]));
    expect(
      warned.some((line) => line.includes('toolViews["teaflask.evil"]')),
    ).toBe(true);
    expect(warned.some((line) => line.includes('toolViews["broken"]'))).toBe(
      true,
    );
    // Dropped at the door, not caught downstream: the reserved adapter
    // never mounted and the error boundary never had anything to report.
    expect(evilMount).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("isolates a throwing vanilla adapter exactly like a React one", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const onError = vi.fn();
    const kaboom: ToolViewAdapter = {
      mount() {
        throw new Error("the inventory view exploded on mount");
      },
    };
    const element = track(elementOf("pk_test_tool_views_throw"));
    element.onError = onError;
    element.toolViews = registryOf(kaboom);
    await connectAndSettle(element);

    // The ladder advanced to its terminal; the transcript did not crash.
    // The slot survives but no longer wears the failed key, so the query
    // is by the slot's presence, not the key. The terminal is the
    // package default view's bounded argument reading (the row has no
    // quiet-line override).
    const terminal = element.shadowRoot?.querySelector("[data-tf-tool-view]");
    expect(
      terminal?.querySelector("[data-tf-approval-request-summary]"),
    ).not.toBeNull();
    expect(terminal?.textContent).toContain("Request");
    expect(element.shadowRoot?.textContent).toContain("Searched your docs");
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "the inventory view exploded on mount",
      }),
    );
    expect(
      consoleError.mock.calls.some((call) =>
        String(call[0]).includes(`The tool view "${VIEW_KEY}" threw`),
      ),
    ).toBe(true);
  });
});
