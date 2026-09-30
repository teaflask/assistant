// The memory-provenance anchor model, pure of React: the recorder maps
// each memory_updated CUSTOM marker to its durable memory id, consumers
// read the map to show quiet "saved a memory" provenance rows, and the
// resume store holds the map across remounts (the marker never becomes a
// message, and a snapshot-seeded reconnect replays only past the
// cursor). The memory id is the reconcile key — a replayed or delayed
// re-delivery updates nothing and appends nothing, so one write is ever
// one row. The payload is end-user safe by wire contract (a canned
// sentence, a scope token, an id — never the memory's content), and the
// narrower distrusts it anyway.
//
// ATTRIBUTION rides beside the provenance records: which
// assistant prose message each write's footer renders under. The marker
// deliberately carries no tool_call_id or message id (the store seam
// sits below the tool layer), so the recorder anchors by stream
// position — the receipt-family idiom: writes buffered during a run
// flush to that run's newest assistant prose at the terminal, and a
// marker arriving after the terminal attributes immediately. First
// attribution wins, keyed by the durable memory id, so re-deliveries
// against a drifted message list reconcile instead of moving the footer
// (the anchor family's drifted-message arbitration law). A history whose markers were
// recorded without attribution simply renders no footer — attribution
// is evidence, never synthesized.

import type { AgentSubscriber } from "@ag-ui/client";

import { MEMORY_UPDATED_EVENT_NAME } from "../contract/events.js";
import { newestAssistantProseIdOf } from "./assistant-prose.js";

// The summary is a backend-authored canned sentence; a runaway one is
// retained capped, never unbounded (the display-text posture).
const SUMMARY_MAX_CHARS = 500;

// Scope is an open single-word vocabulary ("org", "user"); unknown
// tokens survive verbatim capped — the renderer owns the fallback.
const TOKEN_MAX_CHARS = 64;

export interface MemoryUpdated {
  memoryId: string;
  /** Open vocabulary: "org" | "user" today; render unknowns generically. */
  scope: string;
  /** The canned human sentence — never the memory's content. */
  summary: string;
}

export const EMPTY_MEMORY_PROVENANCE_ANCHORS: ReadonlyMap<
  string,
  MemoryUpdated
> = new Map();

/**
 * Narrow a memory_updated marker's value. Null means ignore — the
 * contract's "clients MUST ignore events and fields they do not
 * recognize": without its durable id the row has no reconcile key, and
 * without a sentence there is nothing safe to show.
 */
export function memoryUpdatedAnchorOf(value: unknown): MemoryUpdated | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const {
    memory_id: memoryId,
    scope,
    summary,
  } = value as {
    memory_id?: unknown;
    scope?: unknown;
    summary?: unknown;
  };
  if (typeof memoryId !== "string" || memoryId === "") {
    return null;
  }
  if (typeof scope !== "string" || scope.trim() === "") {
    return null;
  }
  if (typeof summary !== "string" || summary.trim() === "") {
    return null;
  }
  return {
    memoryId,
    scope: scope.slice(0, TOKEN_MAX_CHARS),
    summary: summary.slice(0, SUMMARY_MAX_CHARS),
  };
}

/**
 * Reconcile-by-id, never append: the first anchor for a memory id wins,
 * so every replay re-delivery — and any delayed duplicate — is a no-op.
 * Insertion order is stream order, which is how consumers list the rows.
 */
export function withMemoryUpdateAnchored(
  previous: ReadonlyMap<string, MemoryUpdated>,
  update: MemoryUpdated,
): ReadonlyMap<string, MemoryUpdated> {
  if (previous.has(update.memoryId)) {
    return previous;
  }
  const next = new Map(previous);
  next.set(update.memoryId, update);
  return next;
}

/**
 * A defensive copy for seeding from the resume store: entries that are
 * not a well-formed provenance record are dropped rather than rendered —
 * a dropped entry becomes a missing row until the next full replay,
 * never a crash.
 */
export function wellFormedMemoryProvenanceAnchorsOf(
  stored: ReadonlyMap<string, MemoryUpdated>,
): ReadonlyMap<string, MemoryUpdated> {
  const seeded = new Map<string, MemoryUpdated>();
  const entries = stored as ReadonlyMap<unknown, unknown>;
  for (const [memoryId, update] of entries) {
    if (typeof memoryId !== "string" || !_isWellFormedUpdate(update)) {
      continue;
    }
    seeded.set(memoryId, update);
  }
  return seeded;
}

export const EMPTY_MEMORY_ATTRIBUTION_ANCHORS: ReadonlyMap<string, string> =
  new Map();

/**
 * Reconcile-by-id, never move: the first message a memory id attributes
 * to wins, so a re-delivery flushing against a drifted message list is a
 * no-op — identical map identity, the anchor family's arbitration law.
 */
export function withMemoryAttributed(
  previous: ReadonlyMap<string, string>,
  memoryId: string,
  messageId: string,
): ReadonlyMap<string, string> {
  if (previous.has(memoryId)) {
    return previous;
  }
  const next = new Map(previous);
  next.set(memoryId, messageId);
  return next;
}

/**
 * A defensive copy for seeding from the resume store: pairs that are not
 * two non-empty strings are dropped rather than rendered — a dropped
 * pair becomes a missing footer until the next full replay, never a
 * crash.
 */
