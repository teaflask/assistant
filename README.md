# @teaflask/assistant

The teaflask embedded assistant: a drop-in conversation surface that
speaks only the public `/serving/v1` contract (the serving assistant
contract; the contract document itself does not ship in this package).
One publishable key, two imports, three lines of JSX.

## Install

```sh
npm install @teaflask/assistant
```

`react` and `react-dom` (18.3 or 19) and `use-stick-to-bottom` are peer
dependencies (npm 7+ installs them automatically; other package managers
may ask). No React in your stack? See [Script tag (no
React)](#script-tag-no-react).

The package is developed in a private monorepo and mirrored to this
repository; see [CONTRIBUTING.md](./CONTRIBUTING.md) for how issues and
changes flow.

## Use

```tsx
import "@teaflask/assistant/styles.css";
import { TeaflaskAssistant } from "@teaflask/assistant";

<TeaflaskAssistant publishableKey="pk_test_…" />;
```

`<TeaflaskAssistant/>` is the whole product face in one mount: the
companion in the corner of every route, the command palette on ⌘K (the
package owns the hotkey — see below), and the chat drawer on a click of
the companion. Mount it once near your app root; one root per page. It
accepts every provider prop in the table below, plus its own:

| Prop     | Meaning                                                                                 |
| -------- | --------------------------------------------------------------------------------------- |
| `hotkey` | The palette chord. `"mod+k"` by default; rebind (`"mod+j"`) or pass `false` to disable. |
| `corner` | The viewport corner the companion anchors to (`"bottom-right"` default).                |
| `ref`    | A `TeaflaskAssistantHandle` — the imperative escape hatch (see The hotkey).             |

Anonymous visitors converse immediately; the conversation persists in
this browser and resumes on reload. The publishable key's origin
allowlist (set on the agent's page in the teaflask dashboard, where the
key is issued) must include your site's origin.

### The hotkey

The root binds the palette chord itself — that is the batteries-included
promise, and it is also a global shortcut registered in _your_ app, so
it is escapable and deliberately polite:

- **Default**: `mod+k`, where `mod` is ⌘ or Ctrl. Rebind with the same
  grammar — `"+"`-separated tokens, at least one modifier from
  `mod|ctrl|meta|alt|shift` plus exactly one key (`"mod+j"`,
  `"ctrl+shift+p"`; a modifier-less key would swallow that character in
  every input, so it is rejected — as is shift alone with a printable
  key, since Shift+letter is just typing a capital) — or pass
  `hotkey={false}` to disable. An unrecognized spec disables the hotkey
  with a console warning; it never falls back to ⌘K, since a rebind away
  from a conflict must not be silently rebound into it.
- **Precedence — cooperate, don't capture.** The listener sits on
  `window` in the bubble phase, last in the dispatch order. A handler of
  yours that runs first and calls `preventDefault()` wins (as does
  `stopPropagation()` — the event never reaches us), and we call
  `preventDefault()` only on events we act on. Chords are matched
  exactly: `mod+k` ignores ⌘⇧K.
- **It opens from anywhere**, including a focused input — the Linear
  idiom. An editor that needs ⌘K for itself (insert-link, say) should
  `preventDefault()` in its own handler, rebind the palette, or disable
  the hotkey.
- **Pressing the chord again toggles the palette closed**; Esc and the
  backdrop still close it from the inside — with one precedence rule:
  while a turn is streaming and focus is in the composer, the first Esc
  is the stop shortcut (it ends the answer) and the palette stays open.
  Once the stop is in flight ("Stopping…") or the composer is idle, Esc
  closes the palette exactly as before; the backdrop and the close
  affordance are never intercepted.

The ref is the imperative escape hatch, so a disabled or rebound hotkey
never strands you without a way in:

```tsx
const assistantRef = useRef<TeaflaskAssistantHandle>(null);

<TeaflaskAssistant
  ref={assistantRef}
  hotkey={false}
  publishableKey="pk_test_…"
/>;

// e.g. from your own menu item:
assistantRef.current?.openPalette();
```

The handle exists only while the root is mounted — the optional chain
makes an early or late call a no-op. Note that opening the palette makes
the companion hide until it closes: the palette counts as an open
assistant surface, and the companion yields to those by design.

### Own the pieces instead

The root is composition, not magic — every piece stays public for hosts
that want their own trigger, placement, or a dedicated route:

```tsx
import "@teaflask/assistant/styles.css";
import { TeaflaskAssistantProvider, AssistantPage } from "@teaflask/assistant";

<TeaflaskAssistantProvider publishableKey="pk_test_…">
  <AssistantPage />
</TeaflaskAssistantProvider>;
```

`AssistantPage` fills whatever box it is mounted in — give it a sized
container (e.g. `height: 100vh`). Its own props are optional:
`frameless` drops the surface's card chrome (border and radius) when it
sits flush inside chrome you already draw, `suggestions` seeds the
empty state with opening prompts (strings, sent verbatim when clicked),
and `title` names the surface when no active conversation has a title
(defaults to "Assistant"). Conversation history opens from that title as
a transient disclosure instead of occupying a permanent rail. It also
pairs with the root: an
`<AssistantPage/>` mounted on your dedicated assistant route registers
itself, and the root's companion yields there automatically.

### Provider props

`<TeaflaskAssistant/>` and `<TeaflaskAssistantProvider/>` both take all
of these:

| Prop              | Required | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publishableKey`  | **yes**  | Your site's key (`pk_live_…` / `pk_test_…`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `baseUrl`         | no       | The teaflask API origin. Defaults to `https://api.teaflask.com`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `getEndUserToken` | no       | Async callback returning your backend-signed end-user JWT (see the serving identity contract), or null while signed out. Unlocks the identified tier: cross-device history and the thread list. Called on every token mint, so a rotated JWT is always picked up.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `actionsAdapter`  | no       | How this page performs the actions your teaflask catalog grants — one adapter for the whole catalog, in three flavors (see Actions below). Absent means this surface cannot perform actions; the assistant is told so in-band.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `onNavigate`      | no       | Callback taking the visitor to an app-relative path when the assistant asks (the navigate capability). Absent means this surface cannot navigate; the assistant gives the user directions instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `onError`         | no       | Observer for transport and stream errors (the surface already renders honest error states on its own).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `onTelemetry`     | no       | Observer for product-telemetry events (`AssistantTelemetryEvent`, exported) — the approval submit path's attempted/sent/dropped narration, plus `assistant_stream_failed`: each stream failure classified (`StreamFailureClass`: pre-response rejection, non-2xx with status, missing body, mid-stream death, protocol refusal, client abort) with the thread id and the resume/last-committed cursors that locate it on the recorded log — never any run content. Forward to your own analytics so a swallowed approval click or a dying stream is a query, not a mystery. Distinct from `onError` on purpose: these are events, not failures, and most carry no exception. npm-package hosts only for now — the script-tag element deliberately does not expose this seam yet. |
| `companionMark`   | no       | Your own companion mark — a React node rendered on the corner perch and the drawer's welcome, inside one 4rem box the package sizes; the package sets your node to 100% of that box, so a bare `<svg viewBox>` or `<img>` needs no sizing of its own. Read by identity. Omit it for the TeaFlask flask in the foreground color. Script-tag hosts set `companion-mark-src` instead (see The mark below).                                                                                                                                                                                                                                                                                                                                                                          |
| `toolViews`       | no       | Your own presentation for your own tools: a registry of tool views keyed by the opaque keys your backend's display annotations name, or by your exact tool names (see Custom tool views below). Resolution walks a fixed ladder — exact key-and-version, exact tool name, package built-ins, the package default — and a throwing view falls to the rung below. Script-tag hosts register the same registry through the element's `toolViews` property (see Custom tool views from a script tag).                                                                                                                                                                                                                                                                                |

Providers with the same session identity — `publishableKey`, `baseUrl`,
and whether `getEndUserToken` is wired — share one live conversation,
even when they mount in separate React roots: every surface streams the
same turn. The conversation is released when the last such provider
unmounts. (A setup failure on that identity — a bad key, a disallowed
origin — therefore surfaces on all of them at once.)

### Actions

When your teaflask actions catalog grants the assistant real API calls,
the `actionsAdapter` prop is how they execute — in this page, in the
user's own session, so the assistant can do nothing the user couldn't.
Each request arrives as a server-built `ActionIntent` (`{action: {slug,
title}, method, pathTemplate, pathParams, query, body?}`) — never model
prose — and the adapter never needs per-endpoint wiring. Three flavors:

```tsx
// Session-cookie APIs: the package assembles the URL and fetches with
// credentials included.
const actionsAdapter = {
  kind: "cookies",
  baseUrl: "https://api.your-domain.com",
};

// Token-auth APIs: answer the headers your API expects, per action.
const actionsAdapter = {
  kind: "headers",
  baseUrl: "https://api.your-domain.com",
  getHeaders: () => ({ Authorization: `Bearer ${yourAccessToken()}` }),
};

// Full control: your own request wrapper receives the whole intent and
// returns the response body (throw on failure, as API clients already do).
const actionsAdapter = {
  kind: "request",
  execute: (intent) =>
    yourApiClient(pathOf(intent), {
      method: intent.method,
      params: intent.query,
      data: intent.body,
    }),
};
```

The teaflask dashboard's Actions setup card generates the exact snippet
for your repo (including a detected API client, when there is one).

### Custom tool views

When the built-in rendering isn't enough for a tool you own, register
your own view for it. This is conventional trusted application code:
adapters you compiled and deployed in your bundle, registered through
the provider prop — **no JavaScript ever rides the wire**. A view is a
presentation of a tool call, not an approval mechanism: it receives the
recorded call and the painted theme, and nothing else.

```tsx
import {
  reactToolView,
  type ToolViewProps,
  type ToolViewRegistry,
} from "@teaflask/assistant";

// Module scope, not inline in JSX — the registry is read by identity
// and the mount slot keys the adapter lifecycle on adapter identity.
function OrderReview({ call, context }: ToolViewProps) {
  return (
    <div>
      <strong>Order review</strong>
      {call.status === "output-available" ? <OrderLines /> : null}
      <span>{context.themeMode === "dark" ? "🌙" : "☀️"}</span>
    </div>
  );
}

const toolViews: ToolViewRegistry = {
  // Rung 1: the opaque key your backend's display annotation names.
  "acme.order-review": { version: 1, view: reactToolView(OrderReview) },
  // Rung 2: your exact tool name — no backend annotation needed.
  acme__order_lookup: { version: 1, view: reactToolView(OrderReview) },
};

<TeaflaskAssistant publishableKey="pk_live_…" toolViews={toolViews} />;
```

**Registering by action slug.** A catalog action mounts as the tool
`action__{slug}`, where the slug is what the Actions page shows. Write
the registry in slugs and let the package add the prefix:

```tsx
import { actionToolViews, reactToolView } from "@teaflask/assistant";

const toolViews = {
  ...actionToolViews({
    "get-doc": { version: 1, view: reactToolView(GetDocView) },
  }),
  acme__order_lookup: { version: 1, view: reactToolView(OrderLookup) },
};
```

The action's page also renders copy-pasteable `Args` / `Result` types
for its schemas, so a typed view is `ToolViewProps<GetDocArgs, GetDocResult>`.

**What your view inherits.** The mount node carries the row's compact
text size, and the widget's font and foreground colour cascade into it:
set no font, size or colour of your own and the view reads as the row.
The package exports the built-ins' own vocabulary for re-use —
`settledOutcomeNoteOf(call)` (the not-run sentence per settle),
`actionEnvelopeOf(resultText)` (an action's HTTP status and body),
`actionFailureOf(errorText)` (a failed action's message and, when the
API supplied it, its status, code and per-field problems), and the
`pane` / `note` DOM primitives for vanilla adapters.

**The resolution ladder.** One view per call, resolved once, in a fixed
precedence; every degraded case is simply the rung below:

1. your registry, by the wire annotation's exact `{key, version}`
   (`display.view = {key: "acme.order-review", version: 1}`);
2. your registry, by exact tool name — naming your own tool is your own
   act, and it beats rung 3 so you can re-skin a tool teaflask ships;
3. package built-ins, under the reserved `teaflask.*` key namespace —
   `teaflask.action` (every catalog action), `teaflask.command`,
   `teaflask.file-edit`, `teaflask.docs-search` and `teaflask.questions`
   (the recorded question set). A `teaflask.*` key never resolves from
   YOUR registry — tool output can name a key, but it can never name a
   privileged view or resolve anything your bundle didn't compile in;
4. the package default — a bounded, deterministic reading of the call's
   arguments, the slot's own terminal: a registered view that throws
   advances to the rung below and terminally lands here. Views mount in
   the row's body for the call's whole lifecycle; a call with no
   registered view keeps the row's quiet `Input:` pane instead — an
   unknown tool never grows an inferred result card.

**Two authoring forms, one contract.** The canonical form is an
imperative adapter, so non-React hosts are first-class:

```ts
const vanillaView: ToolViewAdapter = {
  mount(container, props) {
    const el = document.createElement("div");
    render(el, props); // your own code, any framework or none
    container.appendChild(el);
    return {
      update(next) {
        render(el, next); // called on prop change — never a remount,
      }, //                  so your view's local UI state survives
      destroy() {
        el.remove();
      },
    };
  },
};
```

`reactToolView(Component)` is thin sugar producing the same adapter
from a React component; `update` reconciles in place, so component
state survives a status advance. The same lifecycle serves the icon
role (below).

**The props contract.** A view receives exactly
`ToolViewProps {call, context}` and nothing else:

- `call` — the recorded tool call: `toolName`, `toolCallId`, `status`
  (`ToolCallState`), `awaitingDecision`, parsed `args`, and when a
  result has landed `result` (the tool-result/v1 envelope unwrapped; any
  other JSON document passed through) beside the verbatim `resultText`.
  A size-capped result is honestly flagged `truncated` with `result`
  withheld — never parsed into a complete-looking lie; `offloaded`,
  `errorText`, and `refusalText` carry the other honest endings.
  Views and **icons** both mount for the call's whole lifecycle and see
  every field; on errored, denied (a member declined the approval),
  cancelled, refused and offloaded settles the result stays withheld
  (the wire's content on those paths is model-facing) while the row's
  own package-owned panes — the Error line, the refusal reason, the
  offloaded notice — still render outside the mount slot.
- `context.themeMode` — `"light" | "dark"`: whichever palette the
  stylesheet actually paints, computed the way the CSS computes it. The
  widget root's own `data-tf-theme` wins outright (`"light"` pins light
  even under a dark ancestor; `"auto"` follows the OS preference); with
  no attribute on the root, any ancestor's `"dark"` paints dark, while
  `"light"`/`"auto"` on a non-root ancestor and any carrier inside the
  root are inert — exactly the stylesheet's rules. Kept live and
  paint-accurate: attribute flips (the provider's `mode` prop, or your
  theme library writing `<html>` directly) and OS-preference changes
  reach mounted views through `update`. If you theme dark purely through
  `--tf-*` values, set `data-tf-theme` so views see it.

No auth tokens, no stores, no transport — and no `approve` or `deny`:
the absence of decision controls is the contract's point, not an
oversight.

**Icons.** A registration may carry a view, an icon, or both — one
registration, two roles. `icon: reactToolView(MyMark)` (or a vanilla
`IconAdapter`) replaces the operation mark's glyph and nothing else:
the mark's identity, state ink, and assistive state word stay
package-owned.

**What stays package-owned.** A view is a _reading_ inside the
package's frame — the frame's structure, spacing, and accessibility
stay ours. On the result row: the row line, status mark chrome and the
error/refusal/offloaded lines. There is no raw payload disclosure and
no package heading over your view: your view is the row's whole body,
and a call with no view gets the package's bounded argument reading.

**Compose the package's parts.** `ToolViewCard`, `ToolViewRow`,
`ToolViewFacts`, `ToolViewCaption`, `ToolViewBody`, `ToolViewBadge`,
`ToolViewScroll`, `ToolViewTitle`, `ToolViewNote` and `ToolViewBones` are the vocabulary
the built-ins paint with — a hairline card, list rows with a title and a
muted second line, property rows, a caption, a scrolling body, a
scrolling well for a long list, a badge, a note, skeleton lines. A view composed from them reads as one system with ours:

```tsx
function GetDocView({ call }: ToolViewProps<GetDocArgs, GetDocResult>) {
  if (call.status !== "output-available" || call.result === undefined) {
    return <ToolViewBones lines={3} />;
  }
  return (
    <ToolViewCard>
      <ToolViewRow
        title={call.result.title}
        secondary={call.result.slug}
        trailing={<ToolViewBadge>Published</ToolViewBadge>}
        href={`/docs/${call.result.id}`}
      />
      <ToolViewBody label="Document">{/* your renderer */}</ToolViewBody>
    </ToolViewCard>
  );
}
```

**Approval is the package's own banner.** The approval banner uses fixed
consent copy and a mechanically spelled tool name, and renders nothing
argument-derived — the call's own transcript row, which a pending
decision holds open, carries the request, and a Show-request affordance
scrolls to it. It is not replaceable by host code: a view presents a tool
call and never owns its decision (`docs/tool-views.md`).

**Failure is safe and observable.** A missing registration, an unknown
key, a version mismatch, or a view that throws all land on the rung
below — the transcript never breaks. Throws are reported to your
`onError` observer and named on the console (`[teaflask-assistant] The
tool view "acme.order-review" threw…`); end users see the next
resolution, not a stack trace, and a flaky view never flickers back in.

**Versioning.** The entry's `version` is your presentation contract
with your backend, not the package's semver: when the meaning of your
view's data changes, bump the annotation's version and ship the
matching adapter — rungs 1 and 3 require an exact match in both
directions, so version drift renders the rung below instead of a
half-broken view. (A tool-name registration, rung 2, has no wire
version to match.) Keep keys namespaced (`yourco.thing`) and stable;
`teaflask.*` is reserved.

**Testing your view.** It's just an adapter (or a React component
taking `ToolViewProps`) — construct the props literally and drive it
with your own tooling; no package harness required:

```tsx
const instance = reactToolView(OrderReview).mount(container, {
  call: {
    toolName: "acme__order_lookup",
    toolCallId: "t1",
    status: "output-available",
    awaitingDecision: false,
    args: { order_id: 7 },
  },
  context: { themeMode: "light" },
});
```

**Script-tag hosts.** The elements expose the identical registry as
their `toolViews` JS property — no React, no npm install, no build
step. An adapter is your own code running in your own page, exactly
like a React registration; executable code still never rides the wire.
Hosts that register nothing keep the built-in rendering at full
fidelity. See _Custom tool views from a script tag_ under the script-tag
section — especially its Shadow DOM warning.

### Command palette

`AssistantPalette` is the same conversation in a cmd-k-style overlay —
current thread only, no history list. `<TeaflaskAssistant/>` mounts and
triggers it for you; use it directly when you want your own trigger and
open state — it is controlled:

```tsx
import {
  TeaflaskAssistantProvider,
  AssistantPalette,
} from "@teaflask/assistant";

function App() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function openOnCmdK(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", openOnCmdK);
    return () => {
      document.removeEventListener("keydown", openOnCmdK);
    };
  }, []);

  return (
    <TeaflaskAssistantProvider publishableKey="pk_test_…">
      <AssistantPalette open={open} onOpenChange={setOpen} />
    </TeaflaskAssistantProvider>
  );
}
```

Worth knowing:

- Surfaces under one provider share ONE live conversation — one stream,
  one approval inbox, one execution driver. Mount both, talk on one, and
  the other shows the same thread as it streams. Opening the palette
  over the page is a first-class handoff: only the newest surface drives
  the transcript (the other stands down cleanly, so the shared agent is
  never connected twice), and closing it hands the stream back with a
  full replay.
- It renders where you mount it (the browser's top layer lifts it above
  the page — no portal), so `--tf-*` variables and `data-tf-theme` on
  any ancestor theme it exactly like `AssistantPage`. Mount it near your
  app root.
- Esc and a click on the backdrop close it; the page behind is inert
  while it is open, but its scroll position is never touched. One
  precedence rule: while a turn is streaming and focus is in the
  composer, the first Esc stops the answer instead — a second Esc during
  "Stopping…", or any Esc while idle, closes the surface as before, and
  the backdrop always closes it.
- Closing mid-answer does NOT drop the turn: while a turn is queued or
  working the engine keeps a headless stream (and keeps executing) until
  the turn settles or parks; an idle or parked thread with no surface
  mounted holds no connection. Reopening replays the conversation in
  full — including whatever streamed while the palette was closed.

### The activity feed

`useAssistantActivity()` is presence without a transcript: whether the
assistant is busy, the newest turn's status, how many approvals await a
human, and how the last turn ended (with its turn id, so a doorbell can
tell two identical failures apart). Any component under the provider can
subscribe:

```tsx
import {
  TeaflaskAssistantProvider,
  useAssistantActivity,
} from "@teaflask/assistant";

function AssistantPulse() {
  const activity = useAssistantActivity();
  return activity.busy ? <span data-busy /> : null;
}
```

A surface that renders ONLY presence should import from
`@teaflask/assistant/activity` instead — same provider, same hook, but
the import graph provably excludes the transcript, the markdown/renderer stack, and
their stylesheets (measured 404,921 B minified with dependencies, React
external, on 2026-09-19; a mechanical tripwire in
`tests/bundle-closure.test.ts` holds it under 420,000 B and prints the
figure on every run):

```tsx
import {
  TeaflaskAssistantProvider,
  useAssistantActivity,
} from "@teaflask/assistant/activity";
```

### The transcript projection

`@teaflask/assistant/transcript` is the transcript's wire-agnostic
projection layer for hosts that render their own transcript composition:
`transcriptRowsOf` (plain AG-UI messages plus a `MarkerAnchorsSnapshot`
in, a flat `TranscriptRow` list out), the anchor recorder families
(display, error, cancel, refusal, decision, denial — each an `EMPTY_*`
constant, an idempotent merge and a recorder; the merges are
`withTool*Anchored`, except denial's `withToolDenialMarkerFolded` over
its ledger), the
messages/stream-error wire taps, the subagent grouping and roster
helpers, and small presentation leaves (`prettyPrintParameters`,
`humanFileSize`).

A scope note on the snapshot: `MarkerAnchorsSnapshot` has fifteen anchor
fields, and this entry ships recorders for exactly seven families — the
display/error/cancel/refusal surface the dashboard's run viewer wires,
the decision family (the durable "a member decision rode this call"
record the placement holds read) and the denial family (the two approval
markers joined into the state ladder's rung that outranks the wire's
cancelled stamp) — those two snapshot fields are optional, and an absent
field reads as empty — and the string-receipt family
(`receiptMarkerRecorder`, which feeds `turnFailedAnchors`). The other
eight (resume, delivery, offload, schema, block-timing, turn-usage, and
the two memory families) can be passed empty (`new Map()` / `new Set()`
per field; the corresponding rows and severance reads simply don't light
up) but cannot be populated from this entry — their recorders remain
future additive work on this surface. A host that renders over the live
store instead of its own wire never needs them: the store populates
every anchor family itself, and
[`useTranscript()`](#bring-your-own-frontend) reads the result. The
entry is React-free and transport-free, and it re-exports the AG-UI
names it speaks (`AbstractAgent`, `HttpAgent`, `AgentSubscriber`,
`Message`, `BaseEvent`, `RunAgentInput`) so a host never takes its own
dependency on the `@ag-ui` packages. A host that subclasses `HttpAgent`
itself pipes its `run()` through `liftToolOutcome`: the 1.0 client
strips the wire's TOOL_CALL_RESULT extras (`error`, `refused`,
`cancelled`, `truncated`, `offloaded`) from the top level before any
subscriber, and the lift moves them under
`metadata.teaflask.toolOutcome`, where `toolOutcomeOf` and the anchor
recorders read them. A subclass that does not pipe `run()` through the
lift loses every one of the five before the recorders see them:

```ts
import {
  HttpAgent,
  liftToolOutcome,
  messagesRecorder,
  toolErrorRecorder,
  transcriptRowsOf,
  type Message,
  type RunAgentInput,
} from "@teaflask/assistant/transcript";

class MyStreamAgent extends HttpAgent {
  override run(input: RunAgentInput) {
    return liftToolOutcome(super.run(input));
  }
}
```

One more thing a host's install has to hold: `@ag-ui/core/schemas` and
`@ag-ui/client` must resolve the same `zod` module instance, because the
client checks the schemas it imports with `instanceof` against its own
copy. The client declares `zod ^3.25.76`; a host whose root already holds
zod 4 should pin the client's and proto's zod onto that root copy with an
npm `overrides` entry (`"@ag-ui/client": { "zod": "$zod" }`,
`"@ag-ui/proto": { "zod": "$zod" }`), which is what the teaflask dashboard
does, or hold a single zod 3 at the root as this package's own dev pin
does. Two zod copies under one AG-UI stack strip or accept events by
accident.

### `./transcript-ui`

The transcript surface itself: `<AssistantTranscript/>`, the one
component the package's own `Transcript`, the dashboard's agent-run
viewer, and the playground all bind over. A React entry deliberately
separate from the React-free `./transcript` projection — a host that
only projects rows never pays for React. Two source modes as a
discriminated union: **agent** (`agent`, `onStreamError`, optional
`markers`/`markerBoundaries`/`resumeAnchoredIds`/`deliveryAnchoredIds`/`turnAttachments`
— the component owns the six-recorder subscription, connect on mount,
unsubscribe-then-abort on teardown, and the block projection, invoking
the host's marker composite before and after every message block) and
**rows** (`rows`, plus `cards`/`live`/`turnOpen`/`decisionSurfacesInShelf`
— the store path, a straight pass-through). Five host slots — four
mounted inside the package's slot boundary with the package rendering
as its fallback, and `input` deliberately unbounded so decision-capable
chrome is never latched behind a fallback (a composer throw propagates
to the host's own boundary) — every mandatory frame element outside
them all:
`messageView` (row content for
user/assistant-text/subagent-group/subagent-delivery; null falls
through per row), `toolRow` (a whole-row seam receiving the durable row
beside the resolved view; the settled-ask receipt collapse, decision
surfaces, and the frame's status word stay package-owned), `input`,
`welcomeScreen` (withheld until the first snapshot in agent mode), and
`threadList` (chrome above the log, default empty). There are
deliberately no `row`/`icon`/`artifact` renderer slots — per-tool
presentation is the tool-view registry's (`docs/tool-views.md`). The
entry also ships `AgentIdentityMark` and the slot/row types a binder
types its fills against.

### Bring your own frontend

`@teaflask/assistant/headless` is the live-session entry with none of
the package chrome: mount `<TeaflaskAssistantProvider>` alone, DRIVE the
conversation from its hooks — send and stop turns, switch and start
threads, answer approvals and question sets, observe failures and
recover — and RENDER the assistant's replies from the transcript read
surface. The entry exports bindings, never the serving machinery — the
conversation store, the token session and the persistence layer stay
private.

The replies come from `useTranscript()`: the streamed message list and
the marker anchors, projected through the same `transcriptRowsOf`
derivation the packaged chrome renders — identical rows, one
composition. Mounting the hook registers transcript presence with the
store; presence is what GUARANTEES the epoch connects, and it arms the
idle re-read. A lease-less store connects only while the newest turn is
queued or working (on a bounded budget) — and any connect, leased or
not, is the same full replay: history first, then the live tail. So a
drive-only host that skips the hook still streams and fully paints the
turns it drives, approvals and failure sentences included; what it loses
is the guarantee — a thread with no live turn to connect for (a reopened
settled thread) stays unconnected and its messages stay empty. Hosts
that want a different projection get the four raw reads (`messages`,
`markerAnchors`, `activity`, `turnMeta`) on the same surface, shaped so
the re-exported
`transcriptRowsOf(messages, markerAnchors, running, turnMeta)`
type-checks verbatim.

- `useTranscript()` — the transcript read surface: `displayRows` (the
  projected row list with the composer's optimistic echo already
  applied — render this; painting your own echo beside it would double
  the bubble), `rows` (the pure projection, pre-echo), the `running` /
  `turnOpen` / `decisionsPending` run-state facts the rows key on, and
  the raw `messages` / `markerAnchors` / `activity` / `turnMeta` reads.
  `running` is false for the send round trip (no turn exists until the
  send POST returns), so join the composer's `pendingSend` into any
  working indicator, as the package chrome does.
- `useAssistantConversation()` — the conversation: the active thread,
  the thread list, send/turn failure sentences, the interruption banner
  fact, `retryStream`, `refreshConversation`, `openThread`,
  `startNewConversation`.
- `useConversation()` — the composer contract: `sendMessage`, `busy`,
  `stopTurn`, the model pick, and the draft/attachment setters. The
  per-keystroke `composerInput` rides its own cell; read it with the
  exported `useCell`.
- `useApprovals()` — the pending approval cards plus `submitDecision`,
  the same guarded submit path the packaged card uses (double submits
  and stale cards are dropped with a reason, never double-sent).
- `useElicitations()` — the pending question sets, `submitQuestionAnswers`,
  `cancelQuestionSet`, and the store-owned drafts.

```tsx
import {
  TeaflaskAssistantProvider,
  useAssistantConversation,
  useConversation,
  useTranscript,
} from "@teaflask/assistant/headless";

function MyChat() {
  const { turnFailure } = useAssistantConversation();
  const composer = useConversation();
  const { displayRows, running } = useTranscript();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const box = event.currentTarget.elements.namedItem("m");
        void composer.sendMessage((box as HTMLTextAreaElement).value);
      }}
    >
      <ol>
        {displayRows.map((row) =>
          row.kind === "user" || row.kind === "assistant-text" ? (
            <li key={row.key}>{row.text}</li>
          ) : null,
        )}
      </ol>
      {running || composer.pendingSend ? <p>Working…</p> : null}
      {turnFailure !== null ? <p role="alert">{turnFailure}</p> : null}
      <textarea name="m" disabled={composer.busy} />
    </form>
  );
}

export function App() {
  return (
    <TeaflaskAssistantProvider publishableKey="pk_live_…">
      <MyChat />
    </TeaflaskAssistantProvider>
  );
}
```

The entry's static import graph is mechanically held chrome-free
(`tests/bundle-closure.test.ts`): a host that brings its own frontend
never pays for ours. It does carry the live session (store and
transport) — for a render-only projection over your own wire, use
[the transcript projection](#the-transcript-projection) instead. A
headless mount needs no stylesheet; `styles.css` styles only the
package's own chrome.

### Sign-out

Call `resetAssistant` in your sign-out handler so the next visitor on
the browser starts clean. It is pure storage — it works on pages where
the assistant isn't mounted:

```ts
import { resetAssistant } from "@teaflask/assistant";

resetAssistant({ publishableKey: "pk_test_…" });
```

A bring-your-own-frontend host imports the same function from
`@teaflask/assistant/headless` instead — importing the root barrel for
it would pull the package chrome into a bundle that exists to avoid it.

## Script tag (no React)

The second distribution: one script tag, any stack — Rails, Django,
Vue, WordPress, plain HTML. The element mounts the same React tree the
npm package ships into a shadow root, React bundled inside; the host
page never knows React is in there.

```html
<script
  type="module"
  src="https://app.teaflask.com/assistant/v1/assistant.js"
></script>

<teaflask-assistant publishable-key="pk_test_…"></teaflask-assistant>
```

Same serving contract, same key, same rule as the npm route: the key's
origin allowlist must include the page's origin. The bundle is ESM with
code splitting — the page pays for the companion shell up front and the
transcript stack only on first open.

### The page element

The full-page surface (`<AssistantPage/>` — the conversation with its
history disclosure) ships as a second tag in the same bundle; the one
script tag defines both.

```html
<div style="height: 600px">
  <teaflask-assistant-page
    publishable-key="pk_test_…"
    heading="Acme Help"
  ></teaflask-assistant-page>
</div>
```

**Give it a sized container.** The element lays out as `display: block;
height: 100%`, so it fills whatever box it is mounted in and never
invents a height of its own; style the element itself to override.

Attributes are `publishable-key`, `base-url`, `mode`, plus the page's
own `heading` (the header's display name — the React prop is `title`,
but the global HTML `title` attribute would tooltip the whole surface,
so the attribute wears a different name) and `frameless` (drops the
card border and radius — a bare attribute or `"true"` enables,
`"false"` disables, anything else warns once and keeps the default).
The rich JS properties are the same seven as the widget's table below,
with identical null semantics; `suggestions` become the page's opening
prompts. The page has no companion, palette, or hotkey — pair it with
`<teaflask-assistant>` when you want those too.

**Same key, one live conversation.** Elements whose session identity
matches (publishable key, `base-url`, identity wiring) share one
conversation store even across their separate roots: a turn typed in
the widget streams into the open page, and the other way round. While
a page element is mounted, the widget's companion yields to it — the
same stance as the in-app pairing. The page body loads on demand,
exactly like the palette's transcript.

### Versioning

`/assistant/v1/assistant.js` is a **channel URL**, not a pinned one:
`v1` names the element's API compatibility channel, and it serves the
current build — cached five minutes, revalidated in the background —
so script-tag customers always run current code. That is the point of
this distribution, and its trade: **you cannot pin a version here.**
We serve one build at a time and don't keep historical ones, so there
is no exact-version URL to embed.

Version pinning is not offered on this channel. When this package ships
on npm, a lockfile install becomes the pinning route — an enterprise
change-control process, or a security review that fixes a reviewed
artifact, belongs there. Auto-update and pinning are the two halves of
why both distributions exist.

Breaking changes to the element's own API (attribute or property
names, mount semantics) ship as a new channel, `v2`, with `v1` kept
serving; the conversation contract underneath is versioned separately
and additively (`/serving/v1`). A new tag is additive —
`<teaflask-assistant-page>` rides `v1`.

### Attributes and properties

Strings ride attributes; anything richer is a JS property on the
element. Properties may be assigned before or after the script loads —
both work.

| Attribute                    | React prop equivalent                   |
| ---------------------------- | --------------------------------------- |
| `publishable-key` (required) | `publishableKey`                        |
| `base-url`                   | `baseUrl`                               |
| `mode`                       | `mode` (`"light" \| "dark" \| "auto"`)  |
| `corner`                     | `corner`                                |
| `hotkey`                     | `hotkey` (the value `"false"` disables) |
| `companion-mark-src`         | `companionMark` (an image URL)          |

| Property          | React prop equivalent                                 |
| ----------------- | ----------------------------------------------------- |
| `onNavigate`      | `onNavigate` (see Navigation)                         |
| `getEndUserToken` | `getEndUserToken`                                     |
| `actionsAdapter`  | `actionsAdapter`                                      |
| `onError`         | `onError`                                             |
| `theme`           | `theme`                                               |
| `suggestions`     | `suggestions`                                         |
| `toolViews`       | `toolViews` (see Custom tool views from a script tag) |

On the widget, `suggestions` left unset serves the opening prompts
authored on your organization's assistant — fetched at runtime and
matched to the page's path (longest path-prefix wins). Assigning any
value, even `[]`, overrides the served sets wholesale; there is no
merging. The path is read when the drawer opens, not subscribed: a
host that keeps the drawer open across client-side navigation shows
the set matched at open until the next re-render. The page element
keeps `suggestions` as its own explicit prop and never fetches.

`element.openPalette()` mirrors the React ref handle. Attribute changes
re-render in place; changing `publishable-key` or `base-url` rebuilds
the session on purpose.

Nothing type-checks a plain-JS host, so the element validates what a
compiler would have caught and says so in the console rather than
failing quietly: an invalid `mode` or `corner` warns once and takes the
default, and an `actionsAdapter` whose `kind` isn't one of `cookies`,
`headers`, `request` is **refused** — the assistant reports that this
page cannot perform actions, instead of sending requests with the
adapter's authentication silently dropped. A `toolViews` registry is
sanitized one registration at a time: a reserved `teaflask.*` key or a
wrong-shaped registration (non-numeric version, an adapter without a
callable `mount`) is dropped with a console warning naming the key,
and well-formed siblings keep working. The hotkey disclosure applies unchanged: the
element binds `mod+k` — rebind or set `hotkey="false"` if your app owns
the chord. One widget element per page, the React root's stance; page
elements are exempt — any number of surfaces may share the
conversation.

### Navigation — the honest limitation

Unset, the assistant's navigate requests become full-page loads
(`window.location.assign`) — right for a server-rendered host. Assign
`element.onNavigate = (path) => …` to drive a client-side router
instead, or `null` to declare the page cannot navigate (the assistant
is told so in-band and gives directions instead). A script tag cannot
drive a host framework's router the way the npm package's `onNavigate`
rides `router.push` — React shops should prefer the package.

### Isolation and theming across the boundary

The widget renders in a shadow root: host CSS never restyles it, its
stylesheet never leaks out. The theming contract survives on purpose —
`--tf-*` custom properties inherit through shadow boundaries, so the
CSS route works unchanged from any host ancestor, and the element
reflects `data-tf-theme` / `data-reduce-motion` from host ancestors
across the boundary itself. One host dependency is compiled away: rem
values become px (at the standard 16px) in this bundle only, so a host
`html { font-size: 62.5% }` cannot shrink the widget — the tradeoff is
that the widget no longer scales with a visitor's browser font-size
setting.

### Custom tool views from a script tag

The same registry the React provider takes as `toolViews` (see Custom
tool views above) is a JS property on both elements. Assign it before
or after the bundle loads — script order is not yours to control, and a
property set before the element upgrades is reclaimed when the
definition arrives. A late assignment reaches calls already on screen,
not just future ones. Each element instance holds its own registry;
two elements on one page never share registrations.

```html
<!-- The element must already be in the DOM when the script below runs;
     the BUNDLE may load whenever it likes. -->
<teaflask-assistant publishable-key="pk_live_…"></teaflask-assistant>

<script>
  const inventoryView = {
    mount(container, props) {
      const style = document.createElement("style");
      // Fallbacks track the mode through the data-mode attribute render()
      // maintains from context.themeMode — the tokens themselves cannot
      // say which mode is painted (see the warning below).
      style.textContent =
        ".inventory { color: var(--tf-foreground, #171717); font: 13px/1.4 var(--tf-font-sans, system-ui); }" +
        '.inventory[data-mode="dark"] { color: var(--tf-foreground, #ededed); }';
      const card = document.createElement("div");
      card.className = "inventory";
      // One render path, fed at mount AND on every update: mount receives
      // the call's CURRENT state (a view registered late, or restored
      // from history, mounts onto an already-settled call that may never
      // update again), and an update can change context.themeMode alone.
      const render = ({ call, context }) => {
        card.dataset.mode = context.themeMode;
        card.textContent =
          call.status === "output-available"
            ? (call.resultText ?? "Done.")
            : "Checking inventory…";
      };
      render(props);
      container.append(style, card);
      return {
        update: render, // re-reads the whole delivery: call and context
        destroy() {
          style.remove();
          card.remove();
        },
      };
    },
  };
  document.querySelector("teaflask-assistant").toolViews = {
    // your exact tool name, or the opaque key a display annotation names
    northwind__check_inventory: { version: 1, view: inventoryView },
  };
</script>
<script
  type="module"
  src="https://app.teaflask.com/assistant/v1/assistant.js"
></script>
```

> ⚠ **Your adapter renders inside our shadow root.** It sees the
> `--tf-*` token _names_ — custom properties cross the boundary — and
> **none of your page's stylesheets**: your CSS classes will not apply,
> and a first attempt that relies on them renders unstyled. That is the
> boundary working, not a bug. Two ways through: **inline styles** on
> the nodes you create, or a **`<style>` element your adapter mounts
> (and removes) inside its own container**, as above. Mounting it in
> your container governs its _lifecycle_, not its reach: a `<style>`
> element styles the **whole shadow root**, so scope every selector to
> a class you own (both examples prefix theirs for exactly this
> reason) — a bare `p { … }` would restyle the package surface, not
> just your card.
>
> ⚠ **And the `--tf-*` tokens are host _inputs_, not resolved values.**
> In an embed that sets no theme, every one of them is unset — and a
> `var(--tf-*)` without a fallback voids its whole declaration at
> computed-value time (a borderless `border`, a transparent
> `background`). **Always pair a token with an explicit fallback**, e.g.
> `var(--tf-foreground, #171717)`: the host's value wins when the host
> themes, your fallback paints when it doesn't. And because host-set
> tokens are single-valued in both modes by design (see Theming), they
> cannot tell you the mode — **dark-awareness comes from
> `context.themeMode`**, handed to `mount` and re-delivered through
> `update` whenever it changes, including on the element's own
> `mode` attribute flip.

What a shadow-mounted adapter can actually see of the theme system —
each affordance, classified:

- **`context.themeMode`** — always available, in every embed; the one
  mode-change signal an adapter receives (via `update`). Use it for
  anything light/dark.
- **`--tf-*` tokens** (list under Theming) — the _names_ always reach
  you; the _values_ exist only when the host themes (the `theme`
  property, or `--tf-*` set on a host ancestor). Always write
  `var(--tf-x, fallback)`.
- **Inherited properties** — `color`, `font-family`, and friends
  inherit from the package-styled ancestors around your container, so
  plain text with no declarations of your own already paints correctly
  in both modes; `currentColor` rides the same channel.
- **`--_tf-*` private aliases** — resolved in the shadow tree but
  package-private and unversioned: never read them.
- **`data-tf-theme`** — package-owned plumbing on the widget root; do
  not sniff it from an adapter, read `context.themeMode` instead.

Registrations may carry an `icon` beside (or instead of) the `view` —
it replaces the operation mark's glyph, with the state semantics left
package-owned. A throwing adapter is isolated exactly like a React one:
the call falls to the next rung, `element.onError` hears the error, and
the console names the key. A wrong-shaped registration — a reserved
`teaflask.*` key, a non-numeric `version`, an adapter without a
callable `mount` — is dropped with a named warning and costs nothing
else. And the door is a JS property on purpose, with no attribute
spelling: a registry carries functions, and adapters are always your
page's own code — nothing executable ever arrives over the wire.

### CSP

The bundle needs `script-src` for `app.teaflask.com`. Its stylesheet is
a constructed stylesheet (no `style-src` implications), but the `theme`
property lands inline style variables — exactly like the npm `theme`
prop — which requires `style-src-attr 'unsafe-inline'`; a strict-CSP
host themes through CSS custom properties instead. Registering tool
views needs nothing beyond your own script's `script-src` — no `eval`,
no injected scripts — though an adapter that mounts its own `<style>`
element needs a `style-src` allowance and inline styles on its nodes
need `style-src-attr`, the same class of allowance as `theme`.

## Theming

The widget styles itself with `--tf-*` CSS variables and ships Graphite
(monochrome, hairline-bordered) defaults. Set any of them on an ancestor
element and your value wins:

```css
.my-assistant-container {
  --tf-background: #fdfdfc;
  --tf-primary: #1a3c8b;
  --tf-radius: 0.25rem;
  --tf-font-sans: "Inter", sans-serif;
}
```

Tokens: `--tf-background`, `--tf-foreground`, `--tf-card`,
`--tf-card-foreground`, `--tf-popover`, `--tf-popover-foreground`,
`--tf-primary`, `--tf-primary-foreground`, `--tf-secondary`,
`--tf-secondary-foreground`, `--tf-muted`, `--tf-muted-foreground`,
`--tf-accent`, `--tf-accent-foreground`, `--tf-destructive`,
`--tf-border`, `--tf-input`, `--tf-ring`, `--tf-radius`,
`--tf-font-sans`, `--tf-color-scheme`.

Dark mode: add `data-tf-theme="dark"` on the widget's container (or any
ancestor) for the pure-black defaults; host-set `--tf-*` values still
win in both modes. Dark-theming with tokens alone (no attribute, no
`mode` prop)? Also set `--tf-color-scheme: dark` so native form controls
— scrollbars, the composer's textarea — draw dark UA chrome; the
attribute and `mode` routes flip it for you.

### The `theme` and `mode` props

Prefer configuring in JS? Pass the same tokens, camelCase, to the
provider. Values land as inline style variables on the widget roots, so
an explicit prop beats any ambient host CSS — two channels, one clear
winner:

```tsx
<TeaflaskAssistantProvider
  publishableKey="pk_test_…"
  theme={{
    background: "#fdfdfc",
    primary: "#1a3c8b",
    radius: 12, // a bare number means pixels
    fontSans: '"Inter", sans-serif',
    dark: { background: "#101010", primary: "#8fb0ff" },
  }}
  mode="auto"
>
```

- `theme.dark` values take over whenever dark is active — through the
  `mode` prop or a `data-tf-theme="dark"` on any ancestor. Everything
  else applies in both modes, exactly like the CSS route.
- `mode` writes `data-tf-theme` on the widget roots: `"dark"` pins the
  dark palette, `"light"` pins light even under an ancestor's dark
  attribute, `"auto"` follows the visitor's OS preference (a CSS media
  query — no script runs, no flash before hydration).
- The prop is read by value: a fresh object literal every render is
  fine and never resets the conversation.
- Strict CSP: inline styles need `style-src 'unsafe-inline'` (or
  `style-src-attr`). If your policy cannot allow that, use the CSS
  route above — it is the same contract, minus the prop precedence.

## Companion

### The presence surface

`<AssistantCompanion/>` is the mark in the corner: an always-present
concierge that lives on every route and expands into a corner chat
drawer. `<TeaflaskAssistant/>` mounts it
automatically; standalone, mount it once under the provider — it needs
no route wiring, because it works out for itself when it is not needed:

```tsx
<TeaflaskAssistantProvider
  publishableKey="pk_test_…"
  companionMark={<YourMark />}
>
  <AssistantCompanion corner="bottom-right" />
</TeaflaskAssistantProvider>
```

- **Yield is automatic.** Wherever an `<AssistantPage/>`-class surface
  is mounted the companion renders nothing (while staying subscribed, so
  it returns the instant that surface unmounts); while the palette is
  open it hides. Its own drawer doesn't count — one companion per page
  is the supported shape.
- **The mark never speaks.** No speech bubbles, no attention dot: a turn
  finishing, failing, or waiting on the human changes nothing in the
  corner. Approvals and results live on the cards in an expanded
  surface, which the visitor opens when they choose.
- **A tool navigation lands with the drawer open.** When the assistant
  moves the visitor through `builtin.navigate` (your `onNavigate`
  hookup), the drawer opens at the destination, even if the visitor had
  minimized it — the assistant is taking them somewhere, so the
  conversation follows, and focus stays exactly where the visitor had
  it — only an open they clicked for moves the caret into the composer.
  Only a navigation that actually happened counts:
  a refused path or a throwing `onNavigate` opens nothing. The flag is
  page-level state, so it holds even when your router remounts the
  assistant tree between routes; a full page load starts closed.
- **A full-page surface resets the drawer.** The moment an
  `<AssistantPage/>`-class surface mounts, the drawer's open flag is
  cleared for good — leaving that page by hand lands the visitor on the
  bare mark, while the palette (a transient yield) keeps the flag and
  hands the drawer back when it closes. On ordinary routes an open drawer
  keeps following the visitor across client-side navigation.
- **The minimized companion never downloads the transcript.** The chat
  drawer's conversation body rides a dynamic import, split by your
  bundler and fetched on the first expand; importing from
  `@teaflask/assistant/activity` keeps the whole surface on the
  bundle-lean entry.
- **Reduced motion is honored**: every presence transition collapses to
  an instant swap. The package's default mark
  is static by construction; a mark you supply is yours to hold still
  (below).

### The mark

The corner companion and the drawer's welcome show one mark, and it is
static — no animation, no state, no hide control. The default
is the TeaFlask flask in the widget's foreground color (the same
`AgentIdentityMark` the transcript uses). Replace it with your own:

```tsx
// React hosts: any node. The package sizes the box, your node fills it.
<TeaflaskAssistantProvider publishableKey="pk_test_…" companionMark={<YourMark />}>
```

```html
<!-- Script-tag hosts: an image URL. -->
<teaflask-assistant
  publishable-key="pk_test_…"
  companion-mark-src="https://…/mark.svg"
></teaflask-assistant>
```

The mark floats bare: no plate, no circle, no card behind it — your
artwork's own silhouette is the companion, so ship it with transparent
surroundings, the way you would a logo. The box is the package's — 4rem
on the perch and above the drawer's welcome — and there is no size
token.
The package sets your node to 100% width and height of the box, so a
bare `<svg viewBox="…">` or a plain `<img>` fills it with no sizing of
its own; keep the artwork's aspect inside the viewBox. The usual
conditional works: `companionMark={brand && <Mark />}` shows the flask
on its false arm (null, undefined and booleans all decline; `""` or `[]`
are taken as your deliberate empty content). On the script tag, a
`companion-mark-src` that fails to load — a 404, a CSP or ad-block
refusal, a URL that is not an image — logs one console warning and shows
the flask in its place; a broken mark costs the mark, never the page. A
host node is host DOM: it renders inside the package's
`data-tf-host-view` marker, so the widget's box-sizing and border-color
reset never touch it (the same carve-out custom tool views get); the
default flask stays package DOM under the reset.

## SSR and Next.js

Every component and hook this package exports is a client module — the
`"use client"` directive sits on the modules the entry points re-export
(the entry barrels themselves and internal leaves don't carry it, and
don't need to) — so the App Router accepts a direct import from a server
layout: the directive marks the client boundary where it matters, and
the components render in the browser. Mount the provider once in a
client component (our own dashboard mounts it exactly this way) and
import the stylesheet once at the app shell:

```tsx
// app/providers.tsx
"use client";
import { TeaflaskAssistant } from "@teaflask/assistant";
import "@teaflask/assistant/styles.css";

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  return (
    <TeaflaskAssistant publishableKey="pk_live_…">{children}</TeaflaskAssistant>
  );
}
```

Server rendering is safe, not useful: store cells reach React through
`useSyncExternalStore` with the store's initial state as the server
snapshot, so an SSR pass renders the empty shell without hydration
mismatch, and the conversation connects after mount. Nothing in the
package touches `window` at module scope. The names reserved on the
page: CSS classes under the `tf:` utility prefix plus the `data-tf-*`
attributes; custom properties under `--tf-*` (the theming surface —
anything you set there is read as a theme value); and animation
(`@keyframes`) names under `tf-` — the stylesheet ships no global
animation name outside that prefix, so your own `pulse` or `spin` is
never overridden by ours. The sheet also carries Tailwind's standard
`--tw-*` custom-property machinery, byte-identical to what any Tailwind
v4 build registers, so it coexists with a host Tailwind build.

## Browser support

The floor is **Chrome/Edge 117, Safari 17.5, Firefox 129** — the newest
features the stylesheet and chrome rely on, unpolyfillable by a host.
Safari's floor is set by `@starting-style` (17.5, per caniuse);
`transition-behavior` alone would allow 17.4, and every other feature
below sits earlier still:

| Needs                                  | Used for                                                  |
| -------------------------------------- | --------------------------------------------------------- |
| `@starting-style`                      | entry transitions on the palette, shelf and drawer        |
| `transition-behavior: allow-discrete`  | transitioning `display`/`overlay` on close                |
| the Popover API (`popover`, top layer) | the palette, drill-in previews, menus                     |
| `:has()`                               | scroll-away/jump chrome and shelf collapse selectors      |
| `color-mix()`                          | the ink washes (hover/selected registers) and glass tints |

Older browsers are not detected or half-supported: below the floor,
pieces of the chrome simply do not appear or do not animate. The
headless entry has no CSS floor of its own — with your own frontend,
your support matrix is your CSS's.

## Accessibility

What the packaged chrome actually does today:

- **One run-state live region at the conversation level.** The
  transcript mounts a single sr-only `role="status"` announcer that
  pre-exists its first phrase and speaks run-state changes ("Working…",
  "Waiting for your input"). Panel-scoped regions announce their own
  local facts — the question panel's submit-gate sentence, the
  composer's "Stopping…" — but conversation-level run state has exactly
  one voice.
- **Focus moves only on your action.** A newly arriving decision never
  steals focus (the context-change rule, WCAG 3.2): its arrival is
  announced, the surface sits in DOM order directly before the composer,
  and focus moves there only at member-initiated moments — resolving one
  decision focuses the next; an emptied queue returns focus to the
  composer.
- **Decisions are keyboard-complete.** Approve/deny controls, the
  decision queue's paging, and the question panels (radio-group
  semantics, roving tabindex, labelled by their own question) are
  reachable and operable without a pointer.
- **Errors are announced.** Failure banners and the surface-boundary
  fallback cards carry `role="alert"`; error states are rendered
  sentences, never color alone.
- **Reduced motion is structural.** Under `prefers-reduced-motion` (or a
  host `data-reduce-motion="true"` ancestor) shimmer and typing dots
  collapse to resting states — the signal survives without the motion.
  The package's default companion mark is static by construction. A mark
  you supply — a `companionMark` node or a `companion-mark-src` image —
  is yours to hold still under reduced motion: the package cannot stop a
  GIF, an APNG or SMIL, and a CSS rule on your node's root would promise
  more than it delivers.
- Static a11y rules (`eslint-plugin-jsx-a11y`) gate the package's own
  chrome in CI.

No conformance certification is claimed. Found a gap? File an issue —
a11y reports are treated as bugs, not feature requests.

## Contract

The wire this package speaks is frozen in the serving assistant contract
(the contract document itself does not ship in the package); the types
under `src/contract/` are its executable mirror, DO ship in the package
(`src` is included for declaration maps), and are exported from the
package root. Changes are additive only. The package's own API follows
that rule on a version axis: while the package is 0.x its public surface
may change between versions (the changelog's versioning policy records
each change) — **pre-1.0: minor versions may break.** From 1.0 the
additive-only rule binds the package as it already binds the wire.
