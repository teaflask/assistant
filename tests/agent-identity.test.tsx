// @vitest-environment jsdom
// The identity-token surface law behind TVC-091 (round-1 review,
// finding 1): MessageList renders MORE than the primary transcript —
// child-transcript.tsx mounts it over a COWORKER's stream for the
// drill-in panel and the hover preview — so the token on assistant
// prose must be the SURFACE's, never a constant baked into the row. A
// child transcript's prose wearing data-tf-agent-identity="teaflask"
// would present the coworker's words as the primary agent's, exactly
// what law 10 forbids.

import type { Message } from "@ag-ui/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PRIMARY_AGENT_IDENTITY_TOKEN,
  subagentIdentityTokenOf,
} from "../src/core/agent-identity";
import type { MarkerAnchorsSnapshot } from "../src/core/connection-epoch";
import { transcriptRowsOf } from "../src/core/transcript-rows";
import { AgentIdentityMark } from "../src/components/agent-identity-mark";
import { MessageList } from "../src/components/message-list";
import { ChildTranscriptPreviewFrame } from "../src/components/child-transcript";
import { SubagentCountPill } from "../src/components/subagent-count-pill";
import { SubagentDrillInContext } from "../src/components/subagent-drill-in";
import {
  SubagentDispatchesContext,
  SubagentGroupRow,
} from "../src/components/subagent-group-row";
import { accessibleNameOf } from "../src/reader/accessible-name";
import { fakeLayoutProbeOf } from "./reader-fakes";

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

const CHILD_MESSAGES: Message[] = [
  { id: "cu1", role: "user", content: "Check the descaling instructions." },
  { id: "ca1", role: "assistant", content: "The ratio still matches." },
];

describe('AgentIdentityMark size="fill"', () => {
  it("widens the wrapper to the parent's box instead of the glyph", () => {
    act(() => {
      root.render(<AgentIdentityMark register="primary" size="fill" />);
    });
    const wrapper = host.querySelector('[data-tf-agent-mark="primary"]');
    const svg = wrapper?.querySelector("svg");
    expect(wrapper?.classList.contains("tf:size-full")).toBe(true);
    expect(wrapper?.classList.contains("tf:w-fit")).toBe(false);
    expect(svg?.classList.contains("tf:size-full")).toBe(true);
  });

  it("leaves the sm register fit-content, as every row caller relies on", () => {
    act(() => {
      root.render(<AgentIdentityMark register="primary" size="sm" />);
    });
    const wrapper = host.querySelector('[data-tf-agent-mark="primary"]');
    expect(wrapper?.classList.contains("tf:w-fit")).toBe(true);
    expect(wrapper?.classList.contains("tf:size-full")).toBe(false);
    expect(
      wrapper?.querySelector("svg")?.classList.contains("tf:size-3.5"),
    ).toBe(true);
  });
});

