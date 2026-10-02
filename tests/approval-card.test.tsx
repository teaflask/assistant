// @vitest-environment jsdom
import { act, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApprovalCard } from "../src/components/approval-card";
import {
  ApprovalsContext,
  type ApprovalSurface,
} from "../src/components/approval-context";
import type { ApprovalCardModel } from "../src/core/approval-inbox";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const submitDecision = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  submitDecision.mockClear();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
});

function cardOf(overrides: Partial<ApprovalCardModel> = {}): ApprovalCardModel {
  return {
    interruptId: "v1:before_tool_call:t1:handler",
    toolName: "action__create-support-ticket",
    toolArgs: {
      path: "/tickets",
      title: "Kettle whistles in B minor",
      body: { priority: "high", description: "It really does." },
    },
    toolInputSchema: null,
    toolOutputSchema: null,
    prompt: "The assistant wants to create a support ticket.",
    toolCallId: "run-1-a1-t1",
    anchored: true,
    round: 0,
    runId: "run-1",
    parked: false,
    gated: false,
    trustAvailable: false,
    asker: { kind: "assistant" },
    turnId: null,
    status: { kind: "actionable", errorSentence: null },
    ...overrides,
  };
}

function render(card: ApprovalCardModel) {
  act(() => {
    root.render(
      <ApprovalsContext.Provider value={{ cards: [card], submitDecision }}>
        <ApprovalCard card={card} />
      </ApprovalsContext.Provider>,
    );
  });
}

function buttonNamed(label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find(
    (button) => button.textContent === label,
  );
}

describe("the generic approval banner", () => {
  it("uses a fixed heading and only mechanically spells the arbitrary tool", () => {
    render(cardOf());

    expect(host.querySelector("[data-tf-approval-title]")?.textContent).toBe(
      "Approval required",
    );
    expect(host.textContent).toContain("Create support ticket");
    expect(host.textContent).toContain(
      "The assistant wants to create a support ticket.",
    );
  });

  it("renders nothing argument-derived — the call's own row carries the request", () => {
    render(cardOf());

    // The former faces of the request, each ruled off this surface: the
    // bounded summary, the technical-details disclosure and its raw
    // <pre>, and every argument value the canned card carries.
    expect(host.querySelector("[data-tf-approval-request-summary]")).toBeNull();
    expect(host.querySelector("pre")).toBeNull();
    expect(host.querySelector("details")).toBeNull();
    expect(host.textContent).not.toContain("Technical details");
    expect(host.textContent).not.toContain("/tickets");
    expect(host.textContent).not.toContain("It really does.");
    expect(host.textContent).not.toContain("Kettle whistles in B minor");
  });

  it("keeps the complete consent sentence verbatim", () => {
    const prompt =
      'The assistant wants to use "Submit Doc Draft" (POST /api/v1/doc-drafts). This action requires approval before it runs.';
    render(cardOf({ prompt }));

    const explanation = host.querySelector("[data-tf-approval-prompt]");
    expect(explanation?.textContent).toBe(prompt);
    expect(explanation?.className).not.toContain("overflow-hidden");
  });

  it("does not invent request content for an argument-less pause", () => {
    render(cardOf({ toolName: null, toolArgs: {}, prompt: "" }));

    expect(host.textContent).toContain("Tool request");
    expect(host.textContent).toContain(
      "This tool needs your approval before it can run.",
    );
    expect(host.querySelector("[data-tf-approval-request-summary]")).toBeNull();
  });

  it("is deterministic across argument key order", () => {
    render(cardOf({ toolArgs: { b: 2, a: 1 } }));
    const first = host.innerHTML;
    act(() => {
      root.unmount();
    });
    root = createRoot(host);
    render(cardOf({ toolArgs: { a: 1, b: 2 } }));
    expect(host.innerHTML).toBe(first);
  });
});

describe("the banner header", () => {
  it("offers no navigation to the call's row", () => {
    // The pending decision already holds the call's row open.
    render(cardOf());
    expect(host.querySelector("[data-tf-approval-show-request]")).toBeNull();
    expect(buttonNamed("Show request")).toBeUndefined();
  });
});

