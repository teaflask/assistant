// @vitest-environment jsdom
// AssistantTranscript's agent mode: the component owns the connection —
// subscribe-then-connect, unsubscribe-then-abort — and projects the
// blocks itself, bracketed by the host's marker composite. These are
// the connection and marker laws the dashboard's transcript carried
// before the lift rewrote it as a binder over this component.

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantTranscript } from "../src/components/assistant-transcript";
import type { TranscriptMarkerProps } from "../src/components/message-list";
import { ServingReplayStreamAgent } from "../src/transport/replay-stream-agent";

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

const STREAM_URL =
  "https://api.example.test/serving/v1/assistant-threads/t-1/stream";
const STREAM_THREAD_ID = "assistant-thread-1";
const RUN_ID = "run-1";

interface Frame {
  data: Record<string, unknown>;
}

function _sseBody(frames: Frame[]): string {
  return frames
    .map((frame) => `data: ${JSON.stringify(frame.data)}\n\n`)
    .join("");
}

function _sseResponse(frames: Frame[]): Response {
  return new Response(_sseBody(frames), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function _agentOver(fetchFn: (typeof globalThis)["fetch"]) {
  return new ServingReplayStreamAgent({
    streamUrl: STREAM_URL,
    streamThreadId: STREAM_THREAD_ID,
    authorizedFetch: fetchFn,
  });
}

function _agentOf(frames: Frame[]) {
  return _agentOver(() => Promise.resolve(_sseResponse(frames)));
}

// A settled turn: streamed prose, two tool calls in their own messages
// (the wire's fan-out shape), their results, and the terminal.
function _settledTurn(): Frame[] {
  return [
    {
      data: { type: "RUN_STARTED", threadId: STREAM_THREAD_ID, runId: RUN_ID },
    },
    {
      data: {
        type: "TEXT_MESSAGE_START",
        messageId: "m-1",
        role: "assistant",
      },
    },
    {
      data: {
        type: "TEXT_MESSAGE_CONTENT",
        messageId: "m-1",
        delta: "Checking the **docs** now.",
      },
    },
    { data: { type: "TEXT_MESSAGE_END", messageId: "m-1" } },
    {
      data: {
        type: "TOOL_CALL_START",
        toolCallId: "t-1",
        toolCallName: "read_page",
      },
    },
    {
      data: {
        type: "TOOL_CALL_ARGS",
        toolCallId: "t-1",
        delta: '{"url":"https://example.test"}',
      },
    },
    { data: { type: "TOOL_CALL_END", toolCallId: "t-1" } },
    {
      data: {
        type: "TOOL_CALL_RESULT",
        messageId: "m-2",
        toolCallId: "t-1",
        content: "Page read.",
      },
    },
    {
      data: {
        type: "TOOL_CALL_START",
        toolCallId: "t-2",
        toolCallName: "docs_search",
      },
    },
    {
      data: {
        type: "TOOL_CALL_ARGS",
        toolCallId: "t-2",
        delta: '{"query":"steeping"}',
      },
    },
    { data: { type: "TOOL_CALL_END", toolCallId: "t-2" } },
    {
      data: {
        type: "TOOL_CALL_RESULT",
        messageId: "m-3",
        toolCallId: "t-2",
        content: "Found it.",
      },
    },
    {
      data: { type: "RUN_FINISHED", threadId: STREAM_THREAD_ID, runId: RUN_ID },
    },
  ];
}

// The pipeline's finalize rides a floating promise — assertions wait a
// macrotask out (and flush React's act queue around it).
async function _streamSettles(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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
  vi.restoreAllMocks();
});

async function render(node: React.ReactNode) {
  act(() => {
    root.render(node);
  });
  await _streamSettles();
}

async function unmount() {
  await act(async () => {
    root.unmount();
    await Promise.resolve();
  });
  root = createRoot(host);
}

const NOOP_ERROR = () => undefined;

describe("the replay renders the package transcript", () => {
  it("prose at top level, the settled work in one episode fold", async () => {
    const agent = _agentOf(_settledTurn());
    await render(
      <AssistantTranscript agent={agent} onStreamError={NOOP_ERROR} />,
    );

    // The markdown rendered (the ** pair became a <strong>).
    expect(host.querySelector("strong")?.textContent).toBe("docs");
    // The two calls folded into one settled episode wearing the package
    // headline (no timing anchors on this wire → the honest "Worked").
    const folds = host.querySelectorAll("[data-tf-activity-group]");
    expect(folds).toHaveLength(1);
    expect(folds[0].textContent).toContain("Worked");
    expect(folds[0].textContent).toContain("read page");
    expect(folds[0].textContent).toContain("docs search");
  });

  it("law 9: the same event history yields the same transcript", async () => {
    const first = _agentOf(_settledTurn());
    await render(
      <AssistantTranscript agent={first} onStreamError={NOOP_ERROR} />,
    );
    const firstPaint = host.innerHTML;
    expect(firstPaint).toContain("read page");

    await unmount();
    const second = _agentOf(_settledTurn());
    await render(
      <AssistantTranscript agent={second} onStreamError={NOOP_ERROR} />,
    );
    expect(host.innerHTML).toBe(firstPaint);
  });

  it("a member's denial reads not approved, never interrupted — the agent-mode ledger joins the two approval markers", async () => {
    // The wire's exact shape: the ask, the receipt recorded at the head
    // of the resumed invocation, then the resumed round's result stamped
    // `cancelled`. A surface reading only the cancel stamp would render
    // "Interrupted".
    const frames = _settledTurn();
    const afterFirstCallEnd =
      frames.findIndex(
        (frame) =>
          frame.data.type === "TOOL_CALL_END" &&
          frame.data.toolCallId === "t-1",
      ) + 1;
    frames.splice(
      afterFirstCallEnd,
      0,
      {
        data: {
          type: "CUSTOM",
          name: "approval_requested",
          value: {
            interrupt_id: "int-1",
            prompt: "Read the page?",
            tool_name: "read_page",
            tool_call_id: "t-1",
          },
        },
      },
      {
        data: {
          type: "CUSTOM",
          name: "approval_resolved",
          value: { interrupt_id: "int-1", approved: false },
        },
      },
    );
    const denied = frames.map((frame) =>
      frame.data.type === "TOOL_CALL_RESULT" && frame.data.toolCallId === "t-1"
        ? {
            data: {
              ...frame.data,
              content: "CONFIRMATION_FAILED: The user declined this action.",
              cancelled: true,
            },
          }
        : frame,
    );
    const agent = _agentOf(denied);
    await render(
      <AssistantTranscript agent={agent} onStreamError={NOOP_ERROR} />,
    );

    const marks = [...host.querySelectorAll("[data-tf-op-mark]")].map((mark) =>
      mark.getAttribute("data-tf-op-state"),
    );
    expect(marks).toEqual(["denied", "output-available"]);
    expect(host.textContent).toContain("You didn't approve read page");
    expect(host.textContent).toContain("Not approved");
    expect(host.textContent).not.toContain("Interrupted");
    expect(host.textContent).not.toContain("Didn't run");
    // The cancellation sentinel is model-facing: never a Result pane.
    expect(host.textContent).not.toContain("CONFIRMATION_FAILED");

    // The control: the same history WITHOUT the receipt is the defect
    // this state removes — the cancel stamp alone reads Interrupted.
    await unmount();
    const unreceipted = denied.filter(
      (frame) => frame.data.name !== "approval_resolved",
    );
    await render(
      <AssistantTranscript
        agent={_agentOf(unreceipted)}
        onStreamError={NOOP_ERROR}
      />,
    );
    expect(
      host.querySelector("[data-tf-op-mark]")?.getAttribute("data-tf-op-state"),
    ).toBe("cancelled");
    expect(host.textContent).toContain("Interrupted");
  });

  it("an offloaded result reads as the shortened-preview line, never as the offloader's replacement text — the agent-mode offload anchors", async () => {
    // The offloader replaces a long result with model-facing retrieval
    // guidance and stamps `offloaded` on the TOOL_CALL_RESULT. A surface
    // that dropped the stamp would render that guidance as the tool's
    // own output.
    const offloaded = _settledTurn().map((frame) =>
      frame.data.type === "TOOL_CALL_RESULT" && frame.data.toolCallId === "t-1"
        ? {
            data: {
              ...frame.data,
              content:
                "RETRIEVAL GUIDANCE: the full result is stored as ref-9.",
              offloaded: true,
            },
          }
        : frame,
    );
    await render(
      <AssistantTranscript
        agent={_agentOf(offloaded)}
        onStreamError={NOOP_ERROR}
      />,
    );
    expect(host.textContent).toContain("shortened preview");
    expect(host.textContent).not.toContain("RETRIEVAL GUIDANCE");
  });

  it("a refused result reads Declined with the door's sentence — the refused stamp survives the 1.0 client", async () => {
    // The door declined before the tool did anything and stamped `refused`
    // (never `error`) with its sentence. The 1.0 client strips the stamp
    // from the top level before any subscriber; only the transport's lift
    // keeps the row from reading as a clean success.
    const refused = _settledTurn().map((frame) =>
      frame.data.type === "TOOL_CALL_RESULT" && frame.data.toolCallId === "t-1"
        ? {
            data: {
              ...frame.data,
              content: '{"ok": false, "refused": true}',
              refused: "Refunds above the limit need a member.",
            },
          }
        : frame,
    );
    await render(
      <AssistantTranscript
        agent={_agentOf(refused)}
        onStreamError={NOOP_ERROR}
      />,
    );
    const marks = [...host.querySelectorAll("[data-tf-op-mark]")].map((mark) =>
      mark.getAttribute("data-tf-op-state"),
    );
    expect(marks).toEqual(["refused", "output-available"]);
    expect(host.textContent).toContain("Declined");
    expect(host.textContent).toContain(
      "Refunds above the limit need a member.",
    );
    expect(host.textContent).not.toContain("Interrupted");
  });

  it("StrictMode's double mount renders each row once (the dedupe)", async () => {
    const agent = _agentOf(_settledTurn());
    await render(
      <StrictMode>
        <AssistantTranscript agent={agent} onStreamError={NOOP_ERROR} />
      </StrictMode>,
    );
    const occurrences = host.textContent.split("Checking the docs now.").length;
    expect(occurrences - 1).toBe(1);
    expect(host.querySelectorAll("[data-tf-activity-group]")).toHaveLength(1);
  });
});

describe("the marker walk", () => {
  function _recordingMarkers(log: string[]) {
    return function RecordingMarkers({
      message,
      position,
    }: TranscriptMarkerProps) {
      log.push(`${message.id}:${position}`);
      return null;
    };
  }

  it("brackets every message block, before and after, in block order", async () => {
    const log: string[] = [];
    const agent = _agentOf(_settledTurn());
    await render(
      <AssistantTranscript
        agent={agent}
        onStreamError={NOOP_ERROR}
        markers={_recordingMarkers(log)}
      />,
    );
    // Every block id appears exactly twice, before then after, blocks in
    // order — row-less result messages included (markers can anchor to
    // any newest message id).
    const finalWalk = log.slice(-log.length);
    const ids = [...new Set(finalWalk.map((entry) => entry.split(":")[0]))];
    expect(ids).toEqual(["m-1", "t-1", "m-2", "t-2", "m-3"]);
    for (const id of ids) {
      expect(finalWalk).toContain(`${id}:before`);
      expect(finalWalk).toContain(`${id}:after`);
    }
  });

  it("a declared boundary splits the fold; without it the work is one fold", async () => {
    // Capture the block ids first, so the boundary targets the second
    // call's own message id without guessing the chassis' id scheme.
    const log: string[] = [];
    const first = _agentOf(_settledTurn());
    await render(
      <AssistantTranscript
        agent={first}
        onStreamError={NOOP_ERROR}
        markers={_recordingMarkers(log)}
      />,
    );
    // Negative control: with no declared boundary, one merged fold.
    expect(host.querySelectorAll("[data-tf-activity-group]")).toHaveLength(1);
    const ids = [...new Set(log.map((entry) => entry.split(":")[0]))];
    // Blocks: m-1 (prose), t-1's call message, m-2 (result), t-2's call
    // message, m-3 (result) — the second call's block is the fourth id.
    const secondCallBlockId = ids[3];

    await unmount();
    const second = _agentOf(_settledTurn());
    await render(
      <AssistantTranscript
        agent={second}
        onStreamError={NOOP_ERROR}
        markers={_recordingMarkers([])}
        markerBoundaries={{
          before: new Set([secondCallBlockId]),
          after: new Set(),
        }}
      />,
    );
    expect(host.querySelectorAll("[data-tf-activity-group]")).toHaveLength(2);
  });

  it("a throwing marker is isolated; the transcript survives", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    function HostileMarkers({ position }: TranscriptMarkerProps) {
      if (position === "before") {
        throw new Error("hostile marker");
      }
      return null;
    }
    const agent = _agentOf(_settledTurn());
    await render(
      <AssistantTranscript
        agent={agent}
        onStreamError={NOOP_ERROR}
        markers={HostileMarkers}
      />,
    );
    expect(host.textContent).toContain("Checking the docs now.");
    expect(host.querySelectorAll("[data-tf-activity-group]")).toHaveLength(1);
  });
});

