"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

// The fold cue: the answer list is the panel's one scroller under the
// well's height budget, so it declares when rows sit below the fold
// (the Scroll-Well Rule) — re-measured on scroll and on content growth.
export function useAnswerListFold(
  cursor: number,
  openDescription: string | null,
  customText: string,
): {
  answersRef: RefObject<HTMLDivElement | null>;
  foldBelow: boolean;
  declareFold: () => void;
} {
  const [foldBelow, setFoldBelow] = useState(false);
  const answersRef = useRef<HTMLDivElement>(null);
  const declareFold = useCallback(() => {
    const list = answersRef.current;
    if (list === null) {
      return;
    }
    const overflowing = list.scrollHeight > list.clientHeight + 1;
    const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 4;
    setFoldBelow(overflowing && !atEnd);
  }, []);
  useEffect(() => {
    declareFold();
    const list = answersRef.current;
    if (list === null || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(declareFold);
    observer.observe(list);
    for (const child of list.children) {
      observer.observe(child);
    }
    return () => {
      observer.disconnect();
    };
  }, [declareFold, cursor, openDescription, customText]);
  return { answersRef, foldBelow, declareFold };
}
