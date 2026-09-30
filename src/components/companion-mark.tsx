"use client";

import { AgentIdentityMark } from "./agent-identity-mark.js";
import { useAssistantAppearance } from "./appearance-context.js";

// The one mark every companion stage shows — the corner perch and the
// drawer's welcome — at one size. Static: the stylesheet sizes the box
// and sets the node inside to 100% of it (the fill is the package's
// promise, not the host's). A host's node is host DOM and wears the
// data-tf-host-view marker so the package reset leaves it alone; the
// default flask stays package DOM under the reset, unmarked. The null
// branch is exact on purpose: the provider has already folded the
// declining values (undefined, null, either boolean) into null.
export function CompanionMark() {
  const { companionMark } = useAssistantAppearance();
  return (
    <span aria-hidden data-tf-companion-mark="">
      {companionMark === null ? (
        <AgentIdentityMark register="primary" size="fill" />
      ) : (
        <span data-tf-host-view="" className="tf:contents">
          {companionMark}
        </span>
      )}
    </span>
  );
}