describe("the delivery turn window (review round 1, finding 2)", () => {
  it("a live delivery turn never re-clusters the settled prior turn's episode", async () => {
    // The prior turn: narration, a settled call, the closing prose. Then
    // a machine-initiated delivery turn streams live (no user message,
    // no RUN_FINISHED). The host declares the delivery boundary through
    // deliveryAnchoredIds; the anchors ride in empty (the host's own
    // marker draws the divider), so only the declared turn start keeps
    // the open tail window off the settled turn.
    const encoder = new TextEncoder();
    const agent = _agentOver(() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  _sseBody([
                    {
                      data: {
                        type: "RUN_STARTED",
                        threadId: STREAM_THREAD_ID,
                        runId: RUN_ID,
                      },
                    },
                    {
                      data: {
                        type: "TEXT_MESSAGE_START",
                        messageId: "a-0",
                        role: "assistant",
                      },
                    },
                    {
                      data: {
                        type: "TEXT_MESSAGE_CONTENT",
                        messageId: "a-0",
                        delta: "Let me check.",
                      },
                    },
                    { data: { type: "TEXT_MESSAGE_END", messageId: "a-0" } },
                    {
                      data: {
                        type: "TOOL_CALL_START",
                        toolCallId: "t-1",
                        toolCallName: "read_page",
                      },
                    },
                    { data: { type: "TOOL_CALL_END", toolCallId: "t-1" } },
                    {
                      data: {
                        type: "TOOL_CALL_RESULT",
                        messageId: "m-r1",
                        toolCallId: "t-1",
                        content: "Page read.",
                      },
                    },
                    {
                      data: {
                        type: "TEXT_MESSAGE_START",
                        messageId: "a-2",
                        role: "assistant",
                      },
                    },
                    {
                      data: {
                        type: "TEXT_MESSAGE_CONTENT",
                        messageId: "a-2",
                        delta: "Done.",
                      },
                    },
                    { data: { type: "TEXT_MESSAGE_END", messageId: "a-2" } },
                    // The delivery turn's first message — still streaming,
                    // and the stream stays open (the live tail).
                    {
                      data: {
                        type: "TEXT_MESSAGE_START",
                        messageId: "d-1",
                        role: "assistant",
                      },
                    },
                    {
                      data: {
                        type: "TEXT_MESSAGE_CONTENT",
                        messageId: "d-1",
                        delta: "Delivering results now.",
                      },
                    },
                  ]),
                ),
              );
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
      ),
    );
    await render(
      <AssistantTranscript
        agent={agent}
        onStreamError={NOOP_ERROR}
        deliveryAnchoredIds={new Set(["d-1"])}
      />,
    );
    // The settled turn stays ONE unified episode with its narration
    // folded inside; without the declared turn start the tail window
    // falls back past it and the narration surfaces to top level.
    const folds = host.querySelectorAll("[data-tf-activity-group]");
    expect(folds).toHaveLength(1);
    expect(folds[0].textContent).toContain("Let me check.");
    // And the empty delivery anchors still project no divider row — the
    // host's own marker owns that pixel.
    expect(host.textContent).not.toContain("System notification");
  });
});

