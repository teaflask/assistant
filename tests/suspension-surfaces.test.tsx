// @vitest-environment jsdom
// The suspension tenant: one actionable surface at a time on the
// shelf, a deterministic pager when several decisions are
// simultaneously actionable, the landlord's empty-collapse discipline
// (null, never a whitespace text node), and the stated focus premise —
// focus moves only at member-initiated moments: to the next decision
// after the focused one resolves, back to the composer when the queue
// empties, and never on arrival.

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import { ApprovalsContext } from "../src/components/approval-context";
import { ElicitationsContext } from "../src/components/elicitation-context";
import { SuspensionSurfaces } from "../src/components/suspension-surfaces";
import type {
  ApprovalCardModel,
  ApprovalCardStatus,
} from "../src/core/approval-inbox";
import type { ElicitationCardModel } from "../src/core/elicitation-cards";
import { QuestionDraftStore } from "../src/core/question-drafts";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function approvalOf(
  interruptId: string,
  toolCallId: string | null = null,
  status: ApprovalCardStatus = { kind: "actionable", errorSentence: null },
): ApprovalCardModel {
  return {
    interruptId,
    toolName: "action__create-support-ticket",
    toolArgs: { path: "/tickets" },
    toolInputSchema: null,
    toolOutputSchema: null,
    prompt: "The assistant wants to create a support ticket.",
    toolCallId,
    anchored: toolCallId !== null,
    round: 0,
    runId: "run-1",
    parked: false,
    gated: false,
    trustAvailable: false,
    asker: { kind: "assistant" },
    turnId: null,
    status,
  };
}

const AN_ASK: ElicitationCardModel = {
  interruptId: "e-ask",
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

function render(
  approvals: readonly ApprovalCardModel[],
  elicitations: readonly ElicitationCardModel[],
  rowIndexByToolCallId: ReadonlyMap<string, number> = new Map(),
  drafts: QuestionDraftStore = new QuestionDraftStore(),
) {
  act(() => {
    root.render(
      <ApprovalsContext.Provider
        value={{ cards: approvals, submitDecision: () => Promise.resolve() }}
      >
        <ElicitationsContext.Provider
          value={{
            cards: elicitations,
            submitQuestionAnswers: () => Promise.resolve(),
            cancelQuestionSet: () => Promise.resolve(),
            drafts,
          }}
        >
          <SuspensionSurfaces rowIndexByToolCallId={rowIndexByToolCallId} />
        </ElicitationsContext.Provider>
      </ApprovalsContext.Provider>,
    );
  });
}

function buttonNamed(name: string): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.textContent.trim() === name,
  );
  if (button === undefined) {
    throw new Error(`no "${name}" button rendered`);
  }
  return button;
}

describe("the empty-collapse discipline", () => {
  it("renders nothing at all without an actionable decision — no frame, no whitespace text node", () => {
    render([approvalOf("a-done", null, { kind: "stale" })], []);
    expect(host.innerHTML).toBe("");
    expect(host.childNodes).toHaveLength(0);
  });
});

