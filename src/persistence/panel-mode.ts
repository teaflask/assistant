// The drawer's dock preference, one localStorage value per publishable
// key: "sidebar" opts into the pushed-aside page, anything else is the
// floating default — intrusiveness is opt-in, so the read trusts nothing
// but the exact opt-in string. Deliberately NOT cleared by
// resetAssistant(): where the panel lives is a device preference and
// must survive a sign-out. A host-facing `panel-mode`
// attribute (default/override) was considered and deliberately not
// shipped — the mode is the end user's, not the host's.

export type PanelDock = "floating" | "sidebar";

type PanelModeListener = () => void;

const _listeners = new Set<PanelModeListener>();

export function readPanelMode(publishableKey: string): PanelDock {
  try {
    return _storage()?.getItem(_storageKeyFor(publishableKey)) === "sidebar"
      ? "sidebar"
      : "floating";
  } catch {
    return "floating";
  }
}

export function writePanelMode(publishableKey: string, mode: PanelDock): void {
  try {
    if (mode === "sidebar") {
      _storage()?.setItem(_storageKeyFor(publishableKey), "sidebar");
    } else {
      // The default needs no record; an absent key reads as floating.
      _storage()?.removeItem(_storageKeyFor(publishableKey));
    }
  } catch {
    // Quota or privacy-mode failures cost persistence, never the widget.
  }
  _notifyPanelModeChanged();
}

/**
 * Same-tab change signal, so every mounted reader agrees with the
 * switcher without a re-mount. Cross-tab sync is deliberately out of
 * scope: the mode is read fresh on every load.
 */
export function subscribePanelMode(listener: PanelModeListener): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

function _notifyPanelModeChanged(): void {
  // Notify a copy: a listener that unsubscribes mid-notify must not
  // starve the rest of this round's delivery.
  for (const listener of [..._listeners]) {
    listener();
  }
}

function _storageKeyFor(publishableKey: string): string {
  return `tf-assistant:${publishableKey}:panel-mode`;
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
