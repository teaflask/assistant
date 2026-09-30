# Transcript rows and run folds — the projection premises

**Status: accepted.** The design record for `src/core/run-folds.ts`,
`src/core/transcript-rows.ts` and `src/core/segment-timing.ts`, which
keep the invariants and point here. Each section below names the module
and symbol it belongs to; the list-bearing ones sit in text fences so
their shape is preserved. The testable sentences live in
`transcript-visual-contract.md`.

## Fold premises (run-folds.ts, module header)

Run folds: the pure grouping pass between the transcript row projection
and the rendered transcript. While a turn is still open, consecutive
reasoning and tool protocol rows are one narrated work sequence — a fold
— and user/assistant prose, receipts, dividers, and subagent groups
split sequences at their exact transcript position, so the live tail
reads prose → fold → prose → fold in its true chronology. Once a turn
settles, each uninterrupted work span unifies around its LAST maximal
prose run — the turn's last words: the final response of a clean settle,
the last narration of a turn that was stopped, failed, or superseded
mid-work. That run stays outside; everything before it (earlier
narration included, as steps at their original positions) unifies into
one episode fold; work that continued past it — the cut-off tail of an
interrupted turn — folds into its own trailing fold, so no settled turn
with prose ever renders zero visible assistant text (collapse the work,
never the answer, and never the last thing the assistant said before a
stop). User-facing surfaces (user messages, receipts, dividers, subagent
groups) never fold and always split episodes. The rule is structural
only: position and row kinds decide what folds — never copy length,
keywords, importance, or per-turn status (which the row model does not
carry). Which views a tool row resolves never enters the grouping
either: a view is inspected at its own row inside the fold, never by
splitting the episode — one uninterrupted work span is one "Worked for
…" disclosure, whatever its rows resolve. Input requests follow this
rule too: their question cards appear inside the tool view only after an
answer record arrives. While input is pending, the actionable question
panel owns the questions and the tool row keeps its compact status.
React-free on purpose: fold boundaries and the settled headline must be
a function of the projected rows and one openTailTurn bit, so live,
reconnect, and replay histories fold identically and the whole
derivation is unit-testable without a DOM.

Each fold's duration reduces over ITS OWN members' server timing
(settledFoldDurationOf) — never turn-level evidence, and never a client
clock. A unified episode reduces over all its work members, so the span
covers the narration gaps between clusters without prose ever needing
timing of its own.

## Resume severance scoping (`_severedFlagsOf`, transcript-rows.ts)

```text
Which messages a resume anchor severs. Two scopings, both from the
marker's mechanism (a retrying activity appends run_resumed to ITS
OWN run's log, anchored to the retry's first message):

- Per turn, never thread-wide: the anchor map and the message list
  both span the whole conversation, but a retry only ever re-streams
  the turn it belongs to — an earlier turn's open call (the Stop or
  failure shape) was not severed by it and keeps its deliberately
  still-pending read (a failed turn's receipt row owns that story;
  a stopped turn's prose simply ends — the meta-receipt deletion left
  no other narration). A turn's FIRST VISIBLE ROW starts its window: the
  member's user message, or the delivery divider announcing a machine-
  initiated delivery turn (the mailbox-speaks-first invoke has no
  user message — today's only user-message-less turn). Terminal
  receipts mark turn ENDS, and the approval-endpoint fallback
  restart continues the same turn, so neither moves the boundary; a
  future user-message-less turn kind must announce itself with a
  divider to be recognized here. A log with no boundaries at all is
  one run, and the whole log is the window — the child drill-in reads
  the same way, since its only boundary is the opening brief the
  panel prepends (core/subagent-brief.ts) at its very first row.
- Every resume anchor severs: with segment retired (no writer ever
  set a value) every run_resumed marker marks a
  retry, so there is no non-severing resume shape left to classify.

Boundary resets apply BEFORE the same message's severance check, so
a retried delivery attempt whose divider and resume marker share one
first message (the _pushMarkersAt ordering's documented shape)
severs nothing rather than walking into the previous member turn —
the safe direction: a missed severance stays pending, a false one
asserts an interruption that never happened. A later retry re-severs
its whole turn window, so a second retry covers the first retry's
open calls too.
```

## Duration laws (segment-timing.ts, module header)

```text
The duration contract, pure of React and of the wire: the fold
reduction renders from it. Stored run events carry an emit-side
server timestamp inside their payload (epoch milliseconds), replay-
stable by construction — live tail, reconnect, and full replay
serialize the identical stored row. This module owns the two laws the
serving contract pins:

1. A fold's duration reduces over its MEMBER blocks — earliest start,
  latest settle — never over turn-level evidence. An OPEN turn can
  hold several per-cluster folds (prose, work, prose, work), each
  with its own span; a COMPLETED turn's episode fold reduces over
  all its work members, spanning the narration gaps,
  and a cut-off tail fold reduces over its own severed members.
2. "Unknown" and "sub-second" are DIFFERENT states, held apart by
  type: a fold whose members carry no timestamps (an old history, a
  synthesized frame) is unknown and hides; a measured zero is a real
  sub-second span and renders as one. A consumer holding a
  SegmentDuration cannot write "Worked for 0s" by accident, and it
  must never substitute its own clock for an absent value.
```
