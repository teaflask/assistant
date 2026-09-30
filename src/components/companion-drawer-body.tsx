"use client";

import { useEffect } from "react";

import { useAssistantAppearance } from "./appearance-context.js";
import { CompanionMark } from "./companion-mark.js";
import { ConversationView, SetupErrorState } from "./conversation-view.js";
import { servedSuggestionsForPath } from "./served-suggestions.js";
import { useAssistantSession } from "./teaflask-assistant-provider.js";
import { useAssistantConversation } from "./use-assistant-conversation.js";
import { useCell } from "./use-store-cell.js";

// The drawer's conversation half — the one companion module that
// reaches the transcript (and through it the chat chassis). Loaded ONLY
// through the drawer's dynamic import: the minimized companion's static
// graph must stay transcript-free (the bundle-closure test enforces it),
// so a page that only ever shows the mark never downloads the chat.
// Default export because React.lazy wants one.

export default function CompanionDrawerBody() {
  const core = useAssistantConversation();
  // The drawer's opening prompts: the host's provider prop when one was
  // passed (explicit JS intent wins wholesale, even an empty array), the
  // sets authored on the org's assistant otherwise — the drawer is the
  // surface a visitor meets first, so it is where the welcome earns its
  // prompts; the page keeps taking them as its own prop.
  const { suggestions } = useAssistantAppearance();
  const { assistantConfig, ensureAssistantConfig } = useAssistantSession();
  const served = useCell(assistantConfig);

  // Re-adopt the stored thread on every open (the body mounts per open,
  // palette parity): another surface may have moved the conversation
  // while the drawer was closed, and expanding must mean "continue
  // where I am".
  const resumeStoredThread = core.resumeStoredThread;
  useEffect(() => {
    resumeStoredThread();
  }, [resumeStoredThread]);

  // Only a drawer the host left promptless ever fetches: a passed prop
  // means the served config could never render, so no one pays for it.
  useEffect(() => {
    if (suggestions === null) {
      ensureAssistantConfig();
    }
  }, [suggestions, ensureAssistantConfig]);

  // The pathname is read per render, not subscribed: the empty state
  // re-renders on every open, which is exactly when the answer matters.
  const effectiveSuggestions =
    suggestions ??
    (served === null
      ? undefined
      : servedSuggestionsForPath(served, window.location.pathname));

  if (core.setupError !== null) {
    return (
      <div className="tf:flex tf:flex-1 tf:items-center tf:justify-center tf:p-6">
        <SetupErrorState
          message={core.setupError.message}
          code={core.setupError.code}
        />
      </div>
    );
  }
  return (
    <ConversationView
      core={core}
      surface="companion"
      suggestions={effectiveSuggestions}
      // The mark is decorative — the greeting under it is the content.
      // The span is the stylesheet's sizing hook: static, deliberately
      // unpositioned, so nothing ever paints over the header's menu.
      welcomeMark={
        <span aria-hidden data-tf-companion-welcome-mark="">
          <CompanionMark />
        </span>
      }
    />
  );
}
