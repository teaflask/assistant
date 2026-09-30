// @vitest-environment jsdom
/**
 * The headless acceptance law: a bring-your-own-frontend host mounts
 * <TeaflaskAssistantProvider> ALONE — no AssistantPage, no
 * AssistantPalette, no Transcript — and drives the conversation through
 * the ./headless entry's hooks. Everything the rendered harness consumes
 * comes from ../src/headless; the deeper imports below are test plumbing
 * (module mocks and their vi.mocked handles), never API the harness
 * touches.
 *
 * The failing property (verified as a negative control during
 * implementation): with the provider hoist reverted — the contexts
 * provided by conversation-view/transcript instead of the provider —
 * useConversation() throws its no-provider error and useApprovals()
 * degrades to the rejecting guard, so both assertions below go red.
 */
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetAssistant,
  ServingApiError,
  TeaflaskAssistantProvider,
  useApprovals,
  useAssistantConversation,
  useConversation,
  useElicitations,
  useTranscript,
  type ApprovalCardModel,
  type ApprovalSurface,
  type AssistantConversation,
  type ComposerContract,
  type ElicitationSurface,
  type QuestionSetCardModel,
  type TranscriptSurface,
} from "../src/headless";

// --- test plumbing (mocks only — the harness never imports these) ------

import { sendAssistantMessage } from "../src/transport/serving-api";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../src/transport/token-session", () => ({
  TokenSession: class {
    dispose(): void {
      // Nothing to release — the suite never opens anything.
    }
    authorizedFetch(): Promise<never> {
      // Pending forever, the conversation-store suite's idiom: the mint
      // parks instead of failing, so no spurious reportError muddies the
      // onError assertions below.
      return new Promise<never>(() => undefined);
    }
  },
}));

// The whole REST surface hangs by default (no real wire in this suite);
// only the send lands — as a refusal, so the loop under test is
// host → composer contract → transport seam → onError, with no stream
// machinery involved.
vi.mock("../src/transport/serving-api", () => {
  const pending = () => vi.fn(() => new Promise<never>(() => undefined));
  return {
    sendAssistantMessage: vi.fn(),
    stopAssistantTurn: pending(),
    listAssistantThreads: pending(),
    getAssistantThread: pending(),
    listThreadDispatches: pending(),
    getAssistantConfig: pending(),
    resolveTurnApproval: pending(),
    resolveTurnToolResults: pending(),
    createAttachmentUpload: pending(),
    finalizeAttachment: pending(),
    getAttachmentDownloadUrl: pending(),
    listSubscriptions: pending(),
    beginSubscriptionDeviceAuthorization: pending(),
    pollSubscriptionDeviceAuthorization: pending(),
    disconnectSubscription: pending(),
    putFileToUploadUrl: pending(),
    streamUrlForThread: vi.fn(
      () => "https://api.example.test/serving/v1/assistant-threads/x/stream",
    ),
    streamUrlForChild: vi.fn(
      () => "https://api.example.test/serving/v1/assistant-threads/x/child",
    ),
  };
});

// --- the host's own frontend: hooks in, plain DOM out -------------------

const seen: {
  conversation: AssistantConversation | null;
  composer: ComposerContract | null;
  approvals: ApprovalSurface | null;
  elicitations: ElicitationSurface | null;
  transcript: TranscriptSurface | null;
} = {
  conversation: null,
  composer: null,
  approvals: null,
  elicitations: null,
  transcript: null,
};

function HostFrontend() {
  const conversation = useAssistantConversation();
  const composer = useConversation();
  const approvals = useApprovals();
  const elicitations = useElicitations();
  const transcript = useTranscript();
  // Captured post-render (the hooks' immutability law bans render-phase
  // writes to module state); act() flushes effects, so every mount below
  // leaves `seen` current.
  useEffect(() => {
    seen.conversation = conversation;
    seen.composer = composer;
    seen.approvals = approvals;
    seen.elicitations = elicitations;
    seen.transcript = transcript;
  });
  return (
    <output data-testid="send-error">{conversation.sendError ?? ""}</output>
  );
}

