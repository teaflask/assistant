// @vitest-environment jsdom
/**
 * The composer shelf's two controls. With a served menu the shelf hosts
 * the model & reasoning chip — its menu opens upward with the wire's
 * model rows (display names off the wire, a check on the current
 * selection) and the SELECTED model's own effort ladder (per-option
 * sets) as a labeled sub-row — beside the ChatGPT account chip, an
 * independent sibling that owns the connect affordance. Without a menu
 * the shelf renders the provider chip alone. Selection reports through
 * the composer contract's setModelPick; the wire write itself is the
 * conversation store's and the backend suites' subject.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ServedModelChoice,
  ServedThinkingEffort,
} from "../src/contract/assistant-config";
import type { SubscriptionStatus } from "../src/contract/subscriptions";
import type {
  ComposerModelPick,
  ComposerContract,
} from "../src/core/conversation-store";
import { ObservableCell } from "../src/core/observable-cell";
import { ModelPickerShelf } from "../src/components/model-picker-chip";

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
  configAnswered: ObservableCell<boolean>;
  modelChoice: ObservableCell<ServedModelChoice | null>;
  ensureAssistantConfig: ReturnType<typeof vi.fn>;
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

const conversationFixture = vi.hoisted(() => ({
  value: null as unknown as ComposerContract,
}));
vi.mock("../src/components/conversation-context", () => ({
  useConversation: () => conversationFixture.value,
}));

// Each option carries its OWN supported set — non-total sets included
// (five levels here, three there). The chip renders the SELECTED
// option's set; the root intersection survives only as the stale-pin
// fallback the wire keeps for additivity.
const A_MENU: ServedModelChoice = {
  models: [
    {
      id: "claude-sonnet-5",
      display_name: "Claude Sonnet 5",
      provider_display_name: "Anthropic",
      efforts: ["low", "medium", "high", "xhigh", "max"],
    },
    {
      id: "gpt-5.6-terra",
      display_name: "GPT-5.6 Terra",
      provider_display_name: "OpenAI",
      efforts: ["low", "medium", "high"],
    },
  ],
  efforts: ["low", "medium", "high"],
  default_model_id: "claude-sonnet-5",
  default_effort: "medium",
  configured_effort: "medium",
};

const OFFERED_UNCONNECTED: SubscriptionStatus = {
  provider: "openai_chatgpt",
  offered: true,
  connected: false,
  state: null,
  plan_type: null,
  bounce_cause: null,
  bounce_retry_at: null,
};

let container: HTMLDivElement;
let root: Root;
let setModelPick: ReturnType<typeof vi.fn<(pick: ComposerModelPick) => void>>;

beforeEach(() => {
  vi.clearAllMocks();
  sessionFixture.value = {
    session: {},
    tier: null,
    // Answered from the start: the fetch has settled in every test but
    // the fetch-window one, which resets it itself.
    configAnswered: new ObservableCell<boolean>(true),
    modelChoice: new ObservableCell<ServedModelChoice | null>(null),
    ensureAssistantConfig: vi.fn(),
    subscriptions: new ObservableCell<SubscriptionStatus[] | null>(null),
    ensureSubscriptions: vi.fn(),
    refreshSubscriptions: vi.fn(),
    connectOpenRequested: new ObservableCell<boolean>(false),
    requestSubscriptionConnect: () => {
      sessionFixture.value.connectOpenRequested.set(true);
    },
    acknowledgeSubscriptionConnect: () => {
      sessionFixture.value.connectOpenRequested.set(false);
    },
  };
  setModelPick = vi.fn<(pick: ComposerModelPick) => void>();
  conversationFixture.value = {
    busy: false,
    pendingSend: false,
    sendMessage: vi.fn(),
    pendingEcho: null,
    composerRefocusPending: false,
    markComposerRefocusHandled: () => {
      // No remount in this suite.
    },
    stopping: false,
    stopTurn: () => Promise.resolve(),
    modelPick: null,
    setModelPick,
    composerInput: new ObservableCell({
      scope: "u:0",
      draft: "",
      attachments: [],
    }),
    setDraft: () => undefined,
    setAttachments: () => undefined,
    noteComposerFocus: () => undefined,
    takeComposerCaretReturn: () => false,
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
});

function renderShelf(): void {
  act(() => {
    root.render(<ModelPickerShelf />);
  });
}

function setMenu(menu: ServedModelChoice | null): void {
  act(() => {
    sessionFixture.value.modelChoice.set(menu);
  });
}

function setPick(pick: ComposerModelPick | null): void {
  conversationFixture.value = { ...conversationFixture.value, modelPick: pick };
  renderShelf();
}

function chipTrigger(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(
    'button[aria-controls="tf-model-picker-menu"]',
  );
}

function menuElement(): HTMLElement | null {
  return container.querySelector<HTMLElement>("#tf-model-picker-menu");
}

function accountTrigger(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(
    'button[aria-controls="tf-provider-chip-menu"]',
  );
}

function accountMenu(): HTMLElement | null {
  return container.querySelector<HTMLElement>("#tf-provider-chip-menu");
}

function openMenu(): void {
  const trigger = chipTrigger();
  if (trigger === null) {
    throw new Error("No picker chip on the shelf.");
  }
  act(() => {
    trigger.click();
  });
}

function menuButtonByText(text: string): HTMLButtonElement | null {
  return (
    [...(menuElement()?.querySelectorAll("button") ?? [])].find((button) =>
      button.textContent.trim().startsWith(text),
    ) ?? null
  );
}

function accountButtonByText(text: string): HTMLButtonElement | null {
  return (
    [...(accountMenu()?.querySelectorAll("button") ?? [])].find((button) =>
      button.textContent.trim().startsWith(text),
    ) ?? null
  );
}

/** A user press on an element: pointerdown first (what the chips' light
 *  dismiss listens for), then the click — jsdom's bare click() skips the
 *  pointer phase a real press always leads with. */
