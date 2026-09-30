# The connection lifecycle

**Status: accepted.** The living design record for the assistant store's
connection driver — `src/core/connection-driver.ts` — and the
connection-adjacent fields of `conversation-store.ts`,
`conversation-refresh.ts` and `conversation-contract.ts`. Each module
keeps a short header per constant and function stating the invariant,
and points at this document for the argument. The text below is grouped
by the decision it records.

## The two bounds

`CONNECTION_ENDED_REFRESH_BOUND_MS`:

The stream-end refresh's bound: how long _connectionEnded may hold the
connect gate waiting for REST's verdict on a closed stream. This
transport attaches no AbortSignal or timeout to any REST call, so an
accepted-then-stalled GET never settles — the bound, not the GET, is
what guarantees the gate's release. Equal to the delivery-claim window
(DELIVERY_CLAIM_PROBES × DELIVERY_CLAIM_PROBE_MS) on purpose: 8s is
already this package's outer patience for REST truth after a
stream-adjacent event, and a GET slower than that is indistinguishable
from wedged for gating purposes. Its own constant (the
STOP_SETTLE_PROBES convention): retunable without silently changing how
long a stop or claim probe waits.

`MAX_AUTOMATIC_RECONNECTS`:

The hard bound on store-initiated reconnects: a stop condition is not a
bound, and an unattended reconnect loop on a public embed is the one
failure mode this feature must not have. Consecutive automatic
reconnects that show no progress (no status movement between
connections) stop here and surface stream-trouble; a human retry, a
mount, or a new turn resets the count.

## The connection truth table

`turnHoldsAStream`, `_connectWanted` and `syncConnection`:

```text
The connection truth table (the store is the ONLY driver). Surfaces
mounted:
  any turn state → connect ONCE per epoch (full replay paints the
  history, then the live tail); a stream that dies under a live turn
  reconnects on a fresh epoch under the automatic budget.
No surfaces:
  queued | working            → the store connects (bounded budget)
  awaiting_input | parked     → NO socket; the epoch stays armed
                                (inboxes, driver, activity) and the
                                human's POST begins the next epoch
  succeeded | failed | superseded → idle, nothing to stream
"Parked is live" governs the presence/driver/activity lifetime, never
the socket: a turn parked for an hour must not hold an SSE for an
hour — and the pause's stream is closed by the SERVER (the parked
contract's quiet close), so an unmounting surface leaks nothing.
```

## Connect once per epoch, and the background-attach remint

`_remintForBackgroundAttach`:

