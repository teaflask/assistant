# Replay-stable metadata — duration, usage, subagent, provenance

**Status: accepted.** This is the decision record for the transcript's
replay-stable metadata contract. The wire half is normative in the
serving contract (the per-event `timestamp` subsection, the
`turn_usage_recorded` and `memory_updated` rows of the event vocabulary,
and the dispatch `summary` field) and `serving-openapi.json`; this
document records the decisions and the laws the visuals (fold duration,
subagent rows, usage, provenance) implement against. It extends and never
contradicts `presentation-architecture.md`: additive optional fields,
absent-never-null, open string vocabularies, durable-ID joins.

## The one rule everything here serves

**No client-side estimate is ever presented as fact.** If the runtime
does not know it, the contract does not carry it, and the UI hides it.
Every mechanism below exists to make "the runtime knows it" replay-stable:
live delivery, reconnect, and full replay must converge on the same value.

## Run and segment timing

### The mechanism (the pinned answer)

**Option 1 — per-event server timestamps.** The evidence is stamped at
the single persistence choke point (nothing else reaches the wire: the
row's `created_at` is write-only, and `ag_ui.core.BaseEvent.timestamp` is
never assigned, so `exclude_none` strips it): `run_event_draft_of` (the
serving side's run-events module) stamps `payload["timestamp"]` (epoch
**milliseconds**) via `setdefault` on every stored event — protocol
events and CUSTOM markers alike.

Replay stability is **by construction**, not by discipline: the value
lives inside the stored payload, live tail / reconnect / full replay all
serialize the identical stored row through the one `sse_frames_of` path,
and the transcript reconciliation's repair re-appends survivor payloads
verbatim (new row id, new `created_at`, same embedded `timestamp`).
Pinned by contract tests:
the serving side's run-events tests (the stamp, producer-set wins, survivor
repair) and its run-stream tests (byte-identical across attaches; synthesized
frames carry none; the re-framed terminal keeps the stored instant).

### Which instant the timestamp captures

The recorded instant is **draft time — the moment the event is converted
to its stored shape**. For coalesced stream deltas that is the flush of
the coalescing log (`FLUSH_INTERVAL_MS = 250`), so granularity is bounded
by ~250ms; for markers and terminal rows it is their emit. `setdefault`
means a future producer that stamps the event object itself (a
finer-grained emit-side clock) wins without a contract change. The wire
does not distinguish queue/create/start/settle **per event** — one event
is one instant — but block boundaries (START/END/RESULT events) give a
consumer start-vs-settle per block, which is the evidence the fold
reduction needs. This bound is acceptable because fold durations are
seconds-to-minutes; nothing in the contract claims sub-flush precision.

### What never carries a timestamp

- The per-attach synthesized `RUN_STARTED` (it would differ per attach).
- The stream-time synthesized frames: the crash-repair closers, and the
  READ-TIME fallback terminals `agent_run_stream` synthesizes for a run
  with no stored terminal. (The DURABLE fallback terminals the
  stranded-turn sweep and the orchestration-unreachable door WRITE are
  stored rows and do carry one — the sweep/door's write instant, not the
  run's. Terminals are not block boundaries, so neither case enters a
  fold reduction.)
- Every event of a history recorded before timestamps shipped.

To a consumer, **absent means unknown** — never zero, and never a value
to substitute a local clock for.

### The fold reduction

An OPEN turn renders as prose → run fold → prose → run fold, each
per-cluster fold with its own duration; a COMPLETED turn unifies each
uninterrupted work span into one episode fold around the span's last
prose run (that run stays outside; work past it is a trailing cut-off
fold). In every grouping, **each fold's duration reduces over its own
member blocks** — an episode spans its narration gaps because the
reduction runs min-start to max-settle across all its work members —
so turn-level evidence cannot produce it. The contract's reduction,
implemented once in
`src/core/segment-timing.ts`:

- A fold's **settled duration** = earliest observed timestamp to latest
  observed timestamp across its **member blocks**
  (`settledFoldDurationOf`). Members join by durable block id
  (`messageId` / `toolCallId`), never adjacency; the anchors map
  (`core/block-timing-anchors.ts`, held on the resume store like every
  marker anchor) records min-start/max-settle per block from
  block-boundary events.