function press(element: HTMLElement | null): void {
  if (element === null) {
    throw new Error("Nothing to press.");
  }
  act(() => {
    element.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    element.click();
  });
}

function offerAProvider(): void {
  sessionFixture.value.tier = "identified";
  act(() => {
    sessionFixture.value.subscriptions.set([OFFERED_UNCONNECTED]);
  });
}

describe("the shelf: two controls", () => {
  it("renders no picker without a served menu — the provider chip's shelf stands", () => {
    renderShelf();
    expect(chipTrigger()).toBeNull();
    // And an identified visitor with an offered provider still gets the
    // provider chip, exactly the menu-less shelf.
    offerAProvider();
    renderShelf();
    expect(accountTrigger()).not.toBeNull();
    expect(chipTrigger()).toBeNull();
  });

  it("renders no chip until the config read settles, then falls back honestly", () => {
    // The fetch window: the slot's identity is unknown, so neither chip
    // mounts — a provider chip here would flash.
    sessionFixture.value.tier = "identified";
    act(() => {
      sessionFixture.value.configAnswered.set(false);
      sessionFixture.value.subscriptions.set([OFFERED_UNCONNECTED]);
    });
    renderShelf();
    expect(chipTrigger()).toBeNull();
    expect(accountTrigger()).toBeNull();
    // The read settles with no menu — the toggle is off, OR the fetch
    // failed (failure is an answer too): the provider chip takes the
    // slot off the separate subscriptions read — a broken config read
    // never costs the connect affordance.
    act(() => {
      sessionFixture.value.configAnswered.set(true);
    });
    expect(accountTrigger()).not.toBeNull();
  });

  it("the account chip stands beside the picker — connect lives in its own menu", () => {
    offerAProvider();
    setMenu(A_MENU);
    renderShelf();
    // Two independent controls on one shelf row…
    expect(chipTrigger()).not.toBeNull();
    expect(accountTrigger()).not.toBeNull();
    // …and the picker menu carries no account concern at all: no
    // connect verb, no funding copy.
    openMenu();
    expect(menuButtonByText("Sign in with ChatGPT")).toBeNull();
    expect(menuElement()?.textContent).not.toContain("Models your plan");
    expect(accountMenu()).toBeNull();
    // The pick-to-plan funding sentence moved WITH the account concern:
    // the account menu owns "who pays?", and beside a picker it carries
    // the one sentence relating the pick to the plan.
    press(accountTrigger());
    expect(accountMenu()?.textContent).toContain(
      "Models your plan serves run on it",
    );
  });

  it("consumes the parked connect ask by opening the ACCOUNT menu, not the picker's", () => {
    // requestSubscriptionConnect's ring: the account chip owns the
    // connect affordance now, so the ask opens ITS menu — the picker
    // stays closed and no pick is written.
    offerAProvider();
    setMenu(A_MENU);
    renderShelf();
    expect(accountMenu()).toBeNull();

    act(() => {
      sessionFixture.value.connectOpenRequested.set(true);
    });

    expect(accountMenu()).not.toBeNull();
    expect(accountButtonByText("Sign in with ChatGPT")).not.toBeNull();
    expect(menuElement()).toBeNull();
    expect(sessionFixture.value.connectOpenRequested.get()).toBe(false);
    expect(setModelPick).not.toHaveBeenCalled();
  });

  it("a connect ask on a menu-less shelf lands in the provider chip's menu — and never loops the render", () => {
    // The plain menu-less posture: identified, provider offered, NO
    // served menu (toggle off or read failed). The public host API must
    // be honored by the provider shelf branch; the two-chip shelf owns
    // no account chip here and must stand down instead of fighting its
    // own close guard into "Too many re-renders" (round-2 regression).
    offerAProvider();
    renderShelf();
    expect(chipTrigger()).toBeNull();

    act(() => {
      sessionFixture.value.requestSubscriptionConnect();
    });

    expect(accountMenu()).not.toBeNull();
    expect(accountButtonByText("Sign in with ChatGPT")).not.toBeNull();
    // Without a picker there are no "other picks" — the pick-to-plan
    // funding sentence stays out of the no-menu shelf's account menu.
    expect(accountMenu()?.textContent).not.toContain("Models your plan");
    expect(sessionFixture.value.connectOpenRequested.get()).toBe(false);
  });

  it("an ask rung before the config read settles stays PARKED, then is honored on landing", () => {
    // Pre-settle the shelf renders nothing and owns nothing: consuming
    // the ask here would burn a ring on behalf of whichever shelf is
    // about to take the slot. Parked-ness is asserted on the cell
    // itself, not by proxy.
    sessionFixture.value.tier = "identified";
    act(() => {
      sessionFixture.value.configAnswered.set(false);
      sessionFixture.value.subscriptions.set([OFFERED_UNCONNECTED]);
    });
    renderShelf();

    act(() => {
      sessionFixture.value.requestSubscriptionConnect();
    });

    expect(chipTrigger()).toBeNull();
    expect(accountTrigger()).toBeNull();
    expect(sessionFixture.value.connectOpenRequested.get()).toBe(true);

    // The read lands WITH a menu: the two-chip shelf takes the slot and
    // honors the parked ask visibly in the account menu.
    setMenu(A_MENU);
    act(() => {
      sessionFixture.value.configAnswered.set(true);
    });
    expect(accountMenu()).not.toBeNull();
    expect(menuElement()).toBeNull();
    expect(sessionFixture.value.connectOpenRequested.get()).toBe(false);
  });

  it("parks the connect ask when nothing is connectable", () => {
    // The ask is ABOUT connecting: with no provider offered the account
    // chip is unmounted and the ask stays parked for a surface that can
    // honor it, exactly the empty-shelf behavior.
    setMenu(A_MENU);
    renderShelf();

    act(() => {
      sessionFixture.value.connectOpenRequested.set(true);
    });

    expect(menuElement()).toBeNull();
    expect(accountMenu()).toBeNull();
    expect(sessionFixture.value.connectOpenRequested.get()).toBe(true);
  });

  it("holds one menu at most under the pointer: a press on either trigger closes the other", () => {
    // The everyday path: a real press leads with pointerdown, which the
    // closing side's light dismiss also sees. The invariant itself is
    // structural (one openChip value on the shelf) — the two tests below
    // pin the paths light dismiss alone would miss.
    offerAProvider();
    setMenu(A_MENU);
    renderShelf();

    press(chipTrigger());
    expect(menuElement()).not.toBeNull();
    expect(accountMenu()).toBeNull();

    press(accountTrigger());
    expect(menuElement()).toBeNull();
    expect(accountMenu()).not.toBeNull();

    press(chipTrigger());
    expect(menuElement()).not.toBeNull();
    expect(accountMenu()).toBeNull();
  });

  it("holds one menu at most under the keyboard: an Enter-open fires no pointerdown", () => {
    // Enter/Space on a focused trigger produces only a click — no
    // pointer event, so the other menu's light dismiss never runs. Only
    // the shelf's single openChip value keeps the row to one dialog.
    offerAProvider();
    setMenu(A_MENU);
    renderShelf();

    openMenu(); // plain click(), exactly what Enter dispatches
    expect(menuElement()).not.toBeNull();

    act(() => {
      accountTrigger()?.click();
    });
    expect(menuElement()).toBeNull();
    expect(accountMenu()).not.toBeNull();

    act(() => {
      chipTrigger()?.click();
    });
    expect(accountMenu()).toBeNull();
    expect(menuElement()).not.toBeNull();
    expect(
      container.querySelectorAll('[role="dialog"]').length,
    ).toBeLessThanOrEqual(1);
  });

  it("a connect ask rung while the picker menu is open surfaces VISIBLY, not behind it", () => {
    // requestSubscriptionConnect is a public host API with no pointer
    // event at all. It must close the picker and open the account menu
    // on top — an ask acknowledged behind another menu is consumed while
    // the visitor sees nothing change.
    offerAProvider();
    setMenu(A_MENU);
    renderShelf();
    openMenu();
    expect(menuElement()).not.toBeNull();

    act(() => {
      sessionFixture.value.connectOpenRequested.set(true);
    });

    expect(menuElement()).toBeNull();
    expect(accountMenu()).not.toBeNull();
    expect(accountButtonByText("Sign in with ChatGPT")).not.toBeNull();
    expect(container.querySelectorAll('[role="dialog"]').length).toBe(1);
    expect(sessionFixture.value.connectOpenRequested.get()).toBe(false);
    expect(setModelPick).not.toHaveBeenCalled();
  });

  it("a model pick never opens or alters the account control", () => {
    offerAProvider();
    setMenu(A_MENU);
    renderShelf();
    const accountLabel = accountTrigger()?.textContent;
    openMenu();
    act(() => {
      menuButtonByText("GPT-5.6 Terra")?.click();
    });
    expect(setModelPick).toHaveBeenCalledTimes(1);
    expect(accountMenu()).toBeNull();
    expect(accountTrigger()?.textContent).toBe(accountLabel);
  });

  it("connecting never touches the pick — model and effort survive the account flow", () => {
    api.begin.mockReturnValue(
      new Promise(() => {
        // Held open: the flow's own suite covers the device-code dance.
      }),
    );
    offerAProvider();
    setMenu(A_MENU);
    setPick({ modelId: "gpt-5.6-terra", effort: "low" });
    press(accountTrigger());
    act(() => {
      accountButtonByText("Sign in with ChatGPT")?.click();
    });
    // The connect lands: the standing flips to a connected plan.
    act(() => {
      sessionFixture.value.subscriptions.set([
        {
          ...OFFERED_UNCONNECTED,
          connected: true,
          state: "active",
          plan_type: "plus",
        },
      ]);
    });
    expect(setModelPick).not.toHaveBeenCalled();
    expect(chipTrigger()?.textContent).toContain("GPT-5.6 Terra");
  });
});

