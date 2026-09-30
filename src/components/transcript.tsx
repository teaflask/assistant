"use client";

import { useMemo } from "react";

import type { ApprovalCardModel } from "../core/approval-inbox.js";
import type { AssistantConversationStore } from "../core/conversation-store.js";
import type { TranscriptRow } from "../core/transcript-rows.js";
import { ActivityShelf, ComposerActivityOverlay } from "./activity-shelf.js";
import { ApprovalsContext, type ApprovalSurface } from "./approval-context.js";
import { AssistantTranscript } from "./assistant-transcript.js";
import { Composer } from "./composer.js";
import { RunStatusAnnouncer } from "./run-status-announcer.js";
import {
  ElicitationsContext,
  type ElicitationSurface,
} from "./elicitation-context.js";
import { SurfaceBoundary } from "./surface-boundary.js";
import { SuspensionSurfaces } from "./suspension-surfaces.js";
import { SubagentCountPill } from "./subagent-count-pill.js";
import { SubagentDelegationSurface } from "./subagent-delegation-surface.js";
import {
  SubagentDispatchesContext,
  type SubagentDispatchesJoin,
} from "./subagent-group-row.js";
import { SubagentExecutionWorkContext } from "./subagent-execution-work.js";
import { useAssistantSession } from "./teaflask-assistant-provider.js";
import { useCell } from "./use-store-cell.js";
import { useThreadDispatches } from "./use-thread-dispatches.js";
import { useConversation } from "./conversation-context.js";
import { useTranscript } from "./use-transcript.js";

/** The streamed conversation, drawn entirely from the store's cells (the
 *  message list, marker anchors and approval cards ride their recorders);
 *  the store is the only connection driver. Mounting registers this
 *  surface's transcript lease — what guarantees the epoch connects once,
 *  so history paints by full replay; unmounting mid-turn changes nothing,
 *  because the store's own run keeps streaming. Any number may render
 *  concurrently. */
