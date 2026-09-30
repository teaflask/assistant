# Scroll-follow guards — the three holes in use-stick-to-bottom's follow contract

**Status: accepted.** The design record for
`src/components/scroll-follow-guards.tsx`. The module keeps each guard's
invariant in a few lines; this file keeps the reasoning behind them: the
three holes in the library's follow contract, the guard numbering, and
the follow-liveness premise.

## The three holes

```text
Repairs to use-stick-to-bottom's follow contract, all through
its public context — no fork, no patched internals. The library
observes only its CONTENT element and trusts its own scroll handler for
escapes AND re-engages, which leaves holes this component plugs from
outside:

1. The scroll element's own height is unobserved. The composer is a
   flex sibling below the scroller, so growing it (textarea auto-grow,
   the answering ⇄ ask-anything swap) shrinks the viewport without
   touching content height — the follow logic never runs and the
   stranded rows sit below a maxed-out scrollbar.
2. The "visitor took over" escapes barely fire while streaming. The
   scroll handler discards any event that lands while resizeDifference
   is non-zero (nearly always, mid-stream), swallowing scrollbar drags
   and PageUp; and the wheel handler's ancestor walk dies at the first
   computed overflow:auto — which every overflow-x-auto <pre> reports —
   so wheeling up over a code block never releases the lock.
3. Re-engagement lives behind the same resizeDifference gate, so a
   visitor who escapes mid-stream and drags back to the bottom only
   resumes following if their scroll event wins a per-frame timing
   race against the gate's reset; when it loses, they hug the bottom
   unfollowed with the jump button hidden. Escape and re-engage are
   repaired as a pair.

stopScroll() is the library's complete escape primitive: it sets
escapedFromLock and clears isAtBottom, which also aborts any in-flight
follow (the animation loop bails the moment isAtBottom is false).
```

## `TAKEOVER_TRAVEL_PX`

```text
How much accumulated upward travel counts as the visitor taking over
(guard 3). Sized between the two gesture classes it separates: above
the couple of pixels per frame of vertical jitter a horizontal
trackpad pan chains into the transcript (which the mid-stream follow
resets every growth frame before it can accrue), and below the
smallest deliberate gesture (a keyboard arrow is ~40px, PageUp a
viewport, and a drag's offset from the bottom grows monotonically
between follow writes).
```

## The follow-liveness premise

```text
The follow-liveness proof. PREMISE: guard 1 may re-land
a reader only on a page whose CLOCK advances across animation
frames. Every follow the library starts for itself carries wait:
true, whose gate is `Date.now() + 1 > Date.now()` — under a
pinned clock (TVC-146's poses) that never elapses, the follow
machinery never completes, and
state.isAtBottom (initialised true, made honest only by that
machinery) sits stale-true with the reader at the top of history:
re-landing there is a teleport out of mid-history, and the stale
reader is geometrically identical to a genuine fit-content
follower (both read scrollTop 0 with no gap). What is observed
and what is not: the probe reads Date.now() across frames and
nothing else. It is deliberately NOT a follow call's settlement —
the escape bail (`!state.isAtBottom`) settles a call without the
wait ever elapsing, so settlement proves nothing about the clock
— and NOT a write: nothing is scrolled, no animation is
registered, and a host's configured initial animation is
untouched. The remembered-shrink memory below is reachable two
ways, and the second is why it must never be swept as dead code.
(1) A mixed-clock page: Date faked at mount and restored later —
the clock-mocking harnesses customer pages mount this widget
under (Playwright's clock, sinon, vi.useFakeTimers); TVC-148
poses exactly that. (2) A live-clock mount frame under host-page
composition: the resize-observer broadcast loop's re-gather
admits every target DEEPER THAN THE PREVIOUS BROADCAST'S
SHALLOWEST DELIVERY — not deeper than the element itself — so a
host-page observer on a shallower ancestor, registered after this
one, whose callback resizes the scroller, re-delivers the
scroller inside the same frame, ahead of the next proof rAF
(measured on an unmocked Date).
Every observer inside this widget targets something deeper than
the scroller and the library observes only its content element,
so the live path requires the host page to supply the shallower
observer — the composition this widget ships into by design.
Under a clock pinned forever the memory never flushes and the
probe idles at one no-op frame callback, the cost class of the
library's own parked follow there.
```

Its verdict inside guard 1:

```text
The proof's verdict: on a page where follow cannot
complete, isAtBottom is not honest and no re-land is safe — the
wild flake was this guard teleporting the screenshot fixture's
top-of-history reader to the bottom on a transient shrink (the
shelf column's on-demand chunks landing late). A shrink beating
the first proving frame on a live page is remembered, not
dropped.
```

## Guard 1 — viewport shrink re-follow

