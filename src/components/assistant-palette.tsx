"use client";

import { lazy } from "react";

import { useAssistantAppearance } from "./appearance-context.js";
import { LazyBody } from "./lazy-body.js";
import { SurfaceBoundary } from "./surface-boundary.js";
import { TfDialog } from "./primitives/dialog.js";
import { useRegisterAssistantSurface } from "./use-register-assistant-surface.js";

// The body is code-split behind the first open, so mounting a closed
// palette on every page ships no transcript (the bundle discipline).
const AssistantPaletteBody = lazy(() => import("./assistant-palette-body.js"));

export interface AssistantPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The cmd-k overlay surface: the same conversation core as <AssistantPage/>
 * in a native-dialog shell — current/new thread only. Controlled: whoever
 * mounts it owns the trigger and open state; Esc and a backdrop click close
 * it from inside. Closing drops the live stream on purpose: reopening
 * remounts the transcript and the full replay-then-tail restores it exactly.
 * The export is the boundary; degrade="silent" because an in-flow fallback
 * card would land as a stray block on the host page.
 */
export function AssistantPalette(props: AssistantPaletteProps) {
  return (
    <SurfaceBoundary surface="palette" degrade="silent">
      <AssistantPaletteInner {...props} />
    </SurfaceBoundary>
  );
}

function AssistantPaletteInner({ open, onOpenChange }: AssistantPaletteProps) {
  // The provider's theme/mode props ride onto every data-tf-assistant root.
  const { rootProps } = useAssistantAppearance();
  // Announced only while open: the dialog root stays mounted while closed
  // (rendering nothing), and a closed palette must not read as an active surface.
  useRegisterAssistantSurface("transient", open);

  return (
    <TfDialog
      open={open}
      onOpenChange={onOpenChange}
      aria-label="Assistant"
      data-tf-assistant=""
      data-tf-glass=""
      // The height-capped-host hook: the panel is 36rem max with overflow
      // hidden, so styles.css sizes the decision scroll well under that cap
      // through this attribute (TVC-067 exercises the same rule).
      data-tf-assistant-palette=""
      {...rootProps}
      className={
        // Mobile: a near-full-screen sheet with a 4-step margin. Desktop: the
        // cmd-k idiom — top-anchored, centered, fixed height. The scrim is 20%,
        // not a classic 40%: the glass blurs its own backdrop; a heavy dim curdles it.
        "tf:m-auto tf:h-[calc(100dvh-2rem)] tf:w-[calc(100vw-2rem)] tf:flex-col " +
        "tf:overflow-hidden tf:rounded-tf tf:border " +
        "tf:text-tf-foreground tf:backdrop:bg-black/20 " +
        "tf:sm:mt-24 tf:sm:h-[calc(100dvh-12rem)] tf:sm:max-h-144 tf:sm:w-full tf:sm:max-w-2xl"
      }
    >
      {/* Mounted only while open (stream discipline — see the body module);
          LazyBody holds the panel's shape while the chunk arrives. */}
      {open ? (
        <LazyBody>
          <AssistantPaletteBody onOpenChange={onOpenChange} />
        </LazyBody>
      ) : null}
    </TfDialog>
  );
}
