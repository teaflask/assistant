# @teaflask/assistant changelog

Entries are written at bump time, while the reasoning is fresh, and
describe the public surface — exports, props, attributes, theme tokens,
host-visible behaviour and the laws that pin it — not the work that
produced them.

**Versioning policy.** While the package is 0.x, the public surface
churns freely: exports, props, and types may be renamed or removed
between 0.x versions, with each change recorded here. At 1.0 the
additive-only freeze switches on: from then the package's public surface
follows the same rule the serving contract already applies to the wire —
changes are additive only; nothing is renamed, removed, or made stricter.

## 0.3.0 — 2026-09-30

0.3.0 is the first published version; earlier 0.x numbers were internal.

### the mark alone is the minimized companion

`<AssistantCompanion/>` no longer speaks. The three speech bubbles ("All
done — take a look.", "Something went wrong — take a look.", and the
waiting-on-you family), the unseen-result attention dot on the mark
(`data-tf-companion-attention` and its "— a finished reply is waiting"
accessible name), the two always-mounted `role="alert"` / `role="status"`
live regions, and the `tf-assistant:<pk>:companion-bubbles` sessionStorage
ledger are all removed: a turn finishing, failing, or waiting on the human
changes nothing in the corner. The minimized companion no longer reads the
activity feed at all; `AssistantActivitySnapshot.lastResult` and
`pendingApprovalCount` stay on `./activity` for hosts that render their
own presence. The drawer's open flag is now page-level state
(`core/companion-drawer-flag`, in memory, module-scoped like the surface
registry) rather than the widget's own, so it holds when a host remounts
the assistant tree between routes. Two rules write it besides the mark's
click: a `builtin.navigate` execution that actually happened opens the
drawer at the destination without moving focus — only an open the
visitor clicked for hands the caret to the composer (a refused path or a
throwing `onNavigate` opens nothing), and an `<AssistantPage/>`-class surface registering
clears the flag for good, so leaving that page by hand lands on the bare
mark. The palette keeps its transient yield: the flag survives and the
drawer returns when it closes.

### the model captions its own tool calls

`ToolCallDisplay` gains an optional `caption`: the model's own few words
for the step, narrowed from the wire's `display.caption` and merged
first-wins like the text fields. When present it is the row's label in
every state — the caption alone while running and when done,
`caption · failed` / `· not approved` / `· didn't run` / `· declined` /
`· didn't finish` otherwise — and the authored sentences are the
fallback. `caption` is also a protocol-reserved argument key: the package
strips it from a tool view's `call.args` and an approval card's
`tool_args`. The transcript fixture gains the `captions` scenario.

### the AG-UI 1.0 chassis and the tool-outcome lift

`@ag-ui/client` and `@ag-ui/core` move 0.0.59 → 1.0.0 (the frontend host
moves 0.0.57 → 1.0.0 in the same change). The 1.0 client enforces its
event schema between the transport and every subscriber, stripping any
top-level field it does not know — the serving wire's five optional
TOOL_CALL_RESULT extras (`error`, `refused`, `cancelled`, `truncated`,
`offloaded`) included. The wire is unchanged; the package's transport
(`ServingReplayStreamAgent.run`) now lifts the extras under
`metadata.teaflask.toolOutcome` before enforcement, and every anchor
recorder reads them there. `./transcript` gains `liftToolOutcome`,
`withToolOutcomeLifted`, `toolOutcomeOf`, the `ToolOutcome` type and the
`RunAgentInput` type re-export so a host's own `HttpAgent` subclass can
pipe its `run()` through the same lift. The client's verifier now fails a
stream that delivers content for a message it never opened (an
`AGUIError`, classified `parse_or_validation` by the stream-failure
telemetry) where 0.0.59 dropped the event with a console warning; the
`orphanedContentDetector` and its `assistant_stream_content_orphaned`
telemetry event — whose only witness was that dropped event — retire with
the drop, and `AssistantTelemetryEvent` loses the
`ContentOrphanedTelemetryEvent` member (the host's telemetry sink hears
about the same stream through `assistant_stream_failed`,
`failure_class: "parse_or_validation"`). Shipped weight grows about 250
KB minified on every entry that carries the transport (zod's `v4` locale
table rides in with the client); the bundle tripwires moved to match.

### one settled fold per work span, views included

