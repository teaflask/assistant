"use client";

// One dispatched subagent's replayed run as React state — the driver the
// panel and the roster preview share; it opens only while holding the slot.

import type { Message } from "@ag-ui/core";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

import {
  dispatchHasSettled,
  type ThreadDispatch,
} from "../contract/dispatches.js";
import {
  blockTimingRecorder,
  foldBlockTimingObserved,
} from "../core/block-timing-anchors.js";
import type { MarkerAnchorsSnapshot } from "../core/connection-epoch.js";
import {
  messagesRecorder,
  streamErrorRecorder,
} from "../core/messages-cell.js";
import type { BlockTiming } from "../core/segment-timing.js";
import { TailSlotPool } from "../core/tail-slot-pool.js";
import {
  toolCancelRecorder,
  withToolCancelAnchored,
} from "../core/tool-cancel-anchors.js";
import {
  toolErrorRecorder,
  withToolErrorAnchored,
} from "../core/tool-error-anchors.js";
import { ServingReplayStreamAgent } from "../transport/replay-stream-agent.js";
import { streamUrlForChild } from "../transport/serving-api.js";
import { resumeMarkerRecorder } from "../transport/stream-resume.js";
import type { TokenSession } from "../transport/token-session.js";

// A child's log carries no THREAD markers — turn-level receipts are the
// parent conversation's story. Tool errors and cancellations are
// different: per-tool-call wire facts any run emits, recorded live below
// so an errored search reads output-error, never a clean result. Resume
// markers are the child's own too: a retried run activity writes
// run_resumed under the CHILD's session id, and without the anchor the
// severed attempt's open calls would read as running forever. Display
// annotations stay empty deliberately: children run the worker's
// toolbelt, not the client's annotated tools.
const THREADLESS_ANCHORS: Omit<
  MarkerAnchorsSnapshot,
  | "toolErrorAnchors"
  | "toolCancelAnchors"
  | "blockTimingAnchors"
  | "resumeAnchors"
> = {
  turnFailedAnchors: new Map(),
  subagentDeliveryAnchors: new Map(),
  toolCallDisplayAnchors: new Map(),
  // Schema anchors stay empty deliberately, the same law as the
  // display annotations above: children run the worker's toolbelt (no
  // display hook, so no tool_call_annotated markers) and render no
  // approval cards, so a live recorder here would be dead code.
  toolSchemaAnchors: new Map(),
  // Offload anchors stay empty deliberately, like display annotations:
  // children run bespoke subagent harnesses that never mount the context
  // offloader (only the agent/v1 compiler produces context "auto"), so a
  // live recorder here would be dead code.
  toolOffloadAnchors: new Set(),
  // Refusal anchors stay empty deliberately: the doors that refuse (the
  // subagent family) never extend a child's belt — a child never
  // dispatches, parks, or queries — so a live recorder here would be
  // dead code, like the offload tap above.
  toolRefusalAnchors: new Map(),
  // Decision anchors stay empty deliberately: a coworker's thread
  // carries no member decisions — approvals and asks pause the PARENT
  // turn, and their cards anchor to the parent's calls — so no decision
  // marker can name a child call and no hold can go unheld here. Stated
  // explicitly even though the snapshot field is optional (optional for
  // the ./transcript composition surface's additivity): this ledger
  // records a decision per family, and an omission reads as an
  // oversight where an empty value reads as a ruling.
  toolDecisionAnchors: new Set(),
  // Denial anchors stay empty for the same reason: with no approval
  // ever anchored to a child call, no member can decline one — the same
  // ruling as the decision line above, recorded rather than omitted.
  toolDenialAnchors: new Set(),
  // Usage and provenance anchors stay empty: the drill-in panel renders
  // no usage or provenance rows of its own — the parent transcript owns
  // those reads. Block timing is different: the panel's run folds render
  // "Worked for …" from it, so a live recorder folds it below beside the
  // error/cancel taps.
  turnUsageAnchors: new Map(),
  memoryProvenanceAnchors: new Map(),
  memoryAttributionAnchors: new Map(),
};

// The page-wide child-stream budget: ONE live child tail beside the parent
// stream and the 10s dispatches poll — under the browser's six-per-origin
// cap. Module-scoped: the budget is the origin's. The pool QUEUES, it never
// evicts: hosts mount ONE preview at a time, so switching cards UNMOUNTS the
// previous preview — its cleanup unsubscribes every tap BEFORE abortRun(),
// so a handoff never reaches the error funnel — and an overlapping second
// host waits its turn. Capacity 1 stands: cards are ROWS fed by the one open
// stream, not streams.
const CHILD_TAIL_SLOTS = new TailSlotPool(1);

