import type { AbstractAgent, AgentSubscriber } from "@ag-ui/client";
import type { Message } from "@ag-ui/core";

import type {
  ServingAssistantTurn,
  TurnAttachment,
} from "../contract/threads.js";

// The stream carries only the assistant's side of the conversation; turn
// rows are the display source for user text (the serving contract,
// "Listing and reading conversations"). The ledger keeps the turns the
// surface knows about — seeded from the thread detail, extended by every
// send — so the injector can splice each user message in front of its
// run's replayed output.

export interface UserTurnRecord {
  turnId: string;
  runId: string | null;
  userMessage: string;
  // "delivery" means the system started the turn to push settled
  // subagent results: user_message is "" and the injector
  // splices no visitor bubble for it.
  kind: string | null;
  // The message's attachments, upload order — rendered as chips and
  // inline media beside the text. Display facts only; the bytes are a
  // download-url exchange away.
  attachments: TurnAttachment[];
  // The turn's server creation stamp (ISO-8601, required on the wire) —
  // the user bubble's timestamp source: the wire carries no per-message
  // timestamp, so the turn's created_at is the one honest clock, and never
  // a client's. Write-once by construction: record()'s early-return branch
  // updates only the late-arriving runId.
  createdAt: string;
}

/** One user message's turn-side display facts, keyed by the injected
 *  message's stable id — the transcript derivation's side table
 *  (attachments and the timestamp never ride the AG-UI Message). */
export interface UserTurnMeta {
  attachments: TurnAttachment[];
  createdAt: string;
}

/** The ledger surface the injector reads (one injector over
 *  two doors). UserTurnLedger satisfies it structurally; so does the
 *  playground's ledger over the dashboard door. A turn's slice is the
 *  facts the splice needs — its id, whether it is machine-initiated
 *  (kind non-null injects no member message), and the member's text. */
export interface InjectableTurnLedger {
  turnForRun(runId: string): {
    turnId: string;
    kind: string | null;
    userMessage: string;
  } | null;
  nextUninjectedTurn(
    messages: readonly { id: string }[],
  ): ReturnType<InjectableTurnLedger["turnForRun"]>;
}

type InjectableTurn = NonNullable<
  ReturnType<InjectableTurnLedger["turnForRun"]>
>;

export function userMessageIdFor(turnId: string): string {
  // Derived, stable, and disjoint from the stream's opaque ids — the same
  // turn injects under the same id on every replay, so the splice is
  // idempotent by construction.
  return `user:${turnId}`;
}

export class UserTurnLedger {
  private readonly turns: UserTurnRecord[] = [];
  // Bumped on every new record — the store's cheap dirty check for the
  // derived attachments map, so publishing stays allocation-free when
  // nothing changed.
  private _version = 0;

  constructor(turns: ServingAssistantTurn[] = []) {
    this.merge(turns);
  }

  get version(): number {
    return this._version;
  }

  merge(turns: ServingAssistantTurn[]): void {
    for (const turn of turns) {
      this.record(turn);
    }
  }

  record(turn: ServingAssistantTurn): void {
    const existing = this.turns.find((known) => known.turnId === turn.id);
    if (existing !== undefined) {
      // A turn's run id can arrive late (the send races the recording).
      existing.runId = turn.run_id;
      return;
    }
    this.turns.push({
      turnId: turn.id,
      runId: turn.run_id,
      userMessage: turn.user_message,
      kind: turn.kind,
      attachments: turn.attachments ?? [],
      createdAt: turn.created_at,
    });
    this._version += 1;
  }

  /** Every known turn's display facts keyed by the injected user
   *  message's stable id — one side table for both joins (the
   *  attachments map widened with the timestamp rather than a second
   *  map of the same rows being published). */
  metaByMessageId(): ReadonlyMap<string, UserTurnMeta> {
    const byMessageId = new Map<string, UserTurnMeta>();
    for (const turn of this.turns) {
      byMessageId.set(userMessageIdFor(turn.turnId), {
        attachments: turn.attachments,
        createdAt: turn.createdAt,
      });
    }
    return byMessageId;
  }

  turnForRun(runId: string): UserTurnRecord | null {
    return this.turns.find((known) => known.runId === runId) ?? null;
  }

