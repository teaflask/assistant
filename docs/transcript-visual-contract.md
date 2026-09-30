# The transcript visual contract

**Status: binding.** This is the visual-quality contract for the
transcript. It restates the testable sentences of the presentation
architecture ADR (`presentation-architecture.md`) as numbered laws and
adds the geometry, motion, fixture, and build-gate laws. On any
conflict, the ADR wins and the conflict here is a bug.

The machine-readable registry is
[`tests/tvc/registry.ts`](../tests/tvc/registry.ts): one entry per
objectively checkable law, each carried by exactly one test whose title
contains the law's `TVC-###` id. `tests/tvc/tvc-meta.test.ts` holds the
registry and the tests in lockstep, and **every registered law's test
runs — none is skipped** (TVC-180, §3).

A law that cannot be expressed as a machine assertion appears below as
prose explicitly marked **`manual-review`** and carries no id. Everything
else carries an id and a test.

---

## 1. The twelve laws

### Law 1 — Conversation prose is primary; operations are quieter

The transcript is a conversation that happens to show its work, not an
operations log with prose in the gaps. Assistant prose renders at the
body register; process rows render one step down, in muted ink, and
never louder than the words around them.

- **TVC-001** (enforced): a process row's label renders on a smaller
  type-step token than assistant prose body text (the token IS the step
  in this system; TVC-172 bans non-token sizes).
- `manual-review`: "operations read quieter" beyond the type step —
  density, ink, and chrome restraint — stays a design-review judgment.

### Law 2 — Active folds carry one live work label; settled folds say what the work cost

While a run's activity is live, its fold headline is one work label with
the shared active-text motion — collapsed (the default), the latest
step's own label, so the member tracks the work without expanding;
expanded, the generic **"Working…"** (the rail below already says what
the steps are). When it settles, the headline becomes the server-derived
**"Worked for …"** duration. A settled headline never counts steps:
record count is implementation telemetry, elapsed time is
member-relevant cost. The final answer always stays outside the fold.
Expansion is an inspection affordance; live protocol detail is not
forced into the reading path. Pending decisions and failures remain the
exceptions because collapsing either would hide an action or evidence
the member needs. The two holds are cut at different levels: a pending
decision opens the affected ROW and its containing FOLD; a resolved
host-authored view (rungs 1–2, `tool-views.md`) opens the ROW alone — no
view opens or holds an outer fold. Each row hold lasts for the turn the
row belongs to (surviving the settle) and decays when the next user turn
begins, and a member's explicit toggle outranks every hold, permanently
for that fold. Fold state derives from the row model and the turn
boundary alone — never the tool-view registry (the registry join
survives only at the row, `tool-row.tsx`), never a clock, a viewport
measurement, or an animation completing.

The grouping is two-phase. While a turn is OPEN — non-terminal: queued,
working, and the HITL pauses — its chronology stays interleaved: each
contiguous run of reasoning/tool rows is its own fold, and assistant
prose, receipts, dividers, and subagent groups split sequences at their
exact transcript position, so the live tail reads prose → fold → prose
in true order and no intermediate paragraph is prematurely read as the
final answer. Once the turn COMPLETES, each uninterrupted work span
unifies around its LAST maximal prose run — the turn's last words: the
final response of a clean settle, the last narration of a turn that was
stopped, failed, or superseded mid-work. That run stays outside, visible
without expanding anything; everything before it — earlier narration
included, as steps at their original positions — is ONE episode fold,
whatever views its tool rows resolve (a view is inspected at its own row
inside the fold, never by splitting the episode); work that continued
past it (the cut-off tail of an interrupted turn) is its own trailing
fold, so a settled turn with prose never renders zero visible assistant
text — collapse the work, never the answer, and never the last thing the
assistant said before a stop. A prose-only turn folds nothing (no empty
"Worked" disclosure), and the rule is structural only: position and row
kinds decide what folds, never copy length, keywords, tone, importance,
or per-turn status (which the row model does not carry). User-facing
surfaces — user messages, receipts, dividers, subagent groups — never
fold and always split, so a completed turn a user-facing surface
interrupted settles into more than one episode fold by design. The
unification happens once, at the terminal settle, and each surviving
fold keeps the key its live cluster's `<details>` already wears, so
surviving disclosures never remount (a visitor's open state on a cluster
that MERGES into an earlier fold's episode does not survive; the
surviving folds' native state does — TVC-014's scope).

The settled register reads the typed duration
(`replay-metadata-contract.md`): a measured span of one second or more
reads the house ladder — "Worked for 12s", "Worked for 3m 04s", "Worked
for 1h 07m"; a measured sub-second span (zero included) reads **"Worked
for <1s"** — never "Worked for 0s", and never hidden as if unknown; an
unknown span (a pre-timestamp history) degrades to the neutral
**"Worked"** — never an invented duration. Each fold reduces its OWN
members' timing — the per-cluster folds of an open turn each carry their
own span, and a completed turn's unified episode reduces over all its
work members, spanning the narration gaps without prose ever needing
timing of its own. The settled headline carries NO outcome tally: a step
that failed, was interrupted, was declined or was not approved wears
that word on its own row's pill, read by the member who opens the fold —
the headline is the work's cost and nothing else.

- **TVC-010** (enforced; re-cut by the working-fold rule): while
  activity is live the fold's headline is one shimmered work label —
  expanded (the default while working), the generic "Working…" (the rail
  below already says what the steps are), and collapsed by the member,
  the latest step's own label (the same words the step's row wears: the
  tool ladder's frame or authored envelope copy, the reasoning row's
  "Thinking…"/"Thought about it"; the generic "Working…" when no step is
  usable) — never a settled duration. The settled headline is never
  substituted, open or closed.
- **TVC-011** (enforced): a settled fold's headline carries no step
  count.
- **TVC-012** (enforced): the settled duration derives from
  server-carried run metadata, and the same event history renders the
  identical settled label live, after reconnect, and after replay.
- **TVC-013** (enforced): the active fold's motion is the one shared
  shimmer primitive; a settled fold carries no motion.
- **TVC-014** (enforced; re-cut by the working-fold rule): the section
  that is working is the expanded one. A fold is open by default while
  it claims liveness or while a member awaits the member's decision, and
  folds — a release on the same element, never a remount — once its work
  settles, so a finished section reads as one "Worked for …" line; every
  earlier fold is closed by default. A host-authored view (rungs 1–2) or
  a decision (pending or settled) holds the affected ROW open for the
  turn it belongs to while the call is running or settled clean,
  released when the next user turn begins; a package built-in or the
  default reading never opens a row, and a failed, not-run or degraded
  row (failed, not approved, declined, interrupted, truncated,
  offloaded) is closed by default whatever it resolved — the pill names
  the state, the body is for the member who asks; a failed step forces
  nothing open at the fold either and adds no tally to its headline —
  the row's pill names it. The member's explicit toggle outranks every
  default, permanently for that fold. Native disclosure state preserves
  the visitor's choice across settling for the folds that SURVIVE
  episode unification — each survivor keeps its key (TVC-084), while a
  cluster merged into an earlier fold's episode — whatever views its
  rows resolve — does not keep its own disclosure. Transcript disclosure
  chevrons stay hidden at rest, appear on hover or keyboard focus, and
  remain visible while their own disclosure is open.
- **TVC-015** (enforced): a completed turn's work before its last prose
  run — leading and intermediate narration, reasoning, and tool activity
  — renders as one settled fold per uninterrupted work span, whatever
  views its tool rows resolve (a view stays inspectable at its own row
  inside the fold); chronology is preserved inside every fold, work past
  that run stays in its own trailing cut-off fold, and an open turn
  keeps the interleaved per-cluster folding.
- **TVC-016** (enforced): the last maximal prose run of each completed
  work span renders outside any fold — the final response of a clean
  settle, the last narration of a cut-off turn — and a prose-only turn
  renders no fold; position alone decides, never copy inspection or turn
  status.
- **TVC-156** (enforced): the settled fold header's baseline.

### Law 3 — A reading, never a raw payload

