// @vitest-environment jsdom

// The sign-in-required recovery: a cached anonymous token 403ing on a
// sign_in_required agent forces ONE re-mint, so a visitor who signed in
// after the mint recovers immediately instead of at the proactive
// re-mint — and a re-mint that comes back still anonymous surfaces the
// sentence instead of looping.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  END_USER_ID_MISMATCH,
  TokenSession,
} from "../src/transport/token-session";

const SIGN_IN_REQUIRED_BODY = JSON.stringify({
  error: {
    code: "ASSISTANT_SIGN_IN_REQUIRED",
    message: "Please sign in to this site to chat with the assistant.",
  },
});

function mintResponse(tier: "anonymous" | "identified", token: string) {
  return new Response(
    JSON.stringify({ visitor_token: token, expires_in: 900, tier }),
    { status: 201, headers: { "Content-Type": "application/json" } },
  );
}

function signInRequiredResponse() {
  return new Response(SIGN_IN_REQUIRED_BODY, {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

function bearerOf(init: RequestInit | undefined): string | null {
  return new Headers(init?.headers).get("Authorization");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TokenSession on the sign-in-required 403", () => {
  it("re-mints once and retries when the fresh mint carries the vouch", async () => {
    let endUserToken: string | null = null;
    let vouchReads = 0;
    const fetchMock = vi
      .fn<typeof fetch>()
      // First mint: the visitor hadn't signed in yet.
      .mockResolvedValueOnce(mintResponse("anonymous", "anon-token"))
      // The send refuses: the agent requires sign-in.
      .mockResolvedValueOnce(signInRequiredResponse())
      // The forced re-mint: the visitor signed in meanwhile, so the
      // getEndUserToken callback now vouches and the mint identifies.
      .mockImplementationOnce(() => {
        expect(endUserToken).toBe("customer-jwt");
        return Promise.resolve(mintResponse("identified", "identified-token"));
      })
      // The single retry succeeds with the identified token.
      .mockResolvedValueOnce(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const session = new TokenSession({
      publishableKey: "pk_test_x",
      baseUrl: "https://api.example.test",
      getEndUserToken: () => {
        vouchReads += 1;
        return endUserToken;
      },
    });

    endUserToken = "customer-jwt";
    const response = await session.authorizedFetch(
      "https://api.example.test/serving/v1/assistant-threads/messages",
      { method: "POST" },
    );

    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(bearerOf(fetchMock.mock.calls[3][1])).toBe(
      "Bearer identified-token",
    );
    // The probed vouch threads into the re-mint: one host round-trip
    // for the first mint, one for the probe — never a third.
    expect(vouchReads).toBe(2);
    session.dispose();
  });

  it("surfaces the 403 without a mint when the visitor is signed out", async () => {
    // Identity is wired but yields no vouch right now: a re-mint could
    // only come back anonymous, so none is spent and the still-valid
    // cached token is kept.
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(mintResponse("anonymous", "anon-token"))
      .mockResolvedValueOnce(signInRequiredResponse());
    vi.stubGlobal("fetch", fetchMock);
    const session = new TokenSession({
      publishableKey: "pk_test_x",
      baseUrl: "https://api.example.test",
      getEndUserToken: () => null,
    });

    const response = await session.authorizedFetch(
      "https://api.example.test/serving/v1/assistant-threads/messages",
      { method: "POST" },
    );

    expect(response.status).toBe(403);
    // The original body is still readable by the surface's error copy.
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ASSISTANT_SIGN_IN_REQUIRED");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    session.dispose();
  });

  it("surfaces the 403, not the callback's failure, when the vouch read rejects", async () => {
    // The host's token endpoint goes down between the mint (no vouch,
    // anonymous) and the refusal: the sign-in sentence is still the
    // actionable copy, so the rejection must not replace it.
    let vouchReads = 0;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(mintResponse("anonymous", "anon-token"))
      .mockResolvedValueOnce(signInRequiredResponse());
    vi.stubGlobal("fetch", fetchMock);
    const session = new TokenSession({
      publishableKey: "pk_test_x",
      baseUrl: "https://api.example.test",
      getEndUserToken: () => {
        vouchReads += 1;
        return vouchReads === 1
          ? null
          : Promise.reject(new Error("endpoint down"));
      },
    });

    const response = await session.authorizedFetch(
      "https://api.example.test/serving/v1/assistant-threads/messages",
      { method: "POST" },
    );

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ASSISTANT_SIGN_IN_REQUIRED");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    session.dispose();
  });

  it("surfaces the 403 when a vouched re-mint still comes back anonymous", async () => {
    // The defensive backstop: the host vouched, the mint answered
    // anonymous anyway — surface the sentence rather than loop.
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(mintResponse("anonymous", "anon-token"))
      .mockResolvedValueOnce(signInRequiredResponse())
      .mockResolvedValueOnce(mintResponse("anonymous", "anon-token-2"));
    vi.stubGlobal("fetch", fetchMock);
    const session = new TokenSession({
      publishableKey: "pk_test_x",
      baseUrl: "https://api.example.test",
      getEndUserToken: () => "customer-jwt",
    });

    const response = await session.authorizedFetch(
      "https://api.example.test/serving/v1/assistant-threads/messages",
      { method: "POST" },
    );

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ASSISTANT_SIGN_IN_REQUIRED");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    session.dispose();
  });

  it("skips the re-mint entirely when the host never wired identity", async () => {
    // Without getEndUserToken a re-mint can only come back anonymous —
    // no mint round-trip is spent against the mint rate windows.
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(mintResponse("anonymous", "anon-token"))
      .mockResolvedValueOnce(signInRequiredResponse());
    vi.stubGlobal("fetch", fetchMock);
    const session = new TokenSession({
      publishableKey: "pk_test_x",
      baseUrl: "https://api.example.test",
    });

    const response = await session.authorizedFetch(
      "https://api.example.test/serving/v1/assistant-threads/messages",
      { method: "POST" },
    );

    expect(response.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    session.dispose();
  });

  it("surfaces the 403, not the mint error, when the forced re-mint fails", async () => {
    const onMintFailed = vi.fn();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(mintResponse("anonymous", "anon-token"))
      .mockResolvedValueOnce(signInRequiredResponse())
      // The forced re-mint fails — the actionable sentence must still
      // reach the surface instead of a rejected fetch.
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: "RATE_LIMITED", message: "Slow down." },
          }),
          { status: 429, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const session = new TokenSession({
      publishableKey: "pk_test_x",
      baseUrl: "https://api.example.test",
      getEndUserToken: () => "customer-jwt",
      onMintFailed,
    });

    const response = await session.authorizedFetch(
      "https://api.example.test/serving/v1/assistant-threads/messages",
      { method: "POST" },
    );

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ASSISTANT_SIGN_IN_REQUIRED");
    expect(onMintFailed).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    session.dispose();
  });

  it("leaves other 403s alone — no re-mint, no retry", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(mintResponse("anonymous", "anon-token"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: "ORIGIN_NOT_ALLOWED", message: "Not allowed." },
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const session = new TokenSession({
      publishableKey: "pk_test_x",
      baseUrl: "https://api.example.test",
    });

    const response = await session.authorizedFetch(
      "https://api.example.test/serving/v1/assistant-threads/messages",
      { method: "POST" },
    );

    expect(response.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    session.dispose();
  });
});

function mintResponseFor(
  tier: "anonymous" | "identified",
  token: string,
  endUserId: string | null,
) {
  return new Response(
    JSON.stringify({
      visitor_token: token,
      expires_in: 900,
      tier,
      end_user_id: endUserId,
    }),
    { status: 201, headers: { "Content-Type": "application/json" } },
  );
}

describe("TokenSession after dispose()", () => {
  it("a mint landing after dispose sets no token, arms no timer, fires no onMinted", async () => {
    vi.useFakeTimers();
    try {
      let releaseMint: (response: Response) => void = () => undefined;
      const parkedMint = new Promise<Response>((resolve) => {
        releaseMint = resolve;
      });
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockImplementationOnce(() => parkedMint)
        // The request that waited on the parked mint still goes out.
        .mockResolvedValueOnce(new Response("{}", { status: 200 }))
        // The next request after dispose mints afresh rather than
        // riding the late token.
        .mockResolvedValueOnce(mintResponse("anonymous", "fresh-token"))
        .mockResolvedValueOnce(new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const onMinted = vi.fn();
      const session = new TokenSession({
        publishableKey: "pk_test_x",
        baseUrl: "https://api.example.test",
        onMinted,
      });

      const late = session.authorizedFetch("https://api.example.test/x");
      session.dispose();
      releaseMint(mintResponse("anonymous", "late-token"));
      await late;

      expect(onMinted).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);

      const response = await session.authorizedFetch(
        "https://api.example.test/y",
      );
      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(bearerOf(fetchMock.mock.calls[3][1])).toBe("Bearer fresh-token");
      expect(onMinted).toHaveBeenCalledTimes(1);
      session.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("TokenSession disposed during the body read", () => {
  it("a dispose landing between the response and its JSON writes nothing either", async () => {
    vi.useFakeTimers();
    try {
      let releaseBody: (body: unknown) => void = () => undefined;
      const parkedBody = new Promise<unknown>((resolve) => {
        releaseBody = resolve;
      });
      // The fetch answers at once; only the body read is parked.
      const bodyRead = { began: false };
      const parkedResponse = {
        ok: true,
        status: 201,
        json: () => {
          bodyRead.began = true;
          return parkedBody;
        },
      } as unknown as Response;
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(parkedResponse)
        .mockResolvedValueOnce(new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const onMinted = vi.fn();
      const session = new TokenSession({
        publishableKey: "pk_test_x",
        baseUrl: "https://api.example.test",
        onMinted,
      });

      const late = session.authorizedFetch("https://api.example.test/x");
      // Let the mint reach the body read before disposing.
      for (let turns = 0; !bodyRead.began && turns < 20; turns += 1) {
        await Promise.resolve();
      }
      expect(bodyRead.began).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      session.dispose();
      releaseBody({
        visitor_token: "late-token",
        expires_in: 900,
        tier: "anonymous",
      });
      await late;

      expect(onMinted).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      session.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("TokenSession and the host's userId", () => {
  const config = {
    publishableKey: "pk_test_x",
    baseUrl: "https://api.example.test",
    getEndUserToken: () => "customer-jwt",
    expectedEndUserId: "user-a",
  };

  it("re-mints once when the identified mint names another user, then serves the agreeing token", async () => {
    const onMinted = vi.fn();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(mintResponseFor("identified", "wrong", "user-b"))
      .mockResolvedValueOnce(mintResponseFor("identified", "right", "user-a"))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const session = new TokenSession({ ...config, onMinted });

    await session.authorizedFetch("https://api.example.test/x");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(bearerOf(fetchMock.mock.calls[2][1])).toBe("Bearer right");
    expect(onMinted).toHaveBeenCalledTimes(1);
    expect(onMinted.mock.calls[0][0]).toMatchObject({ end_user_id: "user-a" });
    session.dispose();
  });

  it("fails closed after the retry still disagrees: no token, a setup-shaped onMintFailed, no onMinted", async () => {
    const onMinted = vi.fn();
    const onMintFailed = vi.fn();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(mintResponseFor("identified", "wrong", "user-b"))
      .mockResolvedValueOnce(mintResponseFor("identified", "wrong2", "user-b"));
    vi.stubGlobal("fetch", fetchMock);
    const session = new TokenSession({ ...config, onMinted, onMintFailed });

    await expect(
      session.authorizedFetch("https://api.example.test/x"),
    ).rejects.toMatchObject({
      code: END_USER_ID_MISMATCH,
      message:
        "The signed-in user this page names is not the user the server verified. Keep userId in step with the user your backend signs the end-user token for.",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onMinted).not.toHaveBeenCalled();
    expect(onMintFailed).toHaveBeenCalledTimes(1);
    expect(onMintFailed).toHaveBeenCalledWith(
      expect.objectContaining({ code: END_USER_ID_MISMATCH }),
    );
    session.dispose();
  });

  it("a proactive re-mint whose retry still disagrees leaves no token in service", async () => {
    vi.useFakeTimers();
    try {
      const onMintFailed = vi.fn();
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(mintResponseFor("identified", "tok-a", "user-a"))
        .mockResolvedValueOnce(new Response("{}", { status: 200 }))
        // The proactive re-mint at 80% of the TTL: the host's vouch now
        // belongs to someone else, twice.
        .mockResolvedValueOnce(mintResponseFor("identified", "tok-b", "user-b"))
        .mockResolvedValueOnce(
          mintResponseFor("identified", "tok-b2", "user-b"),
        )
        // The next request mints afresh instead of riding tok-a.
        .mockResolvedValueOnce(
          mintResponseFor("identified", "tok-a2", "user-a"),
        )
        .mockResolvedValueOnce(new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const session = new TokenSession({ ...config, onMintFailed });

      await session.authorizedFetch("https://api.example.test/x");
      expect(bearerOf(fetchMock.mock.calls[1][1])).toBe("Bearer tok-a");

      await vi.advanceTimersByTimeAsync(900 * 0.8 * 1000);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(onMintFailed).toHaveBeenCalledWith(
        expect.objectContaining({ code: END_USER_ID_MISMATCH }),
      );
      expect(vi.getTimerCount()).toBe(0);

      await session.authorizedFetch("https://api.example.test/y");
      expect(fetchMock).toHaveBeenCalledTimes(6);
      expect(bearerOf(fetchMock.mock.calls[5][1])).toBe("Bearer tok-a2");
      session.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("trusts a mint without end_user_id (an older server) and an anonymous mint alike", async () => {
    const onMinted = vi.fn();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(mintResponse("identified", "legacy"))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const session = new TokenSession({ ...config, onMinted });

    await session.authorizedFetch("https://api.example.test/x");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onMinted).toHaveBeenCalledTimes(1);
    session.dispose();
  });
});
