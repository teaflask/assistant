// @vitest-environment jsdom
// The five host slots: each one filled and unfilled, the
// null-fallthrough, the throw isolation, and the mandatory frame
// elements a fill can never remove. Rows mode carries these cases — the
// slot machinery is source-mode-independent, and rows mode needs no
// stream harness (the agent-mode suite carries the connection laws).

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantTranscript } from "../src/components/assistant-transcript";
import { MessageList } from "../src/components/message-list";
import { ToolViewRegistryContext } from "../src/components/tool-view-registry-context";
import type { TranscriptSlotRow } from "../src/components/message-list";
import type { TranscriptRow } from "../src/core/transcript-rows";

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
window.HTMLElement.prototype.scrollTo = () => undefined;

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
  // The throw-isolation cases spy console.error (React logs boundary
  // catches too); restore unconditionally so one case never mutes
  // another's diagnostics.
  vi.restoreAllMocks();
});

async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(node);
    await Promise.resolve();
  });
}

const USER_ROW: TranscriptRow = {
  kind: "user",
  key: "u1",
  text: "How do I steep sencha?",
  attachments: [],
};

const PROSE_ROW: TranscriptRow = {
  kind: "assistant-text",
  key: "a1",
  text: "Use 80 degree water.",
  streaming: false,
};

const TOOL_ROW: TranscriptRow = {
  kind: "tool-call",
  key: "a2:t1",
  toolCallId: "t1",
  toolName: "docs_search",
  state: "output-error",
  argsText: '{"query":"sencha"}',
  result: "boom",
  offloaded: false,
  errorText: "The search backend failed.",
};

const GROUP_ROW: TranscriptRow = {
  kind: "subagent-group",
  key: "subagents:a3:s1",
  entries: [
    {
      toolCallId: "s1",
      receipt: null,
      label: "Audit the docs",
      running: false,
      failed: false,
      cancelled: true,
      note: null,
    },
  ],
};

const SETTLED_ASK_ROW: TranscriptRow = {
  kind: "tool-call",
  key: "a4:t9",
  toolCallId: "t9",
  toolName: "ask_user",
  state: "output-available",
  argsText: JSON.stringify({
    questions: [{ id: "q1", heading: "Region", prompt: "Which region?" }],
  }),
  result: JSON.stringify({ answers: [{ id: "q1", text: "Uji" }] }),
  offloaded: false,
  errorText: undefined,
};

const ALL_ROWS: readonly TranscriptRow[] = [USER_ROW, PROSE_ROW, TOOL_ROW];

// Every messageView-eligible kind with EVERY optional fact present — the
// pending echo, the created stamp and attachments, the provenance footer,
// the delivery results — so the parity case below exercises each frame
// element's position on both paths.
const EVERY_FACT_ROWS: readonly TranscriptRow[] = [
  {
    kind: "user",
    key: "u9",
    text: "With everything on.",
    attachments: [
      {
        id: "att-9",
        kind: "image",
        format: "png",
        filename: "cup.png",
        byte_size: 64,
      },
    ],
    createdAt: "2026-09-09T00:00:00Z",
    optimistic: true,
  },
  {
    kind: "assistant-text",
    key: "a9",
    text: "Provenance below, copy after.",
    streaming: false,
    memoryUpdates: [
      { memoryId: "mem-1", scope: "org", summary: "Remembered the region." },
    ],
  },
  GROUP_ROW,
  {
    kind: "subagent-delivery",
    key: "dl9:delivery",
    results: [{ ordinal: 1, label: "Audit the docs", succeeded: true }],
  },
  // A failed tool call, so the toolRow parity below covers the state the
  // status-word annex keys on.
  TOOL_ROW,
];

