"use client";

// The drill-in seam: how a roster or tree row asks the conversation
// surface to open one subagent's own transcript. A context rather than a
// prop chain because the rows live deep inside the message list; the
// null default keeps bare-rendered rows (tests, hosts without the panel)
// honestly non-interactive.
//
// The caller hands its own element over as the opener focus returns to
// on close/dismiss — never inferred from document.activeElement, which
// lies twice: at a shadow boundary it retargets to the host element
// (the script-tag distribution mounts in an open shadow root), and
// Safari doesn't focus a clicked button at all.

import { createContext, useContext } from "react";

export interface SubagentDrillIn {
  open: (childSessionId: string, opener: HTMLElement | null) => void;
  /** Close any open drill-in — the arm a sibling preview surface (the
   *  count pill's roster) uses when it supersedes the preview:
   *  at most one child preview surface is open at a time, so the
   *  roster's defocus blur and the capacity-1 tail lease never contend
   *  with a preview nobody can reach. Focus returns to the opener
   *  exactly when the popover still holds it; focus already
   *  moved elsewhere stays where the reader put it. */
  dismiss: () => void;
  /** The child whose preview is open (null when none) — rows derive
   *  their aria-expanded from it, so the value changes on open/close by
   *  design. */
  openChildSessionId: string | null;
  /** The shared preview popover's DOM id — rows reference it via
   *  aria-controls while their child's preview is open. */
  previewId: string;
}

export const SubagentDrillInContext = createContext<SubagentDrillIn | null>(
  null,
);

export function useSubagentDrillIn(): SubagentDrillIn | null {
  return useContext(SubagentDrillInContext);
}
