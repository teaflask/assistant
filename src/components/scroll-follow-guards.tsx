"use client";

import { useEffect } from "react";
import {
  useStickToBottomContext,
  type StickToBottomContext,
} from "use-stick-to-bottom";

// Repairs to use-stick-to-bottom's follow contract, all through its
// public context — no fork, no patched internals. The library observes
// only its CONTENT element and trusts its own scroll handler for
// escapes AND re-engages; the three holes that leaves, and each
// guard's reasoning, are docs/scroll-follow-guards.md. stopScroll() is
// the library's complete escape primitive: it sets escapedFromLock and
// clears isAtBottom, which aborts any in-flight follow.

// Accumulated upward travel that counts as the visitor taking over
// (guard 3): above the per-frame jitter a horizontal trackpad pan chains
// into the transcript (reset every mid-stream growth frame), below the
// smallest deliberate gesture (an arrow key is ~40px, PageUp a viewport).
const TAKEOVER_TRAVEL_PX = 16;

export function ScrollFollowGuards() {
  const { scrollRef, state, stopScroll, scrollToBottom } =
    useStickToBottomContext();

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (scrollElement === null) {
      return;
    }
    const teardowns = [
      _installShrinkRefollow(scrollElement, state, scrollToBottom),
      _installWheelEscape(scrollElement, state, stopScroll),
      _installTravelGuards(scrollElement, state, stopScroll, scrollToBottom),
    ];
    return () => {
      for (const teardown of teardowns) {
        teardown();
      }
    };
    // Every dependency is identity-stable in the library (state is a
    // mount-scoped memo; the callbacks close over stable refs), so this
    // installs once per mounted scroller.
  }, [scrollRef, scrollToBottom, state, stopScroll]);

  return null;
}

type FollowState = StickToBottomContext["state"];
type ScrollToBottom = StickToBottomContext["scrollToBottom"];
type StopScroll = StickToBottomContext["stopScroll"];

// Guard 1 — viewport shrink re-follow, keyed to the SCROLL element's
// height so content settles never trip it. state.isAtBottom is the
// ONLY flag consulted (escapedFromLock sits stale-true on the escape
// → jump → follow path). The landing write is synchronous — after two
// rAFs the transcript is at its bottom — and goes through the
// library's state.scrollTop setter, never the raw property (it forces
// scroll-behavior:auto and records the echo in ignoreScrollToTop);
// the trailing scrollToBottom keeps the library's bookkeeping coherent.
function _installShrinkRefollow(
  scrollElement: HTMLElement,
  state: FollowState,
  scrollToBottom: ScrollToBottom,
): () => void {
  // The follow-liveness proof. PREMISE: guard 1 may re-land a reader
  // only on a page whose clock advances across frames — under a pinned
  // clock the library's wait:true follows never complete and
  // state.isAtBottom sits stale-true at the top of history. The probe
  // reads Date.now() across frames and nothing else (never a follow's
  // settlement, never a write). A shrink seen before the proof is
  // remembered, not dropped: both paths that reach it are in
  // docs/scroll-follow-guards.md; the latch counts are in the
  // scroll-follow guard latch measurement record.
  const clockStart = Date.now();
  let clockProven = false;
  let shrinkPendingProof = false;
  const landAtBottom = () => {
    state.scrollTop = scrollElement.scrollHeight - scrollElement.clientHeight;
    void scrollToBottom({
      animation: "instant",
      wait: true,
      preserveScrollPosition: true,
    });
  };
  let proofFrame = requestAnimationFrame(function proveClock() {
    if (Date.now() > clockStart) {
      clockProven = true;
      // The reader must still be followed at flush time — an escape
      // between the remembered shrink and the proof wins.
      if (shrinkPendingProof && state.isAtBottom) {
        shrinkPendingProof = false;
        landAtBottom();
      }
      return;
    }
    proofFrame = requestAnimationFrame(proveClock);
  });

  let lastClientHeight: number | null = null;
  const observer = new ResizeObserver(() => {
    const height = scrollElement.clientHeight;
    const previousHeight = lastClientHeight;
    lastClientHeight = height;
    const viewportShrank = previousHeight !== null && height < previousHeight;
    if (!viewportShrank || !state.isAtBottom) {
      return;
    }
    // The proof's verdict: until the clock is proven, isAtBottom is
    // not honest and no re-land is safe — a shrink that beats the
    // first proving frame is remembered, never dropped.
    if (!clockProven) {
      shrinkPendingProof = true;
      return;
    }
    landAtBottom();
  });
  observer.observe(scrollElement);

  return () => {
    cancelAnimationFrame(proofFrame);
    observer.disconnect();
  };
}

