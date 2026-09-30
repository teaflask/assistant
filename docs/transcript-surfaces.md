# Transcript surfaces — the slot, annex, fold and end-state rules

**Status: accepted.** The living design records of the transcript
components: the code carries the invariant and this file carries the
argument. Each section names its source module; the module's comment
points back here. A record is kept only as long as it stays true — amend
it with the code.

## The trailing-liveness claimants (`use-transcript-folds.ts`)

Exactly one element may say "work is live" at the transcript tail, across
every host and every tail row kind. `_trailingLivenessClaimantOf` decides
it from the same facts its renderer reads; `tests/liveness-claimants.test.tsx`
executes the matrix.

```text
| trailing row              | claims when                | claimant     |
| ------------------------- | -------------------------- | ------------ |
| run-fold                  | live (turnLive) or its own | tail-row     |
|                           | members run                |              |
| assistant-text            | streaming                  | tail-row     |
| subagent-group            | a member runs (the SAME    | tail-row     |
|                           | ledger join the group row  |              |
|                           | renders its shimmer from)  |              |
| anything else / empty     | never                      | —            |
```

With no claiming tail row: `typing` elects the silence-gap dot; else
`live` elects the standalone Working… headline; else none. A
host-provided empty surface on an empty log outranks everything here at
the call site.

## The decision arms — the card-store consumers, classified (`activity-rail.tsx`, `tool-call-rows.tsx`)

Two arms read decisions, and they deliberately differ. The ROW's hold
(the `decisionBearing` derivation in `tool-call-rows.tsx`) reads the
durable `row.decisionBearing` first and the live card stores as the
complement, because the card stores prune at the gated call's result,
the run terminal and the turn's settle while TVC-014's hold window is
the TURN. The FOLD's default openness (`_groupAwaitsDecision`,
`activity-rail.tsx`) reads the LIVE pendency alone — a fold stays open
while a member awaits the decision and folds once it settles, since an
answered decision is finished work. Every consumer of the card stores in
the two files, classified:

```text
The class, enumerated (a presentational derivation reading a live,
prunable store where its contract is defined over the durable row
model) — every consumer of the card stores in this file and the
row's, classified:
  · the fold's default openness (_groupAwaitsDecision) — CORRECT-AS-IS
    by contract since the working-fold re-cut: its contract IS the
    live pendency (the working section is the open one), so a pruned
    store closes the fold exactly when the work settled;
  · the row hold (ToolCallRows' decisionBearing derivation) — WAS
    affected; fixed: durable arm first, live arm as complement;
  · the "Needs input" pill (TVC-036, _awaitsMemberDecision) —
    CORRECT-AS-IS: its contract is the LIVE pendency ("a call
    paused for approval or elicitation wears an awaiting-input
    signal"), which ends with the decision by definition;
  · the suspension queue (core/suspension-queue.ts) — CORRECT-AS-IS:
    an actionable surface must exist to be acted on; live by
    definition;
  · the shelf-less inline card mounting below — CORRECT-AS-IS: it
    mounts the card UI itself, which exists exactly while the store
    holds it;
  · ToolViewCall.awaitingDecision (the view contract) — CORRECT-AS-IS
    by contract: "True WHILE a pending approval or elicitation …
    awaits the member" — live pendency, stated in core/tool-view.ts.
```

## The agent binder's declared values (`assistant-transcript.tsx`)

Where each value the agent-mode host declares lands — committed rather
than re-derived, so a new consumer is checked against the list.

```text
WHERE EACH DECLARED VALUE LANDS (the enumeration, committed rather
than re-derived):
  markers            → the render walk only (MessageList brackets
                       every block); never the projection.
  markerBoundaries   → transcriptBlocksOf (splits delegation groups)
                       AND foldedBlocksOf via MessageList (cuts fold
                       segments). Never a turn boundary.
  resumeAnchoredIds  → anchors.resumeAnchors (the severance window's
                       presence scan). Deliberately NOT a fold input:
                       a retry marker restarts an attempt, never a
                       turn.
  deliveryAnchoredIds→ anchors.subagentDeliveryAnchors (the severance
                       scan's turn-window reset — presence-based, so
                       the empty arrays below suffice) AND
                       MessageList's turnStartIds (the fold pass's
                       open-tail window — ROW-based, so the empty
                       arrays do NOT suffice and the ids must ride
                       through explicitly).
  offloadAnchors     → anchors.toolOffloadAnchors (the offload stamp:
                       an offloaded result's content is the offloader's
                       replacement, rendered as the shortened-preview
                       line, never as output).
  denialLedger       → anchors.toolDenialAnchors (its DENIED half
                       only — the state ladder's rung above
                       cancelled); the ask map never leaves this
                       component.
  turnAttachments    → transcriptBlocksOf's side-table join only.
  scrollClassName, the five slots → render only.
```

## The keying law, per slot (`slot-boundary.tsx`)

Frame behavior attached to a slot must key on the fill having ACTUALLY
RENDERED, never on the prop having been supplied — both fallback routes (a
null return in `SlotOrDefault`, a throw in `HostSlotBoundary`) land on the
package default, which carries its own signals, and a prop-keyed extra
would double them. Per slot:

