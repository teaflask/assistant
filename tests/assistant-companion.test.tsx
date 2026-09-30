// @vitest-environment jsdom
/**
 * The companion presence widget: renders what the presence rule says,
 * yields to registered surfaces while STAYING subscribed, keeps one bare
 * mark at one size, opens the drawer without ever registering itself (no
 * self-yield), follows a tool navigation with the drawer open, and lets
 * a full surface taking the floor close the drawer for good.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  closeCompanionDrawer,
  openCompanionDrawer,
} from "../src/core/companion-drawer-flag";
import { assistantSurfaceRegistry } from "../src/core/surface-registry";
import { AssistantCompanion } from "../src/components/assistant-companion";
import { TeaflaskAssistantProvider } from "../src/components/teaflask-assistant-provider";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The sheet, comments stripped: jsdom does no layout, so the tests that
// pin geometry read the rules themselves.
const STYLES = readFileSync(
  path.resolve(import.meta.dirname, "../src/styles/styles.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

vi.mock("../src/transport/token-session", () => ({
  TokenSession: class {
    dispose(): void {
      // Nothing to release — the suite never opens anything.
    }
    authorizedFetch(): Promise<never> {
      return Promise.reject(
        new Error("The companion suite never touches the network."),
      );
    }
  },
}));

// The drawer body is the lazy CopilotKit-reaching half — stubbed so the
// suite exercises the boundary, not the transcript. Its welcome mark is
// companion-drawer-body.test.tsx's subject.
vi.mock("../src/components/companion-drawer-body", () => ({
  default: () => (
    <div data-testid="drawer-body">
      <textarea data-tf-autofocus="" aria-label="Message" />
    </div>
  ),
}));

let container: HTMLDivElement;
let root: Root;
// The registry is a module singleton: a test that throws mid-flight must
// not leave its surface registered for the rest of the suite.
let registered: (() => void)[] = [];

function registerSurface(kind: "full-surface" | "transient"): () => void {
  let unregister: () => void = () => undefined;
  act(() => {
    unregister = assistantSurfaceRegistry.register(kind);
  });
  registered.push(unregister);
  return () => {
    act(() => {
      unregister();
    });
  };
}

beforeEach(() => {
  // The drawer flag is page-level state: each scenario starts closed.
  closeCompanionDrawer();
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
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  for (const unregister of registered) {
    unregister();
  }
  registered = [];
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderCompanion(props: { companionMark?: ReactNode } = {}): void {
  act(() => {
    root.render(
      <TeaflaskAssistantProvider
        publishableKey="pk_test_companion"
        companionMark={props.companionMark}
      >
        <AssistantCompanion />
      </TeaflaskAssistantProvider>,
    );
  });
}

function query(selector: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(selector);
}

function clickByLabel(label: string): void {
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (button === null) {
    throw new Error(`No control labeled "${label}".`);
  }
  act(() => {
    button.click();
  });
}

describe("presence and yield", () => {
  it("rests in the dock with the bare mark and nothing else", () => {
    renderCompanion();

    expect(query("[data-tf-companion-dock]")).not.toBeNull();
    expect(query('button[aria-label="Open assistant"]')).not.toBeNull();
    expect(
      query("[data-tf-companion-body] [data-tf-companion-mark]"),
    ).not.toBeNull();
    // No speech and no attention residue: the mark alone is the companion.
    expect(query('[role="alert"]')).toBeNull();
    expect(query('[role="status"]')).toBeNull();
    expect(query("[data-tf-companion-attention]")).toBeNull();
  });

  it("renders nothing under a full surface and returns when it unmounts", () => {
    renderCompanion();
    const unregister = registerSurface("full-surface");

    expect(query('button[aria-label="Open assistant"]')).toBeNull();

    unregister();

    // Still subscribed while hidden: the flip back needs no remount and
    // no new render from the host.
    expect(query('button[aria-label="Open assistant"]')).not.toBeNull();
  });

  it("hides while a transient surface is open", () => {
    renderCompanion();
    const unregister = registerSurface("transient");

    expect(query('button[aria-label="Open assistant"]')).toBeNull();

    unregister();
  });

  it("an open drawer yields to the palette and returns when it closes", async () => {
    // The palette takes the transcript lease; a surviving drawer would
    // render as a hollow shell behind the modal. The expanded flag
    // outlives the yield, so the drawer (and its replayed transcript)
    // comes back the moment the palette closes.
    renderCompanion();
    await act(async () => {
      query('button[aria-label="Open assistant"]')?.click();
      await Promise.resolve();
    });
    expect(query('[data-testid="drawer-body"]')).not.toBeNull();

    const unregister = registerSurface("transient");

    expect(query('[data-testid="drawer-body"]')).toBeNull();

    unregister();

    expect(query('[data-testid="drawer-body"]')).not.toBeNull();
  });

  it("the mark is the door: it rides inside the one button, on no plate", () => {
    renderCompanion();

    const body = query("[data-tf-companion-body]");
    const mark = body?.querySelector("[data-tf-companion-mark]");
    expect(mark).not.toBeNull();
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(mark?.querySelector("button")).toBeNull();
    // No separate stage span, no animation root: the button carries the
    // mark.
    expect(query("[data-tf-companion-stage]")).toBeNull();
    expect(query("[data-tf-companion]")).toBeNull();
    expect(body?.getAttribute("aria-label")).toBe("Open assistant");
  });

  it("one mark, one size: no hide control and no shrunken nub", () => {
    renderCompanion();

    expect(query("[data-tf-companion-hide]")).toBeNull();
    expect(query("[data-tf-companion-nub]")).toBeNull();
    expect(query('button[aria-label="Hide companion"]')).toBeNull();
    // Nothing on the perch but the one door.
    expect(
      query("[data-tf-companion-perch]")?.querySelectorAll("button"),
    ).toHaveLength(1);
  });
});

describe("the mark floats bare", () => {
  // The brand's silhouette IS the companion: the perch's hit box paints
  // no plate behind it. The proof is the stylesheet's own rule for the
  // hit box plus the button's class list.
  const rulesOf = (selector: string) => {
    const escaped = selector.replace(/[[\]]/g, "\\$&");
    return [...STYLES.matchAll(new RegExp(`${escaped} \\{([^}]*)\\}`, "g"))]
      .map((match) => match[1])
      .join("\n");
  };

  it("the hit box carries no background, border, or shadow", () => {
    const rules = rulesOf("[data-tf-companion-body]");
    expect(rules).not.toBe("");
    expect(rules).not.toMatch(/background/);
    expect(rules).not.toMatch(/border/);
    expect(rules).not.toMatch(/box-shadow/);
  });

  it("the perch button wears no shadow utility", () => {
    renderCompanion();
    expect(query("[data-tf-companion-body]")?.className).not.toMatch(/shadow/);
  });
});

describe("the drawer", () => {
  it("opens from the mark, hides the mark, and never self-registers", async () => {
    renderCompanion();
    await act(async () => {
      query('button[aria-label="Open assistant"]')?.click();
      await Promise.resolve();
    });

    const body = query('[data-testid="drawer-body"]');
    expect(body).not.toBeNull();
    expect(query('button[aria-label="Open assistant"]')).toBeNull();
    // No self-yield: the companion's own drawer is not a registry
    // surface — it must not hide itself.
    expect(assistantSurfaceRegistry.getSnapshot().transientOpen).toBe(false);
    expect(assistantSurfaceRegistry.getSnapshot().fullSurfaceMounted).toBe(
      false,
    );

    clickByLabel("Minimize assistant");

    expect(query('button[aria-label="Open assistant"]')).not.toBeNull();
  });

  it("minimize holds the panel through the exit run, then lets go", async () => {
    renderCompanion();
    await act(async () => {
      query('button[aria-label="Open assistant"]')?.click();
      await Promise.resolve();
    });
    expect(query('[data-testid="drawer-body"]')).not.toBeNull();

    vi.useFakeTimers();
    clickByLabel("Minimize assistant");

    // The perch is back in the same commit, but the panel rides out its
    // exit: still mounted so hidePopover() gets to start the CSS run,
    // body intact so the departing card leaves whole, and inert so the
    // dying dialog catches no Tab.
    expect(query('button[aria-label="Open assistant"]')).not.toBeNull();
    const panel = query("[data-tf-floating-panel]");
    expect(panel).not.toBeNull();
    expect(panel?.hasAttribute("inert")).toBe(true);
    expect(query('[data-testid="drawer-body"]')).not.toBeNull();

    // Past the 400ms hold the run has long landed; the mount lets go.
    act(() => {
      vi.advanceTimersByTime(450);
    });

    expect(query("[data-tf-floating-panel]")).toBeNull();
    expect(query('[data-testid="drawer-body"]')).toBeNull();
  });

  it("a reopen inside the exit hold cancels it", async () => {
    renderCompanion();
    await act(async () => {
      query('button[aria-label="Open assistant"]')?.click();
      await Promise.resolve();
    });

    vi.useFakeTimers();
    clickByLabel("Minimize assistant");
    act(() => {
      vi.advanceTimersByTime(100);
    });
    clickByLabel("Open assistant");

    expect(query("[data-tf-floating-panel]")?.hasAttribute("inert")).toBe(
      false,
    );

    // Outlives the first exit's timer: a cancelled hold must not unmount
    // the drawer the user just took back.
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(query("[data-tf-floating-panel]")).not.toBeNull();
    expect(query('[data-testid="drawer-body"]')).not.toBeNull();
  });

  // What the navigate handler does when the visitor moved: the flag is
  // written from outside the tree, and the widget follows it.
  function openDrawerAsANavigationWould(): Promise<void> {
    return act(async () => {
      openCompanionDrawer();
      // The lazy drawer body resolves through the module registry.
      await Promise.resolve();
    });
  }

  it("a tool navigation opens the drawer at the destination", async () => {
    renderCompanion();
    expect(query('[data-testid="drawer-body"]')).toBeNull();

    await openDrawerAsANavigationWould();

    expect(query('[data-testid="drawer-body"]')).not.toBeNull();
    expect(query('button[aria-label="Open assistant"]')).toBeNull();
  });

  it("announced under a full surface, the drawer shows once that surface leaves", async () => {
    // Leaving the full page by the assistant's hand: the announce lands
    // while the old page is still mounted, and the drawer must be the
    // first thing the visitor sees on the next route.
    renderCompanion();
    const unregister = registerSurface("full-surface");

    await openDrawerAsANavigationWould();
    expect(query('[data-testid="drawer-body"]')).toBeNull();

    unregister();

    expect(query('[data-testid="drawer-body"]')).not.toBeNull();
    expect(query('button[aria-label="Open assistant"]')).toBeNull();
  });

  it("a full surface taking the floor closes an open drawer for good", async () => {
    // Leaving the full page by hand lands minimized, however the drawer
    // stood before — the transient palette (above) is the control that
    // keeps the flag.
    renderCompanion();
    await act(async () => {
      query('button[aria-label="Open assistant"]')?.click();
      await Promise.resolve();
    });
    expect(query('[data-testid="drawer-body"]')).not.toBeNull();

    vi.useFakeTimers();
    const unregister = registerSurface("full-surface");
    unregister();

    expect(query('button[aria-label="Open assistant"]')).not.toBeNull();
    expect(query('[data-testid="drawer-body"]')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(query('[data-testid="drawer-body"]')).toBeNull();
  });

  // jsdom has no popover API, so the panel's show path (where focus is
  // decided) never runs; these two tests lend it one for their duration.
  function withPopoverApi(): () => void {
    const proto = HTMLElement.prototype;
    const originalMatches = Reflect.get(Element.prototype, "matches");
    proto.showPopover = function showPopover(this: HTMLElement) {
      this.setAttribute("data-test-popover-open", "");
    };
    proto.hidePopover = function hidePopover(this: HTMLElement) {
      this.removeAttribute("data-test-popover-open");
    };
    Element.prototype.matches = function matches(
      this: Element,
      selector: string,
    ) {
      return selector === ":popover-open"
        ? this.hasAttribute("data-test-popover-open")
        : originalMatches.call(this, selector);
    };
    return () => {
      Reflect.deleteProperty(proto, "showPopover");
      Reflect.deleteProperty(proto, "hidePopover");
      Element.prototype.matches = originalMatches;
    };
  }

  it("opening from the mark hands the caret to the composer", async () => {
    const restore = withPopoverApi();
    try {
      renderCompanion();
      await act(async () => {
        query('button[aria-label="Open assistant"]')?.click();
        await Promise.resolve();
      });
      expect(document.activeElement?.getAttribute("aria-label")).toBe(
        "Message",
      );
    } finally {
      restore();
    }
  });

  it("a tool navigation opens the drawer without moving focus", async () => {
    // A background turn that navigates must not yank the caret off what
    // the visitor is doing on the destination route.
    const restore = withPopoverApi();
    const hostField = document.createElement("input");
    document.body.appendChild(hostField);
    try {
      renderCompanion();
      hostField.focus();
      expect(document.activeElement).toBe(hostField);

      await openDrawerAsANavigationWould();

      expect(query('[data-testid="drawer-body"]')).not.toBeNull();
      expect(document.activeElement).toBe(hostField);
    } finally {
      restore();
      hostField.remove();
    }
  });

  it("an open drawer survives the widget remounting, as a host route change may cause", async () => {
    renderCompanion();
    await act(async () => {
      query('button[aria-label="Open assistant"]')?.click();
      await Promise.resolve();
    });
    expect(query('[data-testid="drawer-body"]')).not.toBeNull();

    act(() => {
      root.unmount();
    });
    root = createRoot(container);
    renderCompanion();
    await act(async () => {
      await Promise.resolve();
    });

    expect(query('[data-testid="drawer-body"]')).not.toBeNull();
    expect(query('button[aria-label="Open assistant"]')).toBeNull();
  });
});

describe("perch clearance across a shadow boundary", () => {
  // document.elementsFromPoint retargets in-shadow hits to the shadow
  // host (the script-tag custom element). The probe must recognize that
  // host as itself, or a host page that wraps the element in something
  // interactive makes the dock flee its own reflection.
  const rect = {
    left: 1000,
    top: 700,
    width: 60,
    height: 60,
    right: 1060,
    bottom: 760,
    x: 1000,
    y: 700,
    toJSON: () => ({}),
  } as DOMRect;

  function obstructionNearTheCorner(
    obstructor: Element,
  ): (x: number, y: number) => Element[] {
    // Only low probe points hit — lift step 112 clears, so a real
    // obstruction produces a lift instead of the all-obstructed
    // fallback to 0.
    return (_x: number, y: number) => (y > 690 ? [obstructor] : []);
  }

  async function renderIntoAndMeasure(target: Element): Promise<Root> {
    const perchRoot = createRoot(target);
    act(() => {
      perchRoot.render(
        <TeaflaskAssistantProvider publishableKey="pk_test_companion">
          <AssistantCompanion />
        </TeaflaskAssistantProvider>,
      );
    });
    // The mount effect schedules one measure on the next frame.
    await act(async () => {
      await new Promise((resolve) => {
        requestAnimationFrame(() => {
          resolve(null);
        });
      });
    });
    return perchRoot;
  }

  let label: HTMLLabelElement;
  let rectSpy: { mockRestore: () => void };
  // lib.dom types elementsFromPoint as always-present; jsdom never
  // implements it, so the suite installs and removes its own.
  const documentWithProbe = document as unknown as {
    elementsFromPoint?: (x: number, y: number) => Element[];
  };

  beforeEach(() => {
    label = document.createElement("label");
    document.body.appendChild(label);
    rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue(rect);
  });

  afterEach(() => {
    rectSpy.mockRestore();
    delete documentWithProbe.elementsFromPoint;
    label.remove();
  });

  it("does not read its own shadow host as an obstruction", async () => {
    const host = document.createElement("div");
    label.appendChild(host);
    const mountPoint = document.createElement("div");
    host.attachShadow({ mode: "open" }).appendChild(mountPoint);
    documentWithProbe.elementsFromPoint = obstructionNearTheCorner(host);

    const perchRoot = await renderIntoAndMeasure(mountPoint);
    const dock = host.shadowRoot?.querySelector<HTMLElement>(
      "[data-tf-companion-dock]",
    );

    expect(dock).not.toBeNull();
    expect(dock?.style.getPropertyValue("--_tf-companion-lift")).toBe("");
    act(() => {
      perchRoot.unmount();
    });
  });

  it("still lifts off a genuine light-DOM obstruction (the probe ran)", async () => {
    const mountPoint = document.createElement("div");
    label.appendChild(mountPoint);
    const obstructor = document.createElement("div");
    label.appendChild(obstructor);
    documentWithProbe.elementsFromPoint = obstructionNearTheCorner(obstructor);

    const perchRoot = await renderIntoAndMeasure(mountPoint);
    const dock = mountPoint.querySelector<HTMLElement>(
      "[data-tf-companion-dock]",
    );

    expect(dock).not.toBeNull();
    expect(dock?.style.getPropertyValue("--_tf-companion-lift")).toBe("112px");
    act(() => {
      perchRoot.unmount();
    });
  });
});

describe("the companion mark", () => {
  it("defaults to the package flask on the perch", () => {
    renderCompanion();

    expect(
      query(
        '[data-tf-companion-body] [data-tf-companion-mark] [data-tf-agent-mark="primary"]',
      ),
    ).not.toBeNull();
    // Package DOM stays unmarked: the reset keeps owning the flask.
    expect(query("[data-tf-host-view]")).toBeNull();
  });

  it("falls back to the flask when the host's conditional yields false", () => {
    renderCompanion({ companionMark: false });

    expect(
      query(
        '[data-tf-companion-body] [data-tf-companion-mark] [data-tf-agent-mark="primary"]',
      ),
    ).not.toBeNull();
    expect(query("[data-tf-host-view]")).toBeNull();
  });

  it("fills the box for a host node that carries no size of its own", () => {
    // The promise in companionMark's docstring: a bare viewBox svg
    // takes the mark box. The proof is the pair — the stylesheet's fill
    // rule, and the DOM shape that rule selects (the host node is the
    // host-view span's direct child inside the box).
    const fillRule =
      /\[data-tf-companion-mark\] \[data-tf-host-view\] > \* \{[^}]*\}/.exec(
        STYLES,
      )?.[0];
    expect(fillRule).toBeDefined();
    expect(fillRule).toMatch(/width: 100%;/);
    expect(fillRule).toMatch(/height: 100%;/);

    renderCompanion({
      companionMark: <svg viewBox="0 0 24 24" data-testid="bare-svg" />,
    });
    const bareSvg = query('[data-testid="bare-svg"]');
    expect(bareSvg?.parentElement?.hasAttribute("data-tf-host-view")).toBe(
      true,
    );
    expect(
      bareSvg?.parentElement?.parentElement?.hasAttribute(
        "data-tf-companion-mark",
      ),
    ).toBe(true);
    expect(bareSvg?.getAttribute("width")).toBeNull();
  });

  it("renders the provider's companionMark inside the host-view marker", () => {
    renderCompanion({ companionMark: <i data-testid="host-mark" /> });

    expect(
      query(
        '[data-tf-companion-body] [data-tf-companion-mark] [data-tf-host-view] [data-testid="host-mark"]',
      ),
    ).not.toBeNull();
    expect(query("[data-tf-agent-mark]")).toBeNull();
  });
});
