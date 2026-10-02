"use client";

import { marked } from "marked";
import { memo, useId, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { TranscriptImage } from "./markdown-structure.js";

// The streaming-markdown memoization spine (typography lives in
// styles.css; the caller passes only its structural component map). The
// lexer splits the document into top-level blocks so a streaming delta
// re-renders only the block still growing at the tail — every settled
// block is memoized on its raw text. The pattern is prompt-kit's
// `markdown` component.

function parseMarkdownIntoBlocks(markdown: string): string[] {
  return marked.lexer(markdown).map((token) => token.raw);
}

const MemoizedBlock = memo(
  function MarkdownBlock({
    content,
    components,
  }: {
    content: string;
    components: Partial<Components>;
  }) {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    );
  },
  (prev, next) =>
    prev.content === next.content && prev.components === next.components,
);

export interface MarkdownBlocksProps {
  children: string;
  components: Partial<Components>;
}

// Callers pass a MODULE-LEVEL components map — a fresh map per render
// would defeat every block's memo. The image policy is applied here, at
// the one place markdown becomes elements, over whatever map arrives: no
// caller can hand a reply's images back to the browser.
export function MarkdownBlocks({ children, components }: MarkdownBlocksProps) {
  const blockId = useId();
  const blocks = useMemo(() => parseMarkdownIntoBlocks(children), [children]);
  const guarded = useMemo(
    () => ({ ...components, img: TranscriptImage }),
    [components],
  );
  return (
    <>
      {blocks.map((block, index) => (
        <MemoizedBlock
          key={`${blockId}-${String(index)}`}
          content={block}
          components={guarded}
        />
      ))}
    </>
  );
}
