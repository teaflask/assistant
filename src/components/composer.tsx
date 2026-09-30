"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import {
  ASSISTANT_MAX_ATTACHMENTS,
  ASSISTANT_MESSAGE_MAX_CHARS,
  type TurnAttachment,
} from "../contract/threads.js";
import type { ServedAttachmentPolicy } from "../contract/assistant-config.js";
import { humanFileSize } from "./human-file-size.js";
import {
  attachmentAcceptOf,
  ComposerAttachmentChip,
} from "./composer-attachment-chip.js";
import { ConversationGateCard } from "./conversation-gate-card.js";
import { useConversation } from "./conversation-context.js";
import { ArrowUpIcon, PlusIcon, StopIcon } from "./icons.js";
import { TfButton } from "./primitives/button.js";
import { TfFileInput } from "./primitives/file-input.js";
import { TfTextarea } from "./primitives/textarea.js";
import { ModelPickerShelf } from "./model-picker-chip.js";
import { useOptionalAssistantSession } from "./teaflask-assistant-provider.js";
import { NO_GATE, type ConversationGate } from "../core/connect-gate.js";
import {
  attachmentDraftFailed,
  capSlotsSpentBy,
  CHARACTER_COUNT_VISIBLE_FROM,
  composerKeyHandlersOf,
  mintAttachmentDraftId,
  pickCapOf,
  type AttachmentDraft,
  type ComposerKeyEvent,
} from "../core/composer-policy.js";
import type {
  ComposerContract,
  ComposerInput,
} from "../core/conversation-contract.js";
import { ObservableCell } from "../core/observable-cell.js";
import { useCell } from "./use-store-cell.js";

// The composer's no-provider fallback (welcome-branch tests render the
// view bare): a frozen null cell, so the hook order never bends.
const NO_POLICY = new ObservableCell<ServedAttachmentPolicy | null>(null);
const NO_GATE_CELL = new ObservableCell<ConversationGate>(NO_GATE);

// The autosize cap: ~8 lines of the 15px/1.6 body step; past this the
// draft scrolls inside the box instead of swallowing the transcript.
const COMPOSER_MAX_HEIGHT_PX = 200;

type ComposerSession = ReturnType<typeof useOptionalAssistantSession>;

/**
 * The message composer. Sending is the contract's message POST, wired in
 * by context (never the stream — the watch-only stream cannot create a
 * turn). The maxLength mirrors the send surface's bound so the limit is
 * felt while typing, not as a 422 after submitting. Attachments ride the
 * served policy: no policy, no paperclip.
 *
 * `surface` is the caret-return handoff's identity: several
 * surfaces render this composer over ONE store, and a reconnect-nonce
 * bump remounts all of them in one commit — the store's focus record
 * and the owed caret return are stamped with the owning surface so only
 * the matching fresh instance consumes the return. PREMISE: surface
 * names are unique per mounted view — the transcript lease already
 * keys its holder list on the same strings.
 */
