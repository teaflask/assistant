# Trusted host tool-view registry

The package exposes one deliberately narrow trusted-code seam: the
tool-view registry (`toolViews?: ToolViewRegistry` on the provider).
This file documents the shipped mechanics; the decision record is
`tool-views.md`. (There is no second seam — no exact-tool approval
registry: a view cannot approve its own operation.)

## One contract, two spellings

The canonical authoring form is the imperative adapter —
`ToolViewAdapter { mount(container, props) → { update, destroy } }` —
so non-React hosts are first-class. `reactToolView(Component)` is thin
sugar producing the same adapter from a React component. `update`
applies new props in place (never a remount — a view's local UI state
survives a status advance); `destroy` runs on unmount. A registration
`{ version, view?, icon? }` may carry a view, an icon, or both: the
icon replaces the operation mark's glyph and nothing else, inside the
package-owned mark chrome.

## The resolution ladder

`toolCallPresentationOf` (core/tool-call-presentation.ts) stays the
single resolution point; consumers read its `toolView` slot, never the
raw display envelope. Precedence:

1. host registry, by the wire annotation's exact `{key, version}`;
2. host registry, by exact tool name — no annotation, no version
   compare; rung 2 beats rung 3 so a host can re-skin a package tool;
3. package built-ins under the reserved `teaflask.*` namespace
   (`PACKAGE_TOOL_VIEWS`: `teaflask.action`, `teaflask.command`,
   `teaflask.file-edit`, `teaflask.docs-search`, `teaflask.questions`) —
   exact key and version;
4. the package default view: the bounded, deterministic argument reading
   (`DefaultToolView`, tool-arguments-summary.tsx), the mount slot's own
   terminal.

Absence, an unknown key, version drift, a role-less registration and a
throwing adapter are all the same answer: the rung below. `teaflask.*`
keys never resolve from the host registry (by key or by tool name), so
tool output can never name a privileged view. Every lookup is
own-property-guarded; there is no compatible-version fallback.

Executable code never rides the wire. The registry is conventional code
in the trusted host's own page — the React provider's `toolViews` prop,
or the same-named JS property on the script-tag elements, assignable
before or after upgrade and sanitized at that door: reserved
`teaflask.*` keys and wrong-shaped registrations drop one by one with a
named warning.

## Registering by action slug

`actionToolViews({ "get-doc": { version: 1, view } })` is the registry
spelled in the slugs the Actions page shows: it applies the tool-name
prefix (`actionToolName(slug)` → `action__get-doc`) so a host never
learns the prefix by folklore, and a registry of ordinary tool names
composes beside it with a spread. The result resolves on rung 2.

## What a mounted view inherits

The mount node carries the row body's compact text register
(`tf:text-xs`), and the widget root's font family and foreground colour
cascade into it, so a view that sets no font, size or colour of its own
reads as the row it sits in. The box-sizing and hairline border-colour
reset deliberately excludes host DOM (`data-tf-host-view`) so a host can
style its own borders. Package `tf:` utilities are emitted only for the
package's own components — a host reaches shared vocabulary through the
exported primitives (`pane`, `note`, `settledOutcomeNoteOf`,
`actionEnvelopeOf`, `actionFailureOf`) or the documented `--tf-*` tokens.

## The props contract

A view receives exactly `ToolViewProps { call, context }`: the recorded
call (identity, status, `awaitingDecision`, parsed `args`, and — when a
result landed — `result` via the tool-result/v1 envelope parser beside
the verbatim `resultText`, with `truncated`/`offloaded` as honest
flags) and `context.themeMode`. No stores, no auth tokens, no
transport, and no approve/deny — a view presents a tool call and never
owns its decision.

## Error isolation

The mount slot (tool-view-slot.tsx) try/catches `mount` and `update`
imperatively — a React error boundary cannot catch adapter throws — and
advances monotonically to the rung below; `reactToolView` converts a
render throw into a synchronous adapter throw. Errors reach the
provider's `onError` observer and a named console message; the member
sees the next resolution rather than a stack trace. The row's own
error, refusal and offloaded lines render OUTSIDE the slot, where no
adapter can remove them; there is no raw-payload backstop — the view is
the row's whole body.

## Theme law

Views receive the palette the package actually paints. The widget
root's `data-tf-theme` wins; a bare root inherits a strict dark
ancestor; root-level `auto` follows the OS preference. Attribute and
media changes reach mounted views through `update`.

## Host-authored DOM inside the widget

`data-tf-host-view` marks every slot where host-authored DOM renders
inside the widget root, and the stylesheet's `[data-tf-assistant]`
box-sizing + border-color reset excludes everything under the marker
(`:where(*:not([data-tf-host-view] *))`, specificity-pinned), so a
host's own styling reaches its content untouched instead of being
flattened to package defaults. The marked slots — one attribute, one
rule, however the host DOM arrived:

- the tool-view adapter mounts (`tool-view-slot.tsx` — the row-body
  mount container and the icon span);
- `renderChrome`'s output (`assistant-page.tsx`);
- the page `welcomeMark` (`conversation-view.tsx`);
- a host's `companionMark` node (`companion-mark.tsx`), wherever the
  mark renders — the corner perch and the drawer's
  welcome. The marker wraps the host's node alone: the companion
  drawer's welcome slot itself is not marked, so the default flask stays
  package DOM and the reset keeps owning it. One exception a view author
  should know: on the script-tag route, `companion-mark-src` renders
  through `companion-mark-image.tsx`, which falls back to the package
  flask inside the marker after a failed load — package DOM the reset
  does not own, harmlessly (the flask has no border or box metrics).

The consequence a view author needs stated: inside a host view the
widget no longer supplies `box-sizing: border-box` or the hairline
`border-color` — carry your own, per the Shadow DOM obligation in
`tool-views.md` ("Two authoring forms").
