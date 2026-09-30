/**
 * The fractional-geometry probe for the active-states rail residual
 * (docs/transcript-visual-contract.md, "Residual closed by deletion —
 * the activity rail's follow pin"; the pin is gone, the probe stays
 * read-only instrumentation). Reads sub-pixel layout as unrounded
 * doubles — the integer scrollTop readings three lanes already took are
 * exactly one pixel apart and cannot discriminate further; the rail's
 * own rect, its content's rect, and the rect chain of everything laid
 * out ABOVE the rail are where the origin-shift hypothesis is confirmed
 * or killed.
 *
 * Strictly read-only in-page (rect and scroll-metric reads force at
 * most a layout flush, never a mutation) and strictly post-comparator:
 * the caller invokes it AFTER its soft toHaveScreenshot resolves, so
 * the capture path is byte-unchanged. The failing state is bistable
 * (measured through the comparator's whole retry window plus seconds
 * and frames), so a post-comparator read still sees it.
 *
 * Two persistence channels per record, because a campaign may only
 * ever catch one failure: a run-long JSONL under the configured
 * outputDir (primary — copied off the container by the campaign
 * script), and one runner-stdout line greppable as `^FRACTIONALPROBE `
 * (belt-and-braces — teed to a host log per batch).
 */
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import type { Page, TestInfo } from "@playwright/test";

import { LIST_SCROLLER, SCENARIO_SURFACE, settleTwoFrames } from "./geometry";

const ACTIVITY_RAIL = "[data-tf-activity-rail]";
const PROBE_PREFIX = "FRACTIONALPROBE";
const PROBE_JSONL = "fractional-probe.jsonl";

interface FractionalProbeMeta {
  /** The baseline family, e.g. "active-states". */
  name: string;
  theme: "light" | "dark";
  /** test.info().errors.length read BEFORE the soft comparator. */
  errorsBefore: number;
}

export async function emitFractionalProbe(
  page: Page,
  info: TestInfo,
  meta: FractionalProbeMeta,
): Promise<void> {
  // A failed expect.soft pushes onto testInfo.errors synchronously, so
  // the length delta across the awaited comparator is an exact
  // per-capture failure flag.
  const captureFailed = info.errors.length > meta.errorsBefore;
  await emitOnce(page, info, meta, captureFailed, "post-capture");
  if (captureFailed) {
    // Second read on failures only: the integer 274 is known-bistable;
    // this documents whether the FRACTIONAL values hold too. The next
    // capture re-navigates, so the extra waits perturb nothing.
    await page.waitForTimeout(500);
    await settleTwoFrames(page);
    await emitOnce(page, info, meta, captureFailed, "delayed");
  }
}

async function emitOnce(
  page: Page,
  info: TestInfo,
  meta: FractionalProbeMeta,
  captureFailed: boolean,
  phase: "post-capture" | "delayed",
): Promise<void> {
  const geometry = await page.evaluate(readFractionalGeometry, {
    surfaceSelector: SCENARIO_SURFACE,
    scrollerSelector: LIST_SCROLLER,
    railSelector: ACTIVITY_RAIL,
  });
  // Anti-vacuity (round 2): an empty match would serialize into a
  // complete, plausible record — rails: [], surface: null — and a
  // multi-hour campaign would report a catch with no geometry in it.
  // Selector rot or a shadow-root migration (document.querySelector
  // does not pierce shadow roots) must fail the run loudly instead.
  if (
    geometry.surface === null ||
    geometry.rails.length === 0 ||
    geometry.listScrollers.length === 0 ||
    geometry.rails.some((rail) => rail.contentRect === null)
  ) {
    throw new Error(
      `${PROBE_PREFIX} vacuous geometry — the probe matched nothing it ` +
        `exists to measure (surface ${geometry.surface === null ? "missing" : "found"}, ` +
        `${String(geometry.rails.length)} rails, ` +
        `${String(geometry.listScrollers.length)} scrollers); ` +
        "selectors rotted or the transcript moved behind a shadow root",
    );
  }
  // FIELD PROVENANCE (round 3 extended the silent-artifact sweep
  // across the file boundary it had stopped at — every field below is
  // classified by where it is measured, because a field read in the
  // wrong context is a well-formed, confident, wrong artifact):
  //   - node-side, runner truth: v, probe, name, theme, phase,
  //     repeatEachIndex, retry, captureFailed, errorsBefore,
  //     errorsAfter (testInfo and control flow), and emittedAtMs —
  //     the record's one WALL-CLOCK timestamp, stamped here in Node,
  //     which is what orders the JSONL and lines a record up against
  //     container.log and the ledger's per-batch seconds.
  //   - in-page, and only correct in-page: dpr, windowScrollX/Y,
  //     surface, listScrollers, rails — DOM geometry must be read
  //     where the DOM is.
  //   - in-page and FAKED, named for it: pageEpochMs is the capture
  //     clock (page.clock re-seeds Date to 2026-09-08T12:00:00Z at
  //     every navigation), so it measures elapsed-since-navigation
  //     and the post-capture→delayed gap, never wall time. Round 3
  //     caught it recorded as `epochMs`: a multi-hour campaign's
  //     records all clustered around the seed, non-monotonic across
  //     executions. Schema boundary: records with v <= 2 (the
  //     campaign's catch is v1, the decomposition batches v2) carry
  //     that faked value under `epochMs`; v3 renamed it and added
  //     emittedAtMs.
  const record = {
    v: 3,
    probe: "settle-repin-fractional",
    name: meta.name,
    theme: meta.theme,
    phase,
    repeatEachIndex: info.repeatEachIndex,
    retry: info.retry,
    captureFailed,
    errorsBefore: meta.errorsBefore,
    errorsAfter: info.errors.length,
    emittedAtMs: Date.now(),
    ...geometry,
  };
  const line = JSON.stringify(record);
  console.log(`${PROBE_PREFIX} ${line}`);
  const jsonlPath = path.join(info.project.outputDir, PROBE_JSONL);
  mkdirSync(path.dirname(jsonlPath), { recursive: true });
  appendFileSync(jsonlPath, `${line}\n`);
}

