// The question-set draft store: where a member's in-progress
// answers to a builtin.ask_questions pause live while they page through
// the panel. OUTSIDE every component on purpose — the suspension pager
// remounts the presented surface by decision identity, the transcript
// remounts on every reconnect nonce, and the playground remounts its
// whole transcript on send/retry — so a draft held in component state
// dies at exactly the moments a member is most likely to be mid-answer.
// Keyed by interrupt id (one pause = one question set) and question id
// beneath it, so two sets can never bleed into each other and the pager
// key's isolation guarantee survives without the key eating the draft.
//
// LIFETIME (ruled here, not inferred): created lazily on the first
// mutation; kept across navigation, remount, reconnect and a failed
// submit; cleared by the owner only on present-and-settled evidence (the
// member's own successful submit or cancel, or a published card for the
// same interrupt that reads answered/stale) — never on mere absence,
// because a reconnect publishes an empty entry list before the replay
// refills it; cleared wholesale on a thread switch. IN-MEMORY ONLY: a
// page reload loses unsent drafts. That is a decision, not a gap — a
// pause can be voided from another tab by a new message, and persisted
// drafts would resurrect stale text against a superseded set.
//
// ACTIVE CHOICE is explicit: an option OR the custom row, never a hidden
// "typed text wins" rule. Selecting an option keeps the custom text (the
// member may come back to it); typing in the custom row makes it active.
//
// Deliberately import-free and React-free: every draft law (explicit
// active choice, cursor in the draft, release only on explicit clear)
// reads the same on every surface because there is one store — exported
// on @teaflask/assistant/transcript for the playground.

type ActiveChoice =
  { kind: "option"; text: string } | { kind: "custom" } | null;

export interface QuestionAnswerDraft {
  active: ActiveChoice;
  customText: string;
}

export interface QuestionSetDraft {
  /** Which question the panel shows — kept here so paging, remounts and
   *  reconnects all return the member to where they were. */
  cursor: number;
  answers: ReadonlyMap<string, QuestionAnswerDraft>;
}

export interface QuestionLike {
  id: string;
}

/** The per-answer transport bound the server enforces (QuestionAnswer.text
 *  maxLength on the serving contract — pinned equal by the monorepo's
 *  contract-parity test). The panel says so beside the row instead of
 *  clipping: no silent truncation. Measured here in UTF-16 units
 *  (String.length) while the server counts code points — an astral
 *  character costs two here and one there, so this side is the stricter
 *  or equal one and a text that passes the panel never fails the door. */
export const MAX_ANSWER_TEXT_CHARS = 1900;

const EMPTY_ANSWER: QuestionAnswerDraft = { active: null, customText: "" };
const EMPTY_SET: QuestionSetDraft = { cursor: 0, answers: new Map() };

export class QuestionDraftStore {
  private readonly drafts = new Map<string, QuestionSetDraft>();
  private readonly listeners = new Set<() => void>();

