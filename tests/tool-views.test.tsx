// @vitest-environment jsdom
/**
 * The trusted-host tool-view registry, wired end to end (tool-views.md):
 * the provider's `toolViews` prop travels its own context into the tool
 * row's view slot; absence, an unknown key, a version mismatch, and a
 * throwing view all land on the rung below; and the package-owned
 * result evidence disclosure renders OUTSIDE the slot, where neither a
 * hostile view nor a throw can remove it.
 */
import { act, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMPLETED_TOOL_CALL } from "../fixtures/transcript/canned-data";
import { ApprovalsContext } from "../src/components/approval-context";
import { reactToolView } from "../src/components/react-tool-view";
import { SuspensionSurfaces } from "../src/components/suspension-surfaces";
import { TeaflaskAssistantProvider } from "../src/components/teaflask-assistant-provider";
import { ToolRow } from "../src/components/tool-row";
import type { ServingAssistantTurn } from "../src/contract/threads";
import { ApprovalInbox } from "../src/core/approval-inbox";
import type { ToolViewProps, ToolViewRegistry } from "../src/core/tool-view";
import type { ToolCallViewModel } from "../src/core/tool-call-display";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// MessageList's viewport (use-stick-to-bottom) observes element
// resizes; jsdom has no ResizeObserver, and this suite reads structure.
class ResizeObserverStub {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
  ResizeObserverStub;

// The provider constructs a real TokenSession; this suite never touches
// the network (the provider-appearance guard's stub, verbatim).
vi.mock("../src/transport/token-session", () => ({
  TokenSession: class {
    dispose(): void {
      // Nothing to release — the stub holds no transport.
    }
    authorizedFetch(): Promise<never> {
      return Promise.reject(
        new Error("The tool-view suite never touches the network."),
      );
    }
  },
}));

const VIEW_REF = { key: "acme.email-review", version: 1 };

/** The completed docs-search call, annotated with a view ref. */
const ANNOTATED_VIEW: ToolCallViewModel = {
  ...COMPLETED_TOOL_CALL,
  display: {
    ...COMPLETED_TOOL_CALL.display,
    view: VIEW_REF,
  },
};

const received: ToolViewProps[] = [];

// The component hard-codes its content: a registered host component
// owns its copy (the recorded call rides in props.call for hosts that
// want it — tool-views.md).
function EmailReading(props: ToolViewProps) {
  received.push(props);
  return (
    <p data-testid="email-reading">
      Review: Kettle maintenance window ({props.context.themeMode})
    </p>
  );
}

function KaboomReading(): never {
  throw new Error("acme.email-review exploded during render");
}

const REGISTRY: ToolViewRegistry = {
  "acme.email-review": { version: 1, view: reactToolView(EmailReading) },
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  received.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Async on purpose: the slot defers adapter mounts one microtask past
 *  the commit (tool-view-slot.tsx), so every flush drains microtasks. */
async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(node);
    await Promise.resolve();
  });
}

async function renderThroughProvider(
  view: ToolCallViewModel,
  registry: ToolViewRegistry | undefined,
  onError?: (error: Error) => void,
) {
  await render(
    <TeaflaskAssistantProvider
      publishableKey="pk_test_renderers"
      toolViews={registry}
      onError={onError}
    >
      <ToolRow view={view} />
    </TeaflaskAssistantProvider>,
  );
}

/** A mutable matchMedia stub: `matches` flips in place and registered
 *  change listeners can be fired, like a live OS preference toggle. */
function stubMatchMedia(initiallyDark: boolean) {
  const state = { matches: initiallyDark, listeners: [] as (() => void)[] };
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-color-scheme: dark)" && state.matches,
    addEventListener: (_type: string, listener: () => void) => {
      state.listeners.push(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      state.listeners = state.listeners.filter((held) => held !== listener);
    },
  }));
  return {
    async flipTo(dark: boolean) {
      state.matches = dark;
      await act(async () => {
        for (const listener of state.listeners) {
          listener();
        }
        await Promise.resolve();
      });
    },
  };
}

