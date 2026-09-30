import { AGUIError, EventType } from "@ag-ui/core";
import { describe, expect, it, vi } from "vitest";

import { streamFailureClassOf } from "../src/contract/telemetry";
import { ServingReplayStreamAgent } from "../src/transport/replay-stream-agent";

// Content for a message the client never opened — the server-side head
// clip once simulated here as a REASONING_MESSAGE_CONTENT between
// REASONING_START and REASONING_MESSAGE_START — is refused by the 1.0
// client's verifier before any subscriber hook runs (0.0.59 dropped it
// with a console.warn and carried on, which is why a detector once sat
// on the generic onEvent hook). The run fails with the client's own
// AGUIError, filed as parse_or_validation, and the applied transcript
// holds nothing past the refusal. Every valid, well-ordered stream — the
// negative control — settles and applies exactly as before.
describe("orphan content on the real pipeline", () => {
  const STREAM_URL =
    "https://api.example.test/serving/v1/assistant-threads/t-1/stream";

  function sseBody(frames: Record<string, unknown>[]): string {
    return frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("");
  }

  async function runThrough(frames: Record<string, unknown>[]) {
    const agent = new ServingReplayStreamAgent({
      streamUrl: STREAM_URL,
      streamThreadId: "assistant-thread-1",
      authorizedFetch: () =>
        Promise.resolve(
          new Response(sseBody(frames), {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        ),
    });
    const failures: Error[] = [];
    const contentSeenByHooks: string[] = [];
    agent.subscribe({
      onRunFailed({ error }) {
        failures.push(error);
      },
      onEvent({ event }) {
        if (
          event.type === EventType.TEXT_MESSAGE_CONTENT ||
          event.type === EventType.REASONING_MESSAGE_CONTENT ||
          event.type === EventType.TOOL_CALL_ARGS
        ) {
          contentSeenByHooks.push(event.type);
        }
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let warned: unknown[][] = [];
    try {
      await agent.connectAgent().catch(() => undefined);
    } finally {
      warned = [...warn.mock.calls];
      warn.mockRestore();
    }
    const reasoning = agent.messages.find((message) => message.id === "r-1");
    return {
      reasoningText: reasoning?.content,
      warned,
      failure: failures.at(0),
      contentSeenByHooks,
    };
  }

  const run = {
    type: "RUN_STARTED",
    threadId: "assistant-thread-1",
    runId: "run-1",
  };
  const done = {
    type: "RUN_FINISHED",
    threadId: "assistant-thread-1",
    runId: "run-1",
  };
  const start = { type: "REASONING_START", messageId: "r-1" };
  const messageStart = {
    type: "REASONING_MESSAGE_START",
    messageId: "r-1",
    role: "reasoning",
  };
  const head = {
    type: "REASONING_MESSAGE_CONTENT",
    messageId: "r-1",
    delta: "Track 3 got",
  };
  const tail = {
    type: "REASONING_MESSAGE_CONTENT",
    messageId: "r-1",
    delta: " clipped too",
  };
  const messageEnd = { type: "REASONING_MESSAGE_END", messageId: "r-1" };
  const end = { type: "REASONING_END", messageId: "r-1" };

  it("the verifier refuses a reasoning head delivered between the two starts — one AGUIError, filed parse_or_validation, before any hook", async () => {
    const { reasoningText, failure, contentSeenByHooks } = await runThrough([
      run,
      start,
      head, // the server-side head clip, on the wire
      messageStart,
      tail,
      messageEnd,
      end,
      done,
    ]);
    expect(failure).toBeInstanceOf(AGUIError);
    if (failure === undefined) {
      throw new Error("the run did not fail");
    }
    expect(failure.message).toContain("r-1");
    expect(streamFailureClassOf(failure, { sawBodyBytes: true })).toBe(
      "parse_or_validation",
    );
    // Nothing applied past the refusal, and no subscriber hook — the seam
    // a detector once rode — saw the orphan at all.
    expect(reasoningText).toBeUndefined();
    expect(contentSeenByHooks).toEqual([]);
  });

  it.each([
    [
      "a text delta with no open text message",
      [{ type: "TEXT_MESSAGE_CONTENT", messageId: "m-9", delta: "x" }],
      "m-9",
    ],
    [
      "tool arguments with no open tool call",
      [{ type: "TOOL_CALL_ARGS", toolCallId: "c-9", delta: "{}" }],
      "c-9",
    ],
  ])("%s is refused the same way", async (_name, orphan, id) => {
    const { failure, contentSeenByHooks } = await runThrough([
      run,
      ...orphan,
      done,
    ]);
    expect(failure).toBeInstanceOf(AGUIError);
    expect(failure?.message).toContain(id);
    expect(contentSeenByHooks).toEqual([]);
  });

  // The backend's block repair closes exactly what it opened; the client
  // holds both halves of that rule. A span with no message opened must
  // close with REASONING_END alone, and a span whose message opened must
  // close the message first — each wrong shape kills the run.
  it.each([
    [
      "a span with no message opened closes with REASONING_END alone",
      [start, end],
      true,
    ],
    [
      "a span with no message opened cannot close its unopened message",
      [start, messageEnd, end],
      false,
    ],
    [
      "a span whose message opened closes message, then span",
      [start, messageStart, messageEnd, end],
      true,
    ],
    [
      "a span whose message opened cannot skip the message end",
      [start, messageStart, end],
      false,
    ],
  ] as const)("%s", async (_name, frames, settles) => {
    const { failure } = await runThrough([run, ...frames, done]);
    if (settles) {
      expect(failure).toBeUndefined();
    } else {
      expect(failure).toBeInstanceOf(AGUIError);
    }
  });

  it("negative control: the same events one row later attach whole, settle, and warn nothing", async () => {
    const { reasoningText, warned, failure, contentSeenByHooks } =
      await runThrough([
        run,
        start,
        messageStart,
        head,
        tail,
        messageEnd,
        end,
        done,
      ]);
    expect(failure).toBeUndefined();
    expect(reasoningText).toBe("Track 3 got clipped too");
    expect(warned).toEqual([]);
    expect(contentSeenByHooks).toEqual([
      "REASONING_MESSAGE_CONTENT",
      "REASONING_MESSAGE_CONTENT",
    ]);
  });
});
