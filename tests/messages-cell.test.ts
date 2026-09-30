import { describe, expect, it, vi } from "vitest";

import type { Message } from "@ag-ui/core";

import {
  isAbortShaped,
  messagesRecorder,
  streamErrorRecorder,
} from "../src/core/messages-cell";

describe("messagesRecorder", () => {
  it("publishes a FRESH array per change — the pipeline mutates its own in place", () => {
    const published: (readonly Message[])[] = [];
    const recorder = messagesRecorder((messages) => published.push(messages));

    // The apply pipeline's exact hazard: one array instance, mutated
    // between notifications.
    const live: Message[] = [{ id: "u1", role: "user", content: "hi" }];
    void recorder.onMessagesChanged?.({
      messages: live,
    } as never);
    live.push({ id: "a1", role: "assistant", content: "he" });
    void recorder.onMessagesChanged?.({
      messages: live,
    } as never);

    expect(published).toHaveLength(2);
    expect(published[0]).not.toBe(published[1]);
    expect(published[0]).toHaveLength(1);
    expect(published[1]).toHaveLength(2);
    expect(published[0]).not.toBe(live);
  });
});

describe("streamErrorRecorder", () => {
  it("routes a transport/server failure to the store", () => {
    const onStreamError = vi.fn();
    const recorder = streamErrorRecorder(onStreamError);

    const died = new Error("network dropped mid-stream");
    void recorder.onRunFailed?.({ error: died } as never);

    expect(onStreamError).toHaveBeenCalledWith(died);
  });

  it("swallows abort-shaped errors — an intentional stop is not stream trouble", () => {
    const onStreamError = vi.fn();
    const recorder = streamErrorRecorder(onStreamError);

    const domAbort = new Error("The user aborted a request.");
    domAbort.name = "AbortError";
    void recorder.onRunFailed?.({ error: domAbort } as never);
    void recorder.onRunFailed?.({
      error: new Error("Fetch is aborted"),
    } as never);
    void recorder.onRunFailed?.({
      error: new Error("signal is aborted without reason"),
    } as never);

    expect(onStreamError).not.toHaveBeenCalled();
  });
});

describe("isAbortShaped", () => {
  it("recognises our own abort in each of the runtime's spellings", () => {
    expect(
      isAbortShaped(
        new DOMException("The user aborted a request.", "AbortError"),
      ),
    ).toBe(true);
    expect(isAbortShaped(new Error("Fetch is aborted"))).toBe(true);
    expect(isAbortShaped(new Error("signal is aborted without reason"))).toBe(
      true,
    );
    expect(isAbortShaped(new Error("Request aborted"))).toBe(true);
  });

  it("leaves a real transport death alone", () => {
    expect(isAbortShaped(new TypeError("Failed to fetch"))).toBe(false);
    expect(isAbortShaped(new Error("network down"))).toBe(false);
    expect(isAbortShaped(new Error("HTTP 502: upstream burp"))).toBe(false);
  });
});