describe("the welcome gate", () => {
  it("withholds the welcome screen until the first snapshot, then shows it on an empty replay", async () => {
    // Still connecting: the fetch never resolves, so no snapshot lands.
    const pending = _agentOver(() => new Promise<Response>(() => undefined));
    await render(
      <AssistantTranscript
        agent={pending}
        onStreamError={NOOP_ERROR}
        welcomeScreen={<p data-host-welcome="">Recorded no activity.</p>}
      />,
    );
    expect(host.querySelector("[data-host-welcome]")).toBeNull();

    await unmount();
    // Delivered and empty: the fact is now true and renders.
    const empty = _agentOf([
      {
        data: {
          type: "RUN_STARTED",
          threadId: STREAM_THREAD_ID,
          runId: RUN_ID,
        },
      },
      {
        data: {
          type: "RUN_FINISHED",
          threadId: STREAM_THREAD_ID,
          runId: RUN_ID,
        },
      },
    ]);
    await render(
      <AssistantTranscript
        agent={empty}
        onStreamError={NOOP_ERROR}
        welcomeScreen={<p data-host-welcome="">Recorded no activity.</p>}
      />,
    );
    expect(host.querySelector("[data-host-welcome]")?.textContent).toBe(
      "Recorded no activity.",
    );
  });

  it('a live empty run shows the welcome words alone — never also "Working…"', async () => {
    // Review round 2, finding 2: the run viewer's empty streaming state
    // stacked the host's "No activity yet." over the package's standalone
    // headline — two liveness claims in one frame. The host surface owns
    // the empty frame.
    const encoder = new TextEncoder();
    const open = _agentOver(() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  _sseBody([
                    {
                      data: {
                        type: "RUN_STARTED",
                        threadId: STREAM_THREAD_ID,
                        runId: RUN_ID,
                      },
                    },
                  ]),
                ),
              );
              // Never closes — a live run that has recorded nothing yet.
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
      ),
    );
    await render(
      <AssistantTranscript
        agent={open}
        onStreamError={NOOP_ERROR}
        welcomeScreen={<p data-host-welcome="">No activity yet.</p>}
      />,
    );
    expect(host.querySelector("[data-host-welcome]")).not.toBeNull();
    expect(host.querySelector("[data-tf-working-headline]")).toBeNull();
  });
});

