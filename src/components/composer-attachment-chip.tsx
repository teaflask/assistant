"use client";

import type { ServedAttachmentPolicy } from "../contract/assistant-config.js";
import {
  attachmentDraftFailed,
  type AttachmentDraft,
} from "../core/composer-policy.js";
import { humanFileSize } from "./human-file-size.js";
import { CloseIcon, FileIcon } from "./icons.js";
import { TfButton } from "./primitives/button.js";

// One drafted attachment in the slab: name and size while it uploads,
// the failure sentence when it refuses — either way the × removes it.
export function ComposerAttachmentChip({
  item,
  onRemove,
}: {
  item: AttachmentDraft;
  onRemove: () => void;
}) {
  const failed = attachmentDraftFailed(item);
  return (
    <span
      className={
        "tf:inline-flex tf:max-w-full tf:items-center tf:gap-1.5 tf:rounded-lg " +
        "tf:bg-tf-background tf:py-0.5 tf:ps-2 tf:pe-0.5 tf:text-xs tf:ring-1 tf:ring-tf-border tf:ring-inset " +
        (failed ? "tf:text-tf-destructive" : "tf:text-tf-foreground")
      }
      title={failed ? item.error : item.filename}
    >
      <span
        className={
          failed ? "tf:text-tf-destructive" : "tf:text-tf-muted-foreground"
        }
      >
        <FileIcon />
      </span>
      <span className="tf:min-w-0 tf:truncate">{item.filename}</span>
      <span className="tf:shrink-0 tf:text-tf-muted-foreground">
        {item.status === "uploading" ? (
          // Live work on a settled chip: the pulse is the sanctioned
          // "still going" idiom — a static label reads as hung over a
          // minutes-long upload.
          <span className="tf:animate-tf-pulse tf:motion-reduce:animate-none">
            uploading…
          </span>
        ) : failed ? (
          (item.error ?? "failed")
        ) : (
          humanFileSize(item.byteSize)
        )}
      </span>
      <TfButton
        variant="icon"
        onClick={onRemove}
        aria-label={`Remove ${item.filename}`}
      >
        <CloseIcon />
      </TfButton>
    </span>
  );
}

// The picker's accept list, derived from the released kinds. A released
// generic-file kind means anything goes — no accept at all; otherwise
// each kind contributes its family.
export function attachmentAcceptOf(
  policy: ServedAttachmentPolicy,
): string | undefined {
  const kinds = policy.kinds;
  if (kinds.includes("file")) {
    return undefined;
  }
  const families: string[] = [];
  if (kinds.includes("image")) {
    families.push("image/png,image/jpeg,image/gif,image/webp");
  }
  if (kinds.includes("document")) {
    families.push(".pdf,.txt,.md,.csv,.html,application/pdf,text/plain");
  }
  if (kinds.includes("video")) {
    families.push("video/*");
  }
  if (kinds.includes("audio")) {
    families.push("audio/*");
  }
  return families.join(",");
}
