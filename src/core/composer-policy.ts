// The composer's pure policy leaf, React-free and transport-free: the
// members both composers — the package's slab and the dashboard
// playground's — apply to a draft before anything is sent. One home
// so the fork ledger has nothing to pin: the per-message
// bounds are felt while typing, the cap slots count only drafts that
// could still ride, the pick-time size check speaks the served kind's
// cap, and Escape/Enter mean the same thing in every composer.

import {
  ASSISTANT_MESSAGE_MAX_CHARS,
  type ServingAttachment,
} from "../contract/threads.js";
import type { AttachmentKind } from "../generated/models/index.js";

// Show the countdown only once it starts to matter.
export const CHARACTER_COUNT_VISIBLE_FROM = ASSISTANT_MESSAGE_MAX_CHARS - 400;

// One attached file's composer-side life: uploading (declare → PUT →
// finalize in flight), ready (sendable), or failed (blocks the send until
// removed — a silent drop would send less than the author believes). The
// settled attachment is the door's own shape: the serving attachment for
// the package, the dashboard's response for the playground.
export interface AttachmentDraft<A = ServingAttachment> {
  localId: number;
  filename: string;
  byteSize: number;
  status: "uploading" | "ready" | "failed";
  attachment?: A;
  error?: string;
}

// Chip ids are minted here, module-scoped, so they survive any composer
// remount and never collide across the composers one page may mount.
let nextDraftId = 1;

export function mintAttachmentDraftId(): number {
  return nextDraftId++;
}

// The one reading of a draft's failed state: a refused pick or a failed
// upload. Every surface asks this rather than comparing the word — the
// dashboard's collapse-layer law keeps status literals out of its
// components, and one predicate keeps the two composers agreeing on
// what "failed" means.
export function attachmentDraftFailed(item: {
  status: AttachmentDraft["status"];
}): boolean {
  return item.status === "failed";
}

// What counts against the per-message cap: only drafts that could still
// ride the message. A failed chip never sends, so it never spends a
// slot — it holds visible ground until removed, nothing more.
export function capSlotsSpentBy(
  attachments: readonly { status: AttachmentDraft["status"] }[],
): number {
  return attachments.filter((item) => !attachmentDraftFailed(item)).length;
}

// The pick-time size cap: the kind's own ceiling when the browser's
// MIME type names one confidently and the caps serve that kind, else the
// widest cap served — the pre-check must never be stricter than the
// server's sniffed truth.
export function pickCapOf(
  file: File,
  caps: Readonly<Partial<Record<AttachmentKind, number>>>,
): { bytes: number; label: string } {
  const type = file.type;
  if (type.startsWith("image/") && caps.image !== undefined) {
    return { bytes: caps.image, label: "an image" };
  }
  if (
    (type === "application/pdf" || type.startsWith("text/")) &&
    caps.document !== undefined
  ) {
    return { bytes: caps.document, label: "a document" };
  }
  if (type.startsWith("video/") && caps.video !== undefined) {
    return { bytes: caps.video, label: "a video" };
  }
  if (type.startsWith("audio/") && caps.audio !== undefined) {
    return { bytes: caps.audio, label: "an audio file" };
  }
  return {
    bytes: Math.max(...Object.values(caps)),
    label: "a file",
  };
}

// The slice of a keyboard event the handlers read — React's
// KeyboardEvent satisfies it structurally, so this leaf never imports
// React.
export interface ComposerKeyEvent {
  key: string;
  shiftKey: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

/**
 * The composer's two keyboard verbs, bound as composerKeys on the textarea
 * and stopOnEscape on the stop button. Enter submits (Shift+Enter is a
 * newline). Escape while the assistant is answering is the stop shortcut,
 * claimed ONLY when stopTurn can actually act: the two windows
 * where it no-ops pass through unclaimed — the message POST (pendingSend,
 * the store's truth, not a component's sending mirror; no turn exists to
 * stop yet) and the "Stopping…" beat itself (the re-entry guard refuses a
 * second stop) — because a swallowed no-op Escape is how a palette,
 * drawer or pane gets wedged. Bound on the textarea and the stop button,
 * the two focus homes of a busy composer.
 */
export function composerKeyHandlersOf(input: {
  busy: boolean;
  pendingSend: boolean;
  stopping: boolean;
  stopTurn: () => void | Promise<void>;
  submit: () => void | Promise<void>;
}): {
  stopOnEscape: (event: ComposerKeyEvent) => void;
  composerKeys: (event: ComposerKeyEvent) => void;
} {
  const { busy, pendingSend, stopping, stopTurn, submit } = input;
  function submitOnEnter(event: ComposerKeyEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }
  function stopOnEscape(event: ComposerKeyEvent): void {
    if (event.key !== "Escape" || !busy || pendingSend || stopping) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void stopTurn();
  }
  return {
    stopOnEscape,
    composerKeys(event) {
      stopOnEscape(event);
      submitOnEnter(event);
    },
  };
}
