"use client";

import { useState } from "react";

import { AgentIdentityMark } from "./agent-identity-mark.js";

// The script-tag route's companion mark: `companion-mark-src` as a
// decorative image, keeping the stance of the loader it replaced — a
// broken mark costs the mark, never the page. A 404, a CSP or ad-block
// refusal, or a URL that is not an image fires the img's error event:
// one readable console warning per source, then the package flask in
// its place. The flask is inline SVG and cannot fail to load, so there
// is no third state. Rendered inside the host-view marker either way;
// the flask carries no border or box metrics, so the reset it is exempt
// from there never touches it.
const warnedSources = new Set<string>();

export function CompanionMarkImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <AgentIdentityMark register="primary" size="fill" />;
  }
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      onError={() => {
        if (!warnedSources.has(src)) {
          warnedSources.add(src);
          console.warn(
            `[teaflask-assistant] companion-mark-src "${src}" did not load; showing the TeaFlask flask instead.`,
          );
        }
        setFailed(true);
      }}
    />
  );
}
