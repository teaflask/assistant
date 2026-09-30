// The transcript projection layer, shared with the dashboard's agent-run
// viewer: the row derivation, the anchor recorders and the
// subagent grouping exist once, here. Wire-agnostic, React-free and
// transport-free by construction — MarkerAnchorsSnapshot rides type-only
// so connection-epoch's transport never enters this closure. AG-UI names
// are re-exported so a host never depends on the @ag-ui packages itself.

// The chassis seam.
export { AbstractAgent, HttpAgent } from "@ag-ui/client";
export type { AgentSubscriber } from "@ag-ui/client";
export type { BaseEvent, Message, RunAgentInput } from "@ag-ui/core";

// The tool-outcome lift a host's own HttpAgent subclass pipes its run()
// through, and the reader the anchor families use — the wire's five
// TOOL_CALL_RESULT extras survive the 1.0 client's enforcement only under
// event metadata.
export {
  liftToolOutcome,
  toolOutcomeOf,
  withToolOutcomeLifted,
  type ToolOutcome,
} from "./core/tool-outcome.js";

// The flat row projection. Scope note: MarkerAnchorsSnapshot has
// fifteen anchor fields and this entry ships recorders for seven
// (display, error, cancel, refusal, decision, denial — the last two optional
// on the snapshot, absent reading as empty — and the string-receipt family).
// The other eight are passable empty but not populatable from here: a
// live-store host populates every anchor itself; only an own-wire host
// composing its own snapshot waits. The counts are executed, not trusted
// (tests/tool-call-state-sites.test.ts; approvalInboxRecorder feeds no
// snapshot field, so it sits outside them).
export {
  errorTextOf,
  transcriptRowsOf,
  type TranscriptRow,
} from "./core/transcript-rows.js";
export type { MarkerAnchorsSnapshot } from "./core/connection-epoch.js";

// The wire taps.
export { messagesRecorder, streamErrorRecorder } from "./core/messages-cell.js";

// The tool-call anchor families: for each, the empty constant, the
// idempotent merge and the recorder — the surface a composition wires.
export type { ToolCallDisplay } from "./core/tool-call-display.js";
export {
  EMPTY_TOOL_CALL_DISPLAY_ANCHORS,
  toolCallDisplayRecorder,
  withToolCallDisplayAnchored,
} from "./core/tool-call-display-anchors.js";
export {
  EMPTY_TOOL_ERROR_ANCHORS,
  toolErrorRecorder,
  withToolErrorAnchored,
} from "./core/tool-error-anchors.js";
export {
  EMPTY_TOOL_CANCEL_ANCHORS,
  toolCancelRecorder,
  withToolCancelAnchored,
} from "./core/tool-cancel-anchors.js";
export {
  EMPTY_TOOL_REFUSAL_ANCHORS,
  toolRefusalRecorder,
  withToolRefusalAnchored,
} from "./core/tool-refusal-anchors.js";
export {
  EMPTY_TOOL_DECISION_ANCHORS,
  toolDecisionRecorder,
  withToolDecisionAnchored,
} from "./core/tool-decision-anchors.js";
// The denial family ships a LEDGER, not a set: the recorder's
// marker is folded into the same value on every host, and the snapshot
// takes the ledger's `denied` half. Without this trio a composer over
// transcriptRowsOf would hold a ladder rung no exported recorder can
// populate — and render every member denial as Interrupted.
export {
  EMPTY_TOOL_DENIAL_LEDGER,
  toolDenialRecorder,
  withToolDenialMarkerFolded,
  type ToolDenialLedger,
  type ToolDenialMarker,
} from "./core/tool-denial-anchors.js";
// The string-receipt family: the dashboard's run viewer and
// playground bind their turn_failed and turn_stopped rows to it by event
// name; the recorder feeds the snapshot's turnFailedAnchors field.
export {
  receiptMarkerRecorder,
  receiptOf,
  withReceiptAnchored,
  type AnchoredReceipts,
} from "./core/receipt-anchors.js";
export {
  EMPTY_TURN_FAILED_ANCHORS,
  turnFailedReceiptOf,
  withTurnFailedAnchored,
  type AnchoredTurnFailReceipts,
} from "./core/turn-failed-anchors.js";

