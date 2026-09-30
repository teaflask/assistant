# Decision shelf and composer activity overlay — contract

**Status: accepted.** This document is the placement contract for
decision surfaces and compact activity around the shipping composer. It
extends the presentation architecture (`presentation-architecture.md`)
and the transcript visual contract (`transcript-visual-contract.md`); on
conflict, those win. The landlord component is
`src/components/activity-shelf.tsx`; the laws that pin this region are
TVC-120, TVC-122, TVC-123, TVC-124, TVC-125, TVC-064 and TVC-067 in
`tests/tvc/registry.ts`.

The landlord owns the container. The tenants — the suspension surfaces
(`src/components/suspension-surfaces.tsx`) and the subagent roster — own
only their content, and integrate against this contract — the fixture's
`activity-shelf` scenario keeps the geometry placeholder, and the
`suspensions` scenario and `?late-suspension-probe` page render the real
decision composition.

## 1. Anatomy and stacking order

While relevant, the conversation column reads, top to bottom:

1. the transcript (`MessageList`, the scroller);
2. the **suspension slot** — the active approval or question surface, in
   normal flow;
3. the shipping composer;
4. the **activity overlay** — a transparent, absolutely positioned layer
   anchored to the top edge of `[data-tf-composer-anchor]` (the wrapper
   spanning the shelf AND the composer): the pill floats above the
   suspension slot when it is populated and 16px above the composer when
   it is empty, so it can never sit over a decision tenant's controls;
5. the model/effort controls (`ModelPickerShelf`, the composer's own).

The shelf mounts in `Transcript`'s composition only — the welcome and
empty-state branches mount the composer without a transcript and
correctly have no shelf.

| Hook                                | What it marks                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `data-tf-activity-shelf`            | the in-flow decision-surface landlord                                                                        |
| `data-tf-suspension-slot`           | the suspension slot's flex column                                                                            |
| `data-tf-activity-slot`             | the transparent zero-flow activity overlay                                                                   |
| `data-tf-composer-anchor`           | the shelf+composer wrapper; the positioning anchor for compact activity                                      |
| `data-tf-composer-root`             | the composer's own slab (still live: TVC-122 measures it, and the anchor's flow rules are stated against it) |
| `data-tf-composer-activity-overlay` | explicit hook for the floating overlay                                                                       |
| `data-tf-shelf-item`                | every tenant's root, mandatory                                                                               |
| `data-tf-suspension-surfaces`       | the decision tenant (the queue of actionable surfaces)                                                       |
| `data-tf-current-decision`          | the one decision currently presented (focus target)                                                          |
| `data-tf-suspension-pager`          | the tenant's "Decision n of N" queue bar                                                                     |
| `data-tf-subagent-pill`             | the subagent pill tenant                                                                                     |
| `data-tf-scroll-away-activity`      | the live-activity jump affordance (NOT a tenant — see §5)                                                    |
| `data-tf-status-announcer`          | the always-mounted sr-only live region (NOT a tenant — see §8)                                               |

The decision landlord owns only the suspension surface's `max-w-3xl`
measure and inner `px-4`. Compact activity does not rent a row in that
landlord. `ComposerActivityOverlay` is absolute, transparent, and
pointer-pass-through; only the pill opts back into pointer events. Its
presence cannot change the shelf's or composer root's flow position or
paint a full-width strip. In scrollback it yields entirely (opacity 0,
visibility hidden, pointer-events none) to the merged jump affordance —
one float per seam — and returns with the tail. This is the visual distinction between a floating
control and a shelf band.

## 2. Tenancy rules

A tenant is any node rendered into a slot. The rules are binding on
every tenant, the landlord's own included:

- A tenant's root carries `data-tf-shelf-item`. This powers the geometry
  law's item enumeration (TVC-122) and the roster-open defocus rule
  (`styles.css`, §6).