describe("the queue surface", () => {
  it("one decision: the card renders as current, with no pager", () => {
    render([approvalOf("a-only")], []);
    const current = host.querySelector("[data-tf-current-decision]");
    expect(current?.querySelector("[data-tf-approval-card]")).not.toBeNull();
    expect(host.querySelector("[data-tf-suspension-pager]")).toBeNull();
  });

  it("several decisions: exactly one card mounts at a time, the pager says where it sits, and the ends disable", () => {
    render([approvalOf("a-one"), approvalOf("a-two")], [AN_ASK]);
    expect(
      host.querySelector("[data-tf-suspension-pager]")?.textContent,
    ).toContain("Decision 1 of 3");
    expect(
      host.querySelectorAll(
        "[data-tf-approval-card], [data-tf-elicitation-card]",
      ),
    ).toHaveLength(1);
    expect(buttonNamed("Previous").disabled).toBe(true);
    expect(buttonNamed("Next").disabled).toBe(false);

    act(() => {
      buttonNamed("Next").click();
    });
    act(() => {
      buttonNamed("Next").click();
    });
    expect(
      host.querySelector("[data-tf-suspension-pager]")?.textContent,
    ).toContain("Decision 3 of 3");
    // The ask (orphan elicitation) is last in the deterministic order.
    expect(host.querySelector("[data-tf-elicitation-card]")).not.toBeNull();
    expect(buttonNamed("Next").disabled).toBe(true);
    expect(buttonNamed("Previous").disabled).toBe(false);
  });

  it("the queue bar sits outside the decision scroll well — paging context never scrolls away", () => {
    render([approvalOf("a-one"), approvalOf("a-two")], []);
    const pager = host.querySelector("[data-tf-suspension-pager]");
    expect(pager).not.toBeNull();
    expect(pager?.closest("[data-tf-decision-scroll-well]")).toBeNull();
    expect(
      host.querySelector(
        "[data-tf-decision-scroll-well] [data-tf-current-decision]",
      ),
    ).not.toBeNull();
  });

  it("paging keeps a question set's draft in the store — the pager's remount isolates without destroying", () => {
    const drafts = new QuestionDraftStore();
    const set: ElicitationCardModel = {
      interruptId: "e-set",
      runId: "run-1",
      toolCallId: null,
      anchored: false,
      round: 0,
      status: "actionable",
      errorSentence: null,
      answered: null,
      questions: [
        {
          id: "fruit",
          heading: "Favorite fruit",
          prompt: "Fruit?",
          options: [
            { text: "Mango", description: null },
            { text: "Apple", description: null },
          ],
        },
        {
          id: "notes",
          heading: "Notes",
          prompt: "Anything else?",
          options: [],
        },
      ],
    };
    render([approvalOf("a-one")], [set], new Map(), drafts);
    // The approval sorts first; page to the set and stage an answer.
    act(() => {
      buttonNamed("Next").click();
    });
    const mango = [...host.querySelectorAll("[role=radio]")].find((row) =>
      row.textContent.includes("Mango"),
    );
    act(() => {
      mango?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      buttonNamed("Next question").click();
    });
    const textarea = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Custom answer"]',
    );
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, "half a thought");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Page away (the keyed wrap unmounts the panel) and back.
    act(() => {
      buttonNamed("Previous").click();
    });
    expect(host.querySelector("[data-tf-question-panel]")).toBeNull();
    act(() => {
      buttonNamed("Next").click();
    });
    // Position, choice and text all came back from the store.
    expect(
      host.querySelector("[data-tf-question-pager]")?.textContent,
    ).toContain("2/2");
    expect(
      host.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Custom answer"]',
      )?.value,
    ).toBe("half a thought");
    act(() => {
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Previous question"]',
        )
        ?.click();
    });
    expect(
      [...host.querySelectorAll("[role=radio]")]
        .find((row) => row.textContent.includes("Mango"))
        ?.getAttribute("aria-checked"),
    ).toBe("true");
    // Nothing bled into the approval's decision, and the set's draft is
    // keyed to its own interrupt.
    expect(drafts.hasContent("e-set")).toBe(true);
    expect(drafts.hasContent("approval:a-one")).toBe(false);
  });

  it("paging remounts the card, so one decision's local draft never bleeds into another", () => {
    render([approvalOf("a-one"), approvalOf("a-two")], []);
    act(() => {
      buttonNamed("Deny").click();
    });
    expect(
      host.querySelector('[aria-label="Reason for denying"]'),
    ).not.toBeNull();
    act(() => {
      buttonNamed("Next").click();
    });
    expect(host.querySelector('[aria-label="Reason for denying"]')).toBeNull();
    act(() => {
      buttonNamed("Previous").click();
    });
    // Back on the first decision: the deny step did not survive the
    // round trip — reviewing one card never carries state into another.
    expect(host.querySelector('[aria-label="Reason for denying"]')).toBeNull();
  });

  it("a late-arriving decision that sorts ahead never swaps the presented card — the identity hold's reorder path", () => {
    const rowIndex = new Map([
      ["t-first", 1],
      ["t-second", 4],
    ]);
    // The later row's request arrived first: it is the queue, and the
    // member starts a deny on it.
    render([approvalOf("a-late-row", "t-second")], [], rowIndex);
    act(() => {
      buttonNamed("Deny").click();
    });
    expect(
      host.querySelector('[aria-label="Reason for denying"]'),
    ).not.toBeNull();
    // The earlier row's request lands and sorts AHEAD. The presented
    // decision must not swap (and must not remount — the half-typed
    // deny survives); only the pager's number moves.
    render(
      [approvalOf("a-late-row", "t-second"), approvalOf("a-early", "t-first")],
      [],
      rowIndex,
    );
    expect(
      host.querySelector("[data-tf-suspension-pager]")?.textContent,
    ).toContain("Decision 2 of 2");
    expect(
      host.querySelector('[aria-label="Reason for denying"]'),
    ).not.toBeNull();
  });

  it("an arrival after a shrink never re-points a stale index — the identity hold's shrink-then-grow path", () => {
    // Three pending; the member pages to the last one.
    render([approvalOf("a-1"), approvalOf("a-2"), approvalOf("a-3")], []);
    act(() => {
      buttonNamed("Next").click();
    });
    act(() => {
      buttonNamed("Next").click();
    });
    expect(
      host.querySelector("[data-tf-suspension-pager]")?.textContent,
    ).toContain("Decision 3 of 3");
    // It resolves; the clamped fallback promotes the second decision,
    // and the member starts a deny there.
    render([approvalOf("a-1"), approvalOf("a-2")], []);
    expect(
      host.querySelector("[data-tf-suspension-pager]")?.textContent,
    ).toContain("Decision 2 of 2");
    act(() => {
      buttonNamed("Deny").click();
    });
    expect(
      host.querySelector('[aria-label="Reason for denying"]'),
    ).not.toBeNull();
    // A new decision arrives. The old numeric cursor (2) would point at
    // it; the identity hold keeps the member's decision presented and
    // the deny step alive.
    render([approvalOf("a-1"), approvalOf("a-2"), approvalOf("a-4")], []);
    expect(
      host.querySelector("[data-tf-suspension-pager]")?.textContent,
    ).toContain("Decision 2 of 3");
    expect(
      host.querySelector('[aria-label="Reason for denying"]'),
    ).not.toBeNull();
  });

  it("the press that lands on a pager end hands focus to the sibling instead of blurring into a disabled button", () => {
    render([approvalOf("a-1"), approvalOf("a-2")], []);
    act(() => {
      buttonNamed("Next").focus();
    });
    expect(document.activeElement).toBe(buttonNamed("Next"));
    act(() => {
      buttonNamed("Next").click();
    });
    // The press landed on the last decision: Next is now disabled, and
    // focus must be on Previous — not dropped to <body>.
    expect(buttonNamed("Next").disabled).toBe(true);
    expect(document.activeElement).toBe(buttonNamed("Previous"));
    // The knock-on the round-1 review named: because focus never left
    // the tenant, resolving the presented decision still performs the
    // hand-off the focus premise promises.
    render(
      [
        approvalOf("a-1"),
        approvalOf("a-2", null, {
          kind: "answered",
          approved: true,
          trusted: false,
        }),
      ],
      [],
    );
    expect(document.activeElement).toBe(
      host.querySelector("[data-tf-current-decision]"),
    );
  });

  it("resolving the current decision promotes the next one at the same position", () => {
    render([approvalOf("a-one"), approvalOf("a-two")], []);
    render(
      [
        approvalOf("a-one", null, {
          kind: "answered",
          approved: true,
          trusted: false,
        }),
        approvalOf("a-two"),
      ],
      [],
    );
    expect(host.querySelector("[data-tf-suspension-pager]")).toBeNull();
    expect(host.textContent).toContain(
      "The assistant wants to create a support ticket.",
    );
    expect(host.querySelectorAll("[data-tf-approval-card]")).toHaveLength(1);
  });

  // The "anchored row's display context reaches the shelf-hosted card"
  // case was deleted with its subject: the display join into the card
  // is gone — the banner reads only the card model, and the row keeps
  // its own annotation. The banner's argument-free face is pinned in
  // approval-card.test.tsx and by TVC-063.
});

