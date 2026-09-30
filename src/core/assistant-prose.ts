// The one "assistant prose" predicate.
//
// REQUIRED INVARIANT, not incidental sharing: memory attribution
// (core/memory-provenance-anchors.ts) selects the message id a footer
// anchors to with this predicate, and the projection
// (core/transcript-rows.ts) emits the assistant-text row — the footer's
// ONLY host — under the same predicate. If the two ever disagree (one
// side trims whitespace, or starts handling array content), an
// attributed id can fail to project and footers silently stop
// rendering, with no test naming the cause. Any change to what counts
// as prose must happen HERE, once, for both consumers.

import type { Message } from "@ag-ui/core";

/** The newest assistant message with visible prose — the only row kind
 *  a memory footer may render under (tool results, tool-call-only
 *  messages, and reasoning never host one). */
export function newestAssistantProseIdOf(
  messages: readonly Message[],
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.role === "assistant" &&
      typeof message.content === "string" &&
      message.content !== ""
    ) {
      return message.id;
    }
  }
  return null;
}
