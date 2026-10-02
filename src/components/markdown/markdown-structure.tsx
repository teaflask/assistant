"use client";

import {
  createContext,
  isValidElement,
  useContext,
  type ComponentType,
  type ReactNode,
} from "react";
import type { Components } from "react-markdown";

// The structural half of the markdown component map: react-markdown
// hands typography to styles.css (the [data-tf-markdown-*] blocks); the
// map carries only what needs structure or attributes — the code block,
// the link policy and the image policy. Raw HTML deliberately stays
// inert: react-markdown never parses it without a rehype pass, so hostile
// markup in retrieved content renders as the text it is.

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
// navigating its host tab loses the thread. noopener noreferrer isolates
// the opener and withholds the referrer on every host. The context tells
// an image nested in the link to stay a span: anchors never nest.
const InsideLinkContext = createContext(false);

export function TranscriptLink({
  href,
  children,
}: {
  href?: string;
  children?: ReactNode;
}) {
  return (
    <InsideLinkContext.Provider value={true}>
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    </InsideLinkContext.Provider>
  );
}

const HTTP_URL = /^https?:\/\//i;
const MAX_FILENAME_LABEL = 60;

function _filenameOf(src: string | undefined): string {
  if (src === undefined || /^data:/i.test(src)) {
    return "";
  }
  try {
    const path = new URL(src, "https://placeholder.invalid").pathname;
    return decodeURIComponent(path.split("/").filter(Boolean).at(-1) ?? "");
  } catch {
    return "";
  }
}

/** What stands in for the picture: the alt text, else the URL's file
 *  name, else a plain admission. */
function _imageLabelOf(
  alt: string | undefined,
  src: string | undefined,
): string {
  const described = alt?.trim() ?? "";
  if (described !== "") {
    return described;
  }
  const filename = _filenameOf(src);
  return filename === ""
    ? "(no description)"
    : filename.slice(0, MAX_FILENAME_LABEL);
}

// A markdown image is an instruction to fetch a URL with no click, so a
// reply that an injected prompt steered could post what the agent saw to
// any host the moment it renders. The transcript therefore never mounts
// an <img> from markdown, whatever the scheme: the image becomes an inert
// link the reader may choose to open (http(s) only), or its label. The
// "Image:" marker is DOM text, so it survives copying and names the
// element for assistive technology; the no-break space keeps it on the
// label's line.
export function TranscriptImage({
  src,
  alt,
  title,
}: {
  src?: string;
  alt?: string;
  title?: string;
}) {
  const insideLink = useContext(InsideLinkContext);
  const body = (
    <>
      <span data-tf-markdown-image-marker="">{"Image:\u00a0"}</span>
      <span data-tf-markdown-image-label="">{_imageLabelOf(alt, src)}</span>
    </>
  );
  if (insideLink || src === undefined || !HTTP_URL.test(src)) {
    return (
      <span data-tf-markdown-image="" title={title}>
        {body}
      </span>
    );
  }
  return (
    <a
      data-tf-markdown-image=""
      href={src}
      title={title}
      target="_blank"
      rel="noopener noreferrer"
    >
      {body}
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
