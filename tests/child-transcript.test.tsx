// @vitest-environment jsdom
/**
 * The child transcript drill-in panel: its own small driver — one
 * ServingReplayStreamAgent at the child stream URL, opened on mount (the
 * drill-in IS the stream's trigger), replaying the child's recorded
 * frames into rendered rows; the back button and Esc unmount it; the
 * unmount aborts the connection and releases the one child tail slot so
 * the next drill-in can connect.
 */
import type { Message } from "@ag-ui/core";
import { act, StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChildTranscriptPanel } from "../src/components/child-transcript";
import { SubagentCurrentWorkPublisherContext } from "../src/components/subagent-current-work";
import type { ThreadDispatch } from "../src/contract/dispatches";
import { ObservableCell } from "../src/core/observable-cell";
import type { ToolCallViewModel } from "../src/core/tool-call-display";
import type { TokenSession } from "../src/transport/token-session";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// MessageList's viewport (use-stick-to-bottom) observes element resizes;
// jsdom has no ResizeObserver, and these tests only read textContent.
class ResizeObserverStub {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
  ResizeObserverStub;

// The ledger row the panel's header reads — swapped per test. The real
// hook's demand accounting has its own tests (use-thread-dispatches);
// here the row is the input, not the machinery under test. refreshLedger
// mirrors the settle tap: it applies ledgerAfterRefresh (a settle that
// landed while the stream was watching) and re-renders, so the tests can
// drive the live-failure order the guard was written for.
const ledgerRow: { current: ThreadDispatch | undefined } = {
  current: undefined,
};
const ledgerAfterRefresh: { current: ThreadDispatch | undefined } = {
  current: undefined,
};
const refreshCalls = { count: 0 };
// A refresh is a real network read: tests of the deferred verdict give
// it a macrotask delay so it lands AFTER the end-state commits — the
// exact window where an effect-scoped guard dropped the banner forever.
const refreshDelayMs = { current: 0 };
vi.mock("../src/components/use-thread-dispatches", async () => {
  const { useCallback, useReducer } = await import("react");
  return {
    useChildDispatch: () => {
      const [, force] = useReducer((known: number) => known + 1, 0);
      const refreshLedger = useCallback(
        () =>
          new Promise<ThreadDispatch | undefined>((resolve) => {
            const land = () => {
              refreshCalls.count += 1;
              if (ledgerAfterRefresh.current !== undefined) {
                ledgerRow.current = ledgerAfterRefresh.current;
              }
              force();
              // Like the real tap: resolves with the row this read landed.
              resolve(ledgerRow.current);
            };
            if (refreshDelayMs.current > 0) {
              setTimeout(land, refreshDelayMs.current);
            } else {
              land();
            }
          }),
        [],
      );
      return { dispatch: ledgerRow.current, refreshLedger };
    },
  };
});

// The panel reads `session` and the parent store's messages (where its
// opening brief lives) from the provider seam.
const _fakeSession = {
  baseUrl: "https://api.example.test",
  authorizedFetch: (url: string, requestInit: RequestInit) =>
    _recordingFetch(url, requestInit),
} as unknown as TokenSession;
const _parentMessages = new ObservableCell<readonly Message[]>([]);
vi.mock("../src/components/teaflask-assistant-provider", () => ({
  useAssistantSession: () => ({
    session: _fakeSession,
    store: { messages: _parentMessages },
  }),
  useOptionalAssistantSession: () => ({ session: _fakeSession }),
}));

interface Frame {
  id?: string;
  data: Record<string, unknown>;
}

function _sseBody(frames: Frame[]): string {
  return frames
    .map(
      (frame) =>
        `${frame.id === undefined ? "" : `id: ${frame.id}\n`}data: ${JSON.stringify(frame.data)}\n\n`,
    )
    .join("");
}

// Every connect the panel opens, in order: the URL it dialed and the
// abort signal it handed over.
let connects: { url: string; signal: AbortSignal | null | undefined }[] = [];
let framesToServe: Frame[] = [];
// When true, connections serve their frames but the stream stays OPEN
// (a live tail): the lease is held until abort, which is what the
// waiting-state tests need a first panel to do.
let holdStreamsOpen = false;
// A countdown of connects that die on the transport (a non-abort
// rejection — the interruption banner's own wire order).
let rejectConnects = 0;
// The body serves its frames, then dies with an AbortError-named error —
// the shape @ag-ui/client turns into a synthesized RUN_ERROR coded
// "abort" (the dashboard twin's transcript test pins the same shape).
let dieWithAbortAfterFrames = false;
// The fetch honours its abort signal: a connect aborted before the
// response arrives rejects with an AbortError, as the browser's does.
let honourAbort = false;

const _SSE_HEADERS = { "content-type": "text/event-stream" };

function _recordingFetch(
  url: string,
  requestInit: RequestInit,
): Promise<Response> {
  connects.push({ url, signal: requestInit.signal });
  if (rejectConnects > 0) {
    rejectConnects -= 1;
    return Promise.reject(new Error("network down"));
  }
  const encoder = new TextEncoder();
  const frames = framesToServe;
  if (dieWithAbortAfterFrames) {
    let delivered = false;
    const dying = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (!delivered) {
          delivered = true;
          controller.enqueue(encoder.encode(_sseBody(frames)));
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        controller.error(
          new DOMException("The connection reset.", "AbortError"),
        );
      },
    });
    return Promise.resolve(
      new Response(dying, { status: 200, headers: _SSE_HEADERS }),
    );
  }
  const response = holdStreamsOpen
    ? new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(_sseBody(frames)));
            // Deliberately never closed: the tail stays live until aborted.
          },
        }),
        { status: 200, headers: _SSE_HEADERS },
      )
    : new Response(_sseBody(frames), { status: 200, headers: _SSE_HEADERS });
  if (!honourAbort) {
    return Promise.resolve(response);
  }
  const signal = requestInit.signal;
  return new Promise<Response>((resolve, reject) => {
    const abort = () => {
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve(response);
    }, 0);
  });
}

