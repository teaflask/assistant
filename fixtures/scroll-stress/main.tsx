// The scroll-stress bench: the REAL MessageList over a message list that a
// driver grows step by step, shaped like the transcript in which the native
// scroll range froze (the transcript scrollbar stale-compositor-node
// record): reasoning that opens while streaming and closes on the next
// event, tool clusters whose results carry nested overflow panes, narration
// between clusters, then one long streamed answer. Nothing here is a
// contract scenario; the driver in run.mjs owns timing, and
// `window.__stress` is the only API. Like every fixture, this deep-imports
// src/** on purpose.

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import type { Message } from "@ag-ui/core";

import { MessageList } from "../../src/components/message-list";
import { transcriptRowsOf } from "../../src/core/transcript-rows";
import { EMPTY_ANCHORS, toolCallMessage } from "../transcript/scenarios";

interface StressState {
  messages: Message[];
  running: boolean;
}

interface PlayConfig {
  clusters: number;
  /** Steps per cluster, cycled: a short cluster and a rail-overflowing one. */
  stepsPerCluster: number[];
  stepDelayMs: number;
  proseChunks: number;
  chunkDelayMs: number;
  resultLines: number;
  /** Open each cluster's fold and its tool rows once the cluster settles
   *  (what a held-open, view-bearing fold does in the app), then collapse
   *  every disclosure at the turn boundary before the long answer streams —
   *  the live capture's shape: rows laid out open, display-locked closed,
   *  growth below. */
  openFoldsWhileLive: boolean;
}

const DEFAULT_PLAY: PlayConfig = {
  clusters: 8,
  stepsPerCluster: [4, 14],
  stepDelayMs: 70,
  proseChunks: 160,
  chunkDelayMs: 25,
  resultLines: 40,
  openFoldsWhileLive: true,
};

function setDetails(root: ParentNode, open: boolean): void {
  root.querySelectorAll<HTMLDetailsElement>("details").forEach((d) => {
    d.open = open;
  });
}

let state: StressState = { messages: [], running: true };
let publish: ((next: StressState) => void) | null = null;

