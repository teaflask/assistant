import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActionIntent } from "../src/contract/actions-adapter";
import {
  actionIntentOf,
  performActionIntent,
} from "../src/transport/actions-adapter";

// Mirrors the adapter's visible cut marker — asserted verbatim so a
// silent truncation can never come back.
const TRUNCATION_NOTICE =
  "… [truncated: the response was larger than fits here]";

// The wire's snake_case intent, exactly as the server builds it.
const WIRE_INTENT: Record<string, unknown> = {
  action: { slug: "cancel-subscription", title: "Cancel a subscription" },
  method: "POST",
  path_template: "/subscriptions/{subscription_id}",
  path_params: { subscription_id: "sub_42" },
  query: {},
  body: { reason: "Too much tea." },
};

function intentOf(overrides: Partial<ActionIntent> = {}): ActionIntent {
  return {
    action: { slug: "cancel-subscription", title: "Cancel a subscription" },
    method: "POST",
    pathTemplate: "/subscriptions/{subscription_id}",
    pathParams: { subscription_id: "sub_42" },
    query: {},
    body: { reason: "Too much tea." },
    ...overrides,
  };
}

function responseOf(
  body: string,
  init: { status?: number; contentType?: string } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "Content-Type": init.contentType ?? "application/json" },
  });
}

// The door's own measure of a string body: len(json.dumps(text)) with
// Python's defaults (ensure_ascii). The independent spec the bounded
// bodies are asserted against.
function pythonStringLengthOf(text: string): number {
  const shortEscapes = [0x08, 0x09, 0x0a, 0x0c, 0x0d];
  let length = 2;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code > 0x7f) {
      length += 6;
    } else if (code === 0x22 || code === 0x5c) {
      length += 2;
    } else if (code < 0x20) {
      length += shortEscapes.includes(code) ? 2 : 6;
    } else {
      length += 1;
    }
  }
  return length;
}

function stringBodyOf(result: { body: unknown }): string {
  if (typeof result.body !== "string") {
    throw new Error("Expected the body to have degraded to a string.");
  }
  return result.body;
}

function fetchAnswering(response: Response) {
  const mock = vi.fn(() => Promise.resolve(response));
  vi.stubGlobal("fetch", mock);
  return mock;
}

function requestedUrlOf(mock: ReturnType<typeof vi.fn>): string {
  const [url] = mock.mock.calls[0] as [string, RequestInit?];
  return url;
}

