// The Orval mutator behind every generated /serving/v1 call. Sessions are
// per-provider (never module state), so each call carries its TokenSession
// in the options — Orval propagates this type onto the generated functions'
// options parameter.

import { parseServingError } from "./serving-error.js";
import type { TokenSession } from "./token-session.js";

// session is optional in the type only because the generated call sites
// spread a plain RequestInit; every real call must carry one, and the
// serving-api wrappers always do.
export type ServingRequestInit = RequestInit & { session?: TokenSession };

export async function servingFetch<Body>(
  url: string,
  init: ServingRequestInit,
): Promise<Body> {
  const { session, ...requestInit } = init;
  if (session === undefined) {
    throw new Error(
      "This serving call has no TokenSession. Call it through the " +
        "serving-api wrappers, which thread the session into options.",
    );
  }
  const response = await session.authorizedFetch(
    `${session.baseUrl}${url}`,
    requestInit,
  );
  if (!response.ok) {
    throw await parseServingError(response);
  }
  // 204 carries no body by definition (the disconnect door answers it);
  // .json() on the empty body would throw and turn a success into an error.
  if (response.status === 204) {
    return undefined as Body;
  }
  return (await response.json()) as Body;
}
