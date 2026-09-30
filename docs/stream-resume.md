# Stream resume — the arbitration key and the recording rule

**Status: accepted.** The design record behind
`src/transport/stream-resume.ts`; the source keeps only the invariants
at the code. Two blocks live here: the premises behind
`StreamResumeStore.recordResumeAnchor`'s key, and the recording rule
`resumeSnapshotRecorder` enforces. The tests named inside
(`stream-resume.test.ts`) still pin every degradation they describe.

## The resume arbitration key (`StreamResumeStore.recordResumeAnchor`)

The method returns false when a resumption already anchored; the key is run id
plus the payload's own (round, attempt), with a round-less legacy row keyed on
the marker event's stamped timestamp.

THE ARBITRATION KEY: run id plus the payload's own (round, attempt) —
round is on the wire: the assistant turn stamps its loop round and every
other writer is single-shot at round 0, so (runId, round, attempt)
identifies a resumption from wire data alone — attempt resets per round;
round orders what the retired ordinal used to count. A ROUND-LESS row
(pre-rollout) keys on the marker event's own stamped timestamp instead —
wire data too: every stored row gets one at write (run_event_draft_of's
setdefault) and the projection replays stored bytes verbatim, so a
re-delivery re-derives the same key while genuinely distinct legacy
resumptions (separate writes, a retry backoff apart) keep distinct keys
— and with them their retry severance. THE TOLERANCE PREMISE, stated so
it can be falsified: the serving projection round-trips STORED payloads
verbatim (the identity projection, no re-validation through the Pydantic
model), so rows written before the rollout genuinely arrive as {attempt,
segment: null} with NO round key — they are never re-validated into the
model's 0 default server-side. The legacy fallback here is load-bearing,
not defensive. THE RETIRED ORDINAL'S BOUNDED ASSUMPTION: the ordinal
rested on every replay recounting a run's markers from its own
RUN_STARTED, so a terminal row followed by more rows under the same run
id — a shape that synthesizes a second RUN_STARTED — would have
restarted the count mid-run and admitted a duplicate anchor. The wire
key has no count to restart: a re-delivered marker re-derives the same
key from its own payload regardless of replay framing. WHAT DEGRADES,
deliberately (pinned in stream-resume.test.ts): only a round-less marker
with NO timestamp — a shape no writer ever produced — collides on equal
attempt. First-wins, never a crash, never a misplaced anchor; and stated
in full: a suppressed anchor loses its window's retry severance, so the
abandoned calls behind it keep reading in-progress. That full cost is
why round-less rows key on their timestamp rather than collapsing. ONE
STATED RESIDUAL (the successor to the retired ordinal's assumption,
outside this key's scope): a subagent-park timeout leaves a PARKED turn
whose newest request cards name an already-consumed pause — park rounds
write no card — and the approval door's status-only gate lets a stale
re-POST of that consumed answer restart the dead run one past the CARD
round, re-running rounds it already spent under the same log run id.
Equal (round, attempt) then recurs only if both executions' activities
also retried to the same attempt, and first-wins suppresses the extra
anchor — and, as with any suppressed anchor, that window's severance.
The exposure belongs to the restart seam, not this key: message-id
namespacing keys off the same round and shares it, independent of this
key.

## The recording rule (`resumeSnapshotRecorder`)

A pair is recorded at any close that is block-complete, non-failed, and
committed a cursor — terminal or quiet. The block is fenced so its bullet
indentation survives formatting unchanged.

```text
THE RECORDING RULE (the parked quiet close must record, or a
background attach re-seeds an empty transcript): a pair
is recorded at any close that is BLOCK-COMPLETE (every block START
this connection applied has its END), non-failed, and committed a
cursor — terminal or quiet. Block-completeness, not terminality, is
the actual safety condition; the wire cannot even distinguish a
parked quiet close from a between-blocks proxy timeout, so the rule
must be — and is — safe for both. THE PREMISE, both directions:

 - What a snapshot MEANS does not change: a consistent (applied
   messages, newest cursor) pair — never proof the run settled. Its
   readers all hold to that: the replay agent's constructor seeds the
   list, asks past the cursor, and derives the de-dupe id set; the
   store's epoch swap re-seeds the message cell from it; the failure
   telemetry reports its cursor. Nothing infers settlement from its
   presence — a reader that ever does will misread a live pause as
   settled, and must gate on the turn record instead.
 - The cursor may now name a frame inside an unsettled run: safe,
   because the server snaps any echoed cursor DOWN to a run boundary
   and re-delivers the unsettled run IN FULL, and the seeded de-dupe
   set filters exactly the ids the list holds in full — which
   block-completeness guarantees (the parked contract closes open
   blocks before its quiet close, and post-resume content arrives as
   NEW blocks, never as growth under a filtered id). A server that
   ignores the cursor full-replays into the same filter. Full replay
   stays the always-correct fallback.
 - WHAT BREAKS IF THE GATE IS WRONG: recording with an OPEN block
   puts a half-applied id in the de-dupe set, so the boundary
   re-delivery of its remaining content is filtered — permanent
   truncation. That direction is closed by the openBlocks gate (an
   abort or transport death mid-block leaves blocks open and/or
   fails the pipeline — refused). Refusing a close the gate could
   have accepted merely keeps the previous pair: a full replay,
   never data loss.
```
