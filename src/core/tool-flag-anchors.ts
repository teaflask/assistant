// The boolean tool-flag anchor family, pure of React: one factory behind
// tool-cancel-anchors and tool-offload-anchors (any later boolean extra
// too). Each instance maps a TOOL_CALL_RESULT extra that is `true`-or-absent
// to the toolCallIds carrying it. @ag-ui/client 1.0 strips unknown top-level
// fields before any subscriber, so the transport lifts the extras into
// metadata (core/tool-outcome.ts) and the set is the flag's only home on
// the client.

import type { AgentSubscriber } from "@ag-ui/client";

import { toolOutcomeOf } from "./tool-outcome.js";

export interface ToolFlagAnchors {
  empty: ReadonlySet<string>;
  /** Narrow the event's lifted flag field (untyped by contract). Anything
   *  but the literal true is ignored — the contract's "clients MUST ignore
   *  events and fields they do not recognize". */
  flagOf: (event: unknown) => boolean;
  /** Idempotent anchor merge: replays (and StrictMode's rerun) can deliver
   *  the same flagged result more than once per mount; a repeat returns the
   *  set unchanged — identity is the publish gate. */
  withAnchored: (
    previous: ReadonlySet<string>,
    toolCallId: string,
  ) => ReadonlySet<string>;
  /** A defensive copy for seeding transcript state from the resume
   *  store: entries that are not strings are dropped rather than
   *  rendered (or crashed on) — a dropped anchor reappears on the next
   *  full replay. */
  wellFormedOf: (stored: ReadonlySet<string>) => ReadonlySet<string>;
  /** Records each flagged tool result's toolCallId. */
  recorderOf: (onAnchored: (toolCallId: string) => void) => AgentSubscriber;
}

export function toolFlagAnchorsOf(
  // The closed set of boolean TOOL_CALL_RESULT extras (the contract's
  // fourth, `error`, carries a sentence, not a flag): a typo here would
  // compile into an anchor set that silently never matches — the flag's
  // rendering just stops — so the type refuses anything off the wire.
  field: "cancelled" | "offloaded" | "truncated",
): ToolFlagAnchors {
  function flagOf(event: unknown): boolean {
    return toolOutcomeOf(event)[field] === true;
  }
  return {
    empty: new Set(),
    flagOf,
    withAnchored: (previous, toolCallId) => {
      if (previous.has(toolCallId)) {
        return previous;
      }
      const next = new Set(previous);
      next.add(toolCallId);
      return next;
    },
    wellFormedOf: (stored) => {
      const seeded = new Set<string>();
      // The narrowing deliberately distrusts the set's own types: this
      // seam turns a stale shape into a missing anchor, never a crash.
      const entries = stored as ReadonlySet<unknown>;
      for (const toolCallId of entries) {
        if (typeof toolCallId === "string") {
          seeded.add(toolCallId);
        }
      }
      return seeded;
    },
    recorderOf: (onAnchored) => {
      return {
        onToolCallResultEvent({ event }) {
          if (flagOf(event)) {
            onAnchored(event.toolCallId);
          }
        },
      };
    },
  };
}