export function Composer({
  compact = false,
  surface = "page",
}: {
  compact?: boolean;
  surface?: string;
}) {
  const {
    busy,
    pendingSend,
    sendMessage,
    composerRefocusPending,
    markComposerRefocusHandled,
    stopping,
    stopTurn,
    // The unsaved draft and its staged attachments are the STORE's
    // truth, not instance state: this component remounts with the keyed
    // transcript on every reconnect-nonce move — a send, a retry, a
    // stream death under the same turn — and unsaved input must never
    // die with an instance. They arrive on a dedicated cell, not on
    // this contract snapshot, so a keystroke re-renders THIS component
    // alone — never the transcript reading the same context.
    composerInput,
    setDraft,
    setAttachments,
    noteComposerFocus,
    takeComposerCaretReturn,
  } = useConversation();
  const { draft, attachments } = useCell(composerInput);
  const session = useOptionalAssistantSession();
  const policy = useCell(session?.attachmentPolicy ?? NO_POLICY);
  // The conversation gate: when the next send cannot serve without the
  // visitor acting, the gate card takes the slab's place. This
  // component stays mounted either way, so the draft survives the gate
  // and returns with the composer.
  const gate = useCell(session?.conversationGate ?? NO_GATE_CELL);
  const send = useComposerSend({
    busy,
    draft,
    attachments,
    composerInput,
    sendMessage,
    setDraft,
    setAttachments,
  });
  const attach = useComposerAttachments({
    session,
    policy,
    attachments,
    setAttachments,
  });
  const { textareaRef, onTextareaFocus, onTextareaBlur } = useComposerFocus({
    surface,
    draft,
    busy,
    composerRefocusPending,
    markComposerRefocusHandled,
    noteComposerFocus,
    takeComposerCaretReturn,
  });

  return (
    // The live composer repeats the transcript's max-w-3xl measure. The
    // empty page asks for the compact edition: before there is a
    // transcript, a broad input reads as an empty panel rather than a
    // deliberate starting point.
    <div
      data-tf-composer-root=""
      data-tf-composer-ground=""
      className="tf:relative tf:bg-tf-background tf:pt-1 tf:pb-4"
    >
      <div
        className={
          "tf:mx-auto tf:w-full tf:px-4 " +
          (compact ? "tf:max-w-xl" : "tf:max-w-3xl")
        }
      >
        {/* No decision cards here any more: pending approvals and asks
            — anchored and orphaned alike — render through the activity
            shelf's suspension slot directly above this block, which
            the visitor cannot scroll away from either. */}
        {/* The conversation gate rides ABOVE the slab as an inline
            banner — the chat-product grammar (owner reference: ChatGPT's
            limit banner) — and the composer stays where it always is:
            a send while gated refuses at the door and the banner is
            already the honest answer. */}
        {gate.kind === "connect" ||
        gate.kind === "wait" ||
        gate.kind === "verifying" ? (
          <ConversationGateCard gate={gate} />
        ) : null}
        <ComposerSlabAndShelf
          draft={draft}
          setDraft={setDraft}
          attachments={attachments}
          policy={policy}
          gate={gate}
          busy={busy}
          pendingSend={pendingSend}
          stopping={stopping}
          stopTurn={stopTurn}
          send={send}
          attach={attach}
          textareaRef={textareaRef}
          onTextareaFocus={onTextareaFocus}
          onTextareaBlur={onTextareaBlur}
        />
      </div>
    </div>
  );
}

interface ComposerSendController {
  sending: boolean;
  sendDisabled: boolean;
  submitDraft: () => Promise<void>;
}

// This instance's send: the disabled verdict over the draft and its
// staged attachments, and the submit that clears optimistically and
// restores on refusal.
function useComposerSend({
  busy,
  draft,
  attachments,
  composerInput,
  sendMessage,
  setDraft,
  setAttachments,
}: Pick<
  ComposerContract,
  "busy" | "composerInput" | "sendMessage" | "setDraft" | "setAttachments"
> &
  Pick<ComposerInput, "draft" | "attachments">): ComposerSendController {
  // Ruled instance-LOCAL: `sending` mirrors this instance's own
  // in-flight submitDraft promise; the cross-instance truth every
  // surface reads is the store's pendingSend. No remount fires while it
  // is meaningfully true — a send is only submittable when not busy,
  // and the death arm's reconnect exists only over a working turn.
  const [sending, setSending] = useState(false);

  const trimmedDraft = draft.trim();
  const readyAttachments = attachments.flatMap((item) =>
    item.status === "ready" && item.attachment !== undefined
      ? [item.attachment]
      : [],
  );
  const readyIds = readyAttachments.map((attachment) => attachment.id);
  const uploadsSettling = attachments.some(
    (item) => item.status === "uploading",
  );
  const uploadsFailed = attachments.some(attachmentDraftFailed);
  const nothingToSend = trimmedDraft === "" && readyIds.length === 0;
  const sendDisabled =
    nothingToSend || busy || sending || uploadsSettling || uploadsFailed;

  async function submitDraft() {
    if (sendDisabled) {
      return;
    }
    const submittedDraft = trimmedDraft;
    const submittedAttachments = attachments;
    const optimisticAttachments: TurnAttachment[] = readyAttachments.map(
      (attachment) => ({
        id: attachment.id,
        kind: attachment.kind,
        format: attachment.format,
        filename: attachment.filename,
        byte_size: attachment.byte_size,
      }),
    );
    setSending(true);
    // Captured before the await: the refusal restore below may only
    // write into the conversation this send belonged to. The setters are
    // the STORE's stable arrows now, so this continuation outlives the
    // composer instance — without the scope check, a thread switch or
    // New conversation mid-POST followed by a refusal would leak this
    // thread's text and attachment ids into the conversation that
    // replaced it. PREMISE the guard rests on: every distinct
    // conversation-context has a distinct scope — thread-backed ones by
    // their immutable, never-reused server id, conversation-LESS states
    // by a token minted fresh on every reset (null was shared by every
    // empty state, so a first send refused after New conversation leaked
    // back in) — and the scope tracks every _active move (the
    // ComposerInput invariant). An equal scope at settle time therefore
    // means the restore lands in the very conversation the text was
    // typed in, even if the visitor left and came back meanwhile.
    const submittedScope = composerInput.get().scope;
    // The conversation moves immediately: the store paints an optimistic
    // user bubble while the input clears for the next thought. A refusal
    // restores exactly what was attempted below.
    const landing = sendMessage(
      submittedDraft,
      readyIds,
      optimisticAttachments,
    );
    setDraft("");
    setAttachments([]);
    try {
      const landed = await landing;
      if (!landed && composerInput.get().scope === submittedScope) {
        setDraft((current) =>
          current === "" ? submittedDraft : `${submittedDraft}\n${current}`,
        );
        setAttachments((current) =>
          current.length === 0
            ? submittedAttachments
            : [...submittedAttachments, ...current],
        );
      }
    } finally {
      setSending(false);
    }
  }

  return { sending, sendDisabled, submitDraft };
}

