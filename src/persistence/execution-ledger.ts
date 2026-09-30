// The browser's memory of what it already executed: one sessionStorage
// entry per thread, holding the interrupt ids this tab claimed and the
// outcomes their handlers produced. The at-most-once backstop of the
// execution loop — the stream's own replayed evidence closes stale
// entries first, but only this record survives the remount a navigation
// causes, and "re-POST the stored outcome" is the contract's designed
// recovery where re-execution never is.
//
// Session-scoped on purpose: the record guards THIS tab's re-execution;
// cross-tab arbitration is the server's (first-wins recording); a
// cross-tab residual is accepted.

import type { ExecutionOutcome } from "../core/execution-handlers.js";

// A claim with no outcome is a tab that died mid-handler: the action may
// or may not have happened, so the record reads as this honest failure —
// never as a license to re-execute.
export const UNKNOWN_OUTCOME: Extract<ExecutionOutcome, { ok: false }> = {
  ok: false,
  error: {
    code: "execution_failed",
    message:
      "The page was interrupted while performing this action, so its " +
      "outcome is unknown. Tell the user what was being attempted and ask " +
      "them to check whether it happened before anything is retried.",
  },
};

// Executions are rare per thread (one per pause round); the cap only
// bounds a pathological session.
const MAX_RECORDED_EXECUTIONS = 40;

interface LedgerRecord {
  interruptId: string;
  outcome: ExecutionOutcome | null;
}

// Module memory is the always-written layer (authoritative for this
// page's lifetime, immune to quota trouble); sessionStorage is the
// persistence layer a reload reads back. Where storage is unavailable
// (SSR, sandboxed embeds), the ledger simply doesn't survive reloads.
const memoryLedgers = new Map<string, LedgerRecord[]>();

/**
 * The outcome this tab already produced for an interrupt, the canned
 * unknown-outcome failure for a claim that never settled, or null when
 * the interrupt was never claimed here (executing is allowed).
 */
export function readExecutedOutcome(
  threadId: string,
  interruptId: string,
): ExecutionOutcome | null {
  const record = _recordsFor(threadId).find(
    (known) => known.interruptId === interruptId,
  );
  if (record === undefined) {
    return null;
  }
  return record.outcome ?? UNKNOWN_OUTCOME;
}

/** Written the instant an entry is claimed, before its handler runs. */
export function recordExecutionClaimed(
  threadId: string,
  interruptId: string,
): void {
  const records = _recordsFor(threadId);
  if (records.some((known) => known.interruptId === interruptId)) {
    return;
  }
  records.push({ interruptId, outcome: null });
  _writeRecords(threadId, records.slice(-MAX_RECORDED_EXECUTIONS));
}

export function recordExecutedOutcome(
  threadId: string,
  interruptId: string,
  outcome: ExecutionOutcome,
): void {
  const records = _recordsFor(threadId);
  const known = records.find((record) => record.interruptId === interruptId);
  if (known !== undefined) {
    known.outcome = outcome;
  } else {
    records.push({ interruptId, outcome });
  }
  _writeRecords(threadId, records.slice(-MAX_RECORDED_EXECUTIONS));
}

function _storageKeyFor(threadId: string): string {
  return `tf-assistant:executions:${threadId}`;
}

function _recordsFor(threadId: string): LedgerRecord[] {
  const remembered = memoryLedgers.get(threadId);
  if (remembered !== undefined) {
    return remembered;
  }
  const raw = _storage()?.getItem(_storageKeyFor(threadId)) ?? null;
  return raw === null ? [] : _decodeRecords(raw);
}

function _writeRecords(threadId: string, records: LedgerRecord[]): void {
  memoryLedgers.set(threadId, records);
  try {
    _storage()?.setItem(_storageKeyFor(threadId), JSON.stringify(records));
  } catch {
    // Quota trouble costs reload persistence, never the in-page record —
    // module memory above already holds the at-most-once claim.
  }
}

function _storage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    // Some embeds (sandboxed iframes, blocked third-party storage) throw
    // on access; the ledger then lives in module memory.
    return null;
  }
}

function _decodeRecords(raw: string): LedgerRecord[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(_isLedgerRecord);
    }
  } catch {
    // A corrupt entry reads as no entries.
  }
  return [];
}

function _isLedgerRecord(value: unknown): value is LedgerRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "interruptId" in value &&
    typeof value.interruptId === "string" &&
    "outcome" in value
  );
}
