// @vitest-environment jsdom
/**
 * The composer shelf's provider chip: the chip exists only for an
 * identified visitor whose agent config offers a provider (or holds a
 * stored credential); its menu opens upward, carries the disclosure
 * line, runs the device-code flow (begin → code + link → poll at the
 * server's interval → refresh on complete), and closing it unmounts the
 * poll. The transport is canned at the serving-api seam and the session
 * context is handed in as real ObservableCells — the wire itself is the
 * backend suites' subject.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SubscriptionStatus } from "../src/contract/subscriptions";
import { ObservableCell } from "../src/core/observable-cell";
import { ProviderChipShelf } from "../src/components/provider-chip";
import { ServingApiError } from "../src/transport/serving-error";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({
  begin: vi.fn(),
  poll: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("../src/transport/serving-api", () => ({
  beginSubscriptionDeviceAuthorization: (...args: unknown[]) =>
    api.begin(...args) as unknown,
  pollSubscriptionDeviceAuthorization: (...args: unknown[]) =>
    api.poll(...args) as unknown,
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
  user_code: "ZZZZ-TESTA",
  verification_url: "https://auth.openai.com/codex/device?user_code=ZZZZ-TESTA",
  interval: 5,
  sealed_authorization: "chatgpt-device-v1:sealed",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  const subscriptions = new ObservableCell<SubscriptionStatus[] | null>(null);
  const connectOpenRequested = new ObservableCell<boolean>(false);
  sessionFixture.value = {
    session: {},
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

  it("pre-warns about the enablement gate with both deep links", () => {
    // OpenAI's device-code-authorization toggle is off by default and
    // fails only at approve time — the warning must land before the
    // flow starts, with the links the denial sentence can only name.
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    openChipMenu();

    expect(menu()?.textContent).toContain(
      "First time? Turn on device codes in",
    );
    expect(
      anchorByText("ChatGPT's security settings")?.getAttribute("href"),
    ).toBe("https://chatgpt.com/#settings/Security");
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

describe("the device-code flow", () => {
  it("begin leads with the prefilled approve link and demotes the code to a confirm hint", async () => {
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    await beginTheFlow();

    expect(api.begin).toHaveBeenCalledWith(
      sessionFixture.value.session,
      "openai_chatgpt",
    );
    // The link carries the code (prefilled server-side), so the visitor
    // never retypes it — the menu must not instruct them to.
    const link = anchorByText("Open ChatGPT");
    expect(link?.getAttribute("href")).toBe(AN_AUTHORIZATION.verification_url);
    expect(link?.getAttribute("href")).toContain("?user_code=ZZZZ-TESTA");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noreferrer");
    expect(menu()?.textContent).toContain("Approve the connection in ChatGPT");
    expect(menu()?.textContent).toContain("Confirm this code");
    expect(menu()?.textContent).toContain("ZZZZ-TESTA");
    expect(menu()?.textContent).toContain("Waiting for approval…");
    expect(menu()?.textContent).not.toContain("Enter this code on");
    expect(menu()?.querySelector('button[aria-label="Copy code"]')).toBeNull();
  });

  it("the waiting arm drops the enablement caveat — the code is the focus", async () => {
    // The pre-warning belongs to the idle arm; once the flow is running
    // the code and the waiting line are the whole story.
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    await beginTheFlow();

    expect(menu()?.textContent).not.toContain("Turn on device codes");
  });

  it("polls at the server's interval, re-arming at each answered interval", async () => {
    vi.useFakeTimers();
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    await beginTheFlow();

    api.poll.mockResolvedValueOnce({ status: "pending", interval: 7 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(api.poll).toHaveBeenCalledTimes(1);
    expect(api.poll).toHaveBeenCalledWith(
      sessionFixture.value.session,
      "openai_chatgpt",
      AN_AUTHORIZATION.sealed_authorization,
    );

    // The answered interval (7s), not the original 5s, paces the next poll.
    api.poll.mockResolvedValueOnce({ status: "pending", interval: 7 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(api.poll).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(api.poll).toHaveBeenCalledTimes(2);
  });

  it("a completed poll holds a verifying presentation until the refetch lands", async () => {
    vi.useFakeTimers();
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    await beginTheFlow();

    api.poll.mockResolvedValueOnce({ status: "complete", interval: null });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(sessionFixture.value.refreshSubscriptions).toHaveBeenCalled();
    expect(menu()?.textContent).not.toContain("Waiting for approval…");
    // Never a Connect flash at a visitor who just approved: the landed
    // presentation reads as verifying until the refetch answers…
    expect(menuButtonByText("Sign in with ChatGPT")).toBeNull();
    expect(menu()?.textContent).toContain("Verifying your ChatGPT connection…");

    // …and the refreshed standing then renders from status.
    setStatuses([
      { ...OFFERED_UNCONNECTED, connected: true, state: "verifying" },
    ]);
    expect(menu()?.textContent).toContain("Verifying your ChatGPT connection…");
    openStandingActions();
    expect(buttonByText("Disconnect ChatGPT")).not.toBeNull();
  });

  it("the verifying re-read survives failed GETs, bounded", async () => {
    // refreshSubscriptions never updates the cell here — every re-read
    // "fails" — so the chain must re-arm itself up to the bound and stop.
    vi.useFakeTimers();
    setStatuses([
      { ...OFFERED_UNCONNECTED, connected: true, state: "verifying" },
    ]);
    renderShelf();
    openChipMenu();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000 * 10);
    });
    expect(sessionFixture.value.refreshSubscriptions).toHaveBeenCalledTimes(5);
  });

  it("closing the menu stops the poll — no timer survives the unmount", async () => {
    vi.useFakeTimers();
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    await beginTheFlow();

    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(menu()).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(api.poll).not.toHaveBeenCalled();
  });

  it("a transient poll failure keeps waiting and retries with backoff", async () => {
    vi.useFakeTimers();
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    await beginTheFlow();

    api.poll.mockRejectedValueOnce(new TypeError("network down"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(api.poll).toHaveBeenCalledTimes(1);
    // The code and the waiting line survive the blip…
    expect(menu()?.textContent).toContain("ZZZZ-TESTA");
    expect(menu()?.textContent).toContain("Waiting for approval…");

    // …and the retry comes at the doubled interval (5s → 10s).
    api.poll.mockResolvedValueOnce({ status: "pending", interval: 5 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(api.poll).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(api.poll).toHaveBeenCalledTimes(2);
    expect(menu()?.textContent).toContain("Waiting for approval…");
  });

  it("a 429 is a pause, not a verdict: Retry-After paces the next poll", async () => {
    vi.useFakeTimers();
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    await beginTheFlow();

    api.poll.mockRejectedValueOnce(
      new ServingApiError({
        code: "RATE_LIMITED",
        status: 429,
        message: "Too many requests.",
        retryAfterSeconds: 12,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(api.poll).toHaveBeenCalledTimes(1);
    // Still waiting — the code survives the window…
    expect(menu()?.textContent).toContain("ZZZZ-TESTA");
    expect(menu()?.textContent).toContain("Waiting for approval…");

    // …and the next poll honors Retry-After (12s), not the interval.
    api.poll.mockResolvedValueOnce({ status: "pending", interval: 5 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11000);
    });
    expect(api.poll).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(api.poll).toHaveBeenCalledTimes(2);
  });

  it("a zero interval from the wire still paces the poll — never an every-tick loop", async () => {
    vi.useFakeTimers();
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    api.begin.mockResolvedValueOnce({ ...AN_AUTHORIZATION, interval: 0 });
    openChipMenu();
    await act(async () => {
      menuButtonByText("Sign in with ChatGPT")?.click();
      await Promise.resolve();
    });

    // Not immediately…
    api.poll.mockResolvedValueOnce({ status: "pending", interval: 0 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.poll).not.toHaveBeenCalled();
    // …but at the one-second floor — and the answered 0 re-arms at the
    // same floor, never an every-tick loop.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(api.poll).toHaveBeenCalledTimes(1);
    api.poll.mockResolvedValueOnce({ status: "pending", interval: 5 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(api.poll).toHaveBeenCalledTimes(2);
  });

  it("a Retry-After of zero still paces the next poll — never an every-tick loop", async () => {
    // 429s never count toward exhaustion, so the delay is the only
    // throttle; an intermediary's Retry-After: 0 must floor to a second.
    vi.useFakeTimers();
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    await beginTheFlow();

    api.poll.mockRejectedValueOnce(
      new ServingApiError({
        code: "RATE_LIMITED",
        status: 429,
        message: "Too many requests.",
        retryAfterSeconds: 0,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(api.poll).toHaveBeenCalledTimes(1);

    // Not immediately…
    api.poll.mockResolvedValueOnce({ status: "pending", interval: 5 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.poll).toHaveBeenCalledTimes(1);
    // …but at the one-second floor.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(api.poll).toHaveBeenCalledTimes(2);
  });

  it("a 503 after the save yields the standing, not a denial", async () => {
    // The backend pins that a poll can save the credential and still
    // answer 503 (the probe start failed after the save): the surface
    // re-reads the standing and supersedes the flow with it.
    vi.useFakeTimers();
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    await beginTheFlow();

    api.poll.mockRejectedValueOnce(
      new ServingApiError({
        code: "ORCHESTRATION_UNAVAILABLE",
        status: 503,
        message: "Your ChatGPT connection was saved, but…",
        retryAfterSeconds: null,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(sessionFixture.value.refreshSubscriptions).toHaveBeenCalled();

    // The refreshed standing shows the flow's own outcome…
    setStatuses([
      { ...OFFERED_UNCONNECTED, connected: true, state: "verifying" },
    ]);

    // …which supersedes the flow: the verifying standing, no denial.
    expect(menu()?.textContent).toContain("Verifying your ChatGPT connection…");
    expect(menu()?.textContent).not.toContain("Waiting for approval…");
    expect(buttonByText("Try connecting ChatGPT again")).toBeNull();
  });

  it("a probe that bounces mid-flow exits into the reconnect presentation", async () => {
    // The landed flow's outcome can already be bounced (a free account's
    // probe settles fast): the refreshed standing must exit the flow,
    // never trap the menu in "verifying".
    vi.useFakeTimers();
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    await beginTheFlow();

    api.poll.mockResolvedValueOnce({ status: "complete", interval: null });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(menu()?.textContent).toContain("Verifying your ChatGPT connection…");

    setStatuses([
      {
        ...OFFERED_UNCONNECTED,
        connected: true,
        state: "bounced",
        bounce_cause: "auth",
      },
    ]);

    expect(menu()?.textContent).toContain(
      "Your ChatGPT connection stopped working.",
    );
    expect(buttonByText("Reconnect ChatGPT")).not.toBeNull();
    expect(menu()?.textContent).not.toContain(
      "Verifying your ChatGPT connection…",
    );
  });

  it("a reconnect that completes holds verifying — never the stale bounced standing", async () => {
    // The refetch hasn't landed when the poll answers complete: this
    // render still sees the OLD bounced row, and dropping to it would
    // tell a visitor who just approved that their connection stopped
    // working.
    vi.useFakeTimers();
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
    api.begin.mockResolvedValueOnce(AN_AUTHORIZATION);
    await act(async () => {
      buttonByText("Reconnect ChatGPT")?.click();
      await Promise.resolve();
    });

    api.poll.mockResolvedValueOnce({ status: "complete", interval: null });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(menu()?.textContent).toContain("Verifying your ChatGPT connection…");
    expect(menu()?.textContent).not.toContain(
      "Your ChatGPT connection stopped working.",
    );
    expect(buttonByText("Reconnect ChatGPT")).toBeNull();

    // The read that actually landed after the completion exits the flow.
    setStatuses([
      { ...OFFERED_UNCONNECTED, connected: true, state: "verifying" },
    ]);
    expect(menu()?.textContent).toContain("Verifying your ChatGPT connection…");
    openStandingActions();
    expect(buttonByText("Disconnect ChatGPT")).not.toBeNull();
  });

  it("a completion that arrives after a dismissal still refreshes the standing", async () => {
    // The completing poll is the slowest (two upstream round trips) and
    // any outside pointerdown light-dismisses the menu: the credential
    // exists server-side, so the session-cached standing must not say
    // "not connected" for the page's life.
    vi.useFakeTimers();
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    await beginTheFlow();

    let answerThePoll!: (value: unknown) => void;
    api.poll.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerThePoll = resolve;
        }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(api.poll).toHaveBeenCalledTimes(1);

    // Light-dismiss while the poll is in flight.
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(menu()).toBeNull();
    expect(sessionFixture.value.refreshSubscriptions).not.toHaveBeenCalled();

    await act(async () => {
      answerThePoll({ status: "complete", interval: null });
      await Promise.resolve();
    });
    expect(sessionFixture.value.refreshSubscriptions).toHaveBeenCalledTimes(1);
  });

  it("an invalidated authorization lands as start-again, not a broken surface", async () => {
    // The coarse code (expired, wrong-visitor, wrong-provider,
    // malformed) keeps its cause-free override — only a settled denial
    // carries its own code and sentence.
    vi.useFakeTimers();
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    await beginTheFlow();

    api.poll.mockRejectedValueOnce(
      new ServingApiError({
        code: "SUBSCRIPTION_AUTHORIZATION_INVALID",
        status: 403,
        message: "That connection attempt is no longer valid — start it again.",
        retryAfterSeconds: null,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(menu()?.textContent).toContain(
      "That connection attempt can't be completed — start a new one.",
    );
    expect(buttonByText("Try connecting ChatGPT again")).not.toBeNull();
  });

  it("a settled denial shows the server's toggle-naming recovery verbatim", async () => {
    vi.useFakeTimers();
    setStatuses([OFFERED_UNCONNECTED]);
    renderShelf();
    await beginTheFlow();

    const denialSentence =
      "ChatGPT didn't approve the connection. If you didn't decline " +
      "it, enable device code authorization in ChatGPT's Settings → " +
      "Security (workspace accounts: an admin enables it at " +
      "chatgpt.com/admin/permissions), then start a new connection.";
    api.poll.mockRejectedValueOnce(
      new ServingApiError({
        code: "SUBSCRIPTION_DEVICE_GRANT_DENIED",
        status: 403,
        message: denialSentence,
        retryAfterSeconds: null,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(menu()?.textContent).toContain(denialSentence);
    expect(buttonByText("Try connecting ChatGPT again")).not.toBeNull();
    // The hint's links sit right under the sentence — the fix is a
    // click away, not a sentence to transcribe.
    expect(anchorByText("ChatGPT's security settings")).not.toBeNull();
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

  it("a reconnect from a bounced credential shows the device code", async () => {
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

    // The in-progress flow wins over the stored standing: the code and
    // the waiting line are reachable on a reconnect.
    expect(menu()?.textContent).toContain("ZZZZ-TESTA");
    expect(menu()?.textContent).toContain("Waiting for approval…");
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
