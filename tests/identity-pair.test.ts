// The identity pair's one rule, cell by cell: identified only when a
// non-empty userId and getEndUserToken are both present; everything else
// anonymous, and half-set (worth one warning) whenever something was set.

import { describe, expect, it } from "vitest";

import {
  identityPairIsHalfSet,
  namedIdentityOf,
  namedUserIdOf,
} from "../src/core/identity-pair";
import { IDENTITY_PAIR_MATRIX } from "./identity-pair-matrix";

describe("the identity pair rule", () => {
  it.each(IDENTITY_PAIR_MATRIX)(
    "$name → identified: $identified, half-set: $halfSet",
    ({ userId, vouch: getEndUserToken, identified, halfSet }) => {
      const named = namedIdentityOf({ userId, getEndUserToken });
      expect(named !== null).toBe(identified);
      if (named !== null) {
        expect(named).toEqual({ userId, getEndUserToken });
      }
      expect(identityPairIsHalfSet({ userId, getEndUserToken })).toBe(halfSet);
    },
  );

  it("null is unset for both halves, exactly like undefined", () => {
    expect(namedIdentityOf({ userId: null, getEndUserToken: null })).toBeNull();
    expect(identityPairIsHalfSet({ userId: null, getEndUserToken: null })).toBe(
      false,
    );
    expect(
      identityPairIsHalfSet({ userId: "user-a", getEndUserToken: null }),
    ).toBe(true);
  });

  it('namedUserIdOf is the userId half: null, undefined and "" name nobody', () => {
    expect(namedUserIdOf(undefined)).toBeUndefined();
    expect(namedUserIdOf(null)).toBeUndefined();
    expect(namedUserIdOf("")).toBeUndefined();
    expect(namedUserIdOf("user-a")).toBe("user-a");
  });
});