describe("MessageList identity token (law 10)", () => {
  it("assistant prose wears the primary token by default", () => {
    act(() => {
      root.render(
        <MessageList
          rows={transcriptRowsOf(CHILD_MESSAGES, EMPTY_ANCHORS, false)}
          cards={[]}
        />,
      );
    });
    const marks = [...host.querySelectorAll("[data-tf-agent-identity]")];
    expect(marks).toHaveLength(1);
    expect(marks[0]?.getAttribute("data-tf-agent-identity")).toBe(
      PRIMARY_AGENT_IDENTITY_TOKEN,
    );
  });

  it("a child transcript's prose wears the coworker's token — never the primary's", () => {
    const childToken = subagentIdentityTokenOf("child-session-1");
    act(() => {
      root.render(
        <MessageList
          rows={transcriptRowsOf(CHILD_MESSAGES, EMPTY_ANCHORS, false)}
          cards={[]}
          identityToken={childToken}
        />,
      );
    });
    const marks = [...host.querySelectorAll("[data-tf-agent-identity]")];
    expect(marks).toHaveLength(1);
    expect(marks[0]?.getAttribute("data-tf-agent-identity")).toBe(childToken);
    // The primary token appears NOWHERE on a coworker's surface.
    expect(
      host.querySelector(
        `[data-tf-agent-identity="${PRIMARY_AGENT_IDENTITY_TOKEN}"]`,
      ),
    ).toBeNull();
  });

  it("folded narration wears the surface's token, asserted on the narration node itself", () => {
    // The round-1 review finding 1 pose, updated for the round-2 law
    // (each span's LAST prose run stays outside, so every span holding
    // narration also shows a top-level prose row): the class-breaker is
    // now a narration step whose OWN token is absent or wrong while the
    // top-level row's is fine — so the assertion reads the narration
    // node directly, never just "some mark exists on the page".
    const childToken = subagentIdentityTokenOf("child-session-1");
    const withNarration: Message[] = [
      { id: "fu1", role: "user", content: "Check the guides." },
      { id: "fp0", role: "assistant", content: "Checking the guides now." },
      {
        id: "fa1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "ft1",
            type: "function",
            function: { name: "docs_search", arguments: "{}" },
          },
        ],
      },
      { id: "fr1", role: "tool", toolCallId: "ft1", content: "3 guides" },
      { id: "fp1", role: "assistant", content: "They all match." },
    ];
    act(() => {
      root.render(
        <MessageList
          rows={transcriptRowsOf(withNarration, EMPTY_ANCHORS, false)}
          cards={[]}
          identityToken={childToken}
        />,
      );
    });
    const narration = host.querySelector("[data-tf-activity-narration]");
    expect(narration?.textContent).toContain("Checking the guides now.");
    expect(narration?.getAttribute("data-tf-agent-identity")).toBe(childToken);
    // Both prose homes carry the coworker's token; the primary token
    // appears nowhere on a coworker's surface.
    const marks = [...host.querySelectorAll("[data-tf-agent-identity]")];
    expect(marks).toHaveLength(2);
    for (const mark of marks) {
      expect(mark.getAttribute("data-tf-agent-identity")).toBe(childToken);
    }
    expect(
      host.querySelector(
        `[data-tf-agent-identity="${PRIMARY_AGENT_IDENTITY_TOKEN}"]`,
      ),
    ).toBeNull();
  });
});

