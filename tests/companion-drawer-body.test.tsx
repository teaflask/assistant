// @vitest-environment jsdom
/**
 * The drawer body's suggestion seam: the host's provider prop wins
 * wholesale over the served config (even an empty array — explicit JS
 * intent beats remote config, and the fetch never fires), an unset prop
 * kicks the session-cached fetch and renders the served set matched to
 * the page's path, and a promptless answer renders a welcome without
 * rows rather than an error. The matcher's own grammar is
 * served-suggestions.test.ts's subject; the fetch's single-flight is
 * the registry suite's.
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ServedSuggestionsConfig } from "../src/contract/assistant-config";
import { ObservableCell } from "../src/core/observable-cell";
import CompanionDrawerBody from "../src/components/companion-drawer-body";
import type { AssistantSuggestionInput } from "../src/components/conversation-view";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The seam under test is which suggestions reach the view — the view
// itself (welcome layout, rows, transcript) has its own suites.
const viewProps = vi.hoisted(() => ({
  received: [] as (readonly AssistantSuggestionInput[] | undefined)[],
}));
vi.mock("../src/components/conversation-view", () => ({
  ConversationView: (props: {
    suggestions?: readonly AssistantSuggestionInput[];
    welcomeMark?: ReactNode;
  }) => {
    viewProps.received.push(props.suggestions);
    // The welcome mark renders where the view would put it, so the
    // mark plumbing is observable DOM, not a recorded prop.
    return <div data-testid="conversation-view">{props.welcomeMark}</div>;
  },
  SetupErrorState: () => <div data-testid="setup-error" />,
}));

const conversation = vi.hoisted(() => ({
  core: {
    setupError: null as { message: string; code: string } | null,
    resumeStoredThread: () => undefined,
  },
}));
vi.mock("../src/components/use-assistant-conversation", () => ({
  useAssistantConversation: () => conversation.core,
}));

const appearance = vi.hoisted(() => ({
  suggestions: null as readonly AssistantSuggestionInput[] | null,
  companionMark: null as ReactNode | null,
}));
vi.mock("../src/components/appearance-context", () => ({
  useAssistantAppearance: () => ({
    rootProps: {},
    companionMark: appearance.companionMark,
    suggestions: appearance.suggestions,
  }),
}));

const session = vi.hoisted(() => ({
  assistantConfig:
    null as unknown as ObservableCell<ServedSuggestionsConfig | null>,
  ensureAssistantConfig: vi.fn(),
}));
vi.mock("../src/components/teaflask-assistant-provider", () => ({
  useAssistantSession: () => session,
  useOptionalAssistantSession: () => session,
}));

let container: HTMLDivElement;
let root: Root;
let configCell: ObservableCell<ServedSuggestionsConfig | null>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  configCell = new ObservableCell<ServedSuggestionsConfig | null>(null);
  session.assistantConfig = configCell;
  session.ensureAssistantConfig = vi.fn();
  appearance.suggestions = null;
  appearance.companionMark = null;
  viewProps.received.length = 0;
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function renderBody(): void {
  act(() => {
    root.render(<CompanionDrawerBody />);
  });
}

function lastSuggestions(): readonly AssistantSuggestionInput[] | undefined {
  return viewProps.received[viewProps.received.length - 1];
}

describe("the welcome mark", () => {
  it("renders the package's flask by default, unmarked package DOM", () => {
    renderBody();

    const mark = container.querySelector(
      '[data-tf-companion-welcome-mark] [data-tf-companion-mark] [data-tf-agent-mark="primary"]',
    );
    expect(mark).not.toBeNull();
    expect(container.querySelector("[data-tf-host-view]")).toBeNull();
  });

  it("renders the host's node inside the host-view marker", () => {
    appearance.companionMark = <i data-testid="host-mark" />;

    renderBody();

    const hostMark = container.querySelector(
      '[data-tf-companion-welcome-mark] [data-tf-companion-mark] [data-tf-host-view] [data-testid="host-mark"]',
    );
    expect(hostMark).not.toBeNull();
    expect(container.querySelector("[data-tf-agent-mark]")).toBeNull();
  });
});

describe("the host prop", () => {
  it("wins wholesale over served config, and the fetch never fires", () => {
    appearance.suggestions = [{ prompt: "Host opener" }];
    configCell.set({ default: [{ prompt: "Served opener" }], routes: [] });

    renderBody();

    expect(lastSuggestions()).toEqual([{ prompt: "Host opener" }]);
    expect(session.ensureAssistantConfig).not.toHaveBeenCalled();
  });

  it("an explicit empty array still counts as the host's answer", () => {
    appearance.suggestions = [];
    configCell.set({ default: [{ prompt: "Served opener" }], routes: [] });

    renderBody();

    expect(lastSuggestions()).toEqual([]);
    expect(session.ensureAssistantConfig).not.toHaveBeenCalled();
  });
});

describe("the served config", () => {
  it("is fetched on mount and renders once it lands", () => {
    renderBody();
    expect(session.ensureAssistantConfig).toHaveBeenCalledTimes(1);
    expect(lastSuggestions()).toBeUndefined();

    act(() => {
      configCell.set({ default: [{ prompt: "Served opener" }], routes: [] });
    });

    expect(lastSuggestions()).toEqual([{ prompt: "Served opener" }]);
  });

  it("picks the set matching the page's path", () => {
    window.history.replaceState(null, "", "/docs/getting-started");
    configCell.set({
      default: [{ prompt: "Default opener" }],
      routes: [
        { path_prefix: "/docs", suggestions: [{ prompt: "Docs opener" }] },
      ],
    });

    renderBody();

    expect(lastSuggestions()).toEqual([{ prompt: "Docs opener" }]);
  });

  it("renders no rows on a route whose set was authored empty", () => {
    window.history.replaceState(null, "", "/billing");
    configCell.set({
      default: [{ prompt: "Default opener" }],
      routes: [{ path_prefix: "/billing", suggestions: [] }],
    });

    renderBody();

    expect(lastSuggestions()).toEqual([]);
  });
});
