// The subscription-connect surfaces. The shapes are generated
// from serving-openapi.json; this file keeps the package's public names
// stable over the generated ones, and spells the one message the
// server's callback page posts to the opener, which no OpenAPI covers.

import type { SubscriptionProvider } from "../generated/models/index.js";

export type {
  BeginSubscriptionAuthorizationResponse as SubscriptionAuthorization,
  CompleteSubscriptionAuthorizationRequest as SubscriptionAuthorizationCompletionRequest,
  CompleteSubscriptionAuthorizationResponse as SubscriptionAuthorizationCompletion,
  ServingSubscriptionStatus as SubscriptionStatus,
  SubscriptionCredentialState,
  SubscriptionProvider,
} from "../generated/models/index.js";

/** The `type` of the message the callback page posts to the opener. */
export const SUBSCRIPTION_CONNECT_MESSAGE_TYPE =
  "teaflask.subscription_connect";

/** What the callback page posts to the origin bound at begin — and only
 *  there; a sign-in begun without an allowed origin posts nothing. The
 *  opener MUST check event.origin against the server's origin before
 *  reading it. `code` carries what completeSubscriptionAuthorization
 *  needs; `denied` is a declined consent (the account cannot share its
 *  plan, or the visitor cancelled); `failed` is a return leg that
 *  carried no code. */
export type SubscriptionConnectMessage =
  | {
      type: typeof SUBSCRIPTION_CONNECT_MESSAGE_TYPE;
      provider: SubscriptionProvider;
      kind: "code";
      code: string;
      state: string;
      client_id: string | null;
    }
  | {
      type: typeof SUBSCRIPTION_CONNECT_MESSAGE_TYPE;
      provider: SubscriptionProvider;
      kind: "denied" | "failed";
    };

/** The opener's parse of a message event: the server's own origin, a
 *  window as the source, the message shape, and the provider this flow
 *  began — anything else is not the callback page talking to this flow.
 *  No source identity beyond "a window": the origin pins the sender to
 *  the server, whose only poster is the callback page, and the server's
 *  bearer and single-use checks bind the finish; a popup-only rule would
 *  drop the fallback link's tab. */
export function subscriptionConnectMessageOf(
  event: MessageEvent,
  serverOrigin: string,
  provider: SubscriptionProvider,
): SubscriptionConnectMessage | null {
  if (event.origin !== serverOrigin || event.source === null) {
    return null;
  }
  const data: unknown = event.data;
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const record = data as Record<string, unknown>;
  if (
    record.type !== SUBSCRIPTION_CONNECT_MESSAGE_TYPE ||
    record.provider !== provider
  ) {
    return null;
  }
  if (record.kind === "denied" || record.kind === "failed") {
    return {
      type: SUBSCRIPTION_CONNECT_MESSAGE_TYPE,
      provider,
      kind: record.kind,
    };
  }
  if (
    record.kind === "code" &&
    typeof record.code === "string" &&
    typeof record.state === "string"
  ) {
    return {
      type: SUBSCRIPTION_CONNECT_MESSAGE_TYPE,
      provider,
      kind: "code",
      code: record.code,
      state: record.state,
      client_id: typeof record.client_id === "string" ? record.client_id : null,
    };
  }
  return null;
}
