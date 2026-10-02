// The package's root public API. The exports map exposes only this
// entry, ./activity, ./headless, ./markdown, ./scroll, ./transcript,
// ./styles.css and ./package.json — deep imports are structurally
// impossible.

export type {
  AssistantTheme,
  AssistantThemeDarkTokens,
  AssistantThemeMode,
  AssistantThemeTokens,
} from "./appearance/theme.js";
export {
  TeaflaskAssistantProvider,
  type TeaflaskAssistantAnonymousProps,
  type TeaflaskAssistantIdentityProps,
  type TeaflaskAssistantProviderBaseProps,
  type TeaflaskAssistantProviderProps,
} from "./components/teaflask-assistant-provider.js";
// The batteries-included root: provider + companion + palette
// + the ⌘K trigger in one mount. The granular pieces below stay public
// for hosts that want to own the composition.
export {
  TeaflaskAssistant,
  type TeaflaskAssistantHandle,
  type TeaflaskAssistantProps,
  type TeaflaskAssistantRootProps,
} from "./components/teaflask-assistant.js";
export {
  AssistantPage,
  type AssistantChrome,
  type AssistantPageProps,
} from "./components/assistant-page.js";
export type {
  AssistantSuggestion,
  AssistantSuggestionInput,
  AssistantSuggestionKind,
} from "./components/conversation-view.js";
export {
  AssistantPalette,
  type AssistantPaletteProps,
} from "./components/assistant-palette.js";
// The read-only activity feed: presence without a transcript.
// Deliberately minimal — the store itself stays internal.
export { useAssistantActivity } from "./components/use-assistant-activity.js";
export type {
  AssistantActivityResult,
  AssistantActivitySnapshot,
} from "./core/activity.js";
// Named by AssistantActivitySnapshot.pendingDecisionGap: a
// public field's type must be nameable by the host reading it.
export type { PendingDecisionGap } from "./core/pending-decision-gap.js";
export { resetAssistant } from "./persistence/stored-thread.js";
export { ServingApiError } from "./transport/serving-error.js";

// The contract mirror — the executable half of the serving contract
// (on any disagreement, the markdown wins).
export type {
  ActionIntent,
  ActionIntentAction,
  ActionsAdapter,
  CookiesActionsAdapter,
  HeadersActionsAdapter,
  RequestActionsAdapter,
} from "./contract/actions-adapter.js";
export type {
  ServingErrorBody,
  ServingErrorCode,
  ServingErrorCodeOnTheWire,
  ServingErrorEnvelope,
} from "./contract/errors.js";
export type {
  EndUserIdentity,
  MintVisitorTokenRequest,
  MintVisitorTokenResponse,
  PublishableKeyMode,
  VisitorTier,
  WhoamiResponse,
} from "./contract/identity.js";
export {
  SUBSCRIPTION_CONNECT_MESSAGE_TYPE,
  subscriptionConnectMessageOf,
  type SubscriptionAuthorization,
  type SubscriptionAuthorizationCompletion,
  type SubscriptionAuthorizationCompletionRequest,
  type SubscriptionConnectMessage,
  type SubscriptionCredentialState,
  type SubscriptionProvider,
  type SubscriptionStatus,
} from "./contract/subscriptions.js";
export {
  ASSISTANT_MESSAGE_MAX_CHARS,
  type ApprovalDelivery,
  type AssistantThreadDetailResponse,
  type ResolveTurnApprovalRequest,
  type ResolveTurnApprovalResponse,
  type SendAssistantMessageRequest,
  type SendAssistantMessageResponse,
  type ServingAssistantThread,
  type ServingAssistantTurn,
  type TurnApprovalDecision,
  type TurnStatus,
} from "./contract/threads.js";
export {
  APPROVAL_REQUESTED_EVENT_NAME,
  MEMORY_UPDATED_EVENT_NAME,
  RUN_RESUMED_EVENT_NAME,
  TURN_USAGE_RECORDED_EVENT_NAME,
  type ApprovalRequestedPayload,
  type AssistantStreamEventType,
  type RunResumedPayload,
} from "./contract/events.js";

