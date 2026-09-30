"use client";

// The adopted register — assistant-ui `reasoning` as the visual reference:
// the model's native reasoning as a quiet collapsible line above the
// answer. While the reasoning streams the line reads "Thinking…" under
// the moving gradient and the body holds itself open so the thought reads
// as it arrives; once the answer starts it collapses to a static
// "Thought about it". No duration on the label: the run events carry no
// timestamps, and a client-side clock would lie on every replay.

import { LightbulbIcon } from "lucide-react";

import {
  REASONING_SETTLED_LABEL,
  REASONING_STREAMING_LABEL,
} from "../core/reasoning-copy.js";
import type { ReasoningRow as ReasoningRowModel } from "../core/transcript-rows.js";
import { Disclosure, DisclosureChevron } from "./primitives/disclosure.js";
import { ShimmerText } from "./streaming-states.js";

// One form only: every reasoning row lives on an activity rail (the
// grouping in use-transcript-folds.ts folds all reasoning into a group), so the
// rail geometry — leading state mark, gap-3, ps-7 body — IS the row.
export function ReasoningRow({ view }: { view: ReasoningRowModel }) {
  return (
    <Disclosure
      variant="bare"
      open={view.streaming || undefined}
      className="tf:w-full"
      summaryClassName="tf:flex tf:w-fit tf:items-center tf:gap-3 tf:py-1.5 tf:text-tf-label tf:text-tf-muted-foreground tf:hover:text-tf-foreground"
      bodyClassName="tf:ps-7 tf:pt-1 tf:pb-2"
      summary={
        <>
          <span
            // The reasoning mark: a distinct semantic row, deliberately
            // outside the tool icon vocabulary — dimmed while the
            // thought streams, settled ink after, never a universal
            // tick. State is worded for assistive tech; the label
            // alongside says it for everyone else.
            data-tf-reasoning-mark=""
            className={
              view.streaming
                ? "tf:grid tf:size-4 tf:shrink-0 tf:place-items-center tf:opacity-45"
                : "tf:grid tf:size-4 tf:shrink-0 tf:place-items-center"
            }
          >
            <LightbulbIcon aria-hidden className="tf:size-4" />
            <span className="tf:sr-only">
              {view.streaming ? "Thinking" : "Thought"}
            </span>
          </span>
          {view.streaming ? (
            <ShimmerText className="tf:leading-none">
              {REASONING_STREAMING_LABEL}
            </ShimmerText>
          ) : (
            <span className="tf:leading-none">{REASONING_SETTLED_LABEL}</span>
          )}
          <DisclosureChevron revealOnInteraction />
        </>
      }
    >
      <p className="tf:text-tf-label tf:whitespace-pre-wrap tf:text-tf-muted-foreground">
        {view.text}
      </p>
    </Disclosure>
  );
}
