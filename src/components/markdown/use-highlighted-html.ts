"use client";

import { useEffect, useState } from "react";

import { highlightToHtml } from "./highlight.js";

interface HighlightedCode {
  key: string;
  html: string;
}

function keyOf(code: string, language: string): string {
  return `${language} ${code}`;
}

/** The async highlight upgrade both code-block variants ride: null until
 *  (unless) shiki's lazy chunk lands and knows the language — the caller
 *  renders its plain <pre> meanwhile, so a slow or absent chunk is never
 *  a blank block. The result is keyed to its input, so a content change
 *  falls back to plain instantly instead of flashing stale highlights. */
export function useHighlightedHtml(
  code: string,
  language: string | null,
): string | null {
  const [highlighted, setHighlighted] = useState<HighlightedCode | null>(null);
  useEffect(() => {
    if (language === null) {
      return;
    }
    let disposed = false;
    const key = keyOf(code, language);
    highlightToHtml(code, language).then(
      (html) => {
        if (!disposed && html !== null) {
          setHighlighted({ key, html });
        }
      },
      () => undefined,
    );
    return () => {
      disposed = true;
    };
  }, [code, language]);
  if (language === null || highlighted === null) {
    return null;
  }
  return highlighted.key === keyOf(code, language) ? highlighted.html : null;
}