```text
messageView — nothing keys on presence beyond choosing the
  direct-vs-boundary route, and both routes render the identical
  default (SwappedContent), so no route can double anything.
toolRow     — the mandatory status word rides `filledAnnex` below:
  rendered by package code beside the fill (a sibling the fill
  cannot reach), and absent on BOTH fallback routes, where the
  package ToolRow's own state pill carries the status.
input       — NO boundary at all (the input-region rule):
  the region carries the surface's ability to act —
  composer and decision controls — so a throw propagates to the
  host's own boundary instead of latching into a paused-looking,
  unanswerable surface.
welcomeScreen — boundary(fill), fallback null, no frame extras.
threadList  — the chrome hook div rides INSIDE the boundary, so a
  latched fill leaves no empty host-styleable strip behind.
markers     — boundary per invocation, fallback null, no extras.
```

## The override's hidden assumptions (`tool-row.tsx`)

The default view is reachable in the row body (there is no rung-4
terminal override), and the override that once stood there had been
silently carrying presentational assumptions. Each, classified:

```text
THE OVERRIDE'S HIDDEN ASSUMPTIONS, enumerated (one mechanism):
removing the rung-4 terminal override made the default view
reachable in the row body for the first time, and the override had
been silently carrying presentational assumptions. Each,
classified:
  · the "Result:" heading was honest only while the slot's content
    was guaranteed to be a rung 1–3 result reading — BROKEN on the
    exhausted arm (the rung-4 terminal is an input reading headed
    "Request"); FIXED: the heading moved into the slot, which alone
    knows which rung is showing, and renders only over a mounted
    candidate with a landed result;
  · (TechnicalEvidence and its "Raw result:" pane were since DELETED
    with the Technical details disclosure — the rows below are the
    census as it stood when the override left.)
  · TechnicalEvidence's "Raw result:" qualifier — its wording stays
    SOUND on every arm (it names the verbatim wire bytes), but its
    justifying comment referenced the heading unconditionally;
    amended in place;
  · ToolArgumentsSummary's card chrome and min-h-24 floor rested on
    the pre-banner APPROVAL CARD's flex column ("the card itself
    scrolls") — BROKEN in the row body (this file's own grammar: "no
    card chrome at all"); FIXED: the summary wears the row grammar
    alone — its card variant died with the playground's forked
    approval card (the package mount had already been removed);
  · a call with no arguments renders NOTHING from rung 4
    (ToolArgumentsSummary returns null) — SOUND per the contract:
    the bounded reading of empty input is empty. This row's original
    claim ("TechnicalEvidence keeps the raw panes one disclosure
    down, so the row is never evidence-free") was WRONG for the
    byte-less window — before arguments stream and before output
    lands there ARE no raw panes, and the disclosure expanded to
    nothing. TechnicalEvidence now renders only
    once bytes exist to show: an honest empty body over a broken
    promise;
  · the semantic-view wrapper's mt-1 — SOUND (a top margin above
    whatever the slot shows, heading or not).
```

## The tool-view mount slot — failure census and resolution-change census (`tool-view-slot.tsx`)

`useMountedAdapter` keys its effects on the ADAPTER's identity, never on
the candidate wrapper the presenter rebuilds per render, and tracks
failures by adapter identity, never by position.

```text
FAILURE CENSUS — every way a mounted adapter can fail, and where each
is caught:
 1. `mount` throws (sync)  → the mount microtask's catch.
 2. `update` throws (sync) → the update microtask's catch.
 3. `destroy` throws       → swallowed to console; the adapter is
    leaving anyway — no advance.
 4. React sugar: a render, layout-effect or passive-effect throw
    belonging to a mount/update flush surfaces inside the flushSync
    window (empirically — flushSync flushes the forced work's
    passive effects too) and is converted into a synchronous
    mount/update throw by the latch (react-tool-view.tsx) → cases
    1/2.
 5. React sugar: a throw from a render the view schedules for ITSELF
    (its own setState from a timer, promise or subscription) commits
    with no mount/update in flight — no synchronous channel exists —
    so it travels the container's late-failure event, which the
    mount effect listens for → the same report-clear-advance path.
 6. A vanilla adapter's own asynchronous failures (its timers, its
    promises) are outside the contract by design: the contract's
    failure channel is a throw from mount/update (plus the package
    sugar's event above); an adapter owns its other async errors.

RESOLUTION-CHANGE CENSUS — the candidate list can be re-composed
after a failure, so failures are tracked by ADAPTER IDENTITY, never
by position (a positional cursor mis-addressed the list when a
late-arriving wire ref prepended a rung-1 candidate):
 a. a late `tool_call_annotated` ref prepends a rung-1 candidate →
    the failed rung-2 adapter stays skipped wherever it sits, and the
    untried rung-1 mounts: ladder order holds;
 b. a registry identity change replaces adapter objects → the new
    adapters get a fresh try (new code deserves one); stale set
    entries are inert and bounded by this mount's failure count;
 c. one adapter resolved on several rungs (wire key == tool name) →
    one failure skips every occurrence: re-mounting an adapter that
    just threw is a report storm, not a rung;
 d. one adapter RE-KEYED by a late ref (a double registration
    re-resolving rung 2 → rung 1) → no remount: a key change with an
    unchanged adapter is a re-labelling, so the key is reporting
    metadata (the mount record's key), never an advance signal.
What identifies a candidate for failure tracking is its ADAPTER
OBJECT — the same identity useAdapterMount keys on. The set only
grows within a mount: a flaky adapter never flickers back in.
```

