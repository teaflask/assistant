// @vitest-environment jsdom
/**
 * The batteries-included root: one mount composes the provider, the
 * companion, and the palette, and owns the palette chord. The suite's
 * center of gravity is the cooperation contract — the hotkey stands down
 * for a host handler that acted first, claims only events it acts on,
 * matches its chord exactly, and stays escapable (rebind, disable, and
 * the imperative ref) without ever falling back to the contested default.
 */
import { act, createRef, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { assistantSurfaceRegistry } from "../src/core/surface-registry";
import {
  TeaflaskAssistant,
  type TeaflaskAssistantHandle,
} from "../src/components/teaflask-assistant";
import { useAssistantSession } from "../src/components/teaflask-assistant-provider";

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
        new Error("The batteries-root suite never touches the network."),
      );
    }
  },
}));

// The transcript is the palette's body, not this suite's subject.
vi.mock("../src/components/conversation-view", () => ({
  ConversationView: () => <div data-testid="conversation-view" />,
  SetupErrorState: () => <div data-testid="setup-error" />,
}));

// The drawer body is the lazy CopilotKit-reaching half of the companion.
vi.mock("../src/components/companion-drawer-body", () => ({
  default: () => <div data-testid="drawer-body" />,
}));

beforeAll(() => {
  // jsdom ships the <dialog> element without its methods; the palette's
  // TfDialog only needs `open` to track showModal()/close() and a close
  // event to fire, which the attribute reflection already supports.
  const dialogProto = window.HTMLDialogElement.prototype as {
    showModal?: () => void;
    close?: () => void;
    open: boolean;
    dispatchEvent: (event: Event) => boolean;
  };
  dialogProto.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  dialogProto.close ??= function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

let container: HTMLDivElement;
let root: Root;

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
  vi.restoreAllMocks();
});

// ComponentProps rather than the interface: forwardRef contributes the
// ref attribute, and two cases below render with one.
function renderRoot(
  props: Partial<ComponentProps<typeof TeaflaskAssistant>> = {},
): void {
  act(() => {
    root.render(
      <TeaflaskAssistant publishableKey="pk_test_batteries" {...props} />,
    );
  });
}

