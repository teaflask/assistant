// How one server-built http_intent becomes a real HTTP request through
// the host's actions adapter — transport, so it may hold this package's
// fetch. React-free on purpose: the narrowing, URL assembly, and result
// synthesis are the risky parts, and they unit-test in node. Whatever
// the adapter kind, the package itself synthesizes the contract's strict
// HttpIntentResult — a host can never malform the wire shape into a 422.

import type {
  ActionIntent,
  ActionsAdapter,
  CookiesActionsAdapter,
  HeadersActionsAdapter,
} from "../contract/actions-adapter.js";
import type { HttpIntentResult } from "../generated/models/index.js";
import {
  boundedTextOf,
  doorCostOfText,
  doorLengthCeilingOf,
} from "./door-budget.js";

// The body bound is a ceiling of the tool-results door's own serialized
// metric (see door-budget.ts), sized to leave headroom for the result's
// sibling fields under the door's 20k cap.
const RESPONSE_BODY_MAX_CHARS = 16_000;
// The visible cut marker (the read_page posture): the model reads the
// truncation in the text, and the wire's truncated flag says it too.
const TRUNCATION_NOTICE =
  "… [truncated: the response was larger than fits here]";

/**
 * Narrow the wire's snake_case intent payload into the frozen camelCase
 * ActionIntent. The server built it from the vetted catalog row, so this
 * is only wire defense: any malformed shape answers null and the caller
 * reports the canned unusable-intent error without touching the adapter.
 */
export function actionIntentOf(
  wire: Record<string, unknown> | null,
): ActionIntent | null {
  if (wire === null) {
    return null;
  }
  const action = _actionIdentityOf(wire.action);
  const method = _nonEmptyStringOf(wire.method);
  const pathTemplate = _nonEmptyStringOf(wire.path_template);
  const pathParams = _recordOf(wire.path_params);
  const query = _recordOf(wire.query);
  if (
    action === null ||
    method === null ||
    pathTemplate === null ||
    pathParams === null ||
    query === null
  ) {
    return null;
  }
  const intent: ActionIntent = {
    action,
    method,
    pathTemplate,
    pathParams,
    query,
  };
  if (wire.body !== null && wire.body !== undefined) {
    intent.body = wire.body;
  }
  return intent;
}

/** Execute one intent through whichever adapter the host wired. */
export async function performActionIntent(
  adapter: ActionsAdapter,
  intent: ActionIntent,
): Promise<HttpIntentResult> {
  if (adapter.kind === "request") {
    // The host's wrapper owns transport: a resolved value is the API's
    // response body, a rejection propagates as a failed execution.
    return _intentResultOf(200, await adapter.execute(intent));
  }
  const response = await fetch(
    _urlOf(adapter.baseUrl, intent),
    await _requestInitOf(adapter, intent),
  );
  return _resultOf(response);
}

function _intentResultOf(status: number, rawBody: unknown): HttpIntentResult {
  const landed = _landableBodyOf(rawBody);
  return { status, body: landed.body, truncated: landed.truncated };
}

function _landableBodyOf(body: unknown): { body: unknown; truncated: boolean } {
  // The wire's body field is required, so a wrapper that resolves nothing
  // (a 204-style empty answer) still has to land; an unserializable value
  // has no wire form at all. (The TS lib types stringify as
  // always-string; it answers undefined for undefined/function/symbol.)
  if (body === undefined) {
    return { body: null, truncated: false };
  }
  const serialized = JSON.stringify(body) as string | undefined;
  if (serialized === undefined) {
    return { body: null, truncated: false };
  }
  if (doorLengthCeilingOf(serialized) <= RESPONSE_BODY_MAX_CHARS) {
    return { body, truncated: false };
  }
  // Too big for the door: degrade to a bounded string — the raw text for
  // a string body, the JSON text for a structured one — truncated by its
  // own escaped footprint so the degraded delivery is landable too, with
  // the visible marker so the cut is never mistaken for the whole.
  const bounded = boundedTextOf(
    typeof body === "string" ? body : serialized,
    RESPONSE_BODY_MAX_CHARS - doorCostOfText(TRUNCATION_NOTICE),
  );
  return { body: bounded + TRUNCATION_NOTICE, truncated: true };
}

async function _requestInitOf(
  adapter: CookiesActionsAdapter | HeadersActionsAdapter,
  intent: ActionIntent,
): Promise<RequestInit> {
  const headers: Record<string, string> = {};
  if (intent.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (adapter.kind === "headers") {
    // The host's headers land last so they win any collision.
    Object.assign(headers, await adapter.getHeaders(intent));
  }
  return {
    method: intent.method,
    headers,
    ...(adapter.kind === "cookies" ? { credentials: "include" as const } : {}),
    ...(intent.body !== undefined ? { body: JSON.stringify(intent.body) } : {}),
  };
}

function _urlOf(baseUrl: string, intent: ActionIntent): string {
  return (
    _withoutTrailingSlash(baseUrl) +
    _substitutedPathOf(intent) +
    _queryStringOf(intent.query)
  );
}

function _withoutTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function _substitutedPathOf(intent: ActionIntent): string {
  return intent.pathTemplate.replace(
    /\{(\w+)\}/g,
    (_placeholder, name: string) => {
      const value = intent.pathParams[name];
      if (value === undefined) {
        throw new Error(
          `The intent's path names a {${name}} parameter it did not supply.`,
        );
      }
      return encodeURIComponent(_parameterTextOf(value));
    },
  );
}

function _parameterTextOf(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  // The server validated the params against the action's own schemas, so
  // a composite value's JSON text is the honest encoding — never the
  // default "[object Object]".
  return JSON.stringify(value);
}

function _queryStringOf(query: Record<string, unknown>): string {
  const parameters = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value !== null && value !== undefined) {
      parameters.append(name, _parameterTextOf(value));
    }
  }
  const encoded = parameters.toString();
  return encoded === "" ? "" : `?${encoded}`;
}

async function _resultOf(response: Response): Promise<HttpIntentResult> {
  // A non-2xx status is a result, never a failure: the assistant
  // confirms or explains from the API's real answer. Only transport
  // trouble (fetch throwing) reads as a failed execution.
  return _intentResultOf(response.status, _jsonOrTextOf(await response.text()));
}

function _jsonOrTextOf(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function _actionIdentityOf(
  value: unknown,
): { slug: string; title: string } | null {
  const record = _recordOf(value);
  if (record === null) {
    return null;
  }
  const slug = _nonEmptyStringOf(record.slug);
  const title = _nonEmptyStringOf(record.title);
  if (slug === null || title === null) {
    return null;
  }
  return { slug, title };
}

function _nonEmptyStringOf(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function _recordOf(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}
