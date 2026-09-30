"use client";

import { isValidElement, type ComponentType, type ReactNode } from "react";
import type { Components } from "react-markdown";

// The structural half of the markdown component map, shared by both
// bake-off variants: react-markdown hands typography to styles.css (the
// [data-tf-markdown-*] blocks); the map carries only what needs
// structure or attributes — the code block (each variant brings its own)
// and the link policy. Raw HTML deliberately stays inert: react-markdown
// never parses it without a rehype pass, so hostile markup in retrieved
// content renders as the text it is.

export interface CodeBlockProps {
  code: string;
  language: string | null;
}

/** The `pre` override for a variant's code block: react-markdown renders
 *  fenced code as <pre><code class="language-x">; this reads the code
 *  element's text and language and hands them to the variant instead of
 *  rendering the tree. */
export function preBlockFor(
  CodeBlock: ComponentType<CodeBlockProps>,
): Components["pre"] {
  return function PreBlock({ children }: { children?: ReactNode }) {
    const code = _codeElementOf(children);
    if (code === null) {
      return <pre>{children}</pre>;
    }
    return (
      <CodeBlock code={_textOf(code.children)} language={_languageOf(code)} />
    );
  };
}

// Links open beside the conversation, never over it: an embedded widget
// navigating its host tab loses the thread. noreferrer covers opener
// isolation for hosts that predate implicit rel=noopener.
export function TranscriptLink({
  href,
  children,
}: {
  href?: string;
  children?: ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

interface CodeElementProps {
  className?: string;
  children?: ReactNode;
}

function _codeElementOf(children: ReactNode): CodeElementProps | null {
  if (isValidElement<CodeElementProps>(children) && children.type === "code") {
    return children.props;
  }
  return null;
}

function _textOf(children: ReactNode): string {
  if (typeof children === "string") {
    return children.replace(/\n$/, "");
  }
  if (Array.isArray(children)) {
    return children.map(_textOf).join("").replace(/\n$/, "");
  }
  return "";
}

function _languageOf(code: CodeElementProps): string | null {
  const match = /language-([\w-]+)/.exec(code.className ?? "");
  return match === null ? null : match[1];
}