A completed turn's uninterrupted work span before its last prose run now
folds into ONE "Worked for …" disclosure even when a step resolved a tool
view (a `teaflask.action` card, a host-registered reading); user-facing
rows still split spans, and a cut-off tail still keeps its trailing fold
(TVC-015/016). Earlier, view-bearing clusters were exempt from episode
unification so their `<details>` state survived the settle; on a real
turn — a failed catalog action, a sentence of narration, then browser
work — that read as two stacked "Worked for …" lines over one user
message and one answer. The view is still one disclosure away: the tool
row inside the fold carries it in its own body, and a host-authored (rung
1–2) row keeps holding itself open for the turn. The fold pass no longer
reads the tool-view registry: `RunFoldsOptions.isViewBearing` and the
split pass behind it are gone (package-internal — nothing public
changes). Open and HITL-paused turns keep the live per-cluster chronology
until the terminal settle. Laws re-cut in registry, prose and carrying
tests: TVC-014 (a merged cluster keeps no disclosure of its own, whatever
its rows resolve), TVC-015 (one settled fold per work span, views
included), TVC-084 (the pure inputs are the rows and the open-tail-turn
bit; the settled episode wears the first live cluster's key).

### declarations that never painted now paint, and a law reds the class

Four hand-written rules in the package sheet read a theme token through
`var()` — `--shadow-tf-control` on the subagent pill's trigger inside a
glass host, `--text-tf-body` on markdown h4–h6, `--text-tf-label` on
markdown inside a tool-view card and its heading ladder. The tokens live
in `@theme inline`, which never emits them as custom properties, so each
declaration was invalid at computed-value time and painted nothing. They
now read through `--theme()` and resolve at build time. Visible: the pill
trigger inside a glass host wears the control wash again (it had no
shadow at all), and markdown inside a tool-view card renders at the 13px
compact register the card intended instead of inheriting its row's 15px.
The child-transcript preview frame drops a `tf:shadow-tf-portal` utility
its own glass rule out-cascaded — no visual change. In the script-tag
element, every Tailwind utility that reads a `--tw-*` chain — every
shadow, border, ring and transform utility — painted nothing on Chromium:
`@property` registrations in the adopted shadow-root sheet are ignored
there and Tailwind's fallback is gated to engines without `@property`.
The element's baked sheet now carries Tailwind's own `--tw-*` fallback
ungated inside the shadow root, so the companion plate's Portal L2 lift,
the buttons' control wash and the hairline borders render in the embedded
widget as they do in the dashboard — and nothing is written to the host
document. A law over the built
sheet (`tests/styles-dead-declarations.test.ts`) now reds on any
fallback-less `var()` the sheet never declares, and on any statically
classed shadow utility a hand-written `box-shadow` rule would kill.

### the settled headline is the cost, nothing else

A settled fold's headline no longer carries outcome tallies (`· 1
failed`, `· 1 interrupted`, `· 1 declined`, `· 1 not approved`). It reads
"Worked for 4s" (degrading to "Worked") and stops; the step that failed,
was interrupted, declined or not approved wears that word on its own
row's pill, where the member who opens the fold reads it. The fold
model's four step counts (`failedStepCount`, `interruptedStepCount`,
`refusedStepCount`, `deniedStepCount`) leave with their last renderer —
`RunFoldRow` is package-internal, so nothing public changes.
Narration folded into an episode sits flush with the fold's headline —
it no longer wears the tool rows' label gutter (law 5).

### agent mode hears the offload stamp

`AssistantTranscript` in agent mode now subscribes the package's
`toolOffloadRecorder` and threads the anchors into the projection, as it
already did for the error, cancel, refusal and denial stamps. Before, an
offloaded TOOL_CALL_RESULT on an agent-mode surface (the playground, the
run viewer, a host's own `AbstractAgent`) rendered the offloader's
model-facing replacement as if the tool had said it; now it renders the
shortened-preview line, matching the store path.

### a row opens for a host view, and only when clean

The row-level placement hold is re-cut: a tool row unfolds by default
only while its turn is current, the call is running or settled clean, and
either a HOST-authored view (registry rungs 1–2) resolved for it or a
decision is anchored to it. The package's built-ins (`teaflask.action`,
`teaflask.command`, `teaflask.docs-search`, `teaflask.file-edit`) and the
default reading no longer open rows, and a failed, not-approved,
declined, interrupted, truncated or offloaded row stays closed whatever
it resolved — the pill names the state. TVC-014 re-cut to match.

### a denser card, a quieter failure

The card vocabulary tightens vertically — 6px row padding, 24px icon
tiles, 8px card radius, 11px badges — and Markdown rendered inside a
card (`[data-tf-tool-view-card] [data-tf-markdown]`) wears a compact
register: label-size type on a 1.5 leading with half-line block margins,
so a document body or a diff cell reads as a record, not as the
conversation. `ToolViewBones` / `boneRows` are skeleton lines (a half-
width title bone over full-width text bones) rather than skeleton rows;
the React prop is `lines`, a 0.x rename from `rows`. The tool row's
failure reading loses its "Error:" label: the pill already says Failed,
so the reason is one quiet sentence (`data-tf-error-reason`).
`teaflask.command` renders as one terminal block — `$ command`, then
stdout, then stderr in the muted register (`data-tf-terminal`,
`-command`, `-output`, `-stderr`) — instead of three labelled panes.
A long list inside a card scrolls in a bounded well: `teaflask.docs-search`
scrolls its hits, and hosts get `ToolViewScroll` (React) / `scrollRegion`
(vanilla) on the main entry. `ToolViewBadge` and `ToolViewFacts` accept
`data-*` attributes. Skeletons draw no edges: `ToolViewBones` and
`boneRows` render the lines alone, never inside a card, and
`ToolViewTitle` is the label a host puts over them (the same label a
card wears).

### one card vocabulary for every tool view

Tool views now share one visual vocabulary (`tool-views/parts-classes.ts`):
a hairline card, list rows (icon tile, title, muted second line, trailing
badge), property rows, a quiet caption row, a scrolling body region, and
skeleton rows. The package's built-ins repaint with it — `teaflask.action`
as request/response property cards, `teaflask.docs-search` as a card of
section rows, the rung-4 argument reading as a property card — and the
same parts ship to hosts as React components on the main entry
(`ToolViewCard`, `ToolViewRow`, `ToolViewFacts`, `ToolViewCaption`,
`ToolViewBody`, `ToolViewBadge`, `ToolViewNote`, `ToolViewBones`), so a
customer's view and ours read as one system. The slot's package-owned
"Result:" heading is gone — a view titles itself. Additive exports; no
removals.

### no more "Technical details"

The tool row's nested "Technical details" disclosure — the raw input
pane and the "Raw result:" pane — is deleted, and with it the untyped
row's raw `Input:` pane. A row's body is its tool view alone: an
authored reading on rungs 1–3, the package's bounded argument reading on
rung 4. `ToolCallPresentation.technicalDetails` is removed — a 0.x
removal on the main entry's exported type, recorded here per the
versioning policy; no host in the tree read it. TVC-020 and TVC-040
retire with the pane; TVC-021 and TVC-052 are re-cut.

### the working fold is the expanded one

A fold is open by default while it is working (it claims liveness, or a
member awaits the member's decision) and collapses — a release on the
same `<details>`, never a remount — the moment its work settles, so a
finished section reads as one "Worked for …" line and every earlier
fold is closed by default. A resolved view, a settled decision and a
failed step no longer hold a fold open (the row-level hold and the
headline's `· N failed` suffix are unchanged); the member's explicit
toggle still outranks every default, permanently for that fold. TVC-010
and TVC-014 re-cut accordingly. Package-internal; no public surface
changed.

### the expanded rail grows to its content

The open activity fold no longer caps its height (`min(45dvh, 24rem)`)
and scrolls internally: the rail is a plain flow container, its fold
masks (`data-tf-fold-below` / `data-tf-fold-above`) and the
follow-on-growth driver (`use-rail-follow.ts`, its settle re-pin
included) are deleted. A long run's steps — and any tool view inside them
— read in the transcript's own scroller, never clipped or scrolled twice.
Package-internal; no public surface changed.

### tool views for first-party actions

Additive on the main entry. `actionToolName(slug)` and
`actionToolViews(bySlug)` spell a registry in the slugs the Actions page
shows; the built-ins' vocabulary is exported for host re-use
(`settledOutcomeNoteOf`, `settledOutcomeNotesOf`, `settledWithResult`,
`pane`, `note`, `actionEnvelopeOf`, `actionFailureOf`, and the
`ActionEnvelope` / `ActionFailure` types). A fourth rung-3 built-in,
`teaflask.docs-search`, renders the `docs_search` tool's hits as a list;
the backend names it beside the tool. The tool-view mount node now carries
the row's compact text register, so a host view inherits its size. On the
wire, an `http_intent` failure's `error` may carry an optional
`detail: {status, code, fields?, fieldsOmitted?}` read off the adapter's typed
error (`ExecutionFailureDetail`, additive per the serving contract). No
removals.

### the companion mark is the host's

The companion mark is a host extension point, like every other surface
of the package, and the package default is no longer a teaflask-served
asset. The Petdex spritesheet companion ("Steep"), its loader, its CDN
default and the nine-state presence→sprite animation machine are gone;
the mark is static everywhere. Under the 0.x removal license above:

- **Removed exports**: `CompanionSprite`, `CompanionSpriteProps`,
  `COMPANION_SPRITE_STATES`, `CompanionAnimationState`,
  `CompanionSpriteStateSpec`, `CompanionManifest`,
  `DEFAULT_COMPANION_ASSET_BASE_URL`, `DEFAULT_COMPANION_SLUG`.
- **Removed props**: the provider's `companion`; `<TeaflaskAssistant/>`'s
  and `<AssistantCompanion/>`'s `companion` and `assetBaseUrl`.
- **Removed theme token**: `companionSize` / `--tf-companion-size` (the
  contract is 21 tokens). The mark's box is the package's: 4rem on the
  perch and above the drawer welcome.
- **Removed element attributes**: `companion`, `asset-base-url`.
- **Removed presence outputs/inputs**: `sprite`, `playOnce`,
  `celebratedTurnId`, `greeted` (`companionPresenceOf`).
- **Added**: the provider's `companionMark?: ReactNode` (read by
  identity, like `toolViews`; rendered on the perch and the
  drawer welcome inside the package's box, where a host node is marked
  `data-tf-host-view` and set to 100% of the box by the stylesheet); the
  element attribute `companion-mark-src` (an image URL; a URL that fails
  to load warns once in the console and falls back to the flask — the
  deleted loader's stance, kept); `AgentIdentityMark size="fill"`. The
  default mark is the TeaFlask flask in the foreground color.
- **Narrowed**: the structural reduced-motion guarantee for the mark now
  covers the package default alone. The sprite never rendered its
  animating variant under `prefers-reduced-motion`, customer-hosted pets
  included; the flask is static by construction, but a host's
  `companionMark` node or a `companion-mark-src` image is the host's to
  hold still — the package cannot stop a GIF, an APNG or SMIL, and a
  CSS rule on the host's root node would promise more than it delivers.
- **The perch is the mark, bare**: no plate, no card, no circle — the
  brand's own silhouette (the flask, or the host's artwork) floats in
  the corner at 4rem inside one 72px hit box, instead of a loose sprite
  cell beside an invisible button.
- **Removed the dismissal flow**: the hide chip on the perch, the
  shrunken re-summon nub, the palette's "Show companion" action, the
  per-key localStorage flag (`tf-assistant:<key>:companion-dismissed`),
  and with them `companionPresenceOf`'s `dismissed` input, its
  `dismissed` machine state, the `nub` chrome and the `nubAttention`
  output. One mark, one size: the companion is always present wherever
  no fuller surface has the floor.

### one subscribe hook for every recorder

The transcript's subscribe idiom exists once. Twelve dashboard recorder
components and stream taps hand-rolled `useEffect` + `agent.subscribe` +
`unsubscribe`; they now mount their subscriber through one package hook,
and the dispose flag the playground's approval recorder had built by
reflection over `AgentSubscriber` is a typed package helper. Additive on
`./transcript-ui` and `./transcript`; no new subpath; no removals. Every
export is earned by a named dashboard consumer (the entry's rule), and
the new `./transcript` leaf imports only a type from `@ag-ui/client`, so
that entry's transport-free closure law holds unchanged.

- `useAgentSubscriber(agent, subscriberOf)` (`./transcript-ui`,
  `components/use-agent-subscriber.ts`): subscribes for the component's
  lifetime and re-subscribes when the agent or the memoized thunk
  changes; the thunk runs on every subscribe so per-subscription closure
  state starts fresh, and a disposable subscriber is disposed BEFORE its
  unsubscribe. Consumers: every marker recorder under
  `components/agent-run/`, the playground's inbox recorders, injector and
  gap witness, and the conversations tree through `agent-run/roster.ts`.
- `disposableSubscriber(inner)` + `DisposableAgentSubscriber`
  (`./transcript`, `core/disposable-subscriber.ts`, new leaf): a Proxy
  over a subscriber whose handlers all return `undefined` once
  `dispose()` has run — the guard a recorder needs when `connectAgent`
  has snapshotted it into a run that outlives the effect that subscribed
  it. Preserves the inner member set and identity, so ag-ui's own
  subscriber filter still finds it. Consumer:
  `agents/playground/approval-request-recorder.tsx`.

### the conversation policies live once, in core

The dashboard playground's conversation-core fork is retired: the
policies its 686-line hook had copied from the conversation store now
live once, in `core/` leaves the store itself consumes, and the hook
composes them over its own door. Additive on `./transcript` plus one 0.x
removal; no new subpath. Every new export is earned by a named dashboard
consumer (the entry's rule), and each new leaf is dependency-free
(setTimeout only), so `./transcript`'s transport-free closure law holds
unchanged.

- `PendingDecisionGapGate` + `GAP_PROBE_SETTLE_MS`
  (`core/pending-decision-gap.ts`): the quiet→loud grace window, with its
  transition table enumerated in the class docblock, is now the ONE gate
  — the store's private `_armGapWindow`/`_clearGapProbe`/`_gapProbe` trio
  was rewired onto it. Deps generalize the settle latch into
  `evidenceSettled: () => boolean`, read at elapse (widget: the
  epoch-connected-once record, which resets per epoch; playground: the
  transcript's monotonic replay-finalized latch). Consumed by
  `use-decision-gap-gate.ts`; the window constant by the playground's
  behavioural gap tests.
- `SettleRefreshScheduler` (`core/settle-refresh.ts`, new leaf): the
  settle re-read's clear-then-set debounce. The store's
  `_scheduleSettleRefresh` delegates; the playground hook replaces its
  settle-nonce effect with one scheduler.
- `probeStopSettle` (`core/stop-settle.ts`, new leaf): the stop's bounded
  fallback probe — sleep a beat, re-check, re-read, times the budget —
  returning whether the "Stopping…" lock should release. Both stops'
  pre-loop check, exhaustion release, and error narration stay with their
  owners (genuinely different: telemetry and refocus on the widget,
  setState and the playground's stop copy on the dashboard).
- `backfilledTurnsOf` (`core/turns-backfill.ts`, new leaf): the
  full-window cursor walk, generic over the turn row so each door's
  generated type walks without a cast; flaky pages degrade to what
  landed, a superseded ask returns null. The store's
  `_adoptOnceBackfilled` collapsed into a one-call consumer.
- The constants each policy rides — `SETTLE_REFRESH_DELAY_MS`,
  `STOP_SETTLE_PROBES`, `TURNS_WINDOW` — now exist once, module-level in
  those leaves, deliberately NOT on the entry: the policies carry them
  and no dashboard code names them (the entry's no-consumer rule).
- `answerablePauseOf`, `reconcileApprovalsWithTurns`,
  `ANSWER_NOT_SENT_SENTENCE` (`core/approval-inbox.ts`, beside the
  `ApprovalTurnRecord` seam they judge): the
  hydrate-from-answerable-pause / reconcile-with-newest pair the
  playground's `approval-recovery.ts` had mirrored from the store, and
  the submit path's shared failure sentence. The store's field-sourced
  `_reconcileApprovals` stays its own — it interleaves display/ask
  hydration the record-seam pair deliberately does not.
- Removed from `./transcript`: `gapSignatureOf` (0.x removal license).
  Its only earned dashboard consumer was the frontend's gate copy, which
  now ships inside the package; the function remains module-public in
  `core/pending-decision-gap.ts` for the gate, the store and their tests.

### the rail's follow pin re-asserts after the frame

One behaviour change, no public-surface change: the activity rail's
follow pin (`use-rail-follow.ts`) schedules a double-rAF settle
re-assertion from each pin, whose fire-time gate re-reads every reader
escape — the follow (re-derived by `onRailScroll`) and an armed reader
toggle — while `running` is deliberately not re-read and the pending
frame survives the end-of-run liveness flip, cancelled only at unmount.
This closes the short-landed-pin class at the unit layer (an engine-true
clamp model, red without the re-pin) and can never move an escaped
reader. It does not close the `tvc-155-states` rail residual — a
sub-pixel clamp whose missing scroll extent arrives later than any
bounded frame horizon with no ResizeObserver delivery — which stays open
at ~1px, cosmetic, and is measured rather than assumed: every
active-states capture carries a read-only fractional-geometry probe
(`tests-e2e/helpers/fractional-probe.ts`) and the contended arm ships
runnable as `scripts/tvc-contended-arm.sh` (`npm run tvc:contended-arm`).
Zero baselines moved. (The rail's height cap, fold masks and follow
driver are deleted in a later entry above, so the residual cannot recur.)

### screenshots capture on a ticking clock

A test-fixture regime change, no public-surface change: the scenario
screenshot captures no longer run under a frozen clock. The frozen `Date`
(`page.clock.setFixedTime`, kept for timestamp determinism) permanently
disabled use-stick-to-bottom's follow machinery, so every blessed scroll
baseline encoded "initial follow never ran" — overflowing lists at
scrollTop 0, a state no production reader reaches. Captures now open
through `openScenarioAtTickingNow`: `page.clock.setSystemTime` seeds the
same starting instant every run (label classification is
calendar-day-scale, so the tick cannot recross a label boundary) while
the ticking `Date` lets the mount follow elapse. `openScenarioAtFixedNow`
is unchanged for the probes that need a non-elapsing clock — a pinned
census in `tvc-meta.test.ts`: TVC-146's three poses, TVC-148's pinned
open (un-pinned mid-test to prove the flush), the dated-register probe,
and TVC-190's negative control. TVC-190 (new, geometry) gates every
scenario capture on the landed state — every overflowing message-list
scroller within 1px of its bottom before a pixel is taken — and the gate
rides `openScenarioAtTickingNow`'s own body; `tvc-meta` pins the regime
(captures confined to the two designated files, every post-open click
re-gated before its capture). The bench pair TVC-150/151 is the
deliberate remainder: it navigates the plain fixture page on the
browser's real clock and carries no TVC-190 gate. Falsified both ways
before blessing: the gate went red on the pre-existing defect under the
frozen clock, and red again when the shipped regime was mutated back.
Eight baselines moved: `tvc-152-composer-{narrow,full}-{light,dark}`,
`tvc-154-approvals-{light,dark}` and the `suspensions` scene's light and
dark baselines. Two orphaned TVC-159 baselines no test writes were
deleted alongside.

### the shrink re-follow waits for a clock that ticks

One behaviour change, no public-surface change: the shrink re-follow
(`ScrollFollowGuards` guard 1) re-lands a reader only on a page whose
clock advances across animation frames, and remembers a shrink that beats
the first proving frame. PREMISE: every follow the library starts for
itself carries `wait: true`, gated on `Date.now() + 1 > Date.now()` —
under a pinned clock that never elapses, the follow machinery never
completes, and `isAtBottom` (initialised `true`, made honest only by that
machinery) sits stale-true with the reader at the top of history; an
unconditional re-landing turns a viewport shrink into a teleport to the
bottom. Geometric forms cannot separate the stale reader from a genuine
fit-content follower (both read scrollTop 0 with no gap), and a follow
call's settlement proves nothing (the escape bail settles one without the
wait ever elapsing), so the proof observes `Date.now()` itself and
nothing else — no call issued, nothing scrolled, no animation registered,
a host's configured initial animation untouched. On live pages the proof
lands on the first frame and the designed re-landing (TVC-124,
TVC-140/141, and the fit-content band none of them pose) is unchanged,
verified by four registered laws (TVC-146…TVC-149, carried by
`tests-e2e/scroll-follow-guards.spec.ts`). The premise and the sweep of
sibling predicates are recorded in `docs/transcript-visual-contract.md`
under the follow contract. Zero baselines moved.

### the headless entry renders the transcript

The transcript read surface on `./headless`: the entry can now RENDER the
assistant's replies, not just drive the conversation — the gap the
headless entry left open (rows had no public binding) is closed. Additive
only; no new subpath.

- `useTranscript(options?: { surface?: string })` returns the new
  `TranscriptSurface`: `rows` (the pure `transcriptRowsOf` projection),
  `displayRows` (rows with the composer's optimistic echo applied — what
  the package chrome renders), the `running` / `turnOpen` /
  `decisionsPending` run-state facts, and the four raw store reads
  (`messages`, `markerAnchors`, `activity`, `turnMeta`) shaped so
  `transcriptRowsOf(messages, markerAnchors, running, turnMeta)`
  type-checks verbatim for a host running its own projection. Mounting
  the hook registers transcript presence with the store (the lease):
  presence GUARANTEES the epoch connects (once, so history paints by full
  replay) and arms the idle re-read. A lease-less store still connects
  while its newest turn is queued/working, on a bounded budget, and that
  connect is the same full replay — history, then the live tail. What it
  never gets is a connect while no turn is live: a reopened settled
  thread's messages stay empty without the hook.
- The derivation is not new code: it moved verbatim from the package
  chrome (`components/transcript.tsx`) into
  `components/use-transcript.ts`, and the chrome now consumes the same
  hook — one composition, zero behaviour change, pinned by the existing
  transcript-status-composition suite (severing the decision wiring
  inside the hook was proven to fail three of its cases).
- The entry re-exports the projection values (`transcriptRowsOf`,
  `withPendingUserEcho`) and the row/field types the nameability law
  demands: `TranscriptRow` and its seven members (`UserMessageRow`,
  `AssistantTextRow`, `ReasoningRow`, `ToolCallRow`, `SubagentGroupRow`,
  `TurnFailedReceiptsRow` — newly exported from its core module, it was
  always a member of the public union — and `SubagentDeliveryRow`),
  `PendingUserEcho`, `Message`, `MarkerAnchorsSnapshot`,
  `AnchoredTurnFailReceipts`/`AnchoredReceipts`, `DeliveredResult`,
  `MemoryUpdated`, `BlockTiming`, `ToolCallDisplay`, `ToolCallState`,
  `ToolCallSchemas`, `TurnUsage`, `DispatchReceipt`,
  `SubagentGroupEntry`, `AssistantActivitySnapshot`,
  `AssistantActivityResult`, `TurnStatus` and `UserTurnMeta`. Where a
  name is also on `./transcript` (`transcriptRowsOf`, `TranscriptRow`,
  `Message`, `MarkerAnchorsSnapshot`, `ToolCallDisplay`,
  `SubagentGroupRow`, `SubagentGroupEntry`, `DispatchReceipt`) it is the
  same symbol, so those may be imported from either entry; the rest are
  public only on `./headless` (several row members also ride
  `./transcript-ui`).
- The transport ruling, recorded: the DERIVATION is transport-free (its
  projection inputs are pure core modules that import neither transport
  nor chrome), but a binding to a live store is not and cannot be — the
  provider constructs the transport — so the surface lives on
  `./headless`, whose declared bundle law already carries the store and
  transport. `./transcript`'s transport-free closure law is untouched and
  was not widened.
- The README's "Bring your own frontend" section widens its claim
  accordingly, and — a pre-existing drift found while editing, not caused
  by this change — its `./transcript` scope note is corrected from
  "thirteen anchor fields / five families / the other eight" to the
  machine-checked counts (fifteen / six / nine at this entry; fifteen /
  seven / eight today, the string-receipt family having joined since —
  the source note in `src/transcript.ts` is counted by
  `tests/tool-call-state-sites.test.ts`).
- The remaining anchor-recorder families (eight today) stay on
  `./transcript`'s future additive surface, deliberately: a headless
  host's store populates the anchors itself, so end-to-end rendering from
  this entry needs no public recorders — they matter only to an own-wire
  host composing its own store from `./transcript`.

### every law declares which transcript it binds

Documentation and test-registry metadata only; no behaviour change.

- `docs/presentation-architecture.md` is reconciled with the shipped
  tool-view program: the founding law narrows (the package never knows a
  CUSTOMER's tool catalogue; its own tools ride the same opaque-key seam
  under the reserved `teaflask.*` namespace), Layer A's closed "no host
  can replace them" becomes open-everything-guard-by-contract with the
  actual guards named (package-held decision controls, the slot's
  imperative isolation, the binder-scoped TVC laws), and the envelope and
  consumer tables state the shipped payload (five fields at this entry;
  `caption` joined later, its entry above), the schema channel, and the
  four-rung ladder exactly. `docs/detail-surfaces.md` records the
  reserved `detail {kind, data}` seam as RESOLVED — a view receives the
  call's parsed args and result (and schemas) directly, so a second wire
  channel would be a parallel spelling of the same facts.
- Every TVC law now declares which transcript it binds:
  `binds: "any-transcript" | "package-binder"` on every registry entry,
  enforced by the meta-test (declaration and membership over a loose
  runtime read, both tokens in live use, committed negative controls, a
  verbatim token pin into the contract doc, and an exact `package-binder`
  census — a one-word re-scope in either direction fails the build until
  the pin is edited beside it). The line is drawn in the contract's §3: a
  host slot need not satisfy package-binder laws, and may not escape the
  any-transcript floor — mandatory error/interrupted status,
  package-owned approval controls, redaction and link policies. Two
  wording-only renouns: TVC-020 and TVC-115 shed the retired renderer
  vocabulary in lockstep with their prose halves. No law added, none
  retired, no assertion weakened.
- The versioning policy above is new — recorded here and, in one
  sentence, in the README's Contract section.
- `docs/tool-view-registry.md` carries the host-DOM contract:
  `data-tf-host-view` marks every slot where host-authored DOM renders
  inside the widget root, and the stylesheet's box-sizing + border-color
  reset excludes everything under the marker.
- Package comments the reconciled prose contradicted are corrected in
  place: the approval banner reads no presenter slot; the founding law is
  stated as amended everywhere it is stated; every "five slots, all
  inside a boundary" universal carries the input slot's deliberate
  unbounded exception; and the link rule's reach is stated as
  unconditional (`target="_blank"` + `rel="noreferrer"` on every
  transcript-markdown anchor, internal and external alike).

### one approval trio, shipped from the package

The approval trio is one implementation: the dashboard's playground
deleted its forks of the approval inbox, the approval card, the argument
summary, the question panel and the question drafts, and consumes the
package's. Two public entries grew to make that possible; three
producer-less internals kept as the forks' parity twins were retired
with them.

- `@teaflask/assistant/transcript` now exports `ApprovalInbox`,
  `approvalInboxRecorder`, `SERVING_APPROVAL_CAPABILITIES`, the types
  `ApprovalCardModel`, `ApprovalCardStatus`, `ApprovalDecisionInput`,
  `ApprovalInboxCapabilities`, `ApprovalTurnRecord`; the predicates
  `approvalAwaitsMember` and `elicitationAwaitsMember` (the one
  definition of "this decision still waits on the member", for a host's
  placeholders, busy gates and row holds); plus `QuestionDraftStore` and
  the question-set card types (`QuestionSetCardModel`,
  `ElicitationCardModel`, `AnsweredQuestions`, `ElicitationCardStatus`).
  React-free and transport-free like the rest of the entry. (This list
  was reconciled mechanically against the entry's export diff from the
  merge base: fifteen additions, no removals; `./transcript-ui` below: six
  additions, no removals.)
- `@teaflask/assistant/transcript-ui` now exports `ApprovalCard`,
  `ApprovalsContext` (+ `ApprovalSurface`), `QuestionPanel` and
  `ElicitationsContext` (+ `ElicitationSurface`).
- `ApprovalInbox` takes optional capabilities, all defaulting OFF:
  `anchoring` (stamp `anchored` from streamed TOOL_CALL_STARTs), `gate`
  (carry the wire's `gated`), `trust` (carry `trust_available`, which is
  what makes the banner offer "Approve for this conversation"). A host
  wiring none gets a working inbox with fewer powers; the package's own
  store passes `SERVING_APPROVAL_CAPABILITIES`.
- `hydratePendingApprovals` / `reconcileWithTurn` take the lenient
  `ApprovalTurnRecord` — every pause field optional, absent meaning "no
  judgement" — so a door serving no turn record (or an older one) is
  never demanded data it cannot supply. The serving turn and the
  dashboard's internal turn both satisfy it structurally.
- `ApprovalDecisionInput` moved from the conversation store to the inbox
  module (the store re-exports it; nothing public changed).
- Internal retirements, nothing public: `ToolArgumentsSummary`'s
  `variant` prop and `CARD_SECTION_CLASSES` (the row grammar is the one
  reading now), and `stablePrettyPrint` in `components/pretty-print.ts`
  (`prettyPrintParameters` stays exported).

### a declined approval reads "Not approved"

A call a member declined to approve now reads **"Not approved"** with the
headline "You didn't approve X" — its own `ToolCallState`, `denied`, distinct
from `cancelled` ("Interrupted" / "Didn't run X", which a denial used to wear
because the wire stamps a denied call's receipt `cancelled` like any tool that
never ran) and from `refused` ("Declined", the door's own answer, TVC-038).
No wire change: the state is a client-side join of the two durable approval
markers — `approval_requested{interrupt_id, tool_call_id}` and
`approval_resolved{interrupt_id, approved:false}` — folded into a ledger on
the resume store, so live, reconnect and a reloaded settled thread render it
identically (law 9). It never reads the approval card list, which prunes at
the very result this state reclassifies.

- State ladder (TVC-082, amended): errored beats **denied** beats cancelled
  beats refused beats result-present beats superseded beats running. A
  recorded failure still outranks everything; denied outranks cancelled
  because the wire carries a denial as a cancel.
- Fold summary: a fourth suffix, `· N not approved` (its own count, plain
  ink, never forcing the fold open — each suffix wears exactly its pill's
  word). Not counted as failed or interrupted.
- The approval banner's settled note for a denial now reads "Not approved —
  the assistant has been told." (was "Denied — …"), so banner and row say
  one word for one fact. The `DENIED_NOTE` identifier is unchanged.
- `@teaflask/assistant/transcript` gains the denial family:
  `EMPTY_TOOL_DENIAL_LEDGER`, `toolDenialRecorder`,
  `withToolDenialMarkerFolded`, and the `ToolDenialLedger` /
  `ToolDenialMarker` types; `MarkerAnchorsSnapshot` gains the optional
  `toolDenialAnchors` member.
- New law TVC-039 (the not-approved register); TVC-155's screenshot ledger
  cites it — the `states` scene poses the denied row under the cancelled one.

### a headless entry, per-surface error boundaries, a prefixed stylesheet

Host-facing changes:

- A new `./headless` subpath — the bring-your-own-frontend entry: the
  provider plus the live-session hooks (`useAssistantConversation`,
  `useConversation`, `useApprovals`, `useElicitations`, `useCell`) and
  the types their values are made of. The three conversation contexts now
  provision at `<TeaflaskAssistantProvider>` rather than inside the
  package chrome, so the hooks work with no chrome mounted. The serving
  machinery (conversation store, token session, persistence) stays
  private.
- Every package surface in the shipping composition now renders behind an
  error boundary: the exported chrome roots (`AssistantPage`,
  `AssistantPalette`, `AssistantCompanion`) are self-wrapped backstops,
  and the interior surfaces (message list, tool rows, the decision
  surfaces — per presented decision, the composer, the welcome, the
  history menu, the status region, the activity overlay and shelf) each
  degrade alone. A throw turns that one surface into a small card
  (deliberately unthemed — its appearance is inline literals, so it stays
  legible on any host surface, dark pages and chrome roots included) —
  except the palette and companion (overlay mounts) and the sr-only
  status region (visually empty), which degrade silently instead of
  leaving a stray in-flow card on the host page. Either way the throw
  still reports through the provider's `onError` and still names the
  failed surface in the console. A tool row's boundary covers its
  view-model projection too, so a poisoned row degrades one row, not the
  list. The transcript backstop is keyed on thread + reconnect nonce, so
  a thread switch or Retry clears a latched card; the full
  placement-and-reset ledger is `tests/surface-boundary-census.test.ts`.
- The stylesheet's Tailwind utilities are prefixed (`tf:flex`, selector
  `.tf\:flex`) — `dist/styles.css` no longer ships generic class names
  like `.flex` or `.container`, so hosts import it with no cascade-layer
  quarantine. Prefixed utilities read `--tf-`-namespaced theme variables
  (e.g. `--tf-radius-lg`), which hosts may set to theme the widget; the
  package's own rendered appearance is unchanged. `prefix()` does not
  scope `@keyframes` names, so the two default-theme animations the
  widget uses are shipped package-named (`tf-pulse`, `tf-spin` — same
  values, new global names): a host's own `@keyframes pulse`/`spin` is
  never overridden, whatever the import order. The sheet's full
  global-name census (keyframes, `@property`, layer names) is pinned in
  `tests/styles-prefix.test.ts`.
- The README documents the headless entry, a browser support floor, SSR
  under Next.js, and the accessibility posture, and its install/contract
  links match what actually ships in the tarball.
- `data-tf-host-view` marks every slot where HOST-authored DOM renders
  inside the widget root — the tool-view adapter mounts
  (`tool-view-slot.tsx`, the row body div and the icon span),
  `renderChrome`'s output (`assistant-page.tsx`) and the page
  `welcomeMark` (`conversation-view.tsx`); a host `companionMark` node
  joined the marked set with the companion entry above — and the
  stylesheet's `[data-tf-assistant]` box-sizing + border-color reset
  excludes everything under the marker
  (`:where(*:not([data-tf-host-view] *))`, specificity-pinned). Inside a
  host view the widget no longer supplies `box-sizing: border-box` or the
  hairline `border-color`, so the host's own stylesheet reaches its
  content untouched. Documented in `docs/tool-view-registry.md`.

### the approval card is a banner

The approval card is now a banner (`docs/tool-views.md`, "Approval is a
banner"): it asks one question — the backend-authored consent sentence
over a mechanically spelled tool label — and no longer presents the tool
call. It keeps the decision controls (Approve / Approve-for-conversation
/ Deny-with-feedback), the status notes (parked, gated, submitting,
answered, stale, and the submit-error sentence), and gains a "Show
request" affordance that scrolls to the call's transcript row. It loses
the argument summary, the technical-details disclosure, the operation
icon, and the `ApprovalCardAnchor` display join that existed only to feed
them.

- Why the consent boundary may move (recorded in the component's doctrine
  comment): informed consent is carried by the transcript row, which a
  pending decision always opens — the placement hold, from the durable
  decision-anchor fold, replay- and reload-identical — and the earlier
  re-ask rule ("ask again iff the card would render differently") was
  doctrine in a comment, never a mechanism: trust is recorded by EXACT
  tool name (the vended SDK's `hitl:trusted_tools` is a plain list of
  tool-name strings in agent state) and no argument digest exists
  anywhere in the codebase (no trust key, storage column or inbox key
  derives from a call's arguments). Executable tie:
  `tests/approval-consent-placement.test.tsx` joins row-open,
  arguments-on-the-row and banner-argument-free in one mount.
- Internal deletions, nothing public (no package entry exported them):
  `ApprovalCardAnchor`, `withOrphanDisplayAnchors`, the `anchor` prop,
  and the display join through Transcript → SuspensionSurfaces and the
  shelf-less MessageList path. `ApprovalCard`'s whole signature is now
  `{ card: ApprovalCardModel }`. The row-less recovered pause keeps its
  banner (re-posed test) but no longer resolves an icon;
  `pending_approval_displays` still hydrates the resume store for ROW
  rendering, unchanged. `SuspensionSurfaces` (internal) lost
  `anchorByToolCallId` and kept `rowIndexByToolCallId` (queue order).
- New internal row hook: the tool row's disclosure root wears
  `data-tf-tool-call-id` (via a new optional `rootDataAttributes` on the
  `Disclosure` primitive — undefined elsewhere, zero DOM change), which
  the banner's Show-request affordance resolves scoped to the closest
  `[data-tf-conversation]` (shadow-root safe, concurrent-surface safe).
  The affordance ESTABLISHES the state it needs: both collapses are
  member-reachable and sticky by the placement rulings, so the click
  imperatively opens the row and every enclosing fold before scrolling; a
  member-initiated reveal, categorically different from a hold
  re-asserting itself over a member's toggle. Scroll only, reduced-motion
  respecting, no focus move; a missing row is a quiet no-op — and on a
  row-less REST-recovered pause the button is PRESENT but inert, the
  stated accepted cost: gating it on DOM presence would make the render a
  function of the mount environment, against the purity law, and
  re-introduce the deleted row join as a DOM probe.
- Result-label correctness: the slot's "Result:" heading no longer prints
  over rung-3 package built-ins — they lead with REQUEST panes and
  self-label their settled halves ("Response", "Output"), so the heading
  was a false claim over the request pane and a duplicate over the
  response pane. Rungs 1–2 keep the heading (a host view is treated as a
  result reading — the premise is stated at the gate). New pin: a rung-3
  built-in mounted THROUGH the row and slot (`tool-row-states.test.tsx`),
  the path the adapter unit tests never exercised; red-proven by
  reverting the gate.
- Laws amended, registry + prose + carrying test in lockstep: TVC-063 (a
  generic approval banner leads with fixed consent copy and a mechanical
  tool label and asks exactly one question; arguments never render on the
  banner — the open row carries the request), TVC-067 (the banner never
  exceeds the decision well's budget; a giant consent prompt scrolls
  within the banner, controls reachable, composer un-overlapped — the
  bounded request contents left with the reshape). TVC-060, TVC-061,
  TVC-062, TVC-064, TVC-066 and TVC-101 verified unchanged. No ids added
  or retired. Negative controls: the banner re-mounting an argument
  summary reds TVC-063 (+2 sibling pins); dropping the stylesheet's
  max-height is caught by the styles pin and the amended TVC-067.
- The stylesheet's `[data-tf-approval-card]` rule keeps the well's
  host-aware budget and the whole-banner scroll, and drops the
  flex/summary-shrink machinery (no shrinkable middle any more);
  `[data-tf-approval-text-preview]` stays — its home is the rung-4
  default view.
- The `data-tf-approval-footer` and `data-tf-approval-show-request` hooks
  are deliberate keeps: the package's data-tf-* identity posture names
  each surface region for tests and host CSS — both are now selected by
  approval-card.test.tsx like the banner's other hooks, and the footer
  div carries a comment saying it is identity, not layout. (The deletion
  route was costed and declined: removing the wrapper is a DOM change on
  a surface eight blessed baselines capture, for no consumer's benefit.)

### the transcript surface ships as ./transcript-ui

A new `./transcript-ui` subpath: the transcript surface itself —
`<AssistantTranscript/>`, one component the package's own `Transcript`,
the dashboard's agent-run viewer, and the playground all bind over. A
React entry deliberately separate from the React-free `./transcript`
projection: a host that only projects rows never pays for React. Added
to the public surface:

- `AssistantTranscript` with two source modes as a discriminated union —
  agent (`AbstractAgent` in: the component owns the six-recorder
  subscription, connect/teardown, and the block projection, bracketed by
  the host's marker composite at declared boundaries) and rows (the store
  path, a straight pass-through) — plus the source types.
- The five host slots, each mounted inside the package's slot boundary
  with the package rendering as its fallback and every mandatory frame
  element outside it: `messageView`, `toolRow`, `input`, `welcomeScreen`,
  `threadList`. Deliberately no row/icon/artifact renderer slots —
  per-tool presentation is the tool-view registry's (docs/tool-views.md).
- The slot contracts (`TranscriptMarkerProps`, `TranscriptSlotRow`,
  `ToolRowSlotProps`, `MessageViewSlot`, `ToolRowSlot`) and the type
  re-exports a binder types its fills against (`MarkerBoundaries`,
  `TranscriptRow` and its slot-eligible members, `ToolCallRow`,
  `ToolCallState`, `ToolCallViewModel`, `ApprovalCardModel`,
  `TurnAttachment`).
- `AgentIdentityMark` and `AgentIdentityRegister` — the dashboard's fork
  was a class-helper rename away and is now a re-export shim of this.

### a view knows the shape of its call

Schemas on the props (`docs/tool-views.md`, "Knowing the shape"): a
mounted view can now know what its `args` and `result` look like.

Added to the public surface:

- `ToolViewCall` gains optional `argsSchema` / `resultSchema` — the
  tool's registered JSON Schemas, verbatim from the wire. Absent
  (`undefined`, never `{}`) when the tool declares none, on uncataloged
  tools, and on histories recorded before the channel existed; a view
  must degrade, never demand. Complementary to the `TArgs`/`TResult`
  generics (the typed door), not collapsed into them.
- Type `JsonSchema` (`Record<string, unknown>`) — the two fields' type.
- `ToolCallViewModel` gains the same optional pair (the presenter's
  input surface).

Delivery (internal, both directions of the wire): a new tool-schema
anchors map fed by the `tool_call_annotated` marker's schema siblings
(every executed cataloged call, replayed verbatim on recovery) and by the
approval cards' `toolInputSchema`/`toolOutputSchema` (previously
populated but unread, now consumed), so pending and denied calls know
their shape too. Identity-stable per call by the map's first-wins merge;
the mount slot's delivery guard compares the two fields by reference.

### custom elements take tool views

- Both custom elements gain the `toolViews` host property — the same
  `ToolViewRegistry` as the provider prop, assignable before or after
  upgrade, scoped per element, sanitized at the door (reserved
  `teaflask.*` keys and wrong-shaped registrations drop one by one with a
  named console warning).

### a view renders in its row, and the fold opens for it

Placement (the tool-view contract's row/fold behaviour,
`docs/tool-views.md`): views render in the tool row's body for the
call's whole lifecycle, and the fold opens instead of the view being
promoted out of it.

- A call resolving a view on rungs 1–3, or awaiting a decision (view or
  not), opens its own row and its containing fold on arrival; the hold
  lasts while the fold's turn is current and decays — a programmatic
  release to native `<details>`, never a remount — when the next user
  turn begins. Derived positionally from the row model (the last
  user/subagent-delivery row), never a clock: replay-identical.
- A member's explicit toggle of the fold's own summary outranks every
  hold, permanently for that fold — including the pending-decision hold
  (the imperative re-open listener that used to fight the visitor's
  toggle through a pause is deleted) and the failure arm. The one ranking
  delta: a FIRST failure arriving after a member's toggle no longer
  forces that fold open.
- View-bearing clusters are exempt from episode unification: `runFoldsOf`
  takes an injected `isViewBearing` predicate (the caller's registry join
  — MessageList supplies the same `resolvedToolViewsOf` resolution the
  row's presenter runs), and a view-bearing cluster keeps its own fold
  under its live key so the member's native open state survives the
  settle. The prose-run arithmetic (TVC-016) is untouched.
- The row's rung-4 terminal override ("This result could not be
  displayed.") and its output gate are removed — both existed only to
  hold pixels for the placement work. The slot's own terminal
  (`DefaultToolView`, the bounded argument reading) is now the only rung
  4, and the `terminal` prop left `ToolViewSlot` with its only producer
  (package-internal; `ToolViewSlot` is not exported). The `Result:` label
  renders only once an output has landed. Unregistered tools are
  unchanged: input pane only, no rung-4 card (TVC-021/TVC-111).
- Laws amended, registry + prose + carrying test in lockstep: TVC-010 (a
  held-open fold wears the expanded reading), TVC-014 (the
  open-on-arrival exception, decay trigger, member outrank, unification
  exemption), TVC-015 (view-bearing clusters keep their own folds),
  TVC-084 (the injected predicate joins the pure inputs). TVC-011
  verified unchanged — the settled register holds for a fold that settles
  open. No ids added or retired.
- The decision hold derives from a new durable anchor family:
  `core/tool-decision-anchors.ts` records the tool call ids an
  `approval_requested` or member-answerable `tool_execution_requested`
  marker named, because the card stores prune at the gated call's result
  and the turn's settle while TVC-014's hold window is the turn. Public
  surface: the `./transcript` entry ships the family's trio
  (`EMPTY_TOOL_DECISION_ANCHORS`, `withToolDecisionAnchored`,
  `toolDecisionRecorder`), `MarkerAnchorsSnapshot` gains an OPTIONAL
  `toolDecisionAnchors` field (absent reads as empty — additive for
  host-built snapshots), and `ToolCallRow` gains `decisionBearing`. The
  kinds vocabulary moved to the dependency-free `core/execution-kinds.ts`
  (reading it through execution-handlers dragged the
  transport/reader/affordance layers into the projection entry's PARSE
  GRAPH, 175→191 modules, against that entry's own transport-free law;
  execution-handlers re-exports, 177 modules after, zero offenders).
  Guarded by a second executable law in `tests/bundle-closure.test.ts`,
  distinct from the entry's existing chunk-level law by measurement,
  verified not assumed: the chunk law pins the SHIPPED bytes and stayed
  green under this violation (tree-shaking dropped the unused transport
  code), so the new law walks the parse graph — an import that
  tree-shakes away is still a dependency — banning transport/, reader/,
  affordances/ and React edges, every clause independently red-proven.
- Design-review fix: the activity rail's fold cue gained a top-edge twin
  (`data-tf-fold-above`, a static mask like the bottom cue) — rows
  opening by default made the bottom-pinned rail clip at the TOP, and the
  unmasked hard crop sliced an Input pane mid-glyph, reading as a
  rendering defect rather than a scroll window.
- Baselines: eight of the 38 PNGs re-blessed in the pinned
  `mcr.microsoft.com/playwright:v1.63.0-noble` container (the pre-change
  control run was fully green there, so the v1.62→v1.63 repin moved
  nothing): `transcript-{light,dark}` (the bench's pinned rail window
  shifted when its awaiting row opened; light moved again by 5 px when
  the top fade landed), the `suspensions` scene's light and dark
  baselines (the opened Needs-input row's chevron — 5/3 px),
  `tvc-155-states-{light,dark}` (the awaiting rows' Input panes plus the
  top fade), `tvc-157-process-rail-{light,dark}` (the top fade on its
  bottom-pinned rail). Two consecutive green container runs after each
  bless; all 38 enumerated file-by-file against `origin/main` from the
  repo root (the sweep falsified first with a planted corruption):
  exactly these eight differ, the other thirty byte-identical.

### the transcript projection ships as ./transcript

A new `./transcript` subpath: the transcript's wire-agnostic projection
layer, exported so the dashboard's agent-run viewer (and any host
composing its own transcript) imports it instead of carrying forked
copies. Added to the public surface:

- `transcriptRowsOf`, the `TranscriptRow` union, `errorTextOf` (the
  Error pane's sentence — exported so the last forked copy of it could
  die), and the type-only `MarkerAnchorsSnapshot`.
- The wire taps `messagesRecorder` and `streamErrorRecorder`.
- The four tool-call anchor families, each as the trio a transcript
  composition wires: `EMPTY_TOOL_{CALL_DISPLAY,ERROR,CANCEL,REFUSAL}_ANCHORS`,
  `withTool{CallDisplay,Error,Cancel,Refusal}Anchored`,
  `tool{CallDisplay,Error,Cancel,Refusal}Recorder`, plus the
  `ToolCallDisplay` type they carry.
- The subagent surfaces (`subagent-rows` and `subagent-roster` whole,
  `coworkerIndicesOf`) and the elicitation narrowing
  (`askQuestionsActionOf`, `QuestionModel`).
- Presentation leaves: `newestAssistantProseIdOf`,
  `prettyPrintParameters`, `humanFileSize` (relocated from the
  attachment chips into its own React-free module; the root surface is
  unchanged — it was never exported there).
- Deliberate AG-UI re-exports (`AbstractAgent`, `HttpAgent` as values;
  `AgentSubscriber`, `Message`, `BaseEvent` as types): a host consuming
  this entry never takes its own dependency on the `0.0.x` `@ag-ui`
  packages.

`elicitationAnswerTextOf`, named in the export ticket, is deliberately
absent: it is retired ask_user vocabulary (deleted with the legacy
`builtin.ask_user` arm) and has no successor.

### tool views replace renderers

The tool-view contract (`docs/tool-views.md`): one view per tool call,
resolved once over four rungs, with a default that always answers.

Added to the public surface:

- `reactToolView` — the React sugar: wraps a component as the canonical
  imperative adapter (`mount → { update, destroy }`).
- `resolvedToolViewsOf` — the resolution ladder's static half, called in
  production only by `toolCallPresentationOf` (the single resolution
  point).
- Types `ToolViewProps`, `ToolViewCall`, `ToolViewAdapter`,
  `ToolViewInstance`, `IconAdapter`, `ToolViewRegistration`,
  `ToolViewRegistry`, `ToolViewResolution`, `ResolvedToolView`,
  `ResolvedToolViewIcon`, `ToolViewThemeMode`.

Replaced (the renderer→view vocabulary settlement — sanctioned
pre-publish, finishing the wire's own rename):

- Provider prop `renderers` → `toolViews`; registration shape
  `AssistantRendererEntry {version, components}` →
  `ToolViewRegistration {version, view?, icon?}` (the inert
  `row`/`artifact` slots retire; icons ride the registration).
- Removed exports: `resolvedRendererOf`, `AssistantRendererEntry`,
  `AssistantRendererRegistry`, `RendererContext`, `RendererPayload` (its
  `data` was a permanently empty record), `RendererSlot`, and
  `ToolCallDisclosure` (the client `disclosure` arm dies producer-less;
  openness derivation landed with the placement entry above).
- `ToolCallDisplay`: `renderer` → `view` (matching the wire), `kind` and
  `disclosure` deleted — a present `kind` is now an unrecognized field to
  ignore, never a display-blanking gate.
- `ToolCallPresentation`: the `renderer` and `disclosure` slots →
  `toolView: ToolViewResolution` (rung 1–3 candidates per role plus the
  assembled `ToolViewCall`; the tool-result/v1 envelope parser now
  produces `call.result`). `toolCallPresentationOf` gains an optional
  `{ awaitingDecision }` third parameter; `ToolCallViewModel` gains
  optional `toolCallId`/`argsText`.
- `ApprovalRequestSummary` (internal) → `ToolArgumentsSummary`, the
  reading behind the new rung-4 `DefaultToolView` (both internal).

### approval renderers, sensitivity and ui_spec leave

The tool-view teardown's client half (`docs/tool-views.md`), sanctioned
pre-publish. Removed from the public surface:

- The `approvalRenderers` provider prop and the `approvalRendererOf` /
  `ApprovalRendererContext` / `ApprovalRendererProps` /
  `ApprovalRendererRegistry` / `ApprovalRendererState` /
  `ApprovalRendererTool` exports — a view cannot approve its own
  operation; the package generic is the one approval surface.
- The `ApprovalCardStatus` re-export, which existed solely for the
  approval-renderer contract (the type survives internally).
- The `ToolCallSensitivity` type and the `sensitivity` presentation slot
  — built, tested, zero producers; returns additively when a real tool
  needs one.
- `ToolCallDisplay.uiSpec` and `technicalDetails.uiSpec` — the `ui_spec`
  result grammar is retired whole; result UI arrives through the
  tool-view contract. `RendererPayload.data` is now an empty record until
  the view contract replaces it with the call.

Four screenshot baselines are re-blessed in this change — regenerated in
the pinned Playwright container per `tests-e2e/README.md`, two
consecutive full green runs before committing — each an intended
deletion, not a regression: `transcript-{light,dark}-linux.png` (the
bench gallery shrank 9834px → 8275px because the typed-result grammar's
showcase slot was deleted, shifting the slots after it upward) and
`tvc-154-approvals-{light,dark}-linux.png` (the approvals surface shrank
3549px → 3311px because the `SENSITIVE_CARD` specimen left and the first
scene was retitled). The other 34 baselines are byte-identical,
enumerated file-by-file before committing.

## 0.2.0 — 2026-08-30

The transcript visual contract and the migration onto it. **Purely
additive**: no removals, renames, or signature changes; existing
integrations need no migration. Old histories render identically
(TVC-114) and unknown new wire tokens degrade safely by construction.

New public runtime API (root entry):

- `toolCallPresentationOf` + `TOOL_CALL_ICONS` — the presentation
  contract: every tool-call surface reads resolved slots (headline, icon,
  status, disclosure, sensitivity, technicalDetails), never the raw
  display envelope.
- `resolvedRendererOf` — the trusted-host renderer registry: hosts
  register React readings per `{key, version}`; unknown keys, version
  mismatches, and throws all fall back to package defaults, and
  package-owned consent surfaces are non-replaceable. _[Since replaced
  whole, before any publish, by the tool-view registry (`toolViews`,
  `reactToolView`, the four-rung ladder) — the tool-view entries above.]_
- `activeFoldElapsedOf`, `settledFoldDurationOf`, `usageIsFinal` —
  replay-stable run timing and usage metadata: identical live, after
  reconnect, and after replay.
- `MEMORY_UPDATED_EVENT_NAME`, `TURN_USAGE_RECORDED_EVENT_NAME` — the
  milestone's new stream-marker names.

New public types: `ToolCallDisplay`, `ToolCallState`,
`ToolCallViewModel`, `ToolCallDisclosure`, `ToolCallIcon`,
`ToolCallPresentation`, `ToolCallSensitivity`, `AssistantRendererEntry`,
`AssistantRendererRegistry`, `RendererContext`, `RendererSlot`,
`RendererPayload`, `BlockTiming`, `SegmentDuration`, `TurnUsage`,
`MemoryUpdated`, `ApprovalSubmitTelemetryEvent`,
`StreamFailedTelemetryEvent`, `StreamFailureClass`. _[Since then
`ToolCallDisclosure`, `ToolCallSensitivity` and the five `Renderer*`
types left with their planes before any publish — the tool-view program's
teardowns; `docs/tool-views.md`, "What was deleted, and why".]_

Behavioral notes (not API): the transcript's visual contract is now a
90-law executable registry (`tests/tvc/registry.ts`) with exact
screenshot budgets _[since grown — ids are never reused, and a retired
law keeps its gap]_; sensitivity-annotated operations fail closed on
every surface, including approval cards (TVC-068/117) _[since then
`sensitivity` was retired producer-less and those laws retired with it]_.

Packaging and peers (amended into this unpublished entry rather than
reconstructed later):

- Every relative specifier in the emitted `dist/` carries an explicit
  `.js` extension, so plain Node's ESM resolver loads the package —
  previously only bundlers could. The exports map keeps its entries (`.`,
  `./activity`, `./markdown`, `./scroll`, `./styles.css`) and gains a
  `default` condition on each JS entry plus `./package.json`. _[The map
  has since grown `./headless`, `./transcript` and `./transcript-ui`.]_
- License: Apache-2.0 (was `UNLICENSED`); `LICENSE` ships in the tarball,
  as do `CHANGELOG.md` and `src/` (the sourcemaps' sources — maps and
  declarationMaps resolve for tarball consumers).
- React peers widen to `^18.3.0 || ^19.0.0`. The ref-taking components
  (`TeaflaskAssistant`, `TfButton`, `TfTextarea`, `TfFileInput`) are
  forwardRef now; `TeaflaskAssistantProps` no longer declares a `ref`
  member — JSX callers are unchanged, and a host reading the props type
  should use `ComponentProps<typeof TeaflaskAssistant>`.
- `engines` is `node >=20` (the npm constraint is gone — meaningless to
  pnpm/yarn/bun hosts). `rxjs` relaxes to `^7.8.0` and the npm-only
  `overrides` block is dropped, so host resolvers can dedupe onto
  `@ag-ui/client`'s exact pin instead of installing two copies.
- `prepack` builds, and `publishConfig` carries public access with
  provenance — prerequisites for the first publish, which landed with
  0.3.0.

## 0.1.0

The pre-migration baseline: conversation core, transcript renderer,
palette, companion, custom elements, and the serving transport. Never
published; recorded here as the surface 0.2.0 diffs against.
