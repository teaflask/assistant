import { AGUIError } from "@ag-ui/core";
import { describe, expect, it } from "vitest";

import { streamFailureClassOf } from "../src/contract/telemetry";
import { ServingReplayStreamAgent } from "../src/transport/replay-stream-agent";

// The client's verifier throws its own AGUIError; the package's telemetry
// classifies by `instanceof AGUIError` against the copy IT imports. The
// two agree only while one @ag-ui/core is installed — a second copy (the
// frontend once carried 0.0.57 beside the package's 0.0.59) turns every
// protocol refusal into a mis-filed mid_stream. This runs the real
// pipeline and asks the identity question end to end.
const STREAM_URL =
  "https://api.example.test/serving/v1/assistant-threads/t-1/stream";

function agentOver(frames: Record<string, unknown>[]) {
  const body = frames
    .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
    .join("");
  return new ServingReplayStreamAgent({
    streamUrl: STREAM_URL,
    streamThreadId: "assistant-thread-1",
    authorizedFetch: () =>
      Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      ),
  });
}

async function failureOf(frames: Record<string, unknown>[]): Promise<Error> {
  const agent = agentOver(frames);
  const captured: Error[] = [];
  agent.subscribe({
    onRunFailed({ error }) {
      captured.push(error);
    },
  });
  await agent.connectAgent().catch(() => undefined);
  const failure = captured.at(0);
  if (failure === undefined) {
    throw new Error("the run did not fail");
  }
  return failure;
}

describe("a client-originated protocol refusal", () => {
  it("is the package's own AGUIError and classifies as parse_or_validation", async () => {
    const error = await failureOf([
      { type: "TEXT_MESSAGE_START", messageId: "m-1", role: "assistant" },
    ]);
    expect(error).toBeInstanceOf(AGUIError);
    expect(error.message).toContain("RUN_STARTED");
    expect(streamFailureClassOf(error, { sawBodyBytes: true })).toBe(
      "parse_or_validation",
    );
  });

  it("negative control: a lookalike carrying the name is not the class, and files elsewhere", () => {
    // What a second core copy's error looks like from here: same name,
    // same message, a different constructor.
    class Lookalike extends Error {
      override name = "AGUIError";
    }
    const lookalike = new Lookalike("First event must be 'RUN_STARTED'");
    expect(lookalike).not.toBeInstanceOf(AGUIError);
    expect(streamFailureClassOf(lookalike, { sawBodyBytes: true })).toBe(
      "mid_stream",
    );
  });
});