describe("the row-source union (review round 4, finding 7)", () => {
  it("MessageList demands exactly one of rows/blocks at the type level", () => {
    // Self-falsifying like the tailStart guard: if the union is ever
    // loosened back to two optionals, the expected error stops occurring
    // and tsc fails on the unused directive.
    expect(() => {
      // @ts-expect-error -- a source-less MessageList must not type-check
      return <MessageList cards={[]} />;
    }).not.toThrow();
  });
});

describe("messageView", () => {
  it("unfilled renders the package rows", async () => {
    await render(<AssistantTranscript rows={ALL_ROWS} />);
    expect(host.textContent).toContain("How do I steep sencha?");
    expect(host.textContent).toContain("Use 80 degree water.");
  });

  it("a fill replaces the row's content inside the package frame; null falls through per row", async () => {
    const fill = (row: TranscriptSlotRow) =>
      row.kind === "user" ? (
        <p data-host-user-bubble="">{row.text.toUpperCase()}</p>
      ) : null;
    await render(<AssistantTranscript rows={ALL_ROWS} messageView={fill} />);
    // The filled row: host content, package bubble gone (the fill
    // uppercases, so the original casing appearing anywhere would mean
    // the package bubble still rendered beside it).
    expect(host.querySelector("[data-host-user-bubble]")?.textContent).toBe(
      "HOW DO I STEEP SENCHA?",
    );
    expect(host.textContent).not.toContain("How do I steep sencha?");
    // …inside the frame's own wrapper (spacing stays package-owned).
    expect(
      host.querySelector("[data-host-user-bubble]")?.parentElement?.className,
    ).toContain("py-2");
    // The null-returning kinds keep the package rendering.
    expect(host.textContent).toContain("Use 80 degree water.");
  });

  it("a fill may replace the subagent group row", async () => {
    // Control first: unfilled, the package group renders its own hook —
    // so the absence assertion below is falsifiable, not vacuous.
    await render(<AssistantTranscript rows={[USER_ROW, GROUP_ROW]} />);
    expect(host.querySelector("[data-tf-subagent-group]")).not.toBeNull();
    const fill = (row: TranscriptSlotRow) =>
      row.kind === "subagent-group" ? (
        <div data-host-group="">{row.entries.length} coworkers</div>
      ) : null;
    await render(
      <AssistantTranscript rows={[USER_ROW, GROUP_ROW]} messageView={fill} />,
    );
    expect(host.querySelector("[data-host-group]")?.textContent).toBe(
      "1 coworkers",
    );
    expect(host.querySelector("[data-tf-subagent-group]")).toBeNull();
  });

  it("a null-returning fill renders byte-identically to no fill, every kind, every fact", async () => {
    // The mechanism guard for review round 1, finding 1: the slot-filled
    // and unfilled paths must be the SAME rendering with only the content
    // swapped — a re-introduced duplicated default (the class the finding
    // caught on assistant-text's footer/copy order) diverges here loudly.
    // Every messageView-eligible kind, every optional frame fact present.
    await render(<AssistantTranscript rows={EVERY_FACT_ROWS} />);
    const unfilled = host.innerHTML;
    // The facts the frame owns are actually on screen — the parity below
    // is not vacuous. The provenance footer must sit BETWEEN the prose
    // and the copy affordance (the canonical order the two paths
    // diverged on).
    expect(unfilled).toContain("data-tf-memory-footer");
    expect(unfilled).toContain("Copy message");
    expect(unfilled).toContain("data-tf-pending-echo");
    const proseRow = host.querySelector("[data-tf-agent-identity]");
    const children = [...(proseRow?.children ?? [])].map((child) =>
      child.matches("[data-tf-memory-footer]")
        ? "footer"
        : child.querySelector("[data-tf-markdown]") !== null
          ? "prose"
          : "copy",
    );
    expect(children).toEqual(["prose", "footer", "copy"]);
    await render(
      <AssistantTranscript
        rows={EVERY_FACT_ROWS}
        messageView={() => null}
        toolRow={() => null}
      />,
    );
    expect(host.innerHTML).toBe(unfilled);
  });

  it("a boolean-returning fill falls through — the cond && <X/> idiom never blanks a row", async () => {
    // Review round 4, finding 6: null, undefined, and BOTH booleans are
    // the values React renders as nothing regardless of content, so all
    // four decline the row; renderable emptiness ("") is a fill.
    const fill = (row: TranscriptSlotRow) =>
      row.kind === "user" && <p data-host-user-bubble="">bubble</p>;
    await render(<AssistantTranscript rows={ALL_ROWS} messageView={fill} />);
    expect(host.querySelector("[data-host-user-bubble]")).not.toBeNull();
    // The false arm (every non-user kind) falls through to the package
    // rendering instead of a blank row.
    expect(host.textContent).toContain("Use 80 degree water.");
    await render(
      <AssistantTranscript rows={ALL_ROWS} messageView={() => true} />,
    );
    expect(host.textContent).toContain("Use 80 degree water.");
  });

  it("an explicitly empty fill counts as filled — deliberate emptiness is not declining", async () => {
    await render(
      <AssistantTranscript
        rows={[PROSE_ROW]}
        messageView={(row) => (row.kind === "assistant-text" ? "" : null)}
      />,
    );
    // The package prose is REPLACED by the host's empty content; the
    // frame (wrapper, copy affordance) stays.
    expect(host.textContent).not.toContain("Use 80 degree water.");
    expect(host.querySelector("[data-tf-agent-identity]")).not.toBeNull();
  });

  it("a throwing fill is isolated: the package row takes over, siblings survive", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const fill = (row: TranscriptSlotRow) => {
      if (row.kind === "user") {
        throw new Error("hostile fill");
      }
      return null;
    };
    await render(<AssistantTranscript rows={ALL_ROWS} messageView={fill} />);
    // The package default replaced the throwing fill…
    expect(host.textContent).toContain("How do I steep sencha?");
    // …the rest of the transcript survived…
    expect(host.textContent).toContain("Use 80 degree water.");
    // …and the console named the slot.
    expect(
      consoleError.mock.calls.some((call) =>
        String(call[0]).includes('The host "messageView" slot threw'),
      ),
    ).toBe(true);
  });
});

