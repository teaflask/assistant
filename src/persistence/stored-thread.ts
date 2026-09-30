// The browser's memory of its conversation: one localStorage entry per
// publishable key (pk_test and pk_live on one origin stay apart; per-org
// is impossible — the browser only knows the pk). `identified: false`
// marks a thread still to be offered for adoption on the sign-in re-mint.

export interface StoredThread {
  threadId: string;
  identified: boolean;
}

export function readStoredThread(publishableKey: string): StoredThread | null {
  const raw = _storage()?.getItem(_storageKeyFor(publishableKey)) ?? null;
  if (raw === null) {
    return null;
  }
  return _decodeStoredThread(raw);
}

export function writeStoredThread(
  publishableKey: string,
  stored: StoredThread,
): void {
  try {
    _storage()?.setItem(_storageKeyFor(publishableKey), JSON.stringify(stored));
  } catch {
    // Quota or privacy-mode failures cost persistence, never the widget.
  }
}

export function clearStoredThread(publishableKey: string): void {
  try {
    _storage()?.removeItem(_storageKeyFor(publishableKey));
  } catch {
    // Same stance as writes: storage trouble never breaks the widget.
  }
}

/**
 * The host-logout contract: call this in the sign-out handler so the next
 * visitor on this browser starts clean. Pure storage — it works on pages
 * where the widget isn't mounted (the common case for logout flows).
 */
export function resetAssistant(options: { publishableKey: string }): void {
  clearStoredThread(options.publishableKey);
}

function _storageKeyFor(publishableKey: string): string {
  return `tf-assistant:${publishableKey}:thread`;
}

function _storage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    // Some embeds (sandboxed iframes, blocked third-party storage) throw
    // on access; the widget then simply doesn't persist.
    return null;
  }
}

function _decodeStoredThread(raw: string): StoredThread | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (_isStoredThread(parsed)) {
      return parsed;
    }
  } catch {
    // A corrupt entry reads as no entry.
  }
  return null;
}

function _isStoredThread(value: unknown): value is StoredThread {
  return (
    typeof value === "object" &&
    value !== null &&
    "threadId" in value &&
    typeof value.threadId === "string" &&
    "identified" in value &&
    typeof value.identified === "boolean"
  );
}