export function wellFormedMemoryAttributionAnchorsOf(
  stored: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const seeded = new Map<string, string>();
  const entries = stored as ReadonlyMap<unknown, unknown>;
  for (const [memoryId, messageId] of entries) {
    if (
      typeof memoryId !== "string" ||
      memoryId === "" ||
      typeof messageId !== "string" ||
      messageId === ""
    ) {
      continue;
    }
    seeded.set(memoryId, messageId);
  }
  return seeded;
}

/**
 * The footer projection: provenance records grouped under the message
 * each one attributed to, in stream order (the provenance map's
 * insertion order). A record without attribution is skipped — an old
 * history renders no footer rather than a synthesized one.
 */
export function memoryFootersOf(
  provenance: ReadonlyMap<string, MemoryUpdated>,
  attribution: ReadonlyMap<string, string>,
): ReadonlyMap<string, MemoryUpdated[]> {
  const footers = new Map<string, MemoryUpdated[]>();
  for (const [memoryId, update] of provenance) {
    const messageId = attribution.get(memoryId);
    if (messageId === undefined) {
      continue;
    }
    const grouped = footers.get(messageId);
    if (grouped === undefined) {
      footers.set(messageId, [update]);
    } else {
      grouped.push(update);
    }
  }
  return footers;
}

/** The recorder's two write channels: the provenance record itself, and
 *  the message id its footer renders under. */
export interface MemoryUpdatedRecorderSink {
  onMemoryAnchored: (update: MemoryUpdated) => void;
  onMemoryAttributed: (memoryId: string, messageId: string) => void;
}

/**
 * Records each memory_updated marker's memory id → narrowed payload, and
 * attributes each write to the assistant prose message whose run caused
 * it. Attribution follows the receipt-family stream-position idiom
 * (core/receipt-anchors.ts): writes observed while the run is live
 * buffer and flush at the terminal against the run's own newest prose;
 * a run that authored no prose drops its buffer honestly (the annotated
 * tool row still tells the story, and an earlier turn's prose must never
 * adopt this turn's write). A marker arriving AFTER the terminal — the
 * settled-then-provenance arrival a reconnect tail produces — attributes
 * immediately, so the footer engages without waiting for another event.
 */
export function memoryUpdatedRecorder(
  sink: MemoryUpdatedRecorderSink,
): AgentSubscriber {
  let runLive = false;
  // The newest assistant prose id, and whether it changed since the
  // current run started — the "this run authored prose" evidence the
  // flush needs. The BASELINE is taken at RUN_STARTED from the params'
  // own message list (AgentSubscriberParams.messages — the pre-run
  // list; the pipeline appends nothing before that callback and its
  // verifier requires RUN_STARTED to be a run's first event), because a
  // fresh epoch's agent is SEEDED with history rather than replaying
  // it: no onMessagesChanged fires between onRunInitialized and
  // RUN_STARTED, so a null baseline would make the run's first message
  // change read the seeded history's old prose as "authored this run"
  // and hand the previous turn's message this run's writes — sticky
  // across replays, since attribution is first-wins. Deliberately NOT
  // reset at the terminal: the post-settle arrival arm still needs to
  // know the settled run's prose was fresh.
  let newestProseId: string | null = null;
  let proseThisRun = false;
  let pending: string[] = [];

  const flush = () => {
    if (newestProseId !== null && proseThisRun) {
      for (const memoryId of pending) {
        sink.onMemoryAttributed(memoryId, newestProseId);
      }
    }
    pending = [];
  };

  return {
    // One agent can be connected more than once (StrictMode detaches the
    // first run terminal-free and starts over): writes a dead connection
    // buffered but never flushed must not ride into the replacement's
    // flush — the receipt recorders' same guard.
    onRunInitialized() {
      runLive = false;
      newestProseId = null;
      proseThisRun = false;
      pending = [];
    },
    onRunStartedEvent({ messages }) {
      runLive = true;
      newestProseId = newestAssistantProseIdOf(messages);
      proseThisRun = false;
    },
    onMessagesChanged({ messages }) {
      const proseId = newestAssistantProseIdOf(messages);
      if (proseId !== null && proseId !== newestProseId) {
        newestProseId = proseId;
        proseThisRun = true;
      }
    },
    onCustomEvent({ event }) {
      if (event.name !== MEMORY_UPDATED_EVENT_NAME) {
        return;
      }
      const update = memoryUpdatedAnchorOf(event.value);
      if (update === null) {
        return;
      }
      sink.onMemoryAnchored(update);
      if (runLive) {
        pending.push(update.memoryId);
      } else if (newestProseId !== null && proseThisRun) {
        // Post-settle arrival: no further event will flush for us.
        sink.onMemoryAttributed(update.memoryId, newestProseId);
      }
    },
    onRunFinishedEvent() {
      runLive = false;
      flush();
    },
    onRunErrorEvent() {
      runLive = false;
      flush();
    },
  };
}

function _isWellFormedUpdate(update: unknown): update is MemoryUpdated {
  if (typeof update !== "object" || update === null) {
    return false;
  }
  const { memoryId, scope, summary } = update as {
    memoryId?: unknown;
    scope?: unknown;
    summary?: unknown;
  };
  return (
    typeof memoryId === "string" &&
    memoryId !== "" &&
    typeof scope === "string" &&
    scope !== "" &&
    typeof summary === "string" &&
    summary !== ""
  );
}
