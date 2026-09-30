/**
 * The generated client's mutator. The load-bearing case is the 204: the
 * disconnect door answers No Content, and parsing the empty body used to
 * throw — turning a server-side success into a client-side error that
 * left the panel claiming a credential the server had already removed.
 */
import { describe, expect, it } from "vitest";

import { servingFetch } from "../src/transport/serving-fetch";
import type { TokenSession } from "../src/transport/token-session";

function _sessionAnswering(response: Response): TokenSession {
  return {
    baseUrl: "https://api.example.test",
    authorizedFetch: () => Promise.resolve(response),
  } as unknown as TokenSession;
}

describe("servingFetch", () => {
  it("a 204 answer resolves without touching the empty body", async () => {
    const session = _sessionAnswering(new Response(null, { status: 204 }));
    await expect(
      servingFetch("/serving/v1/subscriptions/openai_chatgpt", {
        method: "DELETE",
        session,
      }),
    ).resolves.toBeUndefined();
  });

  it("a JSON answer still parses", async () => {
    const session = _sessionAnswering(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await expect(
      servingFetch("/serving/v1/subscriptions", { method: "GET", session }),
    ).resolves.toEqual({ ok: true });
  });

  it("a non-2xx answer throws the parsed envelope", async () => {
    const session = _sessionAnswering(
      new Response(
        JSON.stringify({
          error: { code: "NOT_FOUND", message: "Gone.", details: null },
        }),
        { status: 404 },
      ),
    );
    await expect(
      servingFetch("/serving/v1/subscriptions", { method: "GET", session }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});