/**
 * Runs in the page. Self-contained: everything it touches arrives via
 * the argument object or the DOM. All numbers are raw doubles.
 */
function readFractionalGeometry(selectors: {
  surfaceSelector: string;
  scrollerSelector: string;
  railSelector: string;
}) {
  const rect = (el: Element) => {
    const r = el.getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      right: r.right,
      width: r.width,
      height: r.height,
    };
  };
  const markers = (el: Element) =>
    el
      .getAttributeNames()
      .filter((n) => n.startsWith("data-"))
      .map((n) => {
        const value = el.getAttribute(n);
        return value ? `${n}=${value}` : n;
      })
      .join(" ");
  const surface = document.querySelector(selectors.surfaceSelector);

  const listScrollers = [
    ...document.querySelectorAll(selectors.scrollerSelector),
  ].map((el, index) => ({
    index,
    scrollTop: (el as HTMLElement).scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    gap: el.scrollHeight - (el as HTMLElement).scrollTop - el.clientHeight,
    rect: rect(el),
    contentRect: el.firstElementChild ? rect(el.firstElementChild) : null,
  }));

  const rails = [...document.querySelectorAll(selectors.railSelector)].map(
    (el, index) => {
      // The chain: ancestors up to the scenario surface, each carrying
      // its rect and the rects of the path element's preceding
      // siblings — the boxes laid out ABOVE the rail, which is where
      // the hypothesised fractional settle would live.
      const chain = [];
      let child: Element = el;
      while (child.parentElement) {
        const parent = child.parentElement;
        const precedingSiblings = [];
        for (
          let sib = child.previousElementSibling;
          sib;
          sib = sib.previousElementSibling
        ) {
          precedingSiblings.unshift({
            tag: sib.tagName.toLowerCase(),
            markers: markers(sib),
            rect: rect(sib),
          });
        }
        chain.push({
          tag: parent.tagName.toLowerCase(),
          markers: markers(parent),
          rect: rect(parent),
          precedingSiblings,
        });
        if (parent === surface || parent === document.body) {
          break;
        }
        child = parent;
      }
      // The extent decomposition (probe v2): scrollHeight exceeds the
      // observed content's border box, so the difference lives in
      // components no rect witnesses — read them as computed styles.
      // The rail declares no padding or border (src/styles/styles.css,
      // [data-tf-activity-rail]); these fields prove that from the
      // live page instead of asserting it from the stylesheet.
      const vertical = (target: Element, props: string[]) => {
        const style = window.getComputedStyle(target);
        return Object.fromEntries(
          props.map((p) => [p, parseFloat(style.getPropertyValue(p))]),
        );
      };
      const content = el.firstElementChild;
      const edgeChild = (target: Element | null) =>
        target
          ? {
              tag: target.tagName.toLowerCase(),
              markers: markers(target),
              rect: rect(target),
              ...vertical(target, ["margin-top", "margin-bottom"]),
            }
          : null;
      return {
        index,
        rect: rect(el),
        contentRect: content ? rect(content) : null,
        railComputed: vertical(el, [
          "padding-top",
          "padding-bottom",
          "border-top-width",
          "border-bottom-width",
        ]),
        contentComputed: content
          ? vertical(content, ["margin-top", "margin-bottom"])
          : null,
        contentFirstChild: edgeChild(content?.firstElementChild ?? null),
        contentLastChild: edgeChild(content?.lastElementChild ?? null),
        scrollTop: (el as HTMLElement).scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        gap: el.scrollHeight - (el as HTMLElement).scrollTop - el.clientHeight,
        foldAbove: el.hasAttribute("data-tf-fold-above"),
        foldBelow: el.hasAttribute("data-tf-fold-below"),
        chain,
      };
    },
  );

  return {
    // The page clock is faked (capture clock, re-seeded per
    // navigation) — truthful only under this name. Wall time is
    // stamped node-side as emittedAtMs.
    pageEpochMs: Date.now(),
    dpr: window.devicePixelRatio,
    windowScrollX: window.scrollX,
    windowScrollY: window.scrollY,
    surface: surface ? rect(surface) : null,
    listScrollers,
    rails,
  };
}
