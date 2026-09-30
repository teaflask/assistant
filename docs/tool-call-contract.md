# The tool-call rendering contract

**Status: accepted.** The design record for
`src/core/tool-call-display.ts`, `src/core/tool-view.ts` and
`src/core/tool-call-presentation.ts`, which keep the invariants and
point here. The view program's decision record is `tool-views.md`; the
shipped ladder is also narrated in `presentation-architecture.md`. Each
section below names the module and symbol it belongs to; the
list-bearing ones sit in text fences so their shape is preserved.

## States (`ToolCallState`, tool-call-display.ts)

Protocol states, derived from the AG-UI event trail (TOOL_CALL_START/
ARGS/END/RESULT) — the AI SDK vocabulary, minus the approval states our
approval inbox models separately, plus `cancelled` (the wire's cancelled
stamp: the call never ran — its "result" is model-facing cancellation
text, not an outcome) and `superseded` (a prior attempt's severed call:
a run retry restarted the conversation past it, so its RESULT can never
arrive — it ran and was cut, not denied), plus `denied` (a member
declined the approval the call was paused for — the wire carries that as
a cancelled result, and the client's join of the approval_requested /
approval_resolved markers names it; the call never ran because a human
said no), plus `refused` (the serving door's own refusal — the call
never reached the tool, and the row carries the door's reason as
`refusalText` in neutral ink, never in the Error pane). Four extras in
all; the AI SDK's own vocabulary is the four `input-*`/`output-*` states
and its approval states.

## Headline frames per settled state (`toolRowHeadlineOf`, tool-call-display.ts)

The `denied` arm:

A member declined the approval: second person on purpose — the one
settled arm whose cause is the reader's own decision, and the frame that
keeps it apart from cancelled's "Didn't run" (the wire's stamp for a
cancel nobody in the room performed) and refused's "Didn't X" (the
door's answer, TVC-038).

The `refused` arm:

The door answered and declined: "Didn't wait for subagents" — the tool's
own verb phrase after "Didn't", because the call was made and turned
down, not run and cut. The row's reason line carries the door's
sentence.

The `superseded` arm:

Distinct from cancelled's frame: this call STARTED and was cut
by a run retry — the row's Interrupted pill and its fold's
interrupted count are the retry's surviving evidence (the resume
divider that used to narrate it went with the meta-receipt rows).

## The model's caption (`_captionedHeadlineOf`, tool-call-display.ts)

Every tool takes a required `caption` — a few plain words the model
writes saying what the call is for. A caption is intent, not a claim, so
one label stays true whether the call finished, failed or was cancelled:
it is the headline in every state, verbatim, with no ellipsis and no
tense change. Running and done show the caption alone (the shimmer
carries the running state); the other settled states append a quiet
state word — `caption · failed`, `· not approved`, `· didn't run`,
`· declined`, `· didn't finish` — the same words the tool-name frames
below speak. When a caption is present the display copy per state below
is not consulted; without one, the ladder is exactly as it was.

The wire's `caption` is also a protocol-reserved argument key: the
package strips it from `call.args` (see the identity law) and from an
approval card's `tool_args`, so no view or arguments summary shows it
twice.

## Display copy per state (`_displayTextFor`, tool-call-display.ts)