function pressHotkey(
  target: EventTarget,
  init: KeyboardEventInit,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function paletteDialog(): HTMLDialogElement {
  const dialog = container.querySelector<HTMLDialogElement>(
    'dialog[aria-label="Assistant"]',
  );
  if (dialog === null) {
    throw new Error("The palette dialog is not mounted.");
  }
  return dialog;
}

function SessionProbe() {
  useAssistantSession();
  return <div data-testid="session-probe" />;
}

describe("TeaflaskAssistant", () => {
  it("mounts children, the companion, and a closed palette under one provider", () => {
    renderRoot({ children: <SessionProbe /> });
    expect(
      container.querySelector('[data-testid="session-probe"]'),
    ).not.toBeNull();
    expect(container.querySelector("[data-tf-companion-dock]")).not.toBeNull();
    expect(paletteDialog().open).toBe(false);
    expect(assistantSurfaceRegistry.getSnapshot().transientOpen).toBe(false);
  });

  it("opens the palette on ⌘K, claiming the event", () => {
    renderRoot();
    const event = pressHotkey(window, { key: "k", metaKey: true });
    expect(paletteDialog().open).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    // The open palette announces itself, so the companion yields.
    expect(assistantSurfaceRegistry.getSnapshot().transientOpen).toBe(true);
  });

  it("loads the palette's conversation body behind the lazy boundary", async () => {
    // The shell ships without the transcript (the closed palette the
    // root always mounts must not pull the chat) — so the body arrives
    // one dynamic import later, and "the dialog opened" is not the same
    // claim as "the conversation rendered".
    renderRoot();
    expect(
      paletteDialog().querySelector('[data-testid="conversation-view"]'),
    ).toBeNull();

    pressHotkey(window, { key: "k", metaKey: true });
    // The dynamic import is genuinely async — settle it before asserting
    // rather than guessing a tick count.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (
        paletteDialog().querySelector('[data-testid="conversation-view"]') !==
        null
      ) {
        break;
      }
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }

    expect(
      paletteDialog().querySelector('[data-testid="conversation-view"]'),
    ).not.toBeNull();
  });

  it("toggles the palette closed on the second press", () => {
    renderRoot();
    pressHotkey(window, { key: "k", metaKey: true });
    pressHotkey(window, { key: "k", metaKey: true });
    expect(paletteDialog().open).toBe(false);
    expect(assistantSurfaceRegistry.getSnapshot().transientOpen).toBe(false);
  });

  it("stands down when a host handler already claimed the chord", () => {
    renderRoot();
    const claimChord = (event: KeyboardEvent) => {
      event.preventDefault();
    };
    document.addEventListener("keydown", claimChord);
    try {
      pressHotkey(document.body, { key: "k", metaKey: true });
      expect(paletteDialog().open).toBe(false);
    } finally {
      document.removeEventListener("keydown", claimChord);
    }
  });

  it("accepts either primary as mod and rejects adjacent chords", () => {
    renderRoot();
    pressHotkey(window, { key: "k", ctrlKey: true });
    expect(paletteDialog().open).toBe(true);
    pressHotkey(window, { key: "k", ctrlKey: true });

    const shifted = pressHotkey(window, {
      key: "k",
      metaKey: true,
      shiftKey: true,
    });
    expect(paletteDialog().open).toBe(false);
    expect(shifted.defaultPrevented).toBe(false);
  });

  it("opens from a focused host input — no editable-context carve-out", () => {
    renderRoot();
    const hostInput = document.createElement("input");
    document.body.appendChild(hostInput);
    try {
      pressHotkey(hostInput, { key: "k", metaKey: true });
      expect(paletteDialog().open).toBe(true);
    } finally {
      hostInput.remove();
    }
  });

  it("ignores auto-repeat keydowns from a held chord", () => {
    renderRoot();
    pressHotkey(window, { key: "k", metaKey: true });
    expect(paletteDialog().open).toBe(true);

    const repeat = pressHotkey(window, {
      key: "k",
      metaKey: true,
      repeat: true,
    });
    expect(paletteDialog().open).toBe(true);
    expect(repeat.defaultPrevented).toBe(false);
  });

  it("leaves non-matching events unclaimed", () => {
    renderRoot();
    const other = pressHotkey(window, { key: "p", metaKey: true });
    expect(other.defaultPrevented).toBe(false);
    expect(paletteDialog().open).toBe(false);
  });

  it("goes silent on hotkey={false} while the ref still opens the palette", () => {
    const handle = createRef<TeaflaskAssistantHandle>();
    renderRoot({ hotkey: false, ref: handle });
    const event = pressHotkey(window, { key: "k", metaKey: true });
    expect(paletteDialog().open).toBe(false);
    expect(event.defaultPrevented).toBe(false);

    act(() => {
      handle.current?.openPalette();
    });
    expect(paletteDialog().open).toBe(true);
  });

  it("rebinds with the mod+j grammar, releasing the default chord", () => {
    renderRoot({ hotkey: "mod+j" });
    const cmdK = pressHotkey(window, { key: "k", metaKey: true });
    expect(paletteDialog().open).toBe(false);
    expect(cmdK.defaultPrevented).toBe(false);

    pressHotkey(window, { key: "j", metaKey: true });
    expect(paletteDialog().open).toBe(true);
  });

  it("disables an unrecognized spec with one warning — never a ⌘K fallback", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const handle = createRef<TeaflaskAssistantHandle>();
    renderRoot({ hotkey: "cmd+j", ref: handle });
    // A re-render must not repeat the warning.
    renderRoot({ hotkey: "cmd+j", ref: handle });

    const warned = warn.mock.calls.filter(([message]) =>
      String(message).includes('Unrecognized hotkey "cmd+j"'),
    );
    expect(warned).toHaveLength(1);

    pressHotkey(window, { key: "k", metaKey: true });
    pressHotkey(window, { key: "j", metaKey: true });
    expect(paletteDialog().open).toBe(false);

    act(() => {
      handle.current?.openPalette();
    });
    expect(paletteDialog().open).toBe(true);
  });

  it("removes its listener on unmount", () => {
    renderRoot();
    act(() => {
      root.unmount();
    });
    // A fresh root keeps the afterEach unmount from hitting a dead one.
    root = createRoot(container);
    const event = pressHotkey(window, { key: "k", metaKey: true });
    expect(event.defaultPrevented).toBe(false);
  });
});
