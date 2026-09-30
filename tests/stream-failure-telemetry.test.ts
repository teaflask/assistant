import { AGUIError } from "@ag-ui/core";
import { EventSchemas } from "@ag-ui/core/schemas";
import { describe, expect, it } from "vitest";

import { streamFailureClassOf } from "../src/contract/telemetry";

// The classifier keys off the shapes the transport actually produces:
// runHttpRequest stamps `.status` on a non-2xx, a missing body is its
// fixed sentence, protocol refusals are AGUIError, the SSE parser's
// schema rejections are raw ZodErrors — and a network death is the
// runtime's bare TypeError at BOTH ends of the request's life, so the
// sawBodyBytes context is what splits pre-response from mid-read (any
// body byte counts, keepalive pings included — a live-but-idle stream
// commits no frame but is provably past the headers).
describe("streamFailureClassOf", () => {
  const NO_BYTES = { sawBodyBytes: false };
  const BYTES_FLOWED = { sawBodyBytes: true };

  it("names a pre-response rejection — the browser's bare TypeError with no body bytes", () => {
    expect(
      streamFailureClassOf(new TypeError("Failed to fetch"), NO_BYTES),
    ).toBe("network_rejected");
    // Firefox's wording of the same rejection.
    expect(
      streamFailureClassOf(
        new TypeError("NetworkError when attempting to fetch resource."),
        NO_BYTES,
      ),
    ).toBe("network_rejected");
  });

  it("names a mid-stream death — the same TypeError once body bytes have flowed", () => {
    // Chrome errors a dying response body with this TypeError; the
    // reader loop propagates it raw (catch(t){e.error(t)}).
    expect(
      streamFailureClassOf(new TypeError("network error"), BYTES_FLOWED),
    ).toBe("mid_stream");
    // undici's wording of the same mid-read death.
    expect(
      streamFailureClassOf(new TypeError("terminated"), BYTES_FLOWED),
    ).toBe("mid_stream");
    // And the incident's own wording, mid-read.
    expect(
      streamFailureClassOf(new TypeError("Failed to fetch"), BYTES_FLOWED),
    ).toBe("mid_stream");
  });

  it("names a non-2xx by its stamped status, whenever it arrives", () => {
    const httpError = Object.assign(new Error("HTTP 502: upstream burp"), {
      status: 502,
      payload: { error: { code: "UPSTREAM", message: "burp" } },
    });
    expect(streamFailureClassOf(httpError, NO_BYTES)).toBe("http_error");
    expect(streamFailureClassOf(httpError, BYTES_FLOWED)).toBe("http_error");
  });

  it("names an accepted response with no readable body", () => {
    expect(
      streamFailureClassOf(
        new Error("Failed to getReader() from response"),
        NO_BYTES,
      ),
    ).toBe("no_body");
  });

  it("names a protocol refusal — the verifier's AGUIError", () => {
    expect(
      streamFailureClassOf(
        new AGUIError("First event must be 'RUN_STARTED'"),
        BYTES_FLOWED,
      ),
    ).toBe("parse_or_validation");
  });

  it("names a schema rejection — the SSE parser's raw ZodError", () => {
    // The parser validates every frame with EventSchemas.parse and hands
    // the ZodError to the subscriber unwrapped; produce the genuine
    // article rather than a lookalike.
    const zodError = (() => {
      try {
        EventSchemas.parse({ type: "NOT_AN_EVENT_TYPE" });
      } catch (caught) {
        return caught as Error;
      }
      throw new Error("EventSchemas.parse accepted a bogus event");
    })();
    expect(zodError.name).toBe("ZodError");
    expect(streamFailureClassOf(zodError, BYTES_FLOWED)).toBe(
      "parse_or_validation",
    );
  });

  it("names our own aborts — the recorder filters these before emission", () => {
    const abort = new Error("The operation was canceled.");
    abort.name = "AbortError";
    expect(streamFailureClassOf(abort, NO_BYTES)).toBe("client_abort");
    expect(
      streamFailureClassOf(new Error("Request aborted"), BYTES_FLOWED),
    ).toBe("client_abort");
  });

  it("falls back to mid_stream for shapes it does not recognize", () => {
    // The totality guard, not a transport shape: an unrecognized error
    // mid-pipeline reads as the stream dying, the least-wrong bucket.
    expect(
      streamFailureClassOf(new Error("The connection reset."), BYTES_FLOWED),
    ).toBe("mid_stream");
  });
});
