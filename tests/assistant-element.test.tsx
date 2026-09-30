// @vitest-environment jsdom
/**
 * The custom element's lifecycle: define-once, shadow mount with the
 * stylesheet adopted, attribute/property changes re-render, a property
 * assigned before the definition loads survives the upgrade, a
 * synchronous reparent is a non-event, and a real disconnect tears the
 * tree down. The React surfaces themselves are the other suites'
 * subject — here they only need to visibly mount.
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  defineTeaflaskAssistantElement,
  TeaflaskAssistantElement,
} from "../src/element/assistant-element";
import { ELEMENT_TAG_NAME } from "../src/element/element-config";

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
        new Error("The element suite never touches the network."),
      );
    }
  },
}));

// The transcript is the palette's body, not this suite's subject.
vi.mock("../src/components/conversation-view", () => ({
  ConversationView: () => <div data-testid="conversation-view" />,
  SetupErrorState: () => <div data-testid="setup-error" />,
}));

// The drawer body is the lazy transcript-reaching half of the companion.
vi.mock("../src/components/companion-drawer-body", () => ({
  default: () => <div data-testid="drawer-body" />,
}));

const STYLESHEET_TEXT = "[data-tf-assistant]{color:rgb(1,2,3)}";

// The upgrade-order test needs an element that existed BEFORE the
// definition loaded — so the definition happens lazily, inside the
// first test, not at module scope.
function defineElement(): void {
  defineTeaflaskAssistantElement({ cssText: STYLESHEET_TEXT });
}

function elementOf(
  attributes: Record<string, string> = { "publishable-key": "pk_test_el" },
): TeaflaskAssistantElement {
  const element = document.createElement(
    ELEMENT_TAG_NAME,
  ) as TeaflaskAssistantElement;
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  return element;
}

function connect(element: HTMLElement): void {
  act(() => {
    document.body.appendChild(element);
  });
}

async function disconnectAndSettle(element: HTMLElement): Promise<void> {
  // The teardown rides a microtask; the awaited resolve queues after it.
  await act(async () => {
    element.remove();
    await Promise.resolve();
  });
}

function dockIn(element: HTMLElement): Element | null {
  return element.shadowRoot?.querySelector("[data-tf-companion-dock]") ?? null;
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

describe("the upgrade", () => {
  it("re-routes a property assigned before the definition loaded", () => {
    const element = track(elementOf());
    const navigate = () => undefined;
    // Before defineElement() this is a plain expando on an unknown
    // element — the exact shape every "set the property, then load the
    // script" host produces.
    (element as { onNavigate?: unknown }).onNavigate = navigate;
    document.body.appendChild(element);

    act(() => {
      defineElement();
    });

    expect(element.onNavigate).toBe(navigate);
    expect(Object.prototype.hasOwnProperty.call(element, "onNavigate")).toBe(
      false,
    );
    expect(dockIn(element)).not.toBeNull();
  });

  it("keeps the first registration when the bundle loads twice", () => {
    defineElement();
    expect(() => {
      defineTeaflaskAssistantElement({ cssText: "/* second load */" });
    }).not.toThrow();
    expect(customElements.get(ELEMENT_TAG_NAME)).toBe(TeaflaskAssistantElement);
  });
});