function requestedInitOf(mock: ReturnType<typeof vi.fn>): RequestInit {
  const [, init] = mock.mock.calls[0] as [string, RequestInit?];
  if (init === undefined) {
    throw new Error("The fetch was made without a RequestInit.");
  }
  return init;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("actionIntentOf", () => {
  it("narrows the wire's snake_case payload into the frozen camelCase intent", () => {
    expect(actionIntentOf(WIRE_INTENT)).toEqual(intentOf());
  });

  it("omits body when the wire carries none or carries null", () => {
    expect(actionIntentOf({ ...WIRE_INTENT, body: null })).toEqual(
      intentOf({ body: undefined }),
    );
    expect(actionIntentOf({ ...WIRE_INTENT, body: undefined })).toEqual(
      intentOf({ body: undefined }),
    );
  });

  it("answers null for every malformed shape instead of guessing", () => {
    const malformed: (Record<string, unknown> | null)[] = [
      null,
      {},
      { ...WIRE_INTENT, action: undefined },
      { ...WIRE_INTENT, action: { slug: "cancel-subscription" } },
      { ...WIRE_INTENT, action: { slug: "", title: "Cancel" } },
      { ...WIRE_INTENT, method: 7 },
      { ...WIRE_INTENT, path_template: "" },
      { ...WIRE_INTENT, path_params: "sub_42" },
      { ...WIRE_INTENT, query: ["a"] },
    ];
    for (const wire of malformed) {
      expect(actionIntentOf(wire)).toBeNull();
    }
  });
});

describe("the cookies adapter", () => {
  it("assembles the URL from the template and fetches with credentials included", async () => {
    const mock = fetchAnswering(responseOf('{"status": "cancelled"}'));
    const result = await performActionIntent(
      { kind: "cookies", baseUrl: "https://api.customer.test" },
      intentOf(),
    );
    expect(requestedUrlOf(mock)).toBe(
      "https://api.customer.test/subscriptions/sub_42",
    );
    const init = requestedInitOf(mock);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.body).toBe('{"reason":"Too much tea."}');
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(result).toEqual({
      status: 200,
      body: { status: "cancelled" },
      truncated: false,
    });
  });

  it("sends no body and no content type when the intent carries none", async () => {
    const mock = fetchAnswering(responseOf("{}"));
    await performActionIntent(
      { kind: "cookies", baseUrl: "https://api.customer.test" },
      intentOf({ method: "GET", body: undefined }),
    );
    const init = requestedInitOf(mock);
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({});
  });

  it("encodes path params, strips the base's trailing slash, and appends the query string", async () => {
    const mock = fetchAnswering(responseOf("{}"));
    await performActionIntent(
      { kind: "cookies", baseUrl: "https://api.customer.test/" },
      intentOf({
        pathParams: { subscription_id: "sub 42/x" },
        query: { limit: 5, active: true, note: "a b", skipped: null },
      }),
    );
    expect(requestedUrlOf(mock)).toBe(
      "https://api.customer.test/subscriptions/sub%2042%2Fx" +
        "?limit=5&active=true&note=a+b",
    );
  });

  it("fails before any fetch when the template names a parameter the intent did not supply", async () => {
    const mock = fetchAnswering(responseOf("{}"));
    await expect(
      performActionIntent(
        { kind: "cookies", baseUrl: "https://api.customer.test" },
        intentOf({ pathParams: {} }),
      ),
    ).rejects.toThrow("names a {subscription_id} parameter");
    expect(mock).not.toHaveBeenCalled();
  });

  it("returns a non-2xx status as a result, never a failure", async () => {
    fetchAnswering(responseOf('{"error": "not found"}', { status: 404 }));
    const result = await performActionIntent(
      { kind: "cookies", baseUrl: "https://api.customer.test" },
      intentOf(),
    );
    expect(result).toEqual({
      status: 404,
      body: { error: "not found" },
      truncated: false,
    });
  });

  it("carries a non-JSON response body as bounded, marked text", async () => {
    fetchAnswering(
      responseOf("x".repeat(20_000), { contentType: "text/plain" }),
    );
    const result = await performActionIntent(
      { kind: "cookies", baseUrl: "https://api.customer.test" },
      intentOf(),
    );
    expect(result.status).toBe(200);
    const body = stringBodyOf(result);
    expect(body.startsWith("xxx")).toBe(true);
    expect(body.endsWith(TRUNCATION_NOTICE)).toBe(true);
    expect(pythonStringLengthOf(body)).toBeLessThanOrEqual(16_000 + 2);
    expect(result.truncated).toBe(true);
  });

  it("bounds an oversized JSON body too — the door's cap guards both shapes", async () => {
    const oversized = `{"items": "${"x".repeat(20_000)}"}`;
    fetchAnswering(responseOf(oversized));
    const result = await performActionIntent(
      { kind: "cookies", baseUrl: "https://api.customer.test" },
      intentOf(),
    );
    const body = stringBodyOf(result);
    expect(body.startsWith('{"items":"x')).toBe(true);
    expect(body.endsWith(TRUNCATION_NOTICE)).toBe(true);
    expect(body.length).toBeGreaterThan(15_000);
    expect(pythonStringLengthOf(body)).toBeLessThanOrEqual(16_000 + 2);
    expect(result.truncated).toBe(true);
  });

  it("bounds a non-ASCII body by its escaped footprint — small in JS chars is not small at the door", async () => {
    // ~5k CJK chars: tiny by JS length, but the door's ensure_ascii
    // serializer sees 6 chars per unit — 30k+ without this bound.
    fetchAnswering(
      responseOf(JSON.stringify({ status: "已取消".repeat(1_700) })),
    );
    const result = await performActionIntent(
      { kind: "cookies", baseUrl: "https://api.customer.test" },
      intentOf(),
    );
    const body = stringBodyOf(result);
    expect(pythonStringLengthOf(body)).toBeLessThanOrEqual(16_000 + 2);
    expect(body.length).toBeGreaterThan(2_000);
    expect(result.truncated).toBe(true);
  });

  it("bounds a quote-dense body whose re-escaping would double it past the cap", async () => {
    // Raw JS length just under the old bound; every quote doubles when
    // the truncated text re-escapes as a JSON string at the door.
    const quoteDense = JSON.stringify(
      Array.from({ length: 1_400 }, () => ({ a: "b" })),
    );
    fetchAnswering(
      responseOf(`{"items": "${quoteDense.replace(/"/g, '\\"')}"}`),
    );
    const result = await performActionIntent(
      { kind: "cookies", baseUrl: "https://api.customer.test" },
      intentOf(),
    );
    const body = stringBodyOf(result);
    expect(pythonStringLengthOf(body)).toBeLessThanOrEqual(16_000 + 2);
    expect(result.truncated).toBe(true);
  });

  it("lets a modest non-ASCII body ride through untouched", async () => {
    fetchAnswering(responseOf(JSON.stringify({ status: "已取消" })));
    const result = await performActionIntent(
      { kind: "cookies", baseUrl: "https://api.customer.test" },
      intentOf(),
    );
    expect(result.body).toEqual({ status: "已取消" });
    expect(result.truncated).toBe(false);
  });
});

