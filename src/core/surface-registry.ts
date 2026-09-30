// The yield signal: a page-wide registry of mounted assistant chromes, so
// the always-present companion surface stands down automatically when a
// full surface is already showing — the customer never configures routes.
// Module-scoped, not React context: the companion and an <AssistantPage/>
// may live under different provider instances, and detection must cross
// the tree. The data-tf-assistant DOM attribute is no signal (a closed
// palette keeps its dialog root mounted); surfaces announce themselves
// here, the palette only while open. SSR-safe by construction: nothing
// touches window, registration happens only inside browser effects, so the
// server sees the frozen all-false snapshot. Never register at render time.

import { closeCompanionDrawer } from "./companion-drawer-flag.js";

export type AssistantSurfaceKind = "full-surface" | "transient";

export interface AssistantSurfacePresence {
  /** An AssistantPage-class chrome is mounted somewhere on the page. */
  readonly fullSurfaceMounted: boolean;
  /** A modal/transient chrome (the palette) is open somewhere. */
  readonly transientOpen: boolean;
}

const NO_SURFACES: AssistantSurfacePresence = Object.freeze({
  fullSurfaceMounted: false,
  transientOpen: false,
});

interface SurfaceToken {
  readonly kind: AssistantSurfaceKind;
}

/**
 * Tracks which chromes are announced and derives a presence snapshot — the
 * useSyncExternalStore subscribe/getSnapshot pair. The snapshot object is
 * replaced only when the derived booleans change, so no-op registrations
 * (a second page, StrictMode's double mount) neither swap nor notify.
 * Registrations are unique tokens, not per-kind flags, so any interleaving
 * of register/unregister resolves correctly.
 */
export class AssistantSurfaceRegistry {
  private readonly tokens = new Set<SurfaceToken>();
  private readonly listeners = new Set<() => void>();
  private snapshot: AssistantSurfacePresence = NO_SURFACES;

  /** Returns the matching unregister; calling it twice is a no-op. A
   *  full surface taking the floor also closes the companion drawer for
   *  good — leaving that surface by hand lands on the bare mark; a
   *  transient chrome (the palette) never touches the flag. */
  register(kind: AssistantSurfaceKind): () => void {
    if (kind === "full-surface") {
      closeCompanionDrawer();
    }
    const token: SurfaceToken = { kind };
    this.tokens.add(token);
    this._publishIfPresenceChanged();
    return () => {
      this.tokens.delete(token);
      this._publishIfPresenceChanged();
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): AssistantSurfacePresence {
    return this.snapshot;
  }

  private _publishIfPresenceChanged(): void {
    const next = this._derivePresence();
    if (
      next.fullSurfaceMounted === this.snapshot.fullSurfaceMounted &&
      next.transientOpen === this.snapshot.transientOpen
    ) {
      return;
    }
    this.snapshot = next;
    // Notify a copy: a listener that unsubscribes itself (or a sibling)
    // mid-notify must not starve the rest of this round's delivery.
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  private _derivePresence(): AssistantSurfacePresence {
    let fullSurfaceMounted = false;
    let transientOpen = false;
    for (const token of this.tokens) {
      if (token.kind === "full-surface") {
        fullSurfaceMounted = true;
      } else {
        transientOpen = true;
      }
    }
    return { fullSurfaceMounted, transientOpen };
  }
}

export const assistantSurfaceRegistry = new AssistantSurfaceRegistry();