describe("the view slot through the real provider path", () => {
  it("resolves the provider-registered view and hands it exactly the bounded props", async () => {
    await renderThroughProvider(ANNOTATED_VIEW, REGISTRY);

    const slot = host.querySelector('[data-tf-tool-view="acme.email-review"]');
    expect(slot).not.toBeNull();
    // The host-view marker: the adapter's mount node carries
    // data-tf-host-view, which the stylesheet's border/box reset
    // excludes — a host utility must win on the host's own view content.
    // The computed-style proof is tests-e2e/boundary.spec.ts; this pins
    // that the REAL slot renders the marker the sheet excludes.
    expect(slot?.querySelector("[data-tf-host-view]")).not.toBeNull();
    expect(host.textContent).toContain("Review: Kettle maintenance window");
    // Exactly ToolViewProps: the recorded call plus {themeMode} —
    // nothing else rides along. No stores, no transport, no approve.
    const props = received.at(-1);
    expect(Object.keys(props ?? {}).sort()).toEqual(["call", "context"]);
    expect(Object.keys(props?.context ?? {}).sort()).toEqual(["themeMode"]);
    expect(props?.call.status).toBe("output-available");
    expect(props?.call.toolName).toBe(COMPLETED_TOOL_CALL.toolName);
    expect(props?.call.awaitingDecision).toBe(false);
    expect(props?.call.resultText).toBe(COMPLETED_TOOL_CALL.output);
    // No raw wire pane beside the custom reading: the view IS the body.
    expect(host.textContent).not.toContain("boiling water scalds the leaf");
    expect(host.querySelector("pre")).toBeNull();
  });

  it("hands the view its args without the protocol-reserved caption, identity-stable across renders", async () => {
    const argsText = JSON.stringify({
      caption: "Reviewing the maintenance email",
      subject: "Kettle maintenance window",
    });
    await renderThroughProvider({ ...ANNOTATED_VIEW, argsText }, REGISTRY);
    const first = received.at(-1)?.call.args;
    expect(first).toEqual({ subject: "Kettle maintenance window" });
    expect(first !== undefined && "caption" in first).toBe(false);
    await renderThroughProvider({ ...ANNOTATED_VIEW, argsText }, REGISTRY);
    expect(received.at(-1)?.call.args).toBe(first);
    // A caption-only argument object is the empty args, never {caption}.
    await renderThroughProvider(
      { ...ANNOTATED_VIEW, argsText: JSON.stringify({ caption: "Reviewing" }) },
      REGISTRY,
    );
    expect(received.at(-1)?.call.args).toEqual({});
  });

  it("falls back to the package default on an unknown key", async () => {
    await renderThroughProvider(
      {
        ...ANNOTATED_VIEW,
        display: {
          ...ANNOTATED_VIEW.display,
          view: { key: "acme.not-registered", version: 1 },
        },
      },
      REGISTRY,
    );
    // No host view mounted — the slot itself renders the rung-4 terminal.
    expect(
      host.querySelector("[data-tf-tool-view] [data-tf-host-view]"),
    ).toBeNull();
    expect(
      host.querySelector("[data-tf-approval-request-summary]"),
    ).not.toBeNull();
    expect(received).toEqual([]);
    expect(host.textContent).toContain("steeping sencha");
    expect(host.textContent).not.toContain("boiling water scalds the leaf");
  });

  it("falls back to the package default on a version mismatch", async () => {
    await renderThroughProvider(
      {
        ...ANNOTATED_VIEW,
        display: {
          ...ANNOTATED_VIEW.display,
          view: { key: "acme.email-review", version: 2 },
        },
      },
      REGISTRY,
    );
    // No host view mounted — the slot itself renders the rung-4 terminal.
    expect(
      host.querySelector("[data-tf-tool-view] [data-tf-host-view]"),
    ).toBeNull();
    expect(
      host.querySelector("[data-tf-approval-request-summary]"),
    ).not.toBeNull();
    expect(received).toEqual([]);
    expect(host.textContent).toContain("steeping sencha");
    expect(host.textContent).not.toContain("boiling water scalds the leaf");
  });

  it("falls back to the package default when the host registered nothing", async () => {
    await renderThroughProvider(ANNOTATED_VIEW, undefined);
    // No host view mounted — the slot itself renders the rung-4 terminal.
    expect(
      host.querySelector("[data-tf-tool-view] [data-tf-host-view]"),
    ).toBeNull();
    expect(
      host.querySelector("[data-tf-approval-request-summary]"),
    ).not.toBeNull();
    expect(received).toEqual([]);
    expect(host.textContent).toContain("steeping sencha");
    expect(host.textContent).not.toContain("boiling water scalds the leaf");
  });
});

