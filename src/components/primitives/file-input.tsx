"use client";

import { forwardRef } from "react";
import type { ChangeEvent } from "react";

// The package's one file control: a visually hidden native input a
// visible button drives via ref (the shell ImageRow pattern). Hidden
// rather than styled — a native file control cannot wear the register,
// so the affordance is always a TfButton and this is its mechanism.
// forwardRef rather than ref-as-prop: the peer range admits React 18.3,
// where a function component receives no ref through props.

export const TfFileInput = forwardRef<
  HTMLInputElement,
  {
    accept?: string;
    multiple?: boolean;
    onPickFiles: (files: FileList | null) => void;
  }
>(function TfFileInput({ accept, multiple = false, onPickFiles }, ref) {
  return (
    <input
      ref={ref}
      type="file"
      accept={accept}
      multiple={multiple}
      className="tf:sr-only"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        onPickFiles(event.target.files);
        // Clearing lets the same file re-fire a change event.
        event.target.value = "";
      }}
    />
  );
});
