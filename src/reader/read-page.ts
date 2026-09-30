// One builtin.read_page request in, one landable result out: snapshot
// the page the mount lives in, render it, fit it under the tool-results
// door's size cap, and — on a repeat read — deliver the unified diff
// against the previous read when that is the cheaper payload. The
// baseline lives here at module level, per thread: the handler map's
// identity churns with its React deps, and a baseline that died on every
// re-render would never produce a diff. An empty diff (is_diff with ""
// content) means the page is unchanged since the previous read.

import { boundedTextOf, doorCostOfText } from "../transport/door-budget.js";
import type { LayoutProbe } from "./layout-probe.js";
import { unifiedDiffOf } from "./line-diff.js";
import { pageHeaderOf, renderedTreeOf } from "./render.js";
import {
  DEFAULT_MAX_DEPTH,
  resolvedSnapshotRootOf,
  snapshotTreeOf,
  type SnapshotOptions,
} from "./snapshot.js";

// The content budget under the door's 20k serialized cap, measured in
// the door's own metric (door-budget.ts): 16k leaves headroom for the
// result's url/title/flag siblings, mirroring the action-response bound.
const READ_PAGE_CONTENT_MAX_CHARS = 16_000;
// When the full-depth tree overflows, re-render shallower until it fits.
const DEPTH_LADDER = [30, 20, 12, 8, 5, 3];
const TRUNCATION_NOTICE = "… [truncated: the page holds more than fits here]";
const MAX_TITLE_LENGTH = 300;
const MAX_URL_LENGTH = 2_000;

/** The wire shape of ReadPageResult, synthesized package-side. */
export interface ReadPageReport {
  url: string;
  title: string;
  content: string;
  is_diff: boolean;
  truncated: boolean;
}

/**
 * An expected, recoverable read refusal — a stale ref, a selector that
 * matches nothing, a page with no body yet. Its message is the reader's
 * own model-actionable sentence (usually "take a fresh full read"), and
 * the handler delivers it verbatim: wrapping it in give-up prose would
 * cancel the retry the sentence asks for. A reader crash is anything
 * else.
 */
export class SnapshotUnavailableError extends Error {}

// A diff only means "what changed" against the SAME view: the baseline
// remembers the scope (knobs) that produced it AND the shape the fitter
// actually rendered (full, which ladder rung, or line-bounded). A read
// with any other scope starts fresh — otherwise two differently-scoped
// reads whose text happens to coincide would answer "nothing changed",
// and an overlapping scope would present scoping as removals. A read at
// any other shape starts fresh too — the scope holds the REQUESTED
// depth, so a page growing past the size cap between two identical
// requests shifts the ladder rung, and diffing across the shift would
// present depth-truncated sections as removed from the page.
interface ReadBaseline {
  scope: string;
  shape: string;
  text: string;
}

const _baselineByThread = new Map<string, ReadBaseline>();

export function readPageResultOf(
  threadId: string,
  action: Record<string, unknown> | null,
  probe: LayoutProbe,
): ReadPageReport {
  const request = _readRequestOf(action, probe);
  const scope = _scopeKeyOf(request);
  const fitted = _fittedTreeTextOf(request);
  const content = _cheaperOfDiffAndFull(threadId, scope, fitted);
  _baselineByThread.set(threadId, {
    scope,
    shape: fitted.shape,
    text: fitted.text,
  });
  return {
    url: boundedTextOf(document.location.href, MAX_URL_LENGTH),
    title: boundedTextOf(
      document.title.replace(/\s+/g, " ").trim(),
      MAX_TITLE_LENGTH,
    ),
    content: content.text,
    is_diff: content.isDiff,
    truncated: fitted.truncated,
  };
}

export function _resetBaselinesForTests(): void {
  _baselineByThread.clear();
}

function _readRequestOf(
  action: Record<string, unknown> | null,
  probe: LayoutProbe,
): SnapshotOptions {
  // Wire defense only: the knobs are model-supplied and optional, and a
  // wrong-typed knob degrades to its default rather than failing a read.
  return {
    probe,
    ignoreSelectors: _stringListOf(action?.ignore_selectors),
    maxDepth: _depthOf(action?.max_depth),
    interactive: action?.interactive === true,
    showHidden: action?.show_hidden === true,
    selector: _nonEmptyStringOf(action?.selector),
    refId: _nonEmptyStringOf(action?.ref_id),
    rootElement: null,
  };
}

interface FittedTree {
  text: string;
  truncated: boolean;
  /** What the fitter actually rendered: "full", "depth:N", "line-bounded". */
  shape: string;
}