describe("error isolation", () => {
  it("a throw from a view's self-scheduled render reaches the host's onError through the real provider path", async () => {
    // Failure census case 5 (tool-view-slot.tsx): a render the view
    // schedules for ITSELF (its own setState from a timer) commits with
    // no mount/update in flight, so the failure travels the sugar's
    // late-failure event — and the host's observer must still hear it,
    // exactly as the replaced React boundary reported any phase.
    // OUTSIDE act on purpose: mount/update-triggered effect throws
    // travel the sync path (flushSync flushes the forced work's
    // effects), so only a self-scheduled render can falsify the late
    // channel.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onError = vi.fn();
    const SelfDestruct = () => {
      const [boom, setBoom] = useState(false);
      useEffect(() => {
        const timer = setTimeout(() => {
          setBoom(true);
        }, 0);
        return () => {
          clearTimeout(timer);
        };
      }, []);
      if (boom) {
        throw new Error("late kaboom from a self-scheduled render");
      }
      return <p>looks mounted</p>;
    };
    const actFlag = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    actFlag.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      flushSync(() => {
        root.render(
          <TeaflaskAssistantProvider
            publishableKey="pk_test_renderers"
            toolViews={{
              "acme.email-review": {
                version: 1,
                view: reactToolView(SelfDestruct),
              },
            }}
            onError={onError}
          >
            <ToolRow view={ANNOTATED_VIEW} />
          </TeaflaskAssistantProvider>,
        );
      });
      for (let drain = 0; drain < 8; drain += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "late kaboom from a self-scheduled render",
        }),
      );
      // The advance landed on the slot's own terminal — the default
      // view's bounded argument reading.
      expect(
        host.querySelector(
          "[data-tf-tool-view] [data-tf-approval-request-summary]",
        ),
      ).not.toBeNull();
    } finally {
      actFlag.IS_REACT_ACT_ENVIRONMENT = true;
    }
  });

  it("isolates a throwing view: quiet fallback and raw evidence stay, the host's onError hears it", async () => {
    // The console carries React's caught-error report plus the package's
    // named line; spied so the suite output stays clean AND to assert
    // the developer-facing breadcrumb.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const onError = vi.fn();
    await renderThroughProvider(
      ANNOTATED_VIEW,
      {
        "acme.email-review": {
          version: 1,
          view: reactToolView(KaboomReading),
        },
      },
      onError,
    );

    // The transcript did not crash: the row's headline, the package
    // default view (rung 4 — the terminal the ladder lands on) AND the
    // evidence disclosure outside the slot are all still in the DOM
    // after the throw advanced the ladder.
    expect(host.textContent).toContain("Searched your docs");
    // The terminal specifically — asserted INSIDE the slot wrapper.
    const fallbackReading = host.querySelector("[data-tf-tool-view]");
    expect(
      fallbackReading?.querySelector("[data-tf-approval-request-summary]"),
    ).not.toBeNull();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "acme.email-review exploded during render",
      }),
    );
    expect(
      consoleError.mock.calls.some((call) =>
        String(call[0]).includes(
          '[teaflask-assistant] The tool view "acme.email-review" threw',
        ),
      ),
    ).toBe(true);
  });
});

