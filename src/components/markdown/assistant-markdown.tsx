"use client";

// The adopted register — bake-off 2026-07-30 (assistant-ui `markdown-text`): the tighter
// conversational register — my-3 rhythm, muted list markers, table
// headers on a muted wash with rounded outer corners, code blocks
// wearing a language header. Typography lives in styles.css under
// [data-tf-markdown]; this map carries only structure (the code
// block and the link policy; the image policy rides MarkdownBlocks).

import type { Components } from "react-markdown";

import { CodeBlock } from "./code-block.js";
import { preBlockFor, TranscriptLink } from "./markdown-structure.js";
import { MarkdownBlocks } from "./memoized-blocks.js";

const COMPONENTS: Partial<Components> = {
  pre: preBlockFor(CodeBlock),
  a: TranscriptLink,
};

/** The assistant message body, assistant-ui register. */
export function AssistantMarkdown({ children }: { children: string }) {
  return (
    <div data-tf-markdown="" className="tf:min-w-0 tf:text-tf-body">
      <MarkdownBlocks components={COMPONENTS}>{children}</MarkdownBlocks>
    </div>
  );
}