describe("the error tap", () => {
  it("a served RUN_ERROR reaches onStreamError", async () => {
    const onStreamError = vi.fn();
    const agent = _agentOf([
      {
        data: {
          type: "RUN_STARTED",
          threadId: STREAM_THREAD_ID,
          runId: RUN_ID,
        },
      },
      { data: { type: "RUN_ERROR", message: "The turn died mid-way." } },
    ]);
    await render(
      <AssistantTranscript agent={agent} onStreamError={onStreamError} />,
    );
    expect(onStreamError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "The turn died mid-way." }),
    );
  });

  it("a dead fetch reaches onStreamError; an abort-shaped one never does", async () => {
    const onStreamError = vi.fn();
    const dead = _agentOver(() => Promise.reject(new Error("fetch exploded")));
    await render(
      <AssistantTranscript agent={dead} onStreamError={onStreamError} />,
    );
    expect(onStreamError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "fetch exploded" }),
    );

    await unmount();
    const aborted = _agentOver(() =>
      Promise.reject(new Error("The user aborted a request.")),
    );
    const onAbortError = vi.fn();
    await render(
      <AssistantTranscript agent={aborted} onStreamError={onAbortError} />,
    );
    expect(onAbortError).not.toHaveBeenCalled();
  });

  it("the teardown's own abort never reaches the tap (unsubscribe before abort)", async () => {
    const onStreamError = vi.fn();
    // An open stream: the head lands, the tail never comes, so the
    // unmount's abort is what ends it.
    const encoder = new TextEncoder();
    const open = _agentOver(() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  _sseBody([
                    {
                      data: {
                        type: "RUN_STARTED",
                        threadId: STREAM_THREAD_ID,
                        runId: RUN_ID,
                      },
                    },
                  ]),
                ),
              );
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
      ),
    );
    await render(
      <AssistantTranscript agent={open} onStreamError={onStreamError} />,
    );
    await unmount();
    // Generous drain: the abort's synthesized terminal rides the
    // pipeline's own promise chain, several ticks past the unmount.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(onStreamError).not.toHaveBeenCalled();
  });
});