describe("the shadow mount", () => {
  it("adopts the stylesheet and mounts the batteries root in-shadow", () => {
    defineElement();
    const element = track(elementOf());
    connect(element);

    const shadow = element.shadowRoot;
    expect(shadow).not.toBeNull();
    expect(shadow?.adoptedStyleSheets).toHaveLength(1);
    expect(dockIn(element)).not.toBeNull();
    // Nothing leaked into the light DOM.
    expect(element.childNodes).toHaveLength(0);
  });

  it("renders nothing (and says so once) without a publishable key", async () => {
    defineElement();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const element = track(elementOf({}));
    connect(element);
    await act(async () => {
      await Promise.resolve();
    });

    expect(dockIn(element)).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("no publishable-key"),
    );

    // The late-arriving key mounts the tree; the warn-once ledger keeps
    // a re-check from repeating the complaint.
    act(() => {
      element.setAttribute("publishable-key", "pk_test_late");
    });
    expect(dockIn(element)).not.toBeNull();
  });

  it("re-renders on attribute change", () => {
    defineElement();
    const element = track(elementOf());
    connect(element);
    expect(
      element.shadowRoot?.querySelector('[data-tf-theme="dark"]'),
    ).toBeNull();

    act(() => {
      element.setAttribute("mode", "dark");
    });

    expect(
      element.shadowRoot?.querySelector(
        '[data-tf-assistant][data-tf-theme="dark"]',
      ),
    ).not.toBeNull();
  });

  it("companion-mark-src puts the host's image on the perch, inside the host-view marker, and follows the attribute", () => {
    defineElement();
    const element = track(
      elementOf({
        "publishable-key": "pk_test_el",
        "companion-mark-src": "https://cdn.test/mark.svg",
      }),
    );
    connect(element);

    const image = element.shadowRoot?.querySelector<HTMLImageElement>(
      "[data-tf-companion-body] [data-tf-companion-mark] [data-tf-host-view] img",
    );
    expect(image?.getAttribute("src")).toBe("https://cdn.test/mark.svg");
    expect(image?.getAttribute("alt")).toBe("");
    expect(image?.getAttribute("draggable")).toBe("false");
    expect(
      element.shadowRoot?.querySelector("[data-tf-agent-mark]"),
    ).toBeNull();

    act(() => {
      element.setAttribute("companion-mark-src", "https://cdn.test/other.svg");
    });

    expect(
      element.shadowRoot
        ?.querySelector("[data-tf-companion-body] [data-tf-host-view] img")
        ?.getAttribute("src"),
    ).toBe("https://cdn.test/other.svg");
  });

  it("a companion-mark-src that fails to load warns once and falls back to the flask", () => {
    defineElement();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const element = track(
      elementOf({
        "publishable-key": "pk_test_el",
        "companion-mark-src": "https://cdn.test/missing.svg",
      }),
    );
    connect(element);
    const image = element.shadowRoot?.querySelector(
      "[data-tf-companion-body] [data-tf-companion-mark] [data-tf-host-view] img",
    );
    expect(image).not.toBeNull();

    // jsdom fetches nothing, so the browser's failure signal is
    // dispatched by hand — the same `error` event a 404 or a CSP refusal
    // fires.
    act(() => {
      image?.dispatchEvent(new Event("error"));
    });

    expect(
      element.shadowRoot?.querySelector(
        '[data-tf-companion-body] [data-tf-companion-mark] [data-tf-agent-mark="primary"]',
      ),
    ).not.toBeNull();
    expect(
      element.shadowRoot?.querySelector("[data-tf-companion-body] img"),
    ).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("https://cdn.test/missing.svg");
    warn.mockRestore();
  });

  it("re-renders on property assignment after mount", () => {
    defineElement();
    const element = track(elementOf());
    connect(element);
    const navigate = () => undefined;

    act(() => {
      element.onNavigate = navigate;
    });

    expect(element.onNavigate).toBe(navigate);
    expect(dockIn(element)).not.toBeNull();
  });

  it("re-renders on a toolViews assignment and keeps getter honesty", () => {
    defineElement();
    const element = track(elementOf());
    connect(element);
    const registry = {
      "northwind.inventory-check": {
        version: 1,
        view: {
          mount: () => ({
            update: () => undefined,
            destroy: () => undefined,
          }),
        },
      },
    };

    act(() => {
      element.toolViews = registry;
    });

    // The host reads back exactly what it assigned (sanitization is the
    // resolver's, not the setter's), and nothing shadowed the accessor.
    expect(element.toolViews).toBe(registry);
    expect(Object.prototype.hasOwnProperty.call(element, "toolViews")).toBe(
      false,
    );
    expect(dockIn(element)).not.toBeNull();
  });

  it("warns by name on a reserved toolViews key, and still mounts", () => {
    // Pins the widget-side resolver actually running the sanitizer — the
    // page element has its own parity test in element-config.test.ts.
    defineElement();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const element = track(elementOf());
    connect(element);

    act(() => {
      element.toolViews = {
        "teaflask.widget-probe": {
          version: 1,
          view: {
            mount: () => ({
              update: () => undefined,
              destroy: () => undefined,
            }),
          },
        },
      };
    });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('toolViews["teaflask.widget-probe"]'),
    );
    expect(dockIn(element)).not.toBeNull();
  });

  it("mirrors a host ancestor's dark attribute into the shadow tree", () => {
    defineElement();
    document.body.setAttribute("data-tf-theme", "dark");
    try {
      const element = track(elementOf());
      connect(element);
      const wrapper = element.shadowRoot?.firstElementChild;
      expect(wrapper?.getAttribute("data-tf-theme")).toBe("dark");
    } finally {
      document.body.removeAttribute("data-tf-theme");
    }
  });
});

describe("the lifecycle", () => {
  it("survives a synchronous reparent without tearing down", async () => {
    defineElement();
    const element = track(elementOf());
    connect(element);
    const otherParent = document.createElement("div");
    document.body.appendChild(otherParent);
    mounted.push(otherParent);

    await act(async () => {
      otherParent.appendChild(element);
      await Promise.resolve();
    });

    expect(element.isConnected).toBe(true);
    expect(dockIn(element)).not.toBeNull();
  });

  it("tears down on a real disconnect and remounts on reconnect", async () => {
    defineElement();
    const element = track(elementOf());
    connect(element);
    expect(dockIn(element)).not.toBeNull();

    await disconnectAndSettle(element);
    expect(dockIn(element)).toBeNull();

    connect(element);
    expect(dockIn(element)).not.toBeNull();
  });

  it("openPalette() no-ops while unmounted", () => {
    defineElement();
    const element = elementOf();
    expect(() => {
      element.openPalette();
    }).not.toThrow();
  });
});
