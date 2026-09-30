// The tool-schema anchor model, pure of React: the recorder
// maps each tool_call_annotated CUSTOM marker's schema siblings to its
// toolCallId, the presenter reads the map to hand a mounted view its
// `argsSchema` / `resultSchema`, and the resume store holds the map
// across remounts. Same indirection as the display anchors — a CUSTOM
// marker never becomes a message, so this map is the schemas' only
// client home — plus one more feed: the approval card's
// toolInputSchema / toolOutputSchema (the `approval_requested` marker
// and the REST turn record's pending_approvals both build cards), so a
// paused-then-denied call that never ran still knows its shape.
//
// Deliberately uncapped, unlike the display sentences' 500-char clip: a
// clipped JSON Schema is a syntactically broken lie, not a degraded
// sentence, and the source is the operator-reviewed catalog row the
// approval channel already carries whole. The narrower guards shape
// only — a plain non-array record or absent, never a fabricated `{}`.

import type { AgentSubscriber } from "@ag-ui/client";

import { TOOL_CALL_ANNOTATED_EVENT_NAME } from "../contract/events.js";
import type { JsonSchema } from "./tool-view.js";

/** One call's anchored schemas. Either field may be absent — a tool
 *  registers each schema independently, and absence rides through. */
export interface ToolCallSchemas {
  argsSchema?: JsonSchema;
  resultSchema?: JsonSchema;
}

export const EMPTY_TOOL_SCHEMA_ANCHORS: ReadonlyMap<string, ToolCallSchemas> =
  new Map();

/**
 * Narrow a tool_call_annotated marker's schema siblings. Null means the
 * marker anchors no schema — a display-only annotation (the common
 * completion emission), a null field (an explicit "none"), or a
 * malformed one all leave this map untouched; the display narrower owns
 * the display half independently, so neither half's absence gates the
 * other.
 */
export function toolSchemaAnchorOf(
  value: unknown,
): { toolCallId: string; schemas: ToolCallSchemas } | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const {
    tool_call_id: toolCallId,
    tool_input_schema,
    tool_output_schema,
  } = value as {
    tool_call_id?: unknown;
    tool_input_schema?: unknown;
    tool_output_schema?: unknown;
  };
  if (typeof toolCallId !== "string" || toolCallId === "") {
    return null;
  }
  const schemas: ToolCallSchemas = {};
  const argsSchema = _schemaOf(tool_input_schema);
  if (argsSchema !== undefined) {
    schemas.argsSchema = argsSchema;
  }
  const resultSchema = _schemaOf(tool_output_schema);
  if (resultSchema !== undefined) {
    schemas.resultSchema = resultSchema;
  }
  if (schemas.argsSchema === undefined && schemas.resultSchema === undefined) {
    return null;
  }
  return { toolCallId, schemas };
}

/**
 * Idempotent per-field merge, first non-absent value wins: the schemas
 * legitimately arrive more than once for one call (the approval card's
 * feed for a paused call, then the progress annotation once it runs,
 * then every replay again), and re-applying the same sequence changes
 * nothing. A no-op merge returns the map unchanged — identity is the
 * publish gate — and a merged entry keeps the previously stored field
 * REFERENCES, so a schema handed to a mounted view stays
 * identity-stable across re-records (the slot's delivery guard compares
 * `===`).
 */
export function withToolSchemasAnchored(
  previous: ReadonlyMap<string, ToolCallSchemas>,
  toolCallId: string,
  schemas: ToolCallSchemas,
): ReadonlyMap<string, ToolCallSchemas> {
  const existing = previous.get(toolCallId);
  if (existing === undefined) {
    const next = new Map(previous);
    next.set(toolCallId, schemas);
    return next;
  }
  if (
    (existing.argsSchema !== undefined || schemas.argsSchema === undefined) &&
    (existing.resultSchema !== undefined || schemas.resultSchema === undefined)
  ) {
    return previous;
  }
  const merged: ToolCallSchemas = {};
  const argsSchema = existing.argsSchema ?? schemas.argsSchema;
  if (argsSchema !== undefined) {
    merged.argsSchema = argsSchema;
  }
  const resultSchema = existing.resultSchema ?? schemas.resultSchema;
  if (resultSchema !== undefined) {
    merged.resultSchema = resultSchema;
  }
  const next = new Map(previous);
  next.set(toolCallId, merged);
  return next;
}

