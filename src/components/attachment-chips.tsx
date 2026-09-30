"use client";

import { useEffect, useState } from "react";

import type { TurnAttachment } from "../contract/threads.js";
import { humanFileSize } from "./human-file-size.js";
import { FileIcon } from "./icons.js";
import { useOptionalAssistantSession } from "./teaflask-assistant-provider.js";

// A user message's attachments, the quiet register: images render inline
// (an inset hairline contains uncontrolled customer imagery on any
// ground — the org-logo law), everything else is a small muted chip
// naming the file. Bytes are a download-url exchange away: the id is
// stable, a URL is minted on mount and re-minted as it expires — a
// widget stays open far longer than a URL lives, and nothing persists.

export function AttachmentChips({
  attachments,
}: {
  attachments: readonly TurnAttachment[];
}) {
  if (attachments.length === 0) {
    return null;
  }
  return (
    <div className="tf:flex tf:flex-wrap tf:justify-end tf:gap-2">
      {attachments.map((attachment) =>
        attachment.kind === "image" ? (
          <AttachmentImage key={attachment.id} attachment={attachment} />
        ) : (
          <FileChip key={attachment.id} attachment={attachment} />
        ),
      )}
    </div>
  );
}

function AttachmentImage({ attachment }: { attachment: TurnAttachment }) {
  const url = useAttachmentUrl(attachment.id);
  if (url === null) {
    // The mint is in flight (or refused — a swept upload): the chip is
    // the truthful fallback either way, and the image swaps in if the
    // URL lands.
    return <FileChip attachment={attachment} />;
  }
  return (
    <img
      src={url}
      alt={attachment.filename}
      loading="lazy"
      className="tf:max-h-48 tf:max-w-full tf:rounded-lg tf:ring-1 tf:ring-tf-border tf:ring-inset"
    />
  );
}

function FileChip({ attachment }: { attachment: TurnAttachment }) {
  return (
    <span
      className={
        "tf:inline-flex tf:max-w-full tf:items-center tf:gap-1.5 tf:rounded-lg " +
        "tf:bg-tf-background tf:px-2.5 tf:py-1.5 tf:text-xs tf:text-tf-foreground " +
        "tf:ring-1 tf:ring-tf-border tf:ring-inset"
      }
      title={attachment.filename}
    >
      <span className="tf:text-tf-muted-foreground">
        <FileIcon />
      </span>
      <span className="tf:min-w-0 tf:truncate">{attachment.filename}</span>
      <span className="tf:shrink-0 tf:text-tf-muted-foreground">
        {humanFileSize(attachment.byte_size)}
      </span>
    </span>
  );
}

// The fastest the hook ever goes back to the mint endpoint: the retry
// delay after a blipped refresh, and the floor under the expiry timer —
// a served TTL at or under the store's safety margin puts the expiry in
// the past, which must slow the cadence, never become a tight loop.
const URL_REFRESH_FLOOR_MS = 30_000;

function useAttachmentUrl(attachmentId: string): string | null {
  const session = useOptionalAssistantSession();
  const store = session?.store ?? null;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (store === null) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const mintAndScheduleRefresh = (isRefresh: boolean) => {
      store.mintAttachmentDownloadUrl(attachmentId).then(
        (minted) => {
          if (cancelled) {
            return;
          }
          setUrl(minted.url);
          // The URL dies at its short TTL while this mount may live for
          // hours: re-mint as the expiry lands, so a lazy <img> that
          // fetches late never holds an expired URL.
          timer = setTimeout(
            () => {
              mintAndScheduleRefresh(true);
            },
            Math.max(URL_REFRESH_FLOOR_MS, minted.expiresAtMs - Date.now()),
          );
        },
        () => {
          if (cancelled) {
            return;
          }
          // A refused first mint (a swept upload) keeps the chip
          // fallback — decoration never surfaces an error. A refused
          // refresh is a blip on a URL that already worked: try again,
          // or the image freezes on an expired URL.
          if (isRefresh) {
            timer = setTimeout(() => {
              mintAndScheduleRefresh(true);
            }, URL_REFRESH_FLOOR_MS);
          }
        },
      );
    };
    mintAndScheduleRefresh(false);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [store, attachmentId]);
  return url;
}
