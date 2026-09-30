// The TeaFlask agent identity mark (law 10): ONE canonical mark
// component for the primary agent and its subagents, so no surface ever
// borrows a mascot or a provider logo. The flask geometry is the brand
// SVG the marketing site ships (the dashboard's logo component is its
// copy of the same pair) — the package cannot import the dashboard's
// tree, so the two rects are minted here from that source.
//
// Subagents use the real filled TeaFlask geometry. A replay-stable
// dispatch index selects a color, echoing the reference UI's colored
// coworker avatars without borrowing its ghost mascot. Color is an
// identity channel here, never a status channel; the accessible name
// remains textual and the index is intentionally not painted as a badge.
//
// data-tf-agent-mark carries the register (TVC-092 reads it); the
// identity TOKEN hooks (data-tf-agent-identity / data-tf-subagent-
// identity, TVC-090/091) stay on the surfaces that mint them — this
// component is the visible treatment, not a second token spelling.

import { cx } from "./primitives/cx.js";
import { useId } from "react";

export type AgentIdentityRegister = "primary" | "subagent";

const SUBAGENT_GRADIENTS = [
  ["oklch(83.7% 0.128 66.29)", "oklch(64.6% 0.222 41.116)"],
  ["oklch(90.5% 0.182 98.111)", "oklch(68.1% 0.162 75.834)"],
  ["oklch(87.1% 0.15 154.449)", "oklch(62.7% 0.194 149.214)"],
  ["oklch(82.8% 0.111 230.318)", "oklch(58.8% 0.158 241.966)"],
  ["oklch(78.5% 0.115 274.713)", "oklch(51.1% 0.262 276.966)"],
  ["oklch(81.1% 0.111 293.571)", "oklch(54.1% 0.281 293.009)"],
  ["oklch(82.3% 0.12 346.018)", "oklch(59.2% 0.249 0.584)"],
  ["oklch(80.8% 0.114 19.571)", "oklch(57.7% 0.245 27.325)"],
] as const;

export function AgentIdentityMark({
  register,
  variantIndex,
  size = "sm",
  className,
}: {
  register: AgentIdentityRegister;
  /** The coworker's deterministic 1-based palette index (subagent
   *  register only) — absent metadata uses the neutral aggregate mark. */
  variantIndex?: number;
  /** `fill` takes the parent's box — the companion mark's stages size
   *  their own box and the flask fills it. */
  size?: "sm" | "md" | "fill";
  className?: string;
}) {
  const subagent = register === "subagent";
  const gradientId = `tf-agent-${useId().replace(/:/g, "")}`;
  // The palette is the identity channel (the visual spec's Agent Identity
  // Exception), and identity needs a coworker: with no variantIndex there
  // is nothing to encode, so the aggregate mark (the count-pill trigger,
  // the group header) paints currentColor and stays theme- and
  // surface-adaptive — the pill's muted ink, a failed row's destructive
  // tint — instead of pinning a gray pair that ignores both.
  const gradient =
    subagent && variantIndex !== undefined
      ? SUBAGENT_GRADIENTS[(variantIndex - 1) % SUBAGENT_GRADIENTS.length]
      : null;
  return (
    <span
      data-tf-agent-mark={register}
      data-tf-agent-variant={subagent ? variantIndex : undefined}
      className={cx(
        "tf:flex tf:shrink-0 tf:items-center",
        // A percentage-sized svg inside a fit-content parent collapses,
        // so fill widens the wrapper to the box instead of to the glyph.
        size === "fill" ? "tf:size-full tf:justify-center" : "tf:w-fit",
        className,
      )}
    >
      <svg
        viewBox="0 0 172 172"
        aria-hidden="true"
        className={cx(
          "tf:shrink-0",
          size === "fill"
            ? "tf:size-full"
            : size === "sm"
              ? "tf:size-3.5"
              : "tf:size-4",
        )}
      >
        {gradient !== null ? (
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <stop stopColor={gradient[0]} />
              <stop offset="1" stopColor={gradient[1]} />
            </linearGradient>
          </defs>
        ) : null}
        <rect
          x="52"
          y="0"
          width="68"
          height="36"
          rx="14"
          fill={gradient !== null ? `url(#${gradientId})` : "currentColor"}
        />
        <rect
          x="36"
          y="52"
          width="100"
          height="120"
          rx="31"
          fill={gradient !== null ? `url(#${gradientId})` : "currentColor"}
        />
      </svg>
      <span className="tf:sr-only">
        {subagent
          ? variantIndex !== undefined
            ? `Subagent ${String(variantIndex)}`
            : "Subagent"
          : "TeaFlask"}
      </span>
    </span>
  );
}
