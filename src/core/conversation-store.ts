import type { Message } from "@ag-ui/core";

import type { VisitorTier } from "../contract/identity.js";
import type {
  ServingAssistantThread,
  ServingAssistantTurn,
  ServingAttachment,
  TurnAttachment,
} from "../contract/threads.js";
import type { StreamResumeStore } from "../transport/stream-resume.js";
import {
  IDLE_ACTIVITY,
  type AssistantActivityResult,
  type AssistantActivitySnapshot,
} from "./activity.js";
import type {
  ApprovalCardModel,
  ApprovalDecisionInput,
} from "./approval-inbox.js";
import type {
  ConnectionEpoch,
  MarkerAnchorsSnapshot,
} from "./connection-epoch.js";
import type {
  AnsweredQuestions,
  ElicitationCardModel,
  QuestionSetCardModel,
} from "./elicitation-cards.js";
import type { CoworkerExecutionWork } from "./coworker-execution-work.js";
import {
  noteDispatchSettledFromStore,
  refreshConversationFromStore,
} from "./conversation-refresh.js";
import {
  mintAttachmentDownloadUrlFromStore,
  uploadAttachmentFromStore,
} from "./attachment-uploads.js";
import {
  handleUserMessageInjectedFromStore,
  markComposerRefocusHandledFromStore,
  sendMessageFromStore,
  stopTurnFromStore,
} from "./conversation-send.js";
import {
  noteComposerFocusFromStore,
  setComposerAttachmentsFromStore,
  setComposerDraftFromStore,
  setModelPickFromStore,
  takeComposerCaretReturnFromStore,
} from "./composer-input-state.js";
import { submitApprovalDecisionFromStore } from "./approval-decision.js";
import {
  invalidateInFlightResume,
  loadHistoryOnceExpected,
  openThreadFromStore,
  refreshThreads,
  resumeStoredThreadFromStore,
  startNewConversationFromStore,
} from "./conversation-adoption.js";
import {
  cancelQuestionSetFromStore,
  submitQuestionAnswersFromStore,
} from "./elicitation-answers.js";
import { QuestionDraftStore } from "./question-drafts.js";
import {
  PendingDecisionGapGate,
  type PendingDecisionGap,
} from "./pending-decision-gap.js";
import { SettleRefreshScheduler } from "./settle-refresh.js";
import {
  handleStreamClosedQuietlyFromStore,
  handleStreamErrorFromStore,
  handleWorkflowRestartedFromStore,
  retryStreamFromStore,
} from "./stream-trouble.js";
import { acquireTranscriptLeaseFromStore } from "./transcript-lease.js";
import { clearIdleRecheck, syncIdleRecheck } from "./idle-recheck.js";
import { ConsumedInterruptFold } from "./consumed-interrupts.js";
import {
  composerSnapshotOf,
  conversationSnapshotOf,
  publishStore,
} from "./conversation-publish.js";
import { retireEpoch } from "./epoch-sync.js";
import { ObservableCell, type ReadonlyCell } from "./observable-cell.js";
import type { UserTurnLedger, UserTurnMeta } from "./user-turn-ledger.js";

import type {
  ActiveConversation,
  AttachmentDraft,
  ComposerContract,
  ComposerInput,
  ComposerModelPick,
  ConnectionSnapshot,
  ConversationSnapshot,
  ConversationStoreDeps,
  MintedDownloadUrl,
} from "./conversation-contract.js";

// The externally consumed contract types, re-exported from
// conversation-contract.ts so existing import paths keep resolving.
export type {
  ActiveConversation,
  ApprovalDecisionInput,
  AttachmentDraft,
  ComposerContract,
  ComposerInput,
  ComposerModelPick,
  ConversationStoreDeps,
  HostCapabilities,
  MintedDownloadUrl,
} from "./conversation-contract.js";