- A fold's **active elapsed** is rendered nowhere: the activity shelf has
  no status line and no live figure (`activity-shelf-slot-contract.md`
  §7) — the settled "Worked for …" headline is the one duration story.
  The clock-domain law stands for any future consumer: never a
  subtraction across the two clock domains. `activeFoldElapsedOf`
  (persisted server start → the caller's "now") remains exported for
  callers whose `nowMs` is server-derived or whose surface accepts the
  skew — its docstring carries the caution — but passing a client
  `Date.now()` renders the device's clock offset as work time, and no
  in-package surface does so.

### Unknown vs sub-second (the typed law)

`SegmentDuration = { kind: "unknown" } | { kind: "measured"; durationMs }`.

- **unknown**: no timestamped member — the UI hides the duration.
- **measured with durationMs < 1000**: a real sub-second span — renders
  as "<1s", never "Worked for 0s", and never hides.

A coalesced batch stamped with one instant reduces to **measured zero**,
not unknown — pinned in `tests/segment-timing.test.ts`.
The two states cannot collapse because they are different type branches,
not two meanings of one nullable number.

### Turn-level total

Nothing new: `ServingAssistantTurnResponse.created_at` (queue) and
`updated_at` (settle time on a terminal turn — the settle flip is the
last write a terminal turn takes) are already on the wire. A consumer
wanting one number per turn reads that pair, or reduces across the
turn's folds.

## Usage and thinking status

One CUSTOM marker, **`turn_usage_recorded`**, exactly one per settled
turn that had usage rows to sum, landed **inside the guarded settle flip,
immediately before the run's terminal row** — so replay always reaches it
(the run-scoped replay stops at the terminal) and an at-least-once settle
retry cannot duplicate it (the flip is the fence). Payload:
`turn_id` (the durable join), `finality`, and five integer counts
(`input_tokens`, `output_tokens`, `cache_read_tokens`,
`cache_write_tokens`, `total_tokens` — the total computed server-side).

- **Finality is an open vocabulary.** `"final"` is the only value
  produced today and the only one that reads as settled truth;
  `"partial"` is reserved for live usage (a later additive step) and
  every unknown token reads as not-final. The client merge
  (`core/turn-usage-anchors.ts`) reconciles by `turn_id` and never
  demotes a final entry.
- **Absence means unknown, never zero.** No marker is emitted for
  non-playground-surface turns (the gate above), turns with no usage
  rows, door-stopped turns (the worker may still be flushing — an
  undercount must not wear "final"), a stop whose unwind outlived its
  bound (the workflow abandons the activity mid-flight and flags the
  settle to skip the marker, the same undercount law), a failed or
  unfunded settle whose final attempt Temporal declared dead server-side
  (a heartbeat/start-to-close timeout — the abandoned attempt may still
  be writing; only an in-process unwind may wear "final"), sweep-settled
  turns, and all history recorded before the marker shipped. The UI hides
  the number cleanly. The termination walk below is the complete per-path
  enumeration this list summarizes — the two must not drift.
- **Scope is the turn's own model calls.** Subagent usage rides
  unattributed rows (`assistant_turn_id` null); a family rollup is a
  reserved additive step (the balance-deduction family walk is the
  precedent).
- **The surface gate (decision, not default).** The marker is written
  only for turns whose every billing atom was stamped
  `served_surface = "playground"` — the operator's own testing surface.
  SERVING-surface turns (the embedded widget, the dashboard concierge —
  every thread `ServedSurface` classifies as serving) emit **no usage
  marker at all**, fail-closed on NULL/BACKGROUND/mixed stamps. The
  reasoning, recorded as a decision:
  - **The `model_id` precedent applies.** This ADR withholds `model_id`
    from the serving wire because which model the org runs is the org's
    fact. `input_tokens` is the same class of fact — a direct proxy for
    the size of the org's system prompt plus injected context, an
    operational detail of how that customer configured their copilot.
    That the model_id test was not applied to token counts in this ADR's
    first draft was an **oversight, not a decision that the counts passed
    it**.
  - **The trust context is the load-bearing distinction.** The widget is
    embedded on a customer's own site and its reader is an anonymous
    visitor to _their_ product: a competitor can open it with zero
    friction and, over a handful of turns, profile how much context the
    org injects and when the prompt changed. A first-party agent UI whose
    reader IS the operator paying for the tokens is the same number in a
    completely different trust context. An anonymous visitor has no use
    for a token count and is not paying for it.
  - **A consumer that renders on both surfaces does not settle this**:
    consuming usage on the dashboard satisfies it. The dashboard's counts
    ride `ConversationTurnResponse` (per-turn input/output/cache tokens,
    operator-only) regardless of this marker, and playground transcripts
    carry the marker.
  - **Asymmetry decides the default.** The presentation architecture
    promises additive-only — no destructive removal of serving/v1 fields.
    Shipping the counts on the public wire now and un-shipping them later
    would break that promise; gating now and relaxing later is additive
    and cheap. When one direction is reversible and the other is not,
    take the reversible one. (The gate is deliberately broader than the
    minimum — the member-owned dashboard concierge is never
    visitor-readable yet is classified SERVING and so skips the marker
    too; relaxing that specific case later is the cheap, additive
    direction.) The gate sits at the PRODUCER
    (`_turn_usage_event_or_none` reads the billing atoms' own recorded
    `served_surface`), so a gated turn's log simply never contains the
    marker on any wire — no fetch-path filter, no sanitizer,
    replay-stable by construction.
- **Bounded by construction**: one marker per settled turn — no per-token
  or per-delta events.
- Why not ag-ui's `RunFinishedEvent.usage`: the shipped TS `@ag-ui/core`
  schema has no such field — it would arrive as an untyped passthrough
  extra. A typed CUSTOM marker rides the generated serving contract like
  every teaflask marker.
- No money fields: spend is a dashboard fact
  (`ConversationTurnResponse`), not a transcript fact.
- Live usage is **absent by design today** (strands discards streaming
  usage deltas; the finest honest granularity is one flush per completed
  model call). The finality field is the seam live usage ships through
  later, additively.

### The termination walk — every way a turn ends, and what may wear "final"

The complete enumeration of turn-termination paths, walked from the
workflow and door code rather than asserted. The rule it instantiates:
a `finality: "final"` sum requires **positive, first-person evidence
that the invocation finished writing its billing atoms**. The evidence
classes are: a RETURNED RECEIPT, a CLEANLY UNWOUND application failure,
a COMPLETED CANCELLATION, a SERVER-SIDE DECLARATION Temporal made
without the worker's cooperation, or NOTHING AT ALL. The last two
classes always skip. (The surface gate above applies on top of every
"emit" row: a non-playground turn emits nothing regardless.)

| Termination path                                                                                                                                                                       | Evidence class the workflow has                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Marker                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Normal completion (`_run_agent_loop` returns off a COMPLETED receipt → `settle_turn_succeeded`)                                                                                        | Returned receipt — the activity result arrives only after the event-log drain and the usage hook's final flush in the same process                                                                                                                                                                                                                                                                                                                                                                                                                                          | Emit                                                                                                       |
| Application failure (`except ActivityError`, final attempt's cause is `ApplicationError`: readable failures, contract faults, content refusals, turn-limit, workspace-lost)            | Cleanly unwound application failure — the worker raised past its own flush before reporting                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Emit                                                                                                       |
| Activity timeout, heartbeat or start-to-close, retries exhausted (same arm, cause is `TimeoutError`)                                                                                   | Server-side declaration — the abandoned attempt may still be committing rows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Skip (`_the_worker_unwound_the_failure` → `invocation_settled=False`)                                      |
| Any unrecognized failure cause on that arm                                                                                                                                             | Unclassifiable — treated as nothing at all                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Skip (the classifier is fail-closed)                                                                       |
| In-run funding failure (`settle_turn_unfunded` off the same `except ActivityError` arm)                                                                                                | Same classifier as the failed path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Emit iff cleanly unwound; skip on declaration                                                              |
| Pre-run funding-gate refusal or gate-activity failure (`_the_gate_allows` → unfunded/failed before any run activity starts)                                                            | Nothing ran — no invocation existed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Emit-if-rows (the default flag; a rowless turn yields no marker anyway, and no attempt can be outstanding) |
| Stop, mid-segment (`TRY_CANCEL`: the handle resolves in the cancel's own activation and the settle runs while the segment's rows are still self-delivering — `segment_cancelled=True`) | Rows landed so far — the settle runs while the cancelled segment is still alive and self-delivering its own rows; the marker sums what has landed and wears finality `stopped` (nothing landed yet → no marker: absence means unknown)                                                                                                                                                                                                                                                                                                                                      | Emit                                                                                                       |
| Retry re-entry (an attempt failed, a later attempt runs)                                                                                                                               | Only the FINAL attempt's cause is visible: Temporal collapses retries into one `ActivityError` with no per-attempt history. **Unclassifiable residual, stated rather than assumed:** an early timed-out attempt's partitioned-but-alive zombie behind a later clean unwind is invisible to the workflow — it requires a zombie that outlives the entire retried attempt that succeeded it, and no workflow-visible evidence can narrow it further                                                                                                                           | Emit iff the final attempt's evidence says emit (the documented blind spot)                                |
| Continue-as-new re-entry                                                                                                                                                               | **Cannot occur for the turn.** `AssistantTurnWorkflow` never calls `workflow.continue_as_new`, and the design forbids the need: one turn is one short-lived workflow — a follow-up or resume starts a BRAND NEW workflow against the persisted session precisely so per-turn history stays bounded (the module-header law). The per-thread `ConversationWorkflow` entity CANs BY DESIGN, but the entity schedules turns and carries no usage evidence, no settles, and no markers: every row in this table stays the turn workflow's, applied afresh per entity-opened turn | n/a                                                                                                        |
| Workflow-worker crash / workflow replay                                                                                                                                                | The workflow itself replays; settles are at-least-once activities riding the guarded status flip, so the marker is exactly-once per turn by the flip's fence                                                                                                                                                                                                                                                                                                                                                                                                                | Same decision as the path being replayed                                                                   |
| Workflow cancelled/terminated, or an uncaught workflow error                                                                                                                           | No settle runs; the turn strands at a workflow-owned status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | No marker (the sweep settles it — below)                                                                   |
| Turn parks (approval window, or the subagent wait's returned continuation)                                                                                                             | Non-terminal — no settle, no marker; the turn later terminates via one of: the entity-opened resume (a NEW workflow → every row above applies afresh), supersede/void by a new message (`turn_voided` receipts, no usage path), the entity's stop settle, or the sweep                                                                                                                                                                                                                                                                                                      | n/a at park time                                                                                           |
| The entity's stop settle (`ConversationActivities.settle_the_stopped_turn`; parked or workflow-gone turns)                                                                             | Nothing — the settler cannot know whether a worker is still flushing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Skip (never passes a `usage_event`)                                                                        |
| Stranded-turn sweep (`sweep_assistant_turns`)                                                                                                                                          | Nothing — the workflow is gone or wedged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Skip (never passes a `usage_event`)                                                                        |
| Orchestration-unreachable door (`settle_turn_orchestration_unreachable`)                                                                                                               | Nothing — Temporal itself was unreachable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Skip (never passes a `usage_event`)                                                                        |
| Empty delivery turn (`settle_delivery_turn_empty` → superseded pre-flight)                                                                                                             | Nothing ran — the pre-flight settles before any model call; `settle_turn_superseded` has no usage parameter at all                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Skip                                                                                                       |

The walk that produced this table found **no leg emitting on insufficient
evidence** beyond the two already fixed (the timeout-declared failure,
and the mid-segment stop — a settle that runs beside the live segment and
stamps `stopped`, never `final`); the retry-re-entry residual is the one
path the workflow cannot classify from what it can observe, and it is
stated here as such rather than assumed benign.

## Subagent presentation metadata

The read model stays
`GET /serving/v1/assistant-threads/{thread_id}/dispatches` (polled,
bounded, no child streams) plus the in-stream dispatch receipts. One
field, and the derivations:

- **`summary: str | null`** (serving and dashboard twins): a bounded
  excerpt of the child's ACTUAL recorded report, stamped into the settle
  receipt by the run-subagent activity (a single-string report document
  unwraps to its string; any other shape rides as compact JSON — honest
  structure, never manufactured prose), whitespace-collapsed and clipped
  like the label (200 chars). Deliberately NOT the receipt's `note` —
  that is the mailbox's canned model-facing sentence and would put the
  same boilerplate on every succeeded row. Present exactly on succeeded
  rows; null while running, on failure (the `error` sentence is that
  read), and on rows settled before the excerpt existed. Safe because the
  same end user already reads the child's **full transcript** through the
  drill-in door — a clipped report excerpt is no new exposure class. This
  deliberately revises the earlier "receipts/status only" projection
  sentence; the revision is recorded in the response docstring and pinned
  by a contract-parity test.
- **`model_id` and effort stay OFF the serving wire.** The recorded
  decision stands: which model the org runs is the org's fact. The
  dashboard (org members) already exposes `model_id`
  (`AgentDispatchResponse`, derived from the child's newest immutable
  usage row). Effort is not durable per dispatch anywhere — the contract
  does not carry what the runtime does not know. **This is why an
  acceptance-criterion reader will not find model/effort on the widget
  wire**: "when it is safe and meaningful" resolves to dashboard-yes,
  serving-no.
- **Status derivation table (normative):**

  | Presented state       | Evidence                                                                                                 |
  | --------------------- | -------------------------------------------------------------------------------------------------------- |
  | running               | ledger `status = "dispatched"`                                                                           |
  | completed             | ledger `status = "succeeded"` (receipt present by CHECK)                                                 |
  | failed                | ledger `status = "failed"` (`error` present by CHECK)                                                    |
  | cancelled/interrupted | a **wire fact**: the dispatch tool call's cancelled receipt, joined by `ordinal` — never a ledger status |
  | waiting/parked        | not distinctly evidenced today; a parked child reads as running (honest: the ledger cannot tell)         |

- **started/settled**: `created_at` / `updated_at` (settle time on a
  settled row) — the existing roster law: settled rows show pure server
  math; only a genuinely live interval ticks.
- **Current operation** stays drill-in-only: populating it in the roster
  would mean opening child streams, which this contract forbids; the
  child stream's own `tool_call_annotated` markers feed the presenter's
  `currentWorkLabel` slot when the (budgeted, capacity-1) drill-in is
  open.

## Provenance / system metadata — the audit

| Source                  | Durable product event?                                                                                                                             | Outcome                                                                                                                                                                                                                                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Memory updated          | **Yes** — `agent_memories` rows (tool writes and in-loop extraction saves)                                                                         | **Shipped**: `memory_updated` marker                                                                                                                                                                                                                                                                              |
| Generated artifact/file | **Yes** — `DocRequest` with the deliberate `source_thread_id` provenance column                                                                    | **Reserved**: the write happens at the doc-drafts door (outside the worker loop); the only clean emit seam is a door-side append (the `turn_stop_door` precedent). Deferred as an additive follow-up; meanwhile the artifact fact is already on the wire as the action's tool result, rendered on the call's row. |
| System notification     | **No** — `OperatorAlert` is operator-only and deliberately off contract; member-facing system prose already rides turn `error` / receipt sentences | Audited-absent, no marker                                                                                                                                                                                                                                                                                         |
| Todo updated            | **No** — `write_todos` is strands agent-state only and not mounted on the assistant                                                                | Audited-absent, no marker                                                                                                                                                                                                                                                                                         |
| Routine scheduled       | **No** — no member-visible schedule object exists (only operator janitor schedules)                                                                | Audited-absent, no marker                                                                                                                                                                                                                                                                                         |
| Routine viewed          | Already represented: the catalog/skills tool calls annotated `icon: "routine"`                                                                     | No new marker                                                                                                                                                                                                                                                                                                     |

**Never manufacture a UI-only event from tool-name string matching** —
the `memory_updated` marker is emitted from the real write seam
(`PostgresMemoryStore.add`, via an injected fail-open callback), which is
why it fires for tool writes and background extraction alike and stays
silent on dedup no-ops.

### `memory_updated` semantics

- `memory_id` — the durable identity and the reconcile key: a replayed or
  delayed re-delivery updates nothing and appends nothing (first anchor
  wins; `core/memory-provenance-anchors.ts`).
- `scope` — open vocabulary, `"org"` / `"user"`; unknown tokens render
  generically.
- `summary` — a deterministic canned sentence
  (`MEMORY_UPDATED_SUMMARY_SENTENCE`). **Never** the memory's content,
  embeddings, hidden prompts, or storage paths — end-user safe by
  construction, and the client narrower caps it anyway.
- No `tool_call_id`: the store seam sits below the tool layer; deriving
  one would require tool-name sniffing. The marker is a standalone
  provenance row ordered by stream position. (A tool-driven write also
  shows as its annotated `add_memory` tool row; the provenance-row laws
  say how the two read together.)
- Background extraction emits within the run window: extraction settles
  inside `assistant.respond`, which runs entirely inside the event log's
  draining scope — verified at build, so no marker can chase a closed
  log.

## Ordering and reconciliation laws (restated for consumers)

- New metadata joins by durable IDs — `tool_call_id`/`messageId` for
  timing, `turn_id` for usage, `memory_id` for provenance, `ordinal` for
  dispatches — never adjacency.
- A delayed annotation updates the existing row (the anchor maps'
  merge-by-id), never appends a duplicate.
- Replay and live delivery converge: everything here is a stored row
  serialized by the one shared path; nothing is synthesized per attach.
- Old histories stay valid: every field is additive and optional; absent
  timestamps/usage/summary/markers degrade to unknown/hidden.
- A catalogue change cannot rewrite history: markers are immutable run
  events snapshotted at emit; the dispatch summary reads the immutable
  settled receipt; `model_id` (dashboard) reads immutable usage rows.
- Payloads stay bounded: one usage marker per turn, one provenance row
  per memory write, timestamps are one integer per stored event, and the
  client narrowers keep their caps (500-char sentences, 64-char tokens).
