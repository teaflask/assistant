"use client";

// The coworker-work seam: what the member owes each coworker — an action
// their browser performs or a decision on an approval — keyed by ordinal,
// for the delegation group row. Fed from the store's coworkerWork cell
// (the execution inbox's coworker entries and the approval inbox's
// coworker cards, folded), never from a child stream — the drill-in-only
// current-work seam beside it stays its own. A host rendering rows bare
// gets the empty map and a quiet line.

import { createContext, useContext } from "react";

import type { CoworkerExecutionWork } from "../core/coworker-execution-work.js";

const EMPTY_WORK: ReadonlyMap<number, CoworkerExecutionWork> = new Map();

export const SubagentExecutionWorkContext =
  createContext<ReadonlyMap<number, CoworkerExecutionWork>>(EMPTY_WORK);

export function useSubagentExecutionWork(): ReadonlyMap<
  number,
  CoworkerExecutionWork
> {
  return useContext(SubagentExecutionWorkContext);
}