describe("the per-decision boundary", () => {
  // React 18's dev build re-dispatches boundary-caught errors on window;
  // preventDefault keeps jsdom from reporting the deliberate throw.
  const swallow = (event: Event) => {
    event.preventDefault();
  };
  let quiet: MockInstance<typeof console.error>;
  beforeEach(() => {
    window.addEventListener("error", swallow);
    quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    window.removeEventListener("error", swallow);
    quiet.mockRestore();
  });

  function poisoned(interruptId: string): ApprovalCardModel {
    const card = approvalOf(interruptId);
    // A render-time fault in the card's own subtree: the consent copy is
    // the first thing the card body dereferences.
    Object.defineProperty(card, "prompt", {
      get(): never {
        throw new Error("a poisoned decision card");
      },
    });
    return card;
  }

  it("one poisoned card degrades one decision — paging still reaches the next, resolution still clears it", () => {
    const healthy = approvalOf("b-healthy");
    render([poisoned("a-poisoned"), healthy], []);

    // The current decision degraded to the card; the queue bar (outside
    // the boundary) survives, so the member can still page.
    expect(
      host.querySelector('[data-tf-surface-fallback="decision-card"]'),
    ).not.toBeNull();
    expect(host.textContent).toContain("Decision 1 of 2");

    // Paging changes the keyed wrapper's identity: the boundary remounts
    // with the next decision, and the healthy card renders in full.
    act(() => {
      buttonNamed("Next").click();
    });
    expect(
      host.querySelector('[data-tf-surface-fallback="decision-card"]'),
    ).toBeNull();
    expect(host.textContent).toContain(
      "The assistant wants to create a support ticket.",
    );

    // The resolution path resets the same way: the poisoned decision
    // leaving the queue changes the identity key, so a fresh queue
    // renders clean with no latched card left behind.
    render([healthy], []);
    expect(
      host.querySelector('[data-tf-surface-fallback="decision-card"]'),
    ).toBeNull();
    expect(host.querySelector("[data-tf-approval-card]")).not.toBeNull();
  });
});