describe("the menu", () => {
  it("labels the chip with the served default until a pick exists", () => {
    setMenu(A_MENU);
    renderShelf();
    expect(chipTrigger()?.textContent).toContain("Claude Sonnet 5");
  });

  it("opens on exactly the Model and Effort choices, with no provider catalogue", () => {
    setMenu(A_MENU);
    renderShelf();
    openMenu();
    const visibleButtons = [
      ...(menuElement()?.querySelectorAll<HTMLButtonElement>(
        ":scope > div:not([hidden]) > button",
      ) ?? []),
    ].map((button) => button.textContent.trim());
    expect(visibleButtons).toEqual(["ModelClaude Sonnet 5", "EffortMedium"]);
    expect(menuElement()?.textContent).not.toContain("Anthropic");
    expect(menuElement()?.textContent).not.toContain("OpenAI");
    expect(menuElement()?.textContent).not.toContain("Advanced");
    expect(menuElement()?.textContent).not.toContain("Speed");
  });

  it("renders the wire's models with a check and the SELECTED model's own ladder", () => {
    // The default selection is the five-level model, so the ladder is
    // its full set — not the three-level root intersection.
    setMenu(A_MENU);
    renderShelf();
    openMenu();
    const rows = [
      ...(menuElement()?.querySelectorAll("button[aria-pressed]") ?? []),
    ];
    expect(
      rows.map((row) => [
        row.textContent.replace("Anthropic", "").replace("OpenAI", "").trim(),
        row.getAttribute("aria-pressed"),
      ]),
    ).toEqual([
      ["Claude Sonnet 5", "true"],
      ["GPT-5.6 Terra", "false"],
      ["Low", "false"],
      ["Medium", "true"],
      ["High", "false"],
      ["Extra high", "false"],
      ["Max", "false"],
    ]);
  });

  it("labels a five-level ladder like the operator vocabulary, default preselected", () => {
    // The chip must label the new levels like the dashboard does —
    // "Extra high"/"Max", never "Xhigh" — and the wire guarantees
    // default_effort is a member of every option's set (it is clamped
    // into the root intersection), so exactly one level is preselected.
    setMenu({
      models: [
        {
          id: "claude-sonnet-5",
          display_name: "Claude Sonnet 5",
          provider_display_name: "Anthropic",
          efforts: ["low", "medium", "high", "xhigh", "max"],
        },
      ],
      efforts: ["low", "medium", "high", "xhigh", "max"],
      default_model_id: "claude-sonnet-5",
      default_effort: "xhigh",
      configured_effort: "xhigh",
    });
    renderShelf();
    openMenu();
    const effortRows = [
      ...(menuElement()?.querySelectorAll(
        '[aria-label="Reasoning effort"] button[aria-pressed]',
      ) ?? []),
    ];
    expect(
      effortRows.map((row) => [
        row.textContent.trim(),
        row.getAttribute("aria-pressed"),
      ]),
    ).toEqual([
      ["Low", "false"],
      ["Medium", "false"],
      ["High", "false"],
      ["Extra high", "true"],
      ["Max", "false"],
    ]);
  });

  it("preselects the configured truth, not the root-clamped compatibility value", () => {
    // Sonnet configured at xhigh while a budgeted three-level model caps
    // the root intersection at high: default_effort serves clamped
    // ("high" — the one-ladder compatibility value) but the chip renders
    // Sonnet's own ladder and must preselect the TRUTH — Extra high —
    // never inviting a "my agent runs at High" misreading. Composed with
    // the already-current guard, clicking the truthful segment is inert.
    setMenu({
      models: [
        A_MENU.models[0],
        {
          id: "claude-haiku-4-5",
          display_name: "Claude Haiku 4.5",
          provider_display_name: "Anthropic",
          efforts: ["low", "medium", "high"],
        },
      ],
      efforts: ["low", "medium", "high"],
      default_model_id: "claude-sonnet-5",
      default_effort: "high",
      configured_effort: "xhigh",
    });
    renderShelf();
    openMenu();
    const pressed = [
      ...(menuElement()?.querySelectorAll(
        '[aria-label="Reasoning effort"] button[aria-pressed="true"]',
      ) ?? []),
    ];
    expect(pressed.map((button) => button.textContent)).toEqual(["Extra high"]);
    act(() => {
      menuButtonByText("Extra high")?.click();
    });
    expect(setModelPick).not.toHaveBeenCalled();
  });

  it("offers xhigh and max on a model that supports them — and writes them", () => {
    // The ticket's unlock: under the root intersection these levels were
    // unreachable for every visitor. On the selected model's own ladder
    // they are real choices, backed by the wire values.
    setMenu(A_MENU);
    renderShelf();
    openMenu();
    act(() => {
      menuButtonByText("Extra high")?.click();
    });
    expect(setModelPick).toHaveBeenCalledWith({
      modelId: null,
      effort: "xhigh",
    });
    act(() => {
      menuButtonByText("Max")?.click();
    });
    expect(setModelPick).toHaveBeenCalledWith({ modelId: null, effort: "max" });
  });

  it("a model whose set omits a level does not offer it", () => {
    setMenu(A_MENU);
    setPick({ modelId: "gpt-5.6-terra", effort: null });
    openMenu();
    const labels = [
      ...(menuElement()?.querySelectorAll(
        '[aria-label="Reasoning effort"] button[aria-pressed]',
      ) ?? []),
    ].map((button) => button.textContent.trim());
    expect(labels).toEqual(["Low", "Medium", "High"]);
  });

  it("switching to a model that lacks the current level lands on nearest-supported", () => {
    // Amendment C: the pair resolves deterministically ON the write —
    // never a stored pair the menu can't show (no silent mismatch).
    setMenu(A_MENU);
    setPick({ modelId: null, effort: "max" });
    openMenu();
    act(() => {
      menuButtonByText("GPT-5.6 Terra")?.click();
    });
    expect(setModelPick).toHaveBeenCalledWith({
      modelId: "gpt-5.6-terra",
      effort: "high",
    });
  });

  it("resolves an equidistant switch DOWN — the platform's one tie rule", () => {
    setMenu({
      models: [
        A_MENU.models[0],
        {
          id: "gpt-5.6-nano",
          display_name: "GPT-5.6 Nano",
          provider_display_name: "OpenAI",
          efforts: ["low", "high"],
        },
      ],
      efforts: ["low", "high"],
      default_model_id: "claude-sonnet-5",
      default_effort: "low",
      configured_effort: "low",
    });
    setPick({ modelId: null, effort: "medium" });
    openMenu();
    act(() => {
      menuButtonByText("GPT-5.6 Nano")?.click();
    });
    expect(setModelPick).toHaveBeenCalledWith({
      modelId: "gpt-5.6-nano",
      effort: "low",
    });
  });

  it("switching keeps a pin the new model supports, verbatim", () => {
    setMenu(A_MENU);
    setPick({ modelId: null, effort: "low" });
    openMenu();
    act(() => {
      menuButtonByText("GPT-5.6 Terra")?.click();
    });
    expect(setModelPick).toHaveBeenCalledWith({
      modelId: "gpt-5.6-terra",
      effort: "low",
    });
  });

  it("reports a model pick through the contract and STAYS open", () => {
    // A null effort pin stays null across a switch: the config answers,
    // and no pin is ever materialized from the display default. The menu
    // stays open like an effort click's — model and effort are one
    // decision, and the ladder just changed under this pick, so closing
    // would resolve the effort off-screen.
    setMenu(A_MENU);
    renderShelf();
    openMenu();
    act(() => {
      menuButtonByText("GPT-5.6 Terra")?.click();
    });
    expect(setModelPick).toHaveBeenCalledWith({
      modelId: "gpt-5.6-terra",
      effort: null,
    });
    expect(menuElement()).not.toBeNull();
  });

  it("picking the served default reports NO pin — the way back", () => {
    setMenu(A_MENU);
    setPick({ modelId: "gpt-5.6-terra", effort: "low" });
    openMenu();
    act(() => {
      menuButtonByText("Claude Sonnet 5")?.click();
    });
    expect(setModelPick).toHaveBeenCalledWith({
      modelId: null,
      effort: "low",
    });
  });

  it("a stored pin outside the rendered ladder shows its nearest member (round-6)", () => {
    // A thread's stored "max" (pinned under the five-level model) meets
    // the three-level ladder of the model it pins. The row must select
    // the nearest member — never render with nothing pressed — and,
    // composed with the already-current guard, clicking that highlighted
    // segment writes nothing: the stored pin stays "max" and the runtime
    // clamps it per answering model.
    setMenu(A_MENU);
    setPick({ modelId: "gpt-5.6-terra", effort: "max" }); // ladder: low | medium | high
    openMenu();
    const pressed = [
      ...(menuElement()?.querySelectorAll(
        '[aria-label="Reasoning effort"] button[aria-pressed="true"]',
      ) ?? []),
    ];
    expect(pressed.map((button) => button.textContent)).toEqual(["High"]);
    act(() => {
      menuButtonByText("High")?.click();
    });
    expect(setModelPick).not.toHaveBeenCalled();
  });

  it("clicking the already-current effort writes no pin — the display clamp trap", () => {
    // A_MENU preselects "Medium" (default_effort). The preselected value
    // may be the config's effort CLAMPED for display — the root-clamped
    // default can understate a config tuned above the intersection — so
    // writing it back on a no-op click would pin a real downgrade. The
    // guard makes that click inert.
    setMenu(A_MENU);
    renderShelf();
    openMenu();
    act(() => {
      menuButtonByText("Medium")?.click();
    });
    expect(setModelPick).not.toHaveBeenCalled();
  });

  it("an effort-only choice never pins a model", () => {
    setMenu(A_MENU);
    renderShelf();
    openMenu();
    act(() => {
      menuButtonByText("High")?.click();
    });
    expect(setModelPick).toHaveBeenCalledWith({
      modelId: null,
      effort: "high",
    });
  });

  it("reports an effort pick on the current model and stays open", () => {
    setMenu(A_MENU);
    setPick({ modelId: "gpt-5.6-terra", effort: null });
    openMenu();
    act(() => {
      menuButtonByText("High")?.click();
    });
    expect(setModelPick).toHaveBeenCalledWith({
      modelId: "gpt-5.6-terra",
      effort: "high",
    });
    expect(menuElement()).not.toBeNull();
  });

  it("shows the thread's stored pick on reopen — per-thread stickiness", () => {
    setMenu(A_MENU);
    setPick({ modelId: "gpt-5.6-terra", effort: "low" });
    expect(chipTrigger()?.textContent).toContain("GPT-5.6 Terra");
    openMenu();
    expect(
      menuButtonByText("GPT-5.6 Terra")?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(menuButtonByText("Low")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("an effort outside this bundle's vocabulary falls to the served default, never a blank row", () => {
    // The contract lets the wire's vocabulary grow: a stored pin (or a
    // configured_effort) this bundle can't rank must not render the
    // no-selection state reserved for thinking-off. default_effort is
    // the rescue — root-clamped, so a member of every option's ladder.
    setMenu({
      ...A_MENU,
      configured_effort: "turbo" as ServedThinkingEffort,
    });
    renderShelf();
    openMenu();
    expect(menuButtonByText("Medium")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    // And the same rescue for an unknown stored pin.
    setPick({ modelId: null, effort: "ultra" as ServedThinkingEffort });
    expect(menuButtonByText("Medium")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("shows no checked effort when the config sends no thinking", () => {
    setMenu({ ...A_MENU, default_effort: null, configured_effort: null });
    renderShelf();
    openMenu();
    const efforts = ["Low", "Medium", "High", "Extra high", "Max"].map(
      (label) => menuButtonByText(label)?.getAttribute("aria-pressed"),
    );
    expect(efforts).toEqual(["false", "false", "false", "false", "false"]);
  });

  it("names the effort it displays in the chip's accessible name", () => {
    // The visible label reads model + effort; an aria-label naming only
    // the model would override it for assistive tech (WCAG 2.5.3).
    setMenu(A_MENU);
    renderShelf();
    expect(chipTrigger()?.getAttribute("aria-label")).toBe(
      "Model: Claude Sonnet 5, effort: Medium",
    );
  });

  it("drilling in keeps focus inside the menu, so Esc still closes it", () => {
    // Drill-in hides the panel holding the just-clicked button. Without
    // a focus hand-off that drops focus to <body>, where the menu's
    // keydown handler never hears the Escape.
    setMenu(A_MENU);
    renderShelf();
    openMenu();
    const drillIn = menuButtonByText("Model");
    act(() => {
      drillIn?.focus();
      drillIn?.click();
    });
    expect(document.activeElement).not.toBe(document.body);
    expect(menuElement()?.contains(document.activeElement)).toBe(true);
    // The panel taking focus must introduce itself to assistive tech,
    // like the effort panel beside it.
    expect(document.activeElement?.getAttribute("role")).toBe("group");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Model");
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(menuElement()).toBeNull();
    expect(document.activeElement).toBe(chipTrigger());
  });

  it("a selection's hop back to the root panel keeps focus in the menu", () => {
    setMenu(A_MENU);
    renderShelf();
    openMenu();
    // Drill in first: a visitor can only click a model row on the
    // VISIBLE model panel, and the hop back is root-ward from there.
    act(() => {
      menuButtonByText("Model")?.click();
    });
    const modelRow = menuButtonByText("GPT-5.6 Terra");
    act(() => {
      modelRow?.focus();
      modelRow?.click();
    });
    expect(menuElement()).not.toBeNull();
    expect(menuElement()?.contains(document.activeElement)).toBe(true);
    // The root panel taking focus must introduce itself too.
    expect(document.activeElement?.getAttribute("role")).toBe("group");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Model and effort",
    );
  });

  it("Esc closes the menu and hands focus back to the chip", () => {
    setMenu(A_MENU);
    renderShelf();
    openMenu();
    act(() => {
      menuButtonByText("GPT-5.6 Terra")?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(menuElement()).toBeNull();
    expect(document.activeElement).toBe(chipTrigger());
  });

  it("Esc on the open trigger closes without leaking to the hosting surface", () => {
    setMenu(A_MENU);
    renderShelf();
    openMenu();
    // The hosting surface lives ABOVE the widget's root (a drawer, a
    // sheet): its Esc listener must never see the close that was meant
    // for this menu. (React re-dispatches from its root, so same-node
    // listeners still fire — the contract is about ancestors.)
    const seenByHost = vi.fn();
    document.body.addEventListener("keydown", seenByHost);
    act(() => {
      chipTrigger()?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    document.body.removeEventListener("keydown", seenByHost);
    expect(menuElement()).toBeNull();
    expect(seenByHost).not.toHaveBeenCalled();
  });

  it("a pointer outside light-dismisses the menu", () => {
    setMenu(A_MENU);
    renderShelf();
    openMenu();
    expect(menuElement()).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(menuElement()).toBeNull();
  });
});
