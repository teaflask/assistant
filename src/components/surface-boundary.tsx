"use client";

import {
  Component,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
} from "react";

import { useOptionalAssistantSession } from "./teaflask-assistant-provider.js";

// The surface boundary: every package surface renders behind one, so our
// bug never unmounts the HOST's tree. Three rules, all held — never
// swallow, never wrap, degrade to a cascade-independent card (not a
// blank; overlay mounts opt into "silent"). No reset API: recovery is a
// remount keyed on this element. Rationale: docs/surface-boundary.md.

export function SurfaceBoundary({
  surface,
  shelfItem = false,
  degrade = "card",
  onError,
  children,
}: {
  /** Which surface this protects — named in the console and carried on
   *  the fallback's data attribute. */
  surface: string;
  /** The ActivityShelf slot contract (docs/activity-shelf-slot-contract):
   *  a tenant's root must carry data-tf-shelf-item — when the boundary
   *  replaces a shelf tenant, the fallback card is the tenant. */
  shelfItem?: boolean;
  /** "card" (default) renders the flow-normal fallback; "silent" renders
   *  nothing — for overlay surfaces whose card would land as a stray
   *  in-flow block on the host page. Reporting is identical. */
  degrade?: "card" | "silent";
  /** Test/fixture seam; defaults to the session's reportError. */
  onError?: (error: Error) => void;
  children: ReactNode;
}) {
  // Tolerant read: the message list and composer also mount in fixtures
  // and tests with no provider above them — the boundary still degrades
  // and still names the surface, it just has no host observer to tell.
  const session = useOptionalAssistantSession();
  return (
    <SurfaceCatchBoundary
      surface={surface}
      shelfItem={shelfItem}
      degrade={degrade}
      onFailure={onError ?? session?.reportError}
    >
      {children}
    </SurfaceCatchBoundary>
  );
}

// The card's entire appearance, as literals: a fixed light alert card —
// white ground, near-black ink, hairline border — legible on ANY host
// surface, dark pages included. No var() anywhere: a custom property
// would re-attach the card to whichever tree it lands in.
const FALLBACK_CARD_STYLE: CSSProperties = {
  boxSizing: "border-box",
  display: "block",
  width: "100%",
  // px, never rem (scripts/rem-to-px.mjs is the repo's standing rule
  // for the same hazard): a host's html { font-size } must not resize
  // the one element that exists for the broken state. The matrix's
  // sixth arm asserts these under a shrunken host root font.
  maxWidth: "768px",
  margin: "8px auto",
  padding: "12px 16px",
  border: "1px solid rgba(0, 0, 0, 0.14)",
  borderRadius: "10px",
  background: "#ffffff",
  color: "#171717",
  font: '400 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  textAlign: "left",
};

class SurfaceCatchBoundary extends Component<
  {
    surface: string;
    shelfItem: boolean;
    degrade: "card" | "silent";
    onFailure: ((error: Error) => void) | undefined;
    children: ReactNode;
  },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Every call out of this boundary that host code can supply or
    // intercept is guarded, because a throw INSIDE componentDidCatch
    // re-raises to the next boundary up — none, at the chrome roots.
    // onFailure may throw ANY payload, null included, so a boolean flag
    // records it (never a value sentinel) and it rides to the console as
    // an argument, never stringified by us. Out of reach: a callback that
    // never returns. The enumeration: docs/surface-boundary.md.
    let observerThrew = false;
    let observerError: unknown;
    try {
      this.props.onFailure?.(error);
    } catch (thrown) {
      observerThrew = true;
      observerError = thrown;
    }
    try {
      console.error(
        `[teaflask-assistant] The ${this.props.surface} surface failed to render.`,
        error,
        info.componentStack,
      );
      if (observerThrew) {
        console.error(
          "[teaflask-assistant] The host onError observer itself threw while handling that failure.",
          observerError,
        );
      }
    } catch {
      // A throwing console interceptor costs the narration, never the
      // host's tree.
    }
  }

  render() {
    if (!this.state.failed) {
      return this.props.children;
    }
    if (this.props.degrade === "silent") {
      // The overlay surfaces' degradation: absence, exactly what a
      // closed palette or a yielded companion already renders. The
      // report above already fired.
      return null;
    }
    return (
      <div
        role="alert"
        data-tf-surface-fallback={this.props.surface}
        {...(this.props.shelfItem ? { "data-tf-shelf-item": "" } : {})}
        // The ruled exception: the degraded card must stay legible
        // precisely when the widget is broken, so inline literals — the
        // one mechanism no later stylesheet rule can out-cascade — carry
        // its whole appearance (tests-e2e/boundary.spec.ts).
        // eslint-disable-next-line react/forbid-dom-props -- see above
        style={FALLBACK_CARD_STYLE}
      >
        This part of the assistant hit an error.
      </div>
    );
  }
}
