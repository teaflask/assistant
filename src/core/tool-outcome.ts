// The tool-outcome lift: @ag-ui/client 1.0 enforces its event schema
// between the transport and every subscriber, stripping any top-level field
// the schema does not know — which is where the serving wire carries a
// TOOL_CALL_RESULT's five optional extras. Event metadata is open by key
// and survives enforcement, so the transport moves the extras under
// teaflask's namespace before the client sees them, and every reader asks
// the namespace, never the top level. The wire itself is unchanged.

import { EventType } from "@ag-ui/core";
import type { BaseEvent } from "@ag-ui/core";
import { map, type Observable } from "rxjs";

const TOOL_OUTCOME_FIELDS = [
  "error",
  "refused",
  "cancelled",
  "truncated",
  "offloaded",
] as const;

type ToolOutcomeField = (typeof TOOL_OUTCOME_FIELDS)[number];

/** The lifted extras, values as the wire sent them: each reader keeps its
 *  own literal check (the sentence families want a string, the flag
 *  families want the literal true). */
export type ToolOutcome = Partial<Record<ToolOutcomeField, unknown>>;

const NAMESPACE = "teaflask";
const OUTCOME_KEY = "toolOutcome";

function _record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A TOOL_CALL_RESULT with its extras moved under
 *  `metadata.teaflask.toolOutcome`; any other event, a result carrying
 *  none, or one whose metadata is present and not an object comes back as
 *  the same reference. */
export function withToolOutcomeLifted(event: BaseEvent): BaseEvent {
  if (event.type !== EventType.TOOL_CALL_RESULT) {
    return event;
  }
  const source: Record<string, unknown> = event;
  const lifted: Record<string, unknown> = {};
  for (const field of TOOL_OUTCOME_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      lifted[field] = source[field];
    }
  }
  if (Object.keys(lifted).length === 0) {
    return event;
  }
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!(TOOL_OUTCOME_FIELDS as readonly string[]).includes(key)) {
      rest[key] = value;
    }
  }
  // Metadata the protocol would reject — present and not an object — is
  // left exactly as sent: the client's validator, not the lift, decides
  // what becomes of it. Inside a valid object the teaflask namespace is
  // this package's own: a value there that is not an object was never
  // written by this package and never read by anything, and the wire's
  // extras must survive, so the lift takes the namespace over rather than
  // letting the extras be stripped in silence.
  const metadata =
    source.metadata === undefined ? {} : _record(source.metadata);
  if (metadata === null) {
    return event;
  }
  const namespace = _record(metadata[NAMESPACE]) ?? {};
  const outcome = _record(namespace[OUTCOME_KEY]) ?? {};
  rest.metadata = {
    ...metadata,
    [NAMESPACE]: {
      ...namespace,
      [OUTCOME_KEY]: { ...outcome, ...lifted },
    },
  };
  return rest as unknown as BaseEvent;
}

/** The lifted extras of an event — empty for anything that carries none,
 *  a non-object, or extras left on the top level (enforcement would have
 *  dropped those; reading them here would report a state the pipeline
 *  never delivers). */
export function toolOutcomeOf(event: unknown): ToolOutcome {
  const source = _record(event);
  if (source === null) {
    return {};
  }
  const namespace = _record(_record(source.metadata)?.[NAMESPACE]);
  const outcome = _record(namespace?.[OUTCOME_KEY]);
  if (outcome === null) {
    return {};
  }
  const result: ToolOutcome = {};
  for (const field of TOOL_OUTCOME_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(outcome, field)) {
      result[field] = outcome[field];
    }
  }
  return result;
}

/** The transport seam: pipe a run's events through the lift before the
 *  client enforces its schema. A plain function over the Observable so a
 *  host agent needs no rxjs import of its own. */
export function liftToolOutcome(
  events$: Observable<BaseEvent>,
): Observable<BaseEvent> {
  return events$.pipe(map(withToolOutcomeLifted));
}