export function Transcript({ surface }: { surface: string }) {
  const { session, store } = useAssistantSession();
  const { pendingSend } = useConversation();
  const connection = useCell(store.connection);
  const { approvalCards, approvalSurface, elicitationSurface } =
    useDecisionSurfaces(store);
  // The cells-to-rows derivation lives in useTranscript, public on ./headless.
  const { rows, displayRows, running, turnOpen, decisionsPending, activity } =
    useTranscript({ surface });

  // The decision join: where each pausable call sits in the projected
  // transcript, for the suspension queue's deterministic order — order
  // is ALL the tenant needs from the transcript.
  const rowIndexByToolCallId = useMemo(
    () => _rowIndexByToolCallIdOf(displayRows),
    [displayRows],
  );
  // The dispatch ledger join: a delegated child may settle after its turn
  // ends, freezing its wire receipt at running — the thread's ledger rows,
  // polled only while any coworker is unsettled, are the truth.
  const dispatches = useThreadDispatches(
    session,
    connection?.threadId ?? null,
    rows,
    // The settle relay: an observed settle's wake may have opened a
    // delivery turn — the store probes for it and attaches.
    store.noteDispatchSettled,
    // The pause relay: a coworker read paused has a request on its
    // dispatching turn's snapshot — the store re-reads and the
    // execution driver carries it.
    store.noteDispatchPaused,
  );
  const dispatchesJoin = useMemo<SubagentDispatchesJoin>(
    () => ({ byOrdinal: dispatches }),
    [dispatches],
  );
  const coworkerWork = useCell(store.coworkerWork);

  if (connection === null) {
    return null;
  }

  return (
    <ApprovalsContext.Provider value={approvalSurface}>
      <ElicitationsContext.Provider value={elicitationSurface}>
        {/* The drill-in host: the group rows' drill-in seam and
            current-work map, floating the shared child-transcript preview
            beside its opener as top-layer content — layout and shelf untouched. */}
        <SubagentDelegationSurface
          dispatches={dispatches}
          threadId={connection.threadId}
        >
          <SubagentDispatchesContext.Provider value={dispatchesJoin}>
            <SubagentExecutionWorkContext.Provider value={coworkerWork}>
              {/* No `typing` here: the conversation chrome makes no
              run-state claims, and the dot would duplicate the fold's live
              headline or the standalone Working… headline. The dot remains
              the silence signal for shelf-less MessageList hosts. */}
              {/* Every child below except the composer rides its own SurfaceBoundary
                (tests/transcript-chrome-propagation.test.tsx): a throw costs one surface, never
                the conversation. The COMPOSER is the deliberate exception (the input-region
                rule): its throw propagates loudly outward (conversation-view's keyed backstop,
                or a bare mount's host boundary), never a latched fallback. */}
              <SurfaceBoundary surface="message-list">
                <AssistantTranscript
                  rows={displayRows}
                  cards={approvalCards}
                  // pendingSend joins the liveness from the instant of send:
                  // `running` reads newestTurnStatus, which stays null until
                  // the send POST returns. NOT fed into useTranscript's
                  // `running`, which would re-mark the prior turn's settled
                  // answer as streaming.
                  live={running || pendingSend}
                  turnOpen={turnOpen}
                  // The actionable surfaces live on the shelf: rows keep the
                  // compact chronology; a settled decision renders no
                  // transcript line — the meta-receipt rows are gone. No pause
                  // flag: the pause itself neither claims "Working…" nor holds
                  // a fold open — the anchored decision does the holding (the
                  // decision arm); a decision-less pause is the machine's
                  // time.
                  decisionSurfacesInShelf
                  // The input slot stays deliberately UNFILLED on this binder —
                  // announcer, shelf and composer render as siblings below. Both
                  // spellings satisfy the input-region rule: the input region carries
                  // the surface's ability to act and never sits behind a
                  // null-fallback boundary, so a render throw propagates to the
                  // host's boundary (transcript-chrome-propagation.test.tsx).
                />
              </SurfaceBoundary>
            </SubagentExecutionWorkContext.Provider>
          </SubagentDispatchesContext.Provider>
          {/* The status live region, mounted UNCONDITIONALLY (an empty
            sr-only span while idle): screen readers announce mutations of
            an existing region, so it must pre-exist the first phrase; outside
            the shelf's slots so their :empty collapse survives. degrade="silent":
            the announcer never paints, so absence is the honest degraded state. */}
          <SurfaceBoundary surface="status-announcer" degrade="silent">
            <RunStatusAnnouncer
              status={activity.newestTurnStatus}
              // The same predicate the fold's liveness reads:
              // one fact, every carrier in agreement.
              decisionsPending={decisionsPending}
            />
          </SurfaceBoundary>
          {/* Inside the delegation surface on purpose: the count pill's
            roster needs the drill-in seam and publishes current work through
            the same context the group rows read. The anchor wrapper spans the
            SHELF and the composer, so compact activity floats above whichever
            is the top of the seam — never under a populated suspension card. */}
          <div data-tf-composer-anchor="" className="tf:relative">
            <SurfaceBoundary surface="activity-overlay">
              <ComposerActivityOverlay
                activity={
                  <SubagentCountPill
                    dispatches={dispatches}
                    threadId={connection.threadId}
                  />
                }
              />
            </SurfaceBoundary>
            <SurfaceBoundary surface="activity-shelf">
              <ActivityShelf
                suspension={
                  // shelfItem: when the boundary replaces the tenant, the fallback
                  // card IS the tenant and must carry data-tf-shelf-item (the landlord contract).
                  <SurfaceBoundary surface="decisions" shelfItem>
                    <SuspensionSurfaces
                      rowIndexByToolCallId={rowIndexByToolCallId}
                    />
                  </SurfaceBoundary>
                }
              />
            </SurfaceBoundary>
            {/* Deliberately UNWRAPPED — see the input-region note above:
                the composer's throw must propagate, never latch. */}
            <Composer surface={surface} />
          </div>
        </SubagentDelegationSurface>
      </ElicitationsContext.Provider>
    </ApprovalsContext.Provider>
  );
}

/** The two decision seams the transcript provides — approvals and
 *  elicitations — each as the store's cards beside the store's submit
 *  methods. */
function useDecisionSurfaces(store: AssistantConversationStore): {
  approvalCards: readonly ApprovalCardModel[];
  approvalSurface: ApprovalSurface;
  elicitationSurface: ElicitationSurface;
} {
  const approvalCards = useCell(store.approvals);
  const approvalSurface = useMemo<ApprovalSurface>(
    () => ({
      cards: approvalCards,
      submitDecision: store.submitApprovalDecision,
    }),
    [approvalCards, store],
  );

  const elicitationCards = useCell(store.elicitations);
  const elicitationSurface = useMemo<ElicitationSurface>(
    () => ({
      cards: elicitationCards,
      submitQuestionAnswers: store.submitQuestionAnswers,
      cancelQuestionSet: store.cancelQuestionSet,
      drafts: store.questionDrafts,
    }),
    [elicitationCards, store],
  );

  return { approvalCards, approvalSurface, elicitationSurface };
}

function _rowIndexByToolCallIdOf(
  displayRows: readonly TranscriptRow[],
): ReadonlyMap<string, number> {
  const indexByToolCallId = new Map<string, number>();
  displayRows.forEach((row, index) => {
    if (row.kind === "tool-call") {
      indexByToolCallId.set(row.toolCallId, index);
    }
  });
  return indexByToolCallId;
}