A wanted connect on a USED epoch (a re-read landed a queued/working
newest turn — a background-initiated delivery turn — after this epoch's
stream closed at a park or settle). "Connect ONCE per epoch" is a safety
law about the AGENT, not style: the agent freezes its resume cursor and
de-dupe id set at construction, and a parked quiet close records no
snapshot, so a second connectAgent() would re-deliver content the agent
already applied, past the seeded filter (duplicated tool calls — the
replay agent's own warning). So remint: the background nonce bump
changes the epoch signature, this publish's syncEpoch builds a fresh
agent seeded from the CARRIED resume store, and the rescheduled sync
connects it once — the same conversation (ledger, resume, approval inbox
all ride through), a fresh connection epoch. Bounded by the untouched
MAX_AUTOMATIC_RECONNECTS bail above. The existing reconnect paths do not
land here themselves — a live connection bails on _connectionRunning, a
parked leased page on !_connectWanted(), and _connectionEnded's death
arm bumps the reconnect nonce before its publish — but they CAN race a
background attach (the workflow-restart reclaim's retryStream retiring
an attach's epoch mid-connection); the mooted close's finally
reschedules the connect decision for the epoch that won. GAP-PROBE
PREMISE #3 holds: _epochConnectedOnce is still written true only by
syncConnection's real connect attempt above, and this path resets it
through the ordinary new-epoch arm — paused epochs now attach MORE
often, which only SHORTENS the probe's quiet holds (the direction its
premise explicitly blesses).

THE NO-REMOUNT PREMISE (binding: a background attach performs no full
remount): this is the BACKGROUND nonce, not _reconnectNonce, because
conversation-view keys <Transcript> by thread.id#reconnectNonce and a
spontaneous attach must not remount the subtree the visitor may be
reading or working in. (The composer's draft and staged attachments live
on this store's _composerInput cell, above the key, so no nonce bump can
destroy input.) The premise holds on UI grounds: a remount resets the
subtree's UI state — scroll follow, drill-ins, disclosures, caret — and
repaints every row, and a spontaneous machine event has no business
doing any of that. Why a NON-remounting fresh epoch is still safe
against the frozen cursor/de-dupe law: the law is the agent's, and the
remint builds a fresh agent either way; connection correctness cannot
depend on the remount at all, because headless stores connect with no
mounted tree whatsoever (the truth table's no-surfaces arms). The keyed
subtree's own state is epoch-independent by the delegation surface's
recorded defenses (drill-ins are visit-stamped; every cell re-seeds
synchronously on the epoch swap). WHAT BREAKS IF THIS FALLS:
keyed-subtree state that DID encode the old epoch would render stale
until the replay repaints — bounded, self-correcting staleness; falling
the other way (bumping _reconnectNonce here) needlessly flashes the
whole transcript and drops the visitor's place over a machine event they
never see.

What the user-initiated routes into a new working turn reset and
this branch deliberately does not (vs retryStream / sendMessage /
openThread / _adoptThreadDetail): _streamInterrupted is the one
member that belongs here too — a PREVIOUS turn's stream death
leaves it set (the park merely hides the banner, busyOf() being
false), and without the clear the banner would resurface over the
healthy stream this attach just opened; a genuinely failing new
connection re-raises it through the ordinary handlers. The rest
stay: _automaticReconnects is this loop's own bound under an
unchanged turn id (noteNewestTurn zeroes it when a NEW turn adopts
— zeroing it here would unbound the remint loop); _sendError
narrates a failure the visitor hasn't acted on, and no machine may
clear it; _stopping, _pendingSend, _pendingEcho and
_composerRefocusPending belong to the send/stop lifecycles (the
death arm's caret return rides its own take-flag,
_composerCaretReturnPending) — this branch never remounts, so
there is no dropped caret to restore.

The store field the remint bumps, `_backgroundAttachNonce`, feeds the epoch
signature but never the `ConversationSnapshot`, so the Transcript key
(`thread.id#reconnectNonce`) holds still while the store attaches to a
background-initiated turn.

## The stream-end verdict

`_connectionEnded` holds the connect gate through the refresh:

Held through the refresh so the publishes it causes cannot race a second
connect — but BOUNDED BY THE TIMER, NEVER THE GET (the gap probe's
premise, adapted): this transport layer attaches no AbortSignal or
timeout to any REST call, so a thread GET that is accepted and then
stalls never settles — a release gated on the GET alone latches
_connectionRunning, the connect gate bails on it forever, and the page
can never reconnect or attach again. Unlike the delivery probe, this
site CONSUMES the refresh (the death/attach discriminator below reads
the refreshed newest turn), so "never await" cannot transplant — the
adapted law is "the flag's release must not depend on a network promise
settling". THE ABORT RULING: a settled rejection of any shape —
AbortError included — releases the gate IMMEDIATELY through this same
finally (refreshConversation's catch makes rejection a resolution); the
flag is a single-flight gate, never a successor's reservation —
successor coordination is the epoch moot check, and this transport owns
no aborter that could hand the flag over. WHAT BREAKS IF THIS FALLS:
awaiting the bare refresh re-opens the permanent latch; holding the gate
for a successor that can never be minted is the latch itself.

The `finally` arm, after releasing `_connectionRunning`:

A mooted decision (retryStream — the workflow-restart reclaim —
racing a background attach retires this epoch while
_connectionRunning makes the fresh epoch's own sync bail) still
owes that fresh epoch its connect decision, and nothing else
re-triggers it: the idle re-read is disarmed while the turn
holds a stream. Reschedule; the microtask re-reads everything
live, and scheduleConnectionSync is disposal-guarded.

`_judgeBoundedOut`:

BOUNDED OUT: the refresh never settled inside the bound, so _newestTurn
is whatever the dying stream left behind — the death/attach
discriminator below must not judge on truth REST never confirmed. Charge
the automatic budget and reschedule: the resync re-derives everything
live (a stale working turn re-attempts the stream through the budgeted
remint — the SSE replay is its own fresh truth and repaints every cell;
a stale parked/settled turn wants nothing and the resync no-ops), and a
later-landing GET re-decides again through adoptRefreshedDetail's own
publish — or is barred by the monotonic-adoption guard if fresher truth
already landed. WHAT BREAKS IF THIS FALLS: skipping the budget charge
unbounds a remint loop on wedged-REST-plus-dying-SSE (the discriminator
that normally counts is skipped here — and an unattended reconnect loop
on a public embed is the one failure mode MAX_AUTOMATIC_RECONNECTS
exists to prevent); running the arms below instead would
reconnect-or-remount on stale truth.

Its exhaustion arm:

EXHAUSTION MUST BE LOUD HERE TOO (the arm does not "go quiet without the
banner"): with the turn stale-working, the idle re-read is disarmed and
noteNewestTurn can never see a new id while REST stays wedged, so of the
budget's resets only retryStream is in-page — and retryStream is
reachable ONLY through this banner. Returning quietly here is a
permanent silent dead end, the exact reload-only failure this bound
exists to remove. WHAT BREAKS IF THIS FALLS: skipping the trip strands
the page with no Retry affordance; tripping before exhaustion would
flash stream-trouble over a page the budgeted resync is still
recovering.

`_judgeStreamEnd`, when the newest turn's id differs from the tailed one:

THE ATTACH/DEATH DISCRIMINATOR: a newest turn whose id differs from the
one this connection was tailing is an ATTACH — a background-initiated
turn landed in the close window — not a death, so it must ride the
background nonce (the publish below re-enters syncConnection's remint
branch: used epoch → fresh agent, remount key untouched, stale
interruption flag cleared) instead of the reconnect bump, which remounts
the keyed transcript — dropping the visitor's scroll place, drill-ins,
and caret over a machine event. (The draft lives on the store's
_composerInput cell and survives any remount — the
no-spontaneous-remount ruling stands on the UI grounds alone.) WHY THE
ID IS THE RIGHT DISCRIMINATOR, both directions: an attach with an
UNCHANGED id cannot exist — turn ids are immutable row identities, so a
same-id queued/working newest turn IS the watched turn, which is
precisely the died-under-us case; a death with a CHANGED id cannot exist
either — if a different turn is newest, the watched turn's run reached
its own end (settled, parked, superseded) and the close is that end, not
a failure needing remount recovery. If some pathological close still
lands here, the cost is bounded: the epoch remints and the fresh replay
repaints every cell — only the React remount is skipped. The reconnect
budget needs no touch on this arm: noteNewestTurn zeroed it when the new
id adopted in the refresh above, and a connection that then dies under
the NEW turn re-enters through the same-id death arm below, which still
counts it.

`_reconnectAfterDeath`, the `_reconnectNonce` bump:

THE DEATH ARM'S REMOUNT IS DELIBERATE — AND IT DOES NOT GOVERN THE
DRAFT. This bump moves the Transcript remount key (conversation-view
keys by thread.id#reconnectNonce), which is what resets the keyed
subtree's UI state — scroll follow, drill-ins, disclosures (the
delegation surface records this remount as its host-level enforcement) —
and begins a fresh epoch through the signature, the connect-once law's
fresh agent. What it must NEVER do is destroy unsaved input: the
composer's draft and staged attachments live in THIS STORE (the
_composerInput cell), published through the ComposerContract above the
key, so no remount — this one, retryStream's, a workflow restart's, or a
landed send's — can eat them. Draft lifetime is ruled explicitly instead
of riding the nonce: consumed by the send, dropped on a thread switch
(_finishAdoption) or abandon (_abandonConversation), and NO reconnect
path — this arm, the bounded-out arm, the attach arm, retryStream,
handleWorkflowRestarted — may clear it. Residue, classified:
elicitation/approval cards keep per-card local drafts. They are
unreachable from here on REST-confirmed truth — an actionable card
implies an awaiting_input/parked turn, which fails turnHoldsAStream
above — and reachable only in the one-status-write lag where REST still
reads `working` after the stream delivered the interrupt; that
seconds-old-input window is accepted, not fixed.

The caret return armed beside that bump:

THE CARET (both facets): this remount tears down a focused textarea
without a blur (element removal fires none — the premise
_composerFocusOwned rests on), so hand the caret back AT THE
REMOUNT, not at settle — the turn is still live and the box stays
enabled (shelf-stays-live), and a settle-gated restore would swallow
every keystroke into <body> for the rest of the answer (facet i).
And ONLY when the composer demonstrably owned focus before the
death: `body` is also the resting state of a visitor who never
touched the composer, and a spontaneous machine event must not claim
their focus or scroll an embedded widget into view (facet ii — the
attach arm's own no-spontaneous-reset reasoning, pointed at focus).
_composerRefocusPending stays a send/stop-lifecycle flag and is NOT
set here. ORDERING (load-bearing): this read happens synchronously
BEFORE the publishStore() below, whose remount unmounts the record's
owner — so the owner's unmount cleanup (which invalidates the
record) lands strictly after this arming decision. Caret OFFSET
inside the restored draft is accepted residue.

## The gap gate's evidence: GAP-PROBE PREMISE #3

`conversation-store.ts`, the `_gapGate` field — how the store wires the
shared `PendingDecisionGapGate` (whose transition table lives in
`decision-anchors.md`):

```text
The quiet→loud grace lives in the shared PendingDecisionGapGate (its
docblock enumerates every transition; the timer alone bounds the
alert — "refreshConversation always resolves" is false, since this
transport attaches no AbortSignal or timeout, so nothing
network-shaped may gate it). This store's wiring of the three deps:
 · publish — writes _pendingDecisionGap; judge-driven transitions
   fire inside publishStore, whose snapshot build (in
   conversation-publish.ts) reads the field;
   timer-driven ones fire outside it and trigger their own publish.
 · probe — one best-effort refreshConversation per signature, a
   chance to close the gap early through REST hydration, never a
   gate.
 · evidenceSettled — GAP-PROBE PREMISE #3 (named, checkable):
   `_epochConnectedOnce` is the store's own record that THIS epoch
   started at least one stream attempt — the execution-family
   evidence channel has had its chance (an execution-only pause
   legitimately holds ids with no approval cards, and ONLY the
   replay can rebuild its entries; a headless store on a paused turn
   opens no socket under today's connect table, so its inbox
   emptiness proves nothing). The gate READS the flag and never
   drives it; the connect gate is the driver's. WHAT BREAKS IF THIS
   PREMISE FALLS: flag true without a real attempt → a false
   execution-family alarm after one settle window (bounded and
   self-clearing); flag never true despite attempts → the alert
   holds quiet while the gate's heartbeat keeps re-judging, and
   lands within one window of the first true flag. Deliberately the
   ATTEMPT record, not bytes-seen: an accepted-then-hung socket must
   not be able to hold a genuine approval-family alert hostage.
```

## REST truth ordering

`conversation-store.ts`, `_refreshTicket` / `_refreshAdoptedThrough`:

Refresh adoption is monotonic in issue order (the _resumeRequest
posture): with no AbortSignal or timeout anywhere in this transport, a
stalled thread GET can land MINUTES late — and adoptRefreshedDetail
would regress _newestTurn (and every status carrier riding it) to that
old snapshot. A response adopts only if no later-issued refresh adopted
first. WHAT BREAKS IF THIS FALLS: dropping the guard lets a wedged read
clobber a live delivery turn back to parked; guarding the other way —
discarding whenever any newer request is merely IN FLIGHT — throws away
the only landed truth when the newer request itself stalls. Scope: this
orders the refreshConversation family only; the direct
getAssistantThread adopters (openThread, the quiet-close handler, the
send path) are pre-existing ordering races outside this guard. The
dispatch ledger answers the same late-landing question with the same
rule (ThreadDispatchLedger.adoptedThrough) — a payload outlives its
flight's retirement and is arbitrated by issue order, never discarded
outright.

`conversation-refresh.ts`, `_probeForDeliveryClaim`:

THE LATCH'S CLOCK IS THE BEAT TIMER ALONE (the gap probe's premise
#2 named the hazard first): nothing in this transport aborts a
stalled request, so a probe that AWAITED its reads could hang
forever on one accepted-then-stalled GET — _deliveryProbeRunning
would latch, every later settle would only re-arm a dead burst,
and the relay would be silently retired for the life of the store.
The reads are fired single-flight and never awaited; the loop's
lifetime is DELIVERY_CLAIM_PROBES beats, whatever the network
does. WHAT BREAKS IF THIS FALLS: awaiting any network promise here
re-opens the permanent latch; firing without the single-flight
guard would stack up to nine concurrent identical GETs behind one
slow read for no information gain.

## What the composer keeps across remounts and switches

`conversation-store.ts`, `_composerFocusOwned`:

WHICH SURFACE's composer textarea owns the keyboard (null: none) — a
surface token, not a boolean: every keyed transcript on this store
remounts on one nonce bump, so the owed caret return must name its owner
or a bystander surface's fresh composer consumes it first (tree order)
and the caret lands in — or is lost to — the wrong box. HOW THE RECORD
STAYS TRUE TO THE DOM, exhaustively over the ways the caret can leave
the box: (1) focus MOVES elsewhere — blur fires and clears it; (2) the
ELEMENT GOES AWAY (a remount, the thread-switch skeleton swap, a palette
close, a surface teardown) — no blur fires (DOM spec), and the owning
composer instance clears it in its unmount cleanup instead; (3) the
element does NOT go away but React's dev-time StrictMode fires that same
cleanup on a simulated unmount — the cleanup therefore checks the DOM
(is the caret still in this box?) before clearing, so a replayed cleanup
over a mounted, focused textarea is a no-op. The one deliberate ordering
exception is the death arm's own remount: the arm reads this record
synchronously BEFORE the publish that unmounts the owner, so the owed
return is already armed when the cleanup lands, and the fresh instance's
focus() re-records the owner through the ordinary event path.
Event-plane bookkeeping, never published: no render reads it.

`conversation-contract.ts`, `ComposerContract.composerInput`:

The unsaved draft: the message text and staged attachments the visitor
has typed but not sent. Lives in the STORE, not in the composer: the
composer remounts with the keyed transcript whenever _reconnectNonce
moves (a send, a retry, a stream death under the same turn), and unsaved
input must never die with an instance. Its lifetime is ruled explicitly
— consumed by the send (the composer's optimistic clear), dropped on a
thread switch or abandon (beside the modelPick resets), and NOTHING
else; the death arm in _connectionEnded records why no reconnect path
may touch it. Published on its OWN cell rather than on this snapshot:
this contract is the context value the whole surface and transcript
subtree read, so a per-keystroke snapshot would rebuild the full
message-list tree per character. Only the composer subscribes to the
cell — typing re-renders the composer alone.

`ComposerContract.noteComposerFocus` / `takeComposerCaretReturn`:

Focus bookkeeping for involuntary remounts: the composer reports which
SURFACE's textarea holds the caret (null on blur); the death arm arms a
one-shot caret return stamped with that owner, and the fresh instance
whose surface matches take-consumes it at mount — handed back at the
remount, not at settle, because the box stays enabled over a live turn.
A bystander surface's take returns false and leaves the return armed.
The premises live at the store fields and the death arm.

`ComposerInput.scope`:

The conversation this input belongs to, as an opaque scope token.
Thread-backed conversations use their immutable server id under the
"t:" prefix; conversation-less states each get a MINTED token under
the disjoint "u:" prefix ("no conversation" is a STATE, not an
identity — a null compared equal across an abandon, so a first send
refused after New conversation restored the abandoned attempt into
the fresh composer; every reset to the conversation-less state now
mints a new token). The prefixes make collision impossible by
construction, whatever shape server ids take. INVARIANT: every
write of _active (adoption, abandon, landed send) re-scopes this
field, so it always names the live conversation-context. The
send-refusal restore compares against it: refused text may only
return to the conversation it was typed in — including after an
A→B→A round trip, where the thread's own immutable id compares
equal on purpose (the ruled semantics: the text was in flight, not
a draft, when the switches cleared it).
