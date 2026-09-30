// @vitest-environment jsdom
/**
 * The composer's no-silent-drop rule, at the picker: a file selection
 * past the per-message cap must land as a visible failed chip, never a
 * bare truncation — the visitor must not believe twelve files ride when
 * ten do. Files inside the cap upload exactly as before.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Composer } from "../src/components/composer";
import { ObservableCell } from "../src/core/observable-cell";
import type { ServedAttachmentPolicy } from "../src/contract/assistant-config";
import type { ServingAttachment } from "../src/contract/threads";
import type {
  ComposerContract,
  ComposerInput,
} from "../src/core/conversation-store";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const uploadAttachment = vi.fn<(file: File) => Promise<ServingAttachment>>();

const policy: ServedAttachmentPolicy = {
  kinds: ["image"],
  max_bytes_by_kind: { image: 1_000 },
  max_per_message: 2,
};

// Render-stable identities: the composer's effects key on the session.
const fakeSession = {
  store: { uploadAttachment },
  attachmentPolicy: new ObservableCell<ServedAttachmentPolicy | null>(policy),
  ensureAssistantConfig: () => {
    // The policy is already seeded — nothing to fetch.
  },
  // The shelf's inputs: an anonymous tier and no served menu keep both
  // chips out of this suite's frame (attachments are its subject).
  tier: null,
  subscriptions: new ObservableCell(null),
  ensureSubscriptions: () => {
    // Anonymous — never kicked.
  },
  modelChoice: new ObservableCell(null),
  // Unanswered keeps the whole shelf out of this suite's frame (the
  // slot's identity is unknown until the config read settles).
  configAnswered: new ObservableCell(false),
  // The shelf owns the chips' open state and the parked connect
  // ask, so it reads the ask cell even while nothing renders.
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

// The store's part, played by the fixture: a live input cell plus
// setters that write it — the shipped shape — so the controlled
// textarea and the upload continuations travel the real useCell
// subscription.
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
  stopTurn: () => Promise.resolve(),
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
  uploadAttachment.mockReset();
  sendMessage.mockReset();
  conversation.pendingEcho = null;
  composerInput.set({ scope: "u:0", draft: "", attachments: [] });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

describe("the optimistic user message", () => {
  it("does not render the submitted message inside the composer", async () => {
    conversation.pendingEcho = {
      messageId: "user-turn-1",
      text: "A message could stay here while it's sending",
      attachments: [],
    };
    await act(async () => {
      root.render(<Composer />);
      await Promise.resolve();
    });

    const slab = host.querySelector<HTMLElement>("[data-tf-composer-wash]");
    expect(host.querySelector("[data-tf-pending-echo]")).toBeNull();
    expect(slab).not.toBeNull();
  });

  it("clears the draft immediately and restores it when the send is refused", async () => {
    let settleSend: (landed: boolean) => void = () => {
      throw new Error("send did not start");
    };
    sendMessage.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          settleSend = resolve;
        }),
    );
    await act(async () => {
      root.render(<Composer />);
      await Promise.resolve();
    });
    const textarea = host.querySelector<HTMLTextAreaElement>("textarea");
    act(() => {
      if (textarea !== null) {
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set?.call(textarea, "Thank you");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    const send = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Send message"]',
    );
    await act(async () => {
      send?.click();
      await Promise.resolve();
    });
    expect(textarea?.value).toBe("");
    expect(sendMessage).toHaveBeenCalledWith("Thank you", [], []);

    await act(async () => {
      settleSend(false);
      await Promise.resolve();
    });
    expect(textarea?.value).toBe("Thank you");
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
});

function settledAttachmentFor(file: File): ServingAttachment {
  return {
    id: `att-${file.name}`,
    kind: "image",
    format: "image/png",
    filename: file.name,
    byte_size: file.size,
    ready: true,
  };
}

async function pickFiles(files: File[]): Promise<void> {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) {
    throw new Error("The composer rendered no file input.");
  }
  Object.defineProperty(input, "files", {
    value: files,
    configurable: true,
  });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

describe("the composer's per-message attachment cap", () => {
  it("lands over-cap picks as failed chips instead of dropping them", async () => {
    uploadAttachment.mockImplementation((file) =>
      Promise.resolve(settledAttachmentFor(file)),
    );
    await act(async () => {
      root.render(<Composer />);
      await Promise.resolve();
    });
    await pickFiles([
      new File(["a"], "one.png", { type: "image/png" }),
      new File(["b"], "two.png", { type: "image/png" }),
      new File(["c"], "three.png", { type: "image/png" }),
    ]);

    expect(uploadAttachment).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("one.png");
    expect(host.textContent).toContain("two.png");
    expect(host.textContent).toContain("three.png");
    expect(host.textContent).toContain(
      "Too many files — the limit is 2 per message.",
    );
    // The failed chip blocks the send until acknowledged, like any
    // other refused file.
    const send = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Send message"]',
    );
    expect(send?.disabled).toBe(true);
  });

  it("does not spend a cap slot on a too-large reject", async () => {
    uploadAttachment.mockImplementation((file) =>
      Promise.resolve(settledAttachmentFor(file)),
    );
    await act(async () => {
      root.render(<Composer />);
      await Promise.resolve();
    });
    await pickFiles([
      new File(["a".repeat(2_000)], "huge.png", { type: "image/png" }),
      new File(["b"], "one.png", { type: "image/png" }),
      new File(["c"], "two.png", { type: "image/png" }),
    ]);

    // The reject never rode toward the cap: both valid files fit.
    expect(uploadAttachment).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain(
      "Too large — the limit for an image is 1000 B.",
    );
    expect(host.textContent).not.toContain("Too many files");
  });

  it("leftover failed chips spend no cap slots on later picks", async () => {
    uploadAttachment.mockImplementation((file) =>
      Promise.resolve(settledAttachmentFor(file)),
    );
    await act(async () => {
      root.render(<Composer />);
      await Promise.resolve();
    });
    // Two too-large rejects fill the list to the cap of 2 — as failed
    // chips, which never ride the message.
    await pickFiles([
      new File(["a".repeat(2_000)], "huge-one.png", { type: "image/png" }),
      new File(["b".repeat(2_000)], "huge-two.png", { type: "image/png" }),
    ]);
    expect(uploadAttachment).not.toHaveBeenCalled();

    // The paperclip gate shares the accounting: failed chips leave it open.
    const paperclip = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Attach a file"]',
    );
    expect(paperclip?.disabled).toBe(false);

    // And a follow-up pick still has the whole room.
    await pickFiles([
      new File(["c"], "one.png", { type: "image/png" }),
      new File(["d"], "two.png", { type: "image/png" }),
    ]);
    expect(uploadAttachment).toHaveBeenCalledTimes(2);
    expect(host.textContent).not.toContain("Too many files");
  });

  it("disables the paperclip while a send is in flight", async () => {
    uploadAttachment.mockImplementation((file) =>
      Promise.resolve(settledAttachmentFor(file)),
    );
    let landSend: (landed: boolean) => void = () => {
      throw new Error("The send was never started.");
    };
    sendMessage.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          landSend = resolve;
        }),
    );
    await act(async () => {
      root.render(<Composer />);
      await Promise.resolve();
    });
    await pickFiles([new File(["a"], "one.png", { type: "image/png" })]);
    const paperclip = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Attach a file"]',
    );
    expect(paperclip?.disabled).toBe(false);

    // A landed send remounts the composer with an empty list, so a file
    // picked mid-flight would vanish — the picker must close the window.
    const send = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Send message"]',
    );
    await act(async () => {
      send?.click();
      await Promise.resolve();
    });
    expect(paperclip?.disabled).toBe(true);

    await act(async () => {
      landSend(true);
      await Promise.resolve();
    });
    expect(paperclip?.disabled).toBe(false);
  });
});
