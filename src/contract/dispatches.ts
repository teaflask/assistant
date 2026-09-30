// The thread's subagent dispatch ledger: the serving projection
// is receipts/status/summary — no row id, no model; summary is
// the child report's bounded excerpt stamped at settle — and the
// package's public names for it stay stable over the generated ones.
// Rows join the
// transcript's dispatch receipts by ORDINAL — the ask's identity;
// child_session_id is the drill-in handle, and a resume
// chain shares it across rows — and the row's status outranks the
// receipt's frozen outcome (the serving contract, "Reading a thread's
// subagent dispatches").

import { AgentDispatchStatus } from "../generated/models/index.js";

export type { ServingAgentDispatchResponse as ThreadDispatch } from "../generated/models/index.js";

export type ThreadDispatchStatus = AgentDispatchStatus;

// The predicates take the generated union, never bare string — a renamed
// status word in the spec must fail the compile here, not silently turn
// every ledger row into finished-and-not-failed (the dashboard's
// dispatch-status twin takes the same posture).

// Running means the child still owns its row: dispatched, or paused for
// an answer it cannot give itself — both are open, unsettled.
export function dispatchIsRunning(dispatch: {
  status: ThreadDispatchStatus;
}): boolean {
  return (
    dispatch.status === AgentDispatchStatus.dispatched ||
    dispatch.status === AgentDispatchStatus.paused
  );
}

export function dispatchFailed(dispatch: {
  status: ThreadDispatchStatus;
}): boolean {
  return dispatch.status === AgentDispatchStatus.failed;
}

/** Paused for an answer only the member's browser can give — a running
 *  row whose request the transcript can name. */
export function dispatchIsPaused(dispatch: {
  status: ThreadDispatchStatus;
}): boolean {
  return dispatch.status === AgentDispatchStatus.paused;
}

/** Whether the ledger AFFIRMATIVELY says this child is done — a row we
 *  hold whose status is succeeded or failed. The one predicate a
 *  stream-end verdict may read "settled" from: its
 *  complement is not "running" but "not known to have settled", which
 *  covers a still-dispatched row AND no row at all — a ledger read that
 *  bounded out or failed with no prior snapshot. A ledger not read is not
 *  a ledger that settled (the backend's own null posture on the
 *  sse_stream_teardown line), so undefined answers false here, and a
 *  judge asking "did it settle?" through this predicate can never turn an
 *  unreadable ledger into Finished. Enumerated over every state:
 *
 *    dispatched → false     succeeded → true
 *    paused     → false     failed    → true
 *    undefined (unread) → false */
export function dispatchHasSettled(
  dispatch: { status: ThreadDispatchStatus } | undefined,
): boolean {
  if (dispatch === undefined) {
    return false;
  }
  switch (dispatch.status) {
    case AgentDispatchStatus.succeeded:
    case AgentDispatchStatus.failed:
      return true;
    case AgentDispatchStatus.dispatched:
    case AgentDispatchStatus.paused:
      return false;
  }
}