function cannedCard(): ApprovalCardModel {
  return {
    interruptId: "pause-1",
    toolName: "action__create-support-ticket",
    toolArgs: { path: "/tickets" },
    toolInputSchema: null,
    toolOutputSchema: null,
    prompt: "The assistant wants to create a support ticket.",
    toolCallId: null,
    anchored: false,
    round: 0,
    runId: "run-1",
    parked: false,
    gated: false,
    trustAvailable: false,
    asker: { kind: "assistant" },
    turnId: null,
    status: { kind: "actionable", errorSentence: null },
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  seen.conversation = null;
  seen.composer = null;
  seen.approvals = null;
  seen.elicitations = null;
  seen.transcript = null;
  vi.mocked(sendAssistantMessage).mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function mountHeadless(options: { onError?: (error: Error) => void } = {}) {
  act(() => {
    root.render(
      // A unique key per suite: the session registry is module-scoped and
      // keyed on the publishable key.
      <TeaflaskAssistantProvider
        publishableKey="pk_test_headless"
        onError={options.onError}
      >
        <HostFrontend />
      </TeaflaskAssistantProvider>,
    );
  });
}

describe("the headless entry (@teaflask/assistant/headless)", () => {
  it("every hook resolves under the bare provider — no package chrome mounted", () => {
    mountHeadless();

    // useConversation() did not throw and carries the composer contract.
    expect(seen.composer).not.toBeNull();
    expect(typeof seen.composer?.sendMessage).toBe("function");
    // The conversation binding is live (no thread yet — a fresh session).
    expect(seen.conversation?.conversation).toBeNull();
    expect(seen.conversation?.threads).toEqual([]);
    // The elicitation surface is the provider's, shape-complete.
    expect(seen.elicitations?.cards).toEqual([]);
    expect(seen.elicitations?.drafts).toBeDefined();
  });

  it("the transcript read surface resolves under the bare provider, shape-complete and empty", () => {
    mountHeadless();

    const transcript = seen.transcript;
    expect(transcript).not.toBeNull();
    // A fresh session: nothing streamed, nothing running, nothing open —
    // and every raw read already present, so a host can hand them to the
    // re-exported transcriptRowsOf without narrowing.
    expect(transcript?.rows).toEqual([]);
    expect(transcript?.displayRows).toEqual([]);
    expect(transcript?.running).toBe(false);
    expect(transcript?.turnOpen).toBe(false);
    expect(transcript?.decisionsPending).toBe(false);
    expect(transcript?.messages).toEqual([]);
    expect(transcript?.markerAnchors.toolCallDisplayAnchors).toBeDefined();
    expect(transcript?.activity.newestTurnStatus).toBeNull();
    expect(transcript?.turnMeta.size).toBe(0);
  });

  it("a headless send renders as a transcript row: the optimistic echo rides displayRows before the POST answers", async () => {
    // The send hangs at the wire (this suite's idiom — no stream
    // machinery), so what appears can only be the store's optimistic
    // echo: the member's message, projected end-to-end through the
    // public read surface with no chrome mounted anywhere.
    vi.mocked(sendAssistantMessage).mockImplementation(
      () => new Promise<never>(() => undefined),
    );
    mountHeadless();
    expect(seen.transcript?.displayRows).toEqual([]);

    await act(async () => {
      void seen.composer?.sendMessage("How do I steep sencha?");
      // The send itself never settles (the wire hangs); flush the
      // microtask queue so the optimistic contract update lands.
      await Promise.resolve();
    });

    const transcript = seen.transcript;
    // rows stays the pure projection — replay has injected nothing.
    expect(transcript?.rows).toEqual([]);
    // displayRows carries the echo: kind user, optimistic, the host's text.
    expect(transcript?.displayRows).toHaveLength(1);
    expect(transcript?.displayRows[0]).toMatchObject({
      kind: "user",
      text: "How do I steep sencha?",
      optimistic: true,
    });
  });

  it("sign-out is reachable from this entry: resetAssistant clears the stored thread without the root barrel", () => {
    // Round-2 review finding 3: the README's sign-out path must not cost
    // a headless host the whole chrome bundle. Genuinely functional, not
    // just exported: a stored thread pointer for this key is gone after
    // the call.
    window.localStorage.setItem(
      "tf-assistant:pk_test_headless:thread",
      JSON.stringify({ threadId: "thread-1", identified: false }),
    );
    expect(window.localStorage.length).toBeGreaterThan(0);
    resetAssistant({ publishableKey: "pk_test_headless" });
    expect(
      window.localStorage.getItem("tf-assistant:pk_test_headless:thread"),
    ).toBeNull();
  });

  it("a headless send travels the composer contract to the transport seam and reports through onError", async () => {
    const onError = vi.fn();
    const refusal = new ServingApiError({
      code: "UNKNOWN",
      status: 500,
      message: "the suite has no backend",
      retryAfterSeconds: null,
    });
    vi.mocked(sendAssistantMessage).mockRejectedValue(refusal);
    mountHeadless({ onError });

    let sent: boolean | null = null;
    await act(async () => {
      sent =
        (await seen.composer?.sendMessage("How do I steep sencha?")) ?? null;
    });

    // The send reached the wire seam carrying the host's message…
    expect(vi.mocked(sendAssistantMessage)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendAssistantMessage).mock.calls[0][1]).toMatchObject({
      message: "How do I steep sencha?",
    });
    // …failed honestly (false, and a sendError sentence the host can
    // render — read back through useAssistantConversation)…
    expect(sent).toBe(false);
    expect(
      container.querySelector('[data-testid="send-error"]')?.textContent,
    ).not.toBe("");
    // …and the provider's onError heard about it. No chrome anywhere.
    expect(onError).toHaveBeenCalledWith(refusal);
  });

  it("outside any provider, the elicitation guard is loud: submit and cancel reject instead of dropping answers", async () => {
    // Round-2 review finding: the old default resolved successfully, so a
    // misplaced host mount silently dropped the member's answers. The
    // guard must mirror the approval one — console narration + rejection
    // — and this test fails against that old resolve-quietly default.
    const captured: { surface: ElicitationSurface | null } = {
      surface: null,
    };
    function OutsideProvider() {
      const surface = useElicitations();
      // Post-render capture, the HostFrontend idiom: the hooks lint bans
      // render-phase writes to outer variables.
      useEffect(() => {
        captured.surface = surface;
      });
      return null;
    }
    act(() => {
      root.render(<OutsideProvider />);
    });
    const surface = captured.surface;
    if (surface === null) {
      throw new Error("the hook never rendered");
    }
    const set: QuestionSetCardModel = {
      interruptId: "e-stray",
      runId: "run-1",
      toolCallId: null,
      anchored: false,
      round: 0,
      status: "actionable",
      errorSentence: null,
      answered: null,
      questions: [
        { id: "q1", heading: "Plan", prompt: "Which plan?", options: [] },
      ],
    };
    const quiet = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      await expect(
        surface.submitQuestionAnswers(set, [{ id: "q1", text: "starter" }]),
      ).rejects.toThrow("the answers were NOT sent");
      await expect(surface.cancelQuestionSet(set)).rejects.toThrow(
        "the set was NOT cancelled",
      );
      expect(quiet).toHaveBeenCalled();
    } finally {
      quiet.mockRestore();
    }
  });

  it("useApprovals() is the provider's live surface, not the out-of-surface guard", async () => {
    mountHeadless();

    expect(seen.approvals?.cards).toEqual([]);
    // The guard REJECTS with "submitDecision called outside an approval
    // surface…"; the live store surface resolves (dropping the unknown
    // card with a reason, never a rejection). Silence the deliberate
    // console narration either path would print.
    const quiet = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      await expect(
        seen.approvals?.submitDecision(cannedCard(), { approved: true }),
      ).resolves.toBeUndefined();
    } finally {
      quiet.mockRestore();
    }
  });
});