describe("themeMode resolution", () => {
  // The widget-root shape (the provider's `mode` prop lands exactly
  // like this): the carrier and `data-tf-assistant` on one element.
  async function themedRender(attribute: string | null, registry = REGISTRY) {
    await render(
      <TeaflaskAssistantProvider
        publishableKey="pk_test_renderers"
        toolViews={registry}
      >
        {attribute === null ? (
          <ToolRow view={ANNOTATED_VIEW} />
        ) : (
          <div data-tf-assistant="" data-tf-theme={attribute}>
            <ToolRow view={ANNOTATED_VIEW} />
          </div>
        )}
      </TeaflaskAssistantProvider>,
    );
  }

  async function themedTree(node: React.ReactNode, registry = REGISTRY) {
    await render(
      <TeaflaskAssistantProvider
        publishableKey="pk_test_renderers"
        toolViews={registry}
      >
        {node}
      </TeaflaskAssistantProvider>,
    );
  }

  it("resolves dark from the widget root's own carrier", async () => {
    await themedRender("dark");
    expect(received.at(-1)?.context.themeMode).toBe("dark");
  });

  it("resolves dark from an ancestor carrier above a bare widget root", async () => {
    await themedTree(
      <div data-tf-theme="dark">
        <div data-tf-assistant="">
          <ToolRow view={ANNOTATED_VIEW} />
        </div>
      </div>,
    );
    expect(received.at(-1)?.context.themeMode).toBe("dark");
  });

  it("pins light on the widget root even under a dark ancestor", async () => {
    // The stylesheet's root-level light rule sits later at equal
    // specificity, so it out-cascades the ancestor's dark — the one
    // place a light pin actually wins.
    await themedTree(
      <div data-tf-theme="dark">
        <div data-tf-assistant="" data-tf-theme="light">
          <ToolRow view={ANNOTATED_VIEW} />
        </div>
      </div>,
    );
    expect(received.at(-1)?.context.themeMode).toBe("light");
  });

  it("treats an intermediate light carrier between a dark ancestor and a bare root as inert", async () => {
    // CSS ground truth: the dark rule is a descendant combinator and
    // the light counter-rule requires the attribute ON the root, so
    // this DOM paints dark — the hook must say dark, not honor the
    // nearest carrier.
    await themedTree(
      <div data-tf-theme="dark">
        <div data-tf-theme="light">
          <div data-tf-assistant="">
            <ToolRow view={ANNOTATED_VIEW} />
          </div>
        </div>
      </div>,
    );
    expect(received.at(-1)?.context.themeMode).toBe("dark");
  });

  it("treats a carrier inside the widget root as inert", async () => {
    // Tokens are computed at the root element; no stylesheet rule reads
    // a carrier below it, so this DOM paints light throughout.
    await themedTree(
      <div data-tf-assistant="" data-tf-theme="light">
        <div data-tf-theme="dark">
          <ToolRow view={ANNOTATED_VIEW} />
        </div>
      </div>,
    );
    expect(received.at(-1)?.context.themeMode).toBe("light");
  });

  it("treats an ancestor auto carrier as inert — auto binds only on the root", async () => {
    // The auto media rule is root-only; an ancestor's auto matches no
    // stylesheet rule at all, so the paint stays light even when the
    // OS prefers dark.
    stubMatchMedia(true);
    await themedTree(
      <div data-tf-theme="auto">
        <div data-tf-assistant="">
          <ToolRow view={ANNOTATED_VIEW} />
        </div>
      </div>,
    );
    expect(received.at(-1)?.context.themeMode).toBe("light");
  });

  it("resolves auto on the root through the OS preference, live across a mid-session flip", async () => {
    const media = stubMatchMedia(true);
    await themedRender("auto");
    expect(received.at(-1)?.context.themeMode).toBe("dark");

    await media.flipTo(false);
    expect(received.at(-1)?.context.themeMode).toBe("light");
  });

  it("never hands the view a light frame in a pinned-dark host", async () => {
    // The theme resolves in a LAYOUT effect (before the first paint);
    // the adapter mounts a microtask after the passive-effect commit —
    // strictly later. So the FIRST props a view ever receives must
    // already say dark: a light first delivery here means the layout
    // resolution regressed to a passive one.
    const actFlag = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    actFlag.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      flushSync(() => {
        root.render(
          <TeaflaskAssistantProvider
            publishableKey="pk_test_renderers"
            toolViews={REGISTRY}
          >
            <div data-tf-assistant="" data-tf-theme="dark">
              <ToolRow view={ANNOTATED_VIEW} />
            </div>
          </TeaflaskAssistantProvider>,
        );
      });
      // Drain the passive-effect task and the slot's mount microtask.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(received.length).toBeGreaterThan(0);
      expect(received[0]?.context.themeMode).toBe("dark");
    } finally {
      actFlag.IS_REACT_ACT_ENVIRONMENT = true;
    }
  });

  it("resolves light with no carrier and no matchMedia, without crashing", async () => {
    // Bare jsdom: no data-tf-theme anywhere and window.matchMedia is
    // absent — the painted palette is light, and the hook must say so
    // rather than throw.
    await themedRender(null);
    expect(received.at(-1)?.context.themeMode).toBe("light");
  });

  it("re-resolves live when the carrier flips through a React render (the provider mode path)", async () => {
    // The provider's `mode` prop lands as `data-tf-theme` on the widget
    // roots through a re-render — the subtree re-renders but no slot
    // remounts, so mount-time sampling alone would hold the old value.
    await themedRender("dark");
    expect(received.at(-1)?.context.themeMode).toBe("dark");

    await themedRender("light");
    // Flush the attribute observer's microtask delivery.
    await act(async () => {
      await Promise.resolve();
    });
    expect(received.at(-1)?.context.themeMode).toBe("light");
  });

  it("re-resolves live when a theme library writes the attribute imperatively (no React render)", async () => {
    // The next-themes shape: the host's theme code writes the attribute
    // on an ancestor directly — nothing in this React subtree renders,
    // so only a live subscription can see it.
    await themedRender("dark");
    expect(received.at(-1)?.context.themeMode).toBe("dark");

    const carrier = host.querySelector("[data-tf-theme]");
    expect(carrier).not.toBeNull();
    await act(async () => {
      carrier?.setAttribute("data-tf-theme", "light");
      // The observer delivers on the microtask queue; yield to it.
      await Promise.resolve();
    });
    expect(received.at(-1)?.context.themeMode).toBe("light");
  });
});

