// Direct tests for the rescued tool-result/v1 envelope parser. The
// behaviours were previously pinned only through the retired result
// grammar's resultPreviewOf (result-preview.test.ts's envelope
// describe); they are ported here as direct calls so the parser the
// view contract will consume ships tested.
import { describe, expect, it } from "vitest";

import { toolResultEnvelopePayloadOf } from "../src/core/tool-result-envelope";

const FLIGHT_ROWS = [
  { id: "F-100", from: "OAK", to: "SEA", price: 129 },
  { id: "F-101", from: "OAK", to: "SEA", price: 149 },
  { id: "F-102", from: "SJC", to: "SEA", price: 99 },
];

describe("the tool-result/v1 envelope", () => {
  it("unwraps a success to its http body", () => {
    expect(
      toolResultEnvelopePayloadOf({
        ok: true,
        result: {
          status: 200,
          headers: {},
          body: FLIGHT_ROWS,
          truncated: false,
        },
      }),
    ).toEqual({ payload: FLIGHT_ROWS });
  });

  it("an envelope-only result unwraps to the result record", () => {
    expect(
      toolResultEnvelopePayloadOf({
        ok: true,
        result: { navigated: true, path: "/billing" },
      }),
    ).toEqual({ payload: { navigated: true, path: "/billing" } });
  });

  it("a result without an http shape stays whole — body alone is not transport", () => {
    // status must be a number AND body an own key for the http unwrap;
    // a result that merely mentions body keeps its own record.
    expect(
      toolResultEnvelopePayloadOf({
        ok: true,
        result: { status: "200", body: FLIGHT_ROWS },
      }),
    ).toEqual({ payload: { status: "200", body: FLIGHT_ROWS } });
  });

  it("a client-truncated body is refused, not boxed", () => {
    expect(
      toolResultEnvelopePayloadOf({
        ok: true,
        result: { status: 200, body: FLIGHT_ROWS, truncated: true },
      }),
    ).toBeNull();
  });

  it("failure envelopes and near-envelopes never unwrap", () => {
    // A failure envelope carries a third key (instruction) and passes
    // through untouched.
    const failure = {
      ok: false,
      error: { message: "boom" },
      instruction: "retry",
    };
    expect(toolResultEnvelopePayloadOf(failure)).toEqual({ payload: failure });
    // Extra root keys beside ok/result: not the envelope.
    const extra = { ok: true, result: { a: 1, b: 2 }, extra: true };
    expect(toolResultEnvelopePayloadOf(extra)).toEqual({ payload: extra });
    // ok must be literal true.
    const okString = { ok: "true", result: { a: 1, b: 2 } };
    expect(toolResultEnvelopePayloadOf(okString)).toEqual({
      payload: okString,
    });
    // result must be a record.
    const okList = { ok: true, result: [1, 2, 3] };
    expect(toolResultEnvelopePayloadOf(okList)).toEqual({ payload: okList });
  });

  it("non-record documents pass through in the box", () => {
    expect(toolResultEnvelopePayloadOf("plain text")).toEqual({
      payload: "plain text",
    });
    expect(toolResultEnvelopePayloadOf(FLIGHT_ROWS)).toEqual({
      payload: FLIGHT_ROWS,
    });
    expect(toolResultEnvelopePayloadOf(null)).toEqual({ payload: null });
  });

  it("Object.prototype-named keys are data, nothing more", () => {
    // A customer record naming prototype members must not misfire the
    // envelope check (own-key membership only, never the chain)…
    const prototypeNamed = { constructor: "a", toString: 1 };
    expect(toolResultEnvelopePayloadOf(prototypeNamed)).toEqual({
      payload: prototypeNamed,
    });
    // …and __proto__ arriving via JSON.parse (an own key there) reads
    // as data on the pass-through path.
    const proto = JSON.parse('{"__proto__": "x", "id": "y"}') as unknown;
    expect(toolResultEnvelopePayloadOf(proto)).toEqual({ payload: proto });
    // An envelope whose result carries prototype-named keys still
    // unwraps to that result.
    expect(
      toolResultEnvelopePayloadOf({
        ok: true,
        result: { constructor: "a", toString: 1 },
      }),
    ).toEqual({ payload: { constructor: "a", toString: 1 } });
  });
});
