// The sentence-carrying tool-result anchor family, pure of React: one
// factory behind tool-error-anchors and tool-refusal-anchors (the
// sibling of tool-flag-anchors' boolean family). Each instance maps
// a TOOL_CALL_RESULT extra that carries a server-derived sentence to the
// toolCallIds carrying it: the recorder collects sentences from the live
// stream, the transcript reads the map to light a call's state and show
// the sentence, and the resume store holds the map across remounts. The
// indirection exists because @ag-ui/client 1.0 strips unknown top-level
// fields before any subscriber — the transport lifts the extras into
// metadata (core/tool-outcome.ts), and the map is the sentence's only home
// on the client. The two bindings differ in exactly one rule, stated at
// the factory's door: whether the empty string counts.

import type { AgentSubscriber } from "@ag-ui/client";

import { toolOutcomeOf } from "./tool-outcome.js";
import { WIRE_SENTENCE_MAX_CHARS } from "./wire-sentence-cap.js";

export interface ToolSentenceAnchors {
  empty: ReadonlyMap<string, string>;
  /** Narrow the event's lifted sentence field (untyped by contract). A non-string is ignored — the
   *  contract's "clients MUST ignore events and fields they do not
   *  recognize"; the sentence is retained capped, never unbounded. */
  sentenceOf: (event: unknown) => string | null;
  /** Idempotent anchor merge: every connection replays the stream from
   *  its boundary (and StrictMode aborts and reruns the first
   *  connection), so the same result can arrive more than once per
   *  mount. First anchor wins, and a repeat returns the map unchanged —
   *  identity is the publish gate. */
  withAnchored: (
    previous: ReadonlyMap<string, string>,
    toolCallId: string,
    sentence: string,
  ) => ReadonlyMap<string, string>;
  /** A defensive copy for seeding transcript state from the resume
   *  store: entries that are not string→string are dropped rather than
   *  rendered (or crashed on) — a dropped sentence reappears on the next
   *  full replay. */
  wellFormedOf: (
    stored: ReadonlyMap<string, string>,
  ) => ReadonlyMap<string, string>;
  /** Records each matching tool result's toolCallId → sentence. */
  recorderOf: (
    onAnchored: (toolCallId: string, sentence: string) => void,
  ) => AgentSubscriber;
}

export function toolSentenceAnchorsOf(
  // The closed set of sentence-carrying TOOL_CALL_RESULT extras: a typo
  // here would compile into a map that silently never fills, so the type
  // refuses anything off the wire.
  field: "error" | "refused",
  options: {
    /** Whether "" is a sentence. `error`: yes — presence is the failure
     *  signal and the pane text falls back to the result. `refused`: no —
     *  the sentence IS the reason the row shows, never stamped empty. */
    acceptEmpty: boolean;
  },
): ToolSentenceAnchors {
  function sentenceOf(event: unknown): string | null {
    const value = toolOutcomeOf(event)[field];
    if (typeof value !== "string") {
      return null;
    }
    if (value === "" && !options.acceptEmpty) {
      return null;
    }
    return value.slice(0, WIRE_SENTENCE_MAX_CHARS);
  }
  return {
    empty: new Map(),
    sentenceOf,
    withAnchored: (previous, toolCallId, sentence) => {
      if (previous.has(toolCallId)) {
        return previous;
      }
      const next = new Map(previous);
      next.set(toolCallId, sentence);
      return next;
    },
    wellFormedOf: (stored) => {
      const seeded = new Map<string, string>();
      // The narrowing deliberately distrusts the map's own types: this
      // seam turns a stale shape into a missing sentence, never a crash.
      const entries = stored as ReadonlyMap<unknown, unknown>;
      for (const [toolCallId, sentence] of entries) {
        if (typeof toolCallId === "string" && typeof sentence === "string") {
          seeded.set(toolCallId, sentence);
        }
      }
      return seeded;
    },
    recorderOf: (onAnchored) => {
      return {
        onToolCallResultEvent({ event }) {
          const sentence = sentenceOf(event);
          if (sentence !== null) {
            onAnchored(event.toolCallId, sentence);
          }
        },
      };
    },
  };
}
