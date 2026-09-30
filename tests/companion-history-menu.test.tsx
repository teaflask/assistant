// @vitest-environment jsdom
/**
 * The drawer header's history disclosure: the title itself (with its
 * chevron) opens a popover of past conversations (identified visitors
 * only), selecting one adopts it and renames the title, and every
 * dismissal — Esc, an outside press, minimize — closes the menu without
 * taking the drawer down with it. The compose button starts a fresh
 * conversation; the minimize dash keeps its old job: collapsing the
 * drawer into the perch.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantCompanion } from "../src/components/assistant-companion";
import { AssistantPage } from "../src/components/assistant-page";
import { TeaflaskAssistantProvider } from "../src/components/teaflask-assistant-provider";
import { getAssistantThread } from "../src/transport/serving-api";

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
        new Error("The history-menu suite never touches the network."),
      );
    }
  },
}));

// The transport is the seam: the store's bootstrap loads this list for
// identified visitors, and openThread's detail fetch is the observable
// proof a selection landed.
vi.mock("../src/transport/serving-api", () => ({
  getAssistantThread: vi.fn(() => new Promise(() => undefined)),
  getAssistantConfig: vi.fn(() =>
    Promise.resolve({ suggestions: { default: [], routes: [] } }),
  ),
  listAssistantThreads: vi.fn(() =>
    Promise.resolve([
      {
        id: "thread-1",
        title: "Shipping question",
        busy: false,
        stream_thread_id: "stream-thread-1",
        created_at: "2026-08-03T00:00:00Z",
        updated_at: "2026-08-03T00:00:00Z",
      },
      {
        id: "thread-2",
        title: "Billing question",
        busy: false,
        stream_thread_id: "stream-thread-2",
        created_at: "2026-08-01T00:00:00Z",
        updated_at: "2026-08-01T00:00:00Z",
      },
    ]),
  ),
  sendAssistantMessage: vi.fn(),
  resolveTurnApproval: vi.fn(),
  resolveTurnToolResults: vi.fn(),
  createAttachmentUpload: vi.fn(),
  finalizeAttachment: vi.fn(),
  getAttachmentDownloadUrl: vi.fn(),
  putFileToUploadUrl: vi.fn(),
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

beforeEach(() => {
  testSerial += 1;
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.clearAllMocks();
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
});

function renderCompanion(options: { identified: boolean }): void {
  act(() => {
    root.render(
      <TeaflaskAssistantProvider
        publishableKey={`pk_test_history_${String(testSerial)}`}
        getEndUserToken={
          options.identified ? () => "end-user-token" : undefined
        }
      >
        <AssistantCompanion />
      </TeaflaskAssistantProvider>,
    );
  });
}

function renderPage(options: { identified: boolean }): void {
  act(() => {
    root.render(
      <TeaflaskAssistantProvider
        publishableKey={`pk_test_page_history_${String(testSerial)}`}
        getEndUserToken={
          options.identified ? () => "end-user-token" : undefined
        }
      >
        <AssistantPage />
      </TeaflaskAssistantProvider>,
    );
  });
}

function query(selector: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(selector);
}

function buttonByLabel(label: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
}

function clickByLabel(label: string): void {
  const button = buttonByLabel(label);
  if (button === null) {
    throw new Error(`No control labeled "${label}".`);
  }
  act(() => {
    button.click();
  });
}

function buttonByText(text: string): HTMLButtonElement | null {
  return (
    [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === text,
    ) ?? null
  );
}

/** The header's title-disclosure trigger — the one control that points
 *  at a menu. Its accessible name is the visible title, so it can't be
 *  found by a fixed label. */
function historyTrigger(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>("button[aria-controls]");
}

function clickHistoryTrigger(): void {
  const trigger = historyTrigger();
  if (trigger === null) {
    throw new Error("No history disclosure trigger in the header.");
  }
  act(() => {
    trigger.click();
  });
}

/** Open the drawer and let the bootstrap's history load settle. */
async function openDrawer(): Promise<void> {
  await act(async () => {
    query('button[aria-label="Open assistant"]')?.click();
    await Promise.resolve();
  });
}

function menu(): HTMLElement | null {
  return query('[role="dialog"][aria-label="Conversation history"]');
}