/**
 * The conversation core shared by every surface: one thread's state, the
 * send/reconnect/echo machinery, and the honest error taxonomy — a plain
 * observable store so surfaces are pure chrome subscribing to its cells
 * (via useSyncExternalStore in React; `.get()`/`.subscribe()` anywhere
 * else). Surfaces differ only in chrome — <AssistantPage/> adds the
 * thread list, <AssistantPalette/> an overlay shell — never in transport,
 * persistence, or transcript semantics.
 *
 * Every send reconnects the stream with a fresh agent: the serving stream
 * closes once a turn settles, and the contract's frozen semantic makes a
 * fresh full replay the one always-correct way to pick up the next turn.
 *
 * Construction is side-effect-free (StrictMode-inert); `bootstrap()` is
 * the boot, `dispose()` the teardown.
 */
export class AssistantConversationStore {
  readonly conversation: ReadonlyCell<ConversationSnapshot>;
  readonly composer: ReadonlyCell<ComposerContract>;
  readonly connection: ReadonlyCell<ConnectionSnapshot | null>;
  readonly approvals: ReadonlyCell<readonly ApprovalCardModel[]>;
  // The pending asks (question sets): cards
  // derived from the epoch's execution entries — the member's half of
  // the execution inbox, beside the approvals' human half.
  readonly elicitations: ReadonlyCell<readonly ElicitationCardModel[]>;
  // What the member owes each coworker, by ordinal:
  // an action their browser performs or a decision on an approval — the
  // delegation group row's read.
  readonly coworkerWork: ReadonlyCell<
    ReadonlyMap<number, CoworkerExecutionWork>
  >;
  readonly markerAnchors: ReadonlyCell<MarkerAnchorsSnapshot>;
  readonly activity: ReadonlyCell<AssistantActivitySnapshot>;
  // The live message list, mirrored from the epoch agent's own state by
  // messagesRecorder. Any number of surfaces may render it concurrently —
  // with the store as the only connection driver there is nothing left
  // to collide (the old newest-holder-only lease gate was chassis
  // crash-avoidance, not UX).
  readonly messages: ReadonlyCell<readonly Message[]>;
  // Each injected user message's turn-side display facts — attachments
  // and the turn's created_at stamp — keyed by its stable id:
  // the transcript derivation's side table (neither fact rides the
  // AG-UI Message itself, which the client library owns).
  readonly turnMeta: ReadonlyCell<ReadonlyMap<string, UserTurnMeta>>;

  // Underscore members are store-internal state, deliberately not TS
  // `private`: the store's section modules (conversation-adoption,
  // conversation-send, connection-driver, …) are the class's friends and
  // read them through the store argument each entry function takes. Nothing
  // outside src/core names one; headless.ts records the never-export rule.
  readonly _conversationCell: ObservableCell<ConversationSnapshot>;
  readonly _composerCell: ObservableCell<ComposerContract>;
  readonly _connectionCell: ObservableCell<ConnectionSnapshot | null>;
  readonly _approvalsCell: ObservableCell<readonly ApprovalCardModel[]>;
  readonly _elicitationsCell: ObservableCell<readonly ElicitationCardModel[]>;
  // What the member owes each coworker, by ordinal,
  // folded from the live epoch's coworker execution entries and the
  // carried approval inbox's coworker cards on either publish; the
  // delegation group row reads it to name the asker.
  readonly _coworkerWorkCell: ObservableCell<
    ReadonlyMap<number, CoworkerExecutionWork>
  >;
  // Submit-failure sentences by interrupt id, stamped by the question
  // set's submit and cancel and cleared by their next attempt; the card
  // model carries them so the panel can say why nothing moved.
  readonly _elicitationErrors = new Map<string, string>();
  // What each successful submit or cancel posted, by interrupt
  // id, for the settled receipt. Every write on the question-set path and
  // its live reader are enumerated in docs/decision-anchors.md.
  readonly _questionAnswers = new Map<string, AnsweredQuestions>();
  /** The question-set drafts: store-owned so the panel's
   *  remounts (paging, reconnect, workflow restart) never lose a
   *  member's staged answers. Lifetime is ruled in question-drafts.ts;
   *  this store clears a set on present-and-settled evidence and clears
   *  all on a thread switch or abandon — never on an epoch reset. */
  readonly questionDrafts = new QuestionDraftStore();
  readonly _markerAnchorsCell: ObservableCell<MarkerAnchorsSnapshot>;
  readonly _activityCell: ObservableCell<AssistantActivitySnapshot>;
  readonly _messagesCell: ObservableCell<readonly Message[]>;
  readonly _turnMetaCell: ObservableCell<ReadonlyMap<string, UserTurnMeta>>;
  // The dirty check behind the derived meta map: republish only when
  // the ledger instance or its version moved.
  _publishedMetaLedger: UserTurnLedger | null = null;
  _publishedMetaVersion = -1;
  // Minted download URLs, reused while comfortably inside their TTL so a
  // list re-render never stampedes the mint endpoint.
  readonly _downloadUrls = new Map<string, MintedDownloadUrl>();

