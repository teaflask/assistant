// The transcript visual contract's machine-readable law registry. The
// prose contract is docs/transcript-visual-contract.md; this module is
// its executable index: one entry per objectively checkable law, each
// carried by exactly one test whose title contains the id.
// tvc-meta.test.ts holds the two in lockstep — a law with no test, a
// test with no law, or a duplicated id fails the suite.
//
// Every law in this array is enforced by being registered — there is no
// status field and no parked state. TVC-180 parses every test file
// statically and reds on each way a law's test could be parked (a skip
// modifier, a skipped or conditional group, a runtime skip other than
// the two pinned Linux-only screenshot gates, a declaration nested in a
// branch or helper, a file the runner never selects), and
// tvc-meta.test.ts vouches for TVC-180's own declaration from a file
// the scan excludes, so the gate is a test, not a reported number. A
// law enters the registry with its test running green. Deleting a law
// or weakening an enforced assertion is a contract change that requires
// an explicit PR-description callout.
//
// Every law declares which transcript it binds (`binds`); the two
// bindings and the line between them — what a host slot need not
// satisfy versus what it may never escape — are recorded in the
// contract's §3. Narrowing a law's `binds` from `any-transcript` to
// `package-binder` shrinks its reach in one word, so it takes the same
// explicit PR-description callout as weakening an assertion — and the
// meta-test pins the exact package-binder census, so no re-scope, in
// either direction, can ride a diff silently.

/** Which harness carries the law's test. */
type TvcLayer = "pure" | "dom" | "geometry" | "screenshot" | "lint";

/** Which transcript the law binds. `any-transcript`: any
 *  transcript projected from the event history — the store binder and
 *  the agent binder alike, host slots included. `package-binder`: only
 *  the package's own widget — its chrome, geometry, pixel baselines,
 *  budgets, and gates. The line between them is drawn in the contract's
 *  §3; `binds` classifies laws, it never weakens one. The array is a
 *  value (not a bare type like the unions above) so the meta-test can
 *  hold membership at runtime. */
export const TVC_BINDINGS = ["any-transcript", "package-binder"] as const;
type TvcBinding = (typeof TVC_BINDINGS)[number];

export interface TvcLaw {
  id: string;
  /** The one-line machine assertion the id's test expresses. */
  assertion: string;
  layer: TvcLayer;
  binds: TvcBinding;
  /** Screenshot laws only (the meta-test holds this shape): the
   *  dom/geometry/pure laws asserting the same visual property without
   *  pixels. The pixel layer's blind spots are measured (see the
   *  contract, §7) — a screenshot law's real enforcement often lives in
   *  its counterparts, and an EMPTY list is an acknowledged gap: that
   *  property is pixel-pinned only, so weakening its baseline or budget
   *  removes its only guard. */
  counterparts?: readonly string[];
  /** Screenshot laws only. The meta-test's decade-completeness rule:
   *  once a ledger cites any law from a decade, every OTHER enforced
   *  non-screenshot law of that decade must be placed — cited above,
   *  or excluded here with a written reason. This is what makes a
   *  later-minted decade-mate impossible to omit silently (the exact
   *  way the since-retired 068 law went missing from TVC-154's
   *  ledger); which side of the line a law lands on stays a reviewed
   *  human judgment. */
  counterpartExclusions?: readonly { id: string; reason: string }[];
}

