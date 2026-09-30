// @vitest-environment jsdom
/** The standalone "Working…" headline: from the instant of send the
 * transcript claims liveness continuously — during the POST round trip
 * (no fold exists yet) and in the beat between a settled answer and the
 * next row — while never doubling a tail that already claims it (a
 * trailing run fold's own headline, or streaming prose). */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MessageList } from "../src/components/message-list";
import type { TranscriptRow } from "../src/core/transcript-rows";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
  ResizeObserverStub;

function userRow(key: string, text: string): TranscriptRow {
  return { kind: "user", key, text, attachments: [], optimistic: true };
}

function proseRow(key: string, text: string, streaming = false): TranscriptRow {
  return { kind: "assistant-text", key, text, streaming };
}

function toolRow(key: string): TranscriptRow {
  return {
    kind: "tool-call",
    key,
    toolCallId: key,
    toolName: "docs_search",
    state: "input-available",
    argsText: '{"query":"tea"}',
    offloaded: false,
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
});

function headline(): HTMLElement | null {
  return host.querySelector("[data-tf-working-headline]");
}

async function render(rows: readonly TranscriptRow[], live: boolean) {
  await act(async () => {
    root.render(<MessageList rows={rows} cards={[]} live={live} />);
    await Promise.resolve();
  });
}

describe("the standalone Working… headline", () => {
  it("claims liveness the instant of send — a live transcript whose tail is only the user echo", async () => {
    await render([userRow("optimistic-user-1", "Brew me something.")], true);
    const standalone = headline();
    expect(standalone).not.toBeNull();
    expect(standalone?.textContent).toContain("Working…");
    // The fold summary's shimmer primitive, not a fork (TVC-013's
    // family): the label carries the same motion treatment.
    expect(standalone?.querySelector("[data-tf-shimmer-text]")).not.toBeNull();
  });

  it("claims the beat after settled prose while the run is still live", async () => {
    await render(
      [userRow("u1", "Go."), proseRow("p1", "Here's part one.")],
      true,
    );
    expect(headline()).not.toBeNull();
  });

  it("yields to a trailing run fold — the fold's own headline claims liveness via turnLive", async () => {
    await render([userRow("u1", "Go."), toolRow("t1")], true);
    expect(headline()).toBeNull();
    // Exactly one live label on screen: the fold summary's own shimmered
    // headline (collapsed: the latest step's label).
    const summary = host.querySelector("[data-tf-activity-group] summary");
    expect(summary?.querySelector("[data-tf-shimmer-text]")).not.toBeNull();
    // The working fold is open by default, so its live label is the
    // expanded generic reading (TVC-010) — still exactly one live label.
    expect(summary?.textContent).toContain("Working…");
    expect(summary?.textContent).not.toContain("Worked for");
  });

  it("yields to streaming prose — visible motion already claims the tail", async () => {
    await render(
      [userRow("u1", "Go."), proseRow("p1", "Streaming now", true)],
      true,
    );
    expect(headline()).toBeNull();
  });

  it("disappears at settle — not live renders no headline anywhere", async () => {
    await render([userRow("u1", "Go."), proseRow("p1", "Done.")], false);
    expect(headline()).toBeNull();
  });
});
