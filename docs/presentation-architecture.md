# Presentation architecture — the two-layer contract

**Status: accepted.** This is the decision record for the transcript's
presentation architecture, reconciled with the shipped tool-view program
— the decision record for those changes is `tool-views.md`, and where
the two met, this document describes the world as shipped. The wire half
is normative in the serving contract (the `tool_call_annotated` row) and
`serving-openapi.json`; this document records the decisions, the
package-owned primitive inventory, and the rules the visuals implement
against. The visual contract (`transcript-visual-contract.md`) restates
the testable sentences below as numbered laws.

## Context and problem

The transcript's tool-call presentation was one narrow envelope:
backend-authored progress/complete sentences plus an opaque `ui_spec`
(since deleted whole by the tool-view program — `tool-views.md`),
resolved through a mechanical fallback ladder. That protected the
package's founding law as first written — the package knows protocol,
never the tool catalogue — but it forced generic rows, gave five
consumers (transcript row, approval card, resolved-action summary,
subagent current-work label, detail view) no shared resolution point,
and left customers no path to their own visual language. A closed
catalogue of built-in "Gmail"/"calendar" renderers would be the wrong
boundary; arbitrary executable React over the wire is unacceptable for
security, CSP, versioning, SSR, and package integrity.

**The founding law, as amended by the tool-view program:**

> The package never knows a **customer's** tool catalogue. It may
> present its own tools, and it does so through the same opaque-key
> seam a host uses — never a switch on a tool name.

The `teaflask.*` namespace reservation is the mechanism that makes the
narrowing safe: the package's built-in views live under reserved keys
(the frozen `PACKAGE_TOOL_VIEWS`, resolution rung 3), and a `teaflask.*`
key is refused at both host rungs and at the script-tag door by one
shared predicate — so a catalog entry or customer-authored annotation
can never name a privileged view.

## Decision: two layers

**Layer A — the package-owned structural grammar.** A small, stable set
of interaction primitives the package implements. They enforce spacing,
indentation, accessibility, motion, approval safety, and responsive
behavior. As first accepted this layer was closed — "no host can replace
them" — and that position is amended to the tool-view program's: **open
everything, guard by contract**. Any presentation slot is replaceable;
safety rides the guards, not a withheld seam — the decision controls the
package alone holds (a view presents a tool call and never owns its
decision), the error isolation at every slot (a throwing tool view is
caught imperatively in `tool-view-slot.tsx` and lands on the resolution
rung below; a throwing slot fill is caught by the React slot boundary in
`slot-boundary.tsx` and the package's own rendering takes over — except
the input slot, which deliberately mounts unbounded so decision-capable
chrome is never latched behind a fallback, a composer throw propagating
loudly to the host's own boundary — and the mandatory frame facts render
outside every slot), and the TVC laws, each of which now declares which
transcript it binds (`transcript-visual-contract.md` §3). The exemplar
is the view contract itself: it is open-everything for presentation
precisely because it hands out no decision controls — props are
`{ call, context }` and nothing else.

**Layer B — the trusted-host tool-view registry.** An optional registry
supplied in trusted host code — `toolViews?: ToolViewRegistry` on the
provider, or the same-named JS property on the script-tag elements —
that resolves a tool call to a view through the four-rung ladder. The
wire carries data and an opaque `{key, version}` reference, never code.
The shipped mechanics are documented in `tool-view-registry.md`; the
decision record is `tool-views.md`. (This layer's first cut — the
named-slot renderer registry in `src/core/renderer-registry.ts`, with
`renderers?: AssistantRendererRegistry` reserved on the provider — was
replaced whole by the tool-view contract; the rename is recorded in
`CHANGELOG.md`.)

## Layer A primitive inventory

Names and contracts only — no CSS here.

