"use client";

// The adopted register — bake-off 2026-07-30 (assistant-ui thread.tsx's user message): a muted
// rounded-xl bubble right-anchored behind a wide reserved gutter, so
// long messages never crowd the left edge. assistant-ui's markup with
// the action bar and branch picker removed (the widget has neither).
// Attachments stack above the bubble, right-anchored with it; an
// attachment-only message is just the stack, no empty bubble.
//
// Beneath the bubble, one reserved meta row: the turn's timestamp and
// the package's one copy affordance are both hover/focus-revealed (the
// roster chevron's reveal idiom; always visible on coarse pointers).
// The row's height is reserved whether or not the button shows, so the
// reveal never shifts the message. An attachment-only message renders
// no meta row: there is no text to copy, and its turn's stamp has no
// bubble to belong to.

import { conversationalTimeOf } from "../core/time-labels.js";
import type { TurnAttachment } from "../contract/threads.js";
import { AttachmentChips } from "./attachment-chips.js";
import { CopyTextButton } from "./copy-text-button.js";

export function UserMessage({
  children,
  attachments = [],
  createdAt,
}: {
  children: string;
  attachments?: readonly TurnAttachment[];
  /** The turn's server created_at (ISO-8601) — the bubble's one honest
   *  clock: the wire carries no per-message timestamp, and a client clock
   *  would lie on every replay. Absent (the optimistic echo, meta-less
   *  hosts) renders no stamp — never a wrong one. */
  createdAt?: string;
}) {
  const time = createdAt !== undefined ? conversationalTimeOf(createdAt) : null;
  return (
    <div
      className="tf:group/user-message tf:flex tf:flex-col tf:items-end tf:gap-2 tf:ps-20"
      data-role="user"
    >
      <AttachmentChips attachments={attachments} />
      {children !== "" ? (
        <>
          <div className="tf:min-w-0 tf:rounded-xl tf:bg-tf-muted tf:px-4 tf:py-2 tf:text-tf-body tf:break-words tf:whitespace-pre-wrap tf:text-tf-foreground">
            {children}
          </div>
          <div className="tf:flex tf:h-7 tf:items-center tf:justify-end tf:gap-1">
            {time !== null ? (
              <time
                dateTime={createdAt}
                title={time.full}
                className="tf:text-xs tf:text-tf-muted-foreground tf:opacity-0 tf:transition-opacity tf:group-hover/user-message:opacity-100 tf:group-focus-within/user-message:opacity-100 tf:pointer-coarse:opacity-100"
              >
                {time.label}
              </time>
            ) : null}
            <CopyTextButton
              text={children}
              label="Copy message"
              className="tf:opacity-0 tf:transition-opacity tf:group-hover/user-message:opacity-100 tf:group-focus-within/user-message:opacity-100 tf:focus-visible:opacity-100 tf:pointer-coarse:opacity-100"
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
