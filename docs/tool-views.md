# Tool views — the presentation contract

**Status: accepted.** Reconciled with the shipped code. This is the decision
record for the tool-view program: the whys and the alternatives it closed. The
living architecture lives elsewhere and is not restated here —
`presentation-architecture.md` carries the rulings as shipped behaviour,
`tool-view-registry.md` the registry's shipped mechanics, and
`transcript-visual-contract.md` the testable sentences as numbered laws.

**Maintenance.** What remains is record — kept only as long as it stays
accurate, because a record that outlives its accuracy is worse than no record.
Every load-bearing number and pointer in it is probed against the source
whenever it changes.

## Why this exists

The transcript had three overlapping half-answers to "show me what this tool is
doing," and none was a view of a tool call:

- **`ui_spec`** — a closed three-member declarative result grammar (table /
  entity-card / matrix), authored per catalog action and operator-reviewed.
  Result-only, and expressible only in three shapes.
- **`renderers` / `{key, version}`** — a trusted-host React registry, fully
  wired on the client with **zero backend producers**. Its component received
  `display.ui_spec` — a presentation _spec_, not the call's data — and mounted
  only after `output` landed. It could not be an input or preview view.
- **`approvalRenderers`** — an exact-tool registry replacing the whole
  approval card, decision controls included. The only real tool view that
  existed, and it coupled presentation to permission.

The governing sentence of the product spec: **a view is a presentation of a tool
call, not an approval mechanism.**

## The contract

