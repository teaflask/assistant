# Thread dispatches — the ledger read, its demand union and its flight

**Status: accepted.** The design record for `use-thread-dispatches.ts`:
the widget transcript's read of the thread's dispatch family lives in a
session-scoped registry cell — every mounted surface shares ONE map and
ONE 10s single-flight poll; each mount registers a demand, the union of
demands drives the timer, and the last demand leaving stops it. The
sections below are the arguments behind the invariants the code states.

## The read bound (`READ_BOUND_MS`)

```text
The roster read's bound: this transport attaches no
AbortSignal or timeout to any REST call, so an accepted-then-stalled
GET never settles — and busy, released only by the read's own finally,
would latch for the life of the SESSION (ledgers are WeakMap-kept per
TokenSession and outlive every mount). Two poll windows: a read slower
than two ticks is indistinguishable from wedged, and the next tick's
fresh read supersedes it anyway. Each bound-out counts toward
MAX_CONSECUTIVE_READ_FAILURES so a wedged endpoint stops after three
outstanding sockets — the trip's fail-closed stance, stall-shaped
(without the count, releasing busy would trade one latched socket for
one new wedged socket per tick, the per-host-budget hazard).
```

## The demand predicates (`anySubagentStillRunning`)

```text
Whether any coworker the TRANSCRIPT joins is still unsettled after
the ledger's word: a subagent-group entry whose receipt resolves to
running — the pre-first-read arm, since wire receipts are all the
page has before the ledger lands — corrected by the ledger row once
read. Transcript-joined rows ONLY, never a bare sweep of the ledger:
a row nothing on the transcript joins can be
one nothing will ever settle — the backend's unreached-start refusal
deliberately leaves its row DISPATCHED (the ambiguous failure may
have actually started the child) and raises, so no receipt reaches
the transcript, and a ledger-wide arm would pin every future view of
the thread to an indefinite poll. The resume case a broad arm once
served is aResumeAwaitsLedgerTruth's job — it joins the same way,
from resume receipts, so it cannot pin on a receiptless row. The
guard this arm keeps: an entry with no receipt at all (a dispatch
call an interruption cut off before its receipt streamed) has no
join key — the key is the receipt's ORDINAL — so its
frozen wire `running` renders as the wire says, and the poll
ignores it.
```

## The settle tap (`ThreadDispatchLedger.refresh`)

```text
The settle tap: a child stream that watched its own
ending asks the ledger to catch up NOW, not at the next tick.
The caller sequences "refresh,
then judge" (the failed-not-interrupted guard), so the promise
resolves once a read whose snapshot POSTDATES the tap has landed —
or once that read's bound fired, in which case
judgment lands on the last good snapshot rather than never landing
at all (the child panel's stream-end verdict may then read
interrupted where the ledger would have said failed; the row
corrects when any read lands — the retired read's own late landing
included, by the adoptedThrough rule). Joining an in-flight read is
not that: the door emits its
terminal only after the row settled, but the flight — likeliest
the arming read the panel's own demand fired at mount — may have
queried before the settle and would hand judgment a stale
dispatched row. So a busy tap chains ONE fresh read behind the
flight (concurrent taps share it; a different thread's tap starts
its own chain).
```

## The flight is the bounded deferred (`_readOnce`)

```text
THE FLIGHT IS THE BOUNDED DEFERRED, NOT THE GET (the delivery
probe's latch premise, adapted): nothing in this transport
aborts or times out a stalled request, and unlike the probe this
read CONSUMES its result — the roster adopts into the cell — so
"never await" cannot transplant. Instead, the flight every joiner
holds (the tick's single-flight skip above, the settle tap's
followUp chain) settles at READ_BOUND_MS even if the GET never
does, and the generation retires a bounded-out read's DUTIES —
its payload is arbitrated by the monotonic adoptedThrough rule at
_read, never allowed to clobber newer state. A hand-settled
deferred rather than a
Promise.race on purpose: _read resolves it from its own finally,
so a landed read's joiners are scheduled one microtask hop sooner
than a race wrapper would schedule them (and one sooner than the
pre-bound chain on the async function's own promise) — the race's
extra hop reorders the tap's catch-up behind the effect-driven
reconcile and costs a third GET per settle; running joiners
early-or-equal keeps the pre-bound interleavings sound. THE ABORT
RULING: a
rejection of any shape — AbortError included — releases busy
immediately through the live finally; busy is a single-flight
gate, never a successor's reservation (the successor is
coordinated by generation, readThreadId, and pendingThreadId).
WHAT BREAKS IF THIS FALLS: handing joiners the bare GET re-opens
the forever-pending followUp chain; letting a dead flight's
finally run frees a busy flag a NEWER read now holds — two flights
at once, the exact stampede busy exists to prevent.
```

## Adoption (`adoptedThrough`)

```text
ADOPTION IS MONOTONIC IN ISSUE ORDER (the store half's
_refreshAdoptedThrough, same rule): the newest generation whose
payload adopted. A retired flight's success ADOPTS when nothing
newer has adopted and the ledger's interest has not moved to
another thread — being past the bound retires a flight's DUTIES
(busy, trip, replay: the bound performed them), never its truth.
The ledger adds the thread-identity term the store does not need
because one session ledger serves switching threads. WHAT BREAKS IF
THIS FALLS, both directions: admitting an OUTRUN payload lets a
wedged read clobber a landed settle back to dispatched and burst
the settle listeners over regressed rows — the clobber the
generation guard exists to prevent; discarding a NON-outrun payload
freezes the cell for the life of the page on an endpoint that
merely answers past the bound — an unbounded GET loop throwing away
good data on every cycle, with the poll kept armed by the very wire
receipts it can never correct.
```

The OUTRUN arm of `_read`, when a payload does not adopt:

```text
OUTRUN — fresher truth already adopted, or the ledger's
interest moved to another thread. Still proof the endpoint
answers, so it clears the trip's memory for its own thread:
an endpoint that is merely slow must not accrue three
bound-out "failures" and stop the poll for the rest of the
page while returning good data on every request. Own thread
only: a switch's stale success must not launder the demanded
thread's genuine streak. WHAT BREAKS IF THIS FALLS: without
the clear, slow-but-working trips _stopTimer and nothing
re-arms it (stillMoving stays true off the frozen wire
receipts, so no demand change ever comes).
```

## The delivery marker's settle tap (`useThreadDispatches`)

```text
The delivery marker's settle tap: a delivery divider proves
its ordinals SETTLED, so a joined ledger row still reading DISPATCHED
is stale by definition — ledger staleness, never the marker's
liveness, is the trigger, which is what keeps replayed history quiet.
Rows arrive over the wire after mount (a fresh load's first
connection is a full replay), so "first render" says nothing about
history — but every ledger read this surface makes happens after
mount too, so it postdates any historical settle and already reads
settled: a divider joining a DISPATCHED row can only mean the row
settled after the last read — a live delivery (or a delivered
ordinal's later resume) — and the ledger catches up now instead of
at the next poll tick. An empty or missing join stays quiet: the
one-shot read the delegation demand fired is already fresher than
the settle, and the wire-receipt fallback keeps the poll armed for
the rare live race where the row has not landed yet.
```
