// A child's opening brief as its transcript's first user row. The child's
// log carries only the assistant's side (the parent's user side comes
// from turn rows); the brief's full text lives on the parent's
// dispatch_subagent call, joined to the child by its receipt.

import type { Message } from "@ag-ui/core";

import {
  DISPATCH_SUBAGENT_TOOL_NAME,
  dispatchedTaskOf,
  dispatchReceiptOf,
} from "./subagent-rows.js";

/** The task the parent dispatched to this child, or null while the
 *  parent's call or its receipt has not landed. */
export function openingBriefOf(
  parentMessages: readonly Message[],
  childSessionId: string,
): string | null {
  const results = _toolResultsByCallIdOf(parentMessages);
  for (const message of parentMessages) {
    if (message.role !== "assistant") {
      continue;
    }
    for (const call of message.toolCalls ?? []) {
      if (_isDispatchOfChild(call, results.get(call.id), childSessionId)) {
        const task = dispatchedTaskOf(call.function.arguments);
        return task === null || task.trim() === "" ? null : task;
      }
    }
  }
  return null;
}

/** The child's messages led by its brief, when there is one. */
export function withOpeningBrief(
  childMessages: readonly Message[],
  brief: string | null,
  childSessionId: string,
): readonly Message[] {
  if (brief === null) {
    return childMessages;
  }
  return [
    { id: `brief:${childSessionId}`, role: "user", content: brief },
    ...childMessages,
  ];
}

function _toolResultsByCallIdOf(
  messages: readonly Message[],
): ReadonlyMap<string, string> {
  const results = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "tool" && typeof message.content === "string") {
      results.set(message.toolCallId, message.content);
    }
  }
  return results;
}

function _isDispatchOfChild(
  call: { function: { name: string } },
  result: string | undefined,
  childSessionId: string,
): boolean {
  return (
    call.function.name === DISPATCH_SUBAGENT_TOOL_NAME &&
    dispatchReceiptOf(result)?.childSessionId === childSessionId
  );
}
