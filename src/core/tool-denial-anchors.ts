// The tool-denial ledger: the durable record that a member
// DECLINED the approval a call was paused for, keyed by tool_call_id. The
// wire stamps a denial `cancelled`, so the state is a client-side JOIN of
// the approval_requested and approval_resolved markers that reclassifies
// that stamp. The ordering premises: docs/decision-anchors.md.

import type { AgentSubscriber } from "@ag-ui/client";

import {
  APPROVAL_REQUESTED_EVENT_NAME,
  APPROVAL_RESOLVED_EVENT_NAME,
} from "../contract/events.js";
import { approvalResolvedPayloadOf } from "./approval-resolved.js";

/**
 * The ledger's two halves: the ask map (interrupt id → the tool call an
 * approval_requested named) and the denied set (tool call ids whose ask
 * was answered approved:false). Only `denied` is presentation — the
 * snapshot exposes it alone as `toolDenialAnchors`; `asks` exists so the
 * fold can join a later resolution.
 */
export interface ToolDenialLedger {
  asks: ReadonlyMap<string, string>;
  denied: ReadonlySet<string>;
}

export const EMPTY_TOOL_DENIAL_LEDGER: ToolDenialLedger = {
  asks: new Map(),
  denied: new Set(),
};

/** The presentation half's empty value — what the projection reads when
 *  a snapshot carries no ledger at all. */
export const EMPTY_TOOL_DENIAL_ANCHORS: ReadonlySet<string> =
  EMPTY_TOOL_DENIAL_LEDGER.denied;

/** A narrowed marker the ledger folds: an ask, or a denial. */
export type ToolDenialMarker =
  | { kind: "ask"; interruptId: string; toolCallId: string }
  | { kind: "denied"; interruptId: string };

/**
 * Narrow a CUSTOM event to the marker the ledger folds, or null: an
 * approval_requested carrying both a non-empty interrupt_id and a
 * non-empty tool_call_id (an unanchored ask — a wire that named no call
 * — marks nothing: there is no row to reclassify), or an
 * approval_resolved whose `approved` is false. An approval is not a
 * marker here (the call then runs, and its own result tells its story).
 * Anything malformed is ignored — the contract's "clients MUST ignore
 * events and fields they do not recognize".
 */
export function toolDenialMarkerOf(
  name: string,
  value: unknown,
): ToolDenialMarker | null {
  if (name === APPROVAL_REQUESTED_EVENT_NAME) {
    if (typeof value !== "object" || value === null) {
      return null;
    }
    const record = value as Record<string, unknown>;
    const interruptId = record.interrupt_id;
    const toolCallId = record.tool_call_id;
    if (
      typeof interruptId !== "string" ||
      interruptId === "" ||
      typeof toolCallId !== "string" ||
      toolCallId === ""
    ) {
      return null;
    }
    return { kind: "ask", interruptId, toolCallId };
  }
  if (name === APPROVAL_RESOLVED_EVENT_NAME) {
    const resolved = approvalResolvedPayloadOf(value);
    if (resolved === null || resolved.approved) {
      return null;
    }
    return { kind: "denied", interruptId: resolved.interruptId };
  }
  return null;
}

/**
 * The idempotent fold: every connection replays the stream from its
 * boundary (and StrictMode aborts and reruns the first connection), so
 * the same marker can arrive more than once per mount. A repeat — an
 * ask already held, a denial already recorded — returns the ledger
 * unchanged, and so does a denial whose interrupt no held ask names
 * (premise 2). Otherwise the changed half is rebuilt and the untouched
 * half keeps its identity: `denied`'s identity is the publish gate, so
 * an ask alone never repaints the transcript.
 */
export function withToolDenialMarkerFolded(
  ledger: ToolDenialLedger,
  marker: ToolDenialMarker,
): ToolDenialLedger {
  if (marker.kind === "ask") {
    if (ledger.asks.has(marker.interruptId)) {
      return ledger;
    }
    const asks = new Map(ledger.asks);
    asks.set(marker.interruptId, marker.toolCallId);
    return { asks, denied: ledger.denied };
  }
  const toolCallId = ledger.asks.get(marker.interruptId);
  if (toolCallId === undefined || ledger.denied.has(toolCallId)) {
    return ledger;
  }
  const denied = new Set(ledger.denied);
  denied.add(toolCallId);
  return { asks: ledger.asks, denied };
}

/**
 * A defensive copy for seeding transcript state from the resume store:
 * non-string members are dropped rather than rendered (or crashed on) —
 * a dropped anchor reappears on the next full replay.
 */
export function wellFormedToolDenialAnchorsOf(
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

/** Records the two approval markers, narrowed — CUSTOM events only; this
 *  recorder never reads a tool result (the cancelled stamp it
 *  reclassifies rides tool-cancel-anchors.ts, one rung below). */
export function toolDenialRecorder(
  onMarker: (marker: ToolDenialMarker) => void,
): AgentSubscriber {
  return {
    onCustomEvent({ event }) {
      const marker = toolDenialMarkerOf(event.name, event.value);
      if (marker !== null) {
        onMarker(marker);
      }
    },
  };
}
