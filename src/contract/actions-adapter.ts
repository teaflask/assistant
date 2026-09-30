// The actions-adapter contract — the one seam a host wires to let the
// assistant act against its own API. FROZEN and
// additive-only forever: fields may be added, never renamed, retyped, or
// removed. The package never sniffs the host's fetch and never asks for
// per-endpoint registration — one adapter serves the whole catalog. The
// request's origin always belongs to the adapter: intents carry only a
// relative path template, so a compromised turn cannot point a request
// anywhere the host didn't choose.

// A host's coding agent authors its adapter against this file as
// published in the adapters guide (docs.teaflask.com/adapters.md).
/** The catalog identity of the action being executed — server-built, never model prose. */
export interface ActionIntentAction {
  slug: string;
  title: string;
}

/**
 * One action the assistant asks this page to perform: the server-built
 * request — method, path template, validated arguments — from the org's
 * vetted actions catalog. `pathTemplate` is app-relative
 * ("/subscriptions/{subscription_id}"); the origin is always the
 * adapter's own.
 */
export interface ActionIntent {
  action: ActionIntentAction;
  method: string;
  pathTemplate: string;
  pathParams: Record<string, unknown>;
  query: Record<string, unknown>;
  /** The JSON request body; absent when the action sends none. */
  body?: unknown;
}
/**
 * Session-cookie APIs: the package assembles the URL under `baseUrl` and
 * fetches with credentials included — the request runs in the user's own
 * session, so the assistant can do nothing the user couldn't.
 */
export interface CookiesActionsAdapter {
  kind: "cookies";
  baseUrl: string;
}

/**
 * Token-auth APIs: the package assembles the URL under `baseUrl` and
 * asks `getHeaders` per action (may be async — mint or refresh inside).
 */
export interface HeadersActionsAdapter {
  kind: "headers";
  baseUrl: string;
  getHeaders: (
    intent: ActionIntent,
  ) => Record<string, string> | Promise<Record<string, string>>;
}

/**
 * Full control: the host's own request wrapper receives the whole intent
 * and resolves with the API's response body. A resolved promise reads as
 * a success; a rejection reads as a failed execution and is reported to
 * the assistant as such — the convention every wrapper in this class
 * (an orval mutator, an axios instance) already follows by throwing on
 * non-2xx.
 */
export interface RequestActionsAdapter {
  kind: "request";
  execute: (intent: ActionIntent) => Promise<unknown>;
}

export type ActionsAdapter =
  CookiesActionsAdapter | HeadersActionsAdapter | RequestActionsAdapter;
