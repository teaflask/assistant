/**
 * The tool-result/v1 envelope parser, rescued from the retired ui_spec
 * result grammar. The producer is the action adapter's
 * ExecutionOutcome ({ok: true, result} with http_intent results shaped
 * {status, headers, body, truncated}); the consumer is the tool-view
 * call assembly: toolCallPresentationOf parses `resultText`
 * through here into `call.result`, with the null refusal surfacing as
 * the call's honest `truncated` flag.
 */

/**
 * The renderable payload: a tool-result/v1 success envelope unwrapped —
 * protocol knowledge, which the package may hold; a customer's catalog
 * it may not — and every other document passed through untouched. Null refuses
 * the result entirely: a body the client degraded to fit the size cap
 * (truncated) must never structure, since a complete-looking component
 * over a cut payload is a wrong claim. The envelope check is exact-keys
 * ({ok, result} and nothing else, ok === true) so an arbitrary payload
 * that merely mentions ok can never misfire the unwrap; a failure
 * envelope carries a third key (instruction) and never matches. The
 * {payload} box distinguishes a legitimately null-ish payload from the
 * refusal.
 */
export function toolResultEnvelopePayloadOf(
  parsed: unknown,
): { payload: unknown } | null {
  if (!_isRecord(parsed)) {
    return { payload: parsed };
  }
  const keys = Object.keys(parsed);
  const envelopeShaped =
    keys.length === 2 &&
    _hasOwn(parsed, "ok") &&
    _hasOwn(parsed, "result") &&
    parsed.ok === true &&
    _isRecord(parsed.result);
  if (!envelopeShaped) {
    return { payload: parsed };
  }
  const result = parsed.result as Record<string, unknown>;
  if (result.truncated === true) {
    return null;
  }
  // http_intent-shaped: the customer's response JSON rides in body, the
  // transport facts (status, headers) around it are not the data.
  if (typeof result.status === "number" && _hasOwn(result, "body")) {
    return { payload: result.body };
  }
  return { payload: result };
}

/** Own-key membership, never the prototype chain: result keys arrive
 *  from customer payloads, so a key naming an Object.prototype member
 *  (constructor, toString, …) must read as data and nothing more.
 *  (hasOwnProperty.call, not Object.hasOwn — the dashboard's TS lib
 *  predates ES2022.) */
function _hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function _isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
