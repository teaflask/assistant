// @vitest-environment jsdom
/**
 * The conversation no longer exposes the legacy full-surface subagent
 * drill-in (the inert conversation cover). Child transcripts open as the
 * shared floating preview — from the count pill's roster, and from the
 * delegation rows through Transcript's OWN delegation surface. This pins
 * that the HOST layer provides no seam of its own: the panel-era cover
 * never returns, and a mocked-out Transcript sees the null default.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationView } from "../src/components/conversation-view";
import { useSubagentDrillIn } from "../src/components/subagent-drill-in";
import type { AssistantConversation } from "../src/components/use-assistant-conversation";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../src/components/transcript", () => ({
  Transcript: () => {
    const drillIn = useSubagentDrillIn();
    return (
      <div data-testid="drill-in-standing">
        {drillIn === null ? "null" : "present"}
      </div>
    );
  },
}));

function _core(): AssistantConversation {
  return {
    conversation: { thread: { id: "thread-1" } },
    threadOpening: false,
    showInterruptionBanner: false,
    sendError: null,
    turnFailure: null,
    reconnectNonce: 0,
    pendingDecisionGap: null,
    refreshConversation: () => Promise.resolve(),
    retryStream: () => undefined,
    composerContract: {},
  } as unknown as AssistantConversation;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
});

describe("the retired full-surface subagent drill-in", () => {
  it("leaves the conversation live and provides no drill-in seam", () => {
    act(() => {
      root.render(<ConversationView core={_core()} surface="page" />);
    });

    expect(host.querySelector("[data-tf-child-transcript]")).toBeNull();
    expect(host.querySelector("[inert]")).toBeNull();
    expect(
      host.querySelector("[data-testid=drill-in-standing]")?.textContent,
    ).toBe("null");
  });
});