// The subagent surfaces.
export {
  rosterEntriesOf,
  settledDurationLabelOf,
  subagentPillLabelOf,
  subagentRosterOf,
  type RosterSourceDispatch,
  type RosterStatusPredicates,
  type SubagentRoster,
  type SubagentRosterEntry,
} from "./core/subagent-roster.js";
export {
  DISPATCH_SUBAGENT_TOOL_NAME,
  dispatchReceiptOf,
  subagentGroupHeadlineOf,
  subagentOutcomeCountsOf,
  taskExcerptOf,
  withSubagentGroups,
  type DispatchCall,
  type DispatchReceipt,
  type SubagentGroupEntry,
  type SubagentGroupRow,
  type SubagentOutcomeCounts,
} from "./core/subagent-rows.js";
export { coworkerIndicesOf } from "./core/subagent-presence.js";

// The elicitation narrowing.
export {
  askQuestionsActionOf,
  type QuestionModel,
} from "./core/elicitation-pickers.js";

// The approval inbox: the React-free state machine behind the
// approval banner and the recorder that feeds it. A host constructs one per
// conversation, subscribes the recorder, renders ApprovalCard, and — if its
// door serves a turn record — re-judges on every REST read against the
// lenient ApprovalTurnRecord (every pause field optional: degrade, never
// demand). The three stamped flags are opt-in capabilities, default off.
export {
  ANSWER_NOT_SENT_SENTENCE,
  ApprovalInbox,
  approvalInboxRecorder,
  answerablePauseOf,
  reconcileApprovalsWithTurns,
  SERVING_APPROVAL_CAPABILITIES,
  type ApprovalCardModel,
  type ApprovalCardStatus,
  type ApprovalDecisionInput,
  type ApprovalInboxCapabilities,
  type ApprovalTurnRecord,
} from "./core/approval-inbox.js";

// The one definition of "this decision still waits on the member" for each
// card family: hosts read these rather than respelling the status
// arithmetic, so a status the package adds later is judged in one place.
export {
  approvalAwaitsMember,
  elicitationAwaitsMember,
} from "./core/suspension-queue.js";

// The question-set drafts and the card shapes the question panel reads:
// the draft store is import-free and lives above the transcript's
// remount key in every host; the card types let a React-free host build them.
export { QuestionDraftStore } from "./core/question-drafts.js";
export type {
  AnsweredQuestions,
  ElicitationCardModel,
  ElicitationCardStatus,
  QuestionSetCardModel,
} from "./core/elicitation-cards.js";

// The execution vocabulary a refusing surface needs: the canned
// refusal (the contract's documented degrade for kinds a client can't
// execute), the member-answerable set and the ask kind, so a host gates on
// the PACKAGE's vocabulary and never auto-answers a kind whose executor is
// the member. All from the dependency-free kinds leaf; the closure holds.
export {
  ASK_QUESTIONS_REQUEST_KIND,
  KIND_UNSUPPORTED_OUTCOME,
  MEMBER_ANSWERABLE_KINDS,
} from "./core/execution-kinds.js";