  // Arrow fields on purpose: get/subscribe travel unbound into
  // useSyncExternalStore.
  get = (interruptId: string): QuestionSetDraft => {
    return this.drafts.get(interruptId) ?? EMPTY_SET;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** True when the member has entered anything for this set — what the
   *  panel's Cancel consults before asking "Discard answers?". */
  hasContent(interruptId: string): boolean {
    const draft = this.drafts.get(interruptId);
    if (draft === undefined) {
      return false;
    }
    for (const answer of draft.answers.values()) {
      if (answer.active !== null || answer.customText !== "") {
        return true;
      }
    }
    return false;
  }

  selectOption(interruptId: string, questionId: string, text: string): void {
    this.updateAnswer(interruptId, questionId, (answer) => ({
      ...answer,
      active: { kind: "option", text },
    }));
  }

  selectCustom(interruptId: string, questionId: string): void {
    this.updateAnswer(interruptId, questionId, (answer) => ({
      ...answer,
      active: { kind: "custom" },
    }));
  }

  /** Typing makes the custom row the active choice — the one implicit
   *  switch, and it is the member's own keystroke. The text is written
   *  as the door will accept it: pasted control characters are
   *  normalized here (see normalizeCustomText), so the panel's posture —
   *  every per-answer rule the door enforces is kept in view before the
   *  POST — holds for the control rule as it does for the length bound. */
  setCustomText(interruptId: string, questionId: string, text: string): void {
    this.updateAnswer(interruptId, questionId, (answer) => ({
      ...answer,
      active: { kind: "custom" },
      customText: normalizeCustomText(text),
    }));
  }

  setCursor(interruptId: string, cursor: number): void {
    const current = this.get(interruptId);
    if (current.cursor === cursor) {
      return;
    }
    this.drafts.set(interruptId, { ...current, cursor });
    this.notify();
  }

  clear(interruptId: string): void {
    if (this.drafts.delete(interruptId)) {
      this.notify();
    }
  }

  clearAll(): void {
    if (this.drafts.size === 0) {
      return;
    }
    this.drafts.clear();
    this.notify();
  }

  private updateAnswer(
    interruptId: string,
    questionId: string,
    change: (answer: QuestionAnswerDraft) => QuestionAnswerDraft,
  ): void {
    const current = this.get(interruptId);
    const before = current.answers.get(questionId) ?? EMPTY_ANSWER;
    const after = change(before);
    if (
      before.customText === after.customText &&
      sameChoice(before.active, after.active)
    ) {
      return;
    }
    const answers = new Map(current.answers);
    answers.set(questionId, after);
    this.drafts.set(interruptId, { cursor: current.cursor, answers });
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

function sameChoice(a: ActiveChoice, b: ActiveChoice): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  if (a.kind !== b.kind) {
    return false;
  }
  return a.kind === "option" && b.kind === "option" ? a.text === b.text : true;
}

/** The text one question's draft answers with, or null while it has no
 *  usable answer: an active option is its text; the custom row counts
 *  only with non-blank text (submitted verbatim — trimming is for the
 *  emptiness test alone, never the payload). */
function answerTextOf(draft: QuestionAnswerDraft | undefined): string | null {
  const active = draft?.active ?? null;
  if (active === null || draft === undefined) {
    return null;
  }
  if (active.kind === "option") {
    return active.text;
  }
  return draft.customText.trim() === "" ? null : draft.customText;
}

/** The complete answer set in question order, or null while any
 *  question is unanswered — the panel's Submit gate and its POST body. */
export function answersOf(
  questions: readonly QuestionLike[],
  draft: QuestionSetDraft,
): { id: string; text: string }[] | null {
  const answers: { id: string; text: string }[] = [];
  for (const question of questions) {
    const text = answerTextOf(draft.answers.get(question.id));
    if (text === null) {
      return null;
    }
    answers.push({ id: question.id, text });
  }
  return answers;
}

/** The door refuses C0 control characters other than tab, newline and
 *  carriage return (a transport rule that bounds the escaped worst case).
 *  A textarea only normalizes CRLF, and real pastes carry the rest: Word
 *  and Google Docs emit a vertical tab (U+000B) for a soft line break,
 *  some PDF viewers a form feed (U+000C) for a page break. Those two ARE
 *  line breaks to the member, so they become newlines — the break
 *  survives unchanged in meaning; the others (NUL, BEL, BS, ESC, …) carry
 *  no text and are dropped. Never a truncation: every printable character
 *  stays exactly where it was. */
function normalizeCustomText(text: string): string {
  return text
    .replace(/[\u000b\u000c]/g, "\n")
    .replace(/[\u0000-\u0008\u000e-\u001f]/g, "");
}

/** The index of the first question still without a usable answer, or -1
 *  when the set is complete — what the footer names when Submit is gated,
 *  and where a continue from the last question jumps to. */
export function firstUnansweredIndexOf(
  questions: readonly QuestionLike[],
  draft: QuestionSetDraft,
): number {
  return questions.findIndex(
    (question) => answerTextOf(draft.answers.get(question.id)) === null,
  );
}

/** The ids whose custom text exceeds the transport bound — the panel
 *  says so beside the row instead of clipping (no silent truncation). */
export function overLimitOf(
  questions: readonly QuestionLike[],
  draft: QuestionSetDraft,
  maxChars: number,
): string[] {
  const over: string[] = [];
  for (const question of questions) {
    const answer = draft.answers.get(question.id);
    if (
      answer !== undefined &&
      answer.active?.kind === "custom" &&
      answer.customText.length > maxChars
    ) {
      over.push(question.id);
    }
  }
  return over;
}