- Suspension tenants render **in-flow content only**: no
  `position: fixed`, no absolutely positioned containers, no writes to
  the follow machinery. Compact activity is the explicit exception: the
  package landlord positions the shared overlay, never the tenant. The
  overlay is zero-flow and pointer-pass-through; the pill and its
  anchored roster are the only interactive/painted objects. There is no
  z-index.
- **A tenant with nothing to say renders `null` — and never a whitespace
  text node.** `:empty` collapses both the decision shelf and overlay.
  The overlay is absolute even when populated, so its contents never
  contribute flow height. TVC-122 proves both facts.
- In-flow tenants wear hairline borders, never shadows ("a shadow is
  earned by floating").
- Copy, motion, and state language come from the shared primitives:
  `ShimmerText`/`Spinner`/the working dot (`streaming-states.tsx`) and
  the presenter slots (`tool-call-presentation.ts`). A tenant that forks
  them fails those primitives' laws.
- **If a tenant needs a capability the slot does not offer, the slot
  grows; the tenant does not route around it.** Extend
  `activity-shelf.tsx` and this document in the same change.
- **The oversized-surface bound (TVC-067).** Beside the pill's
  sanctioned float, the suspension tenant holds the one sanctioned
  tenant SCROLL region: the decision scroll well
  (`data-tf-decision-scroll-well`) — a viewport-relative max-height with
  internal overflow wrapped around the CURRENT decision card alone. It
  keeps a giant late card from swallowing the composer (consent controls
  stay reachable inside the bound, the composer's controls stay on
  screen), the queue bar sits OUTSIDE it so paging context never scrolls
  away, and the fold declares itself (the Scroll-Well Rule's intent).
  Its scroll/resize listeners watch only its own region — the general
  no-scroll-containers rule and the follow-machinery prohibition stand
  for everything else. Below the bound the well is pass-through: no
  scrollbar, no cue, no geometry change. Two rules, both in `styles.css`
  beside their reasons:
  - **The bound is host-sizable, and a host value must hold across the
    whole viewport range.** The default `min(45dvh, 36rem)` is honest
    only on viewport-tied hosts (the full page, the docked pane, the
    edge drawer). A host whose panel is capped independent of the
    viewport sizes the well under its own cap through
    `--_tf-suspension-well-max-height` — and the value needs its own
    panel-relative term, never a bare rem (a bare rem is correct only at
    tall viewports; the palette's panel tracks the viewport below its
    cap, so a fixed 20rem would clip the composer inside a 198px
    landscape-phone panel). The palette (`data-tf-assistant-palette`)
    sets `min(20rem, 100dvh − 25rem)`; the floating companion card
    (`data-tf-panel-dock="floating"`) sets `min(26rem, 68dvh − 13rem)`.
    A new constrained host sets the property the same way, deriving the
    second term from its own height formula minus its chrome+composer
    reserve. TVC-067 probes BOTH host shapes at tall and short
    viewports, wearing the real hooks and real height formulas.
  - **The fold cue is a MASK, never a painted band.** The card's own
    tail fades (`data-tf-fold-below`, receding at the end): under glass
    the material is the ground (the same reason this contract zeroes
    `data-tf-composer-ground` under `data-tf-glass`), so an opaque
    gradient strip would re-introduce exactly that strip inside the
    palette and the floating card.

  (The banner has no shrinkable middle, so a pathological consent prompt
  scrolls the banner as a whole under the same well budget.)

## 3. Slot inventory

- **Suspension slot** (`suspension` prop) — the decision tenant
  (`SuspensionSurfaces`): the ONE actionable surface for the
  conversation's pending approvals and questions, full
  transcript/composer measure, never indented under a process label
  (TVC-060/061 enforced on the card frames; TVC-122 pins the tenant's
  measure). **The queue rule:** one decision presents at a time — the
  current one, in the deterministic order of `core/suspension-queue.ts`
  (transcript position of the anchoring call, orphans last, approvals
  before questions on a tie, arrival within a family) — and when several
  are simultaneously actionable a package-owned "Decision n of N" bar
  with Previous/Next keeps every one reachable (a non-scrolling tenant
  stacking N large cards could exceed the viewport with no recovery). A
  decision is IN the queue exactly while actionable or in-flight
  (TVC-064); paging never acts — reviewing stays visibly distinct from
  consenting, and the only consent controls are the cards' own. The
  fixture's `SuspensionPlaceholder` stays in the `activity-shelf`
  scenario as TVC-122's geometry specimen.
- **Activity overlay** (`Composer.activity`) — a centered VERTICAL
  stack, one item per row, absolutely positioned above the composer with
  zero flow height. The sole shipping tenant is the subagent pill (there
  is no run status line: chrome makes no run-state claims — see §7), and
  the slot collapses to nothing when the pill vacates. The stack rule
  stands for any future tenant: never a shared row — in a row, a
  tenant's horizontal center is a function of its siblings' widths (a
  sibling whose width changes mid-turn would slide the pill, and the
  roster card anchored to it, sideways off the 390px viewport). Stacked,
  every tenant's center is the column's center permanently, so
  **anything a tenant anchors to itself holds still no matter what its
  siblings do** — TVC-125 pins this with the roster open, against a
  fixture-only sibling specimen now that no shipping sibling exists.
  Focus order is DOM order is visual order.
- **`[data-tf-composer-anchor]`** is the positioning anchor, not
  activity chrome. The overlay is the anchor's direct child, a sibling
  of the shelf and the composer root, outside the measured composer
  slab; it may not move, restyle, or wrap the composer's controls or the
  shelf's tenants.

## 4. State composition and priority

The region may simultaneously hold: an active parent run, N running
subagents, a pending decision, a scrolled-away reader, and the stop
control. The governing rule: **render state only where the user can act
on it, and let the actionable thing be its own signal** — chrome never
narrates run state. Composition rules, so nothing flickers, duplicates,
or lies:

| Fact                    | Where it renders                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pending decision        | the suspension slot, always a FULL surface, never a pill — **the surface IS the ask**; no label above it restates the waiting                                                                                                   |
| pending ids, no card    | the conversation view's notice region (`data-tf-pending-decision-gap`, `role="alert"`, with Retry) — the one LOUD state; with no generic wait label left, silence here would hide a real pending decision (the hard constraint) |
| parent run live         | content and kept surfaces only: the trailing fold's own "Working…" headline (TVC-010), the pill's live dots, the Stop control. No chrome status line exists                                                                     |
| run paused on member    | the decision surface itself (above). Nothing else says "waiting" visibly; the sr-only announcer phrases it for screen readers, keyed on the decision surfaces, never on raw status (§8)                                         |
| run paused on subagents | the pill (children running). NOTHING may claim the member is blocking: the wire's `parked` covers both pause producers, and only `pending_interrupt_ids` + the cards distinguish them                                           |
| N subagents             | the pill (its counts, dots, roster)                                                                                                                                                                                             |
| scrolled-away + live    | the jump affordance's activity treatment (§5)                                                                                                                                                                                   |
| stop                    | the composer's own button, never duplicated on the shelf                                                                                                                                                                        |
| run settled             | nothing — transient status disappears; the durable story is the settled fold headline ("Worked for …")                                                                                                                          |

Each tenant keys on its own fact and renders `null` independently, so
composition changes never remount siblings.

**Content vs chrome — the duplication ruling.** The in-transcript
working signals are content, not chrome, and they are all that remains:

- The trailing fold's "Working…" shimmer headline is **content**: it is
  the fold's own label, scrolls away with the fold, and is required by
  TVC-010. It stays — the rule deletes chrome narration, never the
  working/shimmer treatment on active content.
- The `TypingIndicator` gap dot is **chrome standing inside content** (a
  silence-filler where the next message lands) and stays out of the
  Transcript composition (Transcript passes no `typing` to
  `MessageList`) — it would now be the ONLY animated chrome, and still a
  duplicate of the fold's own headline. It remains the silence signal
  for shelf-less `MessageList` hosts: child transcript previews.
- A run status line would be chrome, and none exists: mapping every
  `parked` to "Waiting for your input" lies, because a subagent park
  ships the same `parked` as a HITL pause with zero interrupts — and
  correct copy for a line that should not exist is still noise.

`tests/transcript-status-composition.test.tsx` pins this: no
`data-tf-run-status` node and no chrome working signal in any state, no
"Waiting for your input" text anywhere on the surface, and the
contradiction of a wait label, a busy placeholder and Stop at once is
unbuildable.

## 5. The scroll-away indicator is not a tenant

The "new activity while scrolled away" affordance must live inside the
`StickToBottom` wrapper (it needs `isAtBottom`, and it must float over
the scroller — a flow child would create a second scroll region), so
it is deliberately not a shelf tenant. It is the existing
"Scroll to bottom" button, merged with clear labeling: while the run
is live and the reader is in scrollback it carries
`data-tf-scroll-away-activity`, the accessible name
"New activity below — scroll to bottom", and a working-dot badge. It
never auto-scrolls (activation is the only scroll, and it re-engages
the follow), hides on tail-return, and drops the treatment at settle.
Reduced motion (both switches) leaves a static visible dot. TVC-123
pins all of this; TVC-120 keeps it clear of the composer's controls.

## 6. The defocus rule

The roster-open blur (`styles.css`, "defocuses the conversation") is
two-step: `[data-tf-composer-anchor]` escapes the sibling blur so the
floating overlay stays crisp; within the anchor, its in-flow children —
the shelf's decision tenants and the whole composer root — each recede
exactly once, while the overlay's `data-tf-subagent-pill` disclosure
holder remains interactive. `tests/glass-material.test.ts` pins the
selector text, including a guard against composing a second blur on
shelf items.

## 7. Honesty: the shelf makes no run-state claims

The register rule: **the conversation chrome never narrates run state.**
No status line renders in the activity slot — not "Working", not
"Thinking", not a live elapsed figure, and never "Waiting for your
input". The reasons, recorded:

- The wire's status enum records lifecycle, not who the run waits on.
  `parked` has two producers — a HITL pause that outlived its window
  (`park_turn`, the member's time) and a subagent wait
  (`park_working_turn`, the machine's time) — indistinguishable on the
  wire except that a subagent park has `pending_interrupt_ids == []`. A
  status-keyed label therefore lied ("Waiting for your input" over a run
  that was waiting on its own children), and rewording it would be
  correct copy for a line that should not exist. A fully CONSUMED HITL
  pause also reads `pending_interrupt_ids == []` (the resume that
  carried its answers is already running) — which is honest under this
  discriminator: that pause is the machine's time now, not the member's.
- Work in progress is already conveyed by the kept surfaces: the
  subagent pill and roster, the working/shimmer treatment on active
  CONTENT (the fold's own headline, TVC-010), and the Stop control.
- If something needs the member, the approval or question card is the
  signal — a label above a card that already has Approve and Deny says
  the fact twice. If nothing needs the member, the chrome says nothing.
  When the server names pending interrupts and no card can be built, the
  conversation view's `role="alert"` gap notice is the loud fallback
  (§4) — never a generic wait label, never silence.

Standing sub-rules the deleted line used to host, still binding on any
future tenant:

- **Model and effort:** never rendered on the shelf. The serving wire
  carries no resolved `model_id` (`ServingAgentDispatchResponse`
  withholds it by design — the reader is an anonymous visitor to the
  customer's product, and the org's model choice is not their fact), and
  the visitor's own pick already renders in the composer's
  `ModelPickerShelf` — repeating it in an adjacent control is the
  duplication this contract forbids.
- **Usage tokens:** never rendered on the shelf. `turnUsageAnchors` is
  populated only for playground-surfaced turns (the producer gate in the
  backend's settle path); on the widget and the dashboard concierge it
  is empty forever today. The shelf degrades honestly: the field is
  absent, not zero, not fabricated, not an empty placeholder.
  (`replay-metadata-contract.md`, "The surface gate".)
- **Live elapsed time:** gone with the status line. The settled "Worked
  for …" headline (server-stamped, `core/run-folds.ts`) is the one
  duration story; no chrome stopwatch may return.

## 8. Announcements and reduced motion

- Announcements ride `RunStatusAnnouncer` (`data-tf-status-announcer`,
  `src/components/run-status-announcer.tsx`), an sr-only `role="status"`
  region that Transcript mounts **unconditionally** — empty while idle.
  With no visible status line, the announcer is the ONE holder of the
  status phrases. **The premise, stated:** screen readers announce
  _mutations_ of a live region that already exists in the accessibility
  tree; a node that arrives already carrying `role="status"` and its
  text is initial content of a new region and is generally skipped. The
  executable proxy for the premise is node identity: the announcer tests
  pin that the SAME element holds "" at idle and the phrase after the
  flip, through the real store subscription. A genuine screen-reader
  pass is beyond this harness; that residual risk is accepted and
  recorded here.
- **Honest about who is waited on:** the announcer takes the turn status
  AND `decisionsPending` (`useTranscript`'s `decisionSurfaceLive`, in
  `use-transcript.ts`, derived from the decision surfaces' own
  predicates, never from what rendered). "Waiting for your input" is
  announced only while an actionable decision exists; a pause with no
  pending decision (a subagent park, the execution driver's window)
  announces "The assistant is working". The old status-keyed phrasing
  lied to screen readers exactly as the visible label lied to sighted
  members.
- Throttled by construction: the announcer sees only the status class
  and the decision-live bit, so the phrase changes exactly on idle ↔
  "The assistant is working" ↔ "Waiting for your input" transitions —
  never per streamed token, never per second.
- The announcer lives OUTSIDE the slots on purpose: a permanent occupant
  would defeat their `:empty` collapse; sr-only is absolutely
  positioned, so the empty-shelf zero-height law (TVC-122) is untouched.
- Every motion in this region is one of the shared primitives (the
  spinner, the working dot); both collapse under the OS
  `prefers-reduced-motion` query and the host `data-reduce-motion` kill
  switch, leaving the spinner's required text label and the static dot
  as the non-colour, non-motion signals. No new keyframes were added, so
  no new reduced-motion law was needed (contract law 11).

## 9. Surfaces, widths, keyboard, safe areas

The decision shelf and composer overlay are mounted once in `Transcript`,
and every surface (page, palette, drawer, script-tag) renders the same
composition. The surfaces differ only in the width and chrome handed to
the conversation column. Coverage of the geometry matrix:

- **Widths:** TVC-122 sweeps the three contract widths — 390 (narrow
  mobile; the drawer's `w-104` and the mobile palette land in this
  band), 672 (the palette's `sm:max-w-2xl`), 1280 (the full page,
  exercising the measure's centering).
- **Script-tag:** the decision shelf is plain in-flow content and the
  activity overlay is CSS-absolute inside the composer anchor, with no
  top-layer, scroll, or event machinery of its own; the primitives it
  composes are already proven inside the custom element's shadow root
  under CSP (TVC-102), and the follow guards' shadow-aware listeners
  are untouched (TVC-140–145).
- **Virtual keyboard:** the package's keyboard strategy is `dvh` —
  the keyboard reaches this region as a scroll-viewport height shrink
  with no content change. That resize class is exactly what TVC-141
  (composer growth, enforced) and TVC-124 (shelf growth, both
  directions, pinned and scrolled-away) pin.
- **Safe areas:** compact activity is anchored to the shelf+composer
  anchor's top, not the viewport bottom, and adds no fixed-position
  chrome. The
  composer region's bottom spacing is unchanged, so the existing
  surface-owned safe-area story is unaffected.