| Primitive                        | Contract (one sentence each)                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Process row                      | One tool call (or reasoning step) as a quiet inline line: state chrome, headline words from the resolved presentation, disclosure to its panes.                                                                                                                                                                                                                                                                                                                                     |
| Process rail                     | The grouping geometry consecutive process rows share, including the fold-open/held-open rules.                                                                                                                                                                                                                                                                                                                                                                                      |
| Run fold                         | The per-run collapse geometry of the transcript: per-cluster while a turn is open, unified completed episodes once it settles.                                                                                                                                                                                                                                                                                                                                                      |
| State badge                      | The protocol-state mark (running, done, failed, cancelled) — derived from `ToolCallState`, never from tool meaning.                                                                                                                                                                                                                                                                                                                                                                 |
| Disclosure / technical details   | **Retired.** The nested "Technical details" disclosure and its raw input/result panes were deleted; a row's body is its tool view alone (rung 4 is the bounded argument reading).                                                                                                                                                                                                                                                                                                   |
| Approval / elicitation frame     | The package-owned decision surface — a banner asking the one consent question over a mechanical tool label, the call's own row showing the request; its decision controls are never handed to host code.                                                                                                                                                                                                                                                                            |
| Generic review / artifact frame  | **Retired.** Removed by the transcript remediation pass — see `detail-surfaces.md`.                                                                                                                                                                                                                                                                                                                                                                                                 |
| Generic structured-data fallback | **Retired with the frame.** An untyped result renders no derived card (TVC-111): input-only, a registered tool view required for rich UI.                                                                                                                                                                                                                                                                                                                                           |
| TeaFlask agent identity          | The assistant's and its subagents' identity mark and naming.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Motion: active-text shimmer      | THE one shimmer every active-text surface uses — one shimmer, not three — with a reduced-motion equivalent.                                                                                                                                                                                                                                                                                                                                                                         |
| Motion: spinner                  | THE one indeterminate spinner, with a reduced-motion equivalent.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Error boundary (slot isolation)  | Two mechanisms by seam: a host tool view is isolated imperatively in `tool-view-slot.tsx` (a React boundary cannot catch adapter throws) and a throw lands on the resolution rung below; a host slot fill is isolated by the React slot boundary (`slot-boundary.tsx`) with the package rendering as its fallback — except the input slot, deliberately unbounded so decision-capable chrome is never latched behind a fallback. Package-owned backstops render outside every slot. |
| Loading / empty states           | The package-owned skeleton and empty-state treatments.                                                                                                                                                                                                                                                                                                                                                                                                                              |

## The semantic envelope

The `tool_call_annotated` display payload — six fields, every one
optional and absent-never-null. (The pre-launch teardowns deleted
`kind`, `disclosure`, `sensitivity`, and `ui_spec` and renamed
`renderer` to `view` — `tool-views.md`, "The display envelope". A
present `kind` is now just an unrecognised field the narrower ignores;
it can never blank the display.) Multiple markers per call stay legal;
**merge is per-field, first non-absent value wins — except `view`,
which merges atomically as a whole object.**