One view per tool call. Resolved once, mounted once, in the row's body, for the
call's whole lifecycle. It never owns a decision — the absence of decision
controls is the contract's point, not an oversight. A view receives the recorded
call and one ambient fact (`ToolViewProps { call, context: { themeMode } }`) —
no stores, no auth tokens, no transport, no `approve` or `deny`. The shipped
shape, its field-by-field semantics and its generic parameters are documented
where they are enforced, `core/tool-view.ts`; the resolution ladder and its
degradation rules are in `presentation-architecture.md` ("One presenter, many
consumers") and `tool-view-registry.md`. The package's own rung-3 views are
authored beside the tools in `tool_call_display.py`, and every other tool's
recorded decision — "no view, the row is right" included — is pinned two-way in
the serving side's tool-call-display tests.

### Two authoring forms

The imperative adapter (`mount → { update, destroy }`) is canonical, so any
host can supply a view; the React registry is thin sugar over the same
lifecycle — one contract, two spellings, never two systems. A registration may
carry a view, an icon, or both: swapping only the operation mark costs three
lines, and there is no second registration concept running beside the first.
The non-React spelling's delivery channel is the script-tag elements'
`toolViews` JS property — the same registry shape, assignable before or after
the element upgrades.

**Shadow DOM obligation.** The script-tag distribution renders inside a shadow root.
A host adapter sees the `--tf-*` token _names_ (host inputs — unset unless the
host themes, so every `var(--tf-*)` pairs with an explicit fallback) and none of
the host page's stylesheet; mode-awareness is `context.themeMode`, never the
tokens. Vanilla views must carry their own styles — inline styles on the nodes
they create, or a `<style>` element the adapter owns inside its container
(placement governs lifecycle, not reach: its rules apply to the whole shadow
root, so selectors stay scoped to the adapter's own class names).
Documented, not fixed. The widget-side complement — the `data-tf-host-view`
marker that keeps the package's stylesheet reset off host-authored DOM — is
mechanics, documented in `tool-view-registry.md`.

## Placement

Views render in the row's body; the row keeps its identity — mark, headline,
state pill, chevron — and the view is its content. One operation, one visible
record. The open-by-default rules (a decision-awaiting call opens its row and
its fold; a host-authored view opens its ROW alone — no view opens or holds an
outer fold; a member's explicit toggle outranks everything, permanently per
fold) are numbered law, not prose: `transcript-visual-contract.md`
(TVC-010/011/014 as amended) is their record, `tool-row.tsx` (the row) and
`activity-rail.tsx` (the fold) their mechanism. Which views a row resolves
never reaches the fold grouping (TVC-015/084): one uninterrupted work span is
one episode fold, and the view is inspected at its row inside it.

## Approval is a banner

The approval surface keeps the backend-authored consent sentence, the
mechanical tool label, the decision controls, the status notes, the operation
headline, and an affordance that scrolls to the row. It loses the argument
summary, the technical-details disclosure, and the display join that existed
only to feed them (the living rule is `presentation-architecture.md`'s Layer A
frame row and Layer B constraints).

**The consent doctrine moved.** The earlier doctrine held that what the user
consents to must be ON the card. It is now: _informed consent is carried by
the transcript row, which a pending decision always opens._ This was safe to
change because **"ask again iff the card would render differently" was
doctrine in a comment, never a mechanism** — trust is recorded by exact tool
name (`interventions.py`) and no argument digest exists anywhere in the
codebase.

## The honesty law

> A view renders the recorded call. Anything it does afterwards is outside that
> record and must be visibly outside it.

Views are presentation-only. A host view's button doing something in the host's own
application is outside this contract entirely — we neither enable nor prevent it —
but the transcript must not then assert a stale result as current.

**Interactivity is reserved, not built.** `ToolViewProps` is `{call, context}`, so a
third member (`actions`) is purely additive, and the registration carries a
`version`. The tiers, recorded so they are not re-derived: (0) host code acts outside
our contract and the agent does not know, which is fine; (1) one callback posting a
message as the user, identical to typing, no policy change; (2) views calling tools —
deliberately shut.

## What was deleted, and why

### `ui_spec`, whole plane

Three components could not express what customers needed, and the machinery cost a
catalog schema, a validation surface, preparer authoring, an operator editor, ~950
LOC of client selection and its dashboard twins. Replaced by rung 3: because customer
HTTP actions are structurally our tools — we generate them from the catalog and their
arguments are always `{path_params, query, body}` — one package-shipped built-in
renders any org's action in every host with zero customer frontend work.

### `approvalRenderers`

A view cannot approve its own operation. The registry's use case — a purpose-built
review of a specific tool — is a rung-2 view plus the package banner.

### `sensitivity`

Built, tested, zero producers. It cost a compile-time echo guard and a fail-closed
arm in every resolution path for a capability no shipped tool used. It returns
additively when a real tool needs one.

### The display envelope

Pre-launch is the only window in which the wire's shape is free. After the
teardowns `ToolCallDisplayPayload` reads
`caption, progress_text, complete_text, error_text, icon, view {key, version}`
(`caption` joined additively).

- **`renderer` → `view`.** The field names which component draws a call, which is a
  view. Carrying the old noun into the new vocabulary guarantees permanent confusion.
- **`disclosure` removed.** Zero producers, and superseded — openness is now derived
  from whether a view resolved and whether a decision is pending. A long-running tool
  with no view wanting its row held open is the one plausible future producer; it
  returns additively.
- **`kind: "text"` removed.** A one-member discriminator kept as the "generative-UI
  door." Views are that door, and shipped narrowers dropped an unknown `kind` whole,
  so it was never a usable extension point.

Removals were sanctioned through `scripts/contract-shrink-allowlist.json`, the same
route `ApprovalRequestedMarker.tool_ui_spec` took in August. This was legitimate only
because the product is pre-launch with no production consumers; after 1.0 the
additive-only rule in the serving contract binds absolutely.

## Knowing the shape

A view author must know what `args` and `result` look like.

**Arguments.** The catalog row's `path_params_schema` / `query_params_schema` /
`body_schema` are the source of truth — not the customer's OpenAPI document, and not
`contract/actions-adapter.ts`, which is the auth/transport seam and carries no
schemas. The row is populated by the scan: from a spec when the repo has one, from
code via the preparer agent when it does not, and operator-reviewed either way. The
schema reaches the view as `call.argsSchema` and the catalog editor renders it as a
copy-pasteable type.

**Results.** No success-response schema existed anywhere: `tool_output_schema` had no
producer, and the scan captured only declared non-2xx responses as description
evidence. The program fixed this at the source — the scan extracts success-response
schemas, the operator reviews them, and they reach the view as `call.resultSchema`,
finally giving `tool_output_schema` a producer.

## Lifecycle honesty

A human denial used to render `cancelled` — "Interrupted" / "Didn't run X" —
indistinguishable from a run-retry severance. The client-side join
(`core/tool-denial-anchors.ts`) reclassifies it: the call reads `denied` —
"Not approved" / "You didn't approve X" — above the wire's cancelled stamp and
below a recorded failure. The living rules are numbered laws (TVC-039,
TVC-082) and the state-vocabulary table in `transcript-visual-contract.md`,
including the word boundary: `refused` (the door declining) wears "Declined";
a human denial wears "Not approved," never that one.

## Superseded and retired laws

| Law                         | Fate                                                |
| --------------------------- | --------------------------------------------------- |
| TVC-010 / TVC-011 / TVC-014 | amended for view-bearing rows                       |
| TVC-063 / TVC-067           | amended for the banner                              |
| TVC-068 / TVC-069 / TVC-117 | retired with `sensitivity`                          |
| TVC-110                     | retired with the `ui_spec` result grammar           |
| TVC-116                     | retired with `approvalRenderers`                    |
| TVC-020 / TVC-040           | retired with the "Technical details" disclosure     |
| TVC-021 / TVC-052           | re-cut: the body is the tool view, never a raw pane |
| TVC-111                     | survives — result UI stays authored, never inferred |

TVC ids are never renumbered or reused. Precedent for retiring a law with its
feature: "The 065 law was deleted with the meta-receipt row class it pinned."

## The shipped end state, and the open tail

The program's constitution declared "one `<AssistantTranscript/>` with three
binders and the fork ledger at zero." Neither half is literally what shipped,
and this record says so rather than repeating the promise:

- **The fork ledger is a register, not a count to drive to zero**: its
  detectors scan the whole dashboard source, at any depth, with no size floor,
  plus a same-name detector; every pair they flag is collapsed or registered
  with its must-differ sentence, and the register names every renderer
  divergence and every held-identical idiom explicitly.
- **"Three binders" is two modules across three surfaces**: the package's
  `Transcript` binds the widget's store rows, and the dashboard's
  `AgentRunTranscript` binds an `AbstractAgent` and serves both the run viewer
  and the playground.

Known gaps, each recorded, none silently absorbed: the approval receipt is
appended best-effort on the first resume attempt only, so a pre-append crash
renders a member's explicit denial as "Interrupted" — a wire change, the
tail's highest severity; `ScrollWell` has no designed x-axis fade cue; the
playground reads in the widget's voice. Closed since: `./headless` renders its
replies (`useTranscript()` is the public rows binding on that entry);
`sandbox_file_editor`'s row copy is an args-derived author (the verb following
the schema's four commands, with a presence-only fallback for a command the
schema doesn't name); and the `rem-to-px` tripwire scans JS/TS string literals
too — `scripts/rem-in-source.mjs` + `tests/rem-in-source.test.ts` over
`src/**` and `fixtures/**`, with the residual surfaces (a unit held in a
non-literal expression, `node_modules` — both uncompensated and said so — host
theme strings by design, the dashboard and marketing-site trees as host-owned
pages) stated in the scanner's header, each credited only with what its named
control actually checks. Unowned but recorded: eight of
`MarkerAnchorsSnapshot`'s fifteen anchor families have no recorder in
`./transcript` (seven ship; the counts are enforced, not trusted —
`tests/tool-call-state-sites.test.ts` parses the interface and the entry and
reads the scope note's words back), the rest deferred behind that entry's
transport-free closure law; nothing mechanically ties the frontend
architecture law's specifier lists to the package's exports map (the
earned-ness test bounds the rot, the tie stays manual);
`run_events.pending_interrupts_of` returns a 4-tuple whose last two members —
the newest round's approval cards and execution cards — share the type
`list[dict[str, object]]` and are trivially transposable at a call site; and
the `Assistant Package (react 18 peer floor)` check runs green but is not in
the branch ruleset — adding it is a repo-settings change only a human can
make.

## Rejected alternatives — do not re-propose

| Proposal                                                       | Why not                                                                                                                                                  |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A redesigned declarative UI grammar to replace `ui_spec`       | Ruled against: a second grammar to design, validate and version, when host React plus package built-ins cover the cases.                                 |
| MCP Apps-style sandboxed iframes serving UI resources          | Ruled against: overturns "no executable code rides the wire" and makes the sandbox a security-review centrepiece, for a capability nobody has asked for. |
| Promoting views out of the activity fold as first-class blocks | Ruled against: views live in the row. The fold auto-opens instead.                                                                                       |
| Keeping `approvalRenderers` alongside views                    | Ruled against: contradicts the spec's core principle.                                                                                                    |
| Views that call tools                                          | Reserved, not built. See the honesty law.                                                                                                                |
| Compatible-version renderer resolution                         | Ruled against; reopening it is a contract change, not a patch.                                                                                           |
