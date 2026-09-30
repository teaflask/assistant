"use client";

import { Component, type ReactNode } from "react";

import { hostFillDeclines } from "../core/host-fill.js";
import { useOptionalAssistantSession } from "./teaflask-assistant-provider.js";

// The host-slot isolation wrapper: every host-supplied slot on
// AssistantTranscript EXCEPT `input` mounts inside one of these (the
// input-region rule — that slot is deliberately unbounded), so a throwing
// fill costs its own slot and nothing else. Two laws by construction: the
// FALLBACK is the package's own rendering, rendered by this boundary and
// never as a sibling inside the children (mandatory frame elements render
// OUTSIDE it at the call site), so a broken fill cannot take the default
// with it; and a slot that threw is latched for that mount — a new row's key gets a fresh boundary.

export function HostSlotBoundary({
  slot,
  fallback,
  children,
}: {
  /** Which slot this isolates — names the failure in the console line. */
  slot: string;
  fallback: ReactNode;
  children: ReactNode;
}) {
  // Tolerant on purpose: agent-mode hosts (the run viewer, the playground)
  // mount with no session provider; the console line is the report there.
  const session = useOptionalAssistantSession();
  return (
    <_SlotCatch
      slot={slot}
      fallback={fallback}
      reportError={session?.reportError}
    >
      {children}
    </_SlotCatch>
  );
}

class _SlotCatch extends Component<
  {
    slot: string;
    fallback: ReactNode;
    reportError: ((error: Error) => void) | undefined;
    children: ReactNode;
  },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    const shaped = error instanceof Error ? error : new Error(String(error));
    // The host's observer hears it, and the console names the slot for
    // whoever is actually debugging the page.
    this.props.reportError?.(shaped);
    console.error(
      `[teaflask-assistant] The host "${this.props.slot}" slot threw; the package rendering took over.`,
      shaped,
    );
  }

  render() {
    if (this.state.failed) {
      return <>{this.props.fallback}</>;
    }
    return <>{this.props.children}</>;
  }
}

/** The fill decision, made INSIDE the boundary: the render callback runs
 *  here so a synchronous throw is caught, and a null/undefined return
 *  falls through to the same package default the boundary would fall back
 *  to — one default, two routes to it.
 *
 *  THE KEYING LAW: frame behavior attached to a slot must key on the fill
 *  having ACTUALLY RENDERED, never on the prop having been supplied —
 *  both fallback routes land on the package default, which carries its
 *  own signals, and a prop-keyed extra would double them. The per-slot
 *  enumeration is in docs/transcript-surfaces.md, "The keying law". The
 *  toolRow annex (filledAnnex, the status word) weakens no isolation law:
 *  fill rendered → the annex, package-rendered and unreachable by the
 *  fill; null return or throw → the package ToolRow's own state pill. */
export function SlotOrDefault({
  render,
  fallback,
  filledAnnex,
}: {
  render: () => ReactNode;
  fallback: ReactNode;
  /** Package-owned content rendered beside the fill exactly when the
   *  fill rendered — never beside the fallback. */
  filledAnnex?: ReactNode;
}) {
  const filled = render();
  // THE FALL-THROUGH RULE (core/host-fill.ts): null, undefined and both
  // booleans decline; renderable emptiness is the host's deliberate
  // choice of empty content and counts as filled.
  if (hostFillDeclines(filled)) {
    return <>{fallback}</>;
  }
  return (
    <>
      {filled}
      {filledAnnex}
    </>
  );
}
