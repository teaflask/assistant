// @vitest-environment jsdom
/**
 * The composer shelf's provider chip: the chip exists only for an
 * identified visitor whose agent config offers a provider (or holds a
 * stored credential); its menu opens upward, carries the disclosure
 * line, runs the sign-in flow (begin → open the popup → wait for the
 * refreshed standing). The transport is canned at the serving-api seam and the session
 * context is handed in as real ObservableCells — the wire itself is the
 * backend suites' subject.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import type { SubscriptionStatus } from "../src/contract/subscriptions";
import { ObservableCell } from "../src/core/observable-cell";
import { ProviderChipShelf } from "../src/components/provider-chip";
import { ServingApiError } from "../src/transport/serving-error";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({
  begin: vi.fn(),
  complete: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("../src/transport/serving-api", () => ({
  beginSubscriptionAuthorization: (...args: unknown[]) =>
    api.begin(...args) as unknown,
  completeSubscriptionAuthorization: (...args: unknown[]) =>
    api.complete(...args) as unknown,
  disconnectSubscription: (...args: unknown[]) =>
    api.disconnect(...args) as unknown,
}));

interface SessionFixture {
  session: object;
  tier: string | null;
  subscriptions: ObservableCell<SubscriptionStatus[] | null>;
  ensureSubscriptions: ReturnType<typeof vi.fn>;
  refreshSubscriptions: ReturnType<typeof vi.fn>;
  connectOpenRequested: ObservableCell<boolean>;
  requestSubscriptionConnect: () => void;
  acknowledgeSubscriptionConnect: () => void;
}
const sessionFixture = vi.hoisted(() => ({
  value: null as unknown as SessionFixture,
}));
vi.mock("../src/components/teaflask-assistant-provider", () => ({
  useAssistantSession: () => sessionFixture.value,
  useOptionalAssistantSession: () => sessionFixture.value,
}));

let openedWindow: MockInstance<typeof window.open>;

const OFFERED_UNCONNECTED: SubscriptionStatus = {
  provider: "openai_chatgpt",
  offered: true,
  connected: false,
  state: null,
  plan_type: null,
  bounce_cause: null,
  bounce_retry_at: null,
};

const AN_AUTHORIZATION = {
  authorize_url: "https://auth.openai.com/api/accounts/authorize?state=sealed",
  expires_in: 600,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom implements no window.open; the popup is observed, never opened.
  openedWindow = vi.spyOn(window, "open").mockReturnValue(null);
  const subscriptions = new ObservableCell<SubscriptionStatus[] | null>(null);
  const connectOpenRequested = new ObservableCell<boolean>(false);
  sessionFixture.value = {
    session: { baseUrl: "https://api.example.test" },
    tier: "identified",
    subscriptions,
    ensureSubscriptions: vi.fn(),
    refreshSubscriptions: vi.fn(),
    connectOpenRequested,
    requestSubscriptionConnect: () => {
      connectOpenRequested.set(true);
    },
    acknowledgeSubscriptionConnect: () => {
      connectOpenRequested.set(false);
    },
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

function renderShelf(): void {
  act(() => {
    root.render(<ProviderChipShelf />);
  });
}

function setStatuses(statuses: SubscriptionStatus[] | null): void {
  act(() => {
    sessionFixture.value.subscriptions.set(statuses);
  });
}

function chipTrigger(): HTMLButtonElement | null {
  // "Sign in with ChatGPT" before a credential exists; the plan's
  // standing afterwards — the chip's label follows the standing.
  return container.querySelector<HTMLButtonElement>(
    'button[aria-expanded][aria-controls="tf-provider-chip-menu"]',
  );
}

function menu(): HTMLElement | null {
  return container.querySelector<HTMLElement>("#tf-provider-chip-menu");
}

function buttonByText(text: string): HTMLButtonElement | null {
  return (
    [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === text,
    ) ?? null
  );
}

// The chip trigger and the menu's begin action share the one verb
// ("Sign in with ChatGPT"), so menu actions are found inside the menu.
function menuButtonByText(text: string): HTMLButtonElement | null {
  return (
    [...(menu()?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent.trim() === text,
    ) ?? null
  );
}

function openStandingActions(): void {
  const trigger = menu()?.querySelector<HTMLButtonElement>(
    'button[aria-controls^="tf-provider-actions-"]',
  );
  if (trigger === null || trigger === undefined) {
    throw new Error("No provider standing control in the menu.");
  }
  act(() => {
    trigger.click();
  });
}

// The menu carries several anchors (the approve CTA plus the enablement
// hint's deep links), so anchors are found by name, never by document
// order.
function anchorByText(text: string): HTMLAnchorElement | null {
  return (
    [...container.querySelectorAll("a")].find(
      (anchor) => anchor.textContent.trim() === text,
    ) ?? null
  );
}

function openChipMenu(): void {
  const trigger = chipTrigger();
  if (trigger === null) {
    throw new Error("No provider chip on the shelf.");
  }
  act(() => {
    trigger.click();
  });
}

async function beginTheFlow(): Promise<void> {
  api.begin.mockResolvedValueOnce(AN_AUTHORIZATION);
  openChipMenu();
  await act(async () => {
    menuButtonByText("Sign in with ChatGPT")?.click();
    await Promise.resolve();
  });
}

describe("the chip's gate", () => {
  it("renders only for an identified visitor with an offered provider", () => {
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    expect(chipTrigger()).not.toBeNull();
    expect(chipTrigger()?.getAttribute("aria-label")).toBe(
      "Sign in with ChatGPT",
    );
    expect(sessionFixture.value.ensureSubscriptions).toHaveBeenCalled();
  });

  it("stays hidden for an anonymous visitor — and never fetches", () => {
    sessionFixture.value.tier = null;
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    expect(chipTrigger()).toBeNull();
    expect(sessionFixture.value.ensureSubscriptions).not.toHaveBeenCalled();
  });

  it("stays hidden when no provider is offered", () => {
    setStatuses([{ ...OFFERED_UNCONNECTED, offered: false }]);
    renderShelf();
    expect(chipTrigger()).toBeNull();
  });

  it("an open menu whose offer is withdrawn does not pop back open", () => {
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    openChipMenu();
    expect(menu()).not.toBeNull();

    setStatuses([{ ...OFFERED_UNCONNECTED, offered: false }]);
    expect(chipTrigger()).toBeNull();
    expect(menu()).toBeNull();

    setStatuses([OFFERED_UNCONNECTED]);
    expect(menu()).toBeNull();
    expect(chipTrigger()?.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("the dropped-open menu", () => {
  it("carries the disclosure line and the connect affordance", () => {
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    openChipMenu();

    expect(chipTrigger()?.getAttribute("aria-expanded")).toBe("true");
    expect(menu()?.textContent).toContain(
      "Conversations here will use your ChatGPT plan's included usage.",
    );
    expect(menuButtonByText("Sign in with ChatGPT")).not.toBeNull();
  });

  it("Esc closes the menu and hands focus back to the chip", () => {
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    openChipMenu();

    act(() => {
      menuButtonByText("Sign in with ChatGPT")?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(chipTrigger());
  });

  it("a pointer outside light-dismisses the menu", () => {
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    openChipMenu();
    expect(menu()).not.toBeNull();

    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    expect(menu()).toBeNull();
  });

  it("opens by name: a parked connect ask drops the menu open and is consumed", () => {
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    expect(menu()).toBeNull();

    act(() => {
      sessionFixture.value.requestSubscriptionConnect();
    });

    expect(menu()).not.toBeNull();
    // Consumed, not merely observed: a later mount must not re-fire it.
    expect(sessionFixture.value.connectOpenRequested.get()).toBe(false);
  });

  it("a connect ask rung before the shelf mounts is parked, not dropped", () => {
    // A minimized companion has no composer mounted; the ask must
    // survive on the session entry and be honored on the next mount.
    setStatuses([OFFERED_UNCONNECTED]);
    act(() => {
      sessionFixture.value.requestSubscriptionConnect();
    });

    renderShelf();

    expect(menu()).not.toBeNull();
    expect(sessionFixture.value.connectOpenRequested.get()).toBe(false);
  });

  it("opening the connected menu leaves focus on the chip — never the destructive disconnect", () => {
    // The menu autofocuses nothing: a held Enter on the chip would
    // key-repeat onto whatever gets focus, and the connected resting
    // state leads with Disconnect.
    setStatuses([
      {
        ...OFFERED_UNCONNECTED,
        connected: true,
        state: "active",
        plan_type: "plus",
      },
    ]);
    renderShelf();
    const trigger = chipTrigger();
    act(() => {
      trigger?.focus();
      trigger?.click();
    });

    expect(menu()).not.toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.activeElement).not.toBe(buttonByText("Disconnect ChatGPT"));
  });
});

describe("the sign-in popup", () => {
  it("begin opens the authorize URL in a popup and shows the wait", async () => {
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    await beginTheFlow();

    expect(api.begin).toHaveBeenCalledWith(
      sessionFixture.value.session,
      "openai_chatgpt",
    );
    expect(openedWindow).toHaveBeenCalledWith(
      AN_AUTHORIZATION.authorize_url,
      "_blank",
      "popup,width=520,height=720",
    );
    // The link repeats the popup's URL for a blocked popup — a new tab,
    // never a code to retype — and keeps window.opener (target=_blank
    // alone would sever it), since the callback page posts to the opener.
    const link = anchorByText("Open ChatGPT");
    expect(link?.getAttribute("href")).toBe(AN_AUTHORIZATION.authorize_url);
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("opener");
    expect(link?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(menu()?.textContent).toContain("Finish signing in to ChatGPT");
    expect(menu()?.textContent).toContain("Waiting for ChatGPT…");
    expect(menu()?.textContent).not.toContain("Confirm this code");
    expect(menu()?.textContent).not.toContain("Turn on device codes");
  });

  it("a begin refusal shows the server's sentence and offers a retry", async () => {
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    api.begin.mockRejectedValueOnce(
      new ServingApiError({
        code: "SUBSCRIPTION_NOT_OFFERED",
        status: 403,
        message: "ChatGPT sign-in isn't offered on this assistant.",
        retryAfterSeconds: null,
      }),
    );
    openChipMenu();
    await act(async () => {
      menuButtonByText("Sign in with ChatGPT")?.click();
      await Promise.resolve();
    });

    expect(openedWindow).not.toHaveBeenCalled();
    expect(menu()?.textContent).toContain(
      "ChatGPT sign-in isn't offered on this assistant.",
    );
    expect(buttonByText("Try connecting ChatGPT again")).not.toBeNull();
  });

  it("the callback page's message completes the sign-in under this bearer and holds verifying", async () => {
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    openedWindow.mockReturnValue(window);
    api.complete.mockResolvedValueOnce({ credential_state: "verifying" });
    await beginTheFlow();
    const refreshes = sessionFixture.value.refreshSubscriptions;
    expect(refreshes).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://api.example.test",
          source: window,
          data: {
            type: "teaflask.subscription_connect",
            provider: "openai_chatgpt",
            kind: "code",
            code: "ac_relayed",
            state: "chatgpt-sign-in-v1:sealed",
            client_id: null,
          },
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.complete).toHaveBeenCalledWith(
      sessionFixture.value.session,
      "openai_chatgpt",
      {
        code: "ac_relayed",
        state: "chatgpt-sign-in-v1:sealed",
        client_id: null,
      },
    );
    expect(refreshes).toHaveBeenCalledTimes(1);
    expect(menu()?.textContent).toContain("Verifying your ChatGPT connection…");
    expect(menu()?.textContent).not.toContain("Waiting for ChatGPT…");

    // The read that lands after the completion exits the flow — a bounce
    // the probe already settled included; the visitor sees the recovery.
    setStatuses([
      {
        ...OFFERED_UNCONNECTED,
        connected: true,
        state: "bounced",
        bounce_cause: "auth",
      },
    ]);
    expect(menu()?.textContent).not.toContain(
      "Verifying your ChatGPT connection…",
    );
    expect(menu()?.textContent).toContain(
      "Your ChatGPT connection stopped working.",
    );
  });

  it("the fallback link's tab completes too: any window on the server's origin may speak", async () => {
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    openedWindow.mockReturnValue(window);
    api.complete.mockResolvedValueOnce({ credential_state: "verifying" });
    await beginTheFlow();
    const tab = document.createElement("iframe");
    document.body.appendChild(tab);
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://api.example.test",
          source: tab.contentWindow,
          data: {
            type: "teaflask.subscription_connect",
            provider: "openai_chatgpt",
            kind: "code",
            code: "ac_from_the_tab",
            state: "chatgpt-sign-in-v1:sealed",
            client_id: null,
          },
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    tab.remove();
    expect(api.complete).toHaveBeenCalledTimes(1);
    expect(menu()?.textContent).toContain("Verifying your ChatGPT connection…");
  });

  it("a message from another origin, another shape or another provider is not the page talking", async () => {
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    openedWindow.mockReturnValue(window);
    await beginTheFlow();
    const relayed: Record<string, unknown> = {
      type: "teaflask.subscription_connect",
      provider: "openai_chatgpt",
      kind: "code",
      code: "ac_relayed",
      state: "chatgpt-sign-in-v1:sealed",
      client_id: null,
    };
    await act(async () => {
      for (const init of [
        { origin: "https://evil.example.test", source: window, data: relayed },
        {
          origin: "https://api.example.test",
          source: window,
          data: { ...relayed, type: "other" },
        },
        {
          origin: "https://api.example.test",
          source: window,
          data: { ...relayed, provider: "someone_else" },
        },
        {
          origin: "https://api.example.test",
          source: window,
          data: { ...relayed, kind: "code", code: 7 },
        },
      ]) {
        window.dispatchEvent(new MessageEvent("message", init));
      }
      await Promise.resolve();
    });
    expect(api.complete).not.toHaveBeenCalled();
    expect(menu()?.textContent).toContain("Waiting for ChatGPT…");
  });

  it("a same-origin relative base URL still hears the page (resolved against the document)", async () => {
    // A host behind a reverse proxy configures base-url="/api"; every
    // other call only concatenates it, so the listener must not throw on
    // it either — it resolves against the page and accepts that origin.
    sessionFixture.value = {
      ...sessionFixture.value,
      session: { baseUrl: "/api" },
    };
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    api.complete.mockResolvedValueOnce({ credential_state: "verifying" });
    await beginTheFlow();
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          source: window,
          data: {
            type: "teaflask.subscription_connect",
            provider: "openai_chatgpt",
            kind: "code",
            code: "ac_relative",
            state: "chatgpt-sign-in-v1:sealed",
            client_id: null,
          },
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.complete).toHaveBeenCalledTimes(1);
    expect(menu()?.textContent).toContain("Verifying your ChatGPT connection…");
  });

  it("a denied consent lands in the error arm with the plan sentence", async () => {
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    await beginTheFlow();
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://api.example.test",
          source: window,
          data: {
            type: "teaflask.subscription_connect",
            provider: "openai_chatgpt",
            kind: "denied",
          },
        }),
      );
      await Promise.resolve();
    });
    expect(api.complete).not.toHaveBeenCalled();
    expect(menu()?.textContent).toContain(
      "needs ChatGPT Plus or Pro on a personal account",
    );
    expect(buttonByText("Try connecting ChatGPT again")).not.toBeNull();
  });

  it("a refused completion shows the server's sentence and offers a retry", async () => {
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    api.complete.mockRejectedValueOnce(
      new ServingApiError({
        code: "SUBSCRIPTION_AUTHORIZATION_INVALID",
        status: 403,
        message: "That sign-in can't be completed — start it again.",
        retryAfterSeconds: null,
      }),
    );
    await beginTheFlow();
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://api.example.test",
          source: window,
          data: {
            type: "teaflask.subscription_connect",
            provider: "openai_chatgpt",
            kind: "code",
            code: "ac_relayed",
            state: "chatgpt-sign-in-v1:sealed",
            client_id: "oaiapp_issued",
          },
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.complete).toHaveBeenCalledWith(
      sessionFixture.value.session,
      "openai_chatgpt",
      {
        code: "ac_relayed",
        state: "chatgpt-sign-in-v1:sealed",
        client_id: "oaiapp_issued",
      },
    );
    expect(menu()?.textContent).toContain(
      "That sign-in can't be completed — start it again.",
    );
    expect(buttonByText("Try connecting ChatGPT again")).not.toBeNull();
  });

  it("the wait expires at expires_in without a message, and reads nothing meanwhile", async () => {
    vi.useFakeTimers();
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    const refreshes = sessionFixture.value.refreshSubscriptions;
    await beginTheFlow();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        AN_AUTHORIZATION.expires_in * 1000 - 1000,
      );
    });
    expect(refreshes).not.toHaveBeenCalled();
    expect(menu()?.textContent).toContain("Waiting for ChatGPT…");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(menu()?.textContent).not.toContain("Waiting for ChatGPT…");
    expect(menu()?.textContent).toContain(
      "The sign-in took too long and has expired. Start it again.",
    );
    expect(buttonByText("Try connecting ChatGPT again")).not.toBeNull();
    expect(refreshes).not.toHaveBeenCalled();
  });

  it("Start over leaves the wait, and a late message is ignored", async () => {
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    await beginTheFlow();
    act(() => {
      buttonByText("Start over")?.click();
    });
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://api.example.test",
          source: window,
          data: {
            type: "teaflask.subscription_connect",
            provider: "openai_chatgpt",
            kind: "code",
            code: "ac_late",
            state: "chatgpt-sign-in-v1:sealed",
            client_id: null,
          },
        }),
      );
      await Promise.resolve();
    });
    expect(api.complete).not.toHaveBeenCalled();
    expect(menuButtonByText("Sign in with ChatGPT")).not.toBeNull();
  });

  it("the verifying re-read survives failed GETs, bounded", async () => {
    vi.useFakeTimers();
    setStatuses([
      { ...OFFERED_UNCONNECTED, connected: true, state: "verifying" },
    ]);
    renderShelf();
    openChipMenu();
    const refreshes = sessionFixture.value.refreshSubscriptions;
    // Each tick re-reads; a failed read changes nothing, so the chain
    // re-arms itself — up to its bound, never forever.
    for (let tick = 1; tick <= 5; tick += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
      expect(refreshes).toHaveBeenCalledTimes(tick);
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40000);
    });
    expect(refreshes).toHaveBeenCalledTimes(5);
  });
});

describe("the connected standing", () => {
  it("the chip's label follows the standing — connected stops inviting a sign-in", () => {
    setStatuses([
      {
        ...OFFERED_UNCONNECTED,
        connected: true,
        state: "active",
        plan_type: "plus",
      },
    ]);
    renderShelf();
    expect(
      container.querySelector('button[aria-label="ChatGPT plan"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Sign in with ChatGPT"]'),
    ).toBeNull();
    expect(chipTrigger()?.textContent).toContain("ChatGPT · Plus");
  });

  it("a verifying credential reads as verifying on the chip and in the menu", () => {
    setStatuses([
      { ...OFFERED_UNCONNECTED, connected: true, state: "verifying" },
    ]);
    renderShelf();
    expect(chipTrigger()?.textContent).toContain("verifying…");
    openChipMenu();
    expect(menu()?.textContent).toContain("Verifying your ChatGPT connection…");
    expect(menu()?.textContent).toContain(
      "Uses your ChatGPT plan's included usage.",
    );
    // The gate is behind them: a connected standing never pre-warns.
    expect(menu()?.textContent).not.toContain("device code authorization");
  });

  it("a quota-bounced credential names the reset horizon, not a dead connection", () => {
    setStatuses([
      {
        ...OFFERED_UNCONNECTED,
        connected: true,
        state: "bounced",
        bounce_cause: "quota",
        bounce_retry_at: new Date(Date.now() + 3 * 3600 * 1000).toISOString(),
      },
    ]);
    renderShelf();
    expect(chipTrigger()?.textContent).toContain("reconnect");
    openChipMenu();
    expect(menu()?.textContent).toContain(
      "Your ChatGPT plan's included usage is used up",
    );
    expect(menu()?.textContent).toContain("resets in about 3 hours");
    expect(menu()?.textContent).not.toContain("stopped working");
  });

  it("a reconnect from a bounced credential opens the popup", async () => {
    setStatuses([
      {
        ...OFFERED_UNCONNECTED,
        connected: true,
        state: "bounced",
        bounce_cause: "auth",
      },
    ]);
    renderShelf();
    openChipMenu();
    expect(menu()?.textContent).toContain(
      "Your ChatGPT connection stopped working.",
    );

    api.begin.mockResolvedValueOnce(AN_AUTHORIZATION);
    await act(async () => {
      buttonByText("Reconnect ChatGPT")?.click();
      await Promise.resolve();
    });

    // The in-progress flow wins over the stored standing: the popup
    // opens and the waiting line is reachable on a reconnect.
    expect(openedWindow).toHaveBeenCalledWith(
      AN_AUTHORIZATION.authorize_url,
      "_blank",
      "popup,width=520,height=720",
    );
    expect(menu()?.textContent).toContain("Waiting for ChatGPT…");
  });

  it("a withdrawn offer keeps the credential's disconnect but stops inviting", async () => {
    setStatuses([
      {
        ...OFFERED_UNCONNECTED,
        offered: false,
        connected: true,
        state: "active",
        plan_type: "plus",
      },
    ]);
    renderShelf();
    expect(
      container.querySelector('button[aria-label="ChatGPT plan"]'),
    ).not.toBeNull();
    openChipMenu();

    expect(menu()?.textContent).toContain(
      "ChatGPT sign-in is no longer offered here.",
    );
    expect(menuButtonByText("Sign in with ChatGPT")).toBeNull();
    openStandingActions();
    expect(buttonByText("Disconnect ChatGPT")).not.toBeNull();

    api.disconnect.mockResolvedValueOnce(undefined);
    await act(async () => {
      buttonByText("Disconnect ChatGPT")?.click();
      await Promise.resolve();
    });
    expect(api.disconnect).toHaveBeenCalledWith(
      sessionFixture.value.session,
      "openai_chatgpt",
    );
  });

  it("a disconnect with a failed refetch never shows a stale Connected", async () => {
    // refreshSubscriptions is fire-and-forget; here it never updates the
    // cell (the failed-refetch shape). The removed hold must render, the
    // bounded re-read chain must keep asking, and only a read that
    // actually landed may exit.
    vi.useFakeTimers();
    setStatuses([
      {
        ...OFFERED_UNCONNECTED,
        connected: true,
        state: "active",
        plan_type: "plus",
      },
    ]);
    renderShelf();
    openChipMenu();
    openStandingActions();

    api.disconnect.mockResolvedValueOnce(undefined);
    await act(async () => {
      buttonByText("Disconnect ChatGPT")?.click();
      await Promise.resolve();
    });

    expect(menu()?.textContent).toContain("Disconnected.");
    expect(menu()?.textContent).not.toContain("Connected — Plus plan.");
    expect(buttonByText("Disconnect ChatGPT")).toBeNull();

    // The bounded chain re-reads while the hold stands (1 from the
    // disconnect itself + up to 5 from the chain).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000 * 10);
    });
    expect(
      sessionFixture.value.refreshSubscriptions.mock.calls.length,
    ).toBeLessThanOrEqual(6);
    expect(
      sessionFixture.value.refreshSubscriptions.mock.calls.length,
    ).toBeGreaterThanOrEqual(2);
    expect(menu()?.textContent).toContain("Disconnected.");

    // A read that landed exits the hold and renders the truth.
    setStatuses([OFFERED_UNCONNECTED]);
    expect(menuButtonByText("Sign in with ChatGPT")).not.toBeNull();
    expect(menu()?.textContent).not.toContain("Disconnected.");
  });

  it("an active credential names the plan and offers disconnect", async () => {
    setStatuses([
      {
        ...OFFERED_UNCONNECTED,
        connected: true,
        state: "active",
        plan_type: "plus",
      },
    ]);
    renderShelf();
    openChipMenu();
    expect(menu()?.textContent).toContain("Plus plan");
    expect(buttonByText("Connected")).not.toBeNull();
    openStandingActions();

    api.disconnect.mockResolvedValueOnce(undefined);
    await act(async () => {
      buttonByText("Disconnect ChatGPT")?.click();
      await Promise.resolve();
    });

    expect(api.disconnect).toHaveBeenCalledWith(
      sessionFixture.value.session,
      "openai_chatgpt",
    );
    expect(sessionFixture.value.refreshSubscriptions).toHaveBeenCalled();
  });
});
