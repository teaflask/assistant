"use client";

// The streamed assistant text body, whole: the paced RAW prefix goes
// through the streaming repair and only then parses, so partial syntax
// stays the repair layer's job — and a settled row renders its text
// verbatim. Only text paces; anything else a transcript shows (tool
// rows, approval cards, receipts) must land the instant it arrives,
// which is why this component exists at the leaf and not around the row
// list. While the buffer is non-empty the tail block re-parses per
// frame instead of per poll; MemoizedBlock confines that to the last
// block.

import { usePacedReveal } from "./use-paced-reveal.js";
import { repairedStreamingMarkdown } from "./streaming-repair.js";
import { AssistantMarkdown } from "./assistant-markdown.js";

export function PacedAssistantMarkdown({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const { revealed, revealHostRef } = usePacedReveal(text, streaming);
  const settled = !streaming && revealed === text;
  return (
    <div ref={revealHostRef} className="tf:min-w-0">
      <AssistantMarkdown>
        {settled ? text : repairedStreamingMarkdown(revealed)}
      </AssistantMarkdown>
    </div>
  );
}
