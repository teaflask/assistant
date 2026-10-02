// @vitest-environment jsdom
// The image policy: a markdown image is a fetch with no click, so the
// transcript never mounts an <img> from markdown on any path that turns
// a reply into elements — the body, the paced streaming body, the
// transcript row, the activity rail's narration — whatever the scheme.
// The image becomes an inert link (http(s), a reader's choice) or its alt
// text; raw HTML stays the text it is; links isolate their opener.

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Components } from "react-markdown";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantTranscript } from "../src/components/assistant-transcript";
import { AssistantMarkdown } from "../src/components/markdown/assistant-markdown";
import { MarkdownBlocks } from "../src/components/markdown/memoized-blocks";
import { PacedAssistantMarkdown } from "../src/components/markdown/paced-assistant-markdown";
import { MessageList } from "../src/components/message-list";
import type { BlockTiming } from "../src/core/segment-timing";
import type { TranscriptRow } from "../src/core/transcript-rows";
import { ServingReplayStreamAgent } from "../src/transport/replay-stream-agent";

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
window.HTMLElement.prototype.scrollTo = () => undefined;

const REMOTE = "https://attacker.example/p.png?d=secret";

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
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function render(node: ReactNode): void {
  act(() => {
    root.render(node);
  });
}

async function renderSettled(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Nothing under the host may fetch: no image element of any kind, and
 *  no element carrying a `src` or `srcset` attribute. */
function expectNothingFetches(): void {
  expect(host.querySelectorAll("img, picture, source")).toHaveLength(0);
  expect(host.querySelectorAll("[src], [srcset]")).toHaveLength(0);
}

function expectLinksIsolateTheirOpener(): void {
  const links = [...host.querySelectorAll("[data-tf-markdown] a")];
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) {
    const rel = (link.getAttribute("rel") ?? "").split(/\s+/);
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
    expect(link.getAttribute("target")).toBe("_blank");
  }
}

function toolRow(key: string, timing: BlockTiming): TranscriptRow {
  return {
    kind: "tool-call",
    key,
    toolCallId: key,
    toolName: "docs_search",
    state: "output-available",
    argsText: '{"query":"tea"}',
    result: "One result",
    offloaded: false,
    timing,
  };
}

function firstInertImage(): HTMLElement {
  const image = host.querySelector<HTMLElement>("[data-tf-markdown-image]");
  if (image === null) {
    throw new Error("no inert image rendered");
  }
  return image;
}

function labelOf(image: Element): string | null | undefined {
  return image.querySelector("[data-tf-markdown-image-label]")?.textContent;
}

function inertImages(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>("[data-tf-markdown-image]")];
}

describe("the body never mounts an image", () => {
  it("an inline remote image becomes an inert link labelled by its alt text", () => {
    render(
      <AssistantMarkdown>{`Look: ![Steeping chart](${REMOTE})`}</AssistantMarkdown>,
    );
    expectNothingFetches();
    const image = firstInertImage();
    expect(image.tagName).toBe("A");
    expect(labelOf(image)).toBe("Steeping chart");
    expect(image.textContent).toBe("Image:\u00a0Steeping chart");
    expect(image.getAttribute("href")).toBe(REMOTE);
    expectLinksIsolateTheirOpener();
  });

  it("a reference-style image resolves to the same inert link; an unresolved one stays text", () => {
    // Blocks parse one at a time, so a definition resolves only inside
    // its own block (a quote here); a definition in another block leaves
    // the reference as the text it is. Neither fetches.
    render(
      <AssistantMarkdown>
        {`> See ![the chart][c].\n>\n> [c]: ${REMOTE} "Chart"\n\nAlso ![far][d].\n\n[d]: ${REMOTE}`}
      </AssistantMarkdown>,
    );
    expectNothingFetches();
    expect(inertImages()).toHaveLength(1);
    const image = firstInertImage();
    expect(image.tagName).toBe("A");
    expect(image.getAttribute("href")).toBe(REMOTE);
    expect(image.getAttribute("title")).toBe("Chart");
    expect(host.textContent).toContain("![far][d]");
  });

  it("an image inside a link stays a span: anchors never nest", () => {
    render(
      <AssistantMarkdown>{`[![badge](${REMOTE})](https://example.com/page)`}</AssistantMarkdown>,
    );
    expectNothingFetches();
    expect(host.querySelectorAll("a")).toHaveLength(1);
    const image = firstInertImage();
    expect(image.tagName).toBe("SPAN");
    expect(labelOf(image)).toBe("badge");
    expect(host.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com/page",
    );
  });

  it.each([
    ["data:", "data:image/png;base64,AAAA"],
    ["relative", "/logout?now"],
    ["protocol-relative", "//attacker.example/p.png"],
    ["javascript:", "javascript:alert(1)"],
  ])("a %s image is alt text with no link", (_kind, src) => {
    render(<AssistantMarkdown>{`![a thing](${src})`}</AssistantMarkdown>);
    expectNothingFetches();
    const image = firstInertImage();
    expect(image.tagName).toBe("SPAN");
    expect(image.hasAttribute("href")).toBe(false);
    expect(labelOf(image)).toBe("a thing");
  });

  it("an image with no alt text is labelled by its file name, else by an admission", () => {
    render(
      <AssistantMarkdown>{`![](${REMOTE})\n\n![](https://attacker.example/)`}</AssistantMarkdown>,
    );
    expectNothingFetches();
    expect(inertImages().map(labelOf)).toEqual(["p.png", "(no description)"]);
  });

  it("raw HTML images, pictures and srcset render as the text they are", () => {
    const raw =
      `<img src="${REMOTE}" srcset="${REMOTE} 2x">\n\n` +
      `<picture><source srcset="${REMOTE}"><img src="${REMOTE}"></picture>\n\n` +
      `| a | b |\n| --- | --- |\n| <img src="${REMOTE}"> | ![c](${REMOTE}) |`;
    render(<AssistantMarkdown>{raw}</AssistantMarkdown>);
    expectNothingFetches();
    expect(host.textContent).toContain(`<img src="${REMOTE}"`);
    expect(host.textContent).toContain("<picture>");
    expect(host.querySelector("td [data-tf-markdown-image]")?.tagName).toBe(
      "A",
    );
  });

  it("an autolinked image URL is a link, never an image", () => {
    render(<AssistantMarkdown>{`Plain ${REMOTE} here`}</AssistantMarkdown>);
    expectNothingFetches();
    expect(inertImages()).toHaveLength(0);
    expect(host.querySelector("a")?.getAttribute("href")).toBe(REMOTE);
    expectLinksIsolateTheirOpener();
  });

  it("images in list items and footnotes never mount", () => {
    render(
      <AssistantMarkdown>
        {`- one ![x](${REMOTE})\n- two\n\nNote[^1].\n\n[^1]: ![y](${REMOTE})`}
      </AssistantMarkdown>,
    );
    expectNothingFetches();
    expect(inertImages().length).toBeGreaterThanOrEqual(1);
  });

  it("a caller's own img override is ignored at the choke point", () => {
    const Hostile: Components["img"] = (props) => (
      <img src={props.src} alt={props.alt} />
    );
    const components: Partial<Components> = { img: Hostile };
    render(
      <div data-tf-markdown="">
        <MarkdownBlocks
          components={components}
        >{`![z](${REMOTE})`}</MarkdownBlocks>
      </div>,
    );
    expectNothingFetches();
    expect(inertImages()[0]?.tagName).toBe("A");
  });
});