type ChildStreamEnd = "open" | "clean" | "error";

interface ChildReplayStream {
  messages: readonly Message[];
  streamEnd: ChildStreamEnd;
  tailed: boolean;
  slotDenied: boolean;
  anchors: MarkerAnchorsSnapshot;
  retry: () => void;
}

export function useChildReplayStream({
  session,
  threadId,
  childSessionId,
  refreshLedger,
}: {
  session: TokenSession;
  threadId: string;
  childSessionId: string;
  refreshLedger: () => Promise<ThreadDispatch | undefined>;
}): ChildReplayStream {
  // ONE fact drives every flag below: how this panel's stream ended. The
  // end-state table, the QUIET-ending rule (a body closing with no
  // terminal is a dropped connection; REST is the authority, judged ONCE
  // and LATCHED) and the UNREAD row (only an affirmative
  // dispatchHasSettled reads clean) are in docs/transcript-surfaces.md,
  // "The child panel's end-state table". The judge orders itself: on an
  // error the ledger is caught up FIRST (the settle tap), then streamEnd
  // lands "error", so an honest RUN_ERROR already reads failed when the
  // banner question is asked. Any non-"open" end returns the tail slot;
  // Retry re-opens. Deferred setters guard on the PANEL's lifetime
  // (disposedRef), never the stream effect's own teardown — the ending
  // trips that teardown itself, so an effect-scoped flag would drop the
  // very verdict being delivered.
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [streamEnd, setStreamEnd] = useState<ChildStreamEnd>("open");
  const [attempt, setAttempt] = useState(0);
  const disposedRef = useRef(false);
  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
    };
  }, []);

  const [toolErrors, setToolErrors] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const [toolCancels, setToolCancels] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Resume anchors: the run_resumed marker a retried run activity
  // writes under the child's own session id, anchored to the retry's
  // first message. Copy-on-write like its siblings; never reset across
  // Retry — re-anchoring the same message id is an idempotent re-set.
  const [resumeAnchors, setResumeAnchors] = useState<
    ReadonlyMap<string, unknown>
  >(() => new Map());
  // Block timing: the child's stored events carry the same emit-side
  // server timestamps as the parent's, so its folds render a real
  // "Worked for …" — never the unknown register on a surface that simply
  // forgot to record. Copy-on-write like the error/cancel anchors above,
  // deliberately NOT the parent store's mutate-in-place map: that idiom
  // exists because a parent history is unbounded, while this panel
  // replays one dispatch's bounded run — identity stays the change
  // signal and no revision counter is needed. Never reset across Retry:
  // the fold reduction is min/max idempotent, so a re-replayed sequence
  // changes nothing.
  const [blockTimings, setBlockTimings] = useState<
    ReadonlyMap<string, BlockTiming>
  >(() => new Map());

  const { tailed, slotDenied } = useChildTailLease(streamEnd);

  useEffect(() => {
    if (!tailed) {
      return;
    }
    return openChildReplayStream({
      session,
      threadId,
      childSessionId,
      refreshLedger,
      disposedRef,
      setStreamEnd,
      record: {
        setMessages,
        setToolErrors,
        setToolCancels,
        setResumeAnchors,
        setBlockTimings,
      },
    });
  }, [session, threadId, childSessionId, tailed, attempt, refreshLedger]);

  const anchors = useMemo<MarkerAnchorsSnapshot>(
    () => ({
      ...THREADLESS_ANCHORS,
      resumeAnchors,
      toolErrorAnchors: toolErrors,
      toolCancelAnchors: toolCancels,
      blockTimingAnchors: blockTimings,
    }),
    [resumeAnchors, toolErrors, toolCancels, blockTimings],
  );

  return {
    messages,
    streamEnd,
    tailed,
    slotDenied,
    anchors,
    retry: () => {
      setStreamEnd("open");
      setAttempt((known) => known + 1);
    },
  };
}

