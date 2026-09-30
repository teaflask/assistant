"use client";

import { createContext, useContext } from "react";

import type { ToolViewRegistry } from "../core/tool-view.js";

// The provider's tool-view registry channel to the transcript surfaces
// (tool-views.md). A separate context from the session for the same
// reason appearance is: hosts write the `toolViews` prop as an inline
// object literal, and a registry holds adapters — the theme prop's
// serialize-and-key trick cannot apply, so the registry must be
// structurally unable to reach the session's memo keys, where a
// fresh-per-render identity would tear down and rebuild the
// conversation transport.

export const ToolViewRegistryContext = createContext<ToolViewRegistry | null>(
  null,
);

/** The tolerant read: `undefined` outside a provider, which is what
 *  keeps bare mounts (tests, fixtures) and registry-less hosts — React
 *  or script-tag, registering nothing stays fully supported — on
 *  package defaults everywhere. */
export function useToolViewRegistry(): ToolViewRegistry | undefined {
  return useContext(ToolViewRegistryContext) ?? undefined;
}
