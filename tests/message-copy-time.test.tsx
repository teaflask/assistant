// @vitest-environment jsdom
/** The message copy affordance and the user-bubble timestamp: both
 * message kinds carry the package's ONE copy button (hover/focus-revealed,
 * verbatim payload), and a user bubble carries its turn's created_at in
 * the conversational register — never a client clock, never a stamp on an
 * optimistic echo whose turn hasn't landed. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MessageList } from "../src/components/message-list";
import { UserMessage } from "../src/components/user-message";
import { conversationalTimeOf } from "../src/core/time-labels";
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

const A_STAMP = "2026-09-07T19:19:00Z";

let host: HTMLDivElement;
let root: Root;
let copied: string[];

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  copied = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) => {
        copied.push(text);
        return Promise.resolve();
      },
    },
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  vi.useRealTimers();
});

function copyButton(scope: ParentNode = host): HTMLButtonElement | null {
  return (
    [...scope.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      ["Copy message", "Copied"].includes(
        button.getAttribute("aria-label") ?? "",
      ),
    ) ?? null
  );
}

describe("the user bubble's timestamp", () => {
  it("renders the turn's created_at as a <time> — machine-readable datetime, conversational label, full title", () => {
    act(() => {
      root.render(<UserMessage createdAt={A_STAMP}>Hello.</UserMessage>);
    });
    const time = host.querySelector("time");
    expect(time).not.toBeNull();
    expect(time?.getAttribute("datetime")).toBe(A_STAMP);
    const expected = conversationalTimeOf(A_STAMP);
    expect(time?.textContent).toBe(expected?.label);
    expect(time?.getAttribute("title")).toBe(expected?.full);
  });

  it("renders the ticket's reference form inside the recent window and the dated form outside it (r2 finding 4)", () => {
    // Stamps derived from the REAL clock so the window classification is
    // stable however long this suite lives: one hour ago is always
    // recent, thirty days ago never is.
    const recentIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    act(() => {
      root.render(<UserMessage createdAt={recentIso}>Hello.</UserMessage>);
    });
    // The conversational register, not a log line: weekday + local time.
    expect(host.querySelector("time")?.textContent).toMatch(
      /^[A-Z][a-z]+day\s/,
    );
    const oldIso = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    act(() => {
      root.render(<UserMessage createdAt={oldIso}>Hello.</UserMessage>);
    });
    const dated = host.querySelector("time")?.textContent ?? "";
    // The dated register: a month token, never a bare weekday that would
    // read as this past week.
    expect(dated).not.toMatch(/^[A-Z][a-z]+day\s/);
    expect(dated).toMatch(/^[A-Z][a-z]{2} \d{1,2}/);
  });

  it("renders no <time> for an unparsable stamp — nothing, never NaN", () => {
    act(() => {
      root.render(<UserMessage createdAt="not-a-date">Hello.</UserMessage>);
    });
    expect(host.querySelector("time")).toBeNull();
    // The copy affordance is independent of the stamp.
    expect(copyButton()).not.toBeNull();
  });

  it("renders no <time> on an optimistic echo — its turn hasn't landed, and no client clock fills in", () => {
    const echo: TranscriptRow = {
      kind: "user",
      key: "optimistic-user-1",
      text: "Just sent.",
      attachments: [],
      optimistic: true,
    };
    act(() => {
      root.render(<MessageList rows={[echo]} cards={[]} />);
    });
    expect(host.querySelector("time")).toBeNull();
  });

  it("renders no meta row at all for an attachment-only message — no text to copy, no bubble to stamp", () => {
    act(() => {
      root.render(
        <UserMessage
          createdAt={A_STAMP}
          attachments={[
            {
              id: "att-1",
              kind: "image",
              format: "png",
              filename: "cat.png",
              byte_size: 72,
            },
          ]}
        >
          {""}
        </UserMessage>,
      );
    });
    expect(host.querySelector("time")).toBeNull();
    expect(copyButton()).toBeNull();
  });
});

describe("the copy affordance", () => {
  it("copies the user bubble's verbatim text and flashes Copied", async () => {
    vi.useFakeTimers();
    act(() => {
      root.render(
        <UserMessage createdAt={A_STAMP}>{"line one\nline two"}</UserMessage>,
      );
    });
    const button = copyButton();
    expect(button?.getAttribute("aria-label")).toBe("Copy message");
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
    expect(copied).toEqual(["line one\nline two"]);
    expect(copyButton()?.getAttribute("aria-label")).toBe("Copied");
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(copyButton()?.getAttribute("aria-label")).toBe("Copy message");
  });

  it("copies an assistant message's RAW markdown source, verbatim", async () => {
    const markdown = "Steep at **80°C** for `2:00`.";
    const prose: TranscriptRow = {
      kind: "assistant-text",
      key: "p1",
      text: markdown,
      streaming: false,
    };
    act(() => {
      root.render(<MessageList rows={[prose]} cards={[]} />);
    });
    const button = copyButton();
    expect(button).not.toBeNull();
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
    expect(copied).toEqual([markdown]);
  });

  it("withholds the assistant copy row while the prose streams — the paced reveal shows a prefix", () => {
    const prose: TranscriptRow = {
      kind: "assistant-text",
      key: "p1",
      text: "Still arriving…",
      streaming: true,
    };
    act(() => {
      root.render(<MessageList rows={[prose]} cards={[]} live />);
    });
    expect(copyButton()).toBeNull();
  });

  it("reveals quietly: opacity-0 at rest with the hover/focus/coarse reveal variants, inside a reserved row", () => {
    act(() => {
      root.render(<UserMessage createdAt={A_STAMP}>Hello.</UserMessage>);
    });
    const button = copyButton();
    const classes = button?.getAttribute("class") ?? "";
    expect(classes).toContain("tf:opacity-0");
    expect(classes).toContain("tf:group-hover/user-message:opacity-100");
    expect(classes).toContain("tf:group-focus-within/user-message:opacity-100");
    expect(classes).toContain("tf:pointer-coarse:opacity-100");
    // The reserved row: revealing the button must not shift the bubble.
    expect(button?.closest(".tf\\:h-7")).not.toBeNull();
  });

  it("reveals the stamp on the same trigger as the button — one meta row, one reveal", () => {
    // The stamp used to be always-visible beside a revealed button, which
    // read as two registers in one row. It now rides the same idiom; if
    // the two ever diverge again, they should diverge on purpose.
    act(() => {
      root.render(<UserMessage createdAt={A_STAMP}>Hello.</UserMessage>);
    });
    const stamp = host.querySelector("time");
    const classes = stamp?.getAttribute("class") ?? "";
    expect(classes).toContain("tf:opacity-0");
    expect(classes).toContain("tf:group-hover/user-message:opacity-100");
    expect(classes).toContain("tf:group-focus-within/user-message:opacity-100");
    expect(classes).toContain("tf:pointer-coarse:opacity-100");
    // Same reserved row as the button, so neither reveal shifts the bubble.
    expect(stamp?.closest(".tf\\:h-7")).toBe(
      copyButton()?.closest(".tf\\:h-7"),
    );
  });
});
