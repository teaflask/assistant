"use client";

import { useEffect } from "react";

import { ConversationView, SetupErrorState } from "./conversation-view.js";
import { CloseIcon } from "./icons.js";
import { TfButton } from "./primitives/button.js";
import { useAssistantConversation } from "./use-assistant-conversation.js";

// The palette's conversation half — the module that reaches the
// transcript, loaded only through the palette's dynamic import (the
// drawer-body precedent): a page whose palette is never opened never
// downloads the chat. Mounted only while open: closing unmounts the
// transcript (and with it the stream connection) — reopening replays.
// Keeping it mounted would hold an invisible live SSE per closed
// palette. Default export because React.lazy wants one.

export default function AssistantPaletteBody({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}) {
  const core = useAssistantConversation();

  // Re-adopt the stored thread on every open (the body mounts per
  // open): another surface (the page, another tab) may have moved the
  // conversation while this one was closed, and opening the palette
  // must mean "continue where I am".
  const resumeStoredThread = core.resumeStoredThread;
  useEffect(() => {
    resumeStoredThread();
  }, [resumeStoredThread]);

  return (
    <>
      {/* The header renders in the setup-error state too: Esc and the
          backdrop are no close affordance for touch on the near-full-
          screen mobile layout. Only "New conversation" hides — there is
          no session for it to act on. */}
      <div className="tf:flex tf:h-12 tf:shrink-0 tf:items-center tf:gap-1 tf:border-b tf:pr-2 tf:pl-4">
        <h2 className="tf:flex-1 tf:text-tf-heading tf:font-medium">
          Assistant
        </h2>
        {core.setupError === null ? (
          <TfButton
            variant="ghost"
            onClick={(event) => {
              core.startNewConversation();
              // A keyboard-first surface: the fresh conversation starts
              // with the caret in the composer, not on this button.
              const dialog = event.currentTarget.closest("dialog");
              requestAnimationFrame(() => {
                dialog
                  ?.querySelector<HTMLElement>("[data-tf-autofocus]")
                  ?.focus();
              });
            }}
          >
            New conversation
          </TfButton>
        ) : null}
        <TfButton
          variant="icon"
          aria-label="Close"
          onClick={() => {
            onOpenChange(false);
          }}
        >
          <CloseIcon />
        </TfButton>
      </div>
      {core.setupError !== null ? (
        <div className="tf:flex tf:flex-1 tf:items-center tf:justify-center tf:p-6">
          <SetupErrorState
            message={core.setupError.message}
            code={core.setupError.code}
          />
        </div>
      ) : (
        <ConversationView core={core} surface="palette" />
      )}
    </>
  );
}
