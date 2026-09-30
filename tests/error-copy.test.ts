import { describe, expect, it } from "vitest";

import { userSentenceFor } from "../src/core/error-copy";
import { ServingApiError } from "../src/transport/serving-error";

function cannotPay(
  retryAfterSeconds: number | null,
  message = "the server's own sentence",
): ServingApiError {
  return new ServingApiError({
    code: "SUBSCRIPTION_CANNOT_PAY",
    status: 429,
    message,
    retryAfterSeconds,
  });
}

// The refused plan's wait copy: rendered in the largest sensible unit
// (plan windows run daily to weekly — raw minutes would read "about
// 10080 minutes"), ceiled so the promise is never early, and only when
// the server sent Retry-After (a reset still ahead). The hour and day
// rungs start at two of each, so only the minute rung can be singular.
describe("the refused plan's wait copy", () => {
  it("renders short waits in minutes", () => {
    expect(userSentenceFor(cannotPay(90))).toContain(
      "can continue in about 2 minutes.",
    );
  });

  it("keeps a lone minute singular", () => {
    expect(userSentenceFor(cannotPay(30))).toContain(
      "can continue in about 1 minute.",
    );
  });

  it("renders waits from two hours in hours", () => {
    expect(userSentenceFor(cannotPay(2 * 3600))).toContain(
      "can continue in about 2 hours.",
    );
    expect(userSentenceFor(cannotPay(10 * 3600 + 1))).toContain(
      "can continue in about 11 hours.",
    );
  });

  it("stays on minutes just under the two-hour rung", () => {
    expect(userSentenceFor(cannotPay(2 * 3600 - 60))).toContain(
      "can continue in about 119 minutes.",
    );
  });

  it("renders waits from two days in days", () => {
    expect(userSentenceFor(cannotPay(2 * 86400))).toContain(
      "can continue in about 2 days.",
    );
    expect(userSentenceFor(cannotPay(7 * 86400))).toContain(
      "can continue in about 7 days.",
    );
  });

  it("passes the server sentence through without Retry-After", () => {
    const recheck = "We're re-checking your plan — try again shortly.";
    expect(userSentenceFor(cannotPay(null, recheck))).toBe(recheck);
  });
});