  _active: ActiveConversation | null = null;
  _threads: ServingAssistantThread[] = [];
  _sendError: string | null = null;
  // The newest turn's failure sentence, straight from the turn row.
  _turnFailure: string | null = null;
  // The published pending-decision gap. Reference-stable while
  // its signature holds, so the snapshot comparer can be an identity
  // check.
  _pendingDecisionGap: PendingDecisionGap | null = null;
  // The quiet→loud grace lives in the shared PendingDecisionGapGate; the
  // timer alone bounds the alert, never anything network-shaped. publish
  // writes _pendingDecisionGap; probe is one best-effort re-read per
  // signature; evidenceSettled is GAP-PROBE PREMISE #3: _epochConnectedOnce
  // records a real stream ATTEMPT (docs/connection-lifecycle.md).
  readonly _gapGate = new PendingDecisionGapGate({
    publish: (gap) => {
      this._pendingDecisionGap = gap;
      if (!this._inPublish) {
        publishStore(this);
      }
    },
    probe: () => {
      void this.refreshConversation().then(() => {
        if (!this._disposed) {
          publishStore(this);
        }
      });
    },
    evidenceSettled: () => this._epochConnectedOnce,
  });
  _inPublish = false;
  _streamInterrupted = false;
  // A stop POST is in flight, or its ~2s settle window is still open.
  // Cleared wherever the settled truth arrives (an adopted detail with
  // busy false) and on every new-intent moment (send, open, abandon).
  _stopping = false;
  _threadOpening = false;
  _reconnectNonce = 0;
  // The background-attach nonce: remints the connection epoch
  // WITHOUT remounting the keyed transcript — it feeds the epoch
  // signature but never the ConversationSnapshot, so the Transcript key
  // (thread.id#reconnectNonce) holds still while the store attaches to a
  // background-initiated turn. The premise lives at the remint branch in
  // syncConnection.
  _backgroundAttachNonce = 0;
  _pendingSend = false;
  _pendingEcho: ComposerContract["pendingEcho"] = null;
  _composerRefocusPending = false;
  // The conversation's model pick. Seeded from the thread's
  // wire truth on every adoption; a chip selection sets it locally
  // (dirty) until the next send carries it, so a settle refresh never
  // clobbers an unsent choice. The server may clear a pick between
  // turns — the thread read is authoritative once nothing is dirty.
  _modelPick: ComposerModelPick | null = null;
  _modelPickDirty = false;
  // The composer's unsaved input. See ComposerInput and the
  // ComposerContract fields for the placement ruling and the death arm
  // in _connectionEnded for the lifetime ruling. A dedicated cell on
  // purpose: its writes never ride publishStore, so a keystroke notifies the
  // composer's subscription alone — no conversation-plane state moves
  // when the visitor types.
  readonly _composerInput = new ObservableCell<ComposerInput>({
    scope: "u:0",
    draft: "",
    attachments: [],
  });
  // The next conversation-less scope token; 0 is the constructed state.
  _nextUnboundScope = 1;
  // WHICH SURFACE's composer textarea owns the keyboard (null: none) — a
  // surface token, not a boolean, so the owed caret return names its owner
  // and no bystander surface's fresh composer consumes it. Kept true to the
  // DOM by blur, the owner's unmount cleanup (DOM-checked for StrictMode),
  // and the death arm's read-before-publish. Event-plane, never published.
  _composerFocusOwned: string | null = null;
  // One owed caret return, stamped with the owning surface (the death
  // arm's remount tore down that surface's focused textarea). Take-
  // consumed at mount by the fresh composer instance WHOSE SURFACE
  // MATCHES — bystander surfaces' takes return false and leave it
  // armed.
  _composerCaretReturnPending: string | null = null;
  _tier: VisitorTier | null = null;
  // The activity feed's raw material: the newest turn as REST last told
  // us, and the newest turn that reached a terminal status.
  _newestTurn: ServingAssistantTurn | null = null;
  // The newest ANSWERABLE turn off the last full refresh (with
  // queuing, the pause can sit behind QUEUED rows, so the newest row and
  // the answerable row diverge). Only trusted right after a refresh —
  // the partial adopters (send, resume) don't maintain it.
  _awaitingTurn: ServingAssistantTurn | null = null;
  _lastResult: AssistantActivityResult | null = null;