interface ComposerAttachmentsController {
  attachmentRoom: number;
  addFiles: (files: FileList | null) => void;
  removeAttachment: (localId: number) => void;
}

// The paperclip's side of the slab: the served policy's cap, the pick
// that stages uploads (and lands rejections as failed chips), removal.
function useComposerAttachments({
  session,
  policy,
  attachments,
  setAttachments,
}: Pick<ComposerContract, "setAttachments"> &
  Pick<ComposerInput, "attachments"> & {
    session: ComposerSession;
    policy: ServedAttachmentPolicy | null;
  }): ComposerAttachmentsController {
  // The policy rides the config fetch; kick it so the paperclip appears
  // without waiting for a surface that renders suggestions to ask first.
  useEffect(() => {
    session?.ensureAssistantConfig();
  }, [session]);

  function addFiles(files: FileList | null) {
    if (files === null || policy === null || session === null) {
      return;
    }
    const { store } = session;
    const room = Math.min(policy.max_per_message, ASSISTANT_MAX_ATTACHMENTS);
    let taken = capSlotsSpentBy(attachments);
    for (const file of Array.from(files)) {
      const localId = mintAttachmentDraftId();
      const entry: AttachmentDraft = {
        localId,
        filename: file.name !== "" ? file.name : "attachment",
        byteSize: file.size,
        status: "uploading",
      };
      // A pick past the cap lands as a failed chip, never a silent drop —
      // the visitor must not believe twelve files ride when ten do.
      if (taken >= room) {
        setAttachments((current) => [
          ...current,
          {
            ...entry,
            status: "failed",
            error: `Too many files — the limit is ${String(room)} per message.`,
          },
        ]);
        continue;
      }
      // The per-kind truth lands at finalize (the server sniffs the
      // bytes), but the browser's MIME type is a confident-enough guess
      // to feel the RIGHT kind's cap at pick time — a 6MB photo must
      // hear "5 MB", not the 32MB document ceiling. Unknown types get
      // the widest cap; the sniff stays the truth.
      const cap = pickCapOf(file, policy.max_bytes_by_kind);
      if (file.size > cap.bytes) {
        setAttachments((current) => [
          ...current,
          {
            ...entry,
            status: "failed",
            error: `Too large — the limit for ${cap.label} is ${humanFileSize(cap.bytes)}.`,
          },
        ]);
        continue;
      }
      // Only a file that actually becomes an upload draft spends a cap
      // slot — a rejected pick must not crowd out a valid one behind it.
      taken += 1;
      setAttachments((current) => [...current, entry]);
      // These continuations outlive the instance (the setters are store
      // arrows) yet need NO conversation-scope guard, unlike the
      // send-refusal restore: they only TRANSFORM the entry whose localId
      // they captured, never add one. A thread switch or abandon clears
      // the store's list, the localId no longer matches, and the settle
      // maps over the list without touching anything. PREMISE: localIds
      // come from a module counter that only counts up, so an id removed
      // by a clear can never reappear and match a stale settle.
      store.uploadAttachment(file).then(
        (settled) => {
          setAttachments((current) =>
            current.map((item) =>
              item.localId === localId
                ? { ...item, status: "ready", attachment: settled }
                : item,
            ),
          );
        },
        (error: unknown) => {
          setAttachments((current) =>
            current.map((item) =>
              item.localId === localId
                ? {
                    ...item,
                    status: "failed",
                    error:
                      error instanceof Error
                        ? error.message
                        : "The upload failed.",
                  }
                : item,
            ),
          );
        },
      );
    }
  }

  function removeAttachment(localId: number) {
    // Local removal only: an uploaded-but-never-sent object is the
    // server's unclaimed sweep's to reclaim.
    setAttachments((current) =>
      current.filter((item) => item.localId !== localId),
    );
  }

  const attachmentRoom =
    policy === null
      ? 0
      : Math.min(policy.max_per_message, ASSISTANT_MAX_ATTACHMENTS);

  return { attachmentRoom, addFiles, removeAttachment };
}