```text
Guard 1 — viewport shrink re-follow. Keyed to the SCROLL element's
height, so content settles (shiki swapping a plain <pre> for its
highlighted twin is ~26px shorter) never trip it. state.isAtBottom
is the ONLY flag consulted, because it is the only one the
library's own follow loop consults: a genuine escape clears it
(stopScroll), while escapedFromLock can sit stale-true long after
following resumed — the jump button's scrollToBottom() never clears
it, and the events its animation emits are all discarded by the
library's own ignoreScrollToTop gate — so reading it here would
disable this guard on the escape → jump → follow path.

The landing write is synchronous on purpose: ResizeObserver
callbacks are delivered after the same frame's rAF callbacks, and
scrollToBottom's instant path only writes inside a
requestAnimationFrame promise — one frame later than "after two
rAFs the transcript is at its bottom", the contract the regression
probe holds us to. It goes through the library's state.scrollTop
setter, never the raw property: the package ships to customer
pages, where a broad scroll-behavior:smooth reset would turn a raw
assignment into an animation instead of a landing — the setter
forces scroll-behavior:auto around the write and records the
write in ignoreScrollToTop so the library discards its own echo.
The trailing scrollToBottom mirrors the library's own follow call
so its bookkeeping (animation state, isNearBottom) stays coherent;
with preserveScrollPosition it is a no-op unless still followed.
```

## Guard 2 — the wheel escape

```text
Guard 2 — the wheel escape, minus the library's dead zone. Where
the library bails unless the first overflow:auto ancestor IS the
scroller, we escape unless something between the pointer and the
scroller will actually consume the upward wheel — an inner scroller
that can still scroll up (a nested child transcript pinned to its
bottom, a max-h result pane mid-read). An inner scroller sitting at
its own top chains the wheel to the transcript, so it must escape:
that covers every <pre> — the overflow-x-auto code blocks are never
vertically scrollable, and the max-h-60/max-h-48 payload panes
render at scrollTop 0.
```

```text
Vertical dominance is required, not just a negative deltaY: a
trackpad's horizontal pan is axis-mixed, carrying small negative
deltaY jitter beside a large deltaX, and the transcript has
horizontally-pannable, vertically-unscrollable surfaces where
wheelConsumedBelow rightly lets the event through — the
overflow-x-auto code blocks (markdown/code-block.tsx) and the
tool args pane (tool-row.tsx). Panning a long code line
mid-stream must not release the lock. |deltaY| > |deltaX| is the
same axis call the browser makes when deciding which way this
wheel scrolls.
```

## Guards 3 and 4 — the non-wheel escape and its mirror

```text
Guards 3 and 4 — the non-wheel escape and its mirror, both of which
the library cannot reliably deliver from inside its own
resizeDifference gate. Capture on an ANCESTOR is load-bearing:
scroll events don't bubble but do capture-descend, and the
library's at-target listener synchronously clears
ignoreScrollToTop — running before it is the only way to tell its
writes from the visitor's. The ancestor is the scroller's root
node, not window: the <teaflask-assistant> element mounts this
whole tree into an open shadow root, and scroll is neither
bubbling nor composed, so its propagation path ends at that
ShadowRoot — a window listener would never fire there (and a
target observed from outside the shadow tree would be retargeted
to the host anyway). getRootNode() resolves to document in the
dashboard and to the ShadowRoot in the embeds; the capture phase
runs first from either.

Escape (guard 3): accumulated upward travel that is not library
writes, not the browser clamping scrollTop under a content shrink,
and not overscroll settle at the bottom, is the visitor taking
over. The ACCUMULATOR resolves guard 2's carve-out fork: that
carve-out is reachable — a horizontal pan's unconsumed deltaY
chains past the vertically-unscrollable code block into the
transcript, a couple of pixels of upward scroll per event that a
naive direction test would escape on, stranding the reader guard 2
just protected. Mid-stream the follow re-bottoms the scroller
every growth frame (a library write, which resets the
accumulator), so chained jitter can never accrue across frames —
while every deliberate gesture crosses the threshold at once (an
arrow key is ~40px, PageUp a viewport) or within a move or two (a
scrollbar or touch drag's pointer-derived offset from the bottom
grows monotonically between follow writes). A flat per-event
threshold would starve exactly that slow drag; the accumulator
does not.

Re-engage (guard 4): a downward move that genuinely CLOSES the gap
and actually LANDS at the bottom, while unfollowed, is the visitor
coming home. The landing gate (bottomGap <= 1) is load-bearing in
both directions: the library's own re-engage only flips isAtBottom
and never repositions, but ours calls scrollToBottom — during a
scrollbar or touch drag the browser re-derives scrollTop from the
pointer on every move, so a reposition anywhere inside the 70px
near-bottom band would fight the drag (snap down, pointer pulls
back up, guard 3 escapes, repeat). At bottomGap <= 1 the call is a
pure re-arm — there is nowhere left to move — and a reader resting
a few dozen pixels above the bottom is never yanked (they
re-engage through the library's own handler in a quiet window, as
before). "Closes the gap" stays as the discriminator against
scroll anchoring, which bumps scrollTop downward while holding the
gap constant. A downward move while unfollowed cannot be a library
write — the follow loop is aborted (!isAtBottom), guard 1 only
writes while followed, and the library's overscroll clamp only
moves scrollTop UP the page.
```
