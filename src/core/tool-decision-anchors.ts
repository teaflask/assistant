// The tool-decision anchor set: the durable record that a call
// carried a member decision, keyed by tool_call_id. The placement hold
// reads THIS, never the pruned live card stores — the hold window is the
// TURN. A pure fold over replayed CUSTOM markers: docs/decision-anchors.md.

import type { AgentSubscriber } from "@ag-ui/client";

import {
  APPROVAL_REQUESTED_EVENT_NAME,
  TOOL_EXECUTION_REQUESTED_EVENT_NAME,
} from "../contract/events.js";
// The kinds leaf, never execution-handlers: this module is a value
// export of the ./transcript projection entry, and the handlers module
// drags the transport/reader/affordance layers that entry's law bans
// (tests/bundle-closure.test.ts pins it).
import { MEMBER_ANSWERABLE_KINDS } from "./execution-kinds.js";

export const EMPTY_TOOL_DECISION_ANCHORS: ReadonlySet<string> = new Set();

/**
 * Narrow a CUSTOM event to the tool call id it marks as decision-bearing,
 * or null: an approval_requested with a tool_call_id, or a
 * tool_execution_requested whose request.kind is member-answerable. Anything malformed is ignored — the contract's
 * "clients MUST ignore events and fields they do not recognize". An
 * unanchored ask (tool_call_id null — a wire that named no call) marks
 * nothing: there is no row to hold open.
 */
export function toolDecisionAnchorOf(
  name: string,
  value: unknown,
): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const toolCallId =
    typeof record.tool_call_id === "string" && record.tool_call_id !== ""
      ? record.tool_call_id
      : null;
  if (toolCallId === null) {
    return null;
  }
  if (name === APPROVAL_REQUESTED_EVENT_NAME) {
    return toolCallId;
  }
  if (name === TOOL_EXECUTION_REQUESTED_EVENT_NAME) {
    const request = record.request;
    if (typeof request !== "object" || request === null) {
      return null;
    }
    const kind = (request as Record<string, unknown>).kind;
    // MEMBER_ANSWERABLE_KINDS, not the single ask kind: the anchor marks
    // "a member decision rode this call", and a future member-answerable
    // kind must hold its row without a second edit here.
    return typeof kind === "string" && MEMBER_ANSWERABLE_KINDS.has(kind)
      ? toolCallId
      : null;
  }
  return null;
}

/**
 * Idempotent anchor merge: every connection replays the stream from its
 * boundary (and StrictMode aborts and reruns the first connection), so
 * the same marker can arrive more than once per mount. A repeat returns
 * the set unchanged — identity is the publish gate.
 */
export function withToolDecisionAnchored(
  previous: ReadonlySet<string>,
  toolCallId: string,
): ReadonlySet<string> {
  if (previous.has(toolCallId)) {
    return previous;
  }
  const next = new Set(previous);
  next.add(toolCallId);
  return next;
}

/**
 * A defensive copy for seeding transcript state from the resume store:
 * non-string members are dropped rather than rendered (or crashed on) —
 * a dropped anchor reappears on the next full replay.
 */
export function wellFormedToolDecisionAnchorsOf(
  stored: ReadonlySet<string>,
): ReadonlySet<string> {
  const seeded = new Set<string>();
  for (const toolCallId of stored as ReadonlySet<unknown>) {
    if (typeof toolCallId === "string") {
      seeded.add(toolCallId);
    }
  }
  return seeded;
}

export function toolDecisionRecorder(
  onDecisionAnchored: (toolCallId: string) => void,
): AgentSubscriber {
  return {
    onCustomEvent({ event }) {
      const toolCallId = toolDecisionAnchorOf(event.name, event.value);
      if (toolCallId !== null) {
        onDecisionAnchored(toolCallId);
      }
    },
  };
}
