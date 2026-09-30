// @vitest-environment jsdom
// The consent doctrine as an executable sentence: the banner asks one
// question and carries nothing argument-derived, and that is SAFE
// because informed consent is carried by the transcript row, which a
// pending decision always opens (the placement guarantee). This file
// joins the three halves in ONE mount — row open, the call's arguments
// visible on the row, the banner argument-free — so neither half can
// silently regress while its own suite stays green: the row-open pins
// alone (tool-row-states.test.tsx) don't know the banner went
// argument-free, and the banner pins alone (approval-card.test.tsx,
// TVC-063) don't know the row is showing the request.

import type { Message } from "@ag-ui/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MessageList } from "../src/components/message-list";
import type { ApprovalCardModel } from "../src/core/approval-inbox";
import type { MarkerAnchorsSnapshot } from "../src/core/connection-epoch";
import { transcriptRowsOf } from "../src/core/transcript-rows";

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

const EMPTY_ANCHORS: MarkerAnchorsSnapshot = {
  resumeAnchors: new Map(),
  turnFailedAnchors: new Map(),
  subagentDeliveryAnchors: new Map(),
  toolRefusalAnchors: new Map(),
  toolErrorAnchors: new Map(),
  toolCancelAnchors: new Set(),
  toolOffloadAnchors: new Set(),
  toolCallDisplayAnchors: new Map(),
  toolSchemaAnchors: new Map(),
  blockTimingAnchors: new Map(),
  turnUsageAnchors: new Map(),
  memoryProvenanceAnchors: new Map(),
  memoryAttributionAnchors: new Map(),
};

// An argument-bearing call, paused on the member: the arguments carry a
// sentinel value the test can look for on each surface.
const PAUSED_MESSAGES: Message[] = [
  { id: "u1", role: "user", content: "File the kettle ticket." },
  {
    id: "a1",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "t1",
        type: "function",
        function: {
          name: "action__create-support-ticket",
          arguments: JSON.stringify({
            path: "/tickets",
            title: "Kettle whistles in B minor",
          }),
        },
      },
    ],
  },
];

const PENDING_CARD: ApprovalCardModel = {
  interruptId: "consent-placement-ask",
  toolName: "action__create-support-ticket",
  toolArgs: {
    path: "/tickets",
    title: "Kettle whistles in B minor",
  },
  toolInputSchema: null,
  toolOutputSchema: null,
  prompt: "The assistant wants to create a support ticket.",
  toolCallId: "t1",
  anchored: true,
  round: 0,
  runId: "run-consent",
  parked: false,
  gated: false,
  trustAvailable: false,
  asker: { kind: "assistant" },
  turnId: null,
  status: { kind: "actionable", errorSentence: null },
};

describe("informed consent is carried by the row", () => {
  it("a pending decision's row is open and showing the call while the banner beside it carries no arguments", () => {
    act(() => {
      root.render(
        <MessageList
          rows={transcriptRowsOf(PAUSED_MESSAGES, EMPTY_ANCHORS, false)}
          cards={[PENDING_CARD]}
        />,
      );
    });

    // 1. The pending decision opened its call's row — resolved by the
    //    same identity hook the banner's Show-request affordance uses.
    const row = host.querySelector<HTMLDetailsElement>(
      '[data-tf-tool-call-id="t1"]',
    );
    expect(row).not.toBeNull();
    expect(row?.open).toBe(true);

    // 2. The open row is SHOWING the call: the argument values are on
    //    screen, in the row's bounded argument reading (rung 4).
    expect(
      row?.querySelector("[data-tf-approval-request-summary]"),
    ).not.toBeNull();
    expect(row?.textContent).toContain("/tickets");
    expect(row?.textContent).toContain("Kettle whistles in B minor");

    // 3. The banner beside it asks its one question and carries nothing
    //    argument-derived — consent is informed by the row, not by the
    //    banner (TVC-063 as amended).
    const banner = host.querySelector<HTMLElement>("[data-tf-approval-card]");
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain(
      "The assistant wants to create a support ticket.",
    );
    expect(banner?.textContent).not.toContain("/tickets");
    expect(banner?.textContent).not.toContain("Kettle whistles in B minor");
    expect(banner?.querySelector("pre")).toBeNull();
  });
});
