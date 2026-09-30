// @vitest-environment jsdom
/**
 * The sentinel law: the machine's vocabulary stays on the machine's side
 * of the seam. Strands writes model-facing control strings into cancelled
 * tool results (CONFIRMATION_FAILED:, DENIED:, the steering guide's "You
 * MUST follow this guidance immediately.") and exceptions arrive as
 * "Error: {type} - {msg}" — none of it is member-facing copy. This
 * renders the REAL row pipeline (recorder-seeded store → anchors →
 * transcriptRowsOf → MessageList) over the four wire shapes and asserts
 * the class of leak, not the four instances: no ALL_CAPS control token in
 * the rendered pane, plus the two shapes the regex cannot see. Rendered
 * textContent is the right probe precisely because the row's Disclosure
 * is a native <details> — collapsed panes stay in the DOM, so suppression
 * must be data-level, not CSS.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Message } from "@ag-ui/core";

import { MessageList } from "../src/components/message-list";
import { markerAnchorsOf } from "../src/core/connection-epoch";
import { transcriptRowsOf } from "../src/core/transcript-rows";
import { StreamResumeStore } from "../src/transport/stream-resume";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// MessageList's viewport (use-stick-to-bottom) observes element resizes;
// jsdom has no ResizeObserver, and this test only reads textContent.
class ResizeObserverStub {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
  ResizeObserverStub;

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

function toolCallMessage(
  id: string,
  toolCallId: string,
  name: string,
): Message {
  return {
    id,
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: toolCallId,
        type: "function",
        function: { name, arguments: '{"path":"/subscriptions"}' },
      },
    ],
  };
}

function toolResultMessage(toolCallId: string, content: string): Message {
  return { id: `${toolCallId}-result`, role: "tool", toolCallId, content };
}

// The four wire shapes, exactly as the mapper emits them: three
// cancel-origin results whose content is the model-facing sentinel, and
// one genuine failure whose error field is the mapper's human sentence
// while its content keeps the raw exception.
const DENIED_APPROVAL = "CONFIRMATION_FAILED: May I cancel the subscription?";
const INTERVENTION_DENIAL =
  "DENIED: This call needs a human's approval, and no one is attached to this background run to give it.";
const STEERING_GUIDE =
  "Tool call cancelled. Billing tools are off-limits today. " +
  "You MUST follow this guidance immediately.";
const RAW_EXCEPTION = "Error: ValueError - Invalid date";
const FAILURE_SENTENCE =
  "This tool ran into an unexpected error and didn't finish.";
// The fifth wire shape: the context offloader's replacement of an
// oversized result, verbatim per pinned strands-agents 1.52.0 — a
// model-facing size banner, retrieval guidance, a legitimate preview
// slice, and storage reference lines. The wire keeps it whole (the
// offloaded stamp rides beside it); the member surface must render none
// of the plumbing. A template change in a future strands pin stales this
// fixture, never the suppression — the row keys off the anchor, not the
// text.
const OFFLOADED_REPLACEMENT =
  "[Offloaded: 2 blocks, ~9,420 tokens]\n" +
  "Tool result was offloaded to external storage due to size.\n" +
  "Use the preview below if it answers your question.\n" +
  "If you need more detail, use retrieve_offloaded_content with a reference and:\n" +
  "  - pattern: regex or keyword to find matching lines with context\n" +
  "  - line_range: { start, end } to read a specific span of lines\n" +
  "Retrieve full content (omit pattern/line_range) as a last resort.\n\n" +
  "Steeping guide: sencha steeps at 70°C for one minute…\n\n" +
  "[Stored references:]\n" +
  "  mem_1_t5_0 (application/json, 41,203 bytes)";
const MESSAGES: Message[] = [
  { id: "u1", role: "user", content: "Cancel my subscription." },
  toolCallMessage("a1", "t1", "action__cancel-subscription"),
  toolResultMessage("t1", DENIED_APPROVAL),
  toolCallMessage("a2", "t2", "action__update-billing"),
  toolResultMessage("t2", INTERVENTION_DENIAL),
  toolCallMessage("a3", "t3", "action__close-account"),
  toolResultMessage("t3", STEERING_GUIDE),
  toolCallMessage("a4", "t4", "docs_search"),
  toolResultMessage("t4", RAW_EXCEPTION),
  toolCallMessage("a5", "t5", "read_page"),
  toolResultMessage("t5", OFFLOADED_REPLACEMENT),
];

function renderedTranscriptText(): string {
  const resume = new StreamResumeStore();
  // Seeded exactly as the connection epoch's recorders would from the
  // wire: cancelled stamps for the three cancel-origin results, the
  // error sentence for the failure. No approval receipt is seeded: the
  // meta-receipt rows were deleted, so the denial's member story
  // is the row's cancelled headline plus the approval card's own footer
  // note — a different pipeline than this transcript render.
  resume.recordToolCancel("t1");
  resume.recordToolCancel("t2");
  resume.recordToolCancel("t3");
  resume.recordToolError("t4", FAILURE_SENTENCE);
  resume.recordToolOffload("t5");

  const rows = transcriptRowsOf(MESSAGES, markerAnchorsOf(resume), false);
  act(() => {
    root.render(<MessageList rows={rows} cards={[]} />);
  });
  return host.textContent;
}

describe("the transcript sentinel law", () => {
  it("renders no machine sentinel from any of the four wire shapes", () => {
    const text = renderedTranscriptText();

    // The class: no ALL_CAPS control token reaches a rendered pane.
    expect(text).not.toMatch(/[A-Z_]{6,}:/);
    // The shapes the regex cannot see, pinned by name.
    expect(text).not.toContain("You MUST follow");
    expect(text).not.toContain("ValueError");
  });

  it("tells the member story instead: cancelled headlines and the failure sentence", () => {
    const text = renderedTranscriptText();

    expect(text).toContain("Didn't run action cancel subscription");
    expect(text).toContain("Didn't run action update billing");
    expect(text).toContain("Didn't run action close account");
    expect(text).toContain(FAILURE_SENTENCE);
  });

  it("renders none of an offloaded result's model-facing plumbing", () => {
    const text = renderedTranscriptText();

    // The three plumbing pins: guidance addressed to the model, the
    // retrieval tool's name, and the storage reference block. The
    // ALL_CAPS regex above cannot see any of them.
    expect(text).not.toContain("offloaded to external storage");
    expect(text).not.toContain("retrieve_offloaded_content");
    expect(text).not.toContain("[Stored references:]");
    // The legitimate preview body is suppressed with the scaffolding —
    // the two are interleaved in one wire string, and splitting them
    // would mean parsing SDK-internal copy (whether the full content
    // becomes retrievable is a separate decision).
    expect(text).not.toContain("Steeping guide");
  });

  it("tells the offloaded member story as a settled call without result plumbing", () => {
    const text = renderedTranscriptText();

    expect(text).toContain("Ran read page");
    expect(text).not.toContain("Result:");
    // The one member-facing sentence the offloaded settle keeps: the
    // assistant worked from a shortened preview. Honest words about the
    // run, never the offloader's model-facing replacement content.
    expect(text).toContain("worked from a shortened preview");
  });
});
