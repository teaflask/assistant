# The surface boundary — three rules, the guard enumeration, and the ruled exception

**Status: accepted.** The design record for
`src/components/surface-boundary.tsx`. The module keeps a header naming
the three rules and a short invariant above each guarded call; this file
keeps the rationale. The placement ledger — every site, its reset
identity, its blast radius — is `tests/surface-boundary-census.test.ts`,
and the card's computed style is falsified across the adversarial matrix
in `tests-e2e/boundary.spec.ts`. Inside a fenced block, "here" and
"below" refer to the module.

## Why the boundary exists, and the three rules

```text
The surface boundary: without it, only two boundaries would exist
— the lazy-chunk one (lazy-body.tsx) and the tool-view adapter catch
(react-tool-view.tsx) — so a throw in the message list, a tool row or
a decision surface propagated into the HOST's React tree and could
unmount their page. That is the package's worst failure mode: our bug
taking down a customer's app. Every package surface in the shipping
composition renders behind an error boundary — the exported chrome
roots (page, palette, companion) are self-wrapped backstops, the
granular interior wraps bound the blast radius to one surface or one
row, and the palette/drawer bodies keep their LazyBody boundary. The
full placement ledger — every site, its reset identity, its blast
radius — is tests/surface-boundary-census.test.ts.

Three rules, in tension and all held:
- Never swallow: the session's reportError (the provider's onError)
  still fires, and the console still names which surface failed, with
  the component stack.
- Never wrap: the no-error render returns children directly — zero
  extra DOM, so pixel baselines, the shelf's :empty collapse and the
  dashboard's markup are byte-identical while nothing throws.
- Degrade to a card, not a blank: one flow-normal element with
  role="alert". No reload CTA — a render bug is not a dead chunk, and
  this widget lives inside someone else's page (lazy-body.tsx's rule).
  The card is CASCADE-INDEPENDENT (a cascade patch here
  only moves the failure to the next surface): every
  declaration it needs is an inline literal — see FALLBACK_CARD_STYLE
  — so its appearance depends on nothing but itself: no theming root,
  no token chain, no sheet ordering, no widget mode, no host ground.
  It deliberately does NOT follow the widget theme; it is one fixed,
  legible alert on any surface, which is the whole job of the one
  element that must stay readable when the widget is broken.
  ONE exception, opt-in: the palette and companion
  are overlay/top-layer mounts sitting as siblings at the end of the
  host's tree — an in-flow card there appears as a stray block at the
  bottom of the host page, so those two degrade SILENTLY
  (degrade="silent": render nothing). Reporting is identical either
  way — onError fires and the console names the surface.

No reset API on purpose: recovery is a remount — the KEY must sit on
the SurfaceBoundary element itself (conversation-view.tsx keys the
transcript backstop on `${threadId}#${reconnectNonce}`; message-list
keys the per-card boundaries on the interrupt id). A key on a child
inside the boundary resets nothing: once latched, render() never
reconciles the children again.
```

## The card's appearance

```text
The card's entire appearance, as literals: a fixed light alert card —
white ground, near-black ink, hairline border — chosen because it is
legible on ANY host surface, dark pages included (the trigger:
a ground-less card painted near-black text straight onto a dark host
page). No var() anywhere: a custom property would re-attach the card
to whichever tree it lands in.
```

## The guard enumeration (`componentDidCatch`)

```text
THE GUARD ENUMERATION: every call out of this boundary that host
code can supply or intercept, and its guard — a throw INSIDE
componentDidCatch re-raises to the next boundary up, and at the
chrome roots there is none, so an unguarded host callback would
unmount the host tree: the one outcome this element exists to
prevent.
 1. onFailure — the host's onError (via the provider's reportError
    or the prop): guarded; its throw — of ANY payload, Error or
    not, null included (a boolean flag, never a value sentinel:
    `throw null` is a legal host throw and must not read as "no
    throw") — is narrated, never swallowed silently and never
    allowed to escape. The payload rides to the console as an
    argument, never stringified by us, so a payload whose own
    toString throws cannot detonate in our code.
 2. the surface narration — console.error, host-interceptable by
    monkey-patch: guarded; a throwing interceptor costs the log
    line, never the host tree.
 3. the observer-throw narration, emitted AFTER the surface
    narration inside guard 2's TRY (not
    inside either catch) — so a throwing interceptor on the first
    line takes this second line down with it. Accepted cost under
    item 2: both lines lost, tree kept.
 (The wrapper's useOptionalAssistantSession read is package-owned
 and tolerant — no host code on that path.)
 OUT OF REACH, named so the ledger's exhaustiveness is honest: a
 host callback that never RETURNS — a synchronous hang — stalls
 this commit and no try/catch can contain it. There is no code
 fix; non-termination is outside what an error boundary can guard.
```

## The ruled exception — inline literals on the degraded card

```text
The ruled exception: the degraded card must stay
legible precisely when the widget is broken, so its appearance
may not be a function of the widget cascade, the theming
roots, or the host sheet — every class/attribute mechanism
loses somewhere. Inline literals are the one mechanism no
later stylesheet rule can out-cascade. Falsified by computed
style across the adversarial matrix in
tests-e2e/boundary.spec.ts.
```