describe("the history disclosure", () => {
  it("is absent for anonymous visitors; the static title and compose stay", async () => {
    renderCompanion({ identified: false });
    await openDrawer();

    // No disclosure — but the header must not look broken without it:
    // the title still reads "Assistant" and compose still works.
    expect(historyTrigger()).toBeNull();
    expect(container.querySelector("h2")?.textContent).toBe("Assistant");
    expect(buttonByLabel("New conversation")).not.toBeNull();
    expect(buttonByLabel("Minimize assistant")).not.toBeNull();
  });

  it("opens on the title disclosure with the seeded threads, and a second press closes it", async () => {
    renderCompanion({ identified: true });
    await openDrawer();

    const trigger = historyTrigger();
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent).toContain("Assistant");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");

    clickHistoryTrigger();

    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(menu()).not.toBeNull();
    expect(buttonByText("New conversation")).not.toBeNull();
    expect(menu()?.textContent).toContain("Shipping question");
    expect(menu()?.textContent).toContain("Billing question");

    clickHistoryTrigger();

    expect(menu()).toBeNull();
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  });

  it("flags the open menu so the panel throws the conversation out of focus", async () => {
    // Half of what the stylesheet's defocus rule reads — the DIRECT
    // child relationship (the other half, the hooks themselves, is
    // pinned in glass-material). Nest this menu one level deeper and the
    // rule silently matches nothing: the menu's glass would tint the
    // transcript's text without softening it, which is the illegibility
    // it exists to fix.
    renderCompanion({ identified: true });
    await openDrawer();
    clickHistoryTrigger();

    expect(
      menu()?.matches("[data-tf-floating-panel] > [data-tf-disclosure]"),
    ).toBe(true);
  });

  it("selecting a conversation closes the menu and opens that thread", async () => {
    renderCompanion({ identified: true });
    await openDrawer();
    clickHistoryTrigger();

    const row = buttonByText("Shipping question");
    expect(row).not.toBeNull();
    act(() => {
      row?.click();
    });

    expect(menu()).toBeNull();
    expect(vi.mocked(getAssistantThread)).toHaveBeenCalledWith(
      expect.anything(),
      "thread-1",
    );
    // The drawer itself survived the selection.
    expect(query('[data-testid="drawer-body"]')).not.toBeNull();
  });

  it("starting a new conversation closes the menu and keeps the drawer", async () => {
    renderCompanion({ identified: true });
    await openDrawer();
    clickHistoryTrigger();

    act(() => {
      buttonByText("New conversation")?.click();
    });

    expect(menu()).toBeNull();
    expect(query('[data-testid="drawer-body"]')).not.toBeNull();
  });

  it("the title follows the opened thread; compose returns it to Assistant", async () => {
    // The one suite where the detail fetch lands: adopting a thread is
    // what renames the title.
    vi.mocked(getAssistantThread).mockImplementation((_session, threadId) =>
      Promise.resolve({
        thread: {
          id: threadId,
          title: "Shipping question",
          busy: false,
          stream_thread_id: "stream-thread-1",
          created_at: "2026-08-03T00:00:00Z",
          updated_at: "2026-08-03T00:00:00Z",
        },
        turns: [],
      }),
    );
    renderCompanion({ identified: true });
    await openDrawer();
    clickHistoryTrigger();

    const row = buttonByText("Shipping question");
    await act(async () => {
      row?.click();
      await Promise.resolve();
    });
    expect(historyTrigger()?.textContent).toContain("Shipping question");

    // The header compose — the icon button, not ThreadHistory's row.
    clickByLabel("New conversation");
    expect(historyTrigger()?.textContent).toContain("Assistant");
  });

  it("Esc closes the menu but not the drawer; the panel's own Esc still works", async () => {
    renderCompanion({ identified: true });
    await openDrawer();
    clickHistoryTrigger();

    const inMenu = buttonByText("New conversation");
    act(() => {
      inMenu?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(menu()).toBeNull();
    expect(query('[data-testid="drawer-body"]')).not.toBeNull();
    // Esc's stopPropagation was the menu's, not a blanket one: the same
    // key on the bare panel still collapses the drawer.
    act(() => {
      query('[data-testid="drawer-body"]')?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(query('button[aria-label="Open assistant"]')).not.toBeNull();
  });

  it("a press outside the menu closes it", async () => {
    renderCompanion({ identified: true });
    await openDrawer();
    clickHistoryTrigger();
    expect(menu()).not.toBeNull();

    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    expect(menu()).toBeNull();
    expect(query('[data-testid="drawer-body"]')).not.toBeNull();
  });

  it("minimizing with the menu open resets it — reopening shows no menu", async () => {
    renderCompanion({ identified: true });
    await openDrawer();
    clickHistoryTrigger();
    expect(menu()).not.toBeNull();

    clickByLabel("Minimize assistant");
    expect(query('button[aria-label="Open assistant"]')).not.toBeNull();

    await openDrawer();
    expect(menu()).toBeNull();
    expect(historyTrigger()?.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("the host chrome slot", () => {
  it("renderChrome output renders inside the host-view marker (round-7 ruling 2)", () => {
    act(() => {
      root.render(
        <TeaflaskAssistantProvider
          publishableKey={`pk_test_chrome_slot_${String(testSerial)}`}
        >
          <AssistantPage
            renderChrome={() => <div data-testid="host-chrome" />}
          />
        </TeaflaskAssistantProvider>,
      );
    });
    const chrome = container.querySelector('[data-testid="host-chrome"]');
    expect(chrome).not.toBeNull();
    // The sheet's box/border reset excludes [data-tf-host-view] subtrees
    // — host chrome is the host's to style. The computed-style proof is
    // tests-e2e/boundary.spec.ts; this pins the real wiring.
    expect(chrome?.closest("[data-tf-host-view]")).not.toBeNull();
  });
});

describe("the full-page history disclosure", () => {
  it("uses the same transient menu instead of a permanent history rail", async () => {
    renderPage({ identified: true });
    await act(async () => {
      await Promise.resolve();
    });

    expect(query('nav[aria-label="Conversations"]')).toBeNull();
    expect(historyTrigger()).not.toBeNull();

    clickHistoryTrigger();

    expect(menu()).not.toBeNull();
    expect(menu()?.matches("[data-tf-assistant] > [data-tf-disclosure]")).toBe(
      true,
    );
    expect(menu()?.textContent).toContain("Shipping question");
    expect(menu()?.textContent).toContain("Billing question");
  });
});
