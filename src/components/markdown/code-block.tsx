"use client";

// The adopted register — bake-off 2026-07-30 (assistant-ui `markdown-text`'s code block): a
// header bar naming the language with an always-visible copy affordance,
// the code pane attached beneath — the block reads as a small tool.
// Adapted to the --tf-* contract and the package's primitives; visual
// decisions are assistant-ui's. The plain <pre> paints immediately;
// shiki's lazy chunk upgrades it in place (Graphite ink levels via the
// --shiki-* variables in styles.css).

import { CopyTextButton } from "../copy-text-button.js";
import { useHighlightedHtml } from "./use-highlighted-html.js";

export function CodeBlock({
  code,
  language,
}: {
  code: string;
  language: string | null;
}) {
  const highlighted = useHighlightedHtml(code, language);
  return (
    <div className="tf:my-3 tf:flex tf:w-full tf:flex-col tf:first:mt-0 tf:last:mb-0">
      <div className="tf:flex tf:items-center tf:justify-between tf:rounded-t-xl tf:border tf:border-b-0 tf:bg-tf-muted tf:px-3.5 tf:py-1">
        <span className="tf:text-xs tf:font-medium tf:text-tf-muted-foreground tf:lowercase">
          {language ?? "text"}
        </span>
        <CopyTextButton text={code} label="Copy code" />
      </div>
      {highlighted === null ? (
        <pre className="tf:overflow-x-auto tf:rounded-b-xl tf:border tf:p-3.5 tf:text-tf-label tf:leading-relaxed">
          <code className="tf:font-mono">{code}</code>
        </pre>
      ) : (
        <div
          data-tf-code-html=""
          className="tf:overflow-x-auto tf:rounded-b-xl tf:border tf:p-3.5 tf:font-mono tf:text-tf-label tf:leading-relaxed"
          // shiki's output: our own trusted pipeline — the code text is
          // tokenized into spans, never injected as markup.
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      )}
    </div>
  );
}
