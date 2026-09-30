import type {
  ServingErrorCodeOnTheWire,
  ServingErrorEnvelope,
} from "../contract/errors.js";

/**
 * A non-2xx answer from a /serving/v1 surface, decoded from the contract's
 * error envelope. `message` is the server's human sentence; the package
 * substitutes its own copy for the codes it knows (see error-copy.ts).
 */
export class ServingApiError extends Error {
  readonly code: ServingErrorCodeOnTheWire;
  readonly status: number;
  // From the Retry-After header when the server sent one (RATE_LIMITED
  // and SUBSCRIPTION_CANNOT_PAY do; ASSISTANT_UNFUNDED deliberately does
  // not — money, not time, changes that answer).
  readonly retryAfterSeconds: number | null;
  // The envelope's structured half, when the server sent one — e.g.
  // SUBSCRIPTION_CONNECT_REQUIRED's `providers` list. Its reader is the
  // connect gate (connect-gate.ts), which projects it for the connect
  // panel, so that surface touches no transport code.
  readonly details: unknown;

  constructor(options: {
    code: ServingErrorCodeOnTheWire;
    status: number;
    message: string;
    retryAfterSeconds: number | null;
    details?: unknown;
  }) {
    super(options.message);
    this.name = "ServingApiError";
    this.code = options.code;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.details = options.details;
  }
}

export async function parseServingError(
  response: Response,
): Promise<ServingApiError> {
  const envelope = await _readEnvelopeIfPresent(response);
  return new ServingApiError({
    code: envelope?.error.code ?? "UNKNOWN",
    status: response.status,
    message:
      envelope?.error.message ??
      "The assistant service answered unexpectedly. Please try again.",
    retryAfterSeconds: _retryAfterSecondsOf(response),
    details: envelope?.error.details,
  });
}

async function _readEnvelopeIfPresent(
  response: Response,
): Promise<ServingErrorEnvelope | null> {
  try {
    const body: unknown = await response.json();
    if (_looksLikeErrorEnvelope(body)) {
      return body;
    }
  } catch {
    // A non-JSON error body (a proxy page, an empty response) still needs
    // a usable error — the fallback envelope covers it.
  }
  return null;
}

function _looksLikeErrorEnvelope(body: unknown): body is ServingErrorEnvelope {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return false;
  }
  const error = body.error;
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error
  );
}

function _retryAfterSecondsOf(response: Response): number | null {
  const header = response.headers.get("Retry-After");
  if (header === null) {
    return null;
  }
  const seconds = Number.parseInt(header, 10);
  return Number.isNaN(seconds) ? null : seconds;
}