describe("toolRow", () => {
  it("unfilled renders the package ToolRow", async () => {
    await render(<AssistantTranscript rows={ALL_ROWS} />);
    // The package row's own destructive-state story renders.
    expect(host.textContent).toContain("The search backend failed.");
    expect(host.querySelector("[data-tf-tool-state]")).toBeNull();
  });

  it("a fill replaces the ToolRow; the frame still states mandatory status", async () => {
    const fill = () => <div data-host-tool-row="">my quiet row</div>;
    await render(<AssistantTranscript rows={ALL_ROWS} toolRow={fill} />);
    expect(host.querySelector("[data-host-tool-row]")).not.toBeNull();
    // The frame's sr-only status word survives the fill: an errored call
    // cannot be muted by a host row.
    const stateWord = host.querySelector("[data-tf-tool-state]");
    expect(stateWord?.textContent).toBe("Failed");
    expect(stateWord?.className).toContain("sr-only");
  });

  it("a settled ask uses the host toolRow slot", async () => {
    const fill = vi.fn(() => (
      <div data-host-tool-row="">Host question view</div>
    ));
    await render(
      <AssistantTranscript rows={[USER_ROW, SETTLED_ASK_ROW]} toolRow={fill} />,
    );
    expect(host.querySelector("[data-host-tool-row]")?.textContent).toBe(
      "Host question view",
    );
    expect(fill).toHaveBeenCalledWith(
      expect.objectContaining({ row: SETTLED_ASK_ROW }),
    );
    expect(host.querySelector("[data-tf-questions-receipt]")).toBeNull();
  });

  it("a declined settled-ask slot falls back to the registered question view", async () => {
    const fill = vi.fn(() => null);
    await render(
      <AssistantTranscript rows={[USER_ROW, SETTLED_ASK_ROW]} toolRow={fill} />,
    );
    expect(fill).toHaveBeenCalled();
    expect(
      host.querySelector('[data-tf-tool-view="teaflask.questions"]'),
    ).not.toBeNull();
    expect(host.textContent).toContain("Which region?");
    expect(host.textContent).toContain("Uji");
  });

  it("a null-returning fill falls through to the package ToolRow, with no doubled status", async () => {
    // Review round 2, finding 3: the status word keys on the fill having
    // RENDERED — the fallback route carries the package pill alone, so a
    // screen reader hears the state once.
    await render(<AssistantTranscript rows={ALL_ROWS} toolRow={() => null} />);
    expect(host.textContent).toContain("The search backend failed.");
    expect(host.querySelector("[data-tf-state-pill]")?.textContent).toBe(
      "Failed",
    );
    expect(host.querySelector("[data-tf-tool-state]")).toBeNull();
  });

  it("a false-returning toolRow falls through — package row, no orphaned status word", async () => {
    // The finding's exact hazard: cond && <X/> on the toolRow seam must
    // not produce a row whose only content is the sr-only annex.
    await render(<AssistantTranscript rows={ALL_ROWS} toolRow={() => false} />);
    expect(host.textContent).toContain("The search backend failed.");
    expect(host.querySelector("[data-tf-state-pill]")?.textContent).toBe(
      "Failed",
    );
    expect(host.querySelector("[data-tf-tool-state]")).toBeNull();
  });

  it("a throwing fill is isolated: the package ToolRow takes over, with no doubled status", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fill = () => {
      throw new Error("hostile tool row");
    };
    await render(<AssistantTranscript rows={ALL_ROWS} toolRow={fill} />);
    expect(host.textContent).toContain("The search backend failed.");
    // The throw route is a fallback route too: the package pill carries
    // the status, the annex word is gone with the fill.
    expect(host.querySelector("[data-tf-tool-state]")).toBeNull();
  });

  it("a fill displaces the tool-view slot: a registered view never mounts under it", async () => {
    // The surface fact a host must be able to rely on — and the one a
    // dashboard comment got wrong: replacing the tool row replaces the
    // whole row body, ToolViewSlot included, so a rung-2 registration for
    // the tool's exact name paints nothing on a filled surface. Without
    // the fill, the identical registry mounts. (Fold grouping reads no
    // registry on any surface; the row's own resolution is asserted where
    // the tool-view laws live, not here.)
    const registry = {
      docs_search: {
        version: 1,
        view: {
          mount(container: HTMLElement) {
            const box = document.createElement("div");
            box.dataset.hostRegisteredView = "";
            container.appendChild(box);
            return {
              update: () => undefined,
              destroy: () => {
                box.remove();
              },
            };
          },
        },
      },
    };
    await render(
      <ToolViewRegistryContext.Provider value={registry}>
        <AssistantTranscript rows={ALL_ROWS} />
      </ToolViewRegistryContext.Provider>,
    );
    expect(host.querySelector("[data-host-registered-view]")).not.toBeNull();

    const fill = () => <div data-host-tool-row="">my quiet row</div>;
    await render(
      <ToolViewRegistryContext.Provider value={registry}>
        <AssistantTranscript rows={ALL_ROWS} toolRow={fill} />
      </ToolViewRegistryContext.Provider>,
    );
    expect(host.querySelector("[data-host-tool-row]")).not.toBeNull();
    expect(host.querySelector("[data-host-registered-view]")).toBeNull();
  });
});

