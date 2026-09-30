// The transcript surface: the React component over the
// ./transcript projection layer — one component, three binders (the
// package's own Transcript, the dashboard's agent-run viewer, the
// playground). This entry is deliberately separate from ./transcript,
// which is React-free by construction; a host that only projects rows
// never pays for React, and a host that mounts the surface imports it
// from here. Like every entry: additions are cheap until the package
// publishes, breaking changes are a customer conversation after.

export {
  AssistantTranscript,
  type AssistantTranscriptProps,
  type AgentTranscriptSource,
  type RowsTranscriptSource,
} from "./components/assistant-transcript.js";

// The slot contracts.
export type {
  MessageViewSlot,
  ToolRowSlot,
  ToolRowSlotProps,
  TranscriptMarkerProps,
  TranscriptSlotRow,
} from "./components/message-list.js";

// The shapes a binder types its own props and fills against.
export type {
  MarkerBoundaries,
  MarkerPosition,
  ToolCallRow,
  TranscriptRow,
  UserMessageRow,
  AssistantTextRow,
  SubagentDeliveryRow,
} from "./core/transcript-rows.js";
export type { ToolCallState } from "./core/tool-call-display.js";
export type { SubagentGroupRow } from "./core/subagent-rows.js";
export type { ToolCallViewModel } from "./core/tool-call-display.js";
export type { ApprovalCardModel } from "./core/approval-inbox.js";
export type { TurnAttachment } from "./contract/threads.js";

// The decision surfaces, unforked: the approval banner and the
// question panel, with the contexts a host provides them through — the
// cards travel by context because the composer block and the transcript
// both read them. The playground's forked copies were deleted; these are
// the one rendered home of each.
export { ApprovalCard } from "./components/approval-card.js";
export {
  ApprovalsContext,
  type ApprovalSurface,
} from "./components/approval-context.js";
export { QuestionPanel } from "./components/question-panel.js";
export {
  ElicitationsContext,
  type ElicitationSurface,
} from "./components/elicitation-context.js";

// The pending-decision gap's one rendered spelling: the playground's
// composer renders this rather than transcribing the copy — the
// sentence lives only in notice-banner.tsx.
// Consumer: the dashboard's playground-composer.tsx.
export { PendingDecisionGapNotice } from "./components/notice-banner.js";

// The agent identity mark, unforked: the dashboard's copy was
// a cn/cx rename away from this one and is now a re-export shim; the
// parity suite pins the logo geometry against this component directly.
export {
  AgentIdentityMark,
  type AgentIdentityRegister,
} from "./components/agent-identity-mark.js";

// The one subscribe-for-a-lifetime hook: every recorder
// component that used to hand-roll useEffect + agent.subscribe +
// unsubscribe mounts its subscriber through this instead — the dashboard's
// marker recorders, inbox recorders and stream taps included, so the
// idiom exists once. Consumers: components/agent-run/*, agents/playground/*,
// and the conversations tree through agent-run/roster.ts.
export { useAgentSubscriber } from "./components/use-agent-subscriber.js";
