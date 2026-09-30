// The conversation store's contract surface: the names a host or chrome
// component uses to talk to AssistantConversationStore.

import type { ServedThinkingEffort } from "../contract/assistant-config.js";
import type { AssistantTelemetryEvent } from "../contract/telemetry.js";
import type {
  ServingAssistantThread,
  ServingAssistantTurn,
  TurnAttachment,
} from "../contract/threads.js";
import type { ServingReplayStreamAgent } from "../transport/replay-stream-agent.js";
import type { ServingApiError } from "../transport/serving-error.js";
import type { StreamResumeStore } from "../transport/stream-resume.js";
import type { TokenSession } from "../transport/token-session.js";
import type { ApprovalInbox } from "./approval-inbox.js";
import type { AttachmentDraft } from "./composer-policy.js";
import type {
  ExecuteActionIntent,
  HostNavigate,
} from "./execution-handlers.js";
import type { ReadonlyCell } from "./observable-cell.js";
import type { PendingDecisionGap } from "./pending-decision-gap.js";
import type { UserTurnLedger } from "./user-turn-ledger.js";

export interface ActiveConversation {
  thread: ServingAssistantThread;
  ledger: UserTurnLedger;
  // Above the Transcript remount boundary on purpose: reconnect works by
  // remounting a fresh agent, and the resume snapshot must survive it.
  resume: StreamResumeStore;
  // Thread-lived too: an epoch swap must keep the cards rendered.
  approvalInbox: ApprovalInbox;
  // The turns window a fresh epoch's execution inbox seeds its coworker
  // requests from — a member so it has the conversation's
  // lifetime; the send empties it (tests/epoch-seed-census.test.ts).
  coworkerRequestTurns: readonly ServingAssistantTurn[];
}

/** The composer's contract with the page, travelling by context (it renders
 *  standalone and inside the transcript) as one snapshot of its own inputs. */
export interface ComposerContract {
  busy: boolean;
  // Set and cleared only in sendMessage, which EVERY surface's send goes
  // through; the stop affordance keys off this field, never a local mirror.
  pendingSend: boolean;
  // True when the optimistic message landed; false → restore the draft (scope-guarded).
  sendMessage: (
    message: string,
    attachmentIds?: string[],
    optimisticAttachments?: TurnAttachment[],
  ) => Promise<boolean>;
  // The optimistic user message: shown on submit, adopts the turn-derived
  // id when the POST lands, gone once replay injects that same message.
  pendingEcho: {
    messageId: string;
    text: string;
    attachments: TurnAttachment[];
  } | null;
  // True from a landed send until the composer re-enables and takes the
  // caret back; store-held because every send remounts the composer.
  composerRefocusPending: boolean;
  markComposerRefocusHandled: () => void;
  // True from the stop POST until busy flips false; never raises the banner.
  stopping: boolean;
  stopTurn: () => Promise<void>;
  // The thread's stored model pick, overlaid by a chip selection not yet
  // carried by a send; null means the configured model answers.
  modelPick: ComposerModelPick | null;
  setModelPick: (pick: ComposerModelPick) => void;
  // The unsaved draft lives in the STORE, on its own cell, so no
  // remount can eat it (lifetime ruled in docs/connection-lifecycle.md).
  composerInput: ReadonlyCell<ComposerInput>;
  setDraft: (next: string | ((current: string) => string)) => void;
  setAttachments: (
    next:
      | readonly AttachmentDraft[]
      | ((current: readonly AttachmentDraft[]) => readonly AttachmentDraft[]),
  ) => void;
  // Focus bookkeeping for involuntary remounts: the owner-stamped
  // one-shot caret return, taken at mount (docs/connection-lifecycle.md).
  noteComposerFocus: (owner: string | null) => void;
  takeComposerCaretReturn: (surface: string) => boolean;
}

/** The composer's unsaved input, the composer-only cell's snapshot. */
export interface ComposerInput {
  // An opaque scope token: "t:<thread id>", or a freshly MINTED "u:<n>" per
  // conversation-less state. INVARIANT: every write of _active re-scopes it,
  // and the send-refusal restore compares against it (the lifecycle doc).
  scope: string;
  draft: string;
  attachments: readonly AttachmentDraft[];
}

/** One chip selection. A null modelId is a real state — no model pin: the
 *  configured model answers under the picked effort (the way back). */
export interface ComposerModelPick {
  modelId: string | null;
  effort: ServedThinkingEffort | null;
}

// Owned by the composer policy leaf; re-exported beside the draft it rides.
export type { AttachmentDraft } from "./composer-policy.js";

// The inbox's (its public submit seam); re-exported for the store's consumers.
export type { ApprovalDecisionInput } from "./approval-inbox.js";

export interface ConversationSnapshot {
  active: ActiveConversation | null;
  // The identified visitor's history: page chrome the palette never renders.
  threads: ServingAssistantThread[];
  // True when this browser is identified or the host wired identity (the
  // sidebar's story); false is the anonymous page's plain new-conversation.
  historyExpected: boolean;
  // A thread detail fetch is in flight and will replace the view; the
  // chrome fills the gap with a skeleton instead of a flash of another state.
  threadOpening: boolean;
  reconnectNonce: number;
  sendError: string | null;
  turnFailure: string | null;
  // A dead connection mid-turn is worth a banner; a stream that ended
  // because the turn settled failed is the failure notice's story.
  showInterruptionBanner: boolean;
  // The server names pending interrupts this client holds nothing for;
  // rendered as an explicit recoverable alert, never silence.
  pendingDecisionGap: PendingDecisionGap | null;
}

export interface HostCapabilities {
  navigate: HostNavigate | null;
  executeActionIntent: ExecuteActionIntent | null;
}

export interface ConversationStoreDeps {
  session: TokenSession;
  publishableKey: string;
  // Whether the host wired getEndUserToken: identified history loads eagerly.
  identityProvided: boolean;
  // Read fresh at each use: hosts re-wire navigation/actions across renders.
  hostCapabilitiesOf: () => HostCapabilities;
  reportError: (error: Error) => void;
  // The approval submit path's self-narration; a no-op unwired.
  onTelemetry: (event: AssistantTelemetryEvent) => void;
  // Rung when a send refuses with a gate-shaped code: the session entry
  // adopts it as the conversation gate so the takeover renders immediately.
  onGateRefusal: (error: ServingApiError) => void;
  // Rung when a run settles (debounced with the settle re-read): the session
  // entry re-reads the pre-flight projection (taster budget, plan window).
  onTurnSettled: () => void;
}

/** What a mounted transcript needs from the live connection epoch. */
export interface ConnectionSnapshot {
  epochId: number;
  agent: ServingReplayStreamAgent;
  threadId: string;
  streamThreadId: string;
}

/** A presigned display URL and the moment it stops being safe for an <img>. */
export interface MintedDownloadUrl {
  url: string;
  expiresAtMs: number;
}
