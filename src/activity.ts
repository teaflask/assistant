// The activity-only entry: a consumer that
// renders presence — a companion, a badge, a doorbell — imports the
// provider and the feed from here and never pays for the transcript
// chrome, CopilotKit, or their stylesheets. The root entry exports the
// same names for convenience, but only THIS subpath's import graph
// provably excludes the transcript (tests/bundle-closure.test.ts holds
// it to that).

export {
  TeaflaskAssistantProvider,
  type TeaflaskAssistantAnonymousProps,
  type TeaflaskAssistantIdentityProps,
  type TeaflaskAssistantProviderBaseProps,
  type TeaflaskAssistantProviderProps,
} from "./components/teaflask-assistant-provider.js";
export { useAssistantActivity } from "./components/use-assistant-activity.js";
export type {
  AssistantActivityResult,
  AssistantActivitySnapshot,
} from "./core/activity.js";
// Named by AssistantActivitySnapshot.pendingDecisionGap: a
// public field's type must be nameable by the host reading it.
export type { PendingDecisionGap } from "./core/pending-decision-gap.js";
// The companion presence surface lives on this entry: its
// minimized widget is the corner mark this lean bundle serves, and its
// chat drawer rides a dynamic import so the transcript exclusion above
// still holds statically.
export {
  AssistantCompanion,
  type AssistantCompanionProps,
} from "./components/assistant-companion.js";