A row's face is its resolved presentation — the headline ladder's words,
the semantic icon, the state mark. Its body is the tool view — an
authored reading on rungs 1–3, the package's bounded argument reading on
rung 4 — and nothing else: no "Technical details" disclosure, no raw
input pane, no raw result pane. The recorded wire bytes are model-facing
evidence, never transcript furniture. Output becomes member-facing UI
only through a registered tool view; generic JSON and raw result text
never render.

- Law 020 — RETIRED with the Technical details disclosure it pinned (the
  semantic view preceded a raw payload disclosure that no longer
  exists). The id is never renumbered or reused.
- **TVC-021** (enforced; re-cut with the disclosure's removal): a
  settled untyped operation exposes only a bounded reading of its input
  — never a raw payload pane — behind a manual disclosure that is
  closed by default; output
  requires an authored result surface.
- **TVC-022** (enforced): an elicitation surface renders the human
  heading, question and suggestions; the wire's ids and keys never
  render in the default view.

### Law 4 — State appears on the affected operation

Failure, cancellation, and progress are properties of the operation they
describe. An error renders inside its own row; a cancellation reads as
neutral (the receipt alongside owns the story, and destructive ink is
reserved for genuine failure); the state mark derives from the protocol
state (`ToolCallState`), never from the tool's meaning.

- **TVC-030** (enforced): a failed operation's error indication renders
  inside that operation's own row, never as a detached badge.
- **TVC-031** (enforced): authored copy follows the state ladder — error
  copy only on failure, completion copy only on completion, and a
  cancelled call refuses authored copy entirely; a model-written caption
  is the label in every state, wearing a quiet state word off the
  running/done path.
- **TVC-032** (enforced): the state mark derives from the protocol state
  alone — same state, different tools, same mark.
- **TVC-033** (enforced): a cancelled operation's mark carries no
  destructive treatment; a failed operation's does.
- **TVC-034** (enforced): a failed TURN's terminal receipt — the turn
  ended abnormally outside any single tool — renders as its own quiet
  transcript row carrying the wire's reader-aware sentence
  (`turn_failed` marker), with a failure mark and no motion; it is never
  a detached banner and never assistant-voiced prose. User-stopped turns
  retain their durable markers but project no additional notice.
- **TVC-035** (enforced): turn-failed receipts are replay-identical and
  never double the story — marker-by-marker anchoring equals the
  snapshot seed, re-application is a no-op, and the failure banner is
  withheld when the same sentence is anchored in the transcript.
- **TVC-036** (enforced): a call paused for approval or elicitation
  wears an explicit textual awaiting-input signal on its own row — never
  colour or a bare hold-open alone.
- **TVC-037** (enforced): a tool call severed by a run retry —
  resultless behind a later resume marker — reads as interrupted, never
  as still running; a recorded failure still outranks it, so the red
  failed row survives a retry unchanged.
- **TVC-038** (enforced): a refused operation — the tool answered and
  declined (the wire's `refused` sentence) — reads as its own neutral
  declined state: a "Declined" pill, no destructive treatment on mark or
  pill, the door's reason sentence on the row without an Error label or
  a Result pane (its content is the refusal envelope the model read),
  and never a failed count in its fold's headline. Its own quiet word: a
  refusal is not an interruption (nothing cut it) and not a failure
  (nothing broke).
- **TVC-039** (enforced): a call a member declined to approve —
  `approval_resolved{approved:false}` joined client-side to its
  `approval_requested`'s `tool_call_id`, no wire change — reads as its
  own neutral not-approved state: a "Not approved" pill and the "You
  didn't approve X" headline (distinct in both from cancelled's
  "Interrupted" / "Didn't run X" and from refused's "Declined" / "Didn't
  X"), no destructive treatment on mark or pill, no Result pane for the
  cancellation sentinel, and no tally in its fold's settled headline
  (the pill alone wears the word). The state outranks the wire's
  `cancelled` stamp (a denial arrives AS a cancel) and yields to a
  recorded failure; it derives from the two durable markers, never from
  the prunable approval card, so it is replay-identical (law 9).

### Law 5 — Expanded content does not accumulate indentation

Disclosure adds detail, never another indentation level. Opening a fold,
a row, and a raw pane in sequence must not walk the content rightward;
an expanded fold's body returns to the transcript's own alignment.

- Law 040 — RETIRED with the Technical details disclosure it measured: a
  tool row nests no disclosure of its own; TVC-041 keeps the fold→row
  level. The id is never renumbered or reused.
- **TVC-041** (enforced): expanding a fold does not shift its process
  body's x-origin by an extra group margin.

- **TVC-042** (enforced): a closed transcript disclosure keeps its
  content mounted — the activity rail stays in the DOM — while its
  `::details-content` box computes to `display: none`; opening re-admits
  the box and closing hides it again (`tests-e2e/transcript.spec.ts`).
  The rule exists so a display-locked closed `<details>` never holds a
  nested scroller's layout box, which could register a stale compositor
  scroll node on the transcript scroller and freeze its native range
  (crbug.com/558064971).

### Law 6 — A process rail has one icon/connector column and one text column

Every first-level process row shares two columns: the marks stack in one
x-origin, the words in another, and expanded technical detail begins
under the words, not under the marks. Icons are semantic — the resolved
icon vocabulary
(`search, file, terminal, question, memory, delegation, routine, todo, navigation, generic`;
`todo` included, §8) each renders a distinct mark, and a completion tick
is a state, not the universal operation icon.

- **TVC-050** (enforced): all first-level process icons share one
  x-origin.
- **TVC-051** (enforced): all first-level process labels share one
  x-origin.
- **TVC-052** (enforced; re-posed on the tool-view slot when the
  technical pane left): an expanded operation's body begins under the
  label column, not the icon column.
- **TVC-053** (enforced): top-level prose and fold headers share the
  transcript's x-origin.
- **TVC-054** (enforced): each icon-vocabulary member renders a distinct
  semantic mark.
- **TVC-055** (enforced): a plan-progress operation annotated
  `icon: "todo"` resolves the dedicated checklist member — distinct from
  the generic fallback's mark, while an unknown token still degrades to
  generic.
- **TVC-157** (enforced): the process rail's baseline.

### Law 7 — Full decision surfaces align to the transcript/composer measure

An approval or elicitation is part of the conversation, not a modal
interruption: its frame holds the same measure the transcript and
composer hold. One logical operation keeps one visible record through
its whole lifecycle — ask, decision, execution, result. Settled
decisions render no transcript receipt rows at all (the meta-receipt
deletion, a product decision retiring the audit-visibility lines): the
outcome's surfaces are the decision card's own footer and the operation
row's state, and the durable markers stay in the event history. The
generic banner leads with fixed consent copy and a mechanically derived
tool label; arguments render on the call's own row, never on the banner
(the row, which a pending decision holds open, carries the request).

- **TVC-060** (enforced): a pending approval frame aligns to the
  transcript/composer measure.
- **TVC-061** (enforced): an elicitation frame aligns to the measure.
- **TVC-062** (enforced): decisions settle with no transcript receipt
  rows at all — approved and declined alike, joined or unjoined: no
  receipt sentence, no duplicate card note, no empty padded wrapper. The
  outcome's surfaces are the decision card's own footer and the
  operation row's state. (The meta-receipt deletion retired the
  audit-visibility lines as a product decision — do not restore the rows
  as a bug fix.)
- **TVC-063** (enforced): a generic approval banner leads with fixed
  consent copy and a mechanically derived tool label, and asks exactly
  one question — the backend-authored consent sentence (or the package
  fallback). Tool arguments never render on the banner, raw or
  summarized: the call's own transcript row, which a pending decision
  holds open, carries the request.
- **TVC-064** (enforced): a resolved or stale decision's surface leaves
  the suspension slot — the tenant renders null unless a decision is
  actionable or in flight. An unresolved suspension is explicit inbox
  state, never inferred from what happens to be mounted.
- The 065 law was deleted with the meta-receipt row class it pinned
  (declined receipts joining their operation, unjoined declines at the
  tail): no decision receipt renders in the transcript at all. The
  reworded TVC-062 above is the surviving law.
- **TVC-066** (enforced): a settled (withdrawn or expired) ask never
  wears a running spinner or shimmer; the withdrawn sentence renders on
  the ask's own inline card (shelf-less hosts), never as a transcript
  row.
- **TVC-067** (enforced): an oversized approval stays bounded in the
  suspension slot. The banner never exceeds the decision well's budget;
  a very long consent prompt scrolls within the banner rather than
  pushing Approve/Deny off screen or past a constrained host's panel,
  and the composer's controls remain fully on screen and un-overlapped.
  (The bounded request contents left with the banner reshape, so the
  banner as a whole is the scroll region. The shelf-path successor to
  TVC-140's inline probe; the bound itself is the landlord's.)
- The 068 and 069 laws were deleted with the sensitivity plane they
  pinned (built, tested, zero producers; it returns additively when a
  real tool needs one — see `tool-views.md`): the generic card renders
  its bounded summary on every delivery path, and the REST-recovery
  display join survives to carry the icon (and, next, the view key) to a
  row-less recovered card.
- `manual-review`: destructive-approval copy must say what is being
  destroyed in plain member language — tone is a review judgment; the
  fixture matrix carries a destructive case so review always has a
  specimen.

### Law 8 — Subagent hierarchy adds one rail level; ordinary tools add none

Delegated work may indent its children exactly one column step beyond
the parent rail. Nothing else earns hierarchy: an ordinary tool's
disclosure is depth of detail, not depth of tree (law 5 enforces the
geometry). Child previews reuse the transcript grammar rather than
nesting new chrome.

- **TVC-070** (enforced): a subagent child transcript indents exactly
  one rail level beyond its parent.
- **TVC-071** (enforced): a child preview wraps its transcript body in
  exactly one frame of chrome — never a card within a card (grammar
  reuse is reviewed through the subagents scenario and TVC-158's
  baseline).
- **TVC-072** (enforced): a subagent's current-work label reads the
  presenter's `currentWorkLabel` slot — fed only by the open drill-in
  stream (`subagent-current-work.tsx`; the roster never opens a stream
  for it).
- **TVC-073** (enforced): a settled subagent duration derives from the
  house duration ladder (`durationLabelOf`) — a sub-second span reads
  "<1s", and "0s" / "Worked for 0s" are unrenderable by construction.
- **TVC-074** (enforced): a subagent row's metadata lines — current
  work, duration, and failure note — share their own row label's
  x-origin, measured per row (the status+identity cluster's width is
  content-owned, so no static padding may re-encode it). The sweep
  covers the roster's rows too: a line's leading element carries its
  x-origin, so the duration that rides inside the status line is
  measured through that line. Compact roster and inline rows stop at
  task, status, and duration; successful result summaries stay in the
  adjacent child transcript preview.
- **TVC-075** (enforced): a subagent row's fixed-size ornaments —
  identity mark, drill-in chevron — center on the label LINE they belong
  to, never on the row's whole multi-line stack (the vertical companion
  to TVC-074's horizontal sweep, which cannot see this; measured over
  both the inline rows and the roster rows).