// The execution wire's two CUSTOM marker names: a host recorder
// feeding its own inbox matches the same names the package's recorders do,
// so the wire vocabulary stays single-sourced.
export {
  TOOL_EXECUTION_REQUESTED_EVENT_NAME,
  TOOL_RESULT_RECORDED_EVENT_NAME,
} from "./contract/events.js";
// The marker names the dashboard's own receipt and divider rows narrow,
// imported here so the wire vocabulary stays single-sourced
// rather than respelled from the generated enum beside each row.
export {
  APPROVAL_RESOLVED_EVENT_NAME,
  RUN_RESUMED_EVENT_NAME,
  SUBAGENT_RESULTS_DELIVERED_EVENT_NAME,
  TURN_FAILED_EVENT_NAME,
  TURN_STOPPED_EVENT_NAME,
} from "./contract/events.js";
// The delivery marker's narrower and shape: the dashboard's
// delivery divider imports the package's narrowing; only its label is its own.
export {
  deliveredResultsOf,
  type DeliveredResult,
} from "./core/subagent-delivery-anchors.js";
// The approval_resolved narrower: carries the two optional
// fields the dashboard's audit receipt row renders, and exists once.
export {
  approvalResolvedPayloadOf,
  type ApprovalResolved,
} from "./core/approval-resolved.js";
// The execution driver's delivery cap: one value, one leaf.
export { MAX_DELIVERY_ATTEMPTS } from "./core/execution-kinds.js";
// A coworker's execution request as the turn snapshot lists it:
// the dashboard's playground refuses it through the same
// narrowing the package's driver executes it with.
export {
  coworkerExecutionRequestOf,
  type CoworkerExecutionRequest,
} from "./core/execution-request-narrowing.js";

// The pending-decision gap: the playground's decision surface
// computes the same "a pending interrupt id nothing client-side answers
// for" verdict the widget store publishes — one derivation AND one
// quiet→loud grace, never a twin. The leaf's only import is a type, so this
// entry's transport-free closure holds. GapJudgeableTurn is deliberately
// NOT here: callers pass their own turn types structurally (no consumer).
export {
  GAP_PROBE_SETTLE_MS,
  PendingDecisionGapGate,
  pendingDecisionGapOf,
  type PendingDecisionGap,
} from "./core/pending-decision-gap.js";

// The conversation core's timing and paging policies, single-sourced: the
// settle re-read's debounce, the stop's bounded fallback probe, and the
// turns cursor walk. Their constants stay module-level — the policies carry
// them and nothing dashboard-side names them (the no-consumer rule). All
// three are setTimeout-only leaves, so the transport-free closure holds.
export { SettleRefreshScheduler } from "./core/settle-refresh.js";
export { probeStopSettle } from "./core/stop-settle.js";
export { backfilledTurnsOf } from "./core/turns-backfill.js";

// The user-turn ledger's injector and id derivation: the
// injector is generic over the InjectableTurnLedger slice both the package
// and dashboard ledgers satisfy, so it exists once.
export { userMessageIdFor, userTurnInjector } from "./core/user-turn-ledger.js";

// The composer policy leaf: the per-message bounds, the cap
// accounting, the pick-time size cap and the Escape/Enter verbs both
// composers apply — the package slab's and the dashboard playground's.
export {
  attachmentDraftFailed,
  capSlotsSpentBy,
  CHARACTER_COUNT_VISIBLE_FROM,
  composerKeyHandlersOf,
  mintAttachmentDraftId,
  pickCapOf,
  type AttachmentDraft,
} from "./core/composer-policy.js";
export {
  ASSISTANT_MAX_ATTACHMENTS,
  ASSISTANT_MESSAGE_MAX_CHARS,
} from "./contract/threads.js";
// The stop door's generic failure line: one leaf, no respelling.
export { STOP_NOT_DELIVERED_SENTENCE } from "./core/stop-copy.js";

// The subscriber off switch: a recorder that connectAgent has
// snapshotted into a run outliving its effect is silenced by dispose(),
// not by the unsubscribe that cannot reach that run.
export {
  disposableSubscriber,
  type DisposableAgentSubscriber,
} from "./core/disposable-subscriber.js";

// Presentation leaves.
export { newestAssistantProseIdOf } from "./core/assistant-prose.js";
export { prettyPrintParameters } from "./components/pretty-print.js";
export { humanFileSize } from "./components/human-file-size.js";
