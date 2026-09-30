"use client";

import { useEffect, useRef, type RefObject } from "react";

/** A ref that holds the latest committed value: written at commit time
 *  (every commit, never during render), so an effect that must reach the
 *  newest callback or label without re-running reads it from here. */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