The display slot per state: completion copy only for a call that
actually completed — a failed call must never wear the success sentence,
so output-error takes authored ERROR copy when the wire sent it and
otherwise falls to the "X failed" frame (its Error pane carries the
wire's human failure sentence). A cancelled call refuses copy entirely:
it never gets complete_text, and the progress sentence it may have worn
was written before the cancel decision — "Didn't run X" is the only true
thing left to say.

The `denied` arm:

Refuses copy like cancelled: the progress sentence was written before
the member decided, and no outcome ever landed (the wire's cancelled
stamp is all the result carries) — the "You didn't approve X" frame is
the only true thing left to say.

The `refused` arm:

Refuses copy like cancelled: the progress sentence was written
before the door declined, and no outcome landed — the refusal
sentence is the row's reason line, not its headline.

The `superseded` arm:

Refuses copy like cancelled: the progress sentence was written
before the severance, and no outcome ever landed to describe.

## Adapter typing (`ToolViewAdapter`, tool-view.ts)

The canonical authoring form: an imperative mount into a
package-owned container. A throw from `mount` or `update` is the
adapter's one failure channel — the slot reports it and resolution
falls to the rung below.

The generic parameters thread ToolViewProps' own: an author writing
against generated per-org argument types keeps them through the whole
lifecycle. `mount`/`update` are METHOD declarations on purpose — method
parameters stay bivariant under strictFunctionTypes, which is the
deliberate, documented unsoundness that lets a typed
`ToolViewAdapter<MyArgs>` and the registration's default-typed slot
assign into each other (at runtime every adapter receives the same
parsed call regardless of its declared TArgs). One constraint under
strict mode: declare argument shapes as `type` aliases (or give an
interface an index signature) — a bare `interface` has no implicit index
signature, is not assignable to the default `Record<string, unknown>`,
and will not cross this seam.

## The resolution ladder (`resolvedToolViewsOf`, tool-view.ts)

```text
The four-rung resolution ladder (tool-views.md), static half — the
candidates that exist before anything mounts:

 1. host registry, by the wire's `{key, version}` — exact key AND
    exact version (compatible-version resolution is ruled out;
    reopening it is a contract change, not a patch);
 2. host registry, by exact tool name — no backend annotation
    needed, and no version to compare: the host naming its own tool
    is the host's own act. Rung 2 beats rung 3 so a customer may
    re-skin a tool we ship;
 3. package built-ins, by reserved `teaflask.*` wire key — the same
    opaque-key seam a host uses, never a switch on a tool name;
 4. (definitional, see ToolViewResolution) the package default.

Every lookup is own-property-guarded — a key naming an
Object.prototype member (toString, constructor, …) is data and
resolves nothing through the prototype chain. Reserved keys are
refused at both host rungs (isReservedToolViewKey). One production
caller: toolCallPresentationOf — the presenter is the single
resolution point for everything a ROW renders, and its consumers read
slots. The fold pass never resolves views: which views a
row carries cannot move a fold boundary.
```

## The identity law (`_toolViewCallOf`, tool-call-presentation.ts)

```text
The tool-view call, assembled once here: parsing wire text into
renderable data is resolution, and it must not fork per consumer.
`context.themeMode` is deliberately NOT assembled here — it is the
slot's ambient fact (use-resolved-theme-mode.ts), not replay data.

IDENTITY LAW: every value on the call is identity-stable across a
re-render with unchanged source, because the mount slot's structural
delivery guard rests on it (an unstable identity reads as a change
and delivers an update — with the React sugar, a synchronous render
into a nested root — per streamed token). The census, member by
member:
- toolName, toolCallId, status, awaitingDecision, resultText,
 truncated, offloaded, errorText, refusalText — primitives:
 identity IS value.
- args — the memoized parse of the source text (_jsonDocumentOf):
 one object per source string; absent/mid-stream/non-record source
 resolves to the one shared EMPTY_ARGS constant.
- result, truncated — LAZY accessors over resultText: the structuring
 parse (the memoized document, then the toolResultEnvelopePayloadOf
 selector) runs on the first read of either and once per call, so a
 row whose view never reads them (rung 4's default reading) never
 pays it; read, result points into the same memoized object per
 source string, and the slot's delivery guard compares resultText,
 not these, so the guard itself forces no parse.
- argsSchema, resultSchema — references held stable by the schema
 anchors map (tool-schema-anchors.ts: the first-wins merge keeps the
 stored field references and a no-op merge returns the map itself),
 passed through unwrapped — never re-minted per read.
The one instability: when the parse memo resets at its cap, the next
read mints fresh identities once — one over-delivered update per
mounted view, the safe direction (never a suppression).
```

The reserved-key strip keeps the law: when the parsed record carries
`caption`, `args` is a caption-less copy memoized against the parsed
document (a `WeakMap`), so one source text still yields one object; the
shared parsed document is never mutated, and a record that was only a
caption yields the shared empty args.

## The parse memo (`_jsonDocumentOf`, tool-call-presentation.ts)

```text
The parse memo: identity by construction, keyed on the source text.
Re-minting parsed values per render is the mechanism that made an
identity delivery guard dead and a shallow one half-alive for nested
arguments — memoizing the parse makes "same source text" and "same
object" the same fact, instead of reconstructing objects and then
comparing them. Premises:
- the memoized document is SHARED across every reader of the same
 text: a view mutating its `args`/`result` was never supported (the
 contract is presentation-only) and would now visibly poison later
 reads — do not mutate what a call hands you;
- parse FAILURES are not memoized: a streaming argument tail is a new
 string per token, and caching failures would grow the memo per
 token for zero hits.
The cap is a wholesale reset, not an LRU: growth is bounded by the
number of distinct parsed texts actually read (view/icon-bearing
rows), a reset merely re-parses once, and the transcript already
retains the source strings themselves.
```
