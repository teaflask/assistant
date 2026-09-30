// A child's opening brief: the parent's dispatch_subagent task, joined to
// the child by its receipt, leads the child's transcript as a user row.
import type { Message } from "@ag-ui/core";
import { describe, expect, it } from "vitest";

import { openingBriefOf, withOpeningBrief } from "../src/core/subagent-brief";

function _dispatchCall(
  toolCallId: string,
  task: string,
  childSessionId: string | null,
): Message[] {
  const call: Message = {
    id: `assistant-${toolCallId}`,
    role: "assistant",
    toolCalls: [
      {
        id: toolCallId,
        type: "function",
        function: {
          name: "dispatch_subagent",
          arguments: JSON.stringify({ task }),
        },
      },
    ],
  };
  if (childSessionId === null) {
    return [call];
  }
  const receipt: Message = {
    id: `tool-${toolCallId}`,
    role: "tool",
    toolCallId,
    content: JSON.stringify({
      outcome: "launched",
      ordinal: 0,
      label: task.slice(0, 200),
      child_session_id: childSessionId,
    }),
  };
  return [call, receipt];
}

describe("openingBriefOf", () => {
  it("returns the full task of the call whose receipt names the child", () => {
    const longTask = `List every documentation page.\n\n${"detail ".repeat(60)}`;
    const parent = [
      { id: "u1", role: "user", content: "Audit the docs." } as Message,
      ..._dispatchCall("call-a", "The other child's task.", "child-a"),
      ..._dispatchCall("call-b", longTask, "child-b"),
    ];

    expect(openingBriefOf(parent, "child-b")).toBe(longTask);
    expect(openingBriefOf(parent, "child-a")).toBe("The other child's task.");
  });

  it("answers null while the receipt has not landed", () => {
    expect(
      openingBriefOf(_dispatchCall("call-a", "Task.", null), "child-a"),
    ).toBeNull();
  });

  it("answers null when the result is not a receipt", () => {
    const [call] = _dispatchCall("call-a", "Task.", null);
    const failure: Message = {
      id: "tool-call-a",
      role: "tool",
      toolCallId: "call-a",
      content: "The dispatcher failed.",
    };
    expect(openingBriefOf([call, failure], "child-a")).toBeNull();
  });

  it("answers null for a whitespace-only task", () => {
    expect(
      openingBriefOf(_dispatchCall("call-a", "  \n ", "child-a"), "child-a"),
    ).toBeNull();
  });
});

describe("withOpeningBrief", () => {
  const reply: Message = { id: "m1", role: "assistant", content: "Done." };

  it("leads the child's messages with the brief as a user message", () => {
    expect(withOpeningBrief([reply], "Do the thing.", "child-a")).toEqual([
      { id: "brief:child-a", role: "user", content: "Do the thing." },
      reply,
    ]);
  });

  it("leaves the messages untouched without a brief", () => {
    const messages = [reply];
    expect(withOpeningBrief(messages, null, "child-a")).toBe(messages);
  });
});