// The replay-stable metadata contract: per-event server
// timestamps reduced into per-fold durations (the typed unknown-vs-
// sub-second law the transcript's fold rows render from), honest turn usage,
// and memory provenance. See docs/replay-metadata-contract.md
// for the decision record.
export {
  activeFoldElapsedOf,
  settledFoldDurationOf,
  type BlockTiming,
  type SegmentDuration,
} from "./core/segment-timing.js";
export { usageIsFinal, type TurnUsage } from "./core/turn-usage-anchors.js";
export type { MemoryUpdated } from "./core/memory-provenance-anchors.js";
export type {
  ApprovalSubmitDropReason,
  ApprovalSubmitTelemetryEvent,
  AssistantTelemetryEvent,
  StreamFailedTelemetryEvent,
  StreamFailureClass,
} from "./contract/telemetry.js";

// The presentation contract: the tool-call display envelope
// and the one-presenter-many-consumers resolver every transcript
// surface reads its slots from. See docs/presentation-architecture.md
// for the decision record.
export type {
  ToolCallDisplay,
  ToolCallState,
  ToolCallViewModel,
} from "./core/tool-call-display.js";
export {
  TOOL_CALL_ICONS,
  toolCallPresentationOf,
  type ToolCallIcon,
  type ToolCallPresentation,
} from "./core/tool-call-presentation.js";
// The tool-view contract (tool-views.md): one view per tool call,
// resolved by the presenter over four rungs — host registry by wire
// {key, version}, host registry by exact tool name, package built-ins
// under the reserved teaflask.* namespace, and the package default. The
// imperative adapter is the canonical authoring form; reactToolView is
// the React sugar over the same lifecycle. Registration is `toolViews`
// — the provider prop in React, the same-named JS property on the
// script-tag elements — trusted host code only, code never
// rides the wire.
export {
  actionToolName,
  actionToolViews,
  resolvedToolViewsOf,
  type IconAdapter,
  type JsonSchema,
  type ResolvedToolView,
  type ResolvedToolViewIcon,
  type ToolViewAdapter,
  type ToolViewCall,
  type ToolViewInstance,
  type ToolViewProps,
  type ToolViewRegistration,
  type ToolViewRegistry,
  type ToolViewResolution,
  type ToolViewThemeMode,
} from "./core/tool-view.js";
export { reactToolView } from "./components/react-tool-view.js";
// The tool-view parts (tool-views/parts.tsx): the React spelling of the
// card, row, facts, caption, body, badge, note and skeleton vocabulary
// the built-ins paint with — a host view composes these and reads as one
// system with ours.
export {
  ToolViewBadge,
  ToolViewBody,
  ToolViewBones,
  ToolViewScroll,
  ToolViewTitle,
  ToolViewCaption,
  ToolViewCard,
  ToolViewFacts,
  ToolViewNote,
  ToolViewRow,
} from "./components/tool-views/parts.js";
// The built-ins' own vocabulary (tool-views/view-dom.ts), exported so a
// host view speaks it by re-use rather than by copy: the settled-outcome
// sentence, the vanilla card parts, the labeled pane and quiet note, the
// action envelope and failure readers (the HTTP status lives only in
// resultText), and recordOf — the plain-object narrower a view's parser
// leans on, which the dashboard's views once respelled.
export {
  actionEnvelopeOf,
  actionFailureOf,
  boneRows,
  captionRow,
  card,
  factRows,
  humanFailureSentenceOf,
  listRow,
  note,
  pane,
  recordOf,
  scrollRegion,
  terminal,
  settledOutcomeNoteOf,
  settledOutcomeNotesOf,
  settledWithResult,
  type ActionEnvelope,
  type ActionFailure,
} from "./components/tool-views/view-dom.js";

// The companion: the presence surface — the bare mark in the
// corner that expands into the chat drawer, follows a tool navigation
// with the drawer open, and yields to any mounted full surface. The mark
// is the provider's `companionMark` (default: the TeaFlask flask).
export {
  AssistantCompanion,
  type AssistantCompanionProps,
} from "./components/assistant-companion.js";