describe("input", () => {
  it("unfilled renders nothing below the log — watch-only is the default", async () => {
    await render(<AssistantTranscript rows={ALL_ROWS} />);
    const log = host.querySelector("[data-tf-message-list]");
    expect(log?.nextElementSibling).toBeNull();
  });

  it("filled renders below the scroll viewport", async () => {
    await render(
      <AssistantTranscript
        rows={ALL_ROWS}
        input={<form data-host-composer="" />}
      />,
    );
    const log = host.querySelector("[data-tf-message-list]");
    expect(log?.nextElementSibling?.matches("[data-host-composer]")).toBe(true);
  });

  it("a throwing fill PROPAGATES — the input region is never latched away silently", async () => {
    // The input-region rule (review round 4, finding 1): the region
    // carries the surface's ability to act — on the playground the
    // approval/question decision controls render inside the composer
    // fill — so a null-fallback latch would leave a paused run that
    // looks idle and cannot be answered. The throw must reach the
    // host's own error boundary instead.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const Hostile = () => {
      throw new Error("hostile composer");
    };
    let thrown: Error | null = null;
    try {
      await render(<AssistantTranscript rows={ALL_ROWS} input={<Hostile />} />);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown?.message).toBe("hostile composer");
  });
});

describe("welcomeScreen", () => {
  it("unfilled renders nothing on an empty log", async () => {
    await render(<AssistantTranscript rows={[]} />);
    expect(host.querySelector("[data-host-welcome]")).toBeNull();
  });

  it('owns the empty frame: a live empty log shows the welcome words, never also "Working…"', async () => {
    // Review round 2, finding 2: the host's empty surface is the one
    // liveness claim in the empty frame — the standalone headline yields.
    await render(
      <AssistantTranscript
        rows={[]}
        live
        welcomeScreen={<p data-host-welcome="">Nothing yet.</p>}
      />,
    );
    expect(host.querySelector("[data-host-welcome]")).not.toBeNull();
    expect(host.querySelector("[data-tf-working-headline]")).toBeNull();
    // The in-test control: with no host surface, the empty live log keeps
    // exactly one claim — the package headline.
    await render(<AssistantTranscript rows={[]} live />);
    expect(host.querySelector("[data-tf-working-headline]")).not.toBeNull();
  });

  it("a false arm declines: the package keeps its own empty-frame claim (core/host-fill.ts)", async () => {
    // The idiomatic `welcomeScreen={flag && <Welcome />}` hands over
    // `false` on its false arm; a `!= null` gate would show a blank
    // welcome and silence the headline.
    await render(<AssistantTranscript rows={[]} live welcomeScreen={false} />);
    expect(host.querySelector("[data-tf-working-headline]")).not.toBeNull();
  });

  it("filled renders on an empty log and yields to rows", async () => {
    await render(
      <AssistantTranscript
        rows={[]}
        welcomeScreen={<p data-host-welcome="">Nothing yet.</p>}
      />,
    );
    expect(host.querySelector("[data-host-welcome]")?.textContent).toBe(
      "Nothing yet.",
    );
    await render(
      <AssistantTranscript
        rows={ALL_ROWS}
        welcomeScreen={<p data-host-welcome="">Nothing yet.</p>}
      />,
    );
    expect(host.querySelector("[data-host-welcome]")).toBeNull();
  });
});