export const TVC_LAWS: readonly TvcLaw[] = [
  // --- 00x · voice ---------------------------------------------------------
  {
    id: "TVC-001",
    assertion:
      "A process row's label renders on a smaller type-step token than assistant prose body text.",
    layer: "dom",
    // Measured against the package's own type-step tokens.
    binds: "package-binder",
  },

  // --- 01x · run folds -----------------------------------------------------
  {
    id: "TVC-010",
    assertion:
      "While activity is live the fold's headline is one shimmered work label: expanded (the default while working), the generic “Working…” — the rail below says what the steps are; collapsed by the member, the latest step's own label (the generic “Working…” when no step is usable); never a settled duration.",
    layer: "dom",
    binds: "any-transcript",
  },
  {
    id: "TVC-011",
    assertion: "A settled fold's headline carries no step count.",
    layer: "dom",
    binds: "any-transcript",
  },
  {
    id: "TVC-012",
    assertion:
      "A settled fold's “Worked for …” duration derives from server-carried run metadata, and the same event history renders the identical settled label live, after reconnect, and after replay.",
    layer: "pure",
    binds: "any-transcript",
  },
  {
    id: "TVC-013",
    assertion:
      "The active fold's motion is the one shared shimmer primitive; a settled fold carries no motion.",
    layer: "dom",
    binds: "any-transcript",
  },
  {
    id: "TVC-014",
    assertion:
      "The working section is the expanded one: a fold is open by default while it claims liveness or a member awaits the member's decision, and folds on the same element once its work settles; every earlier fold is closed by default. A host-authored view (rungs 1–2) or a decision holds the affected ROW open for its turn while the call runs or settles clean (released at the next user turn); a package built-in or the default reading never opens a row, and a failed, not-run or degraded (truncated, offloaded) row is closed by default whatever it resolved; a failed step forces nothing open. A member's explicit toggle outranks every default, permanently for that fold. Native disclosure state preserves the visitor's choice across settling for the folds that survive it — episode unification keeps each surviving fold's key (TVC-084), while a cluster merged into an earlier fold's episode — whatever views its rows resolve — does not keep its own disclosure — and transcript chevrons reveal only on interaction or while their own disclosure is open.",
    layer: "dom",
    binds: "any-transcript",
  },
  {
    id: "TVC-015",
    assertion:
      "A completed turn's work before its last prose run — leading and intermediate narration, reasoning, and tool activity — renders as one settled fold per uninterrupted work span, whatever views its tool rows resolve (a view stays inspectable at its own row inside the fold); chronology is preserved inside every fold, work past that run stays in its own trailing cut-off fold, and an open turn keeps the interleaved per-cluster folding.",
    layer: "dom",
    binds: "any-transcript",
  },
  {
    id: "TVC-016",
    assertion:
      "The last maximal prose run of each completed work span renders outside any fold — the final response of a clean settle, the last narration of a cut-off turn — and a prose-only turn renders no fold; position alone decides, never copy inspection or turn status.",
    layer: "dom",
    binds: "any-transcript",
  },

  // --- 02x · semantic view before technical payload ------------------------
  // TVC-020 (the semantic view precedes the raw payload disclosure) was
  // DELETED with the Technical details disclosure it pinned (the
  // working-fold/raw-pane cleanup): a tool row renders no raw wire pane,
  // so there is no payload for a reading to precede. The id stays
  // retired: never renumbered, never reused.
  {
    id: "TVC-021",
    assertion:
      "A settled untyped operation exposes only a bounded reading of its input — never a raw payload pane — behind a manual disclosure that is closed by default; output requires an authored result surface.",
    layer: "dom",
    binds: "any-transcript",
  },
  {
    id: "TVC-022",
    assertion:
      "An elicitation surface renders the human heading, question and suggestions; the wire's ids and keys never render in the default view.",
    layer: "dom",
    binds: "any-transcript",
  },

  // --- 03x · state on the affected operation -------------------------------
  {
    id: "TVC-030",
    assertion:
      "A failed operation's error indication renders inside that operation's own row, never as a detached badge.",
    layer: "dom",
    binds: "any-transcript",
  },
  {
    id: "TVC-031",
    assertion:
      "Authored copy follows the state ladder: error copy renders only on a failed call, completion copy only on a completed one, and a cancelled call refuses authored copy entirely; a model-written caption is the label in every state, wearing a quiet state word off the running/done path.",
    layer: "pure",
    binds: "any-transcript",
  },
  {
    id: "TVC-032",
    assertion:
      "The state mark on a process row derives from the protocol state alone — two operations in the same state wear the same mark regardless of tool name.",
    layer: "dom",
    binds: "any-transcript",
  },
  {
    id: "TVC-033",
    assertion:
      "A cancelled (interrupted) operation reads as neutral cancellation — its mark carries no destructive treatment; a failed operation's does.",
    layer: "dom",
    binds: "any-transcript",
  },
  {
    id: "TVC-034",
    assertion:
      "A failed turn's terminal receipt renders as its own quiet transcript row carrying the wire's sentence, with a failure mark and no motion. User-stopped turns project no additional notice.",
    layer: "dom",
    binds: "any-transcript",
  },
  {
    id: "TVC-035",
    assertion:
      "Turn-failed receipts are replay-identical and never double the story: marker-by-marker anchoring equals the snapshot seed, re-application is a no-op, and the failure banner is withheld when the same sentence is anchored in the transcript.",
    layer: "pure",
    binds: "any-transcript",
  },
  {
    id: "TVC-036",
    assertion:
      "A call paused for approval or elicitation wears an explicit textual awaiting-input signal on its own row — never colour or a bare hold-open alone.",
    layer: "dom",
    binds: "any-transcript",
  },
  {
    id: "TVC-037",
    assertion:
      "A tool call severed by a run retry — resultless behind a later resume marker — reads as interrupted, never as still running; a recorded failure still outranks it.",
    layer: "pure",
    binds: "any-transcript",
  },
  {
    id: "TVC-038",
    assertion:
      "A refused operation — the tool answered and declined — reads as its own neutral declined state: a Declined pill, no destructive treatment on mark or pill, the door's reason sentence on the row without an Error label or a Result pane, and it is never counted as failed in its fold's headline.",
    layer: "dom",
    binds: "any-transcript",
  },
  {
    id: "TVC-039",
    assertion:
      "A call a member declined to approve — approval_resolved{approved:false} joined client-side to its approval_requested's tool_call_id, no wire change — reads as its own neutral not-approved state: a \"Not approved\" pill and the \"You didn't approve X\" headline (distinct from cancelled's Interrupted / \"Didn't run\" and from refused's Declined / \"Didn't\"), no destructive treatment on mark or pill, no Result pane for the cancellation sentinel, and no tally in its fold's settled headline (the pill alone wears the word); the state outranks the wire's cancelled stamp and yields to a recorded failure.",
    layer: "dom",
    // Landed after the binder scoping and assigned at its rebase: state
    // honesty, like every 03x law — the denied state is a projection
    // fact any binder replays identically (law 9).
    binds: "any-transcript",
  },

  // --- 04x · indentation discipline ----------------------------------------
  // TVC-040 (opening nested disclosures adds no cumulative left drift)
  // was DELETED with the Technical details disclosure it measured — a
  // tool row nests no disclosure of its own any more; TVC-041 keeps the
  // fold→row level. The id stays retired: never renumbered, never reused.
  {
    id: "TVC-041",
    assertion:
      "Expanding a fold does not shift its process body's x-origin by an extra group margin.",
    layer: "geometry",
    binds: "package-binder",
  },
  {
    id: "TVC-042",
    assertion:
      "A closed transcript disclosure keeps its content mounted (the activity rail stays in the DOM) while its ::details-content box computes to display:none; opening re-admits the box and closing hides it again.",
    layer: "geometry",
    binds: "package-binder",
  },

  // --- 05x · the process rail's two columns --------------------------------
  {
    id: "TVC-050",
    assertion: "All first-level process icons share one x-origin.",
    layer: "geometry",
    binds: "package-binder",
  },
  {
    id: "TVC-051",
    assertion: "All first-level process labels share one x-origin.",
    layer: "geometry",
    binds: "package-binder",
  },
  {
    id: "TVC-052",
    assertion:
      "An expanded operation's body (its tool view) begins under the label column, not under the icon column.",
    layer: "geometry",
    binds: "package-binder",
  },
  {
    id: "TVC-053",
    assertion:
      "Top-level prose and fold headers share the transcript's x-origin.",
    layer: "geometry",
    binds: "package-binder",
  },
  {
    id: "TVC-054",
    assertion:
      "Each resolved icon-vocabulary member renders a distinct semantic mark; a completion tick is not the universal operation icon.",
    layer: "dom",
    // 054/055 pin the resolved vocabulary's meaning — a distinct mark per
    // member — wherever rows render; the rail geometry above is the package's.
    binds: "any-transcript",
  },
  {
    id: "TVC-055",
    assertion:
      'A plan-progress operation annotated icon:"todo" resolves the dedicated checklist member — its mark is distinct from the generic fallback\'s, while an unknown token still degrades to generic.',
    layer: "dom",
    binds: "any-transcript",
  },

  // --- 06x · decision surfaces ---------------------------------------------
  {
    id: "TVC-060",
    assertion:
      "A pending approval frame aligns to the transcript/composer measure.",
    layer: "geometry",
    binds: "package-binder",
  },
  {
    id: "TVC-061",
    assertion:
      "An elicitation frame aligns to the transcript/composer measure.",
    layer: "geometry",
    binds: "package-binder",
  },
  {
    id: "TVC-062",
    assertion:
      "Decisions settle with no transcript receipt rows at all — approved and declined alike, joined or unjoined: no receipt sentence, no duplicate card note, no empty wrapper. The outcome's surfaces are the decision card's own footer and the operation row's state (the meta-receipt deletion retired the audit-visibility lines).",
    layer: "dom",
    // A projection fact about every transcript, not package chrome.
    binds: "any-transcript",
  },
  {
    id: "TVC-063",
    assertion:
      "A generic approval banner leads with fixed consent copy and a mechanically derived tool label, and asks exactly one question — the backend-authored consent sentence (or the package fallback). Tool arguments never render on the banner, raw or summarized: the call's own transcript row, which a pending decision holds open, carries the request (the banner reshape removed the argument summary and the technical-details disclosure).",
    layer: "dom",
    binds: "package-binder",
  },
  {
    id: "TVC-064",
    assertion:
      "A resolved or stale decision's surface leaves the suspension slot: the suspension tenant renders null unless a decision is actionable or in flight.",
    layer: "dom",
    binds: "package-binder",
  },
  // TVC-065 (declined receipts render with their operation, visible
  // without expanding) was deleted with the meta-receipt row class it
  // pinned: no decision receipt renders in the transcript at all — the
  // reworded TVC-062 above is the surviving law.
  {
    id: "TVC-066",
    assertion:
      "A settled (withdrawn or expired) ask never wears a running spinner or shimmer; the withdrawn sentence renders on the ask's own inline card (shelf-less hosts), never as a transcript row.",
    layer: "dom",
    // State honesty — a settled ask never signals running — wherever an ask
    // renders.
    binds: "any-transcript",
  },
  {
    id: "TVC-067",
    assertion:
      "An oversized approval stays bounded in the suspension slot: the banner never exceeds the decision well's budget, a very long consent prompt scrolls within the banner rather than pushing Approve/Deny off screen or past a constrained host's panel, and the composer's controls stay fully on screen, un-overlapped (the bounded request contents left with the banner reshape, so the banner as a whole is the scroll region).",
    layer: "geometry",
    binds: "package-binder",
  },
  // TVC-068 (sensitive arguments stay off the generic card's face) and
  // TVC-069 (a REST-recovered card withholds exactly what a streamed
  // one withholds) are retired with the sensitivity plane they pinned —
  // built, tested, zero producers; it returns additively when a real
  // tool needs one (tool-views.md). Retired ids are never renumbered,
  // never reused.

  // --- 07x · subagent hierarchy --------------------------------------------
  {
    id: "TVC-070",
    assertion:
      "A subagent child transcript indents exactly one rail level beyond its parent — one first-level column step, no more.",
    layer: "geometry",
    // 070/071 pin the package rail's composition; 072/073 below are copy
    // discipline and bind any transcript.
    binds: "package-binder",
  },
  {
    id: "TVC-071",
    assertion:
      "A subagent child preview wraps its transcript body in exactly one frame of chrome — never a card within a card.",
    layer: "dom",
    binds: "package-binder",
  },
  {
    id: "TVC-072",
    assertion:
      "A subagent's current-work label reads the presenter's currentWorkLabel slot, never a respelled ladder frame.",
    layer: "dom",
    binds: "any-transcript",
  },
  {
    id: "TVC-073",
    assertion:
      "A settled subagent duration derives from the house duration ladder — a sub-second span reads '<1s', and '0s' / 'Worked for 0s' are unrenderable.",
    layer: "pure",
    binds: "any-transcript",
  },
  {
    id: "TVC-074",
    assertion:
      "A subagent row's metadata lines — current work, duration, and failure note — share their own row label's x-origin; raw successful result summaries render only in the child transcript.",
    layer: "geometry",
    binds: "package-binder",
  },
  {
    id: "TVC-075",
    assertion:
      "A subagent row's fixed-size ornaments — identity mark, drill-in chevron — center on the label line they belong to, never on the row's whole multi-line stack.",
    layer: "geometry",
    binds: "package-binder",
  },
  {
    id: "TVC-076",
    assertion:
      "The subagent drill-in popover crosses the script-tag shadow boundary under a strict CSP — top-layer promotion, anchor placement, inside-vs-outside light dismissal by composed path, native Escape, and focus restore to its opener all hold inside an open shadow root styled only by the constructed sheet.",
    layer: "geometry",
    binds: "package-binder",
  },

  // --- 08x · replay equivalence --------------------------------------------
  {
    id: "TVC-080",
    assertion:
      "The transcript projection is deterministic: equal (messages, anchors, running) inputs yield deep-equal rows.",
    layer: "pure",
    binds: "any-transcript",
  },
  {
    id: "TVC-081",
    assertion:
      "Display-anchor application is idempotent, and anchors built marker-by-marker (live) yield rows identical to the final snapshot (replay).",
    layer: "pure",
    binds: "any-transcript",
  },
  {
    id: "TVC-082",
    assertion:
      "The settled-state ladder is fixed: errored beats denied beats cancelled beats refused beats result-present beats superseded beats running/pending.",
    layer: "pure",
    binds: "any-transcript",
  },
  {
    id: "TVC-083",
    assertion:
      "Row order and row keys are a function of the event history alone; the running→settled flip never reorders or rekeys rows.",
    layer: "pure",
    binds: "any-transcript",
  },
  {
    id: "TVC-084",
    assertion:
      "Episode grouping is a pure function of the projected rows and the one open-tail-turn bit — never the tool-view registry — identical live, after reconnect, and after replay — and the open→settled unification preserves every surviving fold's key: the settled episode wears the key of the first live cluster it absorbed.",
    layer: "pure",
    binds: "any-transcript",
  },

  // --- 09x · identity --------------------------------------------------------
  {
    id: "TVC-090",
    assertion:
      "Assistant-authored turns carry a non-empty provenance identity token without stamping decorative brand chrome above ordinary prose.",
    layer: "dom",
    binds: "any-transcript",
  },
  {
    id: "TVC-091",
    assertion:
      "Each subagent carries an identity mark distinguishable from the primary agent's and stable across every surface that names it.",
    layer: "dom",
    binds: "any-transcript",
  },
  {
    id: "TVC-092",
    assertion:
      "Subagent chrome uses the filled TeaFlask geometry with a replay-stable color identity, no visible numeric badge, and no avatar-style background disc.",
    layer: "dom",
    // 090/091 bind identity honesty everywhere; this law pins the package's
    // own mark rendering.
    binds: "package-binder",
  },

  // --- 10x · motion ----------------------------------------------------------
  {
    id: "TVC-100",
    assertion:
      "The shimmer collapses to a static equivalent under both reduced-motion switches (the OS media query and the host kill switch).",
    layer: "dom",
    binds: "any-transcript",
  },
  {
    id: "TVC-101",
    assertion:
      "The one indeterminate spinner has a reduced-motion equivalent that preserves its state text.",
    layer: "dom",
    binds: "any-transcript",
  },
  {
    id: "TVC-102",
    assertion:
      "The two motion primitives run inside a shadow root with a constructed stylesheet under a strict CSP, and both collapse to static equivalents — state text preserved — when either reduced-motion switch is applied outside the shadow boundary.",
    layer: "geometry",
    // 100/101 bind the motion behavior everywhere; 102/103 pin the package
    // element bundle's delivery mechanics (shadow root, constructed sheet,
    // CSP).
    binds: "package-binder",
  },
  {
    id: "TVC-103",
    assertion:
      "The shadow/CSP probe page is styled by the built script-tag artifact (dist/element/assistant.js): the upgraded <teaflask-assistant>'s open shadow root carries exactly one adopted constructed sheet, no tree stylesheet, and that sheet carries the bake-stage rem→px fingerprint (the label token serialized in px) no fetched dist/styles.css could supply.",
    layer: "geometry",
    binds: "package-binder",
  },

  // --- 11x · presenter and fallbacks -----------------------------------------
  // TVC-110 (a spec-carrying result selects its typed preview member)
  // is retired with the ui_spec result grammar it pinned (tool-views.md);
  // TVC-111 below survives — result UI stays authored, never inferred. A
  // retired id is never renumbered, never reused.
  {
    id: "TVC-111",
    assertion:
      "An unknown customer tool exposes its input but renders neither an inferred result card nor a raw output dump.",
    layer: "dom",
    binds: "any-transcript",
  },
  // TVC-112 carries no disclosure clause: there is no client
  // `disclosure` arm, and openness derives from resolution and pending
  // decisions (tool-views.md). The icon clause is the law.
  {
    id: "TVC-112",
    assertion:
      "Vocabulary resolution is fixed: an unknown icon token resolves to generic.",
    layer: "pure",
    binds: "any-transcript",
  },
  {
    id: "TVC-113",
    assertion:
      "Every presenter copy slot derives from the one headline ladder — no slot or consumer respells a ladder frame.",
    layer: "pure",
    binds: "any-transcript",
  },
  {
    id: "TVC-114",
    assertion:
      "A text-only (old-wire) display resolves to the identical headline the pre-annotation ladder produced, in every state.",
    layer: "pure",
    binds: "any-transcript",
  },
  // TVC-115's assertion matches its prose half: the isolating mechanism
  // is the tool-view slot and the terminal is the package default view —
  // no "host-registered renderer", no "error boundary".
  {
    id: "TVC-115",
    assertion:
      "A registered tool view that throws is isolated by the tool-view slot; resolution falls to the rung below, terminally the package default view.",
    layer: "dom",
    binds: "any-transcript",
  },
  // TVC-116 (an exact-tool approval renderer owns the complete surface)
  // is retired with the approvalRenderers registry it pinned — a view
  // cannot approve its own operation — and TVC-117 (a
  // sensitivity-annotated operation never mounts a host detail
  // renderer) with the sensitivity plane (tool-views.md). Retired ids
  // are never renumbered, never reused.

  // --- 12x · overlays and scroll ----------------------------------------------
  {
    id: "TVC-120",
    assertion: "Activity overlays never overlap composer controls.",
    layer: "geometry",
    binds: "package-binder",
  },
  {
    id: "TVC-121",
    assertion:
      "Opening or closing a disclosure never steals a scrolled-away reader's scroll position.",
    layer: "geometry",
    binds: "package-binder",
  },
  {
    id: "TVC-122",
    assertion:
      "Decision surfaces remain in flow on the composer's measure; compact activity is an absolutely positioned, transparent overlay above the shelf+composer seam that reserves no band, never overlaps composer controls OR the decision shelf's tenants, and disappears without residue when empty.",
    layer: "geometry",
    binds: "package-binder",
  },
  {
    id: "TVC-123",
    assertion:
      "The scroll-away activity indicator appears for a scrolled-away reader during live activity without moving their scroll position, and activating it returns them to the tail.",
    layer: "geometry",
    binds: "package-binder",
  },
  {
    id: "TVC-124",
    assertion:
      "Shelf population and height changes never strand a pinned reader at the bottom nor move a scrolled-away one.",
    layer: "geometry",
    binds: "package-binder",
  },
  {
    id: "TVC-125",
    assertion:
      "A tenant's floating disclosure opens fully inside the viewport at the narrow contract width, and holds its position while a sibling shelf item changes size.",
    layer: "geometry",
    binds: "package-binder",
  },
  {
    id: "TVC-126",
    assertion:
      "Conversation chrome never narrates run state: no wait or working status line renders in the activity slot for any turn status, and no visible 'Waiting for your input' exists anywhere — waiting is stated only by an actionable decision surface or the pending-decision gap alert, and only the sr-only announcer phrases it, keyed on actual pending decisions.",
    layer: "dom",
    // Pins the package's own activity slot and sr-only announcer chrome.
    binds: "package-binder",
  },

  // --- 13x · provenance and system rows -------------------------------
  {
    id: "TVC-130",
    assertion:
      "A memory write renders as one quiet coalesced footer on its originating assistant message — count in the trigger, canned summary and generic destination label behind a keyboard reveal — never a detached row, never memory contents or ids; provenance without attribution renders nothing.",
    layer: "dom",
    // The never-contents-or-ids clause is the redaction floor; it binds
    // wherever memory provenance renders.
    binds: "any-transcript",
  },
  {
    id: "TVC-131",
    assertion:
      "Memory-footer anchoring is replay-identical and idempotent: attribution built marker-by-marker equals the snapshot seed, re-application returns the identical map, and old histories project no footer.",
    layer: "pure",
    binds: "any-transcript",
  },
  {
    id: "TVC-132",
    assertion:
      "A system-originated notice (the delivery divider — the one notice kind left since the meta-receipt rows, the resume divider among them, were deleted) wears explicit system semantics — the system-notice hook, a note role, the “System notification” accessible name, a compact delivery pill with a visible system label and subagent identity — never assistant prose.",
    layer: "dom",
    binds: "any-transcript",
  },

  // --- 14x · the follow contract (pre-existing probes) -------------------------
  {
    id: "TVC-140",
    assertion:
      "A giant approval arriving late lands its footer inside the viewport while following, and a further resize never drags a scrolled-away reader.",
    layer: "geometry",
    binds: "package-binder",
  },
  {
    id: "TVC-141",
    assertion:
      "Composer growth returns a pinned transcript to its bottom within two frames.",
    layer: "geometry",
    binds: "package-binder",
  },
  {
    id: "TVC-142",
    assertion:
      "Wheeling up over a code block releases the follow lock even mid-resize.",
    layer: "geometry",
    binds: "package-binder",
  },
  {
    id: "TVC-143",
    assertion:
      "A non-wheel upward scroll escapes the follow even while content resizes every frame.",
    layer: "geometry",
    binds: "package-binder",
  },
  {
    id: "TVC-144",
    assertion:
      "An axis-mixed horizontal pan over a code block never releases the follow lock.",
    layer: "geometry",
    binds: "package-binder",
  },
  {
    id: "TVC-145",
    assertion: "Dragging back to the bottom mid-stream re-engages the follow.",
    layer: "geometry",
    binds: "package-binder",
  },
  {
    id: "TVC-146",
    assertion:
      "On a page whose clock cannot elapse a follow wait, the shrink re-follow never moves a reader — not on a transient shrink, not on a shrink from content-fit, and not after an escape's bail settles the parked follow.",
    layer: "geometry",
    binds: "package-binder",
  },
  {
    id: "TVC-147",
    assertion:
      "A follower whose content fit the viewport is re-landed at the bottom when a viewport shrink first creates the overflow.",
    layer: "geometry",
    binds: "package-binder",
  },
  {
    id: "TVC-148",
    assertion:
      "A viewport shrink that arrives before the follow-liveness proof is re-landed once the clock proves live, never dropped.",
    layer: "geometry",
    binds: "package-binder",
  },
  {
    id: "TVC-149",
    assertion:
      "A bottom-following reader is re-landed within frames when the viewport shrinks under them.",
    layer: "geometry",
    binds: "package-binder",
  },

  // --- 15x · screenshot baselines ----------------------------------------------
  {
    id: "TVC-150",
    assertion: "The component bench matches its light-mode Linux baseline.",
    layer: "screenshot",
    binds: "package-binder",
    // Acknowledged gap: the bench is a composite with no non-pixel twin,
    // and LIGHT-mode contrast/token pairing has no dom/geometry law.
    counterparts: [],
  },
  {
    id: "TVC-151",
    assertion:
      "The component bench matches its dark-mode Linux baseline with the same structure.",
    layer: "screenshot",
    binds: "package-binder",
    // Acknowledged gap: dark mode is pixel-pinned ONLY — no dom/geometry
    // law anywhere asserts a dark-specific property. Weakening this
    // baseline or its budget removes dark mode's only guard.
    counterparts: [],
  },
  {
    id: "TVC-152",
    assertion:
      "The real shipping composer matches its baselines at the narrow and full-page widths, light and dark.",
    layer: "screenshot",
    binds: "package-binder",
    // Acknowledged gap: only the composer's geometry RELATIONS have
    // non-pixel laws (TVC-067/120/122/141); its appearance is pixel-
    // pinned only.
    counterparts: [],
  },
  {
    id: "TVC-153",
    assertion:
      "The prose→reasoning→tools→prose rhythm scenario matches its full-page-width baselines, light and dark.",
    layer: "screenshot",
    binds: "package-binder",
    counterparts: [
      "TVC-001",
      "TVC-010",
      "TVC-011",
      "TVC-012",
      "TVC-013",
      "TVC-014",
      "TVC-016",
      "TVC-041",
      "TVC-050",
      "TVC-051",
      "TVC-053",
      "TVC-054",
    ],
    counterpartExclusions: [
      {
        id: "TVC-015",
        reason:
          "the rhythm scene's settled turn holds one action cluster, so no unification is visible; the interleaved-scenario episode baselines picture it",
      },
      {
        id: "TVC-042",
        reason:
          "a closed fold's content is invisible in a pixel scene whether display-locked or out of layout, so no baseline can tell the two apart; the law's guard is its own computed-style probe",
      },
      {
        id: "TVC-052",
        reason: "no expanded detail pane is posed in the rhythm scene",
      },
      {
        id: "TVC-055",
        reason: "no plan-progress (todo) row is posed in the rhythm scene",
      },
    ],
  },
  {
    id: "TVC-154",
    assertion:
      "The decision-surfaces scenario matches its palette-width baselines, light and dark.",
    layer: "screenshot",
    binds: "package-binder",
    counterparts: [
      "TVC-022",
      "TVC-060",
      "TVC-061",
      "TVC-062",
      "TVC-063",
      "TVC-064",
      "TVC-066",
      "TVC-067",
    ],
    counterpartExclusions: [
      {
        id: "TVC-021",
        reason:
          "the one expanded operation row is deliberately posed open (the settled-quietly specimen); closed-by-default is not what these scenes picture",
      },
    ],
  },
  {
    id: "TVC-155",
    assertion:
      "The full state-matrix scenario settles to static equivalents and matches its reduced-motion narrow baselines, light and dark.",
    layer: "screenshot",
    binds: "package-binder",
    counterparts: [
      "TVC-030",
      "TVC-031",
      "TVC-032",
      "TVC-033",
      "TVC-034",
      "TVC-036",
      // The state matrix poses the denied row directly under the
      // cancelled one — the two look-alikes side by side, so the
      // baseline pins the neutral not-approved register in both
      // themes where the DOM layer is blind to ink.
      "TVC-039",
      "TVC-082",
      "TVC-100",
      "TVC-101",
      "TVC-102",
    ],
    counterpartExclusions: [
      {
        id: "TVC-035",
        reason:
          "replay idempotence and banner yielding — projection invariants, not properties the posed scene pictures",
      },
      {
        id: "TVC-103",
        reason:
          "the shadow probe page's artifact-loading fingerprint — a property of the loading mechanism, not anything the posed state-matrix scene pictures",
      },
      {
        id: "TVC-037",
        reason:
          "the severed-by-retry derivation is a projection rule whose OUTPUT is the interrupted state this scene already poses via a directly-cancelled call; no retry history is posed",
      },
      {
        id: "TVC-038",
        reason:
          "the posed state-matrix scene carries no refused call; the declined register is pinned at the DOM layer",
      },
      {
        id: "TVC-080",
        reason: "projection determinism — not a scene-visible property",
      },
      {
        id: "TVC-081",
        reason: "live/replay anchor equivalence — not a scene-visible property",
      },
      {
        id: "TVC-083",
        reason: "row order/key stability — not a scene-visible property",
      },
      {
        id: "TVC-084",
        reason:
          "episode-grouping replay equivalence — a pure derivation, not a scene-visible property",
      },
    ],
  },
  {
    id: "TVC-156",
    assertion:
      "The settled fold header (“Worked for …”, no step count) matches its baseline.",
    layer: "screenshot",
    binds: "package-binder",
    counterparts: ["TVC-011", "TVC-012", "TVC-013"],
    counterpartExclusions: [
      {
        id: "TVC-010",
        reason:
          "the active fold's headline — this crop pictures a settled header",
      },
      {
        id: "TVC-014",
        reason:
          "native disclosure-state behavior, not the settled crop's pixels",
      },
      {
        id: "TVC-015",
        reason:
          "episode unification needs a multi-cluster turn; this crop is one settled header",
      },
      {
        id: "TVC-016",
        reason:
          "the final response sits outside this header-only crop; the interleaved-scenario baselines picture it",
      },
    ],
  },
  {
    id: "TVC-157",
    assertion:
      "The process rail — one icon/connector column, one text column — matches its baseline over the operations scenario.",
    layer: "screenshot",
    binds: "package-binder",
    // A negative control: a glyph swap this law slept through (under a
    // nonzero pixel budget) was caught by TVC-055.
    counterparts: ["TVC-050", "TVC-051", "TVC-052", "TVC-054", "TVC-055"],
    counterpartExclusions: [
      {
        id: "TVC-053",
        reason:
          "the operations scene poses bare tool rows; no prose row or fold header in frame",
      },
    ],
  },
  {
    id: "TVC-158",
    assertion:
      "The subagent tree (running, completed, failed, child preview) matches its baseline.",
    layer: "screenshot",
    binds: "package-binder",
    // A negative control: a 28px indent collapse this law slept through
    // (under a nonzero pixel budget) was caught by TVC-070.
    counterparts: [
      "TVC-070",
      "TVC-071",
      "TVC-072",
      "TVC-073",
      "TVC-074",
      "TVC-075",
    ],
    counterpartExclusions: [
      {
        id: "TVC-076",
        reason:
          "the drill-in popover under shadow root and CSP — behavioral and cross-boundary, not the posed tree's pixels",
      },
    ],
  },
  {
    id: "TVC-159",
    assertion: "The agent identity marks match their baseline.",
    layer: "screenshot",
    binds: "package-binder",
    // TVC-092 is the DOM companion the contract names explicitly: it
    // enforces what this law's mark-scale crops cannot see in the dark
    // theme (no dark baseline exists at mark scale).
    counterparts: ["TVC-090", "TVC-091", "TVC-092"],
  },

  // --- 16x · performance budget ---------------------------------------------------
  {
    id: "TVC-160",
    assertion:
      "Rendering the large synthetic transcript stays under the pinned DOM element-count ceiling.",
    layer: "dom",
    binds: "package-binder",
  },
  {
    id: "TVC-161",
    assertion:
      "The projection over the large synthetic transcript yields exactly the arithmetically expected row count — linear in turns.",
    layer: "pure",
    binds: "package-binder",
  },
  {
    id: "TVC-162",
    assertion:
      "The script-tag element bundle's shipped measures — eager shell minified and gzip, on-demand pool minified — stay within the pinned two-sided byte band of the committed baseline; drift past the band in either direction demands a reviewed refresh.",
    layer: "pure",
    binds: "package-binder",
  },

  // --- 17x · lint gates -------------------------------------------------------------
  {
    id: "TVC-170",
    assertion: "A raw palette color class in package source is a lint error.",
    layer: "lint",
    binds: "package-binder",
  },
  {
    id: "TVC-171",
    assertion: "An inline style prop in package source is a lint error.",
    layer: "lint",
    binds: "package-binder",
  },
  {
    id: "TVC-172",
    assertion:
      "An arbitrary numeric-literal utility value in package source is a lint error.",
    layer: "lint",
    binds: "package-binder",
  },
  {
    id: "TVC-173",
    assertion:
      "A raw interactive element outside the primitives layer is a lint error.",
    layer: "lint",
    binds: "package-binder",
  },

  // --- 18x · the release gate ---------------------------------------
  {
    id: "TVC-180",
    assertion:
      "Every registered law's test runs — no skip modifier on its declaration, no skipped or conditional group around it, no runtime skip beyond the two pinned Linux-only screenshot gates, no declaration nested in a branch or helper, no file the runner never selects; there is no parked state, so the registry's completion claim is a test, not a report.",
    layer: "pure",
    binds: "package-binder",
  },

  // --- 19x · the capture clock regime --------------------------------
  {
    id: "TVC-190",
    assertion:
      "Under the capture clock — a deterministic starting now whose Date ticks — every overflowing message list in a screenshot scenario rests at its bottom before capture; under a pinned clock the same scene's overflowing lists provably stay at the top.",
    layer: "geometry",
    binds: "package-binder",
  },
];