describe("the focus premise", () => {
  it("a blur to nowhere — the browser's disable-blur fixup — never disarms the resolve hand-off", () => {
    // jsdom does not implement the fixup (in real browsers, disabling a
    // focused control drops focus to <body> and fires focusout with a
    // NULL relatedTarget), so this dispatches that exact event by hand —
    // a test that merely clicked Approve would stay green in jsdom
    // without proving anything. The reachable path: the local guard
    // disables the pressed button in place whenever the store's
    // submitting flip does not land in the same commit (a stubbed
    // submit, a mid-POST thread switch skipping publishIfCurrent).
    render([approvalOf("a-one"), approvalOf("a-two")], []);
    act(() => {
      buttonNamed("Approve").focus();
    });
    act(() => {
      buttonNamed("Approve").dispatchEvent(
        new FocusEvent("focusout", { bubbles: true }),
      );
      buttonNamed("Approve").blur();
    });
    expect(document.activeElement).toBe(document.body);
    // The decision resolves: the hand-off must still run — the member's
    // focus was dropped by OUR OWN disable, not by them leaving.
    render(
      [
        approvalOf("a-one", null, {
          kind: "answered",
          approved: true,
          trusted: false,
        }),
        approvalOf("a-two"),
      ],
      [],
    );
    expect(document.activeElement).toBe(
      host.querySelector("[data-tf-current-decision]"),
    );
  });

  it("a production submit unmounts the focused button in one commit — spinner in, no disabled Approve ever painted — and the settle still hands off", () => {
    // Reviewer A's clearing claim for the primary path, verified rather
    // than adopted: the store flips the card to submitting and publishes
    // SYNCHRONOUSLY before its first await (approval-decision.ts), so
    // the flip batches with the local guard in the same event handler
    // and the footer is REPLACED by the spinner — the focused button
    // unmounts (removal fires no blur) rather than rendering disabled.
    // Negative control, watched red: deferring the harness's flip by a
    // macrotask paints the disabled Approve and fails the no-Approve
    // assertion below.
    const composerWash = document.createElement("div");
    composerWash.setAttribute("data-tf-composer-wash", "");
    const composerInput = document.createElement("textarea");
    composerWash.appendChild(composerInput);
    document.body.appendChild(composerWash);

    function Harness() {
      const [cards, setCards] = useState<readonly ApprovalCardModel[]>([
        approvalOf("a-live"),
      ]);
      return (
        <ApprovalsContext.Provider
          value={{
            cards,
            submitDecision: (card) => {
              // publishIfCurrent's shape: the submitting flip lands
              // before the first await, inside the click handler.
              setCards([{ ...card, status: { kind: "submitting" } }]);
              queueMicrotask(() => {
                act(() => {
                  setCards([
                    {
                      ...card,
                      status: {
                        kind: "answered",
                        approved: true,
                        trusted: false,
                      },
                    },
                  ]);
                });
              });
              return Promise.resolve();
            },
          }}
        >
          <ElicitationsContext.Provider
            value={{
              cards: [],
              submitQuestionAnswers: () => Promise.resolve(),
              cancelQuestionSet: () => Promise.resolve(),
              drafts: new QuestionDraftStore(),
            }}
          >
            <SuspensionSurfaces rowIndexByToolCallId={new Map()} />
          </ElicitationsContext.Provider>
        </ApprovalsContext.Provider>
      );
    }
    act(() => {
      root.render(<Harness />);
    });
    act(() => {
      buttonNamed("Approve").focus();
    });
    act(() => {
      buttonNamed("Approve").click();
    });
    // The commit after the click: spinner, and no Approve — disabled or
    // otherwise — anywhere.
    expect(host.textContent).toContain("Sending…");
    expect(
      [...host.querySelectorAll("button")].some(
        (button) => button.textContent.trim() === "Approve",
      ),
    ).toBe(false);
    // The answer settles (microtask): the card leaves the queue and the
    // hand-off still runs — unmount dropped focus silently, so the
    // armed flag carried it to the composer.
    return Promise.resolve().then(() => {
      expect(document.activeElement).toBe(composerInput);
      composerWash.remove();
    });
  });
  it("never steals focus on arrival", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    render([approvalOf("a-new")], []);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("moves focus to the next decision when the focused one resolves, and to the composer when the queue empties", () => {
    const composerWash = document.createElement("div");
    composerWash.setAttribute("data-tf-composer-wash", "");
    const composerInput = document.createElement("textarea");
    composerWash.appendChild(composerInput);
    document.body.appendChild(composerWash);

    render([approvalOf("a-one"), approvalOf("a-two")], []);
    act(() => {
      buttonNamed("Approve").focus();
    });
    expect(document.activeElement).toBe(buttonNamed("Approve"));

    // The focused decision resolves: focus lands on the promoted
    // decision's wrapper (not on thin air, not on <body>).
    render(
      [
        approvalOf("a-one", null, {
          kind: "answered",
          approved: true,
          trusted: false,
        }),
        approvalOf("a-two"),
      ],
      [],
    );
    expect(document.activeElement).toBe(
      host.querySelector("[data-tf-current-decision]"),
    );

    // The queue empties under focus: the member gets the composer back.
    render(
      [
        approvalOf("a-one", null, {
          kind: "answered",
          approved: true,
          trusted: false,
        }),
        approvalOf("a-two", null, {
          kind: "answered",
          approved: true,
          trusted: false,
        }),
      ],
      [],
    );
    expect(document.activeElement).toBe(composerInput);
    composerWash.remove();
  });

  it("the queue-empties hand-off targets THIS conversation's composer, never the first in the document (concurrent surfaces)", () => {
    // Two surfaces can mount Transcript concurrently (the page under an
    // open palette — acquireTranscriptLease keeps a LIST of holders).
    // The other surface's composer comes first in document order and,
    // behind a modal <dialog>, is inert: a document-scoped lookup would
    // silently drop the member's focus into it (round-4 finding).
    const otherConversation = document.createElement("div");
    otherConversation.setAttribute("data-tf-conversation", "");
    const otherWash = document.createElement("div");
    otherWash.setAttribute("data-tf-composer-wash", "");
    const otherInput = document.createElement("textarea");
    otherWash.appendChild(otherInput);
    otherConversation.appendChild(otherWash);
    document.body.insertBefore(otherConversation, host);

    // THIS tenant's own conversation column, composer after the tenant
    // (the shipping order inside [data-tf-conversation]).
    const conversation = document.createElement("div");
    conversation.setAttribute("data-tf-conversation", "");
    document.body.appendChild(conversation);
    conversation.appendChild(host);
    const wash = document.createElement("div");
    wash.setAttribute("data-tf-composer-wash", "");
    const ownInput = document.createElement("textarea");
    wash.appendChild(ownInput);
    conversation.appendChild(wash);

    render([approvalOf("a-only")], []);
    act(() => {
      buttonNamed("Approve").focus();
    });
    render(
      [
        approvalOf("a-only", null, {
          kind: "answered",
          approved: true,
          trusted: false,
        }),
      ],
      [],
    );
    expect(document.activeElement).toBe(ownInput);
    document.body.appendChild(host);
    otherConversation.remove();
    conversation.remove();
  });

  it("moving focus OUT of the tenant disarms the hand-off — the onBlur disarm branch, actually reached", () => {
    // The scoped verifier's finding: the neighbouring never-armed test
    // proves nothing about the DISARM branch (focus never enters the
    // tenant there), leaving onBlur deletable with a green suite. Here
    // the flag is armed first (focus on Approve), then focus verifiably
    // moves outside — the focusout carries a non-null relatedTarget,
    // dispatched by hand because jsdom's focus() does not reliably
    // populate it — and a later resolve must NOT commandeer focus.
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    render([approvalOf("a-one"), approvalOf("a-two")], []);
    act(() => {
      buttonNamed("Approve").focus();
    });
    act(() => {
      buttonNamed("Approve").dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }),
      );
      outside.focus();
    });
    render(
      [
        approvalOf("a-one", null, {
          kind: "answered",
          approved: true,
          trusted: false,
        }),
        approvalOf("a-two"),
      ],
      [],
    );
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("does not commandeer focus when the member never focused the tenant at all", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    render([approvalOf("a-one")], []);
    outside.focus();
    render(
      [
        approvalOf("a-one", null, {
          kind: "answered",
          approved: true,
          trusted: false,
        }),
      ],
      [],
    );
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
