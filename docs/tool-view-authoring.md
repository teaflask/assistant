# Authoring a tool view — the laws

A tool view is a presentation of one recorded tool call
(`tool-views.md`). This page is the author's checklist; the contract and
registry mechanics are `tool-view-registry.md`.

## Finding the key and the types

A catalog action mounts as the tool `action__{slug}`. The slug is what
the Actions page shows beside the action's title; the action's own page
renders copy-pasteable `type <Pascal>Args` / `type <Pascal>Result` from
its schemas. Register in slugs and let the package add the prefix:

```tsx
const toolViews = actionToolViews({
  "get-doc": { version: 1, view: reactToolView(GetDocView) },
});
```

## What the call carries for an action

You never guess an action's argument shape. `call.args` is always the
three-key envelope the backend composes from the action's request
schemas — `{ path_params, query, body }` — one key per schema the
action declares, and none it does not. `path_params` and `body` are
present whenever declared; `query` is present when its schema names a
required property and optional otherwise. Inside each key the object
is exactly the action's own schema for that part: the path placeholders,
the query parameters, the request body. `call.result` is the HTTP
response body alone, the transport wrapper (`ok`, `status`, `truncated`)
already stripped by the package; `actionEnvelopeOf(call.resultText)`
gives the status when a view needs it. The action's page prints this
as `type <Pascal>Args` / `type <Pascal>Result`, and the same schemas
arrive at runtime as `call.argsSchema` / `call.resultSchema`.

## When the row opens

A row unfolds by default only while its turn is current and one of two
things is true: a host-authored view resolved for it (your registry,
rungs 1–2), or a decision is anchored to it. The package's own
built-ins and its default reading never open a row, and a row that
failed, did not run, or carries a degraded record (truncated, offloaded)
stays closed whatever it resolved — the pill
names the state, the body is for the member who asks.

## Compose the parts

The built-ins paint with one vocabulary and hand it to you as React
components on the main entry: `ToolViewCard` (a hairline card, optional
title above), `ToolViewRow` (icon tile, title, muted second line,
trailing badge; `href` makes the row navigate), `ToolViewFacts`
(property rows), `ToolViewCaption` (a quiet line inside the card),
`ToolViewBody` (a scrolling region for a document or a diff),
`ToolViewScroll` (a bounded scrolling well for a long list), `ToolViewBadge`, `ToolViewNote`, and `ToolViewBones` (skeleton lines).
A view composed from these reads as one system with ours; a view that
paints its own chrome will not.

## What a view inherits

The mount node carries the row's compact text size; the widget root's
font and foreground colour cascade in. Set no font, size or colour of
your own and the view reads as the row it sits in. For shared vocabulary
use the exports: `settledOutcomeNoteOf(call)` (the not-run sentence),
`actionEnvelopeOf(resultText)` (an action's HTTP status and body),
`actionFailureOf(errorText)` (a failure's message and, when the API
supplied it, status, code and per-field problems), `pane` / `note` for
vanilla adapters. Package `tf:` utility classes are not yours to use.

## A view lives in its own React root

`reactToolView` renders into a separate `react-dom` root: no router, no
query client, no theme provider reaches it. Theme is `context.themeMode`.
Links are plain anchors. If a view reads live state to make the record
judgeable (the current text a revision replaces), the read is GET-only,
labelled live, fails on its own with its own note, never changes how
the recorded call reads, and starts only once the view is on screen — a
view mounts for the call's whole life, inside rows and folds that may be
closed, and a read no one opened is a read not worth making.

## One law per lifecycle moment

| Moment                                            | The view shows                                                                                                                                                               | Never                                                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `input-streaming` / `input-available`             | the request reading as arguments parse; skeleton lines where the result lands, drawn without a card or border                                                                | "Loading…", a spinner, an outcome word, an empty card around the bones                                 |
| `awaitingDecision`                                | every argument that will be sent, as a proposal; the wait as a badge on the proposal row                                                                                     | approve/deny controls, a link to a not-yet-created resource, a floating "awaiting" line                |
| `output-available`                                | every row, in a scrolling well when long, the count in the card's foot; one link out; the response status, if said at all, as a quiet foot caption via `actionEnvelopeOf`    | present-tense claims; an outcome word as a card title ("Created") — the row's headline already says it |
| `output-error`                                    | what did not happen as a badge on the proposal row ("Not created"), and the API's field problems via `actionFailureOf` as property rows                                      | success furniture; the status code, the error code, or the failure sentence the row already prints     |
| `denied` / `refused` / `cancelled` / `superseded` | the request reading; for a read `settledOutcomeNoteOf(call)`, for a mutation the pill's word as a badge on the proposal row (cancelled and superseded both read Interrupted) | "didn't run" for superseded — its result never arrived                                                 |
| `truncated` / `offloaded`                         | the note; no count, no card                                                                                                                                                  | a card built from a partial body                                                                       |

## Prove it

Drive the registration through `mount → update → destroy` over every
status plus the decision-pending, truncated and offloaded arms, posing
the exact shapes the producer emits: `{ok: true, result: {status, body,
truncated}}` in `resultText`, and in `errorText` the failure SENTENCE
alone — `"Title" failed in this page: HTTP 422 CODE — reason. Field
problems: "body.x": "is required". Do not assume …` — because the
stream's mapper keeps the envelope's `error.message` and withholds the
rest from the view model. `actionFailureOf` also reads the whole failure
JSON, for stores that record the envelope; that is compatibility, not
the transcript's shape.
A view that throws falls to the rung below; a view that lies passes.