interface ComposerFocusController {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onTextareaFocus: () => void;
  onTextareaBlur: () => void;
}

// The textarea's focus choreography and autosize: the store's focus
// record dies with its owner, the caret returns after a send or a
// death-arm remount, and the box grows with the draft to a cap.
function useComposerFocus({
  surface,
  draft,
  busy,
  composerRefocusPending,
  markComposerRefocusHandled,
  noteComposerFocus,
  takeComposerCaretReturn,
}: Pick<
  ComposerContract,
  | "busy"
  | "composerRefocusPending"
  | "markComposerRefocusHandled"
  | "noteComposerFocus"
  | "takeComposerCaretReturn"
> &
  Pick<ComposerInput, "draft"> & { surface: string }): ComposerFocusController {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Whether THIS instance's textarea owns focus, per its own events —
  // the scope that lets the unmount cleanup below invalidate the
  // store's record without a bystander instance (page vs palette)
  // clobbering an owner's record.
  const ownsFocusRef = useRef(false);

  // THE RECORD DIES WITH ITS OWNER — AND ONLY WITH ITS OWNER: the store's
  // focus record is written by focus/blur events, but an element can also
  // go away with NO event at all — the death-arm remount, the
  // thread-switch skeleton swap, a palette close, a surface teardown all
  // remove a possibly-focused textarea without firing blur. Left
  // uncleared, the record reads stale and the NEXT stream death steals
  // focus into a composer nobody touched (the facet-ii hazard). So the
  // owning instance invalidates it on unmount. The DOM check is
  // load-bearing: React's dev-time StrictMode fires this same cleanup on
  // a SIMULATED unmount — the element stays mounted and focused — and a
  // ref-only guard cleared a record the caret still backed, disarming
  // every death-arm return after the first. Checking "is the caret still
  // in this box?" makes the replay a no-op, while a real unmount always
  // fails the check (the node is detached, so activeElement has fallen
  // elsewhere) and the invalidation still lands where it must. ORDERING
  // PREMISE (verified at the death arm): the arm reads the record
  // synchronously BEFORE the publishStore() whose remount unmounts this
  // instance, so this cleanup runs strictly after the arming decision and
  // can never disarm a legitimate caret return — and the fresh instance's
  // own focus() re-records the owner through the ordinary onFocus path.
  useEffect(() => {
    // Captured at setup, not read from the ref in the cleanup: React
    // detaches refs around unmounts (real AND simulated), so a ref read
    // inside the cleanup can be null while the node itself still stands
    // — the captured node is the stable identity to test the caret
    // against.
    const box = textareaRef.current;
    return () => {
      if (ownsFocusRef.current && document.activeElement !== box) {
        noteComposerFocus(null);
      }
    };
  }, [noteComposerFocus]);

  // Every send remounts the transcript (the reconnect story) and this
  // composer with it, which drops keyboard focus on the floor; once the
  // send settles, put the caret back — unless the visitor moved focus
  // somewhere deliberate meanwhile.
  useEffect(() => {
    if (busy || !composerRefocusPending) {
      return;
    }
    markComposerRefocusHandled();
    if (_focusWasDroppedByTheRemount(textareaRef.current)) {
      textareaRef.current?.focus();
    }
  }, [busy, composerRefocusPending, markComposerRefocusHandled]);

  // The death arm's remount hands the caret back AT THE REMOUNT: the
  // turn is still live and this box stays enabled, so the settle-gated
  // effect above would leave the visitor typing into <body> for the rest
  // of the answer. Runs once per instance on purpose (the arrow is a
  // stable store property); the store arms it ONLY when a composer
  // demonstrably owned focus, and the take consumes ONLY on the surface
  // that owned it — every keyed transcript remounts on one bump, and an
  // unscoped take let a bystander surface's composer burn the one-shot
  // in tree order while the owner got false. The owner then delivers or
  // forfeits in the same breath: its dropped-focus guard covers both
  // resting places of a torn-down caret (body on a plain page, the
  // dialog element inside the modal palette), and if the visitor parked
  // focus somewhere deliberate meanwhile, forfeiting is correct — the
  // moment has passed.
  useEffect(() => {
    if (
      takeComposerCaretReturn(surface) &&
      _focusWasDroppedByTheRemount(textareaRef.current)
    ) {
      textareaRef.current?.focus();
    }
  }, [takeComposerCaretReturn, surface]);

  // Autosize: the box starts at two lines and grows with the draft to a
  // cap, then scrolls inside — a fixed two-line box decapitates the first
  // line of any longer question. Layout-effect timing keeps the height in
  // step with the very keystroke that changed it.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) {
      return;
    }
    textarea.style.height = "auto";
    // Zero means unrendered, not empty: the palette mounts this inside a
    // <dialog> that is still display:none (showModal() runs in a later
    // passive effect), and pinning 0px would override the rows floor
    // with a collapsed sliver until the first keystroke re-measures.
    if (textarea.scrollHeight === 0) {
      return;
    }
    textarea.style.height = `${String(
      Math.min(textarea.scrollHeight, COMPOSER_MAX_HEIGHT_PX),
    )}px`;
  }, [draft]);

  // The store's focus record: this surface's name between a
  // real focus and the matching blur. HOW THE CARET LEAVES
  // this box, exhaustively: (1) focus MOVES — blur fires, the
  // record clears here; (2) the element UNMOUNTS — no blur
  // fires (DOM spec), and the owner's unmount cleanup above
  // clears the record instead, except across the death arm's
  // own remount, where the arm already read the record before
  // the unmount and the fresh instance's focus() re-records
  // the owner; (3) dev-time StrictMode REPLAYS that cleanup
  // without any unmount — its DOM check makes the replay a
  // no-op. The death arm reads the record to decide whether —
  // and for which surface — a caret return is owed.
  return {
    textareaRef,
    onTextareaFocus: () => {
      ownsFocusRef.current = true;
      noteComposerFocus(surface);
    },
    onTextareaBlur: () => {
      ownsFocusRef.current = false;
      noteComposerFocus(null);
    },
  };
}

