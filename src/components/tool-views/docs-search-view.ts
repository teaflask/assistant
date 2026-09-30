// teaflask.docs-search — the package's view for the docs_search tool
// (tool-views.md, rung 3): the sections the search returned as list rows
// in a card — title and heading, the section's address and dates, the
// matched text — instead of one prose block. It renders the recorded
// call alone: the hit list is parsed from the tool's own text format
// (docs_search.py::_render_hits), authored knowledge of our own tool,
// never a shape sniffed off arbitrary output. Anything that is not that
// format renders verbatim in a pane, so a format change degrades to the
// honest text rather than a wrong structure.
//   settledOutcomeNotesOf arms — REACHABLE: a refused, errored
//     (output-error), denied, cancelled, superseded or offloaded call
//     renders its arm; a still-running call renders none (the switch
//     breaks out); see view-dom.ts.
//   call.truncated arm — channel 1 only (the envelope flag); the
//     mapper's 20k clip is invisible here and a cut hit list renders
//     its complete hits with the cut tail as its last hit's text.

import type { ToolViewProps } from "../../core/tool-view.js";
import { CARD_BLOCK_CLASS, CARD_TITLE_CLASS } from "./parts-classes.js";
import {
  badge,
  boneRows,
  captionRow,
  card,
  el,
  fileGlyph,
  listRow,
  note,
  pane,
  scrollRegion,
  settledOutcomeNotesOf,
  settledWithResult,
  statelessToolView,
  stringOf,
} from "./view-dom.js";

/** The producer's no-hits sentence, verbatim (docs_search.py). */
const NO_HITS_SENTENCE = "No documentation sections matched this query.";

/** `[slug#anchor] Title › Heading` — the first line of every hit. */
const HIT_HEADLINE = /^\[([^\]#\s]+)#([^\]\s]*)\] (.*)$/;
/** `Updated: 2026-09-01 · Verified: 2026-09-03` — the optional facts line. */
const HIT_FACTS =
  /^Updated: \d{4}-\d{2}-\d{2}( · Verified: \d{4}-\d{2}-\d{2})?$/;

const EXCERPT_CLASS =
  "tf:mt-0.5 tf:line-clamp-2 tf:text-xs tf:text-tf-muted-foreground";

export interface DocsSearchHit {
  slug: string;
  anchor: string;
  title: string;
  heading: string | null;
  facts: string | null;
  content: string;
}

export const docsSearchToolView = statelessToolView(_renderDocsSearch);

function _renderDocsSearch({ call }: ToolViewProps): HTMLElement {
  const root = el("div", "tf:flex tf:flex-col tf:gap-2");
  root.dataset.tfDocsSearchView = "";
  const query = stringOf(call.args.query);
  const title =
    query === null || query.trim() === ""
      ? "Results"
      : `Results for “${query}”`;
  root.append(...settledOutcomeNotesOf(call));
  if (!settledWithResult(call) || call.resultText === undefined) {
    if (
      call.status === "input-streaming" ||
      call.status === "input-available"
    ) {
      // A gated call is not in flight: the consent reading is the query
      // as a proposal row with the wait as its badge, never pulsing bones
      // beside a "Needs input" pill.
      root.append(
        call.awaitingDecision
          ? _proposalCard(query)
          : el("p", CARD_TITLE_CLASS, title),
      );
      if (!call.awaitingDecision) {
        root.append(boneRows(3));
      }
    }
    return root;
  }
  if (call.truncated === true) {
    root.append(
      note("The recorded results are incomplete and aren't rendered."),
    );
    return root;
  }
  if (call.resultText.trim() === NO_HITS_SENTENCE) {
    root.append(card([captionRow("No sections matched.")], title));
    return root;
  }
  const hits = docsSearchHitsOf(call.resultText);
  if (hits === null) {
    // The card title already names the results; the pane's label says
    // what the pane is — the record as it stands, not the format.
    root.append(
      card([_cardInterior(pane("As recorded", call.resultText))], title),
    );
    return root;
  }
  root.append(card([scrollRegion(hits.map(_hitRow))], title));
  return root;
}

function _proposalCard(query: string | null): HTMLElement {
  const row = listRow({
    title:
      query === null || query.trim() === ""
        ? "Documentation search"
        : `“${query}”`,
    secondary: "Search your docs",
    trailing: badge("Awaiting your decision"),
  });
  row.dataset.tfDocsSearchProposal = "";
  return card([row]);
}

/** The hit list, or null when the text is not the producer's format.
 *  A hit ends where the next begins — a blank line and then a headline
 *  line (_render_hits joins hits with one blank line) — never at a blank
 *  line alone: a section's content keeps its own paragraph breaks
 *  (mdv1_chunker rejoins a section's blocks with blank lines). */
export function docsSearchHitsOf(resultText: string): DocsSearchHit[] | null {
  const lines = resultText.split("\n");
  let headline = HIT_HEADLINE.exec(lines[0] ?? "");
  if (headline === null) {
    return null;
  }
  const hits: DocsSearchHit[] = [];
  let start = 1;
  for (let index = 1; index <= lines.length; index += 1) {
    const atEnd = index === lines.length;
    const next =
      !atEnd && lines[index - 1] === ""
        ? HIT_HEADLINE.exec(lines[index] ?? "")
        : null;
    if (!atEnd && next === null) {
      continue;
    }
    // The separator blank line belongs to neither hit.
    hits.push(_hitOf(headline, lines.slice(start, atEnd ? index : index - 1)));
    if (next === null) {
      break;
    }
    headline = next;
    start = index + 1;
  }
  return hits;
}

function _hitOf(
  headline: RegExpExecArray,
  body: readonly string[],
): DocsSearchHit {
  const [, slug, anchor, titleAndHeading] = headline;
  // The producer appends the heading once, at the end (`{title} › {heading}`),
  // so the LAST separator is the join — a title may carry the glyph itself.
  const separator = titleAndHeading.lastIndexOf(" › ");
  const title =
    separator === -1 ? titleAndHeading : titleAndHeading.slice(0, separator);
  const heading =
    separator === -1 ? null : titleAndHeading.slice(separator + 3);
  const facts = HIT_FACTS.test(body[0] ?? "") ? body[0] : null;
  const content = body.slice(facts === null ? 0 : 1).join("\n");
  return { slug, anchor, title, heading, facts, content };
}

/** The card's interior for a flush block (the pane): the card-child
 *  grammar every non-row block wears — the rows' inset, a hairline
 *  above unless it opens the card. */
function _cardInterior(child: HTMLElement): HTMLElement {
  const wrapper = el("div", CARD_BLOCK_CLASS);
  wrapper.append(child);
  return wrapper;
}

function _hitRow(hit: DocsSearchHit): HTMLElement {
  // The row reads like a document row: the doc's title, then where in it
  // the match sits (its heading, its address). The dates the producer
  // appends are model-facing evidence and stay off the row.
  const where =
    hit.heading === null || hit.heading === ""
      ? hit.slug
      : `${hit.heading} · ${hit.slug}`;
  const excerpt =
    hit.content.trim() === ""
      ? undefined
      : el("span", EXCERPT_CLASS, hit.content.trim());
  const row = listRow({
    icon: fileGlyph(),
    title: hit.title,
    secondary: where,
    below: excerpt,
  });
  row.dataset.tfDocsSearchHit = hit.slug;
  return row;
}