describe("the liveness-ownership rule (review round 5, finding 2)", () => {
  it("a declared frame claim silences the standalone headline on the non-claiming-tail beat AND the empty log — one rule, both states", async () => {
    // The beat round 2 missed: a live run whose tail display row does
    // not claim (a user row). Undeclared, the package owns the claim —
    // the in-test baseline demonstrating the double-claim hazard a
    // host frame with its own live line would hit.
    const userTailBlocks = [{ messageId: "u1", rows: [USER_ROW] }];
    await render(<MessageList blocks={userTailBlocks} cards={[]} live />);
    expect(host.querySelector("[data-tf-working-headline]")).not.toBeNull();
    // Declared, the package yields on that same beat…
    await render(
      <MessageList
        blocks={userTailBlocks}
        cards={[]}
        live
        frameClaimsLiveness
      />,
    );
    expect(host.querySelector("[data-tf-working-headline]")).toBeNull();
    // …and on the empty log, from the same bypass round 2's empty-frame
    // yield now shares.
    await render(
      <MessageList blocks={[]} cards={[]} live frameClaimsLiveness />,
    );
    expect(host.querySelector("[data-tf-working-headline]")).toBeNull();
  });

  it("content liveness is unaffected — the fold's own shimmer is the row's words, not a frame claim", async () => {
    await render(
      <MessageList
        blocks={[
          {
            messageId: "a1",
            rows: [
              {
                kind: "tool-call",
                key: "a1:t1",
                toolCallId: "t1",
                toolName: "x",
                state: "input-available",
                argsText: "{}",
                result: undefined,
                offloaded: false,
                errorText: undefined,
              },
            ],
          },
        ]}
        cards={[]}
        live
        frameClaimsLiveness
      />,
    );
    // The running fold still shimmers its own headline; only the
    // STANDALONE claimants yielded.
    expect(host.querySelector("[data-tf-activity-group]")).not.toBeNull();
    expect(host.querySelector("[data-tf-working-headline]")).toBeNull();
  });
});

