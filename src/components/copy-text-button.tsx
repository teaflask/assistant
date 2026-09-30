"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { TfButton } from "./primitives/button.js";

const COPIED_FLASH_MS = 2000;

/** The package's ONE copy-to-clipboard affordance — the quiet icon
 *  button, the 2s "Copied" flash, and the permission posture every copy
 *  surface shares: a host page without clipboard access simply never
 *  confirms (the reader can still select the text). Shared by the code
 *  block ("Copy code") and the generic fallback frame ("Copy result")
 *  so the flash-timer lifecycle and failure behaviour can never drift
 *  between them. Generalized from the code block's own button: with the
 *  same label the rendered DOM and accessible names are byte-identical
 *  to the original, so the code block's baselined pixels never moved.
 */
export function CopyTextButton({
  text,
  label,
  className,
}: {
  /** The verbatim text handed to the clipboard — always the wire's own
   *  bytes, never a derived summary. */
  text: string;
  /** The resting accessible name ("Copy code", "Copy result"); the
   *  confirmation flash always reads "Copied". */
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const flash = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (flash.current !== null) {
        clearTimeout(flash.current);
      }
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // A host page without clipboard permission: the affordance simply
      // does not confirm; the reader can still select the text.
      return;
    }
    setCopied(true);
    if (flash.current !== null) {
      clearTimeout(flash.current);
    }
    flash.current = setTimeout(() => {
      setCopied(false);
    }, COPIED_FLASH_MS);
  };

  return (
    <TfButton
      variant="icon"
      className={className}
      aria-label={copied ? "Copied" : label}
      onClick={() => {
        void copy();
      }}
    >
      {copied ? (
        <CheckIcon aria-hidden className="tf:size-3.5" />
      ) : (
        <CopyIcon aria-hidden className="tf:size-3.5" />
      )}
    </TfButton>
  );
}