  // The consumed-interrupt fold — the how and why live on the
  // ConsumedInterruptFold class in consumed-interrupts.ts.
  readonly _consumedInterrupts = new ConsumedInterruptFold();

  // A resume that resolves after some other path adopted a conversation
  // (a send, a thread switch, a newer resume) must be discarded — its
  // detail predates the adoption. The counter is that staleness guard.
  _resumeRequest = 0;
  // A monotonic token per adoption ask: a backfill that outlives its
  // adoption (the user opened another thread mid-drain) finds the token
  // moved on and adopts nothing.
  _adoptionAsk = 0;
  // Refresh adoption is monotonic in issue order: with no
  // AbortSignal or timeout in this transport, a stalled thread GET can land
  // MINUTES late and would regress _newestTurn. A response adopts only if no
  // later-issued refresh adopted first — landed truth is arbitrated by issue
  // order, never discarded outright. Scope: the refreshConversation family.
  _refreshTicket = 0;
  _refreshAdoptedThrough = 0;
  _historyLoadRequested = false;
  // The settle re-read's debounce policy lives in the shared scheduler;
  // what a settle refreshes is this store's: the thread, the history
  // list, and (via onTurnSettled) the funding facts — a taster crossing
  // or a drained window moves the gate projection.
  private readonly _settleScheduler = new SettleRefreshScheduler(() => {
    void this.refreshConversation();
    void refreshThreads(this);
    this.deps.onTurnSettled();
  });
  // The delivery-claim probe's coalescing flags: one burst at a
  // time, and a settle landing mid-burst restarts the probe budget instead
  // of stacking a second burst. No timer handle on purpose — the probe is
  // settlesFor beats with _disposed re-checked behind every await, and its
  // only awaits are its own beat timers, never a network promise.
  _deliveryProbeRunning = false;
  _deliveryProbeRearm = false;
  // The leased idle re-read's interval. Cleared in dispose()
  // and re-armed by any later publish (the gap gate's lifecycle: a
  // timer dies with the life that armed it, and a StrictMode
  // dispose→bootstrap revival re-arms through the ordinary sync). The
  // in-flight flag is the tick's single-flight guard — see
  // the comment inside syncIdleRecheck.
  _idleRecheckTimer: ReturnType<typeof setInterval> | null = null;
  _idleRecheckInFlight = false;
  _disposed = false;

  _epoch: ConnectionEpoch | null = null;
  _epochResume: StreamResumeStore | null = null;
  _epochSignature: string | null = null;
  _nextEpochId = 1;

  // Surface presence (the old transcript lease, kept as a registry): the
  // store is the ONLY connection driver now, and presence upgrades the
  // socket policy per the truth table in syncConnection — a mounted
  // surface means "ensure this epoch has connected once" (history paints
  // by full replay); no surfaces means the bounded headless table.
  _leaseHolders: string[] = [];
  _connectionRunning = false;
  _connectionSyncQueued = false;
  _epochConnectedOnce = false;
  _automaticReconnects = 0;