type ComposerSlabAndShelfProps = Pick<
  ComposerContract,
  "busy" | "pendingSend" | "stopping" | "stopTurn" | "setDraft"
> &
  Pick<ComposerInput, "draft" | "attachments"> &
  Pick<ComposerFocusController, "onTextareaFocus" | "onTextareaBlur"> & {
    policy: ServedAttachmentPolicy | null;
    gate: ConversationGate;
    send: ComposerSendController;
    attach: ComposerAttachmentsController;
    textareaRef: RefObject<HTMLTextAreaElement | null>;
  };

// The slab and its shelf, named as one unit. A module-level component,
// never a closure nested in Composer: a nested component's identity
// would change every render and remount the textarea mid-keystroke.
function ComposerSlabAndShelf({
  draft,
  setDraft,
  attachments,
  policy,
  gate,
  busy,
  pendingSend,
  stopping,
  stopTurn,
  send,
  attach,
  textareaRef,
  onTextareaFocus,
  onTextareaBlur,
}: ComposerSlabAndShelfProps) {
  // Enter submits, Escape stops — the composer policy leaf's verbs
  // (shared with the dashboard playground). Escape's preventDefault
  // suppresses the palette dialog's native cancel and the drawer's
  // Esc-to-close (both yield to defaultPrevented), so Escape mid-answer
  // stops the turn without closing the surface — and Escape while idle,
  // or in either no-op window, still closes it exactly as before. Bound
  // on the textarea and the stop button, never a wrapper.
  const { stopOnEscape, composerKeys } = composerKeyHandlersOf({
    busy,
    pendingSend,
    stopping,
    stopTurn,
    submit: send.submitDraft,
  });

  return (
    <>
      {/* The conversational chat bar, in the adopted register: a soft
          slab — rounded-3xl hairline on the muted color-mix wash with a
          breathing shadow (data-tf-composer-wash) that deepens on
          focus. The textarea rides borderless inside; the card carries
          the focus state, the quiet kind — no focus-ring blue. A text
          input matches :focus-visible even on mouse click, so a ring
          here would flash on every click and every post-send refocus;
          the deepened hairline plus the caret is the conversational
          idiom's focus affordance. */}
      <div
        data-tf-composer-wash=""
        className={
          "tf:relative tf:flex tf:flex-col tf:rounded-3xl tf:border tf:p-2 " +
          "tf:transition-[border-color,box-shadow] " +
          "tf:focus-within:border-tf-foreground/25"
        }
      >
        {attachments.length > 0 ? (
          <div className="tf:flex tf:flex-wrap tf:gap-1.5 tf:px-1 tf:pt-1 tf:pb-2">
            {attachments.map((item) => (
              <ComposerAttachmentChip
                key={item.localId}
                item={item}
                onRemove={() => {
                  attach.removeAttachment(item.localId);
                }}
              />
            ))}
          </div>
        ) : null}
        {/* The chat-bar grammar: the draft rides its own full-width
            line, and the controls sit on a row of their own beneath it
            — attach at the left, send at the right — the anatomy every
            modern chat bar shares. */}
        <TfTextarea
          ref={textareaRef}
          rows={2}
          variant="bare"
          // The palette's dialog focuses this on open; inert elsewhere
          // (never the native autofocus, which would steal focus from the
          // host page on load).
          data-tf-autofocus=""
          value={draft}
          maxLength={ASSISTANT_MESSAGE_MAX_CHARS}
          // "Send a message" labels a control; this invites one. Short
          // enough that a 390px column still shows all of it. Constant
          // on purpose: the placeholder describes the input, never the
          // run — a busy variant narrated run state and could
          // contradict the rest of the surface mid-pause.
          placeholder="Ask anything"
          aria-label="Message"
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={composerKeys}
          onFocus={onTextareaFocus}
          onBlur={onTextareaBlur}
        />
        <ComposerControlsRow
          draft={draft}
          attachments={attachments}
          policy={policy}
          busy={busy}
          pendingSend={pendingSend}
          stopping={stopping}
          stopTurn={stopTurn}
          stopOnEscape={stopOnEscape}
          send={send}
          attach={attach}
          textareaRef={textareaRef}
        />
      </div>
      {/* The shelf (the ChatGPT bar's bottom strip): TWO independent
          controls — the model & reasoning chip when the wire serves a
          menu, and the ChatGPT account chip whenever a provider is
          connectable (standing alone when no menu is served). Renders
          nothing when neither applies, and stands down while a gate
          banner is up — one connect affordance at a time. */}
      {gate.kind === "none" ? <ModelPickerShelf /> : null}
    </>
  );
}

