// The composer's input plane: the model pick, the unsaved draft and its
// staged attachments, the focus/caret bookkeeping, and the reset that
// re-scopes them — the store-side half of the composer's contract.

import type {
  AttachmentDraft,
  ComposerModelPick,
} from "./conversation-contract.js";
import { publishStore } from "./conversation-publish.js";
import type { AssistantConversationStore } from "./conversation-store.js";

export function setModelPickFromStore(
  store: AssistantConversationStore,
  pick: ComposerModelPick,
): void {
  store._modelPick = pick;
  store._modelPickDirty = true;
  publishStore(store);
}

// Value-or-updater on purpose (the useState contract): the upload
// continuations and the send-refusal restore are read-modify-write over
// truth that may have moved, and as the STORE's stable arrows they stay
// correct across any composer remount. They write the input cell directly,
// never publishStore: a keystroke moves no conversation-plane state. Only
// adoption, abandon and a landed send move the scope; it rides through here.
export function setComposerDraftFromStore(
  store: AssistantConversationStore,
  next: string | ((current: string) => string),
): void {
  const current = store._composerInput.get();
  store._composerInput.set({
    ...current,
    draft: typeof next === "function" ? next(current.draft) : next,
  });
}

export function setComposerAttachmentsFromStore(
  store: AssistantConversationStore,
  next:
    | readonly AttachmentDraft[]
    | ((current: readonly AttachmentDraft[]) => readonly AttachmentDraft[]),
): void {
  const current = store._composerInput.get();
  store._composerInput.set({
    ...current,
    attachments: typeof next === "function" ? next(current.attachments) : next,
  });
}

// Clearing is (re)scoping: every reset names the conversation-context the
// fresh, empty input belongs to — the identity the send-refusal guard
// compares against. Both arms set UNCONDITIONALLY: a conversation-less
// reset MINTS a fresh token even over an empty input (a null hole here let
// an abandon no-op and leave the old scope alive for the refusal restore).
// A caret owed to the departed conversation dies with it; the DOM-plane
// focus record is NOT touched — it tracks the element, not the conversation.
export function resetComposerInput(
  store: AssistantConversationStore,
  threadId: string | null,
): void {
  store._composerCaretReturnPending = null;
  store._composerInput.set({
    scope:
      threadId !== null
        ? `t:${threadId}`
        : `u:${String(store._nextUnboundScope++)}`,
    draft: "",
    attachments: [],
  });
}

export function noteComposerFocusFromStore(
  store: AssistantConversationStore,
  owner: string | null,
): void {
  store._composerFocusOwned = owner;
}

// Take-semantics scoped to the OWNER: every keyed transcript remounts on
// one nonce bump and every fresh composer takes at mount, in tree order —
// an unscoped take let a bystander surface consume the one-shot without
// using it. Only the owner's take consumes; the owner then delivers or
// forfeits its return in the same breath, which is the right lifetime.
export function takeComposerCaretReturnFromStore(
  store: AssistantConversationStore,
  surface: string,
): boolean {
  if (store._composerCaretReturnPending !== surface) {
    return false;
  }
  store._composerCaretReturnPending = null;
  return true;
}