function _settledChildFrames(childSessionId: string, text: string): Frame[] {
  return [
    {
      data: { type: "RUN_STARTED", threadId: childSessionId, runId: "run-1" },
    },
    {
      id: "11",
      data: { type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" },
    },
    {
      id: "12",
      data: { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: text },
    },
    { id: "13", data: { type: "TEXT_MESSAGE_END", messageId: "m1" } },
    {
      id: "14",
      data: { type: "RUN_FINISHED", threadId: childSessionId, runId: "run-1" },
    },
  ];
}

/** A still-running child's frames: the settled replay minus its terminal. */
function _runningChildFrames(childSessionId: string, text: string): Frame[] {
  return _settledChildFrames(childSessionId, text).slice(0, -1);
}

function _dispatch(overrides: Partial<ThreadDispatch> = {}): ThreadDispatch {
  return {
    ordinal: 0,
    label: "Check the shipping policy.",
    status: "succeeded",
    error: null,
    child_session_id: "child-0",
    created_at: "2026-08-21T10:00:00Z",
    updated_at: "2026-08-21T10:00:41Z",
    ...overrides,
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  connects = [];
  framesToServe = [];
  holdStreamsOpen = false;
  rejectConnects = 0;
  dieWithAbortAfterFrames = false;
  honourAbort = false;
  ledgerRow.current = undefined;
  ledgerAfterRefresh.current = undefined;
  refreshCalls.count = 0;
  refreshDelayMs.current = 0;
  _parentMessages.set([]);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  vi.unstubAllGlobals();
});

async function _mount(
  childSessionId: string,
  onBack: () => void = () => undefined,
  opener: HTMLElement | null = null,
) {
  act(() => {
    root.render(
      <ChildTranscriptPanel
        threadId="t-1"
        childSessionId={childSessionId}
        opener={opener}
        onBack={onBack}
      />,
    );
  });
  // Let the replay drain: the agent consumes the whole SSE body and the
  // recorder publishes per applied event.
  await act(async () => {
    await Promise.resolve();
  });
}

describe("the child transcript panel", () => {
  it("dials the child stream on mount and renders the replayed transcript", async () => {
    ledgerRow.current = _dispatch();
    framesToServe = _settledChildFrames("child-0", "The policy says 30 days.");

    await _mount("child-0");

    expect(connects).toHaveLength(1);
    expect(connects[0].url).toBe(
      "https://api.example.test/serving/v1/assistant-threads/t-1/dispatches/child-0/stream",
    );
    await vi.waitFor(() => {
      expect(host.textContent).toContain("The policy says 30 days.");
    });
    // The header speaks the ledger row: label and the settled duration.
    expect(host.textContent).toContain("Check the shipping policy.");
    expect(host.textContent).toContain("Finished");
  });

  it("leads with the parent's full brief, above the child's reply", async () => {
    const brief = `List every documentation page.\n\n${"Include nested folders. ".repeat(12)}`;
    _parentMessages.set([
      {
        id: "a1",
        role: "assistant",
        toolCalls: [
          {
            id: "call-0",
            type: "function",
            function: {
              name: "dispatch_subagent",
              arguments: JSON.stringify({ task: brief }),
            },
          },
        ],
      },
      {
        id: "r1",
        role: "tool",
        toolCallId: "call-0",
        content: JSON.stringify({
          outcome: "launched",
          ordinal: 0,
          label: "List every documentation page.",
          child_session_id: "child-0",
        }),
      },
    ]);
    ledgerRow.current = _dispatch();
    framesToServe = _settledChildFrames("child-0", "There are 82 pages.");

    await _mount("child-0");

    await vi.waitFor(() => {
      expect(host.textContent).toContain("There are 82 pages.");
    });
    const text = host.textContent;
    expect(text).toContain("Include nested folders. Include nested folders.");
    expect(text.indexOf("Include nested folders.")).toBeLessThan(
      text.indexOf("There are 82 pages."),
    );
  });

  it("aborts the connection on unmount and frees the slot for the next child", async () => {
    ledgerRow.current = _dispatch();
    framesToServe = _settledChildFrames("child-0", "First child.");
    await _mount("child-0");
    const firstSignal = connects[0].signal;

    act(() => {
      root.unmount();
    });
    expect(firstSignal?.aborted).toBe(true);

    // A fresh panel for another child connects — the capacity-1 slot was
    // genuinely released, not stranded on the unmounted panel.
    root = createRoot(host);
    ledgerRow.current = _dispatch({ child_session_id: "child-1" });
    framesToServe = _settledChildFrames("child-1", "Second child.");
    await _mount("child-1");
    expect(connects).toHaveLength(2);
    expect(connects[1].url).toContain("/dispatches/child-1/stream");
  });

  it("a finished replay frees the slot: a second same-child panel connects with both mounted", async () => {
    // Two leases (per PANEL, the dashboard rows' posture), and the slot
    // returns at the STREAM'S ending, not the panel's unmount — a
    // settled replay parks the capacity-1 budget for moments, never for
    // the length of the visit.
    ledgerRow.current = _dispatch();
    framesToServe = _settledChildFrames("child-0", "Shared child.");
    await _mount("child-0");
    expect(connects).toHaveLength(1);
    await vi.waitFor(() => {
      expect(host.textContent).toContain("Shared child.");
    });

    // The first panel's replay has ended (settled frames close the
    // stream), so a second surface's panel for the SAME child gets the
    // freed slot while both stay mounted.
    const secondHost = document.createElement("div");
    document.body.appendChild(secondHost);
    const secondRoot = createRoot(secondHost);
    await act(async () => {
      secondRoot.render(
        <ChildTranscriptPanel
          threadId="t-1"
          childSessionId="child-0"
          opener={null}
          onBack={() => undefined}
        />,
      );
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(connects).toHaveLength(2);
    });
    expect(connects[1].url).toContain("/dispatches/child-0/stream");
    // The second panel genuinely replayed (its own stream, its own rows)…
    await vi.waitFor(() => {
      expect(secondHost.textContent).toContain("Shared child.");
    });
    // …and the first panel's transcript survives its released lease.
    expect(host.textContent).toContain("Shared child.");

    act(() => {
      secondRoot.unmount();
    });
    secondHost.remove();
  });

  it("a waiting panel says so, and the holder's unmount promotes it", async () => {
    // The first panel LIVE-tails (its stream never ends), so the second
    // same-child panel genuinely waits: no unexplained empty pane — a
    // sentence — and the promotion opens its own stream.
    holdStreamsOpen = true;
    ledgerRow.current = _dispatch({ status: "dispatched" });
    framesToServe = [
      {
        data: { type: "RUN_STARTED", threadId: "child-0", runId: "run-1" },
      },
      {
        id: "71",
        data: {
          type: "TEXT_MESSAGE_START",
          messageId: "m1",
          role: "assistant",
        },
      },
      {
        id: "72",
        data: {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "m1",
          delta: "Still working…",
        },
      },
    ];
    await _mount("child-0");
    expect(connects).toHaveLength(1);

    const secondHost = document.createElement("div");
    document.body.appendChild(secondHost);
    const secondRoot = createRoot(secondHost);
    await act(async () => {
      secondRoot.render(
        <ChildTranscriptPanel
          threadId="t-1"
          childSessionId="child-0"
          opener={null}
          onBack={() => undefined}
        />,
      );
      await Promise.resolve();
    });
    expect(connects).toHaveLength(1);
    expect(secondHost.textContent).toContain(
      "Waiting for another subagent view to finish…",
    );

    // The holder closes: the waiter is promoted and ITS stream opens.
    act(() => {
      root.unmount();
    });
    await vi.waitFor(() => {
      expect(connects).toHaveLength(2);
    });
    expect(connects[1].signal?.aborted).toBe(false);

    act(() => {
      secondRoot.unmount();
    });
    secondHost.remove();
    root = createRoot(host);
  });

  it("the back button and Escape both hand control back to the parent", async () => {
    ledgerRow.current = _dispatch();
    framesToServe = _settledChildFrames("child-0", "Replayed.");
    const onBack = vi.fn();
    await _mount("child-0", onBack);

    const back = host.querySelector("button");
    expect(back?.textContent).toContain("Back");
    act(() => {
      back?.click();
    });
    expect(onBack).toHaveBeenCalledTimes(1);

    const panel = host.querySelector<HTMLElement>("[data-tf-child-transcript]");
    act(() => {
      panel?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it("Escape survives a click on the panel's passive ink", async () => {
    // In a real browser, clicking non-interactive message text focuses
    // the nearest focusable ancestor — the dialog itself, via its
    // tabIndex={-1} (the roster card's posture). Without it, focus drops
    // to <body> and keydowns stop routing through the panel, so Esc goes
    // dead. jsdom doesn't run the click-focus walk, so the test drives
    // its RESULT: focus() must actually land on the panel (jsdom no-ops
    // focus() on a non-focusable div — the discriminating assertion).
    ledgerRow.current = _dispatch();
    framesToServe = _settledChildFrames("child-0", "Replayed.");
    const onBack = vi.fn();
    await _mount("child-0", onBack);

    const panel = host.querySelector<HTMLElement>("[data-tf-child-transcript]");
    act(() => {
      panel?.focus();
    });
    expect(document.activeElement).toBe(panel);
    act(() => {
      panel?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("takes focus on open and hands it back to the host-captured opener", () => {
    // The opener arrives as a PROP, captured by the host inside the
    // opening click — an effect-time activeElement read would see <body>
    // (the sibling inert commit's focus-fixup runs before any effect;
    // jsdom implements no fixup, which is exactly why the capture must
    // not live where only a real browser could falsify it).
    const opener = document.createElement("button");
    opener.textContent = "opener";
    document.body.appendChild(opener);
    ledgerRow.current = _dispatch();
    framesToServe = _settledChildFrames("child-0", "Replayed.");

    // StrictMode on purpose: the mount-cleanup-remount cycle must not
    // corrupt the restore (the first cleanup's restore may hit a
    // still-inert opener in a real browser and no-op).
    act(() => {
      root.render(
        <StrictMode>
          <ChildTranscriptPanel
            threadId="t-1"
            childSessionId="child-0"
            opener={opener}
            onBack={() => undefined}
          />
        </StrictMode>,
      );
    });
    const back = host.querySelector("button");
    expect(document.activeElement).toBe(back);

    act(() => {
      root.unmount();
    });
    expect(document.activeElement).toBe(opener);
    opener.remove();
    // afterEach unmounts again — a fresh root keeps that a no-op.
    root = createRoot(host);
  });

  it("a disconnected opener is skipped, never a crash", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    ledgerRow.current = _dispatch();
    framesToServe = _settledChildFrames("child-0", "Replayed.");

    await _mount("child-0", () => undefined, opener);
    opener.remove();
    act(() => {
      root.unmount();
    });
    expect(document.activeElement).toBe(document.body);
    root = createRoot(host);
  });

  it("an uncontended open never flashes the waiting sentence — not even pre-effect", () => {
    // The first commit lands BEFORE the passive lease effect asks the
    // pool. flushSync inside act pins exactly that window: the DOM the
    // member could paint between the commit and the effect flush — where
    // the old un-asked-lease condition showed untrue contention copy.
    ledgerRow.current = _dispatch();
    framesToServe = _settledChildFrames("child-0", "Replayed.");
    act(() => {
      flushSync(() => {
        root.render(
          <ChildTranscriptPanel
            threadId="t-1"
            childSessionId="child-0"
            opener={null}
            onBack={() => undefined}
          />,
        );
      });
      expect(host.textContent).not.toContain("Waiting for another");
    });
    expect(host.textContent).not.toContain("Waiting for another");
  });

  it("Retry into a contended pool says waiting — over the rows already replayed", async () => {
    // A transport-dropped panel keeps its replayed rows; while it shows
    // the banner, another surface's panel takes the freed slot with a
    // live tail. Retry must not go silent: the denial shows the waiting
    // sentence (messages present or not), and the banner stands down.
    ledgerRow.current = _dispatch({ status: "dispatched" });
    framesToServe = [
      {
        data: { type: "RUN_STARTED", threadId: "child-0", runId: "run-1" },
      },
      {
        id: "81",
        data: {
          type: "TEXT_MESSAGE_START",
          messageId: "m1",
          role: "assistant",
        },
      },
      {
        id: "82",
        data: {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "m1",
          delta: "Rows before the drop.",
        },
      },
      { id: "83", data: { type: "TEXT_MESSAGE_END", messageId: "m1" } },
      { id: "84", data: { type: "RUN_ERROR", message: "boom" } },
    ];
    await _mount("child-0");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(host.textContent).toContain("interrupted");
    expect(host.textContent).toContain("Rows before the drop.");

    // Another surface's panel takes the freed slot and live-tails it —
    // no terminal in ITS frames, so it holds the slot.
    holdStreamsOpen = true;
    framesToServe = [
      {
        data: { type: "RUN_STARTED", threadId: "child-0", runId: "run-2" },
      },
    ];
    const secondHost = document.createElement("div");
    document.body.appendChild(secondHost);
    const secondRoot = createRoot(secondHost);
    await act(async () => {
      secondRoot.render(
        <ChildTranscriptPanel
          threadId="t-1"
          childSessionId="child-0"
          opener={null}
          onBack={() => undefined}
        />,
      );
      await Promise.resolve();
    });

    const retry = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    );
    await act(async () => {
      retry?.click();
      await Promise.resolve();
    });
    expect(host.textContent).toContain(
      "Waiting for another subagent view to finish…",
    );
    expect(host.textContent).toContain("Rows before the drop.");
    expect(host.textContent).not.toContain("interrupted");

    act(() => {
      secondRoot.unmount();
    });
    secondHost.remove();
  });

  it("an empty ledger label falls back to the rows' own placeholder", async () => {
    // A whitespace-only task stores '' (question_excerpt_of collapses
    // it); ?? alone would blank the header the roster row promised.
    ledgerRow.current = _dispatch({ label: "" });
    framesToServe = _settledChildFrames("child-0", "Replayed.");

    await _mount("child-0");

    expect(host.textContent).toContain("Delegated task");
  });

  it("a transport drop over a dispatched row SHOWS the banner — and Retry recovers", async () => {
    // The end-state table's never-tested row: the connection dies, the
    // ledger honestly still says dispatched — the member must get the
    // interruption banner and a working Retry, not an eternal spinner.
    // The refresh is slower than the end-state commits on purpose: that
    // is the exact window where an effect-scoped guard silently dropped
    // this verdict (the stream's own ending tears the effect down).
    ledgerRow.current = _dispatch({ status: "dispatched" });
    refreshDelayMs.current = 5;
    rejectConnects = 1;

    await _mount("child-0");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect(host.textContent).toContain(
      "The connection to this subagent was interrupted.",
    );
    expect(host.textContent).toContain("Retry");
    expect(host.textContent).not.toContain("Waiting for another");

    // The network returns: Retry re-opens the end state, re-arms the
    // lease, and the fresh attempt replays.
    refreshDelayMs.current = 0;
    framesToServe = _settledChildFrames("child-0", "Recovered after retry.");
    const retry = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    );
    await act(async () => {
      retry?.click();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(host.textContent).toContain("Recovered after retry.");
    });
    expect(host.textContent).not.toContain("interrupted");
    expect(connects).toHaveLength(2);
  });

  it("a still-running child whose stream dropped keeps the interleaved chronology — no mid-flight unification", async () => {
    // The round-1 review finding 2 pose: the dispatch is RUNNING but no
    // stream is live (the body ended, the ledger honestly still says
    // dispatched). Episode unification keys on the child's TURN
    // terminality, never stream liveness — unifying here would collapse
    // the interim prose behind a fold headline and present the latest
    // paragraph as the final response, only to pop it apart on Retry.
    ledgerRow.current = _dispatch({ status: "dispatched" });
    framesToServe = [
      { data: { type: "RUN_STARTED", threadId: "child-0", runId: "run-1" } },
      {
        id: "91",
        data: {
          type: "TOOL_CALL_START",
          toolCallId: "c1",
          toolCallName: "search_docs",
          parentMessageId: "m1",
        },
      },
      {
        id: "92",
        data: { type: "TOOL_CALL_ARGS", toolCallId: "c1", delta: "{}" },
      },
      { id: "93", data: { type: "TOOL_CALL_END", toolCallId: "c1" } },
      {
        id: "94",
        data: {
          type: "TOOL_CALL_RESULT",
          messageId: "r1",
          toolCallId: "c1",
          content: "3 guides",
        },
      },
      {
        id: "95",
        data: {
          type: "TEXT_MESSAGE_START",
          messageId: "p1",
          role: "assistant",
        },
      },
      {
        id: "96",
        data: {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "p1",
          delta: "Found the guides so far.",
        },
      },
      { id: "97", data: { type: "TEXT_MESSAGE_END", messageId: "p1" } },
      {
        id: "98",
        data: {
          type: "TOOL_CALL_START",
          toolCallId: "c2",
          toolCallName: "read_page",
          parentMessageId: "m2",
        },
      },
      {
        id: "99",
        data: { type: "TOOL_CALL_ARGS", toolCallId: "c2", delta: "{}" },
      },
      { id: "9a", data: { type: "TOOL_CALL_END", toolCallId: "c2" } },
      {
        id: "9b",
        data: {
          type: "TOOL_CALL_RESULT",
          messageId: "r2",
          toolCallId: "c2",
          content: "the guide text",
        },
      },
      // No RUN_FINISHED and no RUN_ERROR: the body just ends — a closed
      // stream over a turn the ledger still calls dispatched.
    ];

    await _mount("child-0");
    await vi.waitFor(() => {
      expect(host.textContent).toContain("Found the guides so far.");
    });
    // The quiet close over a dispatched row IS the interruption banner's
    // row — with the chronology intact beneath it.
    await vi.waitFor(() => {
      expect(host.textContent).toContain(
        "The connection to this subagent was interrupted.",
      );
    });

    // The interleaved live shape holds: two per-cluster folds, the
    // interim prose a top-level row — never a narration step inside a
    // prematurely-completed episode.
    expect(
      host.querySelectorAll("[data-tf-activity-group] > details"),
    ).toHaveLength(2);
    expect(host.querySelector("[data-tf-activity-narration]")).toBeNull();
  });

  it("a failed child keeps its last words above the cut-off fold — never zero visible text", async () => {
    // The failed-dispatch equivalent of the stopped-turn breaker: the
    // child narrated, then its call died and the run errored. Settled
    // (running=false → episodes), the last prose run must stay a
    // top-level row above the trailing cut-off fold — not fold into a
    // collapsed "Worked · …" headline leaving the panel wordless.
    ledgerRow.current = _dispatch({
      status: "failed",
      error: "The coworker ran out of context.",
    });
    framesToServe = [
      { data: { type: "RUN_STARTED", threadId: "child-0", runId: "run-1" } },
      {
        id: "b1",
        data: {
          type: "TEXT_MESSAGE_START",
          messageId: "bp1",
          role: "assistant",
        },
      },
      {
        id: "b2",
        data: {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "bp1",
          delta: "Comparing the two guides now.",
        },
      },
      { id: "b3", data: { type: "TEXT_MESSAGE_END", messageId: "bp1" } },
      {
        id: "b4",
        data: {
          type: "TOOL_CALL_START",
          toolCallId: "bc1",
          toolCallName: "read_page",
          parentMessageId: "bm1",
        },
      },
      {
        id: "b5",
        data: { type: "TOOL_CALL_ARGS", toolCallId: "bc1", delta: "{}" },
      },
      { id: "b6", data: { type: "TOOL_CALL_END", toolCallId: "bc1" } },
      {
        id: "b7",
        data: { type: "RUN_ERROR", message: "ran out of context" },
      },
    ];

    await _mount("child-0");
    await vi.waitFor(() => {
      expect(host.textContent).toContain("Comparing the two guides now.");
    });

    const groups = [...host.querySelectorAll("[data-tf-activity-group]")];
    expect(groups.length).toBeGreaterThanOrEqual(1);
    const narration = host.querySelector("[data-tf-activity-narration]");
    expect(narration).toBeNull();
    const buried = groups.some((group) =>
      group.textContent.includes("Comparing the two guides now."),
    );
    expect(buried).toBe(false);
  });

  it("a child failing MID-WATCH reads failed at once, never interrupted", async () => {
    // The live-failure order the guard exists for: the drill-in opened on
    // a dispatched row, the stream then ends in RUN_ERROR — the panel
    // must catch the ledger up before judging, not wear the interruption
    // banner (and a futile Retry) for a poll tick while the header spins.
    ledgerRow.current = _dispatch({ status: "dispatched" });
    ledgerAfterRefresh.current = _dispatch({
      status: "failed",
      error:
        "This subagent failed before the run could record what went wrong.",
    });
    framesToServe = [
      {
        data: { type: "RUN_STARTED", threadId: "child-0", runId: "run-1" },
      },
      {
        id: "41",
        data: {
          type: "TEXT_MESSAGE_START",
          messageId: "m1",
          role: "assistant",
        },
      },
      {
        id: "42",
        data: {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "m1",
          delta: "Halfway through the mapping…",
        },
      },
      { id: "43", data: { type: "TEXT_MESSAGE_END", messageId: "m1" } },
      {
        id: "44",
        data: { type: "RUN_ERROR", message: "ran out of context" },
      },
    ];

    await _mount("child-0");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(refreshCalls.count).toBeGreaterThan(0);
    expect(host.textContent).toContain(
      "This subagent failed before the run could record what went wrong.",
    );
    expect(host.textContent).toContain("Failed");
    expect(host.textContent).not.toContain("Working");
    expect(host.textContent).not.toContain("interrupted");
    expect(host.textContent).not.toContain("Retry");
  });

  it("a clean mid-watch finish flips the header without waiting for the poll", async () => {
    ledgerRow.current = _dispatch({ status: "dispatched" });
    ledgerAfterRefresh.current = _dispatch({ status: "succeeded" });
    framesToServe = _settledChildFrames("child-0", "All mapped.");

    await _mount("child-0");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(refreshCalls.count).toBeGreaterThan(0);
    expect(host.textContent).toContain("Finished");
    expect(host.textContent).not.toContain("Working");
  });

  it("an errored tool call renders output-error with its sentence", async () => {
    ledgerRow.current = _dispatch();
    framesToServe = [
      {
        data: { type: "RUN_STARTED", threadId: "child-0", runId: "run-1" },
      },
      {
        id: "51",
        data: {
          type: "TOOL_CALL_START",
          toolCallId: "c1",
          toolCallName: "search_docs",
          parentMessageId: "m1",
        },
      },
      {
        id: "52",
        data: {
          type: "TOOL_CALL_ARGS",
          toolCallId: "c1",
          delta: '{"query":"kettles"}',
        },
      },
      { id: "53", data: { type: "TOOL_CALL_END", toolCallId: "c1" } },
      {
        id: "54",
        data: {
          type: "TOOL_CALL_RESULT",
          messageId: "r1",
          toolCallId: "c1",
          content: "Error: upstream timeout",
          error: "The docs index took too long to respond.",
        },
      },
      {
        id: "55",
        data: { type: "RUN_FINISHED", threadId: "child-0", runId: "run-1" },
      },
    ];

    await _mount("child-0");
    await vi.waitFor(() => {
      expect(host.textContent).toContain("search docs failed");
    });
    expect(host.textContent).toContain(
      "The docs index took too long to respond.",
    );
    expect(host.textContent).not.toContain("Ran search docs");
  });

  it("a retried child's severed call reads interrupted under the resume marker, never running", async () => {
    // Attempt 1 streams finish_with_output and dies before its RESULT;
    // the retrying activity writes run_resumed under the child's own
    // session id, then attempt 2 streams on. The severed call must not
    // read as running forever — the recorder tap must fire through the
    // replay agent, not just the parent store's pipeline.
    ledgerRow.current = _dispatch({ status: "dispatched" });
    framesToServe = [
      {
        data: { type: "RUN_STARTED", threadId: "child-0", runId: "run-1" },
      },
      {
        id: "61",
        data: {
          type: "TOOL_CALL_START",
          toolCallId: "c1",
          toolCallName: "finish_with_output",
          parentMessageId: "m1",
        },
      },
      {
        id: "62",
        data: {
          type: "TOOL_CALL_ARGS",
          toolCallId: "c1",
          delta: '{"report":"…"}',
        },
      },
      { id: "63", data: { type: "TOOL_CALL_END", toolCallId: "c1" } },
      {
        id: "64",
        data: { type: "CUSTOM", name: "run_resumed", value: { attempt: 2 } },
      },
      {
        id: "65",
        data: {
          type: "TEXT_MESSAGE_START",
          messageId: "m2",
          role: "assistant",
        },
      },
      {
        id: "66",
        data: {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "m2",
          delta: "Regenerating the report.",
        },
      },
      { id: "67", data: { type: "TEXT_MESSAGE_END", messageId: "m2" } },
      {
        id: "68",
        data: { type: "RUN_FINISHED", threadId: "child-0", runId: "run-1" },
      },
    ];

    await _mount("child-0");
    await vi.waitFor(() => {
      expect(host.textContent).toContain("Didn't finish finish with output");
    });
    expect(host.textContent).not.toContain("Running finish with output");
    expect(host.textContent).toContain("Interrupted");
    // No divider narrates the restart any more (a meta-receipt row): the
    // severed row's own state is the story.
    expect(host.textContent).not.toContain(
      "Retrying — resumed from the saved conversation",
    );
  });

  it("a settled fold reads the child's own server-derived duration", async () => {
    // The child stream's stored events carry the same emit-side server
    // timestamps as the parent's (run_event_draft_of is the one
    // persistence choke point, run_subagent included), so the drill-in
    // panel's folds reduce a real duration — the unknown register is for
    // histories that carry no timestamps, never for a live surface that
    // simply forgot to record them.
    ledgerRow.current = _dispatch();
    framesToServe = [
      {
        data: { type: "RUN_STARTED", threadId: "child-0", runId: "run-1" },
      },
      {
        id: "61",
        data: {
          type: "TOOL_CALL_START",
          toolCallId: "c1",
          toolCallName: "search_docs",
          parentMessageId: "m1",
          timestamp: 1_756_400_000_000,
        },
      },
      {
        id: "62",
        data: {
          type: "TOOL_CALL_ARGS",
          toolCallId: "c1",
          delta: '{"query":"kettles"}',
        },
      },
      {
        id: "63",
        data: {
          type: "TOOL_CALL_END",
          toolCallId: "c1",
          timestamp: 1_756_400_120_000,
        },
      },
      {
        id: "64",
        data: {
          type: "TOOL_CALL_RESULT",
          messageId: "r1",
          toolCallId: "c1",
          content: "3 results",
          timestamp: 1_756_400_289_000,
        },
      },
      {
        id: "65",
        data: {
          type: "TEXT_MESSAGE_START",
          messageId: "m2",
          role: "assistant",
        },
      },
      {
        id: "66",
        data: {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "m2",
          delta: "Kettles compared.",
        },
      },
      { id: "67", data: { type: "TEXT_MESSAGE_END", messageId: "m2" } },
      {
        id: "68",
        data: { type: "RUN_FINISHED", threadId: "child-0", runId: "run-1" },
      },
    ];

    await _mount("child-0");
    await vi.waitFor(() => {
      expect(host.textContent).toContain("Kettles compared.");
    });
    const summary = host.querySelector(
      "[data-tf-activity-group] summary",
    )?.textContent;
    expect(summary).toContain("Worked for 4m 49s");
    expect(summary).not.toMatch(/\d+\s+steps?\b/);
  });

  it("a cancelled tool call renders as never-ran, not as finished", async () => {
    ledgerRow.current = _dispatch();
    framesToServe = [
      {
        data: { type: "RUN_STARTED", threadId: "child-0", runId: "run-1" },
      },
      {
        id: "61",
        data: {
          type: "TOOL_CALL_START",
          toolCallId: "c1",
          toolCallName: "search_docs",
          parentMessageId: "m1",
        },
      },
      { id: "62", data: { type: "TOOL_CALL_END", toolCallId: "c1" } },
      {
        id: "63",
        data: {
          type: "TOOL_CALL_RESULT",
          messageId: "r1",
          toolCallId: "c1",
          content: "cancelled",
          cancelled: true,
        },
      },
      {
        id: "64",
        data: { type: "RUN_FINISHED", threadId: "child-0", runId: "run-1" },
      },
    ];

    await _mount("child-0");
    await vi.waitFor(() => {
      expect(host.textContent).toContain("Didn't run search docs");
    });
    expect(host.textContent).not.toContain("Ran search docs");
  });

  it("a failed child shows its sentence, never the interruption banner", async () => {
    // The failed child's stream honestly ENDS in RUN_ERROR — that is its
    // terminal, not a dropped connection, so no Retry may render over
    // the ledger's explanation.
    ledgerRow.current = _dispatch({
      status: "failed",
      error:
        "This subagent failed before the run could record what went wrong.",
    });
    framesToServe = [
      {
        data: { type: "RUN_STARTED", threadId: "child-0", runId: "run-1" },
      },
      {
        id: "31",
        data: {
          type: "RUN_ERROR",
          message:
            "This subagent failed before the run could record what went wrong.",
        },
      },
    ];

    await _mount("child-0");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(host.textContent).toContain(
      "This subagent failed before the run could record what went wrong.",
    );
    expect(host.textContent).not.toContain("interrupted");
    expect(host.textContent).not.toContain("Retry");
  });

  it("a failed child leads with the ledger's failure sentence", async () => {
    // The one reason to drill into a failed child is to learn why — the
    // sentence must lead the panel, not hide in a header glyph.
    ledgerRow.current = _dispatch({
      status: "failed",
      error:
        "This subagent failed before the run could record what went wrong.",
    });
    framesToServe = [
      {
        data: { type: "RUN_STARTED", threadId: "child-0", runId: "run-1" },
      },
    ];

    await _mount("child-0");

    expect(host.textContent).toContain(
      "This subagent failed before the run could record what went wrong.",
    );
    expect(host.querySelector(".tf\\:text-tf-destructive")).not.toBeNull();
  });

  it("a running child renders live and keeps the working glyph", async () => {
    ledgerRow.current = _dispatch({ status: "dispatched" });
    // A LIVE tail: the body stays open. (A body that ended without a
    // terminal is the quiet-drop row, tested below.)
    holdStreamsOpen = true;
    // No terminal in the served frames: the child is mid-run; the panel
    // still renders everything replayed so far.
    framesToServe = [
      {
        data: {
          type: "RUN_STARTED",
          threadId: "child-0",
          runId: "run-1",
        },
      },
      {
        id: "21",
        data: {
          type: "TEXT_MESSAGE_START",
          messageId: "m1",
          role: "assistant",
        },
      },
      {
        id: "22",
        data: {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "m1",
          delta: "Working on it",
        },
      },
    ];

    await _mount("child-0");

    await vi.waitFor(() => {
      expect(host.textContent).toContain("Working on it");
    });
    // The panel HEADER's own running claim, not the message text (which
    // already contains the word): the shimmering label plus the visible
    // "Working" word in the settled clock's slot — the words that
    // survive the reduced-motion collapse. The shimmer stacks its text
    // twice (base + aria-hidden highlight copy).
    const headerShimmers = [
      ...host.querySelectorAll<HTMLElement>(
        "[data-tf-child-transcript] .tf\\:border-b [data-tf-shimmer-text]",
      ),
    ];
    expect(headerShimmers).toHaveLength(2);
    expect(headerShimmers.at(-1)?.textContent).toBe("WorkingWorking");
  });

  it("publishes the newest live call through the current-work seam, and clears it when the stream leaves", async () => {
    // The PRODUCTION publisher: the open drill-in stream is the
    // current-work map's one honest writer — this drives the real
    // ChildTranscript against the real recorder, not a posed provider,
    // so a publisher that silently never engages cannot pass (the
    // no-op-coalescer lesson).
    ledgerRow.current = _dispatch({ status: "dispatched" });
    holdStreamsOpen = true;
    framesToServe = [
      { data: { type: "RUN_STARTED", threadId: "child-0", runId: "run-1" } },
      {
        id: "21",
        data: {
          type: "TOOL_CALL_START",
          toolCallId: "c1",
          toolCallName: "docs_search",
          parentMessageId: "m1",
        },
      },
      {
        id: "22",
        data: { type: "TOOL_CALL_ARGS", toolCallId: "c1", delta: "{}" },
      },
    ];
    const published: [string, ToolCallViewModel | null][] = [];
    act(() => {
      root.render(
        <SubagentCurrentWorkPublisherContext.Provider
          value={(childSessionId, view) => {
            published.push([childSessionId, view]);
          }}
        >
          <ChildTranscriptPanel
            threadId="t-1"
            childSessionId="child-0"
            opener={null}
            onBack={() => undefined}
          />
        </SubagentCurrentWorkPublisherContext.Provider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      const latest = published.at(-1);
      expect(latest?.[0]).toBe("child-0");
      expect(latest?.[1]?.toolName).toBe("docs_search");
      expect(latest?.[1]?.state).toBe("input-available");
    });
    // The panel leaving (close, settle, teardown — here the unmount arm)
    // clears its entry, so the inline line disappears with the stream.
    act(() => {
      root.render(<div />);
    });
    expect(published.at(-1)).toEqual(["child-0", null]);
  });

  // --- the quiet ending --------------------------------------------

  it("a quiet close over a dispatched row reads interrupted — and Retry recovers", async () => {
    // The body ends with no terminal while the ledger honestly still says
    // dispatched. The door only ends a child stream at a terminal, so this
    // is a dropped connection wearing a clean shape — the panel must not
    // read it "clean" (no banner, no Retry, a running child silently
    // unfollowed).
    ledgerRow.current = _dispatch({ status: "dispatched" });
    framesToServe = _runningChildFrames("child-0", "Reading the policy…");

    await _mount("child-0");
    await vi.waitFor(() => {
      expect(host.textContent).toContain(
        "The connection to this subagent was interrupted.",
      );
    });
    // The replay stands under the banner, and the ledger was consulted
    // BEFORE the verdict landed (the table's judge order).
    expect(host.textContent).toContain("Reading the policy…");
    expect(host.textContent).toContain("Retry");
    expect(refreshCalls.count).toBeGreaterThan(0);
    expect(host.textContent).not.toContain("Waiting for another");

    // Retry re-opens the end state, re-arms the lease, and a replay that
    // now carries the terminal clears the banner.
    framesToServe = _settledChildFrames("child-0", "Recovered after retry.");
    ledgerAfterRefresh.current = _dispatch({ status: "succeeded" });
    const retry = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    );
    await act(async () => {
      retry?.click();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(host.textContent).toContain("Recovered after retry.");
    });
    expect(host.textContent).not.toContain("interrupted");
    expect(connects).toHaveLength(2);
  });

  it("the quiet verdict latches: a later settle keeps the banner and Retry over the truncated replay", async () => {
    // The drop lands while the child runs; the 10s poll later finds the
    // child settled. The replay underneath is still truncated at the
    // drop, so the banner and Retry must stay — as the error ending's
    // always have — rather than un-paint into a "Finished" label over a
    // half-transcript.
    ledgerRow.current = _dispatch({ status: "dispatched" });
    framesToServe = _runningChildFrames("child-0", "Reading the policy…");

    await _mount("child-0");
    await vi.waitFor(() => {
      expect(host.textContent).toContain(
        "The connection to this subagent was interrupted.",
      );
    });

    // The poll ticks: the row now reads succeeded (the mock hook re-reads
    // the row on every render).
    ledgerRow.current = _dispatch({ status: "succeeded" });
    await _mount("child-0");

    expect(host.textContent).toContain("Finished");
    expect(host.textContent).toContain(
      "The connection to this subagent was interrupted.",
    );
    expect(host.textContent).toContain("Retry");
    expect(connects).toHaveLength(1);
  });

  it("a quiet close with an UNREAD ledger reads interrupted, never finished", async () => {
    // The catch-up lands no row — the read bounded out or failed with no
    // prior snapshot, likeliest in the very outage that dropped the
    // stream. "Not known to have settled" must read as the error ending
    // (banner + Retry), never as Finished over a replay truncated at the
    // drop: a ledger not read is not a ledger that settled.
    ledgerRow.current = undefined;
    framesToServe = _runningChildFrames("child-0", "Reading the policy…");

    await _mount("child-0");
    await vi.waitFor(() => {
      expect(host.textContent).toContain(
        "The connection to this subagent was interrupted.",
      );
    });
    expect(refreshCalls.count).toBeGreaterThan(0);
    expect(host.textContent).toContain("Reading the policy…");
    expect(host.textContent).toContain("Retry");
  });

  it("a quiet close whose ledger has settled reads finished, never interrupted", async () => {
    // The negative control for the row above: the same wire shape, but the
    // fresh ledger read says the child finished — a settled row explains a
    // quiet close by itself.
    ledgerRow.current = _dispatch({ status: "dispatched" });
    ledgerAfterRefresh.current = _dispatch({ status: "succeeded" });
    framesToServe = _runningChildFrames("child-0", "Reading the policy…");

    await _mount("child-0");
    await vi.waitFor(() => {
      expect(host.textContent).toContain("Finished");
    });
    expect(refreshCalls.count).toBeGreaterThan(0);
    expect(host.textContent).toContain("Reading the policy…");
    expect(host.textContent).not.toContain("interrupted");
    expect(host.textContent).not.toContain("Working");
  });

  it("the chassis' synthesized abort RUN_ERROR is never this stream's verdict — the ledger judges it", async () => {
    // A body dying with an AbortError-named error makes @ag-ui/client
    // synthesize RUN_ERROR {code: "abort"}. The door never sets a code, so
    // it is no served terminal: the error leg would have painted the
    // banner over ANY non-failed row; the quiet judge asks the ledger,
    // which says settled — so nothing is painted.
    ledgerRow.current = _dispatch({ status: "dispatched" });
    ledgerAfterRefresh.current = _dispatch({ status: "succeeded" });
    framesToServe = _runningChildFrames("child-0", "Reading the policy…");
    dieWithAbortAfterFrames = true;

    await _mount("child-0");
    await vi.waitFor(() => {
      expect(host.textContent).toContain("Finished");
    });
    expect(refreshCalls.count).toBeGreaterThan(0);
    expect(host.textContent).not.toContain("interrupted");
  });

  it("a torn-down predecessor never judges its successor's live stream", async () => {
    // An effect re-run (here a thread switch on the same child) aborts the
    // first agent, and the chassis resolves an aborted connect CLEANLY (it
    // swallows AbortError). Without the effect-scoped `torn` guard that
    // resolution landed "clean" on the panel, releasing the lease under
    // the successor's live tail — a running child silently unfollowed.
    ledgerRow.current = _dispatch({ status: "dispatched" });
    holdStreamsOpen = true;
    honourAbort = true;
    framesToServe = _runningChildFrames("child-0", "Reading the policy…");

    await _mount("child-0");
    act(() => {
      root.render(
        <ChildTranscriptPanel
          threadId="t-2"
          childSessionId="child-0"
          opener={null}
          onBack={() => undefined}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    await vi.waitFor(() => {
      expect(host.textContent).toContain("Reading the policy…");
    });
    // The predecessor was aborted; the survivor was not, and stays live.
    expect(connects).toHaveLength(2);
    expect(connects[0]?.signal?.aborted).toBe(true);
    expect(connects[1]?.signal?.aborted).toBe(false);
    expect(host.textContent).not.toContain("interrupted");
    expect(host.textContent).toContain("Working");
  });
});

// The accessible-name sweep, extended to this surface's two mark
// mounts (the panel header and the preview header): the identity
// mark's visible-or-sr text must never become part of a
// name-from-contents control's accessible name — here the marks ride
// plain layout spans in labelled-dialog headers, outside any control.
describe("the identity mark stays outside name-from-contents controls", () => {
  it("the panel header's mark encloses no button, summary, or link", async () => {
    ledgerRow.current = _dispatch();
    framesToServe = _settledChildFrames("child-0", "The policy says 30 days.");
    await _mount("child-0");
    const marks = host.querySelectorAll("[data-tf-agent-mark]");
    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) {
      expect(
        mark.closest(
          'button, summary, a[href], [role="button"], [role="link"], [role="menuitem"]',
        ),
      ).toBeNull();
    }
  });
});