  constructor(readonly deps: ConversationStoreDeps) {
    this._conversationCell = new ObservableCell(conversationSnapshotOf(this));
    this._composerCell = new ObservableCell(composerSnapshotOf(this));
    this._connectionCell = new ObservableCell<ConnectionSnapshot | null>(null);
    this._approvalsCell = new ObservableCell<readonly ApprovalCardModel[]>([]);
    this._elicitationsCell = new ObservableCell<
      readonly ElicitationCardModel[]
    >([]);
    this._coworkerWorkCell = new ObservableCell<
      ReadonlyMap<number, CoworkerExecutionWork>
    >(new Map());
    this._markerAnchorsCell = new ObservableCell<MarkerAnchorsSnapshot>({
      resumeAnchors: new Map(),
      turnFailedAnchors: new Map(),
      subagentDeliveryAnchors: new Map(),
      toolErrorAnchors: new Map(),
      toolRefusalAnchors: new Map(),
      toolCancelAnchors: new Set(),
      toolOffloadAnchors: new Set(),
      toolDecisionAnchors: new Set(),
      toolDenialAnchors: new Set(),
      toolCallDisplayAnchors: new Map(),
      toolSchemaAnchors: new Map(),
      blockTimingAnchors: new Map(),
      turnUsageAnchors: new Map(),
      memoryProvenanceAnchors: new Map(),
      memoryAttributionAnchors: new Map(),
    });
    this._activityCell = new ObservableCell(IDLE_ACTIVITY);
    this._messagesCell = new ObservableCell<readonly Message[]>([]);
    this._turnMetaCell = new ObservableCell<ReadonlyMap<string, UserTurnMeta>>(
      new Map(),
    );
    this.conversation = this._conversationCell;
    this.composer = this._composerCell;
    this.connection = this._connectionCell;
    this.approvals = this._approvalsCell;
    this.elicitations = this._elicitationsCell;
    this.coworkerWork = this._coworkerWorkCell;
    this.markerAnchors = this._markerAnchorsCell;
    this.activity = this._activityCell;
    this.messages = this._messagesCell;
    this.turnMeta = this._turnMetaCell;
  }

  /** Boot: resume where the visitor left off, and prime the identified
   *  history eagerly — the list call itself is what primes the first
   *  mint, so a fresh browser (no stored thread — exactly the
   *  cross-device case) shows its history without waiting for a first
   *  send. Anonymous embeds stay lazy — no traffic until the visitor
   *  interacts. Idempotent: the resume staleness counter and the history
   *  flag absorb StrictMode's double boot. */
  bootstrap(): void {
    // Revival, not just boot: StrictMode runs the provider's teardown
    // between two boots of the SAME memoized store, so a dispose followed
    // by a bootstrap must leave a working store, exactly like the
    // TokenSession it lives beside.
    this._disposed = false;
    this.resumeStoredThread();
    loadHistoryOnceExpected(this);
    // Revival belt-and-braces: a StrictMode dispose cleared the
    // idle re-read while the lease holders (and possibly the active
    // conversation) survived — re-judge now rather than waiting for the
    // next publish.
    syncIdleRecheck(this);
  }

  /** The provider pushes each mint's tier verdict in; identification can
   *  arrive mid-session and flips the history expectation. */
  setTier(tier: VisitorTier | null): void {
    if (this._tier === tier) {
      return;
    }
    this._tier = tier;
    loadHistoryOnceExpected(this);
    publishStore(this);
  }

  dispose(): void {
    this._disposed = true;
    invalidateInFlightResume(this);
    this._settleScheduler.dispose();
    // The gap gate's window dies with the life that armed it: a timer
    // left in place would survive a StrictMode dispose→bootstrap revival
    // with stale state — and a re-derived gap with the SAME signature
    // would then skip the confirming re-read and the timer forever,
    // never publishing. That is the silent-pending-decision state the
    // gate exists to remove.
    this._gapGate.dispose();
    // The idle re-read dies with the same life: a leaked
    // interval would keep re-reading a disposed store's thread for the
    // rest of the page. Revival re-arms it through the ordinary publish
    // sync, exactly like the connection itself.
    clearIdleRecheck(this);
    retireEpoch(this);
  }

  // --- resuming the stored conversation (conversation-adoption.ts) -----------

  resumeStoredThread = (): void => {
    resumeStoredThreadFromStore(this);
  };

