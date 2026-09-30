import { ObservableCell, type ReadonlyCell } from "./observable-cell.js";

// The companion drawer's open flag, as page-level state rather than a
// component's: the host may remount the whole assistant tree between
// routes (the dashboard's route shells differ), and the drawer must land
// on the destination exactly as the last writer left it. Three writers:
// the mark and the drawer's own controls, the navigate handler (a tool
// navigation opens it), and a full surface taking the floor (closes it).
// Module-scoped like the surface registry — the handler runs outside any
// React tree — and in memory only: a full page load starts closed.

const _openCell = new ObservableCell<boolean>(false);

export const companionDrawerOpen: ReadonlyCell<boolean> = _openCell;

export function openCompanionDrawer(): void {
  _openCell.set(true);
}

export function closeCompanionDrawer(): void {
  _openCell.set(false);
}