describe("approval decisions", () => {
  it("submits approve once and disables every decision immediately", () => {
    const card = cardOf({ trustAvailable: true });
    render(card);
    act(() => {
      buttonNamed("Approve")?.click();
      buttonNamed("Approve")?.click();
    });

    expect(submitDecision).toHaveBeenCalledTimes(1);
    expect(submitDecision).toHaveBeenCalledWith(card, { approved: true });
    expect(buttonNamed("Approve")?.disabled).toBe(true);
    expect(buttonNamed("Deny")?.disabled).toBe(true);
    // The decision controls live under the footer's identity hook — the
    // hook names the region (host CSS, tests), same posture as the
    // banner's other data-tf-* hooks.
    expect(
      host.querySelectorAll("[data-tf-approval-footer] button").length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("collects optional denial feedback", () => {
    const card = cardOf();
    render(card);
    act(() => {
      buttonNamed("Deny")?.click();
    });
    const textarea = host.querySelector("textarea");
    act(() => {
      if (textarea !== null) {
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set?.call(textarea, "Please change the destination");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    act(() => {
      buttonNamed("Send denial")?.click();
    });
    expect(submitDecision).toHaveBeenCalledWith(card, {
      approved: false,
      feedback: "Please change the destination",
    });
  });

  it("offers conversation trust only when the wire allows it", () => {
    const card = cardOf({ trustAvailable: true, gated: false });
    render(card);
    expect(buttonNamed("Approve for this conversation")).toBeDefined();
    act(() => {
      buttonNamed("Approve for this conversation")?.click();
    });
    expect(submitDecision).toHaveBeenCalledWith(card, {
      approved: true,
      trust: true,
    });
  });

  it("renders parked, submitting, answered, stale, and gate states", () => {
    render(cardOf({ parked: true, gated: true }));
    // A parked ask looks exactly like a live one: the card says nothing
    // about the turn's plumbing, and stays answerable. The gate names
    // its per-call policy so the repeat ask reads as policy, not amnesia.
    expect(host.textContent).not.toContain("isn't actively waiting");
    expect(host.textContent).toContain("asks every time");
    expect(buttonNamed("Approve")).toBeDefined();
    expect(buttonNamed("Deny")).toBeDefined();

    render(cardOf({ status: { kind: "submitting" } }));
    expect(host.textContent).toContain("Sending…");

    render(
      cardOf({
        status: { kind: "answered", approved: true, trusted: false },
      }),
    );
    expect(host.textContent).toContain("Approved");

    // A denial's note wears the ROW's word: the banner and the
    // not-approved row say one word for one fact — never "Denied", and
    // never the door's "Declined".
    render(
      cardOf({
        status: { kind: "answered", approved: false, trusted: false },
      }),
    );
    expect(host.textContent).toContain("Not approved");
    expect(host.textContent).not.toContain("Denied");
    expect(host.textContent).not.toContain("Declined");

    render(cardOf({ status: { kind: "stale" } }));
    expect(host.textContent).toContain("already answered or expired");
  });

  it("announces a failed submit's sentence as an alert and stays actionable", () => {
    render(
      cardOf({
        status: {
          kind: "actionable",
          errorSentence: "Your answer wasn't sent. Try again.",
        },
      }),
    );

    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Your answer wasn't sent. Try again.",
    );
    expect(buttonNamed("Approve")?.disabled).toBe(false);
  });
});

describe("the default surface is loud", () => {
  it("an out-of-surface submit logs an error and rejects — never a successful no-op", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const probe: { surface: ApprovalSurface | null } = { surface: null };
    function Probe() {
      probe.surface = useContext(ApprovalsContext);
      return null;
    }
    act(() => {
      root.render(<Probe />);
    });

    const surface = probe.surface;
    if (surface === null) {
      throw new Error("the probe never rendered");
    }
    await expect(
      surface.submitDecision(cardOf(), { approved: true }),
    ).rejects.toThrow(/the decision was NOT sent/);
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});

describe("a coworker's card", () => {
  const coworkerCard = (overrides: Partial<ApprovalCardModel> = {}) =>
    cardOf({
      interruptId: "v1:before_tool_call:cw-cancel:gate-hash",
      toolName: "action__cancel-subscription",
      prompt: 'A coworker wants to use "Cancel subscription".',
      toolCallId: "cw-run-a1-t1",
      anchored: false,
      runId: "run-dispatching",
      gated: true,
      asker: { kind: "coworker", ordinal: 3, label: "Cancel subscription 41." },
      turnId: "turn-dispatching",
      ...overrides,
    });

  it("says WHO is asking — the coworker by its brief — and keeps the sentence as the one description", () => {
    render(coworkerCard());
    expect(host.querySelector("[data-tf-approval-asker]")?.textContent).toBe(
      "Asked by a coworker — Cancel subscription 41.",
    );
    expect(host.querySelector("[data-tf-approval-prompt]")?.textContent).toBe(
      'A coworker wants to use "Cancel subscription".',
    );
    expect(host.textContent).not.toContain("subscription_id");
    // The assistant's own card carries no attribution line.
    render(cardOf());
    expect(host.querySelector("[data-tf-approval-asker]")).toBeNull();
  });

  it("offers trust for the TASK where the wire allows it, and posts the token", () => {
    const card = coworkerCard({ trustAvailable: true, gated: false });
    render(card);
    const labels = () =>
      [...host.querySelectorAll("button")].map((button) => button.textContent);
    expect(labels()).toEqual(["Approve", "Approve for this task", "Deny"]);
    act(() => {
      buttonNamed("Approve for this task")?.click();
    });
    expect(submitDecision).toHaveBeenCalledWith(card, {
      approved: true,
      trust: true,
    });
    // The gate is never trustable, from either asker; nor is a card the
    // wire did not mark.
    render(coworkerCard({ trustAvailable: true, gated: true }));
    expect(labels()).toEqual(["Approve", "Deny"]);
    render(coworkerCard({ trustAvailable: false, gated: false }));
    expect(labels()).toEqual(["Approve", "Deny"]);
  });

  it("settled trusted, the note names the coworker and its task; the assistant's names the conversation", () => {
    const trusted = {
      kind: "answered",
      approved: true,
      trusted: true,
    } as const;
    render(coworkerCard({ status: trusted }));
    expect(host.querySelector("[data-tf-approval-footer]")?.textContent).toBe(
      "Approved — the coworker won't ask about this again in this task.",
    );
    render(cardOf({ status: trusted }));
    expect(host.querySelector("[data-tf-approval-footer]")?.textContent).toBe(
      "Approved — the assistant won't ask about this again in this conversation.",
    );
  });

  it("the locked gate's note still reads on a coworker's card", () => {
    render(coworkerCard());
    expect(host.textContent).toContain("This action asks every time.");
  });

  it("speaks of the coworker when denying and once denied", () => {
    render(coworkerCard());
    act(() => {
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Deny")
        ?.click();
    });
    expect(host.querySelector("textarea")?.getAttribute("placeholder")).toBe(
      "Tell the coworker why (optional)",
    );
    render(
      coworkerCard({
        status: { kind: "answered", approved: false, trusted: false },
      }),
    );
    expect(host.textContent).toContain(
      "Not approved — the coworker has been told.",
    );
  });

  it("an approval that stopped no tool call reads 'Tool request', and a whitespace-only brief excerpts to the row's fallback noun", () => {
    render(coworkerCard({ toolName: null }));
    expect(host.textContent).toContain("Tool request");
    expect(host.querySelector("[data-tf-approval-asker]")?.textContent).toBe(
      "Asked by a coworker — Cancel subscription 41.",
    );
    render(
      coworkerCard({
        asker: { kind: "coworker", ordinal: 3, label: "   " },
      }),
    );
    expect(host.querySelector("[data-tf-approval-asker]")?.textContent).toBe(
      "Asked by a coworker — Delegated task",
    );
  });

  it("a parked coworker under an unparked parent renders the same actionable card — parked is not a rendered state", () => {
    render(coworkerCard({ parked: true }));
    const parked = host.innerHTML;
    render(coworkerCard({ parked: false }));
    expect(host.innerHTML).toBe(parked);
    expect(
      [...host.querySelectorAll("button")].map((b) => b.textContent),
    ).toEqual(["Approve", "Deny"]);
  });
});
