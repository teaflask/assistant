// @vitest-environment jsdom
/**
 * The pending-decision gap: the server names pending interrupts this
 * client holds nothing for. With the generic wait label deleted, this
 * state must be LOUD — an explicit role="alert" notice with a working
 * retry — never silence. The derivation is pure and reads the server's
 * ids against inbox state ("never infer 'nothing pending' from 'no card
 * rendered'").
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationView } from "../src/components/conversation-view";
import type { AssistantConversation } from "../src/components/use-assistant-conversation";
import { ObservableCell } from "../src/core/observable-cell";
import type { ApprovalCardModel } from "../src/core/approval-inbox";
import type { ElicitationCardModel } from "../src/core/elicitation-cards";
import type { ExecutionEntryModel } from "../src/core/execution-inbox";
import {
  consumedInterruptRecorder,
  interruptAnswerConsumedPayloadOf,
} from "../src/core/consumed-interrupts";
import {
  gapSignatureOf,
  pendingDecisionGapOf,
  type GapJudgeableTurn,
} from "../src/core/pending-decision-gap";
import type { ServingAssistantTurn } from "../src/contract/threads";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
  ResizeObserverStub;

function turnOf(
  overrides: Partial<ServingAssistantTurn>,
): ServingAssistantTurn {
  return {
    id: "turn-1",
    thread_id: "thread-1",
    user_message: "File the ticket.",
    kind: null,
    status: "parked",
    error: null,
    run_id: "run-1",
    pending_interrupt_ids: ["i-1"],
    awaiting_round: 0,
    pending_approvals: [],
    created_at: "2026-08-30T10:00:00Z",
    updated_at: "2026-08-30T10:00:00Z",
    ...overrides,
  };
}

function approvalCardOf(interruptId: string): ApprovalCardModel {
  return {
    interruptId,
    toolName: "action__create-support-ticket",
    toolArgs: {},
    toolInputSchema: null,
    toolOutputSchema: null,
    prompt: "The assistant wants to create a support ticket.",
    toolCallId: null,
    anchored: false,
    round: 0,
    runId: "run-1",
    parked: true,
    gated: false,
    trustAvailable: false,
    asker: { kind: "assistant" },
    turnId: null,
    status: { kind: "actionable", errorSentence: null },
  };
}

const ASK_CARD: ElicitationCardModel = {
  interruptId: "i-ask",
  runId: "run-1",
  toolCallId: null,
  anchored: false,
  round: 0,
  questions: [
    {
      id: "plan",
      heading: "Plan",
      prompt: "Which plan?",
      options: [
        { text: "Yes", description: null },
        { text: "No", description: null },
      ],
    },
  ],
  status: "actionable",
  errorSentence: null,
  answered: null,
};

const EXECUTION_ENTRY: ExecutionEntryModel = {
  interruptId: "i-exec",
  toolName: "builtin_navigate",
  toolCallId: null,
  anchored: false,
  kind: "builtin.navigate",
  action: null,
  intent: null,
  round: 0,
  runId: "run-1",
  status: { kind: "pending" },
  asker: { kind: "assistant" },
  turnId: null,
};

describe("pendingDecisionGapOf — the pure derivation", () => {
  it("names the ids nothing on this client answers for", () => {
    const gap = pendingDecisionGapOf(
      turnOf({ pending_interrupt_ids: ["i-1", "i-2"] }),
      [approvalCardOf("i-1")],
      [],
      [],
    );
    expect(gap).toEqual({ turnId: "turn-1", missingInterruptIds: ["i-2"] });
  });

  it("is null when every pending id is represented — card, ask, or execution claim", () => {
    expect(
      pendingDecisionGapOf(
        turnOf({ pending_interrupt_ids: ["i-1", "i-ask", "i-exec"] }),
        [approvalCardOf("i-1")],
        [ASK_CARD],
        [EXECUTION_ENTRY],
      ),
    ).toBeNull();
  });

  it("a held card of ANY status represents its id — settled state is the card's own story", () => {
    const answered: ApprovalCardModel = {
      ...approvalCardOf("i-1"),
      status: { kind: "answered", approved: true, trusted: false },
    };
    expect(pendingDecisionGapOf(turnOf({}), [answered], [], [])).toBeNull();
  });

  it("only a pausing turn can gap — settled and live statuses judge null", () => {
    for (const status of [
      "queued",
      "working",
      "succeeded",
      "failed",
    ] as const) {
      expect(pendingDecisionGapOf(turnOf({ status }), [], [], [])).toBeNull();
    }
    expect(pendingDecisionGapOf(null, [], [], [])).toBeNull();
  });

  it("mirrors the driver's judgeability tolerances: lost capture and pre-field servers judge null", () => {
    // A null run_id hides the cards server-side — the set reads empty
    // though the pause is real, so there is nothing to judge; a
    // non-array is a server predating the field. Neither may alarm.
    expect(
      pendingDecisionGapOf(turnOf({ run_id: null }), [], [], []),
    ).toBeNull();
    expect(
      pendingDecisionGapOf(
        // A server predating the field sends none at all — the spread
        // erases it, which is exactly the wire shape under test.
        turnOf({ pending_interrupt_ids: undefined }),
        [],
        [],
        [],
      ),
    ).toBeNull();
    expect(
      pendingDecisionGapOf(turnOf({ pending_interrupt_ids: [] }), [], [], []),
    ).toBeNull();
  });

  it("a consumed id subtracts — its answer was already carried in, so no wait", () => {
    // Fully consumed → null, not an alarm.
    expect(
      pendingDecisionGapOf(turnOf({}), [], [], [], new Set(["i-1"])),
    ).toBeNull();
    // Partially consumed → the unconsumed sibling still alarms.
    const gap = pendingDecisionGapOf(
      turnOf({ pending_interrupt_ids: ["i-1", "i-2"] }),
      [],
      [],
      [],
      new Set(["i-1"]),
    );
    expect(gap).toEqual({ turnId: "turn-1", missingInterruptIds: ["i-2"] });
  });

  it("a server-named unservable id subtracts — no retry can build its card", () => {
    expect(
      pendingDecisionGapOf(
        turnOf({ unservable_interrupt_ids: ["i-1"] }),
        [],
        [],
        [],
      ),
    ).toBeNull();
    // Only the named subset subtracts; a servable missing sibling still
    // alarms — the loudness guard for genuine gaps.
    const gap = pendingDecisionGapOf(
      turnOf({
        pending_interrupt_ids: ["i-1", "i-2"],
        unservable_interrupt_ids: ["i-1"],
      }),
      [],
      [],
      [],
    );
    expect(gap).toEqual({ turnId: "turn-1", missingInterruptIds: ["i-2"] });
  });

  it("an older server (absent or malformed unservable field) still alarms — the pending-decision gap stays loud", () => {
    // The breaking case for the subtraction class: if absence ever read
    // as "everything unservable", genuine gaps would go silent.
    expect(pendingDecisionGapOf(turnOf({}), [], [], [])).toEqual({
      turnId: "turn-1",
      missingInterruptIds: ["i-1"],
    });
    expect(
      pendingDecisionGapOf(
        turnOf({
          unservable_interrupt_ids:
            "i-1" as unknown as ServingAssistantTurn["unservable_interrupt_ids"],
        }),
        [],
        [],
        [],
      ),
    ).toEqual({ turnId: "turn-1", missingInterruptIds: ["i-1"] });
  });

  it("judges a minimal structural turn — the widened signature accepts a five-field record with no cast", () => {
    // The playground passes its own generated AssistantTurnResponse,
    // whose pause fields are optional. This literal is the widened
    // GapJudgeableTurn's floor: five fields, nothing else — a revert of
    // the parameter to ServingAssistantTurn fails compilation here.
    const minimal: GapJudgeableTurn = {
      id: "turn-1",
      status: "awaiting_input",
      run_id: "run-1",
      pending_interrupt_ids: ["i-1"],
    };
    expect(pendingDecisionGapOf(minimal, [], [], [])).toEqual({
      turnId: "turn-1",
      missingInterruptIds: ["i-1"],
    });
    // The optional field genuinely absent (not spread-erased) judges
    // null — the same older-door tolerance, now told by the type too.
    expect(
      pendingDecisionGapOf(
        { id: "turn-1", status: "awaiting_input", run_id: "run-1" },
        [],
        [],
        [],
      ),
    ).toBeNull();
  });

  it("signatures are order-insensitive over the missing set", () => {
    const a = pendingDecisionGapOf(
      turnOf({ pending_interrupt_ids: ["i-1", "i-2"] }),
      [],
      [],
      [],
    );
    const b = pendingDecisionGapOf(
      turnOf({ pending_interrupt_ids: ["i-2", "i-1"] }),
      [],
      [],
      [],
    );
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    if (a !== null && b !== null) {
      expect(gapSignatureOf(a)).toBe(gapSignatureOf(b));
    }
  });
});

describe("consumedInterruptRecorder — the consumed fold's wire seam", () => {
  it("names the run and folds only well-formed markers", () => {
    const seen: [string, string][] = [];
    const recorder = consumedInterruptRecorder((runId, consumed) => {
      seen.push([runId, consumed.interruptId]);
    });
    // Before any RUN_STARTED there is no run to key on: dropped, and a
    // drop degrades to the loud fallback, never a crash.
    void recorder.onCustomEvent?.({
      event: {
        name: "interrupt_answer_consumed",
        value: { interrupt_id: "i-early", round: 0, family: "approval" },
      },
    } as never);
    void recorder.onRunStartedEvent?.({ event: { runId: "run-1" } } as never);
    void recorder.onCustomEvent?.({
      event: {
        name: "interrupt_answer_consumed",
        value: { interrupt_id: "i-1", round: 0, family: "tool_result" },
      },
    } as never);
    // Foreign markers and malformed values record nothing.
    void recorder.onCustomEvent?.({
      event: { name: "approval_resolved", value: { interrupt_id: "i-2" } },
    } as never);
    void recorder.onCustomEvent?.({
      event: { name: "interrupt_answer_consumed", value: { round: 0 } },
    } as never);
    expect(seen).toEqual([["run-1", "i-1"]]);
  });

  it("distrusts the wire shape field by field", () => {
    expect(interruptAnswerConsumedPayloadOf(null)).toBeNull();
    expect(interruptAnswerConsumedPayloadOf("i-1")).toBeNull();
    expect(
      interruptAnswerConsumedPayloadOf({ interrupt_id: "i-1" }),
    ).toBeNull();
    expect(
      interruptAnswerConsumedPayloadOf({ interrupt_id: "i-1", round: "0" }),
    ).toBeNull();
    expect(
      interruptAnswerConsumedPayloadOf({
        interrupt_id: "i-1",
        round: 2,
        family: "approval",
      }),
    ).toEqual({ interruptId: "i-1", round: 2 });
  });
});

describe("the gap alert (ConversationView)", () => {
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

  function coreWith(
    overrides: Partial<AssistantConversation>,
  ): AssistantConversation {
    return {
      setupError: null,
      conversation: null,
      threads: [],
      historyExpected: false,
      threadOpening: false,
      reconnectNonce: 0,
      composerContract: {
        busy: false,
        pendingSend: false,
        sendMessage: () => Promise.resolve(true),
        pendingEcho: null,
        composerRefocusPending: false,
        markComposerRefocusHandled: () => undefined,
        stopping: false,
        stopTurn: () => Promise.resolve(),
        modelPick: null,
        setModelPick: () => undefined,
        composerInput: new ObservableCell({
          scope: "u:0",
          draft: "",
          attachments: [],
        }),
        setDraft: () => undefined,
        setAttachments: () => undefined,
        noteComposerFocus: () => undefined,
        takeComposerCaretReturn: () => false,
      },
      sendError: null,
      turnFailure: null,
      showInterruptionBanner: false,
      pendingDecisionGap: null,
      refreshConversation: () => Promise.resolve(),
      retryStream: () => undefined,
      openThread: () => undefined,
      startNewConversation: () => undefined,
      resumeStoredThread: () => undefined,
      ...overrides,
    };
  }

  it("renders loud and recoverable: role=alert, and Retry re-reads the REST truth", () => {
    const refreshConversation = vi.fn(() => Promise.resolve());
    act(() => {
      root.render(
        <ConversationView
          core={coreWith({
            pendingDecisionGap: {
              turnId: "turn-1",
              missingInterruptIds: ["i-1"],
            },
            refreshConversation,
          })}
          surface="page"
        />,
      );
    });
    const notice = host.querySelector("[data-tf-pending-decision-gap]");
    expect(notice).not.toBeNull();
    // The hook rides the banner's OWN box (round-2 review finding: a
    // display:contents wrapper generates no box, so the roster-defocus
    // blur no-ops on it and the alert stayed crisp beside receded
    // siblings).
    expect(notice?.getAttribute("role")).toBe("alert");
    expect(notice?.textContent).toContain(
      "The assistant is waiting on a request that couldn't be shown.",
    );
    const retry = [...(notice?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Retry",
    );
    expect(retry).not.toBeUndefined();
    act(() => {
      retry?.click();
    });
    expect(refreshConversation).toHaveBeenCalledTimes(1);
  });

  it("renders nothing without a gap — the notice never idles in the chrome", () => {
    act(() => {
      root.render(<ConversationView core={coreWith({})} surface="page" />);
    });
    expect(host.querySelector("[data-tf-pending-decision-gap]")).toBeNull();
  });
});
