"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

interface PreviewChoreography {
  previewKey: string | null;
  setPreviewKey: (key: string | null) => void;
  previewRef: RefObject<HTMLDivElement | null>;
  /** The row that opened the current preview — where Esc hands focus. */
  previewOpenerRef: RefObject<HTMLButtonElement | null>;
  /** One-shot: the opener's focus after an Esc hand-back is a return,
   *  not an arrival, and must not reopen the preview it just closed. */
  mutePreviewFocusOpenRef: RefObject<boolean>;
  onPreviewChange: (key: string, open: boolean) => void;
  onPreviewOpener: (opener: HTMLButtonElement) => void;
  onPreviewFocus: (key: string, opener: HTMLButtonElement) => void;
  focusPreview: () => void;
}

/** Which row's preview is open, who opened it, and the row callbacks
 *  that move it: hover and tap open, focus opens unless muted. */
export function usePreviewChoreography(): PreviewChoreography {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const previewOpenerRef = useRef<HTMLButtonElement | null>(null);
  const mutePreviewFocusOpenRef = useRef(false);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  return {
    previewKey,
    setPreviewKey,
    previewRef,
    previewOpenerRef,
    mutePreviewFocusOpenRef,
    onPreviewChange: (key, nextOpen) => {
      setPreviewKey(nextOpen ? key : null);
    },
    onPreviewOpener: (opener) => {
      previewOpenerRef.current = opener;
    },
    onPreviewFocus: (key, opener) => {
      if (mutePreviewFocusOpenRef.current) {
        mutePreviewFocusOpenRef.current = false;
        return;
      }
      previewOpenerRef.current = opener;
      setPreviewKey(key);
    },
    focusPreview: () => {
      previewRef.current?.focus();
    },
  };
}

/** Escape inside the card or its preview: closes the open preview first
 *  (handing focus back to its opener row, muted so the hand-back does not
 *  reopen it), the roster itself otherwise. */
export function usePreviewEscape(wires: {
  floatingRef: RefObject<HTMLDivElement | null>;
  previewRef: RefObject<HTMLDivElement | null>;
  previewOpenerRef: RefObject<HTMLButtonElement | null>;
  mutePreviewFocusOpenRef: RefObject<boolean>;
  previewKey: string | null;
  setPreviewKey: (key: string | null) => void;
  onClose: () => void;
  refocusTrigger: () => void;
}): void {
  const {
    floatingRef,
    previewRef,
    previewOpenerRef,
    mutePreviewFocusOpenRef,
    previewKey,
    setPreviewKey,
    onClose,
    refocusTrigger,
  } = wires;
  useEffect(() => {
    const floating = floatingRef.current;
    if (floating === null) {
      return;
    }
    const preview = previewRef.current;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (previewKey !== null) {
        setPreviewKey(null);
        const opener = previewOpenerRef.current;
        const root = opener?.getRootNode();
        const active =
          root instanceof Document || root instanceof ShadowRoot
            ? root.activeElement
            : null;
        if (opener !== null && opener !== active) {
          mutePreviewFocusOpenRef.current = true;
          opener.focus();
        } else {
          mutePreviewFocusOpenRef.current = false;
        }
        return;
      }
      onClose();
      refocusTrigger();
    };
    floating.addEventListener("keydown", closeOnEscape);
    preview?.addEventListener("keydown", closeOnEscape);
    return () => {
      floating.removeEventListener("keydown", closeOnEscape);
      preview?.removeEventListener("keydown", closeOnEscape);
    };
  }, [
    floatingRef,
    previewRef,
    previewOpenerRef,
    mutePreviewFocusOpenRef,
    onClose,
    previewKey,
    setPreviewKey,
    refocusTrigger,
  ]);
}
