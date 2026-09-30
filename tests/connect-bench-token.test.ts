// The connect bench's two token invariants (fixtures/connect):
// a stored end-user JWT is scoped to one (api base, publishable key)
// pair, and a legacy URL that carries the token as a query param is
// scrubbed without the value ever being read.

import { describe, expect, it } from "vitest";

import {
  tokenStorageKeyOf,
  urlWithoutLegacyTokenParam,
} from "../fixtures/connect/token-context";

const LEGACY_PARAM = "eut";
const TOKEN = "not-a-real-token";

function benchUrl(withToken: boolean): URL {
  const url = new URL("http://127.0.0.1:8791/fixtures/connect/");
  url.searchParams.set("pk", "pk_test_x");
  if (withToken) {
    url.searchParams.set(LEGACY_PARAM, TOKEN);
  }
  url.searchParams.set("base", "http://localhost:8000");
  url.hash = "kept";
  return url;
}

describe("the stored token is scoped to one (base, key) pair", () => {
  it("a different base or a different key is a different storage key", () => {
    const key = tokenStorageKeyOf("http://localhost:8000", "pk_test_a");
    expect(tokenStorageKeyOf("http://localhost:8001", "pk_test_a")).not.toBe(
      key,
    );
    expect(tokenStorageKeyOf("http://localhost:8000", "pk_test_b")).not.toBe(
      key,
    );
  });

  it("spelling variants of one endpoint share the key", () => {
    const key = tokenStorageKeyOf("http://localhost:8000", "pk_test_a");
    expect(tokenStorageKeyOf("http://localhost:8000/", "pk_test_a")).toBe(key);
    expect(tokenStorageKeyOf("http://localhost:8000//", "pk_test_a")).toBe(key);
  });

  it("a malformed or empty base never throws and stays distinct and stable", () => {
    const malformed = tokenStorageKeyOf("not a url", "pk_test_a");
    const empty = tokenStorageKeyOf("", "pk_test_a");
    const good = tokenStorageKeyOf("http://localhost:8000", "pk_test_a");
    expect(new Set([malformed, empty, good]).size).toBe(3);
    expect(tokenStorageKeyOf("not a url", "pk_test_a")).toBe(malformed);
    expect(tokenStorageKeyOf("", "pk_test_a")).toBe(empty);
    // An empty key is scoped too, not collapsed into every other key.
    expect(tokenStorageKeyOf("http://localhost:8000", "")).not.toBe(good);
  });
});

describe("a legacy token query param is scrubbed, never read", () => {
  it("removes exactly the token param; every other param and the hash survive", () => {
    const scrubbed = urlWithoutLegacyTokenParam(benchUrl(true).toString());
    expect(scrubbed).not.toBeNull();
    expect(scrubbed).not.toContain(TOKEN);
    const url = new URL(scrubbed ?? "");
    expect(url.searchParams.has(LEGACY_PARAM)).toBe(false);
    expect(url.searchParams.get("pk")).toBe("pk_test_x");
    expect(url.searchParams.get("base")).toBe("http://localhost:8000");
    expect(url.hash).toBe("#kept");
  });

  it("a URL without the param, and an unparseable href, scrub nothing", () => {
    expect(urlWithoutLegacyTokenParam(benchUrl(false).toString())).toBeNull();
    expect(urlWithoutLegacyTokenParam("not a url")).toBeNull();
  });
});
