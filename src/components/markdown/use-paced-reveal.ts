"use client";

// The reveal side of the pacer: watches a streaming row's text grow in
// poll-sized lumps and returns the smoothly-advancing prefix to render.
// Everything present at mount paints on the first render (a mount is a
// replay; the first chunk is the first paint — neither is ever delayed),
// only growth observed while the row streams is paced, and the prefix is
// raw text — the caller repairs and parses it, so partial markdown is the
// repair layer's job, not this one's.

import { useEffect, useRef, useState, type RefObject } from "react";

import { RevealPacer } from "./reveal-pacer.js";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function usePacedReveal(
  text: string,
  streaming: boolean,
): { revealed: string; revealHostRef: RefObject<HTMLDivElement | null> } {
  const revealHostRef = useRef<HTMLDivElement | null>(null);
  const [revealedLength, setRevealedLength] = useState(text.length);
  const pacerRef = useRef<RevealPacer | null>(null);
  const frameRef = useRef<number | null>(null);
  const mountedAtRef = useRef<number | null>(null);
  const lastSeenLengthRef = useRef(text.length);
  const wasStreamingRef = useRef(streaming);

  useEffect(() => {
    const now = performance.now();
    mountedAtRef.current ??= now;
    const previousLength = lastSeenLengthRef.current;
    lastSeenLengthRef.current = text.length;
    const endedSinceLastRender = wasStreamingRef.current && !streaming;
    wasStreamingRef.current = streaming;

    const advanceRevealLoop = () => {
      frameRef.current = null;
      const pacer = pacerRef.current;
      if (pacer === null) {
        return;
      }
      const frameNow = performance.now();
      setRevealedLength(pacer.revealedLength(frameNow));
      if (!pacer.isCaughtUp(frameNow)) {
        frameRef.current = requestAnimationFrame(advanceRevealLoop);
      }
    };
    const ensureRevealLoop = () => {
      frameRef.current ??= requestAnimationFrame(advanceRevealLoop);
    };

    if (text.length < previousLength) {
      // Replaced rather than grown (a resume dedupe edge): pacing a
      // rewrite would lie about what arrived — show it whole.
      pacerRef.current?.revealInstantly();
      setRevealedLength(text.length);
      return;
    }
    if (streaming && text.length > previousLength) {
      if (_reducedMotionIsOnFor(revealHostRef.current)) {
        pacerRef.current?.revealInstantly();
        setRevealedLength(text.length);
        return;
      }
      // Lazily constructed at the first paced growth, but anchored to the
      // mount time: the gap since mount is what separates a live tail
      // (~one poll interval) from a replay backlog (back-to-back frames).
      pacerRef.current ??= new RevealPacer(
        previousLength,
        mountedAtRef.current,
      );
      pacerRef.current.observe(text.length, now);
      ensureRevealLoop();
      return;
    }
    if (endedSinceLastRender && pacerRef.current !== null) {
      if (_reducedMotionIsOnFor(revealHostRef.current)) {
        pacerRef.current.revealInstantly();
        setRevealedLength(text.length);
        return;
      }
      // The final delta and the terminal often share one network chunk;
      // React batches the recorder's two publishes into a single commit,
      // so this effect can see the text grow and the stream end at once.
      // The growth branch above was skipped (streaming is already false)
      // — feed the pacer the final length before draining, or the sweep
      // stops at the previous arrival and the tail never reveals.
      pacerRef.current.observe(text.length, now);
      pacerRef.current.beginDrain(now);
      ensureRevealLoop();
      return;
    }
    if (!streaming) {
      // A settled row whose text moved without streaming (a park's REST
      // re-read replacing the stream's partial tail) has no pacer and no
      // frame loop — this sync is the only writer left.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above; bails out when the length is unchanged
      setRevealedLength(text.length);
    }
  }, [text, streaming]);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  const cappedLength = Math.min(revealedLength, text.length);
  return {
    revealed:
      cappedLength >= text.length
        ? text
        : text.slice(0, _notSplittingASurrogatePair(text, cappedLength)),
    revealHostRef,
  };
}

// A prefix cut between the halves of a surrogate pair leaves a lone
// surrogate that paints as � for a frame. Backing off one unit stays
// monotone: the underlying boundary only ever moves forward, so the
// rounded-down boundary never retreats either.
function _notSplittingASurrogatePair(text: string, length: number): number {
  const lastCode = text.charCodeAt(length - 1);
  const cutsAPairInHalf = lastCode >= 0xd800 && lastCode <= 0xdbff;
  return cutsAPairInHalf ? length - 1 : length;
}

// Reduced motion is resolved per decision, before any pacer exists — the
// animating variant is never constructed (the package's motion
// doctrine). Both channels: the OS media query and the app's
// data-reduce-motion kill switch, read from the rendered host so the
// ancestor walk starts inside whatever tree the row mounted in.
function _reducedMotionIsOnFor(element: HTMLElement | null): boolean {
  return (
    window.matchMedia(REDUCED_MOTION_QUERY).matches ||
    (element !== null &&
      element.closest('[data-reduce-motion="true"]') !== null)
  );
}
