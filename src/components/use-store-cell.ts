"use client";

import { useSyncExternalStore } from "react";

import type { ReadonlyCell } from "../core/observable-cell.js";

/** The one React seam onto the store's cells: the cached snapshot doubles
 *  as the server snapshot, so SSR renders the store's initial state. */
export function useCell<T>(cell: ReadonlyCell<T>): T {
  return useSyncExternalStore(cell.subscribe, cell.get, cell.get);
}
