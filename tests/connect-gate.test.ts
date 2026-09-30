// The conversation gate's two producers: the pre-flight projection and
// the send refusal. Both must tolerate contract growth (unknown gates,
// reasons, providers) and malformed details without throwing — they run
// under error handlers.

import { describe, expect, it } from "vitest";

import {
  NO_GATE,
  gateOfProjection,
  gateOfRefusal,
  gatesEqual,
} from "../src/core/connect-gate";
import type { ConnectProjectionResponse } from "../src/generated/models";
import { ServingApiError } from "../src/transport/serving-error";

function projectionOf(
  overrides: Partial<ConnectProjectionResponse>,
): ConnectProjectionResponse {
  return {
    gate: "none",
    reason: null,
    providers: [],
    retry_after_seconds: null,
    ...overrides,
  };
}

function refusalOf(options: {
  code: ServingApiError["code"];
  retryAfterSeconds?: number | null;
  details?: unknown;
}): ServingApiError {
  return new ServingApiError({
    code: options.code,
    message: "a sentence",
    status: 403,
    retryAfterSeconds: options.retryAfterSeconds ?? null,
    details: options.details,
  });
}

describe("gateOfProjection", () => {
  it("maps every named gate", () => {
    expect(gateOfProjection(projectionOf({ gate: "none" }))).toEqual(NO_GATE);
    expect(gateOfProjection(projectionOf({ gate: "sign_in" }))).toEqual({
      kind: "sign_in",
    });
    expect(
      gateOfProjection(
        projectionOf({
          gate: "connect",
          reason: "taster_exhausted",
          providers: ["openai_chatgpt"],
        }),
      ),
    ).toEqual({
      kind: "connect",
      reason: "taster_exhausted",
      providers: ["openai_chatgpt"],
    });
    expect(gateOfProjection(projectionOf({ gate: "verifying" }))).toEqual({
      kind: "verifying",
    });
  });

  it("a wait gate carries an absolute reset moment", () => {
    const before = Date.now();
    const gate = gateOfProjection(
      projectionOf({ gate: "wait", retry_after_seconds: 120 }),
    );
    expect(gate.kind).toBe("wait");
    if (gate.kind === "wait") {
      expect(gate.retryAtMs).toBeGreaterThanOrEqual(before + 120_000);
      expect(gate.retryAtMs).toBeLessThanOrEqual(Date.now() + 120_000);
    }
  });

  it("an unknown gate reads as none — the contract's growth rule", () => {
    const grown = projectionOf({});
    (grown as { gate: string }).gate = "escrow_hold";
    expect(gateOfProjection(grown)).toEqual(NO_GATE);
  });

  it("a missing projection (an older server) reads as none", () => {
    expect(gateOfProjection(undefined)).toEqual(NO_GATE);
  });

  it("an unknown reason reads as auth_bounced — the conservative ask", () => {
    const grown = projectionOf({ gate: "connect" });
    (grown as { reason: string }).reason = "quota_negotiation";
    const gate = gateOfProjection(grown);
    expect(gate).toEqual({
      kind: "connect",
      reason: "auth_bounced",
      providers: [],
    });
  });
});

describe("gateOfRefusal", () => {
  it("a sign-in refusal gates", () => {
    expect(
      gateOfRefusal(refusalOf({ code: "ASSISTANT_SIGN_IN_REQUIRED" })),
    ).toEqual({ kind: "sign_in" });
  });

  it("a connect refusal reads reason and providers off details", () => {
    expect(
      gateOfRefusal(
        refusalOf({
          code: "SUBSCRIPTION_CONNECT_REQUIRED",
          details: {
            providers: ["openai_chatgpt"],
            reason: "taster_exhausted",
          },
        }),
      ),
    ).toEqual({
      kind: "connect",
      reason: "taster_exhausted",
      providers: ["openai_chatgpt"],
    });
  });

  it("malformed details degrade to an empty auth_bounced ask, never a throw", () => {
    expect(
      gateOfRefusal(
        refusalOf({
          code: "SUBSCRIPTION_CONNECT_REQUIRED",
          details: "not-an-object",
        }),
      ),
    ).toEqual({ kind: "connect", reason: "auth_bounced", providers: [] });
    expect(
      gateOfRefusal(
        refusalOf({
          code: "SUBSCRIPTION_CONNECT_REQUIRED",
          details: { providers: [42, "someday_ai"], reason: 7 },
        }),
      ),
    ).toEqual({ kind: "connect", reason: "auth_bounced", providers: [] });
  });

  it("a cannot-pay refusal forks on Retry-After: wait with it, verifying without", () => {
    const waiting = gateOfRefusal(
      refusalOf({ code: "SUBSCRIPTION_CANNOT_PAY", retryAfterSeconds: 60 }),
    );
    expect(waiting?.kind).toBe("wait");
    expect(
      gateOfRefusal(refusalOf({ code: "SUBSCRIPTION_CANNOT_PAY" })),
    ).toEqual({ kind: "verifying" });
  });

  it("non-gate refusals and non-API errors answer null", () => {
    expect(gateOfRefusal(refusalOf({ code: "RATE_LIMITED" }))).toBeNull();
    expect(gateOfRefusal(new Error("boom"))).toBeNull();
  });
});

describe("gatesEqual", () => {
  // The projection mints a fresh object every read; the registry writes
  // its cell only on substance so an unchanged gate never notifies.
  it("judges substance, never identity", () => {
    expect(gatesEqual({ kind: "verifying" }, { kind: "verifying" })).toBe(true);
    expect(gatesEqual(NO_GATE, { kind: "none" })).toBe(true);
    expect(gatesEqual({ kind: "verifying" }, { kind: "sign_in" })).toBe(false);
    expect(
      gatesEqual(
        {
          kind: "connect",
          reason: "taster_exhausted",
          providers: ["openai_chatgpt"],
        },
        {
          kind: "connect",
          reason: "taster_exhausted",
          providers: ["openai_chatgpt"],
        },
      ),
    ).toBe(true);
    expect(
      gatesEqual(
        {
          kind: "connect",
          reason: "taster_exhausted",
          providers: ["openai_chatgpt"],
        },
        {
          kind: "connect",
          reason: "auth_bounced",
          providers: ["openai_chatgpt"],
        },
      ),
    ).toBe(false);
    expect(
      gatesEqual(
        { kind: "connect", reason: "auth_bounced", providers: [] },
        {
          kind: "connect",
          reason: "auth_bounced",
          providers: ["openai_chatgpt"],
        },
      ),
    ).toBe(false);
    expect(
      gatesEqual(
        { kind: "wait", retryAtMs: 1 },
        { kind: "wait", retryAtMs: 1 },
      ),
    ).toBe(true);
    expect(
      gatesEqual(
        { kind: "wait", retryAtMs: 1 },
        { kind: "wait", retryAtMs: 2 },
      ),
    ).toBe(false);
  });
});
