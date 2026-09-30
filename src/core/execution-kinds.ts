// The execution-request kind vocabulary, as a dependency-free leaf:
// these constants used to live in execution-handlers.ts,
// whose HANDLERS legitimately import the transport adapter, the DOM
// reader subtree and the affordances — but the KINDS are pure
// vocabulary, and the tool-decision anchor family (a value export of
// the ./transcript projection entry) needs only the member-answerable
// table. Reading it through the handlers dragged 16
// transport/reader/affordance modules into an entry whose own law is
// "React-free and transport-free by construction"
// (tests/bundle-closure.test.ts pins the closure now).
// execution-handlers.ts re-exports everything here, so its consumers
// are unchanged.
//
// The same maneuver holds for the outcome vocabulary: the canned
// kind-unsupported refusal (and the ExecutionOutcome shape it inhabits)
// moved here from execution-handlers.ts so ./transcript can export it —
// the dashboard playground answers unservable execution kinds with the
// package's own sentence rather than a transcription of it. Like the
// kinds, these are import-free values, so the entry's closure stays
// transport-free.

// The execution-request kinds the navigate, http_actions, and read_page
// capabilities mint (the serving contract, "Execution-request kinds").
export const NAVIGATE_REQUEST_KIND = "builtin.navigate";
export const HTTP_INTENT_REQUEST_KIND = "http_intent";
export const READ_PAGE_REQUEST_KIND = "builtin.read_page";
export const HIGHLIGHT_REQUEST_KIND = "builtin.highlight";
export const PREFILL_FORM_REQUEST_KIND = "builtin.prefill_form";
// The conversational elicitation kind: the assistant asked the
// member a SET of questions in one pause; every answer is plain text.
// Deliberately NOT in execution-handlers' handler registry.
export const ASK_QUESTIONS_REQUEST_KIND = "builtin.ask_questions";

/**
 * The kinds whose executor is the MEMBER, not this client: the driver
 * must never auto-answer them (its unknown-kind fallback would post
 * kind_unsupported and withdraw the ask). Their entries stay pending in
 * the inbox — closing on stream evidence like every entry — and are
 * answered through the store's submitQuestionAnswers / cancelQuestionSet
 * when the member submits the rendered panel. Any kind NOT here — one
 * this client predates, or one it has since retired (the question set's
 * one-question predecessor) — is answered
 * kind_unsupported through the driver: the contract's documented
 * degrade, which the server turns into "ask it in chat" — never an
 * invisible wait.
 */
export const MEMBER_ANSWERABLE_KINDS: ReadonlySet<string> = new Set([
  ASK_QUESTIONS_REQUEST_KIND,
]);

// A delivery that keeps failing on transport trouble stops re-posting
// after this many attempts went wrong — the turn then parks exactly as
// it did before the driver existed, and reopening the thread re-arms the
// pass. One value for every deliverer (the package driver and the
// dashboard playground's refusal pass), here because the
// ./transcript entry exports it and this leaf is import-free.
export const MAX_DELIVERY_ATTEMPTS = 3;

type ExecutionErrorCode = "kind_unsupported" | "execution_failed";

/** What the failing API itself said, when the host adapter's error
 *  carried it: the HTTP status, the API's own error code, and its
 *  per-field problems (a 422's validation list). Optional and additive
 *  — an adapter that throws a bare Error yields none. Every member is
 *  bounded before it rides (execution-handlers.ts). */
export interface ExecutionFailureDetail {
  status: number;
  code: string;
  fields?: { path: string; message: string }[];
  /** How many problems the API named beyond `fields` — the per-detail
   *  cap and the door fit both drop from the tail, and a partial list
   *  must never read as complete. Present only when positive. */
  fieldsOmitted?: number;
}

interface ExecutionError {
  /** Distinguishes "this client can't serve the kind" from a real failure. */
  code: ExecutionErrorCode;
  message: string;
  detail?: ExecutionFailureDetail;
}

export type ExecutionOutcome =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: ExecutionError };

export const KIND_UNSUPPORTED_OUTCOME: Extract<
  ExecutionOutcome,
  { ok: false }
> = {
  ok: false,
  error: {
    code: "kind_unsupported",
    message:
      "This page cannot perform this action itself. Tell the user what " +
      "you were trying to do and how they can do it themselves.",
  },
};
