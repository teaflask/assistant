"use client";

import { useEffect } from "react";

import {
  assistantSurfaceRegistry,
  type AssistantSurfaceKind,
} from "../core/surface-registry.js";

/**
 * Announces a mounted chrome to the page-wide surface registry while
 * `active` — the signal the companion yields to. A plain effect (not a
 * layout effect) means the announcement lands one frame after paint;
 * whether that frame matters for companion flicker is the companion's
 * call to make, beside its consumer.
 */
export function useRegisterAssistantSurface(
  kind: AssistantSurfaceKind,
  active = true,
): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    return assistantSurfaceRegistry.register(kind);
  }, [kind, active]);
}