// The lease lives exactly as long as the connection could (the
// stop-wanting posture): acquired at mount — a settled
// child's REPLAY still dials the stream door, so even it owes the
// budget while its connection is in flight (the recorded adjudication)
// — and released the moment the stream ENDS, not when the panel
// closes, so a finished replay frees the capacity-1 slot in moments
// instead of parking it for the length of the visit. Keyed by the
// PANEL, never the child (the rows' own-toolCallId posture) — two
// surfaces drilled into the SAME child are two streams, and a shared
// id would collapse them into one holder whose first release kills the
// survivor's tail with no waiter to promote.
function useChildTailLease(streamEnd: ChildStreamEnd): {
  tailed: boolean;
  slotDenied: boolean;
} {
  const leaseId = useId();
  useEffect(() => {
    if (streamEnd !== "open") {
      return;
    }
    CHILD_TAIL_SLOTS.acquire(leaseId);
    return () => {
      CHILD_TAIL_SLOTS.release(leaseId);
    };
  }, [leaseId, streamEnd]);
  const tailed = useSyncExternalStore(
    CHILD_TAIL_SLOTS.subscribe,
    () => CHILD_TAIL_SLOTS.holds(leaseId),
    () => false,
  );
  // Asked and DENIED — queued behind a full pool. False both before the
  // lease effect asks and after a promotion, so the waiting copy can
  // never flash on an uncontended open (the acquire announces its own
  // enqueue).
  const slotDenied = useSyncExternalStore(
    CHILD_TAIL_SLOTS.subscribe,
    () => CHILD_TAIL_SLOTS.waiting(leaseId),
    () => false,
  );
  return { tailed, slotDenied };
}

interface ChildAnchorSetters {
  setMessages: Dispatch<SetStateAction<readonly Message[]>>;
  setToolErrors: Dispatch<SetStateAction<ReadonlyMap<string, string>>>;
  setToolCancels: Dispatch<SetStateAction<ReadonlySet<string>>>;
  setResumeAnchors: Dispatch<SetStateAction<ReadonlyMap<string, unknown>>>;
  setBlockTimings: Dispatch<SetStateAction<ReadonlyMap<string, BlockTiming>>>;
}

// One attempt at the child stream: the agent, its taps, and the ending
// judge. Returns the teardown — every tap unsubscribed BEFORE the abort,
// so a handoff never reaches the error funnel.
function openChildReplayStream({
  session,
  threadId,
  childSessionId,
  refreshLedger,
  disposedRef,
  setStreamEnd,
  record,
}: {
  session: TokenSession;
  threadId: string;
  childSessionId: string;
  refreshLedger: () => Promise<ThreadDispatch | undefined>;
  disposedRef: RefObject<boolean>;
  setStreamEnd: Dispatch<SetStateAction<ChildStreamEnd>>;
  record: ChildAnchorSetters;
}): () => void {
  const agent = new ServingReplayStreamAgent({
    streamUrl: streamUrlForChild(session, threadId, childSessionId),
    streamThreadId: childSessionId,
    authorizedFetch: session.authorizedFetch,
  });
  const unsubscribeAnchorTaps = subscribeAnchorTaps(agent, record);
  // The chassis splits this stream's two error shapes: a served
  // RUN_ERROR (the child's honest terminal, verbatim or synthesized by
  // the door) arrives as onRunErrorEvent WITH the connect promise
  // still resolving, while only a transport death reaches onRunFailed
  // (streamErrorRecorder; our own aborts are filtered there). Both are
  // this stream's error ending, funneled once — and they OWN it: the
  // settle handler may claim "clean" only when no error was seen, or
  // it would overwrite the verdict a moment after it landed.
  let sawError = false;
  const endWithError = () => {
    if (sawError) {
      return;
    }
    sawError = true;
    // A RUN_ERROR mid-watch is usually the child's HONEST terminal,
    // not a dropped connection — but the ledger only learns on its
    // 10s tick. Catch it up first, and only then land the error end
    // (the table's judge order). Guarded on the PANEL's disposal:
    // this very ending tears the stream effect down (end → lease
    // released → tailed false), so an effect-scoped flag would drop
    // the verdict — the unreachable-banner regression.
    void refreshLedger().finally(() => {
      if (!disposedRef.current) {
        setStreamEnd("error");
      }
    });
  };
  const errorTap = agent.subscribe(streamErrorRecorder(endWithError));
  // The two facts the ending judge reads: whether THIS wire carried a
  // terminal, and whether this effect run has already been torn down.
  // `torn` guards ONLY the then-handler: an effect re-run's (or
  // StrictMode's) aborted predecessor resolves through the client's
  // swallowed-abort path and must not judge the successor's stream —
  // while the error funnel above keeps its PANEL-lifetime guard, per
  // the table's judge order (the unreachable-banner regression).
  let sawTerminal = false;
  let torn = false;
  const terminalTap = agent.subscribe({
    onRunFinishedEvent() {
      sawTerminal = true;
    },
    onRunErrorEvent({ event }) {
      // The chassis synthesizes a RUN_ERROR coded "abort" when the body
      // read is aborted — ours or the browser's. Never a served terminal
      // (the door sets no code), so it is not this stream's verdict: the
      // quiet-ending judge below reads the ledger instead. Matched on
      // the code only — a child's honest sentence may say "aborted".
      if (event.code === "abort") {
        return;
      }
      sawTerminal = true;
      endWithError();
    },
  });
  agent
    .connectAgent()
    .then(() => {
      if (disposedRef.current || torn || sawError) {
        return;
      }
      if (sawTerminal) {
        // A clean ending is the settle signal: the ledger catches up
        // now, not at the next tick, and the ended stream returns its
        // tail slot (a waiting sibling panel is promoted) — the error
        // path does the same through the funnel above, after its
        // catch-up.
        void refreshLedger();
        setStreamEnd("clean");
        return;
      }
      // The QUIET ending (the table's quiet rows): the body closed with
      // no terminal at all. Ledger first — the tap resolves with the row
      // it landed — then the verdict is judged ONCE against that row
      // and LATCHED as an ordinary ending. The question is AFFIRMATIVE
      // (the table's UNREAD row): only a ledger that says settled reads
      // clean; a still-dispatched row and no row at all both read as
      // the error ending, banner and Retry. Never left to a live
      // render-time read of the row, which un-painted the banner on the
      // next ledger tick over a replay truncated at the drop;
      // the error ending has always latched this way.
      void refreshLedger().then((row) => {
        if (disposedRef.current || torn) {
          return;
        }
        setStreamEnd(dispatchHasSettled(row) ? "clean" : "error");
      });
    })
    .catch(() => undefined);
  return () => {
    torn = true;
    unsubscribeAnchorTaps();
    errorTap.unsubscribe();
    terminalTap.unsubscribe();
    agent.abortRun();
    void agent.detachActiveRun().catch(() => undefined);
  };
}

