"use client";

import { Component, Suspense, type ErrorInfo, type ReactNode } from "react";

import { TfButton } from "./primitives/button.js";
import { useAssistantSession } from "./teaflask-assistant-provider.js";

// The wrapper every on-demand surface body mounts behind: the Suspense
// placeholder while its chunk arrives, and — the part that matters — an
// error boundary for when the chunk never does.
//
// A dynamic import can fail for the ordinary reasons (a visitor's
// network drops mid-fetch), and for one the script-tag distribution
// creates: that origin serves a single build, so a deploy deletes the
// previous build's chunks, and a returning visitor whose cached entry
// is a few minutes old asks for a chunk hash that no longer exists.
// Immutable chunk caching narrows this to a body the visitor had never
// opened before, but doesn't close it. React.lazy has no recovery of
// its own — an import rejection throws during render, and without a
// boundary above it the whole assistant unmounts, taking a working
// conversation down over one missing file.
//
// Retrying the import cannot help: the file is genuinely gone from the
// server, and a fresh entry is what knows the new hashes. So the
// fallback asks for a reload and lets the visitor choose. We never
// reload the page ourselves — this widget lives inside someone else's
// app, and a form half-filled elsewhere on the page is not ours to
// discard.

export function LazyBody({ children }: { children: ReactNode }) {
  const { reportError } = useAssistantSession();
  return (
    <LazyBodyBoundary onFailure={reportError}>
      <Suspense fallback={<BodyNotice>Loading…</BodyNotice>}>
        {children}
      </Suspense>
    </LazyBodyBoundary>
  );
}

function BodyNotice({ children }: { children: ReactNode }) {
  return (
    <div className="tf:flex tf:flex-1 tf:flex-col tf:items-center tf:justify-center tf:gap-3 tf:p-6 tf:text-center tf:text-tf-label tf:text-tf-muted-foreground">
      {children}
    </div>
  );
}

class LazyBodyBoundary extends Component<
  { children: ReactNode; onFailure: (error: Error) => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The host's observer hears it, and the console carries the stack
    // for whoever is actually debugging the page.
    this.props.onFailure(error);
    console.error(
      "[teaflask-assistant] A surface failed to load.",
      error,
      info.componentStack,
    );
  }

  render() {
    if (!this.state.failed) {
      return this.props.children;
    }
    return (
      <BodyNotice>
        <span>This part of the assistant didn&rsquo;t load.</span>
        <TfButton
          variant="ghost"
          onClick={() => {
            window.location.reload();
          }}
        >
          Reload the page
        </TfButton>
      </BodyNotice>
    );
  }
}
