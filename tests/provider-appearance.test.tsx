// @vitest-environment jsdom
/**
 * The appearance identity guard: hosts write the theme prop as an inline
 * object literal, so its identity changes on every render while its value
 * doesn't. If that identity ever reaches the session's memo keys, the
 * token session (and with it the conversation transport) is torn down and
 * rebuilt each render — on a public embed that is a silent, permanent
 * stream drop triggered by the most natural customer code. This suite is
 * the tripwire: a fresh-but-identical literal per render must construct
 * the session exactly once, while a real value change still lands on the
 * widget roots.
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AssistantTheme,
  AssistantThemeMode,
} from "../src/appearance/theme";
import {
  useAssistantAppearance,
  type AssistantAppearanceValue,
} from "../src/components/appearance-context";
import {
  TeaflaskAssistantProvider,
  useAssistantSession,
} from "../src/components/teaflask-assistant-provider";
import { useToolViewRegistry } from "../src/components/tool-view-registry-context";
import { reactToolView } from "../src/components/react-tool-view";
import type { ToolViewProps, ToolViewRegistry } from "../src/core/tool-view";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Counting the real constructor is the whole point — the guard must fail
// if any future dependency array lets theme identity reconstruct it. A
// rebuild also disposes the session it replaces, so disposals are the
// second tripwire.
const sessionLifecycle = vi.hoisted(() => ({ constructed: 0, disposed: 0 }));
vi.mock("../src/transport/token-session", () => ({
  TokenSession: class {
    constructor() {
      sessionLifecycle.constructed += 1;
    }
    dispose(): void {
      sessionLifecycle.disposed += 1;
    }
    authorizedFetch(): Promise<never> {
      return Promise.reject(
        new Error("The appearance guard never touches the network."),
      );
    }
  },
}));

const observed = {
  sessions: [] as unknown[],
  appearances: [] as AssistantAppearanceValue[],
  registries: [] as (ToolViewRegistry | undefined)[],
};

function Probe() {
  const { session } = useAssistantSession();
  const appearance = useAssistantAppearance();
  observed.sessions.push(session);
  observed.appearances.push(appearance);
  observed.registries.push(useToolViewRegistry());
  return <div data-testid="probe" {...appearance.rootProps} />;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  sessionLifecycle.constructed = 0;
  sessionLifecycle.disposed = 0;
  observed.sessions = [];
  observed.appearances = [];
  observed.registries = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function renderProvider(props: {
  theme?: AssistantTheme;
  mode?: AssistantThemeMode;
  companionMark?: ReactNode;
  suggestions?: readonly (string | { prompt: string; kind?: "ask" })[];
  toolViews?: ToolViewRegistry;
}): void {
  act(() => {
    root.render(
      <TeaflaskAssistantProvider publishableKey="pk_test_guard" {...props}>
        <Probe />
      </TeaflaskAssistantProvider>,
    );
  });
}

function probeElement(): HTMLElement {
  const element = container.querySelector<HTMLElement>('[data-testid="probe"]');
  if (element === null) {
    throw new Error("The probe did not render.");
  }
  return element;
}

describe("provider appearance identity", () => {
  it("constructs the token session exactly once across inline theme-literal re-renders", () => {
    for (let pass = 0; pass < 5; pass += 1) {
      // A fresh object literal every pass — identical value, new identity.
      renderProvider({
        theme: {
          background: "#ffffff",
          radius: 12,
          dark: { background: "#111111" },
        },
      });
    }
    expect(sessionLifecycle.constructed).toBe(1);
    expect(sessionLifecycle.disposed).toBe(0);
    expect(observed.sessions.length).toBeGreaterThanOrEqual(5);
    for (const session of observed.sessions) {
      expect(session).toBe(observed.sessions[0]);
    }
    for (const appearance of observed.appearances) {
      expect(appearance).toBe(observed.appearances[0]);
    }
  });

  it("applies a changed theme value without rebuilding the session", () => {
    renderProvider({ theme: { background: "#ffffff" } });
    const before = observed.appearances[0];
    renderProvider({ theme: { background: "#fafafa" } });

    expect(probeElement().style.getPropertyValue("--tf-background")).toBe(
      "#fafafa",
    );
    expect(observed.appearances.at(-1)).not.toBe(before);
    expect(sessionLifecycle.constructed).toBe(1);
    expect(sessionLifecycle.disposed).toBe(0);
    for (const session of observed.sessions) {
      expect(session).toBe(observed.sessions[0]);
    }
  });

  it("inlines both value sets and passes mode through verbatim", () => {
    renderProvider({
      theme: { background: "#ffffff", dark: { background: "#111111" } },
      mode: "auto",
    });
    const element = probeElement();
    expect(element.getAttribute("data-tf-theme")).toBe("auto");
    expect(element.style.getPropertyValue("--tf-background")).toBe("#ffffff");
    expect(element.style.getPropertyValue("--_tf-dark-background")).toBe(
      "#111111",
    );
  });

  it("leaves the roots untouched when neither theme nor mode is passed", () => {
    renderProvider({});
    const element = probeElement();
    expect(observed.appearances.at(-1)?.rootProps).toEqual({});
    expect(element.hasAttribute("data-tf-theme")).toBe(false);
    expect(element.getAttribute("style")).toBeNull();
  });

  it("reads a boolean companion mark as no mark — the idiomatic conditional gets the flask", () => {
    // `companionMark={flag && <Mark />}` hands the provider `false`. The
    // fall-through rule (core/host-fill.ts): booleans and nullish
    // decline; renderable emptiness is the host's deliberate content and
    // stays.
    for (const declining of [false, true, undefined] as const) {
      renderProvider({ companionMark: declining });
      expect(observed.appearances.at(-1)?.companionMark).toBeNull();
    }
    renderProvider({ companionMark: "" });
    expect(observed.appearances.at(-1)?.companionMark).toBe("");
  });

  it("carries the companion mark on the appearance channel, by identity", () => {
    const mark = <b data-testid="host-mark" />;
    renderProvider({ companionMark: mark });
    expect(observed.appearances.at(-1)?.companionMark).toBe(mark);

    renderProvider({});
    expect(observed.appearances.at(-1)?.companionMark).toBeNull();
  });

  it("carries the host's suggestions on the appearance channel", () => {
    renderProvider({
      suggestions: ["What's new?", { prompt: "Draft a doc", kind: "ask" }],
    });
    expect(observed.appearances.at(-1)?.suggestions).toEqual([
      "What's new?",
      { prompt: "Draft a doc", kind: "ask" },
    ]);

    renderProvider({});
    expect(observed.appearances.at(-1)?.suggestions).toBeNull();
  });

  it("keeps a fresh toolViews literal out of the session's memo keys", () => {
    // The registry holds adapters, so the theme's serialize-and-key
    // trick can't apply — the guard is that the prop rides its own
    // context and never reaches a session dependency array. A fresh
    // wrapper literal every render (adapters stable at module scope, as
    // documented) must never reconstruct the session.
    const DetailReading: React.ComponentType<ToolViewProps> = () => null;
    const detailView = reactToolView(DetailReading);
    for (let pass = 0; pass < 5; pass += 1) {
      renderProvider({
        toolViews: {
          "acme.order-lookup": {
            version: 1,
            view: detailView,
          },
        },
      });
    }
    expect(sessionLifecycle.constructed).toBe(1);
    expect(sessionLifecycle.disposed).toBe(0);
    for (const session of observed.sessions) {
      expect(session).toBe(observed.sessions[0]);
    }
    // The channel works: consumers under the provider read the latest
    // registry through the dedicated context.
    const latest = observed.registries.at(-1);
    expect(latest?.["acme.order-lookup"]?.view).toBe(detailView);
  });

  it("treats a fresh-but-identical suggestions literal as a no-op", () => {
    // The same trap as the theme: hosts write the array inline, so its
    // identity is new every render while its value isn't — appearance
    // identity (and with it every widget under the context) must hold.
    renderProvider({ suggestions: ["What's new?"] });
    const before = observed.appearances.at(-1);
    renderProvider({ suggestions: ["What's new?"] });

    expect(observed.appearances.at(-1)).toBe(before);
    expect(sessionLifecycle.constructed).toBe(1);
  });
});
