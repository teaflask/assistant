"use client";

// The message-level memory provenance footer: a quiet affordance under
// the assistant prose whose run caused one or more memory writes. The
// trigger coalesces the batch into one line ("Memory updated", counted
// past one write); the reveal lists each write's canned sentence and
// destination label.
//
// Audience decision, recorded where the rendering happens: this footer
// renders identically on the embedded widget (anonymous visitors) and the
// dashboard concierge, because the payload is end-user safe BY
// CONSTRUCTION at the producer — verified, not assumed. The backend's
// MemoryWritten record is deliberately content-free (memory_id + scope
// enum only; the serving side's memory store), the emitter interpolates
// nothing (the summary is always the module constant
// MEMORY_UPDATED_SUMMARY_SENTENCE at its single construction site, the
// assistant-turn activity), and the exact payload shape is pinned by the
// serving side's approval story so an accidental content leak fails CI.
// This component still narrows at its own layer (the serving pipeline has
// no marker sanitizer): it renders ONLY the narrowed summary sentence and
// a generic destination label — never the memory id, raw payloads,
// storage paths, or an uncapped token.

import { BrainIcon, ChevronDownIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { MemoryUpdated } from "../core/memory-provenance-anchors.js";
import { TfButton } from "./primitives/button.js";
import { cx } from "./primitives/cx.js";

/** The destination label: an open vocabulary rendered generically past
 *  the two known scopes — an unknown token never renders verbatim. */
function memoryScopeLabelOf(scope: string): string {
  if (scope === "user") {
    return "Your memory";
  }
  if (scope === "org") {
    return "Shared memory";
  }
  return "Memory";
}

/** The trigger's coalesced line: one quiet phrase however many writes
 *  the run made, counted only past one — and the number names its noun
 *  (the transcript's grammar: "3 results", "1 failed", never a bare
 *  count). */
function memoryFooterLabelOf(count: number): string {
  return count > 1
    ? `Memory updated · ${String(count)} notes`
    : "Memory updated";
}

export function MemoryUpdatedFooter({
  updates,
}: {
  updates: readonly MemoryUpdated[];
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Light dismissal by composedPath() — the script-tag distribution runs
  // in an open shadow root, where contains() would misjudge every
  // in-shadow press (the provider chip's rationale, verbatim). Escape
  // rides listeners on the trigger and panel (the roster card's idiom)
  // rather than a handler on the static wrapper.
  useEffect(() => {
    const panelElement = panelRef.current;
    const trigger = triggerRef.current;
    if (!open || panelElement === null) {
      return;
    }
    const closeUnlessInside = (event: Event) => {
      const path = event.composedPath();
      if (path.includes(panelElement)) {
        return;
      }
      if (trigger !== null && path.includes(trigger)) {
        return;
      }
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.stopPropagation();
      setOpen(false);
      trigger?.focus();
    };
    const doc = panelElement.ownerDocument;
    doc.addEventListener("pointerdown", closeUnlessInside);
    panelElement.addEventListener("keydown", closeOnEscape);
    trigger?.addEventListener("keydown", closeOnEscape);
    return () => {
      doc.removeEventListener("pointerdown", closeUnlessInside);
      panelElement.removeEventListener("keydown", closeOnEscape);
      trigger?.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (updates.length === 0) {
    return null;
  }

  return (
    <div data-tf-memory-footer="" className="tf:relative tf:mt-1 tf:w-fit">
      <TfButton
        ref={triggerRef}
        variant="bare"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className="tf:py-1 tf:text-xs tf:text-tf-muted-foreground tf:hover:text-tf-foreground"
        onClick={() => {
          setOpen((wasOpen) => !wasOpen);
        }}
      >
        <BrainIcon aria-hidden className="tf:size-3.5 tf:shrink-0" />
        <span>{memoryFooterLabelOf(updates.length)}</span>
        {/* The disclosure cue (design review): on the notices screen
            three muted lines share one voice and only this one does
            anything — the transcript's own chevron says so without
            raising it, and hover-color alone does not exist on touch. */}
        <ChevronDownIcon
          aria-hidden
          className={cx(
            "tf:size-3 tf:shrink-0 tf:transition-transform",
            !open && "tf:-rotate-90",
          )}
        />
      </TfButton>
      {open ? (
        // Opens UPWARD (bottom-full), away from the composer, so the
        // reveal can never cover its controls (TVC-120's posture). The
        // card is static provenance text, so a note — not a dialog: no
        // focus trap to manage, Escape and light dismissal close it.
        <div
          ref={panelRef}
          id={panelId}
          role="note"
          aria-label="Memory updates"
          data-tf-glass=""
          className="tf:absolute tf:bottom-full tf:start-0 tf:mb-1 tf:flex tf:w-72 tf:flex-col tf:rounded-2xl tf:border tf:p-2"
        >
          <ul className="tf:m-0 tf:flex tf:max-h-64 tf:list-none tf:flex-col tf:overflow-y-auto tf:ps-0">
            {updates.map((update) => (
              <li
                key={update.memoryId}
                data-tf-memory-entry=""
                className="tf:flex tf:flex-col tf:gap-0.5 tf:px-2 tf:py-1.5"
              >
                <span className="tf:text-tf-label tf:text-tf-foreground">
                  {update.summary}
                </span>
                <span className="tf:text-xs tf:text-tf-muted-foreground">
                  {memoryScopeLabelOf(update.scope)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