describe("emptyFallback honors its own contract (review round 5, finding 1)", () => {
  it("a fallback passed against a NON-empty log renders nothing — the doc's condition is the render site's", async () => {
    // Both shipping hosts gate before passing, so this pins the contract
    // for the NEXT MessageList host: a welcome surface passed
    // unconditionally must not stack above the rows.
    await render(
      <MessageList
        rows={ALL_ROWS}
        cards={[]}
        emptyFallback={<p data-host-welcome="">Nothing yet.</p>}
      />,
    );
    expect(host.querySelector("[data-host-welcome]")).toBeNull();
    expect(host.textContent).toContain("Use 80 degree water.");
    // And on a genuinely empty log it renders — the same predicate the
    // liveness arbiter's empty-frame yield reads, so the two can never
    // disagree about what is on screen.
    await render(
      <MessageList
        rows={[]}
        cards={[]}
        emptyFallback={<p data-host-welcome="">Nothing yet.</p>}
      />,
    );
    expect(host.querySelector("[data-host-welcome]")).not.toBeNull();
  });

  it("a false arm is no host surface: the standalone headline keeps the empty live frame (core/host-fill.ts)", async () => {
    await render(
      <MessageList rows={[]} cards={[]} live emptyFallback={false} />,
    );
    expect(host.querySelector("[data-tf-working-headline]")).not.toBeNull();
  });
});

describe("threadList", () => {
  it("unfilled renders no chrome region", async () => {
    await render(<AssistantTranscript rows={ALL_ROWS} />);
    expect(host.querySelector("[data-tf-transcript-chrome]")).toBeNull();
  });

  it("a false arm renders no chrome region either (core/host-fill.ts)", async () => {
    await render(<AssistantTranscript rows={ALL_ROWS} threadList={false} />);
    expect(host.querySelector("[data-tf-transcript-chrome]")).toBeNull();
  });

  it("filled renders inside the chrome region above the log", async () => {
    await render(
      <AssistantTranscript
        rows={ALL_ROWS}
        threadList={<nav data-host-threads="" />}
      />,
    );
    const chrome = host.querySelector("[data-tf-transcript-chrome]");
    expect(chrome?.querySelector("[data-host-threads]")).not.toBeNull();
    expect(chrome?.nextElementSibling?.matches("[data-tf-message-list]")).toBe(
      true,
    );
  });

  it("a throwing fill is isolated: the chrome hook leaves with it, the log survives", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const Hostile = () => {
      throw new Error("hostile chrome");
    };
    await render(
      <AssistantTranscript rows={ALL_ROWS} threadList={<Hostile />} />,
    );
    expect(host.textContent).toContain("Use 80 degree water.");
    // The host-styleable hook rides inside the boundary (round 2, finding
    // 3's keying law): no empty strip wearing host padding stays behind.
    expect(host.querySelector("[data-tf-transcript-chrome]")).toBeNull();
  });
});