type ComposerControlsRowProps = Pick<
  ComposerContract,
  "busy" | "pendingSend" | "stopping" | "stopTurn"
> &
  Pick<ComposerInput, "draft" | "attachments"> & {
    policy: ServedAttachmentPolicy | null;
    stopOnEscape: (event: ComposerKeyEvent) => void;
    send: ComposerSendController;
    attach: ComposerAttachmentsController;
    textareaRef: RefObject<HTMLTextAreaElement | null>;
  };

// The controls row beneath the draft: attach at the left, the counters
// and the send slot (arrow or stop square) at the right.
function ComposerControlsRow({
  draft,
  attachments,
  policy,
  busy,
  pendingSend,
  stopping,
  stopTurn,
  stopOnEscape,
  send,
  attach,
  textareaRef,
}: ComposerControlsRowProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="tf:flex tf:items-center tf:gap-2 tf:pt-1">
      {policy !== null ? (
        <>
          <TfFileInput
            ref={fileInputRef}
            multiple
            accept={attachmentAcceptOf(policy)}
            onPickFiles={attach.addFiles}
          />
          <TfButton
            variant="icon"
            onClick={() => {
              fileInputRef.current?.click();
            }}
            // Sending blocks the picker too. The original hazard
            // (the landed send's remount vanishing a mid-flight
            // pick) is gone — the list lives in the store now —
            // but the guard stays: a pick landing between the
            // optimistic clear and the refusal restore would
            // interleave with that bookkeeping, and holding the
            // door for the send beat keeps it unambiguous.
            disabled={
              capSlotsSpentBy(attachments) >= attach.attachmentRoom ||
              send.sending
            }
            aria-label="Attach a file"
          >
            <PlusIcon />
          </TfButton>
        </>
      ) : null}
      <div className="tf:ml-auto tf:flex tf:shrink-0 tf:items-center tf:gap-2">
        {stopping ? (
          <span
            role="status"
            className="tf:text-xs tf:text-tf-muted-foreground"
          >
            Stopping…
          </span>
        ) : null}
        {draft.length >= CHARACTER_COUNT_VISIBLE_FROM ? (
          <span className="tf:text-xs tf:text-tf-muted-foreground">
            {draft.length}/{ASSISTANT_MESSAGE_MAX_CHARS}
          </span>
        ) : null}
        {/* The send slot: the arrow while idle, the stop square
            while the assistant answers. The message POST's window
            keeps the arrow — no turn exists to stop until it
            lands — gated on the STORE's pendingSend, not this
            component's `sending` mirror: the suggestion rows (and
            any host wiring) send through the same store method
            without this composer knowing. */}
        {busy && !pendingSend ? (
          <TfButton
            variant="stop"
            onClick={() => {
              void stopTurn();
              // The caret goes home immediately: the draft is
              // where a member who just stopped an answer types
              // next, and Escape (bound on the textarea) stays
              // live through the Stopping… beat.
              textareaRef.current?.focus();
            }}
            onKeyDown={stopOnEscape}
            // aria-disabled, never disabled: a natively disabled
            // control drops keyboard focus to <body> the moment it
            // takes effect, killing Escape and restarting Tab from
            // the document top for the whole Stopping… beat. The
            // double-POST guard is stopTurn's own re-entry check,
            // not this attribute.
            aria-disabled={stopping}
            aria-label="Stop generating"
          >
            <StopIcon />
          </TfButton>
        ) : (
          <TfButton
            variant="send"
            onClick={() => {
              void send.submitDraft();
            }}
            disabled={send.sendDisabled}
            aria-label={send.sending ? "Sending message" : "Send message"}
          >
            <ArrowUpIcon />
          </TfButton>
        )}
      </div>
    </div>
  );
}

// Where focus lands when the focused element unmounts: the body on a
// plain page, but inside a modal <dialog> the focus-fixup rule parks it
// on the dialog element itself. Anything else means the visitor moved
// focus deliberately and it must not be stolen back.
function _focusWasDroppedByTheRemount(
  textarea: HTMLTextAreaElement | null,
): boolean {
  const active = document.activeElement;
  return (
    active === null ||
    active === document.body ||
    (textarea !== null && active === textarea.closest("dialog"))
  );
}
