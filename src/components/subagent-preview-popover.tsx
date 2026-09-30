"use client";

// The child-transcript preview's floating shell, extracted from the
// count pill so the inline delegation rows and the roster rows share
// ONE surface: the browser top layer, so real assistant hosts may keep
// their rounded, overflow-hidden shells without clipping the preview.
// Placement prefers the requested right side, then the left, then the
// larger vertical side on a narrow viewport.

import { useEffect, type ReactNode, type RefObject } from "react";

export function SubagentPreviewPopover({
  id,
  anchorRef,
  previewRef,
  label,
  children,
}: {
  id: string;
  /** The element the preview floats beside — the roster card, or the
   *  inline row's own drill-in button. */
  anchorRef: RefObject<HTMLElement | null>;
  previewRef: RefObject<HTMLDivElement | null>;
  label: string;
  children: ReactNode;
}) {
  useEffect(() => {
    const preview = previewRef.current;
    const anchor = anchorRef.current;
    if (preview === null || anchor === null) {
      return;
    }
    if (typeof preview.showPopover === "function") {
      preview.showPopover();
    }

    const view = preview.ownerDocument.defaultView;
    if (view === null) {
      return;
    }
    // Re-placement guards against a HIDDEN anchor: a delegation row
    // inside a <details> group that collapses while the preview is up
    // keeps a connected but boxless button, and placing against an
    // all-zeros rect lands the preview at the viewport's top-left
    // corner on the next scroll/resize tick. The INITIAL placement
    // stays unconditional — an anchor is visible at open by
    // construction (a boxless control cannot be activated), and jsdom's
    // layoutless world (every rect zero) keeps its opening path.
    let placedOnce = false;
    const place = () => {
      const anchorRect = anchor.getBoundingClientRect();
      if (placedOnce && anchorRect.width === 0 && anchorRect.height === 0) {
        // Keep the last good placement; the preview stays where the
        // reader left it until they dismiss it or the anchor returns.
        return;
      }
      placedOnce = true;
      const { left, top, width, height } = _previewPlacementOf(
        anchorRect,
        view.visualViewport?.width ?? view.innerWidth,
        view.visualViewport?.height ?? view.innerHeight,
      );
      preview.style.left = `${String(Math.round(left))}px`;
      preview.style.top = `${String(Math.round(top))}px`;
      preview.style.width = `${String(Math.round(width))}px`;
      preview.style.height = `${String(Math.round(height))}px`;
    };

    place();
    view.addEventListener("resize", place);
    view.addEventListener("scroll", place, true);
    view.visualViewport?.addEventListener("resize", place);
    view.visualViewport?.addEventListener("scroll", place);
    return () => {
      view.removeEventListener("resize", place);
      view.removeEventListener("scroll", place, true);
      view.visualViewport?.removeEventListener("resize", place);
      view.visualViewport?.removeEventListener("scroll", place);
      if (preview.matches(":popover-open")) {
        preview.hidePopover();
      }
    };
  }, [anchorRef, previewRef]);

  return (
    <div
      ref={previewRef}
      id={id}
      role="dialog"
      aria-label={`Conversation preview: ${label}`}
      popover="manual"
      tabIndex={-1}
      className="tf:fixed tf:m-0 tf:overflow-visible tf:border-0 tf:bg-transparent tf:p-0 tf:text-tf-foreground tf:focus-visible:outline-2 tf:focus-visible:outline-offset-2 tf:focus-visible:outline-tf-ring"
    >
      {/* The visual panel stays eight pixels from its anchor, but this
          transparent hit surface fills that gap. Without it, a slow
          pointer crossing from the roster into the child transcript
          briefly leaves every descendant and closes both menus. It is
          deliberately larger on every side because placement may flip
          right, left, above, or below at runtime. */}
      <span
        aria-hidden
        data-tf-subagent-preview-hover-bridge=""
        className="tf:pointer-events-auto tf:absolute tf:-inset-2"
      />
      <div className="tf:relative tf:h-full tf:w-full">{children}</div>
    </div>
  );
}

interface PreviewPlacement {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Beside the anchor on the right when it fits, else the left, else
 *  centered over it on whichever vertical side has room — always inside
 *  the viewport gutter. */
function _previewPlacementOf(
  anchorRect: DOMRect,
  viewportWidth: number,
  viewportHeight: number,
): PreviewPlacement {
  const gutter = 16;
  const gap = 8;
  const preferredSize = viewportWidth >= 768 ? 384 : 320;
  const width = Math.min(preferredSize, viewportWidth - gutter * 2);
  const height = Math.min(preferredSize, viewportHeight - gutter * 2);
  const roomRight = viewportWidth - anchorRect.right - gutter;
  const roomLeft = anchorRect.left - gutter;
  let left: number;
  let top: number;

  if (roomRight >= width + gap) {
    left = anchorRect.right + gap;
    top = Math.min(
      Math.max(anchorRect.top, gutter),
      viewportHeight - height - gutter,
    );
  } else if (roomLeft >= width + gap) {
    left = anchorRect.left - width - gap;
    top = Math.min(
      Math.max(anchorRect.top, gutter),
      viewportHeight - height - gutter,
    );
  } else {
    left = Math.min(
      Math.max(anchorRect.left + (anchorRect.width - width) / 2, gutter),
      viewportWidth - width - gutter,
    );
    const above = anchorRect.top - gap - height;
    const below = anchorRect.bottom + gap;
    top =
      above >= gutter
        ? above
        : below + height <= viewportHeight - gutter
          ? below
          : Math.max(gutter, viewportHeight - height - gutter);
  }
  return { left, top, width, height };
}
