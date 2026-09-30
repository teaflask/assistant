// Stream trouble: what the store does when the live stream misbehaves —
// a wire error, a terminal-free quiet close, the member's retry, and the
// post-restart reconnect that waits for a restarted workflow to reclaim
// its parked turn.

import { streamFailureClassOf } from "../contract/telemetry.js";
import type { ServingAssistantTurn } from "../contract/threads.js";
import { getAssistantThread } from "../transport/serving-api.js";
import {
  adoptRefreshedDetail,
  refreshThreads,
} from "./conversation-adoption.js";
import { settlesFor } from "./conversation-refresh.js";
import { publishStore } from "./conversation-publish.js";
import type { AssistantConversationStore } from "./conversation-store.js";
import { SETTLE_REFRESH_DELAY_MS } from "./settle-refresh.js";

// How many SETTLE_REFRESH_DELAY_MS beats the post-restart reconnect will
// wait for the restarted workflow to reclaim its parked turn before
// reconnecting regardless.
const RESTART_RECLAIM_PROBES = 10;

export function handleStreamErrorFromStore(
  store: AssistantConversationStore,
  error: Error,
): void {
  store._streamInterrupted = true;
  publishStore(store);
  // The failure, classified for the host's analytics: where the
  // wire died and the cursors that locate it. Deliberately no run content.
  // sawBodyBytes' premise: the scanner sets it on the first SSE body chunk
  // of a connection — keepalive comments included, so a live-but-idle
  // resumed stream still reads as mid-stream when the edge cuts it — and
  // headers alone never set it. The store connects ONCE per epoch (a fresh
  // scanner per connection), so the flag is a fact about THIS connection.
  store.deps.onTelemetry({
    name: "assistant_stream_failed",
    properties: {
      failure_class: streamFailureClassOf(error, {
        sawBodyBytes: store._epoch?.agent.sawBodyBytes ?? false,
      }),
      status: _httpStatusOf(error),
      thread_id: store._active?.thread.id ?? null,
      resume_cursor: store._active?.resume.snapshot?.afterId ?? null,
      last_committed_sse_id: store._epoch?.agent.resumeCursor ?? null,
    },
  });
  // Re-read the truth: a RUN_ERROR that settled the turn failed shows
  // up as busy=false + the turn's failure sentence, which suppresses
  // the interruption banner in favor of the honest failure notice.
  store._scheduleSettleRefresh();
  store.deps.reportError(error);
}

// A stream that ends without a terminal event is either a parked turn
// (the designed quiet close) or a dropped connection wearing the
// same wire shape — REST is the authority. The re-read alone is most of
// the answer: it unlocks the composer after a live park (busy rides
// thread.busy, and parking released the thread pointer) and renders any
// settled outcome honestly (turnFailure for failed; superseded stays
// banner-free — its receipt row is the honest rendering). Only a turn
// the workflow still owns means the connection died under us.
export function handleStreamClosedQuietlyFromStore(
  store: AssistantConversationStore,
  stillStreaming: () => boolean,
): void {
  const active = store._active;
  if (active === null) {
    return;
  }
  getAssistantThread(store.deps.session, active.thread.id)
    .then((detail) => {
      adoptRefreshedDetail(store, detail);
      // The detail is stale once the visitor moves to another thread
      // mid-flight — its verdict must not raise a banner over the new
      // one. stillStreaming is read after the round-trip on purpose: a
      // detach-and-reconnect (StrictMode's double connect) ends the
      // first run terminal-free, but by now the replacement is
      // running and no banner belongs.
      if (
        store._active?.thread.id === detail.thread.id &&
        _workflowStillOwnsTurn(detail.turns.at(-1)?.status) &&
        !stillStreaming()
      ) {
        store._streamInterrupted = true;
        publishStore(store);
      }
      void refreshThreads(store);
    })
    .catch(() => {
      // A blip here self-heals like every other refresh: the
      // visitor's next action re-reads the thread.
    });
}

export function retryStreamFromStore(store: AssistantConversationStore): void {
  store._streamInterrupted = false;
  store._automaticReconnects = 0;
  store._reconnectNonce += 1;
  publishStore(store);
}

// Answering a parked card restarts its workflow, and only a fresh
// connection can tail the restarted run — but the reconnect must not race
// the workflow's reclaim (parked → working is a worker pickup after the
// endpoint returns): a stream connected while the turn still reads parked
// closes quietly again and freezes on the stale pause. So wait for REST to
// show the turn moving, bounded — the restart is durably started, and on
// exhaustion the reconnect happens anyway (full replay is always correct).
export function handleWorkflowRestartedFromStore(
  store: AssistantConversationStore,
): void {
  const active = store._active;
  if (active === null) {
    return;
  }
  const threadId = active.thread.id;
  void (async () => {
    for (let probe = 0; probe < RESTART_RECLAIM_PROBES; probe += 1) {
      await settlesFor(SETTLE_REFRESH_DELAY_MS);
      if (store._disposed || store._active?.thread.id !== threadId) {
        return;
      }
      try {
        const detail = await getAssistantThread(store.deps.session, threadId);
        if (detail.turns.at(-1)?.status !== "parked") {
          break;
        }
      } catch {
        // Keep probing; the reconnect below is the recovery either way.
      }
    }
    if (!store._disposed && store._active?.thread.id === threadId) {
      store.retryStream();
    }
  })();
}

// The statuses a live workflow still owns; parked is deliberately not one
// of them (the workflow exited, the turn waits for its late answer).
function _workflowStillOwnsTurn(
  status: ServingAssistantTurn["status"] | undefined,
): boolean {
  return (
    status === "queued" || status === "working" || status === "awaiting_input"
  );
}

// runHttpRequest stamps the response status on a non-2xx error; a
// pre-response failure carries none.
function _httpStatusOf(error: Error): number | null {
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}
