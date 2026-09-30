// @vitest-environment jsdom
/**
 * Inline attachment images outlive their presigned URLs: the download
 * URL dies at a ~5-minute TTL while a widget stays open for hours. The
 * hook must re-mint as each URL expires (and retry a refresh that
 * blips), so a lazy <img> never holds an expired URL — while a mint
 * refused on first ask (a swept upload) stays the quiet chip fallback,
 * never a retry loop.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AttachmentChips } from "../src/components/attachment-chips";
import type { MintedDownloadUrl } from "../src/core/conversation-store";
import type { TurnAttachment } from "../src/contract/threads";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mintAttachmentDownloadUrl =
  vi.fn<(attachmentId: string) => Promise<MintedDownloadUrl>>();

// The identity must be render-stable: the hook's effect keys on the
// store, and a fresh object per render would re-mint on every paint.
const fakeSession = { store: { mintAttachmentDownloadUrl } };

vi.mock("../src/components/teaflask-assistant-provider", () => ({
  useOptionalAssistantSession: () => fakeSession,
}));

// The store's 300s server TTL minus its 30s margin.
const URL_LIFETIME_MS = 270_000;

function mintedUrl(url: string): MintedDownloadUrl {
  return { url, expiresAtMs: Date.now() + URL_LIFETIME_MS };
}

const IMAGE_ATTACHMENT: TurnAttachment = {
  id: "att-1",
  kind: "image",
  format: "image/png",
  filename: "kettle.png",
  byte_size: 2048,
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  mintAttachmentDownloadUrl.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  vi.useRealTimers();
});

async function renderChips(): Promise<void> {
  await act(async () => {
    root.render(<AttachmentChips attachments={[IMAGE_ATTACHMENT]} />);
    await Promise.resolve();
  });
}

function renderedImageUrl(): string | null {
  return host.querySelector("img")?.getAttribute("src") ?? null;
}

describe("useAttachmentUrl's TTL refresh", () => {
  it("re-mints the image URL when the previous one expires", async () => {
    mintAttachmentDownloadUrl
      .mockResolvedValueOnce(mintedUrl("https://bytes.test/first"))
      .mockResolvedValueOnce(mintedUrl("https://bytes.test/second"));
    await renderChips();
    expect(renderedImageUrl()).toBe("https://bytes.test/first");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(URL_LIFETIME_MS);
    });
    expect(mintAttachmentDownloadUrl).toHaveBeenCalledTimes(2);
    expect(renderedImageUrl()).toBe("https://bytes.test/second");
  });

  it("retries a refresh that blips instead of freezing the stale URL", async () => {
    mintAttachmentDownloadUrl
      .mockResolvedValueOnce(mintedUrl("https://bytes.test/first"))
      .mockRejectedValueOnce(new Error("blip"))
      .mockResolvedValueOnce(mintedUrl("https://bytes.test/healed"));
    await renderChips();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(URL_LIFETIME_MS);
    });
    expect(renderedImageUrl()).toBe("https://bytes.test/first");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(mintAttachmentDownloadUrl).toHaveBeenCalledTimes(3);
    expect(renderedImageUrl()).toBe("https://bytes.test/healed");
  });

  it("floors the refresh cadence when a short TTL puts the expiry in the past", async () => {
    // A served TTL at or under the store's 30s margin yields an already-
    // expired mint; the timer must slow to the floor, not spin at 0ms.
    mintAttachmentDownloadUrl.mockImplementation(() =>
      Promise.resolve({
        url: "https://bytes.test/short-lived",
        expiresAtMs: Date.now() - 1_000,
      }),
    );
    await renderChips();
    expect(mintAttachmentDownloadUrl).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    expect(mintAttachmentDownloadUrl).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mintAttachmentDownloadUrl).toHaveBeenCalledTimes(3);
  });

  it("keeps the chip fallback on a refused first mint, without retrying", async () => {
    mintAttachmentDownloadUrl.mockRejectedValue(new Error("swept"));
    await renderChips();
    expect(renderedImageUrl()).toBeNull();
    expect(host.textContent).toContain("kettle.png");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(URL_LIFETIME_MS * 4);
    });
    expect(mintAttachmentDownloadUrl).toHaveBeenCalledTimes(1);
  });
});