// Guard 2 — the wheel escape, minus the library's dead zone (it bails
// unless the first overflow:auto ancestor IS the scroller). We escape
// unless something between the pointer and the scroller will consume
// the upward wheel — an inner scroller that can still scroll up; one
// at its own top chains the wheel to the transcript, so it escapes.
function _installWheelEscape(
  scrollElement: HTMLElement,
  state: FollowState,
  stopScroll: StopScroll,
): () => void {
  const handleWheel = (event: WheelEvent) => {
    // Vertical dominance, not just a negative deltaY: a trackpad's
    // horizontal pan carries small negative deltaY jitter beside a large
    // deltaX, and panning a long code line mid-stream must not release
    // the lock. |deltaY| > |deltaX| is the browser's own axis call.
    const wheelingUp =
      event.deltaY < 0 && Math.abs(event.deltaY) > Math.abs(event.deltaX);
    const transcriptOverflows =
      scrollElement.scrollHeight > scrollElement.clientHeight;
    if (
      wheelingUp &&
      transcriptOverflows &&
      state.animation?.ignoreEscapes !== true &&
      !wheelConsumedBelow(event.target, scrollElement)
    ) {
      stopScroll();
    }
  };
  scrollElement.addEventListener("wheel", handleWheel, {
    passive: true,
    capture: true,
  });
  return () => {
    scrollElement.removeEventListener("wheel", handleWheel, {
      capture: true,
    });
  };
}

// Guards 3 and 4 — the non-wheel escape and its mirror, which the
// library cannot deliver from inside its resizeDifference gate.
// Capture on an ANCESTOR is load-bearing: scroll events capture-
// descend, and the library's at-target listener synchronously clears
// ignoreScrollToTop — running before it is the only way to tell its
// writes from the visitor's. The ancestor is the scroller's root node,
// not window: scroll is neither bubbling nor composed, so in the
// embeds' open shadow root a window listener would never fire.
//
// Escape (guard 3): accumulated upward travel that is not a library
// write, not the browser clamping under a content shrink, and not
// overscroll settle at the bottom. The ACCUMULATOR (not a per-event
// threshold) is what lets chained pan jitter never accrue — the
// follow resets it every growth frame — while a slow drag still
// crosses TAKEOVER_TRAVEL_PX within a move or two.
//
// Re-engage (guard 4): a downward move that CLOSES the gap and LANDS
// at the bottom while unfollowed. The landing gate (bottomGap <= 1)
// is load-bearing: our scrollToBottom repositions, and doing so
// anywhere inside the near-bottom band would fight a scrollbar or
// touch drag (snap down, pointer pulls up, guard 3 escapes, repeat);
// at bottomGap <= 1 it is a pure re-arm. "Closes the gap" rules out
// scroll anchoring, which bumps scrollTop while holding the gap.
function _installTravelGuards(
  scrollElement: HTMLElement,
  state: FollowState,
  stopScroll: StopScroll,
  scrollToBottom: ScrollToBottom,
): () => void {
  let lastScrollTop = scrollElement.scrollTop;
  let lastScrollHeight = scrollElement.scrollHeight;
  let lastBottomGap =
    scrollElement.scrollHeight -
    scrollElement.clientHeight -
    scrollElement.scrollTop;
  let upwardTravel = 0;
  const handleScroll = (event: Event) => {
    if (event.target !== scrollElement) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = scrollElement;
    const bottomGap = scrollHeight - clientHeight - scrollTop;
    const previousTop = lastScrollTop;
    const previousScrollHeight = lastScrollHeight;
    const previousBottomGap = lastBottomGap;
    lastScrollTop = scrollTop;
    lastScrollHeight = scrollHeight;
    lastBottomGap = bottomGap;

    const libraryWroteIt = scrollTop === state.ignoreScrollToTop;
    const movedUp = scrollTop < previousTop;
    const movedDown = scrollTop > previousTop;
    const contentShrankUnderUs =
      scrollHeight < previousScrollHeight || state.resizeDifference < 0;
    const overscrollSettleAtBottom = bottomGap <= 1;

    if (libraryWroteIt || movedDown) {
      upwardTravel = 0;
    }
    if (
      movedUp &&
      !libraryWroteIt &&
      !contentShrankUnderUs &&
      !overscrollSettleAtBottom &&
      state.animation?.ignoreEscapes !== true
    ) {
      upwardTravel += previousTop - scrollTop;
      if (upwardTravel > TAKEOVER_TRAVEL_PX) {
        upwardTravel = 0;
        stopScroll();
        return;
      }
    }

    const closingTheGap = movedDown && previousBottomGap - bottomGap > 1;
    if (!state.isAtBottom && closingTheGap && bottomGap <= 1) {
      void scrollToBottom({ animation: "instant" });
    }
  };
  const scrollRoot = scrollElement.getRootNode();
  scrollRoot.addEventListener("scroll", handleScroll, {
    passive: true,
    capture: true,
  });
  return () => {
    scrollRoot.removeEventListener("scroll", handleScroll, {
      capture: true,
    });
  };
}

// True when an element between the wheel's target and the scroller
// (inclusive of the target) would consume an upward wheel itself: it can
// still scroll up AND its overflow-y actually scrolls. Mirrors native
// scroll chaining — the browser only hands the wheel to the transcript
// once every inner scroller is at its top. The geometry reads come first
// so getComputedStyle stays off the hot path.
function wheelConsumedBelow(
  target: EventTarget | null,
  scrollElement: HTMLElement,
): boolean {
  let element = target instanceof Element ? target : null;
  while (element !== null && element !== scrollElement) {
    const canStillScrollUp =
      element.scrollTop > 0 && element.scrollHeight > element.clientHeight;
    if (
      canStillScrollUp &&
      ["auto", "scroll", "overlay"].includes(
        getComputedStyle(element).overflowY,
      )
    ) {
      return true;
    }
    element = element.parentElement;
  }
  return false;
}