// The recorders that turn the child's wire into anchored state: messages,
// tool errors, tool cancellations, resume markers, block timing. Returns
// the one unsubscribe for all five taps.
function subscribeAnchorTaps(
  agent: ServingReplayStreamAgent,
  record: ChildAnchorSetters,
): () => void {
  const messagesTap = agent.subscribe(messagesRecorder(record.setMessages));
  const errorAnchorTap = agent.subscribe(
    toolErrorRecorder((toolCallId, errorText) => {
      record.setToolErrors((previous) =>
        withToolErrorAnchored(previous, toolCallId, errorText),
      );
    }),
  );
  const cancelAnchorTap = agent.subscribe(
    toolCancelRecorder((toolCallId) => {
      record.setToolCancels((previous) =>
        withToolCancelAnchored(previous, toolCallId),
      );
    }),
  );
  const resumeAnchorTap = agent.subscribe(
    // The run id (the STORE-side arbitration key's first component)
    // is unused here on purpose: this preview's agent is never
    // snapshot-seeded — every open is a full replay into fresh
    // component state — so the seeded-replay re-delivery window does
    // not exist and the message-id gate below stays sufficient.
    resumeMarkerRecorder((_runId, messageId, markerValue) => {
      // Identity is the publish gate, like the sibling anchor taps: a
      // replayed re-anchor of the same message id (StrictMode's double
      // mount, Retry) must not re-derive the whole row projection.
      record.setResumeAnchors((previous) =>
        previous.has(messageId)
          ? previous
          : new Map(previous).set(messageId, markerValue),
      );
    }),
  );
  const timingAnchorTap = agent.subscribe(
    blockTimingRecorder((blockId, observedAtMs) => {
      record.setBlockTimings((previous) => {
        const next = new Map(previous);
        return foldBlockTimingObserved(next, blockId, observedAtMs)
          ? next
          : previous;
      });
    }),
  );
  return () => {
    messagesTap.unsubscribe();
    errorAnchorTap.unsubscribe();
    cancelAnchorTap.unsubscribe();
    resumeAnchorTap.unsubscribe();
    timingAnchorTap.unsubscribe();
  };
}
