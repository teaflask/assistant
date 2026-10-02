// The browser's memory of its conversation: one localStorage entry per
// publishable key (pk_test and pk_live on one origin stay apart; per-org
// is impossible — the browser only knows the pk). `identified: false`
// marks a thread still to be offered for adoption on the sign-in re-mint.
// An identified entry belongs to its `userId`: nobody else resumes it.

export interface StoredThread {
  threadId: string;
  identified: boolean;
  userId?: string;
}

export function readStoredThread(publishableKey: string): StoredThread | null {
  const raw = _storage()?.getItem(_storageKeyFor(publishableKey)) ?? null;
  if (raw === null) {
    return null;
  }
  return _decodeStoredThread(raw);
}

/** The entry as `userId` may resume it: an anonymous entry belongs to
 *  whoever holds the browser, an identified one only to the user it was
 *  written for. An identified entry without a user is nobody's. */
export function readStoredThreadFor(
  publishableKey: string,
  userId: string | undefined,
): StoredThread | null {
  const stored = readStoredThread(publishableKey);
  if (!stored?.identified) {
    return stored;
  }
  return userId !== undefined && stored.userId === userId ? stored : null;
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
    typeof value.identified === "boolean" &&
    (!("userId" in value) ||
      value.userId === undefined ||
      typeof value.userId === "string")
  );
}