/**
 * A defensive re-validation for seeding transcript state from the
 * resume store, like every sibling anchors map: an entry that is not a
 * string-keyed record of plain-record schemas is dropped rather than
 * rendered (or crashed on) — a stale shape becomes a missing schema,
 * never a wedged resume.
 */
export function wellFormedToolSchemaAnchorsOf(
  stored: ReadonlyMap<string, ToolCallSchemas>,
): ReadonlyMap<string, ToolCallSchemas> {
  const seeded = new Map<string, ToolCallSchemas>();
  // The narrowing deliberately distrusts the map's own types (the seam
  // where any future persisted form of the store must degrade).
  const entries = stored as ReadonlyMap<unknown, unknown>;
  for (const [toolCallId, schemas] of entries) {
    if (typeof toolCallId !== "string" || !_isWellFormedSchemas(schemas)) {
      continue;
    }
    seeded.set(toolCallId, schemas);
  }
  return seeded;
}

/** Records each annotated call's toolCallId → registered schemas. */
export function toolSchemaRecorder(
  onSchemasAnchored: (toolCallId: string, schemas: ToolCallSchemas) => void,
): AgentSubscriber {
  return {
    onCustomEvent({ event }) {
      if (event.name !== TOOL_CALL_ANNOTATED_EVENT_NAME) {
        return;
      }
      const anchor = toolSchemaAnchorOf(event.value);
      if (anchor !== null) {
        onSchemasAnchored(anchor.toolCallId, anchor.schemas);
      }
    },
  };
}

/**
 * The approval card's schemas as an anchorable record — the null→absent
 * seam for the channel's other producer. The card model is the single
 * already-narrowed home of the `approval_requested` marker's
 * tool_input_schema / tool_output_schema (stream AND the REST turn
 * record's pending_approvals — approval-inbox.ts), so this consumes the
 * built card rather than re-narrowing the wire a second time. Null on a
 * card that carries neither schema.
 */
export function approvalCardSchemasOf(card: {
  toolInputSchema: Record<string, unknown> | null;
  toolOutputSchema: Record<string, unknown> | null;
}): ToolCallSchemas | null {
  if (card.toolInputSchema === null && card.toolOutputSchema === null) {
    return null;
  }
  const schemas: ToolCallSchemas = {};
  if (card.toolInputSchema !== null) {
    schemas.argsSchema = card.toolInputSchema;
  }
  if (card.toolOutputSchema !== null) {
    schemas.resultSchema = card.toolOutputSchema;
  }
  return schemas;
}

/** A schema is a plain non-array record, verbatim; anything else —
 *  null, an array, a string — is absent, never a crash and never `{}`
 *  invented from a malformed value. */
function _schemaOf(schema: unknown): JsonSchema | undefined {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return undefined;
  }
  return schema as JsonSchema;
}

function _isWellFormedSchemas(schemas: unknown): schemas is ToolCallSchemas {
  if (typeof schemas !== "object" || schemas === null) {
    return false;
  }
  const { argsSchema, resultSchema } = schemas as {
    argsSchema?: unknown;
    resultSchema?: unknown;
  };
  const fieldsAreWellTypedOrAbsent =
    (argsSchema === undefined || _schemaOf(argsSchema) !== undefined) &&
    (resultSchema === undefined || _schemaOf(resultSchema) !== undefined);
  return (
    fieldsAreWellTypedOrAbsent &&
    (argsSchema !== undefined || resultSchema !== undefined)
  );
}
