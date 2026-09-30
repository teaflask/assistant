"use client";

import { CircleAlertIcon } from "lucide-react";

// The turn-level failure receipt — the ONE standalone receipt row left
// after the meta-receipt class was deleted: a turn that dies mid-way
// otherwise stops with no answer and no explanation. Its quiet
// siblings (the turn_voided stamp rows, the approval/decline settled
// statements, the resume divider) no longer render at all; their
// markers stay on the wire and in the store, but the transcript carries
// no narration for them. A member's own stop (turn_stopped) projects no
// row either; the paired quiet RUN_FINISHED — not any marker — is what
// closes a pause's cards and settles the composer.

// The turn-level terminal failure receipt: a turn that ended failed
// outside any single tool, rendered where the answer broke off —
// explicit and calm, never an assistant-voiced paragraph and never a
// detached banner. Deliberately distinct from an operation-level
// failure, which is an in-row pill on the affected tool row. The glyph
// shape plus the sentence are the non-colour signal; the sentence
// itself is the wire's reader-aware copy, so the row exposes exactly
// the safe detail the REST wire already serves. Zero motion — a failed
// turn never leaves anything spinning.
export function TurnFailedReceiptRows({
  receipts,
}: {
  receipts: readonly string[];
}) {
  return (
    <div className="tf:flex tf:flex-col tf:gap-1 tf:py-1">
      {receipts.map((receipt, index) => (
        <p
          key={`${receipt}-${String(index)}`}
          data-tf-turn-failed-receipt=""
          className="tf:flex tf:items-center tf:gap-2 tf:text-xs tf:text-tf-muted-foreground"
        >
          <CircleAlertIcon
            aria-hidden
            className="tf:size-3.5 tf:shrink-0 tf:text-tf-destructive"
          />
          <span className="tf:sr-only">Turn failed:</span>
          <span className="tf:min-w-0">{receipt}</span>
        </p>
      ))}
    </div>
  );
}