| Field           | Rule (testable sentence)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `caption`       | The model's own words for the step: the row's label in every state — alone while running and when done, with a quiet state word (`· failed`, `· not approved`, `· didn't run`, `· declined`, `· didn't finish`) otherwise; forwarded at the progress moment only; clipped at 500 chars by the client narrower; when present, the text fields below carry no label.                                                                            |
| `progress_text` | The row's words while the call runs when no caption arrived; clipped at 500 chars by the client narrower.                                                                                                                                                                                                                                                                                                                                     |
| `complete_text` | The row's words once the call completed; a failed call never wears `complete_text`.                                                                                                                                                                                                                                                                                                                                                           |
| `error_text`    | Authored failure copy for a call that settles output-error; absent, the mechanical "X failed" frame renders; it is never shown on a successful or cancelled call.                                                                                                                                                                                                                                                                             |
| `icon`          | A semantic icon token from the open operational vocabulary `search, file, terminal, question, memory, delegation, routine, todo, navigation, generic` (`todo` is in the CLIENT's resolved vocabulary; the backend authoring enum deliberately gains `TODO` only with its first producer, so no producer can emit it yet); the client stores unknown tokens verbatim (capped at 64 chars) and resolves them to `generic` at presentation time. |
| `view`          | An opaque `{key, version}` tool-view reference — the resolution ladder's rung-1 key; it narrows whole or not at all (a blank or over-128-char key or a non-positive-integer version drops the ref), and it never carries code.                                                                                                                                                                                                                |

(The `disclosure`, `sensitivity`, and `ui_spec` fields were deleted
producer-less by the teardowns — openness now derives from resolution
and pending decisions, redaction returns additively with its first real
producer, and result UI is authored through views. `tool-views.md`
records each deletion's reasoning.)

Beside `display`, the marker carries the running tool's registered JSON
Schemas — `tool_input_schema` / `tool_output_schema` — which reach a
view as the optional `argsSchema` / `resultSchema`
(`JsonSchema = Record<string, unknown>`). Absence is `undefined`, never
`{}`, and no key rides the wire when absent, so `'argsSchema' in call`
is false on an unschema'd call.

Identity: **`tool_call_id` is the stable operation identity** — it is
already namespaced per run/attempt and replay-stable; no new identity
field exists.

Copy responsibility: the row's label is the model's own `caption` — a
required input on every tool, forwarded once at the progress moment and
shown in every state, with the shimmer or a quiet state word
(`· failed`, `· not approved`, `· didn't run`, `· declined`,
`· didn't finish`) carrying the state. Beneath it, backend tool owners
author the fallback copy beside their tools; catalog actions derive
their sentences from the catalog row's title; the client package
contains no mapping from any tool name to any copy, icon, or view — its
own tools' built-in views resolve through the reserved `teaflask.*`
keys, never a tool-name switch, and its permitted transforms are the
mechanical `humanizedToolName` spelling cleanup and the strip of the
reserved `caption` argument key before any view or card reads the
arguments.

Icon responsibility: the icon vocabulary describes operational meaning,
never brands or action names; catalog actions are deliberately authored
without an icon and render `generic`; a customer replaces the mark's
glyph only, through a tool-view registration's `icon` — identity, state
ink, and the sr-only state word stay package-owned, and the container
is `aria-hidden`.

## One presenter, many consumers

`toolCallPresentationOf(view, registry?)` in
`src/core/tool-call-presentation.ts` is the single resolution point.
**No consumer may reinterpret the raw display envelope; each reads its
slot from the resolved `ToolCallPresentation`.**

| Consumer                    | Slots read                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Compact transcript row      | `headline`, `icon`, `status`                                                                                                         |
| Approval banner             | **None.** Fixed consent copy plus a mechanical tool label; the call's own row, held open by the pending decision, shows the request. |
| Resolved action summary     | `settledSummary`                                                                                                                     |
| Subagent current-work label | `currentWorkLabel`                                                                                                                   |
| Tool-view slot (row body)   | `toolView` — the four-rung ladder's answer                                                                                           |
| Technical details           | **Retired** — the `technicalDetails` slot and its disclosure were deleted; no consumer reads raw payloads                            |

Resolution of the `toolView` slot is the four-rung ladder
(`tool-views.md`; shipped mechanics in `tool-view-registry.md`): host
registry by the wire's exact `{key, version}` (rung 1); host registry by
exact tool name — no annotation, no version compare, and it beats rung 3
so a customer may re-skin a tool we ship (rung 2); the frozen package
built-ins under reserved `teaflask.*` keys — exactly five, all version
1: `teaflask.action` serving every `action__{slug}`, `teaflask.command`
serving `sandbox_bash` and `docs_filesystem`, `teaflask.file-edit`
serving `sandbox_file_editor`, `teaflask.docs-search` serving
`docs_search` (the hit list as a list), `teaflask.questions` serving the
question-set tool (the recorded questions and answers, read-only) (rung
3); and the package default view — the bounded, byte-deterministic
**input** reading (`DefaultToolView`), the slot's own terminal (rung 4;
there is no output gate and no explicit override, so a view mounts for
the call's whole lifecycle). Absence, an unknown key, version drift, an
invalid registration, and a thrown adapter are all the same answer — the
rung below, one rung per degradation, tracked by adapter identity, never
by position; there is no compatible-version fallback.

Resolution rules (each testable): unknown icon → `generic` (the
disclosure and sensitivity rules left with their fields — openness now
derives from whether a view resolved and whether a decision is pending);
`settledSummary` is by definition the resolved headline — the ladder's
settled arms (completion copy on a completed call, error copy else the
failed frame on a broken one, the refusal frame on a cancelled one) ARE
the summary, and the slot exists so summary consumers bind to a name
whose future divergence, if any, lands in the presenter and never in a
consumer; the approval banner deliberately consumes no presenter slot at
all — fixed consent copy plus a mechanical tool label;
`currentWorkLabel` is by definition the ladder's RUNNING arm regardless
of the call's own protocol state; no presenter slot respells a ladder
frame — every copy slot derives from `toolRowHeadlineOf`, so a frame's
wording changes in exactly one place; a view with no display annotation
resolves entirely from the mechanical ladder; an old-wire (text-only)
display resolves to the identical headline the text-only ladder
produced.

## Layer B constraints

Each sentence is binding on the shipped tool-view contract:

- The wire carries data and an opaque view key/version, never executable
  code.
- View registration is trusted code on every distribution: the React
  provider's `toolViews` prop, or the same-named JS property on both
  script-tag elements — per-element, never a global, and deliberately
  without an HTML-attribute spelling, because a registry carries
  functions and an attribute would demand deserializing executable text,
  which "no executable code rides the wire" and strict CSP both forbid.
- A view resolves only on the ladder's exact matches; absence, an
  unknown key, version drift, an invalid registration, and a thrown
  adapter all land on the rung below, and there is no compatible-version
  fallback.
- There is no separate exact-tool approval registry: a view cannot
  approve its own operation. The package banner is the one approval
  surface; a purpose-built review of a specific tool is a rung-2 view
  beside the banner.
- A view receives exactly `ToolViewProps { call, context }` — the
  recorded call (with its parsed args, result, and optional schemas)
  plus `context.themeMode` — never stores, auth tokens, transport
  access, or approve/deny. (The first cut's `RendererPayload` left with
  the renderer registry.)
- A registered view's failures are isolated imperatively at the mount
  slot (a slot fill's by the React slot boundary, with the input slot's
  deliberate unbounded exception — the Layer A row above), and the
  package-owned backstops render outside every slot.
- The registry seam is additive and semver-safe.
- The dashboard dogfood host registers views through the same public
  provider prop as any customer — the package never imports dashboard
  internals. (A claim about shipped code: the dashboard registers its
  `get-invoice` action view through that prop.)

## Compatibility and migration

- Old histories render through the current ladder: a stored `kind` is
  dropped structurally like any unrecognised field (the field was
  deleted end to end by the teardowns), and a text-only display resolves
  to the identical headline the text-only ladder produced.
- The `ui_spec` plane was deleted whole: a stored `ui_spec` is likewise
  dropped structurally, and result UI is authored through views — never
  inferred (TVC-111).
- Unknown annotation fields and variants remain tolerated: the narrower
  destructures only known keys, so old clients drop new fields
  structurally and new clients drop future fields the same way.
- Old clients ignore the new fields; new clients render old histories
  with the current fallback ladder.
- Replay persists the presentation that was true for that run:
  annotations are immutable run events snapshotted at emit time, and
  catalogue edits never rewrite history.
- Pre-launch removals from serving/v1 are sanctioned one by one through
  `scripts/contract-shrink-allowlist.json` — the route the display
  teardowns took; from 1.0 the contract's additive-only rule binds
  absolutely and the shrink gate enforces it mechanically.
- The dashboard's run viewer carries the identical narrowing/merge
  semantics by importing them: the projection layer (anchor recorders,
  subagent grouping, the shared pure leaves) ships from
  `@teaflask/assistant/transcript`, and the approval trio is the
  package's implementation. The fork ledger (the dashboard's fork-parity
  inventory test) scans the whole dashboard source with three detectors
  — same basename, verbatim member body at any depth with no size floor,
  and same top-level member name — and holds a documented-fork register,
  not an exemption list: every file pair and member pair it flags is
  either collapsed onto the package or registered with the sentence
  saying why the two MUST differ (a renderer over a different door or
  token vocabulary, two architecture laws over one enum). The identity
  mark's re-export shim stays pinned by a live parity suite; the
  renderer-posture divergences (the delivery divider, the subagent group
  row, the attachment chips, the subagent pill, the playground composer)
  each name their door; the members they still share are pinned
  identical or registered divergent one by one.

## Non-goals and reserved future additive steps

Not built here, and each reserved as an additive step that breaks no
public contract (dispositions noted in place):

- **`detail {kind, data}`** — RESOLVED, no longer reserved: views
  receive the call's parsed `args` and `result` (and their schemas)
  directly, so no second wire channel is needed. The ruling and its
  reasoning are recorded in `detail-surfaces.md`.
- **Structured approval risk/scope fields** on the approval marker —
  destructive risk currently rides as prose inside `prompt`; a
  structured field is additive when a producer needs it. (Still
  reserved.)
- **Authored `error_text` producers** — the wire carries the field; the
  backend authoring hook still skips failed calls today. (Still
  reserved.)
- **The registry implementation** — shipped as the tool-view registry
  (`tool-view-registry.md`).
- **Richer `kind` variants** — superseded: the teardowns deleted `kind`
  end to end, and views are the generative-UI door (`tool-views.md`,
  "The display envelope").
- No Gmail/calendar replicas, no remote code execution, no
  catalogue-time AI-generated components, no deletion of typed
  approvals/results, no component CSS decisions.

## Decision log

- **`kind` stays `"text"`; new capabilities are additive fields.** The
  ui_spec precedent proved this is the safe move; a new kind is silently
  dropped whole by every shipped client narrower. (Superseded: the
  pre-launch teardowns deleted `kind` outright — a one-member
  discriminator was never a usable extension point, and a present `kind`
  is now just an unrecognised field; `tool-views.md`.)
- **`tool_call_id` is the identity.** It is already namespaced and
  replay-stable; a second identity field would buy nothing and could
  drift.
- **Open string vocabularies, not wire enums.** The client narrows from
  `unknown` regardless; an enum would force schema churn per member and
  make older stores destroy newer values. Fallbacks are named per field
  instead, and sensitivity's fallback is deliberately fail-closed. (The
  `sensitivity` field itself was retired producer-less; the
  open-vocabulary ruling stands for the surviving fields.)
- **`renderer` is the one atomic-merge field.** Key and version are
  meaningless apart; per-field merge could weld a key from one marker to
  a version from another under replay. (The field is spelled `view`
  after the rename; the atomic-merge ruling is unchanged.)
- **`ui_spec` remains the detail channel.** A parallel `detail` object
  now would be speculative; the seam is reserved instead. (The detail
  surfaces record took up the reserved review and left the seam
  reserved. Superseded twice over: the `ui_spec` plane was deleted
  whole, and the reserved seam is now RESOLVED rather than reserved —
  views receive args and result directly; `detail-surfaces.md` carries
  the ruling.)
- **A registry over sanctioned deep-imports.** Deep imports are
  structurally impossible (the exports map) and would leak internals;
  the registry keeps the seam bounded, versioned, and fallback-safe.