  // The submit-path LAST-RESORT fallback when a run's id capture was
  // lost: a best-effort guess, not a law — a queued message can sit
  // newer than the pause, so the newest record may be a queued turn;
  // the door's own 409 backstops a wrong guess, exactly the lost-capture
  // stance the backend documents.
  newestTurn(): UserTurnRecord | null {
    return this.turns.at(-1) ?? null;
  }

  // The ordered fallback for runs the ledger cannot name: a turn whose run
  // id capture was lost still replays in conversation order, so the first
  // not-yet-injected turn is the one this run answers. Best-effort by
  // design — it matches the backend's own stance on lost captures.
  nextUninjectedTurn(
    messages: readonly { id: string }[],
  ): UserTurnRecord | null {
    return (
      this.turns.find(
        (known) =>
          // A machine-initiated turn (kind non-null — the contract's
          // additive rule: treat unknown kinds like "delivery") injects
          // nothing, so it is never "uninjected" — matching it here would
          // hand its empty message to someone else's run forever.
          known.kind == null &&
          !messages.some(
            (message) => message.id === userMessageIdFor(known.turnId),
          ),
      ) ?? null
    );
  }
}

export interface UserTurnInjectorCallbacks {
  // Re-fetches the thread detail into the ledger — the recovery for a run
  // some other tab started.
  refreshLedger: () => Promise<void>;
  // A turn's user message is now in the transcript under its stable id —
  // the page drops its pending echo.
  onUserMessageInjected: (messageId: string) => void;
  // A run reached its terminal (finished or errored) — the surface
  // re-reads the thread for its settled truth (busy flag, turn statuses).
  onRunSettled: () => void;
}

/**
 * Splices each turn's user message in front of its run's replayed output.
 * Every replayed segment opens with RUN_STARTED carrying the run id the
 * turn rows also carry, and the injected id is derived from the turn id,
 * so the splice is idempotent across reconnects and full replays.
 *
 * Attached at connection-epoch construction, strictly before any connect,
 * so every run this agent ever serves carries the spliced user messages.
 */
export function userTurnInjector(
  ledger: InjectableTurnLedger,
  callbacks: UserTurnInjectorCallbacks,
): AgentSubscriber {
  const { refreshLedger, onUserMessageInjected, onRunSettled } = callbacks;
  return {
    onRunStartedEvent({ event, messages, agent: eventAgent }) {
      const known =
        ledger.turnForRun(event.runId) ?? ledger.nextUninjectedTurn(messages);
      if (known !== null) {
        if (known.kind != null) {
          // A machine-initiated turn (delivery today; unknown kinds read
          // the same by the contract's additive rule) has no visitor
          // message: its run opens directly with the assistant's output.
          return;
        }
        const messageId = userMessageIdFor(known.turnId);
        onUserMessageInjected(messageId);
        if (messages.some((message) => message.id === messageId)) {
          return;
        }
        return { messages: [...messages, _userMessageOf(known)] };
      }
      // A run the ledger cannot name — another tab sent it. Fetch the
      // truth, then splice at the position this run started.
      const anchorIndex = messages.length;
      void refreshLedger().then(() => {
        _spliceLateUserMessage(
          eventAgent,
          ledger,
          event.runId,
          anchorIndex,
          onUserMessageInjected,
        );
      });
      return;
    },
    onRunFinishedEvent() {
      onRunSettled();
    },
    onRunErrorEvent() {
      onRunSettled();
    },
  };
}

function _userMessageOf(record: InjectableTurn): Message {
  return {
    id: userMessageIdFor(record.turnId),
    role: "user",
    content: record.userMessage,
  };
}

function _spliceLateUserMessage(
  agent: AbstractAgent,
  ledger: InjectableTurnLedger,
  runId: string,
  anchorIndex: number,
  onUserMessageInjected: (messageId: string) => void,
): void {
  const late = ledger.turnForRun(runId);
  if (late === null || late.kind != null) {
    return;
  }
  const messageId = userMessageIdFor(late.turnId);
  onUserMessageInjected(messageId);
  const current = agent.messages;
  if (current.some((message) => message.id === messageId)) {
    return;
  }
  const next = [...current];
  next.splice(Math.min(anchorIndex, next.length), 0, _userMessageOf(late));
  agent.setMessages(next);
}