  // --- sending and stopping (conversation-send.ts) ---------------------------

  sendMessage = async (
    message: string,
    attachmentIds?: string[],
    optimisticAttachments?: TurnAttachment[],
  ): Promise<boolean> =>
    sendMessageFromStore(this, message, attachmentIds, optimisticAttachments);

  markComposerRefocusHandled = (): void => {
    markComposerRefocusHandledFromStore(this);
  };

  stopTurn = async (): Promise<void> => stopTurnFromStore(this);

  setModelPick = (pick: ComposerModelPick): void => {
    setModelPickFromStore(this, pick);
  };

  setComposerDraft = (next: string | ((current: string) => string)): void => {
    setComposerDraftFromStore(this, next);
  };

  setComposerAttachments = (
    next:
      | readonly AttachmentDraft[]
      | ((current: readonly AttachmentDraft[]) => readonly AttachmentDraft[]),
  ): void => {
    setComposerAttachmentsFromStore(this, next);
  };

  noteComposerFocus = (owner: string | null): void => {
    noteComposerFocusFromStore(this, owner);
  };

  takeComposerCaretReturn = (surface: string): boolean =>
    takeComposerCaretReturnFromStore(this, surface);

  // --- attachments -----------------------------------------------------------

  uploadAttachment = async (file: File): Promise<ServingAttachment> =>
    uploadAttachmentFromStore(this, file);

  mintAttachmentDownloadUrl = async (
    attachmentId: string,
  ): Promise<MintedDownloadUrl> =>
    mintAttachmentDownloadUrlFromStore(this, attachmentId);

  // --- surface presence (the transcript lease) -------------------------------

  acquireTranscriptLease = (surface: string): (() => void) =>
    acquireTranscriptLeaseFromStore(this, surface);

  // --- answering approvals (approval-decision.ts) ----------------------------

  submitApprovalDecision = async (
    card: ApprovalCardModel,
    decision: ApprovalDecisionInput,
  ): Promise<void> => submitApprovalDecisionFromStore(this, card, decision);

  // --- answering question sets (elicitation-answers.ts) ----------------------

  submitQuestionAnswers = async (
    card: QuestionSetCardModel,
    answers: readonly { id: string; text: string }[],
  ): Promise<void> => submitQuestionAnswersFromStore(this, card, answers);

  cancelQuestionSet = async (card: QuestionSetCardModel): Promise<void> =>
    cancelQuestionSetFromStore(this, card);

  handleUserMessageInjected = (messageId: string): void => {
    handleUserMessageInjectedFromStore(this, messageId);
  };

  // --- navigation (conversation-adoption.ts) ---------------------------------

  openThread = (thread: ServingAssistantThread): void => {
    openThreadFromStore(this, thread);
  };

  startNewConversation = (): void => {
    startNewConversationFromStore(this);
  };

  // --- keeping the REST truth fresh (conversation-refresh.ts) ----------------

  refreshConversation = async (): Promise<void> =>
    refreshConversationFromStore(this);

  noteDispatchSettled = (): void => {
    noteDispatchSettledFromStore(this);
  };

  // A coworker read paused: its request is on the dispatching
  // turn's snapshot, so re-read the conversation and let the adoption
  // hand it to the execution inbox.
  noteDispatchPaused = (): void => {
    void refreshConversationFromStore(this);
  };

  handleRunSettled = (): void => {
    this._scheduleSettleRefresh();
  };

  // --- stream trouble (stream-trouble.ts) ------------------------------------

  handleStreamError = (error: Error): void => {
    handleStreamErrorFromStore(this, error);
  };

  handleStreamClosedQuietly = (stillStreaming: () => boolean): void => {
    handleStreamClosedQuietlyFromStore(this, stillStreaming);
  };

  retryStream = (): void => {
    retryStreamFromStore(this);
  };

  handleWorkflowRestarted = (): void => {
    handleWorkflowRestartedFromStore(this);
  };

  // --- the settle re-read ----------------------------------------------------

  _scheduleSettleRefresh(): void {
    if (this._disposed) {
      return;
    }
    this._settleScheduler.noteRunSettled();
  }
}
