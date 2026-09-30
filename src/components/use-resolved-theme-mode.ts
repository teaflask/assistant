"use client";

import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

import type { ToolViewThemeMode } from "../core/tool-view.js";

// The runtime answer to "which palette is painted here?" for the
// tool-view props' `themeMode`. The stylesheet is the ground truth; its
// theme grammar is three rules computed AT THE WIDGET ROOT
// (`[data-tf-assistant]`): (1) an ancestor's or the root's own
// `data-tf-theme="dark"` paints dark; (2) the root's OWN "light"/"auto"
// re-pin light at equal specificity, out-cascading an ancestor's dark —
// root level ONLY; (3) prefers-color-scheme upgrades "auto" to dark at
// root level only. Resolution mirrors that exactly, never a nearest-
// carrier walk: carriers inside the root are inert, and no carrier
// paints light — reporting the OS preference would lie about the pixels.

const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

export function useResolvedThemeMode(
  ref: RefObject<HTMLElement | null>,
): ToolViewThemeMode {
  // "light" before the first resolution: SSR-safe (no window at module
  // scope or render time) and the honest default for the no-carrier
  // case.
  const [mode, setMode] = useState<ToolViewThemeMode>("light");
  // The initial resolution is a LAYOUT effect on purpose: a passive
  // effect runs after paint and would hand every renderer one painted
  // light frame per mount in a dark-pinned host — every mid-stream row,
  // not an SSR-only artifact.
  useLayoutEffect(() => {
    setMode(_resolvedThemeModeFor(ref.current));
  }, [ref]);
  useEffect(() => {
    // The ref is read at decision time, never captured. This value has no
    // CSS backstop — it is handed to host code as the only channel — so
    // BOTH change paths re-resolve live: the attribute can flip on any
    // ancestor, written by anyone (a host theme library writing <html>
    // imperatively), hence a document-wide observer, not a render-time
    // read; and a slot whose root node is a shadow root watches that root
    // too — a set `mode` prop lands `data-tf-theme` INSIDE it. One
    // observer pair per mounted slot: linear in custom-rendered rows, and
    // `attributeFilter` keeps each dispatch cheap.
    const resolve = () => {
      setMode(_resolvedThemeModeFor(ref.current));
    };
    resolve();
    const observer = new MutationObserver(resolve);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-tf-theme"],
      subtree: true,
    });
    const rootNode = ref.current?.getRootNode();
    let shadowObserver: MutationObserver | null = null;
    if (rootNode instanceof ShadowRoot) {
      shadowObserver = new MutationObserver(resolve);
      shadowObserver.observe(rootNode, {
        attributes: true,
        attributeFilter: ["data-tf-theme"],
        subtree: true,
      });
    }
    // jsdom ships no matchMedia; a host page always has one. Without
    // it, "auto" and the OS flip degrade to light rather than throwing.
    if (typeof window.matchMedia !== "function") {
      return () => {
        observer.disconnect();
        shadowObserver?.disconnect();
      };
    }
    const media = window.matchMedia(DARK_SCHEME_QUERY);
    media.addEventListener("change", resolve);
    return () => {
      observer.disconnect();
      shadowObserver?.disconnect();
      media.removeEventListener("change", resolve);
    };
  }, [ref]);
  return mode;
}

function _resolvedThemeModeFor(element: HTMLElement | null): ToolViewThemeMode {
  if (element === null) {
    return "light";
  }
  // The stylesheet computes the palette at the widget root; a bare test
  // or fixture mount with no root falls back to the slot element itself,
  // which the same rules then treat as the root.
  const root = element.closest<HTMLElement>("[data-tf-assistant]") ?? element;
  const own = root.getAttribute("data-tf-theme");
  if (own === "dark") {
    return "dark";
  }
  if (own === "light") {
    return "light";
  }
  if (own === "auto") {
    return _prefersDark() ? "dark" : "light";
  }
  // A bare root: any strict ancestor's "dark" paints dark (rule 1's
  // descendant combinator); ancestor "light"/"auto" match no rule.
  const ancestorDark =
    root.parentElement?.closest('[data-tf-theme="dark"]') ?? null;
  return ancestorDark === null ? "light" : "dark";
}

function _prefersDark(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia(DARK_SCHEME_QUERY).matches
  );
}
