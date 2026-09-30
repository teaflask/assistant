// The tool-call rendering contract: tool NAME, PROTOCOL state, raw I/O and
// an optional backend-authored display envelope. The package knows the
// protocol, never a CUSTOMER's tool catalog: no tool-name switch lives
// client-side; per-tool parsing exists only inside the rung-3 built-in views.

/** Protocol states from the AG-UI event trail — the AI SDK vocabulary
 *  minus the approval states, plus four the SDK never names: cancelled,
 *  superseded, refused and denied
 *  (docs/tool-call-contract.md, "States"). */
export type ToolCallState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error"
  | "denied"
  | "cancelled"
  | "refused"
  | "superseded";

/** Backend-authored display metadata for one tool call — the client mirror
 *  of the wire's six-field envelope; absent on unannotated tools. */
export interface ToolCallDisplay {
  /** The model's own words for the step: the row's label in
   *  every state; the shimmer or a quiet state word carries the state. */
  caption?: string;
  progressText?: string;
  completeText?: string;
  /** Authored failure copy for output-error; never success copy. */
  errorText?: string;
  /** Semantic icon token, verbatim from the wire's open vocabulary; unknown
   *  values resolve to "generic" at presentation time, never here. */
  icon?: string;
  /** The tool-view reference (tool-views.md): an opaque key plus the
   *  contract version it targets — meaningless apart, so merged atomically. */
  view?: { key: string; version: number };
}

export interface ToolCallViewModel {
  toolName: string;
  state: ToolCallState;
  /** The wire's tool call id; optional because presentation-only callers
   *  (subagent presence) have none — the tool-view call carries "" then,
   *  and the row stamps its data-tf-tool-call-id hook only when present. */
  toolCallId?: string;
  /** The streamed arguments, pretty-printed by the caller. */
  input: string;
  /** The raw streamed argument JSON text, for the tool-view call's `args`. */
  argsText?: string;
  /** The tool result, verbatim from the wire; absent until it lands. */
  output?: string;
  /** True when the wire's result was the context offloader's model-facing
   *  replacement: `output` is withheld; the row says the result was shortened. */
  offloaded?: boolean;
  errorText?: string;
  /** The door's own refusal sentence, present only on refused
   *  rows — the row's reason in neutral ink, never in the Error pane. */
  refusalText?: string;
  display?: ToolCallDisplay;
  /** The tool's registered argument schema, verbatim from the wire; absent when none
   *  was declared, never `{}`. Forwarded to the tool-view call's argsSchema, never interpreted here. */
  argsSchema?: Record<string, unknown>;
  /** The registered success-result schema; same absence rules. */
  resultSchema?: Record<string, unknown>;
}

/** "create_support_ticket" → "create support ticket": mechanical, never
 *  title-cased — reads the name's SPELLING, never its meaning. */
export function humanizedToolName(name: string): string {
  return name.replace(/[-_]+/g, " ").trim();
}

/** The row's headline by the fallback ladder: the backend's display text
 *  when the wire sent one → the humanized tool name in a protocol-state verb
 *  frame ("Running X…", "Ran X", "X failed"). The frame comes from the STATE,
 *  never the tool's meaning. Per-state frames: docs/tool-call-contract.md. */
export function toolRowHeadlineOf(view: ToolCallViewModel): string {
  const caption = view.display?.caption;
  if (caption !== undefined) {
    return _captionedHeadlineOf(caption, view.state);
  }
  const displayText = _displayTextFor(view);
  if (displayText !== undefined) {
    return displayText;
  }
  const name = humanizedToolName(view.toolName);
  switch (view.state) {
    case "input-streaming":
      return name;
    case "input-available":
      return `Running ${name}…`;
    case "output-available":
      return `Ran ${name}`;
    case "output-error":
      return `${name} failed`;
    case "denied":
      return `You didn't approve ${name}`;
    case "cancelled":
      return `Didn't run ${name}`;
    case "refused":
      return `Didn't ${name}`;
    case "superseded":
      return `Didn't finish ${name}`;
  }
}

/** A caption is intent, not a claim, so it stays the label in every state;
 *  off the running/done path the state rides as a quiet word after it. */
function _captionedHeadlineOf(caption: string, state: ToolCallState): string {
  switch (state) {
    case "input-streaming":
    case "input-available":
    case "output-available":
      return caption;
    case "output-error":
      return `${caption} · failed`;
    case "denied":
      return `${caption} · not approved`;
    case "cancelled":
      return `${caption} · didn't run`;
    case "refused":
      return `${caption} · declined`;
    case "superseded":
      return `${caption} · didn't finish`;
  }
}

/** The display slot per state: completion copy only for a call that
 *  completed; output-error takes authored error copy, else the "X failed"
 *  frame. Denied, cancelled, refused and superseded refuse copy — the
 *  progress sentence predates the decision (docs/tool-call-contract.md). */
function _displayTextFor(view: ToolCallViewModel): string | undefined {
  switch (view.state) {
    case "input-streaming":
    case "input-available":
      return view.display?.progressText;
    case "output-available":
      return view.display?.completeText;
    case "output-error":
      return view.display?.errorText;
    case "denied":
      return undefined;
    case "cancelled":
      return undefined;
    case "refused":
      return undefined;
    case "superseded":
      return undefined;
  }
}
