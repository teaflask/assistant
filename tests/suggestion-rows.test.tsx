// @vitest-environment jsdom
/**
 * The welcome's opening prompts are HOST data, and the script-tag
 * distribution's hosts are plain JS — nothing type-checks their
 * suggestion objects the way a React consumer's compiler does. A kind
 * the package doesn't know must take the default glyph; rendering
 * `undefined` as a component throws and takes the whole surface down
 * over a typo.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationView } from "../src/components/conversation-view";
import type { AssistantConversation } from "../src/components/use-assistant-conversation";
import { ObservableCell } from "../src/core/observable-cell";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The transcript is the other half of the view and not this suite's
// subject — the welcome (no messages yet) is.
vi.mock("../src/components/transcript", () => ({
  Transcript: () => <div data-testid="transcript" />,
}));

// No conversation and nothing opening — the welcome branch.
function emptyConversation(): AssistantConversation {
  return {
    composerContract: {
      busy: false,
      sendMessage: () => Promise.resolve(true),
      pendingEcho: null,
      composerRefocusPending: false,
      markComposerRefocusHandled: () => undefined,
      composerInput: new ObservableCell({
        scope: "u:0",
        draft: "",
        attachments: [],
      }),
      setDraft: () => undefined,
      setAttachments: () => undefined,
      noteComposerFocus: () => undefined,
      takeComposerCaretReturn: () => false,
    },
    conversation: null,
    threadOpening: false,
    showInterruptionBanner: false,
    sendError: null,
    turnFailure: null,
    setupError: null,
    reconnectNonce: 0,
    pendingDecisionGap: null,
    refreshConversation: () => Promise.resolve(),
    retryStream: () => undefined,
    startNewConversation: () => undefined,
    resumeStoredThread: () => undefined,
  } as unknown as AssistantConversation;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
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

function renderWelcome(
  suggestions: readonly { prompt: string; kind?: string }[],
  options?: {
    surface?: string;
    welcomeMark?: React.ReactNode;
    welcomeTitle?: string;
  },
): void {
  act(() => {
    root.render(
      <ConversationView
        core={emptyConversation()}
        surface={options?.surface ?? "page"}
        suggestions={
          suggestions as unknown as Parameters<
            typeof ConversationView
          >[0]["suggestions"]
        }
        welcomeTitle={options?.welcomeTitle}
        welcomeMark={options?.welcomeMark}
      />,
    );
  });
}

describe("the welcome's suggestion rows", () => {
  it("accepts host voice while keeping the empty composer compact", () => {
    renderWelcome([], {
      welcomeTitle: "Let’s brew",
      welcomeMark: <span data-testid="welcome-mark">✦</span>,
    });

    expect(container.textContent).toContain("Let’s brew");
    const mark = container.querySelector('[data-testid="welcome-mark"]');
    expect(mark).not.toBeNull();
    // The welcome mark is host-authored DOM: it must render inside the
    // host-view marker the sheet's reset excludes (round-7 ruling 2).
    expect(mark?.closest("[data-tf-host-view]")).not.toBeNull();
    expect(
      container
        .querySelector("[data-tf-composer-ground] > div")
        ?.classList.contains("tf:max-w-xl"),
    ).toBe(true);
  });

  it("renders a glyph for a kind the package does not know", () => {
    // A plain-JS host's typo. Before the fallback this threw
    // "Element type is invalid … got: undefined" and blanked the
    // surface (caught driving the script-tag fixture).
    renderWelcome([
      { prompt: "An unknown kind still renders", kind: "action" },
    ]);

    const row = container.querySelector("[data-tf-prompt-mark]");
    expect(row).not.toBeNull();
    expect(row?.querySelector("svg")).not.toBeNull();
    expect(container.textContent).toContain("An unknown kind still renders");
  });

  it("renders a glyph for a kind that names an Object.prototype member", () => {
    // Plain indexing would resolve "constructor" through the prototype
    // chain to Object itself — truthy, so the fallback never fires and
    // React gets handed a non-component. The guard must be an
    // own-property check, not a truthiness one.
    renderWelcome([
      { prompt: "Inherited member is not a glyph", kind: "constructor" },
      { prompt: "Neither is this one", kind: "toString" },
    ]);

    const marks = container.querySelectorAll("[data-tf-prompt-mark]");
    expect(marks).toHaveLength(2);
    for (const mark of marks) {
      expect(mark.querySelector("svg")).not.toBeNull();
    }
    expect(container.textContent).toContain("Inherited member is not a glyph");
  });

  it("still renders the known kinds' own glyphs", () => {
    renderWelcome([
      { prompt: "Ask something" },
      { prompt: "Review something", kind: "review" },
    ]);

    expect(container.querySelectorAll("[data-tf-prompt-mark]")).toHaveLength(2);
    expect(container.textContent).toContain("Review something");
  });
});

/** a precedes b in document order. */
function precedes(a: Element | null, b: Element | null): boolean {
  if (a === null || b === null) {
    throw new Error("Both elements must exist to compare their order.");
  }
  return Boolean(
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("the companion drawer's welcome", () => {
  it("stacks mark, greeting, and prompts above a bottom-anchored composer", () => {
    renderWelcome([{ prompt: "Ask something" }], {
      surface: "companion",
      welcomeMark: <span data-testid="mark" />,
    });

    const mark = container.querySelector('[data-testid="mark"]');
    const greeting = container.querySelector("h2");
    const prompt = container.querySelector("[data-tf-prompt-mark]");
    const composer = container.querySelector("textarea");

    expect(mark).not.toBeNull();
    // NOT inside a host-view marker: on the companion branch the
    // default mark is package DOM (companion-drawer-body's
    // CompanionMark renders the package flask; only a host's
    // companionMark node is marked, by the mark itself), so the sheet's
    // box/border reset must keep owning this subtree. Contrast with the
    // page welcome below, whose mark IS host-authored.
    expect(mark?.closest("[data-tf-host-view]")).toBeNull();
    expect(precedes(mark, greeting)).toBe(true);
    expect(precedes(greeting, prompt)).toBe(true);
    expect(precedes(prompt, composer)).toBe(true);
  });

  it("places a host-supplied page mark beside its greeting", () => {
    renderWelcome([], {
      surface: "page",
      welcomeMark: <span data-testid="mark" />,
    });

    const mark = container.querySelector('[data-testid="mark"]');
    const greeting = container.querySelector("h2");
    expect(mark).not.toBeNull();
    // The mark rides inside the host-view marker (round-7 ruling 2) — a
    // display:contents wrapper, so the LAYOUT relationship is unchanged:
    // the wrapper shares the greeting's parent and generates no box.
    const wrapper = mark?.closest("[data-tf-host-view]");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.parentElement).toBe(greeting?.parentElement);
    expect(wrapper?.className).toContain("tf:contents");
    expect(precedes(mark, greeting)).toBe(true);
  });
});