// The accessible-name sweep: the mark deliberately carries visible-or-sr
// identity text, so any CONTROL whose accessible name is computed from
// contents would absorb "Subagent" / "TeaFlask" into its name — the
// frontend fork's group trigger shipped exactly that regression. The law
// made executable: every mounted mark either sits outside
// name-from-contents controls, or its enclosing control carries an
// explicit label that masks contents. Names are COMPUTED with the
// package's own accname implementation, never read off the JSX.
describe("the identity mark never leaks into a control's accessible name", () => {
  function controlOf(mark: Element): Element | null {
    return mark.closest(
      'button, summary, a[href], [role="button"], [role="link"], [role="menuitem"]',
    );
  }

  function sweptNamesOf(rootEl: HTMLElement): Map<Element, string> {
    const probe = fakeLayoutProbeOf();
    const cache = new Map<Element, string>();
    const names = new Map<Element, string>();
    const marks = rootEl.querySelectorAll("[data-tf-agent-mark]");
    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) {
      const control = controlOf(mark);
      if (control === null) {
        continue;
      }
      expect(
        control.hasAttribute("aria-label") ||
          control.hasAttribute("aria-labelledby"),
        "a mark inside a name-from-contents control must be masked by an explicit label",
      ).toBe(true);
      names.set(control, accessibleNameOf(control, probe, cache));
    }
    return names;
  }

  it("ordinary prose carries provenance without a decorative logo", () => {
    const rows = transcriptRowsOf(CHILD_MESSAGES, EMPTY_ANCHORS, false);
    act(() => {
      root.render(<MessageList rows={rows} cards={[]} />);
    });
    const marks = host.querySelectorAll("[data-tf-agent-mark]");
    expect(marks).toHaveLength(0);
    expect(host.querySelectorAll("[data-tf-agent-identity]")).toHaveLength(1);
  });

  it("the pill trigger and roster: every enclosing control is explicitly labelled, and the computed names are the labels", () => {
    // SHIPPING configuration (round-3 finding: the first version of this
    // test rendered no threadId, so every roster row fell into the
    // passive-span branch and the "roster" half passed vacuously) —
    // transcript.tsx always passes threadId, which makes each roster row
    // a previewable TfButton wrapping the identity mark.
    act(() => {
      root.render(
        <SubagentCountPill
          threadId="thread-0"
          dispatches={
            new Map([
              [
                0,
                {
                  ordinal: 0,
                  label: "Survey the corpus.",
                  status: "succeeded",
                  error: null,
                  summary: "Found 12 stale pages.",
                  child_session_id: "child-0",
                  created_at: "2026-08-21T10:00:00Z",
                  updated_at: "2026-08-21T10:00:41Z",
                },
              ],
              [
                1,
                {
                  ordinal: 1,
                  label: "Map the auth flows.",
                  status: "failed",
                  error: "The coworker ran out of context.",
                  child_session_id: "child-1",
                  created_at: "2026-08-21T10:00:00Z",
                  updated_at: "2026-08-21T10:02:30Z",
                },
              ],
            ])
          }
        />,
      );
    });
    const trigger = host.querySelector("button");
    if (trigger === null) {
      throw new Error("the pill trigger did not render");
    }
    act(() => {
      trigger.dispatchEvent(
        new PointerEvent("pointerover", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
    });
    const names = sweptNamesOf(document.body);
    // Three mark-carrying controls in the shipping shape: the trigger and
    // both roster preview buttons. Every name is an explicit label —
    // headline words and the row's composed facts, never a bare identity
    // word glued to a label — and the label re-speaks EVERYTHING the row
    // says: compact success rows stop at task, status, and duration,
    // while a failed row's visible reason must not go silent under the
    // mask.
    const nameList = [...names.values()];
    expect(nameList).toContain("Subagents: 2 subagents · 1 failed");
    expect(
      nameList.some(
        (name) =>
          name.includes("Survey the corpus. — Finished") &&
          !name.includes("Found 12 stale pages."),
      ),
      "the settled row's name stays compact",
    ).toBe(true);
    expect(
      nameList.some(
        (name) =>
          name.includes("Map the auth flows. — Failed") &&
          name.endsWith("— The coworker ran out of context."),
      ),
      "the failed row's name carries its reason",
    ).toBe(true);
    for (const name of nameList) {
      expect(/^Subagent[A-Z]/.test(name)).toBe(false);
    }
  });

  it("the preview frame's header mark encloses no control", () => {
    act(() => {
      root.render(
        <ChildTranscriptPreviewFrame
          label="Check the descaling instructions."
          status="finished"
          duration="3m 04s"
        >
          <p>body</p>
        </ChildTranscriptPreviewFrame>,
      );
    });
    const marks = host.querySelectorAll("[data-tf-agent-mark]");
    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) {
      expect(controlOf(mark)).toBeNull();
    }
  });

  it("the delegation group: identity decoration stays hidden from control names", () => {
    // SHIPPING shape: the drill-in context is provided (transcript.tsx
    // provides it wherever the group renders), so the label-button
    // affordance is genuinely in the tree beside the mark.
    act(() => {
      root.render(
        <SubagentDrillInContext.Provider
          value={{
            openChildSessionId: null,
            previewId: "sweep-preview",
            open: () => undefined,
            dismiss: () => undefined,
          }}
        >
          <SubagentDispatchesContext.Provider
            value={{
              byOrdinal: new Map([
                [
                  0,
                  {
                    ordinal: 0,
                    label: "Survey the corpus.",
                    status: "succeeded",
                    error: null,
                    child_session_id: "child-0",
                    created_at: "2026-08-21T10:00:00Z",
                    updated_at: "2026-08-21T10:00:41Z",
                  },
                ],
              ]),
            }}
          >
            <SubagentGroupRow
              row={{
                kind: "subagent-group",
                key: "subagents:c1",
                entries: [
                  {
                    toolCallId: "c1",
                    receipt: {
                      outcome: "launched",
                      ordinal: 0,
                      label: "Survey the corpus.",
                      childSessionId: "child-0",
                      settled: null,
                    },
                    label: "Survey the corpus.",
                    running: false,
                    failed: false,
                    cancelled: false,
                    note: null,
                  },
                ],
              }}
            />
          </SubagentDispatchesContext.Provider>
        </SubagentDrillInContext.Provider>,
      );
    });
    // The drill-in affordance genuinely rendered (anti-vacuity), and the
    // marks still sit outside it.
    expect(host.querySelector('[aria-haspopup="dialog"]')).not.toBeNull();
    const marks = host.querySelectorAll("[data-tf-agent-mark]");
    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) {
      if (controlOf(mark)) {
        expect(mark.closest('[aria-hidden="true"]')).not.toBeNull();
      } else {
        expect(controlOf(mark)).toBeNull();
      }
    }
  });
});
