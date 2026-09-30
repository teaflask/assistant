"use client";

// The semantic icon vocabulary (contract law 6): the one ToolCallIcon →
// glyph table, and the composite operation mark every process row leads
// with. The mark is a pure function of the RESOLVED presentation —
// (protocol state, icon token) — never of a tool name (TVC-032), each
// vocabulary member renders a distinct glyph (TVC-054), and completion
// is quiet: the settled mark is the semantic icon in settled ink, never
// a universal checkmark. Destructive ink appears on the mark iff the
// call failed (TVC-033); a cancelled, refused (TVC-038) or member-denied
// (TVC-039) call stays neutral. State is never colour-only: the mark
// carries its state word for assistive tech, and the row's headline
// ladder says it in text.

import type { ReactNode } from "react";

import type { LucideIcon } from "lucide-react";
import {
  BrainIcon,
  CalendarClockIcon,
  CompassIcon,
  FileTextIcon,
  ListTodoIcon,
  MessageCircleQuestionIcon,
  SearchIcon,
  SquareTerminalIcon,
  UsersIcon,
  WrenchIcon,
} from "lucide-react";

import type { ToolCallState } from "../core/tool-call-display.js";
import type { ToolCallIcon } from "../core/tool-call-presentation.js";
import { cx } from "./primitives/cx.js";

// One glyph per resolved vocabulary member — operational meaning, never
// a brand or a tool name (the presenter already resolved unknown tokens
// to "generic", so this record is total over what can reach it).
const OPERATION_GLYPHS: Record<ToolCallIcon, LucideIcon> = {
  search: SearchIcon,
  file: FileTextIcon,
  terminal: SquareTerminalIcon,
  question: MessageCircleQuestionIcon,
  memory: BrainIcon,
  delegation: UsersIcon,
  routine: CalendarClockIcon,
  // The plan-progress member (contract §8's recorded conditional):
  // a checklist, unmistakably not the generic wrench.
  todo: ListTodoIcon,
  navigation: CompassIcon,
  generic: WrenchIcon,
};

// The state language, keyed by protocol state alone — the words assistive
// tech hears where sighted readers get ink and the headline ladder.
const STATE_WORDS: Record<ToolCallState, string> = {
  "input-streaming": "Queued",
  "input-available": "Running",
  "output-available": "Completed",
  "output-error": "Failed",
  // Its own quiet word: a member declined the approval — not interrupted
  // (nobody cut it), not failed (nothing broke), and not the door's
  // "Declined" (TVC-038 — the tool never got to answer).
  denied: "Not approved",
  cancelled: "Interrupted",
  // Its own quiet word: the tool answered and declined — not
  // interrupted (nothing cut it), not failed (nothing broke).
  refused: "Declined",
  // Shares cancelled's outcome word — both landed short of an outcome
  // through no fault of the tool; the headline frames tell them apart.
  superseded: "Interrupted",
};

/** The mark's package-owned chrome — identity, state attribute, ink
 *  rules and the assistive state word — around any glyph. Shared by the
 *  package mark below and the tool-view icon slot, so a registered icon
 *  can replace the GLYPH and nothing else (tool-views.md: one
 *  registration, two roles; the mark's state semantics are never the
 *  adapter's to lose). */
export function OperationMarkFrame({
  status,
  children,
}: {
  status: ToolCallState;
  children: ReactNode;
}) {
  return (
    <span
      // Deliberately NO icon-token attribute here: the glyph itself must
      // carry the distinctness (TVC-054's negative control proved an
      // icon attribute lets two members share one glyph unnoticed).
      data-tf-op-mark=""
      data-tf-op-state={status}
      className={cx(
        "tf:grid tf:size-4 tf:shrink-0 tf:place-items-center",
        // Queued (a pending call on a run that is not streaming) dims —
        // the mark stays semantic, never a dashed mystery circle.
        status === "input-streaming" && "tf:opacity-45",
        // The one loud pixel (the visual spec's Status-Only Color Rule):
        // failure wears destructive ink; cancellation, refusal and a
        // member's denial stay neutral.
        status === "output-error" && "tf:text-tf-destructive",
      )}
    >
      {children}
      <span className="tf:sr-only">{STATE_WORDS[status]}</span>
    </span>
  );
}

/** The process row's leading mark: semantic identity with local state.
 *  Rendered as the row summary's FIRST child — that position is contract
 *  (TVC-050 measures the icon column on it). */
export function OperationMark({
  icon,
  status,
}: {
  icon: ToolCallIcon;
  status: ToolCallState;
}) {
  const Glyph = OPERATION_GLYPHS[icon];
  return (
    <OperationMarkFrame status={status}>
      <Glyph aria-hidden className="tf:size-4" />
    </OperationMarkFrame>
  );
}

/** The bare semantic glyph, for consent frames: the decision card's title
 *  carries the words and the frame carries the state, so the glyph arrives
 *  silent — no state word, no ink rule, aria-hidden. Same
 *  one-glyph-per-member table as the operation mark, never a fork. */
export function OperationGlyph({
  icon,
  className,
}: {
  icon: ToolCallIcon;
  className?: string;
}) {
  const Glyph = OPERATION_GLYPHS[icon];
  return <Glyph aria-hidden className={cx("tf:size-4", className)} />;
}

/** The inline state pill (Layer A's state badge): a small textual badge
 *  on the affected row for the states that must never read as quiet —
 *  failure, interruption, awaiting input. Mechanical state words only
 *  (the headline ladder owns authored copy); text is the signal, colour
 *  merely underlines it. */
export function StatePill({
  children,
  destructive = false,
}: {
  children: string;
  destructive?: boolean;
}) {
  return (
    <span
      data-tf-state-pill=""
      className={cx(
        "tf:shrink-0 tf:rounded-full tf:border tf:border-tf-border tf:px-1.5 tf:py-px tf:text-xs tf:leading-4 tf:whitespace-nowrap",
        destructive && "tf:text-tf-destructive",
      )}
    >
      {children}
    </span>
  );
}