function commit(messages: Message[], running = true): void {
  state = { messages: [...messages], running };
  publish?.(state);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const TOOL_NAMES = ["docs_search", "read_page", "terminal", "file_read"];

function resultText(cluster: number, step: number, lines: number): string {
  return Array.from(
    { length: lines },
    (_, i) =>
      `[${String(cluster)}.${String(step)}#${String(i + 1)}] steeping guide line ${String(i + 1)} — water 80°C, two minutes, decant fully.`,
  ).join("\n");
}

const NARRATIONS = [
  "I have the spine of the evidence now; two more passes and the picture is complete.",
  "The steeping guide and the implementation agree on temperature. Checking the rinse step next.",
  "```ts\nconst steep = (leaf: Leaf) => brew(leaf, { celsius: 80, seconds: 120 });\n```",
  "One discrepancy so far: the decant instruction is missing from the quickstart.",
];

const CHUNK =
  "The descaling interval in the guide matches the implementation, and the citric-acid ratio " +
  "is documented in both places with the same numbers. The rinse step needs one wording change " +
  "so that the quickstart and the reference say the same thing about decanting.\n\n";

async function play(overrides: Partial<PlayConfig> = {}): Promise<void> {
  const config = { ...DEFAULT_PLAY, ...overrides };
  const messages: Message[] = [];
  // One published step: append, render, let the engine take a frame.
  const step = async (message: Message) => {
    messages.push(message);
    commit(messages);
    await sleep(config.stepDelayMs);
  };
  await step({
    id: "u-1",
    role: "user",
    content:
      "Audit the steeping docs against the implementation and report drift.",
  });
  for (let c = 1; c <= config.clusters; c += 1) {
    await step({
      id: `th-${String(c)}`,
      role: "reasoning",
      content: `Cluster ${String(c)}: compare the guide's numbers with the code before quoting them.`,
    });
    const steps =
      config.stepsPerCluster[(c - 1) % config.stepsPerCluster.length] ?? 4;
    for (let s = 1; s <= steps; s += 1) {
      const callId = `t-${String(c)}-${String(s)}`;
      messages.push(
        toolCallMessage(`a-${String(c)}-${String(s)}`, [
          {
            id: callId,
            name: TOOL_NAMES[(s - 1) % TOOL_NAMES.length] ?? "docs_search",
            args: {
              query: `steeping ${String(c)}.${String(s)}`,
              path: `/guides/${String(s)}`,
            },
          },
        ]),
      );
      commit(messages);
      await sleep(config.stepDelayMs);
      messages.push({
        id: `r-${String(c)}-${String(s)}`,
        role: "tool",
        toolCallId: callId,
        content: resultText(c, s, config.resultLines),
      });
      commit(messages);
      await sleep(config.stepDelayMs);
    }
    if (config.openFoldsWhileLive) {
      const latest = [
        ...document.querySelectorAll("[data-tf-activity-group]"),
      ].at(-1);
      if (latest !== undefined) {
        setDetails(latest, true);
      }
      await sleep(config.stepDelayMs);
    }
    await step({
      id: `p-${String(c)}`,
      role: "assistant",
      content: NARRATIONS[(c - 1) % NARRATIONS.length],
    });
  }
  // The turn boundary: the member answers, the previous turn's holds
  // release and every disclosure collapses at once, then the answer
  // streams below the now display-locked subtrees.
  messages.push({
    id: "u-2",
    role: "user",
    content: "Yes — go ahead and write it up.",
  });
  commit(messages);
  await sleep(config.stepDelayMs);
  if (config.openFoldsWhileLive) {
    setDetails(document, false);
    await sleep(config.stepDelayMs);
  }
  const finalIndex = messages.length;
  messages.push({ id: "final", role: "assistant", content: "" });
  for (let k = 1; k <= config.proseChunks; k += 1) {
    messages[finalIndex] = {
      id: "final",
      role: "assistant",
      content: CHUNK.repeat(k),
    };
    commit(messages);
    await sleep(config.chunkDelayMs);
  }
  commit(messages, false);
}

function scrollerOf(): HTMLElement | null {
  const list = document.querySelector("[data-tf-message-list]");
  return list?.firstElementChild instanceof HTMLElement
    ? list.firstElementChild
    : null;
}

function metrics() {
  const s = scrollerOf();
  if (s === null) {
    return null;
  }
  const details = [
    ...document.querySelectorAll<HTMLDetailsElement>(
      "[data-tf-message-list] details",
    ),
  ];
  const closed = details.filter((d) => !d.open);
  // The only scroll containers this tree renders: the rail and the
  // result/code panes.
  const nested = [...s.querySelectorAll("[data-tf-activity-rail], pre")].filter(
    (e) => e.scrollHeight > e.clientHeight + 1,
  );
  const hiddenClosedBodies = closed.filter(
    (d) => getComputedStyle(d, "::details-content").display === "none",
  ).length;
  return {
    hiddenClosedBodies,
    scrollTop: s.scrollTop,
    scrollHeight: s.scrollHeight,
    clientHeight: s.clientHeight,
    domMax: s.scrollHeight - s.clientHeight,
    details: details.length,
    closedDetails: closed.length,
    scrollableNested: nested.length,
  };
}

declare global {
  interface Window {
    __stress: {
      play: (overrides?: Partial<PlayConfig>) => Promise<void>;
      metrics: () => ReturnType<typeof metrics>;
      scroller: () => HTMLElement | null;
    };
  }
}

window.__stress = {
  play,
  metrics,
  scroller: scrollerOf,
};

function Bench() {
  const [snapshot, setSnapshot] = useState<StressState>(state);
  useEffect(() => {
    publish = setSnapshot;
    return () => {
      publish = null;
    };
  }, []);
  const rows = transcriptRowsOf(
    snapshot.messages,
    EMPTY_ANCHORS,
    snapshot.running,
  );
  return (
    <div data-tf-assistant="" data-tf-theme="light" className="stress-frame">
      <MessageList rows={rows} cards={[]} live={snapshot.running} />
      <div className="stress-footer" />
    </div>
  );
}

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <Bench />
    </StrictMode>,
  );
}
