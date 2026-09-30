// The bring-your-own-frontend entry: the provider and the
// live-session hooks, with none of the package chrome. A host mounts
// <TeaflaskAssistantProvider> alone, DRIVES the conversation through
// useAssistantConversation()'s contract, the composer contract, and the
// approval/elicitation surfaces, and RENDERS the replies through
// useTranscript()'s read surface — bindings over the shared
// store, never the machinery. The read surface lives here, not on
// ./transcript, because binding to a live store needs the transport the
// provider constructs; the anchor RECORDERS stay on ./transcript for
// own-wire hosts. The serving session internals stay private on purpose;
// tests/bundle-closure.test.ts holds this entry's static closure chrome-free.

export {
  TeaflaskAssistantProvider,
  type TeaflaskAssistantProviderProps,
} from "./components/teaflask-assistant-provider.js";
// The provider props' own field types (the nameability law: tests/headless-
// nameability walks every export's public fields and fails on any
// src-declared type a host cannot name from this entry).
// AssistantSuggestionInput lives in conversation-view.tsx, a chrome module —
// type-only, so the closure stays chrome-free.
export type {
  AssistantTheme,
  AssistantThemeDarkTokens,
  AssistantThemeMode,
  AssistantThemeTokens,
} from "./appearance/theme.js";
export type {
  ActionsAdapter,
  ActionIntent,
  ActionIntentAction,
  CookiesActionsAdapter,
  HeadersActionsAdapter,
  RequestActionsAdapter,
} from "./contract/actions-adapter.js";
export type {
  ApprovalSubmitTelemetryEvent,
  AssistantTelemetryEvent,
  StreamFailedTelemetryEvent,
} from "./contract/telemetry.js";
export type {
  AssistantSuggestion,
  AssistantSuggestionInput,
  AssistantSuggestionKind,
} from "./components/conversation-view.js";
export type {
  IconAdapter,
  // JsonSchema (ToolViewCall.argsSchema) is demanded by the nameability law;
  // exported here exactly as the root exports it.
  JsonSchema,
  ToolViewAdapter,
  ToolViewCall,
  ToolViewInstance,
  ToolViewProps,
  ToolViewRegistration,
  ToolViewRegistry,
} from "./core/tool-view.js";
export {
  useAssistantConversation,
  type AssistantConversation,
} from "./components/use-assistant-conversation.js";
export {
  useConversation,
  type ComposerContract,
} from "./components/conversation-context.js";
export {
  useApprovals,
  type ApprovalSurface,
} from "./components/approval-context.js";
export {
  useElicitations,
  type ElicitationSurface,
} from "./components/elicitation-context.js";
// The composer contract's per-keystroke half rides its own cell
// (composerInput) so reading it never re-renders the coarse contract —
// useCell is the one React seam onto a cell, exported so a host's own
// composer reads it the way the package chrome does.
export { useCell } from "./components/use-store-cell.js";
export type { ReadonlyCell } from "./core/observable-cell.js";
// The types the hooks' return values are made of — a public field's type
// must be nameable by the host reading it. Type-only where the backing
// module is machinery (the store class itself is never exported).
export type { ApprovalCardModel } from "./core/approval-inbox.js";
export type {
  ActiveConversation,
  ApprovalDecisionInput,
  AttachmentDraft,
  ComposerInput,
  ComposerModelPick,
} from "./core/conversation-store.js";
// The composer contract's remaining field types (the
// ServingErrorCodeOnTheWire rule again): sendMessage's attachments,
// setModelPick's pick and its effort — a host writing
// useState<ComposerModelPick | null> or a helper over the attachment
// list must be able to name them.
export type {
  ServingAttachment,
  ThreadModelPick,
  TurnAttachment,
} from "./contract/threads.js";
export type { ServedThinkingEffort } from "./contract/assistant-config.js";
export type {
  ElicitationCardModel,
  QuestionSetCardModel,
} from "./core/elicitation-cards.js";
export type {
  QuestionModel,
  QuestionOptionModel,
} from "./core/elicitation-pickers.js";
export type {
  QuestionAnswerDraft,
  QuestionDraftStore,
  QuestionSetDraft,
} from "./core/question-drafts.js";
export type { PendingDecisionGap } from "./core/pending-decision-gap.js";
export type { ServingAssistantThread } from "./contract/threads.js";
export { ServingApiError } from "./transport/serving-error.js";
// ServingApiError.code's type — a public field's type must be nameable
// by the host reading it.
export type { ServingErrorCodeOnTheWire } from "./contract/errors.js";
// The transcript read surface: rendering the assistant's
// replies from this entry. Mounting the hook registers transcript
// presence with the store — presence is what GUARANTEES the epoch
// connects (once, so history paints by full replay), and what arms the
// idle re-read. A lease-less store connects only while the newest turn
// is queued/working (bounded budget — the connection truth table in
// core/connection-driver.ts), and that connect is the same full replay; what it
// never gets is a connect while no turn is live, so a reopened settled
// thread's messages stay empty without the hook.
export {
  useTranscript,
  type TranscriptSurface,
} from "./components/use-transcript.js";
// The projection and its row types, re-exported from their core modules.
// Where a name is also on ./transcript (transcriptRowsOf, TranscriptRow,
// Message, MarkerAnchorsSnapshot, ToolCallDisplay, SubagentGroupRow,
// SubagentGroupEntry, DispatchReceipt) it is the SAME symbol, so a host may
// mix imports freely; the rest are public here (several row members also
// ride ./transcript-ui). transcriptRowsOf and
// withPendingUserEcho ride as values so a host projecting the raw reads
// never needs a second entry; Message is re-exported so a host never takes
// its own dependency on the @ag-ui packages.
export {
  transcriptRowsOf,
  withPendingUserEcho,
  type AssistantTextRow,
  type PendingUserEcho,
  type ReasoningRow,
  type SubagentDeliveryRow,
  type ToolCallRow,
  type TranscriptRow,
  type TurnFailedReceiptsRow,
  type UserMessageRow,
} from "./core/transcript-rows.js";
export type { Message } from "@ag-ui/core";
export type { MarkerAnchorsSnapshot } from "./core/connection-epoch.js";
// The row types' own field types (the nameability law again): every
// named src-declared type a host can observe one level down from the
// surface must be nameable from this entry.
export type {
  DispatchReceipt,
  SubagentGroupEntry,
  SubagentGroupRow,
} from "./core/subagent-rows.js";
export type { AnchoredTurnFailReceipts } from "./core/turn-failed-anchors.js";
// AnchoredTurnFailReceipts is an alias of AnchoredReceipts, and the
// checker records the interface behind the alias — both are nameable.
export type { AnchoredReceipts } from "./core/receipt-anchors.js";
export type { DeliveredResult } from "./core/subagent-delivery-anchors.js";
export type { MemoryUpdated } from "./core/memory-provenance-anchors.js";
export type { BlockTiming } from "./core/segment-timing.js";
export type {
  ToolCallDisplay,
  ToolCallState,
} from "./core/tool-call-display.js";
export type { ToolCallSchemas } from "./core/tool-schema-anchors.js";
export type { TurnUsage } from "./core/turn-usage-anchors.js";
export type {
  AssistantActivityResult,
  AssistantActivitySnapshot,
} from "./core/activity.js";
export type { TurnStatus } from "./contract/threads.js";
export type { UserTurnMeta } from "./core/user-turn-ledger.js";
// Sign-out belongs to a bring-your-own-frontend host too: without this,
// the README's sign-out instruction pulls the ROOT barrel (transcript,
// markdown and all) into a headless bundle for one localStorage helper.
// Zero closure cost — persistence/stored-thread already rides this
// entry via the conversation store.
export { resetAssistant } from "./persistence/stored-thread.js";
