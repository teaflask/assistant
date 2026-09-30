"use client";

import { type RefObject } from "react";

import {
  HeaderDisclosureMenu,
  HeaderDisclosureTrigger,
} from "./companion-header-disclosure.js";
import { ChevronDownIcon } from "./icons.js";
import { ThreadHistory } from "./thread-list.js";
import { useAssistantConversation } from "./use-assistant-conversation.js";

// The drawer header's title-as-disclosure (the Notion register): the
// active conversation's title with a chevron, and pressing it drops open
// a small popover of past conversations over the transcript — the same
// ThreadHistory the page's rail and phone sheet render. One list, three
// densities, never a fork.

/** The title half of the header row. For anonymous visitors the server's
 *  thread list is honestly empty, so there is no history to disclose —
 *  the title stays a static heading with no chevron and no menu (the
 *  page gates its rail the same way). */
export function CompanionHeaderTitle({
  menuId,
  open,
  onOpenChange,
  triggerRef,
  fallbackTitle = "Assistant",
}: {
  menuId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  fallbackTitle?: string;
}) {
  const core = useAssistantConversation();
  // `||`, not `??`: a just-created thread can hold an empty title until
  // the server names it, and while a thread is opening the title lags
  // one beat behind — "Assistant" covers both gaps. The muted label step
  // keeps the empty state's centered question the surface's only
  // headline; weight stated explicitly because the package ships no
  // preflight, so an unweighted h2 inherits the UA's bold in one host
  // and the host's own reset in another.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- the empty-string fallback is the point, per above.
  const title = core.conversation?.thread.title || fallbackTitle;
  if (!core.historyExpected) {
    return (
      <h2 className="tf:min-w-0 tf:flex-1 tf:truncate tf:text-tf-label tf:font-medium tf:text-tf-muted-foreground">
        {title}
      </h2>
    );
  }
  return (
    <h2 className="tf:flex tf:min-w-0 tf:flex-1 tf:items-center tf:text-tf-label tf:font-medium tf:text-tf-muted-foreground">
      {/* A button inside the heading, not a heading inside a button: the
          h2 keeps the document outline and its muted ink (`bare` is
          text-inherit), and the button's accessible name is the visible
          title itself — an aria-label like "Conversation history" would
          hide the name on the screen from the name in the tree. The
          disclosure semantics ride aria-expanded + aria-controls to a
          dialog that carries the "Conversation history" label. The
          negative margin gives the hover wash its own inset while the
          title text holds the header's 16px line. */}
      <HeaderDisclosureTrigger
        menuId={menuId}
        open={open}
        onOpenChange={onOpenChange}
        triggerRef={triggerRef}
        variant="bare"
        className="tf:-ml-1.5 tf:min-w-0 tf:px-1.5 tf:py-1 tf:hover:bg-tf-accent tf:hover:text-tf-foreground"
      >
        <span className="tf:min-w-0 tf:truncate">{title}</span>
        <ChevronDownIcon />
      </HeaderDisclosureTrigger>
    </h2>
  );
}

/** The dropped-open history panel: the shared disclosure menu hung
 *  left-anchored under the title that discloses it, wrapping the shared
 *  thread list. Its first row is "New conversation" — a deliberate twin
 *  of the header's compose button, shared with the page rail and the
 *  phone sheet. */
export function CompanionHistoryMenu({
  id,
  onClose,
  triggerRef,
  triggerId,
  insetFromSurfaceTop,
}: {
  id: string;
  onClose: () => void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  triggerId?: string;
  insetFromSurfaceTop?: boolean;
}) {
  const core = useAssistantConversation();
  return (
    <HeaderDisclosureMenu
      id={id}
      aria-label="Conversation history"
      onClose={onClose}
      triggerRef={triggerRef}
      triggerId={triggerId}
      insetFromSurfaceTop={insetFromSurfaceTop}
      // left-2.5 + the panel hairline puts the menu's edge on the
      // trigger pill's own left edge; w-80 keeps the menu at least as
      // wide as the widest title the trigger can show, so a thread name
      // legible in the header never truncates in the list beneath it
      // (and still clears the 358px phone card with room to spare).
      className="tf:left-2.5 tf:w-80 tf:max-w-[calc(100%-1.25rem)] tf:pt-2"
    >
      <ThreadHistory
        threads={core.threads}
        activeThreadId={core.conversation?.thread.id ?? null}
        safeAreaBottom={false}
        onSelectThread={(thread) => {
          onClose();
          core.openThread(thread);
        }}
        onNewConversation={() => {
          onClose();
          core.startNewConversation();
        }}
      />
    </HeaderDisclosureMenu>
  );
}
