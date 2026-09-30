// @vitest-environment jsdom
/**
 * The stop square: while the assistant answers, the send arrow becomes a
 * stop button — click or Escape ends the turn, the draft stays put, and
 * "Stopping…" narrates the POST window. Escape while idle stays inert so
 * the palette's own Esc-to-close keeps working.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Composer } from "../src/components/composer";
import { ObservableCell } from "../src/core/observable-cell";
import type { ServedAttachmentPolicy } from "../src/contract/assistant-config";
import type {
  ComposerContract,
  ComposerInput,
} from "../src/core/conversation-store";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Render-stable identities: the composer's effects key on the session.
const fakeSession = {
  store: { uploadAttachment: vi.fn() },
  attachmentPolicy: new ObservableCell<ServedAttachmentPolicy | null>(null),
  ensureAssistantConfig: () => {
    // No policy in this suite — attachments are not its subject.
  },
  tier: null,
  subscriptions: new ObservableCell(null),
  ensureSubscriptions: () => {
    // Anonymous — never kicked.
  },
  modelChoice: new ObservableCell(null),
  configAnswered: new ObservableCell(false),
  connectOpenRequested: new ObservableCell(false),
  acknowledgeSubscriptionConnect: () => {
    // Never rung in this suite.
  },
};

vi.mock("../src/components/teaflask-assistant-provider", () => ({
  useAssistantSession: () => fakeSession,
  useOptionalAssistantSession: () => fakeSession,
}));

const sendMessage = vi.fn<ComposerContract["sendMessage"]>();
const stopTurn = vi.fn<ComposerContract["stopTurn"]>();

// The store's part, played by the fixture: a live input cell plus
// setters that write it — the shipped shape — so the controlled textarea
// round-trips keystrokes through the real useCell subscription.
const composerInput = new ObservableCell<ComposerInput>({
  scope: "u:0",
  draft: "",
  attachments: [],
});

const conversation: ComposerContract = {
  busy: false,
  pendingSend: false,
  sendMessage,
  pendingEcho: null,
  composerRefocusPending: false,
  markComposerRefocusHandled: () => {
    // No remount in this suite.
  },
  stopping: false,
  stopTurn,
  modelPick: null,
  setModelPick: () => {
    // No picker in this suite (no served menu).
  },
  composerInput,
  setDraft: (next) => {
    const current = composerInput.get();
    composerInput.set({
      ...current,
      draft: typeof next === "function" ? next(current.draft) : next,
    });
  },
  setAttachments: (next) => {
    const current = composerInput.get();
    composerInput.set({
      ...current,
      attachments:
        typeof next === "function" ? next(current.attachments) : next,
    });
  },
  noteComposerFocus: () => undefined,
  takeComposerCaretReturn: () => false,
};

vi.mock("../src/components/conversation-context", () => ({
  useConversation: () => conversation,
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  sendMessage.mockReset();
  stopTurn.mockReset();
  stopTurn.mockResolvedValue(undefined);
  conversation.busy = false;
  conversation.pendingSend = false;
  conversation.stopping = false;
  composerInput.set({ scope: "u:0", draft: "", attachments: [] });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
    await Promise.resolve();
  });
  host.remove();
});

async function mountComposer() {
  await act(async () => {
    root.render(<Composer />);
    await Promise.resolve();
  });
}

function stopButton(): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>(
    'button[aria-label="Stop generating"]',
  );
}

function typeDraft(text: string) {
  const textarea = host.querySelector<HTMLTextAreaElement>("textarea");
  act(() => {
    if (textarea !== null) {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, text);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}

function pressEscapeInTextarea() {
  const textarea = host.querySelector<HTMLTextAreaElement>("textarea");
  act(() => {
    textarea?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

describe("the stop square", () => {
  it("replaces the send arrow while the assistant answers", async () => {
    conversation.busy = true;
    await mountComposer();

    expect(stopButton()).not.toBeNull();
    expect(host.querySelector('button[aria-label="Send message"]')).toBeNull();
  });

  it("keeps the send arrow while idle", async () => {
    await mountComposer();

    expect(stopButton()).toBeNull();
    expect(
      host.querySelector('button[aria-label="Send message"]'),
    ).not.toBeNull();
  });

  it("fires stopTurn on click", async () => {
    conversation.busy = true;
    await mountComposer();

    await act(async () => {
      stopButton()?.click();
      await Promise.resolve();
    });

    expect(stopTurn).toHaveBeenCalledTimes(1);
  });

  it("narrates the POST window without destroying the focus home", async () => {
    conversation.busy = true;
    conversation.stopping = true;
    await mountComposer();

    expect(host.textContent).toContain("Stopping…");
    // aria-disabled, never disabled: a natively disabled control drops
    // keyboard focus to <body> for the whole beat. The double-POST guard
    // is the store's re-entry check, not this attribute.
    expect(stopButton()?.disabled).toBe(false);
    expect(stopButton()?.getAttribute("aria-disabled")).toBe("true");
  });

  it("returns the caret to the textarea on click — the draft is the focus home", async () => {
    conversation.busy = true;
    await mountComposer();

    const stop = stopButton();
    act(() => {
      stop?.focus();
      stop?.click();
    });

    expect(stopTurn).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(host.querySelector("textarea"));
  });

  it("keeps the send arrow through a send it did not start", async () => {
    // The suggestion rows send through the same store method without this
    // composer knowing: the store's pendingSend — not local sending state
    // — is what hides the stop square (no turn exists to stop yet).
    conversation.busy = true;
    conversation.pendingSend = true;
    await mountComposer();

    expect(stopButton()).toBeNull();
    expect(
      host.querySelector('button[aria-label="Send message"]'),
    ).not.toBeNull();
  });
});

describe("Escape as the stop shortcut", () => {
  it("stops the turn and keeps the draft while busy", async () => {
    conversation.busy = true;
    await mountComposer();
    typeDraft("a follow-up I am still writing");

    pressEscapeInTextarea();

    expect(stopTurn).toHaveBeenCalledTimes(1);
    expect(host.querySelector("textarea")?.value).toBe(
      "a follow-up I am still writing",
    );
  });

  it("claims the keydown so the palette/drawer never see a busy Escape", async () => {
    conversation.busy = true;
    await mountComposer();
    const textarea = host.querySelector<HTMLTextAreaElement>("textarea");
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      textarea?.dispatchEvent(escape);
    });

    expect(escape.defaultPrevented).toBe(true);
  });

  it("stays inert while idle — the containers keep their Esc-to-close", async () => {
    await mountComposer();
    const textarea = host.querySelector<HTMLTextAreaElement>("textarea");
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      textarea?.dispatchEvent(escape);
    });

    expect(stopTurn).not.toHaveBeenCalled();
    expect(escape.defaultPrevented).toBe(false);
  });

  it("stays inert during the message POST — a swallowed no-op Escape would wedge the palette closed", async () => {
    conversation.busy = true;
    conversation.pendingSend = true;
    await mountComposer();
    const textarea = host.querySelector<HTMLTextAreaElement>("textarea");
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      textarea?.dispatchEvent(escape);
    });

    expect(stopTurn).not.toHaveBeenCalled();
    expect(escape.defaultPrevented).toBe(false);
  });

  it("stays unclaimed during the Stopping… beat — a second Escape dismisses the surface", async () => {
    // The store's re-entry guard makes stopTurn a no-op while a stop is
    // already in flight; claiming Escape there would swallow it without
    // acting, locking the palette/drawer closed for the whole window.
    conversation.busy = true;
    conversation.stopping = true;
    await mountComposer();
    const textarea = host.querySelector<HTMLTextAreaElement>("textarea");
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      textarea?.dispatchEvent(escape);
    });

    expect(stopTurn).not.toHaveBeenCalled();
    expect(escape.defaultPrevented).toBe(false);
  });
});
