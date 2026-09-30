import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";

import { streamFailureClassOf } from "../src/contract/telemetry";
import { toolOutcomeOf } from "../src/core/tool-outcome";
import { ServingReplayStreamAgent } from "../src/transport/replay-stream-agent";

// The 1.0 client's schema enforcement warns once per top-level field it
// strips. The serving wire's every published field is either known to
// the schema or lifted by the transport, so a canonical stream produces
// no warning at all — and the five extras arrive under the namespace.
const STREAM_URL =
  "https://api.example.test/serving/v1/assistant-threads/t-1/stream";

function sseBody(frames: Record<string, unknown>[]): string {
  return frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("");
}

function agentOver(frames: Record<string, unknown>[]) {
  return new ServingReplayStreamAgent({
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
}

// Every published TOOL_CALL_RESULT extra on one stream, beside the rest of
// the event vocabulary the mapper emits.
function canonicalStream(): Record<string, unknown>[] {
  return [
    {
      type: "RUN_STARTED",
      threadId: "assistant-thread-1",
      runId: "run-1",
      timestamp: 1,
    },
    {
      type: "TEXT_MESSAGE_START",
      messageId: "m-1",
      role: "assistant",
      timestamp: 2,
    },
    {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "m-1",
      delta: "Checking.",
      timestamp: 3,
    },
    { type: "TEXT_MESSAGE_END", messageId: "m-1", timestamp: 4 },
    { type: "REASONING_START", messageId: "r-1" },
    { type: "REASONING_MESSAGE_START", messageId: "r-1", role: "reasoning" },
    { type: "REASONING_MESSAGE_CONTENT", messageId: "r-1", delta: "hm" },
    { type: "REASONING_MESSAGE_END", messageId: "r-1" },
    { type: "REASONING_END", messageId: "r-1" },
    {
      type: "TOOL_CALL_START",
      toolCallId: "t-1",
      toolCallName: "read_page",
      parentMessageId: "m-1",
    },
    { type: "TOOL_CALL_ARGS", toolCallId: "t-1", delta: "{}" },
    { type: "TOOL_CALL_END", toolCallId: "t-1" },
    {
      type: "TOOL_CALL_RESULT",
      messageId: "t-1-result",
      toolCallId: "t-1",
      content: "Error: upstream timeout",
      role: "tool",
      error: "The page took too long to respond.",
      truncated: true,
      offloaded: true,
    },
    {
      type: "TOOL_CALL_START",
      toolCallId: "t-2",
      toolCallName: "refund",
      parentMessageId: "m-1",
    },
    { type: "TOOL_CALL_END", toolCallId: "t-2" },
    {
      type: "TOOL_CALL_RESULT",
      messageId: "t-2-result",
      toolCallId: "t-2",
      content: '{"ok": false, "refused": true}',
      role: "tool",
      refused: "Refunds above the limit need a member.",
    },
    {
      type: "TOOL_CALL_START",
      toolCallId: "t-3",
      toolCallName: "delete",
      parentMessageId: "m-1",
    },
    { type: "TOOL_CALL_END", toolCallId: "t-3" },
    {
      type: "TOOL_CALL_RESULT",
      messageId: "t-3-result",
      toolCallId: "t-3",
      content: "CONFIRMATION_FAILED: May I?",
      role: "tool",
      cancelled: true,
    },
    {
      type: "CUSTOM",
      name: "approval_resolved",
      value: { interrupt_id: "int-1", approved: false },
    },
    { type: "RUN_FINISHED", threadId: "assistant-thread-1", runId: "run-1" },
  ];
}

describe("the 1.0 client's enforcement over the serving wire", () => {
  const suppressed = process.env.SUPPRESS_TRANSFORMATION_WARNINGS;
  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    delete process.env.SUPPRESS_TRANSFORMATION_WARNINGS;
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    if (suppressed !== undefined) {
      process.env.SUPPRESS_TRANSFORMATION_WARNINGS = suppressed;
    }
  });

  function enforcementWarnings(): string[] {
    return warn.mock.calls
      .map((call) => call.map(String).join(" "))
      .filter((line) => line.includes("[ag-ui][enforce]"));
  }

  it("strips nothing from a canonical stream, and every extra reaches the subscriber lifted", async () => {
    const agent = agentOver(canonicalStream());
    const outcomes = new Map<string, unknown>();
    agent.subscribe({
      onToolCallResultEvent({ event }) {
        outcomes.set(event.toolCallId, toolOutcomeOf(event));
        for (const field of [
          "error",
          "refused",
          "cancelled",
          "truncated",
          "offloaded",
        ]) {
          expect(event).not.toHaveProperty(field);
        }
      },
    });
    await agent.connectAgent();

    expect(enforcementWarnings()).toEqual([]);
    expect(outcomes.get("t-1")).toEqual({
      error: "The page took too long to respond.",
      truncated: true,
      offloaded: true,
    });
    expect(outcomes.get("t-2")).toEqual({
      refused: "Refunds above the limit need a member.",
    });
    expect(outcomes.get("t-3")).toEqual({ cancelled: true });
    // The 1.0 apply step carries event metadata onto the minted tool
    // message, so the lifted outcome rides agent.messages as well.
    const minted = agent.messages.find(
      (message) => message.id === "t-3-result",
    );
    expect(toolOutcomeOf(minted)).toEqual({ cancelled: true });
  });

  it("negative control: an unpublished top-level field is stripped with exactly one warning", async () => {
    const frames = canonicalStream().map((frame) =>
      frame.type === "RUN_FINISHED" ? { ...frame, bogusField: 1 } : frame,
    );
    await agentOver(frames).connectAgent();
    const warnings = enforcementWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("bogusField");
    expect(warnings[0]).toContain("RUN_FINISHED");
  });

  it("negative control: without the lift the extras would be stripped — the lift is what the readers stand on", async () => {
    // A raw HttpAgent (no lift) over the same frames: the client removes
    // the extras and says so, once per field.
    const { HttpAgent } = await import("@ag-ui/client");
    const bare = new HttpAgent({
      url: STREAM_URL,
      threadId: "assistant-thread-1",
      fetch: () =>
        Promise.resolve(
          new Response(sseBody(canonicalStream()), {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        ),
    });
    const seen: unknown[] = [];
    await bare.runAgent(
      {},
      {
        onToolCallResultEvent({ event }) {
          seen.push(toolOutcomeOf(event));
        },
      },
    );
    expect(seen).toEqual([{}, {}, {}]);
    expect(enforcementWarnings()).toHaveLength(5);
  });

  it("a non-object under the teaflask namespace never costs an extra: the lift takes the namespace over and nothing is stripped", async () => {
    // The protocol validates only the outer metadata object, so this
    // frame would pass the validator with its extra still on the top level
    // — stripped with a warning, a cancellation read as success — unless
    // the lift claims the namespace.
    const frames = canonicalStream().map((frame) =>
      frame.type === "TOOL_CALL_RESULT" && frame.toolCallId === "t-3"
        ? { ...frame, metadata: { teaflask: "theirs", keep: 1 } }
        : frame,
    );
    const agent = agentOver(frames);
    const outcomes = new Map<string, unknown>();
    agent.subscribe({
      onToolCallResultEvent({ event }) {
        outcomes.set(event.toolCallId, toolOutcomeOf(event));
      },
    });
    await agent.connectAgent();
    expect(enforcementWarnings()).toEqual([]);
    expect(outcomes.get("t-3")).toEqual({ cancelled: true });
    const minted = agent.messages.find(
      (message) => message.id === "t-3-result",
    );
    expect(minted?.metadata).toMatchObject({ keep: 1 });
  });

  it("a result whose metadata is not an object fails the run at the client's validator — the lift does not paper over it", async () => {
    const frames = canonicalStream().map((frame) =>
      frame.type === "TOOL_CALL_RESULT" && frame.toolCallId === "t-3"
        ? { ...frame, metadata: "nope" }
        : frame,
    );
    const agent = agentOver(frames);
    const failures: Error[] = [];
    agent.subscribe({
      onRunFailed({ error }) {
        failures.push(error);
      },
    });
    await agent.connectAgent().catch(() => undefined);
    const failure = failures.at(0);
    if (failure === undefined) {
      throw new Error("the run did not fail");
    }
    expect(failure.name).toBe("ZodError");
    expect(failure.message).toContain("metadata");
    expect(streamFailureClassOf(failure, { sawBodyBytes: true })).toBe(
      "parse_or_validation",
    );
    // The malformed frame still carried its extra on the top level, so
    // the client's stripper announced it before the validator refused.
    expect(enforcementWarnings().join(" ")).toContain("cancelled");
  });
});