## The delivery guard's premises (`tool-view-slot.tsx`)

`_sameDelivery` answers "nothing a view can observe changed" over a fixed
field set. The premises that field set rests on, each stated because a
false one seeds the next bug:

```text
"Nothing a view can observe changed." Premises the field set rests
on, each stated because a false one seeds the next bug:
- `result` and `truncated` are pure functions of `resultText`
  (JSON.parse + toolResultEnvelopePayloadOf, both deterministic), so
  comparing the source text covers them;
- `args` is identity-stable across re-renders with unchanged source —
  the presenter's IDENTITY LAW (tool-call-presentation.ts memoizes
  the parse on the source text), so unchanged nested arguments hit
  the `===` fast path rather than re-minting and mis-reading as
  changed. The shallow walk only runs when the source actually
  changed (or across a rare memo reset), where over-delivering an
  update is the safe direction — never a suppression;
- `argsSchema` and `resultSchema` are identity-stable per source:
  the schema anchors map stores one narrowed object per
  call and its first-wins merge keeps the stored references, so `===`
  is sound — a late-arriving schema is a new reference and delivers.
```

## The child panel's end-state table (`child-transcript.tsx`)

ONE fact drives every flag in `ChildTranscript`: how the panel's stream
ended. The table, and the QUIET-ending and UNREAD-row rulings:

```text
─── The panel's end-state table ──────────────────────────────────
ONE fact drives every flag below: how this panel's stream ended.

  the stream…                 │ ledger row │ the member sees
  ────────────────────────────┼────────────┼────────────────────────
  still open (replay/tail)    │ any        │ rows as they land; typing
  denied the slot (QUEUED)    │ any        │ "Waiting for another…"
  ended clean (terminal)      │ succeeded  │ replay stands; Finished
  errored, honest terminal    │ failed     │ failure sentence; Failed
  errored, transport drop     │ dispatched │ interruption banner+Retry
  ended quietly, no terminal  │ dispatched │ interruption banner+Retry
  ended quietly, no terminal  │ settled    │ replay stands; Finished
  ended quietly, no terminal  │ UNREAD     │ interruption banner+Retry
  aborted by our own teardown │ —          │ nothing: panel is leaving

The QUIET rows: the door only ever ends a child stream at
a terminal, so a body that closes with none is a dropped connection
wearing a clean shape — and @ag-ui/client completes it cleanly, no
error. REST is the authority (the parent stream's
handleStreamClosedQuietly premise): the ledger is caught up first,
then the quiet verdict is judged ONCE against the row that catch-up
landed — still running → the error ending (banner + Retry); settled
→ clean — and LATCHED: a drop whose child later
settles keeps its banner and Retry, because the replay underneath is
truncated at the drop and only a Retry's full replay completes it —
exactly as the error ending has always latched. Before this row
existed, such a drop silently stopped following a running child with
no banner and no Retry.

THE UNREAD ROW: the catch-up can land NO row
— the read bounded out or failed with no prior snapshot, likeliest
in exactly the outage that dropped the stream. The judge asks one
affirmative question, dispatchHasSettled(row) — "did the ledger SAY
this child is done?" — and only a yes reads clean; a dispatched row
and no row at all both read as the error ending, banner and Retry,
like the error ending itself, which latches error whatever the row.
A ledger not read is not a ledger that settled (the backend's null
posture on the sse_stream_teardown line); the earlier judge asked
"is it running?" and sent an unreadable ledger to Finished over a
replay truncated at the drop — the silent unfollow this row ends.

The waiting row keys on an EXPLICIT denial (the pool's waiting
snapshot), never on the lease merely not having been asked for yet:
the first commit lands before the passive lease effect asks, and an
un-asked lease must not flash untrue contention copy.
```

## The suspension tenant's focus premise (`suspension-surfaces.tsx`)

The requirement "focus moves intentionally when a new decision requires
action", stated as the rule the tenant implements:

```text
FOCUS PREMISE ("focus moves intentionally when a new decision
requires action"), stated: a newly arriving decision never
steals focus — the member may be mid-keystroke in the composer, which
stays enabled through a pause by design, and an uninitiated focus jump
is exactly the context change WCAG 3.2 warns about. The arrival is
announced by the always-mounted RunStatusAnnouncer ("Waiting for your
input" — the transcript's one status live region; this tenant adds no
second one), and the surface sits in DOM order directly before the
composer, one Shift+Tab from the member's usual focus home.
"Intentionally" therefore means: only at member-initiated moments —
when the member resolves the focused decision, focus moves to the next
queued decision's surface, and when the queue empties it returns to
the composer's input.
```
