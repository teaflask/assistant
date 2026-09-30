"use client";

import type { AssistantActivitySnapshot } from "../core/activity.js";
import { useAssistantSession } from "./teaflask-assistant-provider.js";
import { useCell } from "./use-store-cell.js";

/**
 * The read-only activity feed of the shared conversation core: enough to
 * render presence — a busy pulse, a pending-approval badge, the last
 * result — without mounting (or bundling) the transcript. Any component
 * under <TeaflaskAssistantProvider> may subscribe; the feed reads the
 * same store every chrome writes through, so a turn started in the page
 * pulses here too.
 */
export function useAssistantActivity(): AssistantActivitySnapshot {
  const { store } = useAssistantSession();
  return useCell(store.activity);
}
