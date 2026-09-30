# Decision anchors and the pending-decision gap

**Status: accepted.** The living design record for the durable records
of a member decision on a tool call — `src/core/tool-denial-anchors.ts`
and `tool-decision-anchors.ts` — for the pending-decision gap and its
grace gate in `pending-decision-gap.ts`, and for the question-set
decision path's state in `conversation-store.ts`. Each module keeps a
short header stating the invariant and points at this document for the
premises.

## The tool-denial ledger

`tool-denial-anchors.ts`. A member's denial reaches the wire as a
`cancelled` TOOL_CALL_RESULT; the ledger is the client-side join that
reclassifies it:

The tool-denial ledger: the durable row-model record that a member
DECLINED the approval a call was paused for, keyed by tool_call_id. The
wire never says so on the call itself — a denial reaches the transcript
as a TOOL_CALL_RESULT stamped `cancelled`, the same stamp a steering
cancel and the injection defense wear — so the state is a client-side
JOIN of two durable CUSTOM markers, with no wire change:

```text
  approval_requested { interrupt_id, tool_call_id }  → the ask
  approval_resolved  { interrupt_id, approved:false } → the denial
```

Both are replayed CUSTOM events (the contract's frozen full-replay
semantic), so the ledger is a pure fold over the event history: live,
reconnect, and a reloaded settled thread all rebuild it identically
(Law 9). It deliberately never reads the ApprovalInbox card list — the
inbox prunes the card at the gated call's result, at the run terminal
and at the turn's settle (its own designed lifecycle), and the result
that prunes it is the very cancelled result this state reclassifies.
A standalone module like tool-decision-anchors.ts (which folds the
same ask marker into a plain set and drops the interrupt id — the
hold needs no join; this state does).

THE PREMISES, stated:

1. Ordering. approval_requested is recorded when the run pauses;
   approval_resolved is appended at the HEAD of the resumed
   invocation, before the resumed round's output — including the
   cancelled TOOL_CALL_RESULT — streams
   (the serving side's assistant-turn activity,
   _record_approval_receipts_on_a_resume, called from the resume path
   before _respond_recording_the_run). Both land in the one
   thread-scoped log the stream replays in sequence order. So on every
   path the ask precedes its resolution, and the resolution precedes
   the cancelled result — the receipt lands first, so there is never
   a beat where a denied call reads "Interrupted".
