# Detail surfaces — the retired uiSpec plane and the detail seam

**Status: accepted.** This is the decision record for settled-result
detail surfaces: what the retired `ui_spec` plane was, the ruling that
retired its generic frame, and the disposition of the
`detail {kind, data}` seam the presentation architecture
(`presentation-architecture.md`) once reserved. The living contract for
result presentation is `tool-views.md`: result UI is authored through
registered tool views, and the surviving law of this file is TVC-111 —
result UI stays authored, never inferred.

## The retired `ui_spec` plane

`ui_spec` was the catalog's result presentation spec and the one typed
result-detail channel of its day: a closed three-member declarative
result grammar (table / entity-card / matrix) authored per catalog
action, narrowed whole-or-null on the client and rendered from the row's
detail slot. The plane is deleted whole — the typed result previews, the
catalog spec, its narrowers — together with the exact-tool
`ApprovalRendererSlot` (a view cannot approve its own operation), the
sensitivity token (retired producer-less; it returns additively with a
real producer), and the registry `artifact` slot (the registry it
belonged to was replaced by the tool-view registry). Two discipline
rules survive the plane and are law elsewhere: no surface reinterprets
the raw display envelope, and none authors its own semantic copy
(TVC-113 and Law 3 of `transcript-visual-contract.md`).

The question panel takes no result spec: `core/elicitation-pickers.ts`
only narrows the wire's question set, and the panel owns its own
presentation.

## The retired generic frame

A "generic structured fallback / review-artifact frame" — a bounded,
mechanical reading of any structurable JSON result the typed grammar
refused — once had a product mount in `tool-row.tsx`. It is retired:
deriving a card from every object is what produces the jarring field
dump the row grammar exists to avoid, and generic JSON is model-facing
evidence, not member-facing content. TVC-111 records the successor law:
an unknown customer tool exposes its input but renders neither an
inferred result card nor a raw output dump. The extension point for a
host-supplied artifact surface is a registered tool view
(`tool-views.md`); the offload rule holds beside it (an offloaded result
renders a quiet shortened-result line instead of any pane — the full
output is not retrievable from the transcript).

## The `detail {kind, data}` seam — RESOLVED

The presentation architecture reserved a richer `detail {kind, data}`
channel beside `ui_spec`, to be taken up or declined. **The seam is
RESOLVED, not reserved.** The need it was held open for — a richer,
typed detail channel beside the display copy — is met without a second
wire channel: a tool view receives the call's parsed `args` and `result`
directly (`ToolViewProps.call`), beside the verbatim `resultText` and
the optional `argsSchema` / `resultSchema` the marker carries. The data
a `detail {kind, data}` field would have transported already rides the
call record, and the `kind` a detail object would have named is the view
key the `view {key, version}` reference already names — so a second
channel would be a parallel spelling of the same facts, with its own
narrowers, parity twins, and merge rules to keep honest. Anyone
proposing to re-open the seam should first say what a detail object
would carry that `call.args`, `call.result`, and the schemas do not.
