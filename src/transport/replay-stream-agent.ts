import { HttpAgent } from "@ag-ui/client";
import { EventType } from "@ag-ui/core";
import type { BaseEvent, Message, RunAgentInput } from "@ag-ui/core";
// A compatible range (^7.8.0) so host resolvers dedupe onto
// @ag-ui/client's exact rxjs pin rather than installing a second copy —
// rxjs is only named so the emitted declaration can type connect()'s
// Observable and the overlap filter can ride the returned pipeline.
import { filter, type Observable } from "rxjs";

import { liftToolOutcome } from "../core/tool-outcome.js";
import {
  SseFrameIdScanner,
  StreamResumeStore,
  type ResumeSnapshot,
} from "./stream-resume.js";

export interface ServingReplayStreamAgentConfig {
  streamUrl: string;
  // The thread's stream_thread_id — the AG-UI thread id the stream
  // speaks, not the REST thread id in the URL.
  streamThreadId: string;
  // TokenSession.authorizedFetch: every connect (and reconnect) carries a
  // fresh visitor token and gets the 401-retry-once behavior.
  authorizedFetch: (url: string, requestInit: RequestInit) => Promise<Response>;
  // The conversation's resume state. With a settled snapshot the agent
  // seeds its message list from it and asks the server for only what came
  // after (forwarded_props.after_id); without one — or without the store —
  // every connection is the contract's full replay.
  resume?: StreamResumeStore;
}

/**
 * AG-UI client for the serving thread stream. The endpoint is watch-only
 * and treats attach and run identically — every connection replays the
 * recorded log and then tails it — so connecting is just running. With a
 * resume snapshot the replay is asked to start past the cursor instead of
 * from the beginning; the transcript is byte-equivalent either way, which
 * is what keeps full replay the always-correct fallback.
 */
export class ServingReplayStreamAgent extends HttpAgent {
  private readonly scanner: SseFrameIdScanner;
  private readonly seededSnapshot: ResumeSnapshot | null;
  private readonly seededContentIds: ReadonlySet<string>;

  constructor({
    streamUrl,
    streamThreadId,
    authorizedFetch,
    resume,
  }: ServingReplayStreamAgentConfig) {
    const scanner = new SseFrameIdScanner();
    const snapshot = resume?.snapshot ?? null;
    super({
      url: streamUrl,
      threadId: streamThreadId,
      fetch: scanner.wrap(authorizedFetch),
      initialMessages: snapshot?.messages,
    });
    this.scanner = scanner;
    this.seededSnapshot = snapshot;
    this.seededContentIds =
      snapshot === null ? new Set() : _contentIdsOf(snapshot.messages);
    this._reseedWhenTheHostWipesTheList();
  }

  // CopilotKit's chat clears a non-empty agent message list when it
  // mounts (its first thread sync sees an unknown thread), which erases
  // the constructor's initialMessages seeding. onRunInitialized runs
  // inside connectAgent AFTER that wipe and BEFORE the apply pipeline
  // captures its message baseline, so re-seeding here is what actually
  // sticks; on an agent whose list survived (bare transports, tests) the
  // non-empty guard makes this a no-op.
  private _reseedWhenTheHostWipesTheList(): void {
    this.subscribe({
      onRunInitialized: ({ messages }) => {
        const snapshot = this.seededSnapshot;
        if (snapshot !== null && messages.length === 0) {
          return { messages: structuredClone(snapshot.messages) };
        }
        return undefined;
      },
    });
  }

  // The newest cursor received on this agent's connection — what the
  // resume-snapshot recorder pairs with the applied messages at settle.
  get resumeCursor(): string | null {
    return this.scanner.lastEventId;
  }

  // Whether this agent's connection delivered any SSE body bytes at all,
  // keepalive pings included — the liveness fact failure classification
  // needs, deliberately not inferred from the replay cursor
  // (a live-but-idle stream commits no frame).
  get sawBodyBytes(): boolean {
    return this.scanner.bodyBytesSeen;
  }

  // Every path in — connect() below and the client's own runAgent() — funnels
  // through run(), ahead of the client's schema enforcement: the one seam
  // where the wire's tool-outcome extras can still be lifted into metadata.
  override run(input: RunAgentInput): Observable<BaseEvent> {
    return liftToolOutcome(super.run(input));
  }

  protected override connect(input: RunAgentInput): Observable<BaseEvent> {
    this._replaceAbortControllerIfAborted();
    const snapshot = this.seededSnapshot ?? null;
    if (snapshot === null) {
      return this.run(input);
    }
    // The filter de-dupes re-delivered content by the contract's stable
    // ids before the verifier sees it: the boundary snap re-delivers an
    // interrupted run in full, and a server that ignores the cursor full-
    // replays onto the seeded list — where @ag-ui/client would duplicate
    // tool calls (TOOL_CALL_START pushes unconditionally).
    return this.run(_resumedPast(input, snapshot.afterId)).pipe(
      filter((event) => !this._alreadySeeded(event)),
    );
  }

  // The endpoint is watch-only by contract: a seeded agent must not
  // upload its whole transcript in the RunAgentInput body on every
  // reconnect (prepareRunAgentInput serializes this.messages).
  protected override requestInit(input: RunAgentInput): RequestInit {
    return super.requestInit({ ...input, messages: [] });
  }

  // abortRun() aborts the controller and never replaces it; without this a
  // remounted surface (React StrictMode, back-navigation) would reconnect
  // with an already-aborted signal and die instantly.
  private _replaceAbortControllerIfAborted(): void {
    if (this.abortController.signal.aborted) {
      this.abortController = new AbortController();
    }
  }

  private _alreadySeeded(event: BaseEvent): boolean {
    switch (event.type) {
      case EventType.TEXT_MESSAGE_START:
      case EventType.TEXT_MESSAGE_CONTENT:
      case EventType.TEXT_MESSAGE_END:
      case EventType.REASONING_START:
      case EventType.REASONING_MESSAGE_START:
      case EventType.REASONING_MESSAGE_CONTENT:
      case EventType.REASONING_MESSAGE_END:
      case EventType.REASONING_END:
      case EventType.TOOL_CALL_RESULT:
        return this.seededContentIds.has(
          (event as BaseEvent & { messageId: string }).messageId,
        );
      case EventType.TOOL_CALL_START:
      case EventType.TOOL_CALL_ARGS:
      case EventType.TOOL_CALL_END:
        return this.seededContentIds.has(
          (event as BaseEvent & { toolCallId: string }).toolCallId,
        );
      default:
        // Lifecycle framing and markers pass: RUN_STARTED re-delivery is
        // idempotent downstream (the injector guards by message id), and
        // dropping a terminal would leave the run unclosed.
        return false;
    }
  }
}

function _resumedPast(input: RunAgentInput, afterId: string): RunAgentInput {
  const forwardedProps = (input.forwardedProps ?? {}) as Record<
    string,
    unknown
  >;
  return {
    ...input,
    forwardedProps: { ...forwardedProps, after_id: afterId },
  };
}

// Every id the stream can re-deliver content under: message ids of all
// roles (tool results dedupe by their tool message's id) plus the tool
// call ids inside assistant messages.
function _contentIdsOf(messages: Message[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    ids.add(message.id);
    if (message.role === "assistant") {
      for (const toolCall of message.toolCalls ?? []) {
        ids.add(toolCall.id);
      }
    }
  }
  return ids;
}
