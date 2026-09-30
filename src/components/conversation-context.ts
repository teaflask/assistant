"use client";

import { createContext, useContext } from "react";

import type { ComposerContract } from "../core/conversation-store.js";

// The composer's contract with the page: it renders both standalone (the
// empty state) and inside the transcript, so its wiring travels by
// context instead of slot props. The contract itself is the store's
// composer snapshot (built in core/conversation-publish.ts). Provided by
// <TeaflaskAssistantProvider> (via the conversation surfaces provider),
// so headless hosts read it with no package chrome mounted.

export type { ComposerContract };

export const ConversationContext = createContext<ComposerContract | null>(null);

export function useConversation(): ComposerContract {
  const value = useContext(ConversationContext);
  if (value === null) {
    throw new Error(
      "useConversation must be called under <TeaflaskAssistantProvider> (any entry, including @teaflask/assistant/headless).",
    );
  }
  return value;
}