describe("the paced streaming body", () => {
  const TEXT = `The chart shows it: ![Steeping chart](${REMOTE}) — steep two minutes.`;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "Date",
        "performance",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: false,
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
  });

  it("mounts no image while the text reveals nor once it settles", async () => {
    render(<PacedAssistantMarkdown text="The chart" streaming />);
    render(<PacedAssistantMarkdown text={TEXT} streaming />);
    for (let frame = 0; frame < 12; frame += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expectNothingFetches();
    }
    render(<PacedAssistantMarkdown text={TEXT} streaming={false} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expectNothingFetches();
    expect(inertImages()[0]?.getAttribute("href")).toBe(REMOTE);
    expectLinksIsolateTheirOpener();
  });
});

describe("the transcript surfaces", () => {
  it("an assistant prose row and the rail's narration mount no image", async () => {
    const rows: TranscriptRow[] = [
      toolRow("t-a", { startedAtMs: 10_000, settledAtMs: 20_000 }),
      {
        kind: "assistant-text",
        key: "p-mid",
        text: `Found it: ![Chart](${REMOTE})`,
        streaming: false,
      },
      toolRow("t-b", { startedAtMs: 30_000, settledAtMs: 40_000 }),
      {
        kind: "assistant-text",
        key: "p-final",
        text: `Done. ![Final](${REMOTE})`,
        streaming: false,
      },
    ];
    await renderSettled(<MessageList rows={rows} cards={[]} />);
    expectNothingFetches();
    const narration = host.querySelector(
      "[data-tf-activity-narration] [data-tf-markdown] [data-tf-markdown-image]",
    );
    if (narration === null) {
      throw new Error("no narration rendered");
    }
    expect(labelOf(narration)).toBe("Chart");
    expect(inertImages().map(labelOf)).toEqual(["Chart", "Final"]);
    expectLinksIsolateTheirOpener();
  });

  it("a streamed reply through the package transcript mounts no image", async () => {
    const frames = [
      { type: "RUN_STARTED", threadId: "th", runId: "r" },
      { type: "TEXT_MESSAGE_START", messageId: "m", role: "assistant" },
      {
        type: "TEXT_MESSAGE_CONTENT",
        messageId: "m",
        delta: `Here: ![Chart](${REMOTE}) and <img src="${REMOTE}">`,
      },
      { type: "TEXT_MESSAGE_END", messageId: "m" },
      { type: "RUN_FINISHED", threadId: "th", runId: "r" },
    ];
    const body = frames
      .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
      .join("");
    const agent = new ServingReplayStreamAgent({
      streamUrl:
        "https://api.example.test/serving/v1/assistant-threads/th/stream",
      streamThreadId: "th",
      authorizedFetch: () =>
        Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        ),
    });
    await renderSettled(
      <AssistantTranscript agent={agent} onStreamError={() => undefined} />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
    });
    expectNothingFetches();
    expect(host.textContent).toContain("Chart");
    expect(host.textContent).toContain(`<img src="${REMOTE}">`);
    expect(inertImages()[0]?.getAttribute("href")).toBe(REMOTE);
    expectLinksIsolateTheirOpener();
  });
});
