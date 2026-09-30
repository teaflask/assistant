"use client";

import { useSyncExternalStore } from "react";

import {
  assistantSurfaceRegistry,
  type AssistantSurfacePresence,
} from "../core/surface-registry.js";

// Arrow wrappers on purpose: the registry's methods are instance
// methods, and useSyncExternalStore calls what it's given unbound. The
// registry never registers on the server, so the live getter doubles as
// the server snapshot (the frozen all-false presence).

export function useAssistantSurfacePresence(): AssistantSurfacePresence {
  return useSyncExternalStore(
    (listener) => assistantSurfaceRegistry.subscribe(listener),
    () => assistantSurfaceRegistry.getSnapshot(),
    () => assistantSurfaceRegistry.getSnapshot(),
  );
}