2. Order-dependence. The fold learns a denial only for an interrupt
   whose ask it already holds; a resolution naming an unknown
   interrupt is IGNORED, exactly as the inbox ignores a resolution for
   a card it never held. Premise 1 makes that case unreachable from a
   well-formed log; the resume store (the ledger's home) outlives the
   connection epoch, so a cursor-seeded reconnect still holds an ask
   that streamed before the cursor; and the REST-recovery leg feeds the
   ask map from the paused turn's pending_approvals
   (epoch-sync.ts) for a client whose stream never delivered
   it. If the premise were ever false the row would degrade to the
   wire's own `cancelled` reading ("Interrupted") — a missed
   reclassification, never a false one.
3. Best-effort marker. The receipt is appended best-effort and only by
   the FIRST resume attempt (a retried resume never re-emits, the
   backend's accepted cost of a pre-append crash). A history with no
   approval_resolved marker renders the wire's cancelled reading; the
   client cannot and must not invent the decision.

## The tool-decision anchor set

`tool-decision-anchors.ts`:

The tool-decision anchor set: the durable row-model record that a call
carried a member decision — an approval_requested marker, or a
tool_execution_requested marker whose request carries a
member-answerable kind — keyed by tool_call_id. The placement hold's
decision arm reads THIS, never the live card stores: ApprovalInbox and
ExecutionInbox prune their cards at the gated call's result, at the run
terminal, and at the turn's settle (their own designed lifecycles),
while TVC-014's hold window is the TURN — arrival to the next user turn,
across the answer, the result, the settle, and a reload. The markers are
replayed CUSTOM events (the contract's frozen full-replay semantic), so
this set is a pure fold over the event history: live, reconnect, and a
reloaded settled thread all rebuild it identically (Law 9), which the
pruned card list cannot promise. A standalone module like
tool-refusal-anchors.ts, deliberately not a binding of the tool-flag
family: those recorders watch TOOL_CALL_RESULT's flag fields; this one
watches two CUSTOM markers.

## The pending-decision gap

`pending-decision-gap.ts`, the derivation:

The pending-decision gap: the server says the turn waits on named
interrupts, and this client holds NOTHING that answers for one of them —
no approval card (the REST snapshot could not rebuild it, or the marker
was malformed and the server skipped it while keeping its id), no
elicitation card, no execution-inbox entry. No generic wait label exists
to stand in for this state, so the gap must be loud on its own: the
store publishes it and the conversation chrome renders an explicit,
recoverable alert. Silence here is the defect the alert exists to
remove.

THE PREMISE, STATED: a pending interrupt id represented by no card and
not claimed by the execution inbox is a genuine gap — there is nothing
the surface could render for it and nothing the driver will answer.
The derivation reads the SERVER's ids against inbox state, never what
rendered ("never infer 'nothing pending' from 'no card rendered'").
The two judgeability tolerances mirror _turnAwaitsInterrupt's: a null
run_id is a lost capture (the server hides the cards, the set reads
empty though the pause is real — nothing to judge), and a non-array is
a server predating pending_interrupt_ids; both yield null, never a
false alarm.

TWO SERVER-ASSERTED NON-GAP SUBSETS ("never show a wait no card can
serve"): an id whose interrupt_answer_consumed marker this client
replayed has already reached the persisted session through a resume —
the wait is over, alarming would be the phantom; and an id the server
names in unservable_interrupt_ids, whose stored card fails validation
server-side — no retry can ever build a card for it, so the loud
"waiting" banner IS the phantom rather than the recovery. Both subtract
from the missing set; everything else keeps the gap's loudness (an
absent unservable field is an older server and changes nothing).

### The gate's transitions

`PendingDecisionGapGate`:

```text
The per-signature grace window over the evidence predicate. EVERY
transition, enumerated (the seam breeds mistakes, so the
enumeration is committed rather than re-derived). States: quiet |
armed(sig) | loud(sig), crossed with `evidenceSettled` read at elapse.

 1. quiet    + judge(null)      → quiet; no publish (silence is the
    no-gap state — publish(null) fires only to retract a loud alarm).
 2. quiet    + judge(gap)       → armed(sig); probe fires, once for
    this signature.
 3. armed(A) + judge(gap: A)    → no-op; the window keeps running,
    the probe is not re-fired (one read per signature).
 4. armed(A) + judge(gap: B)    → armed(B); fresh window, fresh probe
    — new content earns its own read.
 5. armed    + judge(null)      → quiet; disarm, no publish — the
    reconnect false alarm, absorbed (the card landed in time).
 6. armed(A) + elapse, evidence UNSETTLED → armed(A); quiet heartbeat
    re-arm, no probe — never alarm about an evidence channel not heard
    out (the deps doc states the premise).
 7. armed(A) + elapse, settled, judged still A → loud(A);
    publish(gap).
 8. armed(A) + elapse, judged ≠ A → quiet. Unreachable by
    construction (judge() disarms or re-arms on every content change
    before elapse could see a mismatch) — kept as a cheap truth so a
    future judge() edit cannot promote a stale verdict.
 9. loud(A)  + judge(gap: A)    → no-op; reference churn with the
    same signature never re-publishes.
10. loud(A)  + judge(gap: B)    → loud(B); publish(gap) immediately —
    once loud the published gap tracks the live derivation, no new
    grace for a shifted missing set.
11. loud     + judge(null)      → quiet; publish(null) — the one
    retraction path.
12. evidenceSettled            → consulted only at elapse, so evidence
    that settles late alarms within one window (bounded, stated in the
    deps doc). The gate holds no latch of its own: the owner's
    predicate answers whatever is true at fire time.
13. dispose()                   → disarm; terminal. The published gap
    is the owner's own state and dies with it.
14. construction               → blank. The OWNER must make the gate
    live at least as long as its published state and hand it the
    current truth immediately — a gate that never saw the current
    derivation could otherwise take row 1 on judge(null) and leave a
    published notice stuck on screen. loudSignature
    is NOT inheritable: a successor over a loud predecessor re-arms
    (row 2) rather than resuming loud, and a judge(null) inside that
    window would retract nothing — so an owner that recreates gates
    must only ever do so before anything can be loud (a React owner
    keeps the effect's deps empty; the widget store constructs exactly
    one for its lifetime).
```

## The question-set decision's writes and readers

`conversation-store.ts`, the `_questionAnswers` field:

What each successful submit or cancel posted, by interrupt id, for the
settled receipt.

```text
EVERY WRITE ON THE QUESTION-SET PATH AND ITS LIVE READER (a
written-but-unread field escaped twice, so the whole set is
enumerated here):
  - questionDrafts (below): read by QuestionPanel through
    ElicitationsContext.drafts (useSyncExternalStore); written by the
    panel, cleared here on settle / thread switch.
  - _questionAnswers: read by elicitationCardsOf → card.answered →
    the panel's settled form in shelf-less hosts (the Q→A receipt, or
    the dismissed footer) and the transcript-tail receipt of an
    unrowed answered set (use-transcript-folds.ts); in the shelf composition
    a settled set leaves the slot and states nothing (no meta-receipt row).
  - _elicitationErrors: read by elicitationCardsOf → card.errorSentence
    → the panel's role="alert" line.
  - the execution inbox's entry status (beginExecution /
    settleReported / settlePostFailed / markRunStale): read by
    elicitationCardsOf → card.status → the queue predicate, the panel's
    submitting/actionable states and its stale footer.
  - QuestionSetCardModel.questions: read by the panel and both receipts.
  - the panel's data-tf-answer-active / data-tf-fold-below /
    data-tf-question-gate attributes: read by styles.css (the fold
    mask) and the DOM tests; the wash itself is a class.
```