function packageApproveButton(): HTMLButtonElement {
  const approve = [...host.querySelectorAll("button")].find(
    (button) =>
      button.textContent.trim() === "Approve" &&
      button.closest("[data-tf-tool-view]") === null,
  );
  if (approve === undefined) {
    throw new Error("the package Approve button did not render");
  }
  return approve;
}

// --- the REST-recovered approval pause ---

const RECOVERED_INTERRUPT = "v1:before_tool_call:t9:handler-hash";

// No `annotated` option any more (round-2 sweep): the banner reads no
// display annotation, so the annotated/annotation-free pair this fixture
// used to pose collapsed into one turn — the wire's
// pending_approval_displays stays in the record as the shape a real
// recovery carries, exercised for ROW rendering by the transcript-rows
// and stream-resume suites.
function recoveredTurnOf(): ServingAssistantTurn {
  return {
    id: "turn-9",
    thread_id: "thread-9",
    user_message: "Reset my password.",
    kind: null,
    attachments: [],
    status: "awaiting_input",
    error: null,
    run_id: "run-9",
    pending_interrupt_ids: [RECOVERED_INTERRUPT],
    awaiting_round: 0,
    pending_approvals: [
      {
        interrupt_id: RECOVERED_INTERRUPT,
        tool_name: "reset_password",
        tool_args: { email: "visitor-7f2@example.com" },
        tool_input_schema: null,
        tool_output_schema: null,
        prompt: "Send a password reset email?",
        tool_call_id: "t9",
        round: 0,
        gated: true,
        trust_available: false,
      },
    ],
    // The wire shape verbatim: REST nulls for unauthored fields beside
    // the annotated icon token.
    pending_approval_displays: {
      t9: {
        progress_text: "Sending a password reset email…",
        complete_text: null,
        error_text: null,
        icon: "search",
        view: null,
      },
    },
    created_at: "2026-08-31T00:00:00Z",
    updated_at: "2026-08-31T00:00:00Z",
  } as unknown as ServingAssistantTurn;
}

/** The recovery seam, real units end to end — the inbox hydrates the
 *  card from the turn record and the shelf renders it. No stream
 *  delivered anything; no card is constructed by hand. (No display join
 *  feeds the recovered card — the banner reads only the card model.
 *  pending_approval_displays still hydrates the resume store for ROW
 *  rendering, covered by the transcript-rows and stream-resume tests.) */
async function renderRecoveredShelf(turn: ServingAssistantTurn) {
  const inbox = new ApprovalInbox();
  inbox.hydratePendingApprovals(turn);
  await render(
    <TeaflaskAssistantProvider publishableKey="pk_test_renderers">
      <ApprovalsContext.Provider
        value={{
          cards: inbox.cards(),
          submitDecision: () => Promise.resolve(),
        }}
      >
        <SuspensionSurfaces rowIndexByToolCallId={new Map()} />
      </ApprovalsContext.Provider>
    </TeaflaskAssistantProvider>,
  );
}

describe("the REST-recovered approval banner", () => {
  it("a row-less recovered pause still renders its banner from the turn record alone", async () => {
    await renderRecoveredShelf(recoveredTurnOf());

    // The banner rendered from the recovery payload alone: the fixed
    // consent title and the backend-authored prompt — the semantic
    // consent layer (the banner never respells a headline).
    expect(host.textContent).toContain("Send a password reset email?");
    expect(host.querySelector("[data-tf-approval-title]")?.textContent).toBe(
      "Approval required",
    );
    // Nothing argument-derived, even on the recovery path: the recovered
    // args stay off the surface (TVC-063 as amended).
    expect(host.textContent).not.toContain("visitor-7f2@example.com");
    // And the decision stays live: consent facts plus enabled controls.
    expect(packageApproveButton().disabled).toBe(false);
  });
});
