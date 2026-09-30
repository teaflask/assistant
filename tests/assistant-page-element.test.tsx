// @vitest-environment jsdom
/**
 * The page element's lifecycle, mirroring the widget element's suite:
 * define-once, shadow mount with both sheets adopted (package + the
 * :host sizing), the upgrade reclaim, attribute changes flowing into
 * AssistantPage's props with the frameless truth table guarded, and the
 * reparent/disconnect story. The page surface itself is a stub — its
 * rendering is the page suite's subject; here it only needs to mount
 * and echo the props it was handed.
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  defineTeaflaskAssistantPageElement,
  TeaflaskAssistantPageElement,
} from "../src/element/assistant-page-element";
import { PAGE_ELEMENT_TAG_NAME } from "../src/element/element-config";

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

// The page surface is the lazy chunk this element mounts; the stub
// echoes the two attribute-borne props so the suite can watch them land.
vi.mock("../src/components/assistant-page", () => ({
  AssistantPage: (props: { title?: string; frameless?: boolean }) => (
    <div
      data-testid="assistant-page"
      data-title={props.title ?? "unset"}
      data-frameless={
        props.frameless === undefined ? "unset" : String(props.frameless)
      }
    />
  ),
}));

const STYLESHEET_TEXT = "[data-tf-assistant]{color:rgb(1,2,3)}";

// The upgrade-order test needs an element that existed BEFORE the
// definition loaded — so the definition happens lazily, inside the
// first test, not at module scope.
function defineElement(): void {
  defineTeaflaskAssistantPageElement({ cssText: STYLESHEET_TEXT });
}

function elementOf(
  attributes: Record<string, string> = { "publishable-key": "pk_test_page_el" },
): TeaflaskAssistantPageElement {
  const element = document.createElement(
    PAGE_ELEMENT_TAG_NAME,
  ) as TeaflaskAssistantPageElement;
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  return element;
}

// The page body arrives through React.lazy even when mocked — a connect
// needs the chunk's microtask to resolve before the stub is in-shadow.
async function connectAndSettle(element: HTMLElement): Promise<void> {
  await act(async () => {
    document.body.appendChild(element);
    await Promise.resolve();
  });
}

async function disconnectAndSettle(element: HTMLElement): Promise<void> {
  // The teardown rides a microtask; the awaited resolve queues after it.
  await act(async () => {
    element.remove();
    await Promise.resolve();
  });
}

function pageIn(element: HTMLElement): Element | null {
  return (
    element.shadowRoot?.querySelector('[data-testid="assistant-page"]') ?? null
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
});

afterEach(async () => {
  for (const element of mounted) {
    await disconnectAndSettle(element);
  }
  mounted = [];
  vi.restoreAllMocks();
});

describe("the upgrade", () => {
  it("re-routes a property assigned before the definition loaded", async () => {
    const element = track(elementOf());
    const navigate = () => undefined;
    // Before defineElement() this is a plain expando on an unknown
    // element — the exact shape every "set the property, then load the
    // script" host produces.
    (element as { onNavigate?: unknown }).onNavigate = navigate;
    document.body.appendChild(element);

    await act(async () => {
      defineElement();
      await Promise.resolve();
    });

    expect(element.onNavigate).toBe(navigate);
    expect(Object.prototype.hasOwnProperty.call(element, "onNavigate")).toBe(
      false,
    );
    expect(pageIn(element)).not.toBeNull();
  });

  it("keeps the first registration when the bundle loads twice", () => {
    defineElement();
    expect(() => {
      defineTeaflaskAssistantPageElement({ cssText: "/* second load */" });
    }).not.toThrow();
    expect(customElements.get(PAGE_ELEMENT_TAG_NAME)).toBe(
      TeaflaskAssistantPageElement,
    );
  });
});

describe("the shadow mount", () => {
  it("adopts the package sheet plus its own :host sizing sheet", async () => {
    defineElement();
    const element = track(elementOf());
    await connectAndSettle(element);

    const shadow = element.shadowRoot;
    expect(shadow).not.toBeNull();
    // The second sheet is the page element's own: custom elements lay
    // out inline by default, which would collapse the host's sized box.
    expect(shadow?.adoptedStyleSheets).toHaveLength(2);
    const hostSheetRules = [...(shadow?.adoptedStyleSheets[1]?.cssRules ?? [])]
      .map((rule) => rule.cssText)
      .join(" ");
    expect(hostSheetRules).toContain(":host");
    expect(hostSheetRules).toContain("display: block");
    expect(pageIn(element)).not.toBeNull();
    // Nothing leaked into the light DOM.
    expect(element.childNodes).toHaveLength(0);
  });

  it("renders nothing (and says so once) without a publishable key", async () => {
    defineElement();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const element = track(elementOf({}));
    await connectAndSettle(element);

    expect(pageIn(element)).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        `<${PAGE_ELEMENT_TAG_NAME}> has no publishable-key`,
      ),
    );

    // The late-arriving key mounts the tree.
    await act(async () => {
      element.setAttribute("publishable-key", "pk_test_page_late");
      await Promise.resolve();
    });
    expect(pageIn(element)).not.toBeNull();
  });

  it("carries heading and frameless attribute changes into the page", async () => {
    defineElement();
    const element = track(elementOf());
    await connectAndSettle(element);
    expect(pageIn(element)?.getAttribute("data-title")).toBe("unset");
    expect(pageIn(element)?.getAttribute("data-frameless")).toBe("unset");

    await act(async () => {
      element.setAttribute("heading", "Acme Help");
      element.setAttribute("frameless", "");
      await Promise.resolve();
    });

    expect(pageIn(element)?.getAttribute("data-title")).toBe("Acme Help");
    expect(pageIn(element)?.getAttribute("data-frameless")).toBe("true");
  });

  it("warns once and degrades an unrecognized frameless value", async () => {
    defineElement();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const element = track(elementOf());
    await connectAndSettle(element);

    await act(async () => {
      element.setAttribute("frameless", "ture");
      await Promise.resolve();
    });

    expect(pageIn(element)?.getAttribute("data-frameless")).toBe("unset");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('frameless "ture"'),
    );
  });

  it("mounts a second page element without complaint", async () => {
    // N concurrent surfaces on one store is the design; only the widget
    // (hotkey, companion) warns about a doubled instance.
    defineElement();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const first = track(elementOf());
    const second = track(elementOf());
    await connectAndSettle(first);
    await connectAndSettle(second);

    expect(pageIn(first)).not.toBeNull();
    expect(pageIn(second)).not.toBeNull();
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("A second"));
  });
});

describe("the lifecycle", () => {
  it("survives a synchronous reparent without tearing down", async () => {
    defineElement();
    const element = track(elementOf());
    await connectAndSettle(element);
    const otherParent = document.createElement("div");
    document.body.appendChild(otherParent);
    mounted.push(otherParent);

    await act(async () => {
      otherParent.appendChild(element);
      await Promise.resolve();
    });

    expect(element.isConnected).toBe(true);
    expect(pageIn(element)).not.toBeNull();
  });

  it("tears down on a real disconnect and remounts on reconnect", async () => {
    defineElement();
    const element = track(elementOf());
    await connectAndSettle(element);
    expect(pageIn(element)).not.toBeNull();

    await disconnectAndSettle(element);
    expect(pageIn(element)).toBeNull();

    await connectAndSettle(element);
    expect(pageIn(element)).not.toBeNull();
  });
});
