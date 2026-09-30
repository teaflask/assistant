"use client";

import type { ReactNode } from "react";

import { TfButton } from "./primitives/button.js";

export function NoticeBanner({
  children,
  hook,
}: {
  children: ReactNode;
  /** Optional data-tf hook, stamped on the banner's OWN box. Never wrap
   *  a banner in a display:contents element to carry a hook:
   *  a boxless element no-ops `filter`, so the
   *  roster-defocus blur (styles.css, [data-tf-conversation-body]
   *  children) left the wrapped banner crisp while its siblings
   *  receded. */
  hook?: string;
}) {
  return (
    <div role="alert" className="tf:border-b" {...(hook ? { [hook]: "" } : {})}>
      <div className="tf:mx-auto tf:flex tf:w-full tf:max-w-3xl tf:items-center tf:gap-2 tf:px-4 tf:py-2 tf:text-tf-label tf:text-tf-destructive">
        {children}
      </div>
    </div>
  );
}

/** The pending-decision gap's one spelling. Its own module so
 *  `./transcript-ui` can export it without dragging the conversation
 *  chrome into that entry's graph: the widget chrome and the dashboard
 *  playground both render it, and the fixture bench poses it over a
 *  populated transcript — the composition it actually ships in — rather
 *  than re-spelling the copy. */
export function PendingDecisionGapNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <NoticeBanner hook="data-tf-pending-decision-gap">
      The assistant is waiting on a request that couldn&apos;t be shown.
      <TfButton variant="ghost" onClick={onRetry}>
        Retry
      </TfButton>
    </NoticeBanner>
  );
}