- **TVC-076** (enforced): the drill-in popover crosses the script-tag
  shadow boundary under a strict CSP (`style-src 'none'`, the TVC-102
  probe's own page) — top-layer promotion, anchor placement (CSSOM
  writes, which CSP does not govern), inside-vs-outside light dismissal
  by composedPath (a contains() read fails exactly there: document-level
  targets retarget to the host), native Escape, and focus restore to the
  opener inside the shadow root, all measured rather than derived from
  the roster shell's precedent.
- **TVC-158** (enforced): the subagent tree's baseline.

### Law 9 — The same event history yields the same transcript

Order and settled state are functions of the event history alone. Live
assembly, snapshot-seeded reconnect, and full replay must render the
same rows in the same order with the same settled presentation. Marker
application is idempotent — every replay re-delivers everything.

- **TVC-080** (enforced): the projection is deterministic — equal
  inputs, deep-equal rows.
- **TVC-081** (enforced): display-anchor application is idempotent, and
  anchors built marker-by-marker equal the final snapshot.
- **TVC-082** (enforced): the settled-state ladder is fixed — errored
  beats denied (a denial outranks the wire's cancelled stamp) beats
  cancelled beats refused beats result-present beats superseded beats
  running/pending.
- **TVC-083** (enforced): the running→settled flip never reorders or
  rekeys rows. Its scope is the PROJECTION (`transcriptRowsOf`'s
  `running` argument); the fold layer's episode regrouping at turn
  settle keys on a different input — turn terminality — and is pinned by
  TVC-084, not governed here.
- **TVC-084** (enforced): episode grouping is a pure function of the
  projected rows and the one open-tail-turn bit — never the tool-view
  registry — identical live, after reconnect, and after replay — and the
  open→settled unification preserves every surviving fold's key: the
  settled episode wears the key of the first live cluster it absorbed.

### Law 10 — TeaFlask marks identify agents

Subagent chrome wears TeaFlask's own identity mark. No borrowed mascot,
no cheap numbered avatar, no anonymous coworker rows. Ordinary assistant
prose stays clean; its non-visual identity token preserves provenance.

- **TVC-090** (enforced): assistant-authored turns carry a non-empty
  `[data-tf-agent-identity]` provenance token, but ordinary prose
  contains no decorative `[data-tf-agent-mark]`.
- **TVC-091** (enforced): each subagent's mark is distinguishable from
  the primary agent's and stable across surfaces — the
  `[data-tf-subagent-identity]` value is the coworker's token
  (`core/agent-identity.ts`), identical on the inline group row and the
  roster.
- **TVC-092** (enforced): each subagent surface uses the filled TeaFlask
  geometry with a deterministic palette variant, textual equivalent, no
  visible numeric badge, and no avatar-style circle or background plate
  behind the mark.
- **TVC-159** (enforced): mark-scale baselines pin two distinct subagent
  color identities.

### Law 11 — Motion has a reduced-motion equivalent

The two motion primitives — the shared active-text shimmer and the one
indeterminate spinner — each collapse to a static equivalent that
preserves state text under both switches: the OS
`prefers-reduced-motion` query and the host kill switch
(`data-reduce-motion="true"` on any ancestor). The pre-existing quiet
working dot already honors both switches (the stylesheet pins its kill
rule beside the shimmer's); any motion added beyond these must arrive
with its own reduced-motion law.

- **TVC-100** (enforced): the shimmer collapses to a static equivalent
  under both switches.
- **TVC-101** (enforced): the spinner has a reduced-motion equivalent
  that preserves its state text — its test runs over the shipped
  submitting-approval surface and defines the primitive's hook
  ([data-tf-spinner], which replaced the ad-hoc [data-tf-spin] marks).
- **TVC-102** (enforced): the two motion primitives run inside a shadow
  root with a constructed stylesheet under a strict CSP — the built
  script-tag artifact itself, `dist/element/assistant.js`, loaded on the
  probe page — and both collapse to static equivalents, state text
  preserved, when either reduced-motion switch is applied outside the
  shadow boundary (the host kill switch crosses it through the element's
  attribute reflection).
- **TVC-103** (enforced): the probe page loads the built artifact — the
  element genuinely upgrades, its open shadow root carries exactly one
  adopted constructed sheet and no tree stylesheet, and that sheet
  carries the bake-stage rem→px fingerprint (the label token serialized
  in px — the discriminator a pipeline reproduction fetching
  `dist/styles.css` could not carry).
- **TVC-155** (enforced): active states settle to static equivalents and
  match their reduced-motion baselines.

### Law 12 — Result UI is authored, never inferred from arbitrary JSON

An unknown customer tool shows its call input but no inferred result
card and no raw output dump. Organizations can opt into richer result
UI with a registered tool view rather than having the package
guess from payload shape. The presenter
(`toolCallPresentationOf`) is the single resolution point: consumers
read slots, never the raw display envelope, and every copy slot derives
from the one headline ladder.

- The 110 law was deleted with the `ui_spec` result grammar it pinned
  (see `tool-views.md`); the 111 law below survives — result UI stays
  authored, never inferred.
- **TVC-111** (enforced): an unknown customer tool exposes input but
  renders neither an inferred result card nor a raw output dump.
- **TVC-112** (enforced): unknown icon → `generic`. (The disclosure
  clause left with the client `disclosure` arm it pinned — the wire
  field has no producer, and openness derives from resolution and
  pending decisions; `tool-views.md`.)
- **TVC-113** (enforced): every presenter copy slot derives from the
  headline ladder — no slot or consumer respells a frame.
- **TVC-114** (enforced): an old-wire text-only display resolves the
  identical headline the pre-annotation ladder produced.
- **TVC-115** (enforced; posed on the tool-view slot): a registered tool
  view that throws is isolated; resolution falls to the rung below,
  terminally the package default.
- The 116 law was deleted with the `approvalRenderers` registry it
  pinned — a view cannot approve its own operation (`tool-views.md`);
  the package generic is the one approval surface.
- The 117 law was deleted with the sensitivity plane it pinned (see the
  Law 7 note).

### Provenance and system rows

Non-tool provenance renders as intentional vocabulary, from typed
evidence only. A memory write (the `memory_updated` marker — a canned
sentence, a scope token, a durable id; never the memory's content)
attaches as a quiet footer on the assistant message whose run caused it;
multiple writes coalesce into one counted trigger with the per-write
detail behind a keyboard reveal. Attribution is anchoring evidence
recorded at arrival: a history persisted without it renders no footer —
never a synthesized one. The system-originated conversation event (the
delivery divider naming a completed background handoff — the one notice
left since the meta-receipt rows, the resume divider among them, were
deleted) wears explicit system semantics, distinct from assistant prose
and user messages. Routines stay represented by their annotated tool
rows (`icon: "routine"`; no member-visible schedule object exists, so
recurrence and next-run render nothing), and generated artifacts stay
with their tool results — no marker exists, so no row may
(`replay-metadata-contract.md`'s provenance audit).

- **TVC-130** (enforced): a memory write renders as one quiet coalesced
  footer on its originating assistant message — count in the trigger,
  canned summary and generic destination label behind a keyboard reveal
  — never a detached row, never memory contents or ids; provenance
  without attribution renders nothing.
- **TVC-131** (enforced): memory-footer anchoring is replay-identical
  and idempotent — attribution built marker-by-marker equals the
  snapshot seed, re-application returns the identical map, and old
  histories project no footer.
- **TVC-132** (enforced): a system-originated notice (the delivery
  divider — the one notice kind left since the meta-receipt rows, the
  resume divider among them, were deleted) wears explicit system
  semantics — the system-notice hook, a note role, the "System
  notification" accessible name — and never renders as assistant prose.
  Delivery notices use a compact right-aligned pill beneath a visible
  "System notification" label and carry a subagent identity mark,
  distinguishing them from user messages.

### The follow contract and overlays (laws the transcript already keeps)

The viewport respects the reader. Late content follows the bottom only
while the visitor is already following; escapes are honored even
mid-resize; returning re-engages; overlays never cover the composer's
controls; a disclosure toggle never steals scroll position.

- **TVC-120** (enforced): activity overlays never overlap composer
  controls.
- **TVC-121** (enforced): disclosure toggles steal no scroll position
  from a scrolled-away reader.
- **TVC-122** (enforced): decision surfaces remain in flow on the
  composer's measure. Compact activity is different: the subagent pill
  is an absolutely positioned, transparent overlay anchored to the
  shelf+composer anchor's top edge (anchored to the composer alone it
  would sit over a populated suspension slot's decision controls). It
  reserves no row, paints no full-width band, never overlaps composer
  controls or the decision shelf's tenants, and disappears without
  residue when empty. The law is measured at 390/672/1280px.
- **TVC-123** (enforced): the scroll-away activity indicator appears for
  a scrolled-away reader during live activity without moving their
  scroll position, and activating it returns them to the tail. The
  treatment is the merged jump affordance — its accessible name keeps
  the dedicated "scroll to bottom" wording, and the badge rides the
  existing working-dot motion (both reduced-motion switches leave a
  static visible mark).
- **TVC-124** (enforced): shelf population and height changes never
  strand a pinned reader at the bottom nor move a scrolled-away one —
  the shelf-growth edition of TVC-141's viewport-steal class, which is
  also the mechanism a mobile virtual keyboard exercises.
- **TVC-125** (enforced): a tenant's floating disclosure (the subagent
  roster) opens fully inside the viewport at the narrow contract width,
  and holds its position while a sibling overlay item changes size. The
  mechanism is the activity overlay's stacked layout: each tenant
  centers on the column independently, so an anchor's position is never
  a function of a sibling's width — a sibling growing or shedding a
  suffix must not slide an open roster under the reader. (No shipping
  sibling exists; the fixture poses a bench specimen tenant as the
  stimulus.)
- **TVC-126** (enforced): conversation chrome never narrates run state —
  no wait or working status line renders in the activity slot for any
  turn status, and no visible "Waiting for your input" exists anywhere.
  Waiting is stated only by an actionable decision surface or the
  pending-decision gap alert (`data-tf-pending-decision-gap`,
  `role="alert"`, with Retry); the sr-only announcer phrases it for
  screen readers, keyed on actual pending decisions, never on raw status
  — the wire's `parked` covers both a HITL pause and a subagent wait,
  and only `pending_interrupt_ids` plus the cards distinguish them.
- The six pre-existing follow probes, all enforced: **TVC-140** (a late
  giant approval lands its footer in the viewport, and a further resize
  never drags a scrolled-away reader), **TVC-141** (composer growth
  returns a pinned transcript to its bottom), **TVC-142** (wheeling up
  over a code block releases the follow lock), **TVC-143** (a non-wheel
  upward scroll escapes mid-resize), **TVC-144** (an axis-mixed
  horizontal pan never releases the lock), **TVC-145** (dragging back to
  the bottom re-engages the follow).
- **The follow-liveness premise**, enforced as four laws carried by
  `tests-e2e/scroll-follow-guards.spec.ts` — **TVC-146** (under a pinned
  clock the shrink re-follow never moves a reader: the transient shrink,
  the content-fit shrink, and the escape-bail re-arm), **TVC-147** (a
  fit-content follower is re-landed when the shrink creates the
  overflow), **TVC-148** (a shrink that beats the liveness proof is
  re-landed once the clock proves live, never dropped), **TVC-149** (a
  bottom-following reader is re-landed when the viewport shrinks): a
  reader may be re-landed at the bottom only on a page whose CLOCK
  advances across animation frames. Every follow the library starts for
  itself carries `wait: true`, whose gate is
  `Date.now() + 1 > Date.now()`; under a pinned clock that never elapses
  (TVC-146's poses), the follow machinery never completes, and
  `isAtBottom` (initialised `true`, made honest only by that machinery)
  sits stale-true with the reader at the top — geometrically identical
  to a genuine follower whose content fit the viewport (both read
  scrollTop 0 with no gap), so no geometric predicate can separate them.
  Nor can a follow call's settlement: the escape bail settles one
  without the wait ever elapsing. The shrink re-follow therefore
  observes `Date.now()` itself across frames — and nothing else: no call
  is issued, nothing is scrolled, no animation is registered — and
  remembers a shrink that beats the first proving frame, re-landing it
  the moment the clock proves live. On live pages the proof lands on the
  first frame, so TVC-140/141 and TVC-124 keep their unconditional reach
  — including the fit-content band neither poses (both start from an
  already-overflowing viewport; the spec's live-clock legs pin it) —
  while under a pinned clock the guard stays disarmed forever. (The
  screenshot captures run under the ticking capture clock — §7 — so the
  baselines photograph the landed follow, gated by TVC-190, instead of
  an unscrolled composition no production reader reaches.) The
  substitution sweep behind the premise — every place this file's follow
  guards let a geometric or initialised-state predicate stand in for
  follow history: the wheel and travel escapes (guards 2 and 3) are
  gesture-driven and fail-safe (they can only stop a follow, never move
  a reader); the re-engage (guard 4) writes only at `bottomGap <= 1`, a
  pure re-arm with nowhere left to move; the decision well writes a
  constant top and assumes nothing; and the activity rail has no follow
  pin of its own — it grows to its content inside the transcript's
  scroller, so no rail-level predicate stands in for follow history
  either.
- **Residual closed by deletion — the activity rail's follow pin.** The
  rail's height cap, its fold masks and its follow driver are deleted:
  the rail grows to its content in the transcript's own scroller, so the
  sub-pixel clamp that once left the TVC-155 active-states capture one
  pixel short (the rail's scrollTop landing 274 where the settled state
  read 275, bistable and invisible to every geometric predicate) has no
  pin left to recur through. What stands from that hunt: the
  reproducible contended arm is runnable, not prose —
  `scripts/tvc-contended-arm.sh`
  (`npm run tvc:contended-arm -- ARTIFACT_DIR [BATCHES] [HOGS]`: the
  pinned Playwright image, a `taskset` two-core hold, host CPU hogs
  sharing the cores, an unconditional post-suite artifact copy-out and a
  never-delete artifacts rule); the read-only fractional-geometry probe
  rides every active-states capture
  (`tests-e2e/helpers/fractional-probe.ts`, gated in the capture spec's
  `shoot()`, reading strictly after the comparator, one JSONL record per
  capture and a delayed re-read after a failing one); a sub-pixel clamp
  hunt takes the shape of a pre-registered falsifier, a write-test
  discriminator and a read-only post-comparator probe — never a wait or
  retry, which the bistable state defeats; and no single-day campaign
  count is efficacy evidence, because the day-to-day swing on identical
  code exceeds an order of magnitude.

### Screenshot baselines (the pixel contract)

The enforced baselines pin the shipped surfaces so any edit that moves
their pixels is a reviewed decision (§7 holds the workflow; re-blessing
is TVC-###-specific business, named here so a reader knows whose):

- **TVC-150** (enforced): the component bench matches its light
  baseline.
- **TVC-151** (enforced): the bench's dark baseline keeps the same
  structure and contrast.
- **TVC-152** (enforced): the real shipping composer at the narrow and
  full-page widths, light and dark — the bake-off shell is no longer
  the only composer photographed.
- **TVC-153** (enforced): the `rhythm` scenario at page width, light
  and dark.
- **TVC-154** (enforced): the decision surfaces (`approvals` and
  `elicitations` scenarios) at the palette width, light and dark.
- TVC-155 (with law 11) and TVC-156…TVC-159 (with laws 2, 6, 8, 10) are
  the remaining screenshot laws, listed beside the laws they picture.

### Performance

Migrated rows are heavier — semantic icons, motion, badges,
disclosures, nested trees. The budget guard exists so a long
conversation cannot silently become a regression discovered at
integration time.

- **TVC-160** (enforced): rendering the large synthetic transcript
  stays under the pinned DOM element-count ceiling
  (`tests/tvc/tvc-perf.test.tsx` — the ceiling constant records its
  measured value; raising it is a declared decision that requires a
  PR-description callout, never a silent edit).
- **TVC-161** (enforced): the projection over the synthetic transcript
  yields exactly the arithmetically expected row count.
- **TVC-162** (enforced): the script-tag element bundle — the artifact
  a customer's embedded page fetches: eager shell minified and gzip,
  on-demand pool minified — stays within a pinned two-sided byte band
  of its committed baseline (`tests/bundle-baseline.json`; the band
  constants and their measured rationale live in
  `tests/element-bundle-weight.test.ts`). Over the band: justify the growth in
  the PR and run `npm run baseline:bundle`. Under it: refresh downward
  so the recorded headroom stays honest. Like TVC-160's ceiling, moving
  a band is a declared decision that requires a PR-description callout,
  never a silent edit.

### Token and primitive gates

The existing lint laws are part of this contract and are executably
pinned: styling comes from `tf` semantic tokens, structure from the
primitives layer.

- **TVC-170** (enforced): a raw palette color class in package source
  is a lint error.
- **TVC-171** (enforced): an inline style prop in package source is a
  lint error.
- **TVC-172** (enforced): an arbitrary numeric-literal utility value in
  package source is a lint error.
- **TVC-173** (enforced): a raw interactive element outside
  `src/components/primitives/` is a lint error — and the primitives
  exemption is pinned as exactly one directory wide, so widening the
  shipped ignore turns this law red.

---

## 2. Failure gallery — the anti-patterns, named

Each of these is an objective failure. When a review or a screenshot
diff shows one, the detecting law is listed beside it.

| Anti-pattern              | What it looks like                                                                                                  | Detected by                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Cumulative left drift     | Each opened disclosure pushes content another step right; deep inspection ends in a narrow column.                  | TVC-041 (law 040 retired with the technical-details pane)          |
| Card-within-card nesting  | A framed child inside a framed parent inside a framed group — borders inside borders.                               | TVC-071, law 5                                                     |
| Generic ticks             | Every settled operation wears the same checkmark regardless of what kind of work it was.                            | TVC-054                                                            |
| Ambiguous hollow circles  | A dashed/empty circle that could mean pending, stale, or abandoned, with no state text to disambiguate.             | `manual-review` (law 4 prose); the states fixture keeps a specimen |
| Detached error badges     | A failure notice rendered as its own row, away from the operation that failed.                                      | TVC-030                                                            |
| Approval receipt rows     | Any "Request approved/denied" prose row in the transcript — the meta-receipt class is deleted.                      | TVC-062                                                            |
| Composer overlap          | An overlay, card, or activity pill covering the composer's controls.                                                | TVC-120, TVC-122, TVC-140                                          |
| Shelf strip               | An opaque full-width band behind a small pill, or an empty shelf that still holds vertical space.                   | TVC-122                                                            |
| Unchecked raw wire blocks | An ask or approval whose face is the wire payload — question ids and keys, path params — instead of human language. | TVC-022, TVC-063, TVC-111                                          |
| Step-count headlines      | "Worked through N steps" as a settled fold's story.                                                                 | TVC-011                                                            |
| Client-clock durations    | "Worked for …" computed from the viewer's clock, drifting across replays.                                           | TVC-012                                                            |

---

## 3. The registry and the meta-test

- The registry (`tests/tvc/registry.ts`) is a flat, sorted array of `{
id, assertion, layer, binds }`. Ids are `TVC-###`, never renumbered,
  never reused. Screenshot laws additionally carry a `counterparts`
  ledger — the dom/geometry/pure laws asserting the same visual property
  without pixels (§7 records why); an explicit empty list acknowledges a
  property that is pixel-pinned only. The meta-test holds the ledger's
  shape: only screenshot laws declare it, and every cited id must be a
  registered law off the pixel layer.
- **TVC-180** (enforced): every registered law's test runs. The registry
  has no status field and no parked state — a law is enforced by being
  registered — so a law can only be parked in the tests, and this law
  parses every test file statically (`tests/tvc/law-tests.ts`) for each
  way that can happen: a `.skip` / `.todo` / `.fixme` modifier on the
  declaration; a `describe.skip` / `.todo` / `.fixme` / `.skipIf` /
  `.runIf` group around it; a runtime skip call (`test.skip(condition)`,
  `test.skip()`, `ctx.skip()`, `it.skipIf(…)`) other than the two pinned
  Linux-only screenshot gates; a declaration nested in an `if`, ternary,
  short-circuit, loop, `switch`, `try` or a function that is not a
  `describe` callback; and a law file the runner's pattern would not
  select. A commented-out declaration is no declaration to the parser
  and reds the one-id-one-test check instead. The meta-test, which the
  scan excludes, asserts the same list and so vouches for TVC-180's own
  declaration. Not covered, by design: a law whose body asserts nothing
  (assertion content is review-held, §4), and runner flags passed
  outside the package's own `test` / `test:screenshot` scripts. A law
  that should not run is deleted, with the PR-description callout §4
  requires — never parked.
- **One id ⇔ one test.** Every id appears in exactly one test title
  across `tests/` and `tests-e2e/`; a TVC id never appears in a non-law
  test's title.
- Layers: `pure` (no React), `dom` (jsdom component/stylesheet tests),
  `geometry` (Playwright bounding-box probes), `screenshot` (pixel
  baselines), `lint` (executable proofs the ESLint gates fire).
- Enforcement: a registered law is enforced; there is no status field.
  Its test is parked by none of the forms TVC-180 lists — checked by
  parsing the test files, never by executing them. The only runtime
  skips are the two Linux-only screenshot gates
  (`test.skip(SCREENSHOTS_UNAVAILABLE, …)` in `transcript.spec.ts` and
  `tvc-screenshots.spec.ts`, where `SCREENSHOTS_UNAVAILABLE` is
  `os.platform() !== "linux"`): baselines are Linux renders, so
  elsewhere the screenshot groups skip and the pinned container runs
  them. The meta-test pins that census by file, callee and condition; a
  third runtime skip fails until it is added with its reason. `.only` is
  banned outright.
- The meta-test (`tests/tvc/tvc-meta.test.ts`) fails on: an id with no
  test, a test with an unregistered id, an id claimed twice, a parked
  law test in any form TVC-180 lists (TVC-180's own included), a runtime
  skip outside the pinned census, a runner configuration or package
  script that would not select every law file, a `.only` anywhere, a
  registered id this document never names, an id this document names
  that is not in the registry, a law that declares no binding or an
  unknown binding token, a registry using only one of the two binding
  tokens, a `package-binder` census that drifts from the pinned id set
  (a re-scope in either direction), a document that fails to name both
  tokens verbatim, and a scanner that finds fewer titles than the
  registry has laws (its own health check). The document's SENTENCES are
  not machine-checked — only id presence is — so a prose edit that
  changes a law's meaning is still a contract change and is reviewed as
  one.

### Which transcript a law binds

There is more than one transcript: two binder modules serve three
surfaces — the widget's own `Transcript` binds the store's projected
rows, and `AgentRunTranscript` binds an `AbstractAgent` for the
dashboard's run viewer and the playground — and hosts supply slots
inside both. A law therefore declares which transcript it binds
(`binds`):

- `any-transcript` — the law holds for any transcript the package
  renders, whichever module binds it: the store binder and the agent
  binder alike. Accessibility, motion honesty, state honesty, the fold
  grammar, copy discipline, replay equivalence, identity, and the
  redaction rules live here. The token names the binder axis, not a
  reach into host-authored DOM: a slot replaces the package's rendering
  of its surface, so even an `any-transcript` law binds the package's
  rendering, never the host's replacement — what a slot can never escape
  is the floor drawn below.
- `package-binder` — the law binds only the package's own widget: its
  chrome and geometry (rails, x-origins, overlays, the follow contract),
  its decision-surface composition, its pixel baselines, its budgets and
  its lint gates.

**The line, drawn explicitly.** A host slot must not fail a law it was
never meant to satisfy: nothing obliges a host's fill to reproduce the
package's rail geometry, its banner composition, or its pixels — that
freedom is the point of the slot seam. The icon slot is the sharp case,
and the ruling is deliberate: TVC-054 and TVC-055 pin the package's
resolution of the icon vocabulary to distinct marks, and a registered
icon adapter replaces the glyph exactly there — it owes those laws
nothing, while the mark's state ink and sr-only state word stay
package-owned outside the adapter's container. Equally, a host slot may
not escape the floor that exists to protect a member — a floor that
holds by construction rather than by obliging the fill, and whose every
item cites the artifact that backs it: error and interrupted status
render honestly and mandatorily — the mandatory frame facts stay outside
every slot boundary (the state-honesty laws — the 03x decade whole,
TVC-030 through TVC-039, all `any-transcript`; the frame states
mandatory status through every fill route); approval decision controls
stay package-owned and are never handed to a slot (TVC-063's banner
contract; the props law — a view receives no approve/deny,
`tool-views.md`; and the slot contract — the `toolRow` seam hands a fill
the durable row beside the resolved view while the decision surfaces
stay package-owned, the `./transcript-ui` slot enumeration in the
README); and the redaction floor applies inside a slot exactly as
outside it (TVC-130's never-contents-or-ids clause, an `any-transcript`
law). The package's link rule — every link in package-rendered
transcript markdown opens in a new tab with `rel="noreferrer"`,
unconditionally, internal and external alike (`markdown-structure.tsx`)
— keeps governing the package-rendered prose around and beneath a slot;
it is a package rule rather than a slot obligation, since a slot's own
DOM is the host's. `binds` classifies laws; it never weakens one — a law
that should not bind host surfaces is scoped, not softened. And
re-scoping an existing law is itself a contract change: narrowing
`binds` from `any-transcript` to `package-binder` shrinks the law's
reach in one word, takes the same explicit PR-description callout as
weakening an assertion, and cannot ride a diff silently — the meta-test
pins the exact `package-binder` census, so a flip in either direction
fails the build until the pin is edited beside it.

## 4. Adding a law

1. Build the behavior.
2. Write the law's test, with the law's id in its title. Do not rewrite
   an existing assertion to fit the implementation — if the assertion is
   wrong, that is a contract change (see prohibitions). Lines marked
   `SETUP` in a law's body are wiring — extend them freely; only the
   assertions are the law.
3. Register the law in `tests/tvc/registry.ts` — a registered law is
   enforced; a law is never registered ahead of its test.
4. For `screenshot` laws: generate the baseline via the pinned container
   recipe (§7), run it twice more without `--update-snapshots` to prove
   stability, and commit the PNGs.
5. Run the package gates: `npm run lint`, `npm run type-check`,
   `npm test`, `npm run knip`, `npm run build`,
   `npm run test:screenshot`.

**Prohibitions.** A change may not park a law's test in any of the forms
TVC-180 lists, and may not delete a law or weaken or remove an enforced
assertion to make a build green. Deleting a law, or deliberately
weakening an assertion, is a contract change: it is allowed only with an
explicit PR-description callout (the registry header and §3 say the
same). A change may add new laws (next free id in the relevant decade,
registered + tested in the same PR). The perf ceiling (TVC-160) may be
re-measured upward only with a PR-description callout.

## 5. Fixture scenarios — the URL contract

The transcript fixture (`npm run fixture:transcript`, served at
`http://127.0.0.1:8787/fixtures/transcript/`) renders deterministic
product scenarios by query parameter. Tests target these URLs; the
scenario names and their coverage are part of this contract.

`?scenario=<name>` selects a scenario. `&theme=dark` flips the theme.
`&reduce-motion` sets the host kill switch. A scenario signals readiness
with `data-scenario-ready="true"` on its root
(`[data-testid="scenario"]`); scenarios containing fenced code blocks
must ADDITIONALLY be awaited via their `pre.shiki` count (the shiki lazy
settle changes block heights — never screenshot before it lands).

| `?scenario=`     | Deterministic coverage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rhythm`         | prose → reasoning → tools → prose alternation; one settled fold above one live fold (the settled first turn, then the still-running second — `.first()` on the fold locator is the SETTLED one)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `interleaved`    | the completed-episode specimen: one settled turn interleaving three narration passages with three action clusters, unified into one "Worked for 5m 39s" disclosure (collapsed by default) above the visible final response — expanding it restores the full chronology — plus a prose-only second turn beneath (the no-fold control, and proof that separate turns stay separate episodes)                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `operations`     | one operation per icon-vocabulary member: terminal, search, file, memory, question, routine, delegation, todo, navigation, generic — the plan-progress row renders the dedicated checklist member (see §8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `states`         | input-streaming, active, completed, failed, interrupted, not approved, awaiting-input (a pending approval and a pending question set, one per live fold so each fits its rail whole), stale, parked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `approvals`      | pending generic, destructive, conversation-scoped (trust-available), the answered card and the settled-quietly transcript (no meta-receipt rows; its overflowing list photographs bottom-anchored, showing the approved call's input/result — where a restored receipt row would render)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `elicitations`   | the question panel: pending, answered (the Q→A receipt), dismissed, stale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `subagents`      | one running, one completed, one failed dispatch; child transcript preview; the presence pill                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `notices`        | memory-update operation + the attributed memory footer; the delivery divider (the one system notice left — the resume divider and voided-turn receipt went with the meta-receipt rows)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `fallbacks`      | unknown customer tool (posed open); long technical input/output; a fenced technical prose block (the shiki gate — await `pre.shiki` count 1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `renderers`      | host-registered tool views (the scenario id keeps its historical spelling from when views were called renderers), fictional `acme.*` views: an email-like custom detail reading, a compact non-card custom detail, version drift falling back to the default reading, a throwing view landing on the package default through the slot's isolation, and the placement scene — a decayed view-bearing turn beneath a current one whose fold is held open by a pending decision and whose rows by that decision and a resolved view                                                                                                                                                                                                                                                                                                             |
| `built-ins`      | the package-shipped rung-3 views, resolved through the real default table with no registry provider: `teaflask.action` over three catalog-action shapes (a 2xx JSON body, a non-2xx status, a client-truncated body), `teaflask.command` over both authored result shapes (the `{output, error}` record and plain text), and `teaflask.file-edit` rendering a recorded str_replace as a diff and a recorded view as the neutral Contents pane (a read, not an edit)                                                                                                                                                                                                                                                                                                                                                                          |
| `composer`       | a settled transcript, long enough to overflow into scrollback, above the real shipping composer (idle); plus a busy instance with the stop affordance showing — the scrollback photographs bottom-anchored (the conversation's tail, the production state)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `activity-shelf` | the populated shelf (suspension-slot placeholder tenant, a bench sibling specimen, subagent pill) between a live scrollable transcript and the busy composer; the "Parked on subagents" scene (`data-testid="parked-on-subagents"` — pill only, idle composer, empty suspension slot; nothing claims the member); plus an empty shelf between an idle pair (the collapse specimen)                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `suspensions`    | the shipping decision composition: a paused transcript whose rows carry the compact chronology ("Needs input" pills, a settled joined receipt) while the suspension tenant holds the queue — two pending approvals and a pending ask behind the "Decision n of N" pager — above the busy composer; plus the interactive "Approve settles in place" scene (`data-testid="settle-in-place"`) and the pending-decision gap alert posed over a populated paused transcript (`data-testid="pending-decision-gap-scene"`); the first two transcripts sit on a settled earlier exchange so they genuinely overflow their columns (the composition TVC-146 and TVC-190 pose as two overflowing lists and one content-fit — the gap scene's), and the two overflowing lists photograph bottom-anchored — pills, queue, and composer all stay in frame |
| `captions`       | the model-written caption as the row's label in every state: one caption over running, completed, failed, interrupted, not approved and severed rows — the shimmer or the quiet state word carries the state; not screenshotted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

The probe pages sit beside the scenarios: `?late-approval-probe` (large
late-arriving card, the shelf-less inline mode), `?scroll-guards-probe`
(scrolled-away streaming, composer growth), `?activity-shelf-probe`
(shelf population stealing viewport while pinned and while scrolled
away), `?late-suspension-probe` (the same giant late approval arriving
through the suspension slot — TVC-067's stimulus),
`?subagent-defocus-probe` (the drill-in × roster exclusion and the
hidden-anchor collapse scenes, on conversation-view's real hook
structure) and a drill-in scene on the `shadow-probe/` page (TVC-076,
beside TVC-102's primitives). The shadow-probe page mounts the real
`<teaflask-assistant>` from the built `dist/element/assistant.js`
(keyless — the probe renders its scene into the artifact's own wrapper),
and TVC-103 pins that the artifact, not a reproduction, styles it.
Fixture data is synthetic TeaFlask content only — never copied from any
other product.

## 6. Geometry helpers

`tests-e2e/helpers/geometry.ts` is the shared assertion vocabulary the
specs call; add to it rather than copy-pasting measurement blocks.
Helpers are font-independent (bounding boxes, not text metrics) and
token-relative (indent steps are measured from the DOM, never hard-coded
pixels): `xOriginsOf`, `expectSharedXOrigin`, `expectStartsAtColumn`,
`expectAlignedToMeasure`, `expectOneIndentLevel`, `expectNoOverlap`,
`expectScrollUndisturbed`, the follow-contract utilities `bottomGapOf`
and `settleTwoFrames`, `openScenario` (the §5 URL contract with its
readiness gates, as one call) with its clock-regime wrappers
`openScenarioAtFixedNow` (frozen Date, for probes that assert a rendered
time label or pose a non-elapsing clock) and `openScenarioAtTickingNow`
(the capture clock), and the TVC-190 capture gate
`expectFollowedListsAtBottom`.

## 7. Screenshot workflow

- Single Playwright project; per-test `page.setViewportSize`. The three
  contract widths: **390** (narrow embedded/companion), **672** (the
  palette measure), **1280** (full page — wider than the transcript
  measure, so centering is exercised).
- The widths are measured **on the scenario surface**
  (`[data-testid="scenario-surface"]`), which spans the full viewport:
  scenario pages neutralize the fixture page's hostile host chrome (the
  bench's `<main>` max-width/padding) so the surface genuinely receives
  the viewport width. The bench and probe pages keep that chrome —
  hostile-host rendering is their point — so their baselines are
  untouched. Inside the surface, the content column is `max-w-3xl` with
  a fixed inset; at 1280 the column centers in the remaining space.
- Light and dark are separate baselines. Active-state baselines are
  captured with animations disabled and `data-reduce-motion` set.
- Names: `tvc-###-<slug>-<light|dark>.png` (Playwright appends
  `-linux`). Existing bench baselines keep their historical names.
- Baselines are **Linux renders from the pinned container**
  (`mcr.microsoft.com/playwright:v1.63.0-noble`) — regenerate via
  `tests-e2e/README.md`'s recipe, never from a bare host. Re-blessing a
  baseline is a design decision and is reviewed as one.
- **The capture clock (TVC-190).** Every SCENARIO capture opens through
  `openScenarioAtTickingNow`: `page.clock.setSystemTime` seeds the same
  starting instant every run — label classification is
  calendar-day-scale (`core/time-labels.ts`), so the seconds a capture
  takes cannot recross a label boundary — while the ticking `Date` lets
  use-stick-to-bottom's mount follow elapse, so every overflowing list
  is photographed at its bottom, the state a production reader actually
  sees. TVC-190 gates every scenario capture on that landed state
  (`expectFollowedListsAtBottom`): a regression of the initial follow
  reds the gate by name instead of silently re-blessing a fixture-only
  top-of-history state. That coverage claim is enforced at the scope it
  states: the gate rides `openScenarioAtTickingNow`'s own body (a
  capture site cannot open ticking and forget the gate), and
  `tvc-meta.test.ts` pins the rest — the fold present in the wrapper;
  the capture spec opening frozen only inside TVC-190's negative control
  and never through bare `openScenario`; every post-open click re-gated
  before its capture, because the wrapper's gate observes the open and
  not what a click grows afterwards; and captures confined to the two
  designated files (`tvc-screenshots.spec.ts`, `transcript.spec.ts`),
  which is the pin that bounds those scans' scope — a capture in a new
  spec fails there until it is enrolled. THE LIMIT, stated rather than
  closed: that enforcement is text-scan-shaped, and a text scan sees
  only the spellings it names. It cannot see a direct `page.clock` call
  (including a refreeze placed between a ticking open and its capture —
  unreachable today: the only three `page.clock.` sites in tests-e2e are
  the two wrapper bodies and TVC-148's documented un-pin, and the
  capture spec's one frozen open is the pixel-free carrier's control
  leg), an interaction spelled other than `.click(` (`.check(`,
  `.hover(`, a `page.evaluate` mutation — the verb list is unbounded, so
  it is not enumerated), or anything in a file the location pin does not
  enrol. A change that adds any of those owns re-deriving the argument,
  not editing it out. The deliberate remainder is the bench pair
  (TVC-150/151, `transcript.spec.ts`): it navigates the plain fixture
  page with no clock call — the browser's real clock is already the
  ticking regime, so its overflowing full-flow list photographs with the
  follow landed (measured: 1188px overflow, 1px gap) and nothing it
  renders is clock-derived — but it carries no TVC-190 gate, so a follow
  regression there reads as a pixel diff against its two baselines
  rather than a named gate error. Its TVC-151 leg really does interact
  before a baseline (`.check()` flips the dark theme) — outside every
  scan, measured landed, byte-stable across runs; it belongs to this
  named remainder. A change adding bench scrollers should extend the
  gate there, not assume this bullet covers it. `openScenarioAtFixedNow`
  (a frozen `Date`, under which a follow wait can never elapse) remains
  for probes that assert a rendered time label at an exact instant or
  deliberately pose a non-elapsing clock — the caller set is a pinned
  census in `tvc-meta.test.ts`, derived by scan: TVC-146's three poses,
  TVC-148's pinned open (un-pinned mid-test to prove the flush), the
  dated-register probe, and TVC-190's negative control. The gate's
  stated premise: no capture scene deliberately poses a mid-history
  reader — a change that adds one must rework the gate, never exempt
  itself quietly.

### The pixel budget is exact

The suite runs at **`maxDiffPixels: 0`** — zero differing pixels, where
"differing" means exceeding pixelmatch's default per-pixel
color-distance threshold (0.2): exactness at the pixel-count level, not
byte equality of the PNGs. A suite-wide ratio budget was rejected, for
reasons that still bind:

- **A ratio's blindness scales with scene area.** At 0.01, the absolute
  budget ranged from ~2px on TVC-159's 14×15 identity-mark crop
  (effectively exact) to ~4,774px on TVC-157's 1280×373 process rail (≈
  eighteen full 16×16 glyphs) and ~39,000px on TVC-150/151's 342×11383
  bench. Negative controls proved the consequence: a todo-glyph swap
  left TVC-157 green and a 28px indent collapse left TVC-158 green,
  while the dom/geometry counterparts (TVC-055, TVC-070) fired. The same
  test at the same number was ten different tests.
- **The container renders deterministically at the comparator.**
  Measured: three consecutive pinned-container runs against the
  committed baselines produced identical per-snapshot diff counts. There
  is no antialiasing wobble to budget for inside the pinned container; a
  container repin re-blesses everything anyway (a new rasterizer moves
  every baseline). If a future repin does exhibit real wobble, loosen
  **per snapshot** with `maxDiffPixels` on that call and a written
  justification, sized well below one glyph — never a suite-wide ratio.
- **An exact budget keeps re-blessing honest.** Under a ratio budget,
  pixels moved legally by a correct render can sit inside the budget,
  and changed-mode `--update-snapshots` then silently keeps the stale
  PNG because the render still _passes_. At an exact budget that trap is
  gone: any drift fails, so changed-mode re-blessing rewrites exactly
  what moved. The capture loops are soft (`expect.soft`) so every
  variant of a multi-variant capture reports, never only the first
  failing one.
- **Dimension mismatches are a weaker net than they look.** Playwright
  hard-fails on a size mismatch regardless of any budget, but that
  protects only auto-height captures; a fixed-viewport clipped scene
  (TVC-158's 1280×720 capture) keeps its dimensions straight through a
  layout collapse. Do not read "the screenshot would catch it — the
  surface would change size" as safety on a clipped scene.
- **Counterparts, not pixels, are most laws' real teeth.** Every
  screenshot law now declares its `counterparts` in the registry (§3) —
  the dom/geometry/pure laws asserting the same property. The empty
  ledgers are the acknowledged pixel-only properties: dark mode (TVC-151
  — no dark-specific law exists anywhere else), the light bench
  composite (TVC-150), and the composer's appearance (TVC-152 — only its
  geometry _relations_ have non-pixel laws). Weakening those three
  baselines or their budget removes those properties' only guard.

## 8. State and vocabulary mapping

The product vocabulary maps onto the package's protocol vocabulary as
follows; design prose speaks the left column, code speaks the right:

| Product term     | Package truth                                                                                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| interrupted      | `ToolCallState "cancelled"` and `"superseded"` (retry-severed) — the row's own Interrupted pill and the fold's interrupted count carry the story (the meta-receipt rows that used to carry it are deleted) |
| declined         | `ToolCallState "refused"` (the door answered and declined; its reason sentence on the row, neutral — never failure)                                                                                        |
| not approved     | `ToolCallState "denied"` (a member declined the approval — the wire's cancelled result joined client-side to the approval markers; "You didn't approve X", neutral — never failure, never interruption)    |
| awaiting input   | a pending approval or elicitation suspended on the call: the actionable surface in the suspension slot, the "Needs input" row in the chronology                                                            |
| stale            | a stale decision: the card's own footer sentence (no transcript line renders — no meta-receipt row)                                                                                                        |
| parked           | `offloaded` (the result pane's quiet shortened-result line)                                                                                                                                                |
| running / active | `input-available`                                                                                                                                                                                          |
| queued input     | `input-streaming`                                                                                                                                                                                          |

**The `todo` vocabulary member.** The fixture matrix names a todo/plan
semantic operation. On the client, `todo` is a resolved vocabulary
member with a distinct checklist mark (**TVC-055**), and the
`operations` scenario's plan-progress row renders the real presentation.
The typed evidence is the authored `icon` annotation token on the
semantic envelope — the package still maps no tool name to any
presentation. Stated plainly so the doc never outruns the code: **no
producer can author `icon: "todo"` today** — the backend's authoring
enum (`ToolCallIcon`, the serving side's tool_call_display module)
deliberately has no `TODO` member, and no todo product event exists on
the assistant; the enum member lands beside its emitter. Until then the
member is forward vocabulary: resolvable by every shipped client,
reachable only from the fixture matrix and tests. Structured checklists,
when a producer ships them, arrive through the tool-view contract
(`tool-views.md`) behind the row's disclosure.

## 9. What this contract deliberately does not do

- It does not restyle anything: it is the gate set, not the visuals.
- It does not add wire fields, migrations, or backend behavior; the
  semantic envelope is the presentation architecture's
  (`presentation-architecture.md`), and the result detail channel is the
  tool-view contract's (`tool-views.md`; the former `ui_spec` channel is
  deleted).
- It does not introduce a parallel component-gallery or testing stack:
  vitest, Playwright, the fixture bench, and the ESLint gates are the
  only harnesses, extended in place.

## 10. Sweep evidence — falsified, or merely unfalsified

The negative-control rule — _a test never seen to fail is not evidence_
— applies to sweeps as much as to individual fixes, and sweeps are where
it is most easily skipped. The recurring shapes: a geometry sweep that
exercises the horizontal axis only, and an inventory that inherits that
as a clean class-level verdict; an accessible-name sweep that renders a
roster on a prop combination no shipping surface produces, so the one
mark-carrying control in the shipping tree is never met; a sweep that
poses only a succeeded row with no summary, so a label fix silently
drops a failed coworker's reason from the accessible name.

In every such case the sweep is written to **confirm** that a class is
clean rather than to **falsify** that claim, and a class-level verdict
is recorded on evidence that never included the breaking case. A sweep
reads as the strongest evidence in this system because it speaks for a
whole class; written that way, it is the weakest.

So, the standing rule for any sweep in this package:

- **Pose the case that would break the class.** Enumerating members and
  observing that they pass is not a sweep; it is a census. For each
  member, ask what input, state, or configuration would violate the
  property — and render THAT, in the configuration that ships.
- **A sweep whose cases all pass is _unfalsified_, not _clean_.** Those
  are different claims, and the difference is the whole point. Record
  which one you are making.
- **A class-level verdict inherits the weakness of its weakest case** —
  and a downstream reader cannot see which cases were posed, only the
  verdict. That asymmetry is exactly how an axis-limited sweep
  propagates into an inventory others then build on.
- **If a class genuinely has no constructible breaking case, write that
  down** — with the reasoning. "No breaking case is constructible
  because X" is a far stronger claim than "we looked and found nothing,"
  and it tells the next reader precisely what would have to change for
  the class to become breakable.
- One control per arm: a sweep whose members can break in more than one
  way needs a control for each, because a single control that can pass
  while one arm is broken is not evidence for that arm.

This is prose methodology, deliberately not a `TVC-###` law: it is a
rule about how evidence is produced, not a checkable property of the
rendered UI, and a registry entry for it would be exactly the kind of
green-by-construction check it exists to warn about.