function _fittedTreeTextOf(request: SnapshotOptions): FittedTree {
  // Resolve the root once and pin the element: the ladder below renders
  // the same read several times, each render rebuilds the ref registry,
  // and a ref whose element changed identity since minting would resolve
  // on the first render and be gone by the second — a read must not fail
  // on payload size where the same request succeeds when small.
  const rooting = resolvedSnapshotRootOf(request);
  if (rooting.error !== null) {
    throw new SnapshotUnavailableError(rooting.error);
  }
  const pinned: SnapshotOptions = { ...request, rootElement: rooting.root };
  const header = pageHeaderOf(document.title, document.location.href);
  const fullText = `${header}\n${_renderedSnapshotOf(pinned)}`;
  if (doorCostOfText(fullText) <= READ_PAGE_CONTENT_MAX_CHARS) {
    return { text: fullText, truncated: false, shape: "full" };
  }
  for (const rung of DEPTH_LADDER) {
    if (rung >= pinned.maxDepth) {
      continue;
    }
    const shallower = `${header}\n${_renderedSnapshotOf({ ...pinned, maxDepth: rung })}`;
    if (doorCostOfText(shallower) <= READ_PAGE_CONTENT_MAX_CHARS) {
      return {
        text: shallower,
        truncated: true,
        shape: `depth:${String(rung)}`,
      };
    }
  }
  // Even the shallowest rung overflows: deliver the full outline cut on
  // line boundaries. Re-render it first so the ref registry matches the
  // refs this outline shows — every ladder rung above rebuilt the registry
  // as it ran, so it currently holds the shallowest rung's refs, not the
  // deep ones a ref_id follow-up read would look up. Refs are stable, so
  // this reproduces fullText exactly while restoring the full registry.
  const fullTextAgain = `${header}\n${_renderedSnapshotOf(pinned)}`;
  return {
    text: _lineBoundedTextOf(fullTextAgain),
    truncated: true,
    shape: "line-bounded",
  };
}

function _renderedSnapshotOf(request: SnapshotOptions): string {
  const outcome = snapshotTreeOf(request);
  if (outcome.error !== null) {
    throw new SnapshotUnavailableError(outcome.error);
  }
  return renderedTreeOf(outcome.tree);
}

function _cheaperOfDiffAndFull(
  threadId: string,
  scope: string,
  fitted: FittedTree,
): { text: string; isDiff: boolean } {
  const baseline = _baselineByThread.get(threadId);
  if (baseline?.scope !== scope || baseline.shape !== fitted.shape) {
    return { text: fitted.text, isDiff: false };
  }
  // Two line-bounded renders share a shape, but the cut point slides
  // with any earlier change — tail sections would flap in and out of the
  // diff as removals that never happened. Those reads deliver in full.
  if (fitted.shape === "line-bounded") {
    return { text: fitted.text, isDiff: false };
  }
  const diff = unifiedDiffOf(baseline.text, fitted.text);
  if (doorCostOfText(diff) < doorCostOfText(fitted.text)) {
    return { text: diff, isDiff: true };
  }
  return { text: fitted.text, isDiff: false };
}

function _scopeKeyOf(request: SnapshotOptions): string {
  // Everything that shapes the rendered view except the probe — including
  // the page itself: a client-side navigation keeps this module alive, and
  // diffing the new page against the old one would read the old page's
  // unique content as removals.
  return JSON.stringify({
    url: document.location.href,
    interactive: request.interactive,
    maxDepth: request.maxDepth,
    showHidden: request.showHidden,
    selector: request.selector,
    refId: request.refId,
    ignoreSelectors: request.ignoreSelectors,
  });
}

function _lineBoundedTextOf(text: string): string {
  const noticeCost = doorCostOfText(`\n${TRUNCATION_NOTICE}`);
  const bounded = boundedTextOf(text, READ_PAGE_CONTENT_MAX_CHARS - noticeCost);
  // Cut on a line boundary so the outline stays parseable to the end.
  const lastLineBreak = bounded.lastIndexOf("\n");
  const wholeLines =
    lastLineBreak > 0 ? bounded.slice(0, lastLineBreak) : bounded;
  return `${wholeLines}\n${TRUNCATION_NOTICE}`;
}

function _depthOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return DEFAULT_MAX_DEPTH;
  }
  return Math.min(value, DEFAULT_MAX_DEPTH);
}

function _nonEmptyStringOf(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function _stringListOf(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (member): member is string => typeof member === "string" && member !== "",
  );
}
