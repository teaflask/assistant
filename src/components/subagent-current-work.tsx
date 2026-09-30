"use client";

// The inline current-work seam (TVC-072): how a running child's newest
// live operation reaches the delegation group row. The ONLY honest
// writer is an open child drill-in stream — the dispatches poll carries
// no per-operation evidence, and populating this from anywhere else
// would mean opening child streams the roster is forbidden to open
// (replay-metadata-contract.md: current operation is drill-in-only). A
// child nobody is watching simply has no entry, and the row's
// current-work line disappears cleanly.
//
// Two contexts, not one: the read side (the map) changes on every
// published operation, while the write side (the publisher) must stay
// referentially stable so the child transcript's publish effect never
// re-runs because a sibling updated the map.

import { createContext, useContext } from "react";

import type { ToolCallViewModel } from "../core/tool-call-display.js";

const EMPTY_CURRENT_WORK: ReadonlyMap<string, ToolCallViewModel> = new Map();

/** childSessionId → the newest LIVE tool-call view the open drill-in
 *  stream has seen (core/subagent-presence.ts's newestToolCallViewOf).
 *  The empty default keeps bare-rendered rows honestly quiet. */
export const SubagentCurrentWorkContext =
  createContext<ReadonlyMap<string, ToolCallViewModel>>(EMPTY_CURRENT_WORK);

export type SubagentCurrentWorkPublisher = (
  childSessionId: string,
  view: ToolCallViewModel | null,
) => void;

const NOOP_PUBLISHER: SubagentCurrentWorkPublisher = () => undefined;

/** The write side: the child transcript publishes while its stream is
 *  live and clears on settle/unmount. The no-op default keeps a child
 *  transcript mounted outside the delegation surface (tests, bare hosts)
 *  side-effect free. */
export const SubagentCurrentWorkPublisherContext =
  createContext<SubagentCurrentWorkPublisher>(NOOP_PUBLISHER);

export function useSubagentCurrentWork(): ReadonlyMap<
  string,
  ToolCallViewModel
> {
  return useContext(SubagentCurrentWorkContext);
}

export function useSubagentCurrentWorkPublisher(): SubagentCurrentWorkPublisher {
  return useContext(SubagentCurrentWorkPublisherContext);
}