describe("the headers adapter", () => {
  it("asks getHeaders per intent, awaits it, and lets the host's headers win", async () => {
    const mock = fetchAnswering(responseOf("{}"));
    const seen: ActionIntent[] = [];
    await performActionIntent(
      {
        kind: "headers",
        baseUrl: "https://api.customer.test",
        getHeaders: (intent) => {
          seen.push(intent);
          return Promise.resolve({
            Authorization: "Bearer tok",
            "Content-Type": "application/json; charset=utf-8",
          });
        },
      },
      intentOf(),
    );
    expect(seen).toEqual([intentOf()]);
    const init = requestedInitOf(mock);
    expect(init.headers).toEqual({
      Authorization: "Bearer tok",
      "Content-Type": "application/json; charset=utf-8",
    });
    expect(init.credentials).toBeUndefined();
  });
});

describe("the request adapter", () => {
  it("hands the whole intent to the host's wrapper and wraps the resolved body as a 200", async () => {
    const seen: ActionIntent[] = [];
    const result = await performActionIntent(
      {
        kind: "request",
        execute: (intent) => {
          seen.push(intent);
          return Promise.resolve({ status: "cancelled" });
        },
      },
      intentOf(),
    );
    expect(seen).toEqual([intentOf()]);
    expect(result).toEqual({
      status: 200,
      body: { status: "cancelled" },
      truncated: false,
    });
  });

  it("lands a wrapper that resolves nothing as a null body — the wire requires one", async () => {
    const result = await performActionIntent(
      { kind: "request", execute: () => Promise.resolve(undefined) },
      intentOf(),
    );
    expect(result).toEqual({ status: 200, body: null, truncated: false });
  });

  it("bounds an oversized resolved body as its JSON text", async () => {
    const result = await performActionIntent(
      {
        kind: "request",
        execute: () => Promise.resolve({ items: "x".repeat(20_000) }),
      },
      intentOf(),
    );
    const body = stringBodyOf(result);
    expect(body.startsWith('{"items":"x')).toBe(true);
    expect(body.endsWith(TRUNCATION_NOTICE)).toBe(true);
    expect(pythonStringLengthOf(body)).toBeLessThanOrEqual(16_000 + 2);
    expect(result.truncated).toBe(true);
  });

  it("lets a rejection propagate — the handler reports it as a failed execution", async () => {
    await expect(
      performActionIntent(
        {
          kind: "request",
          execute: () => Promise.reject(new Error("session expired")),
        },
        intentOf(),
      ),
    ).rejects.toThrow("session expired");
  });
});
