// teaflask.file-edit — the recorded edit as a diff (tool-views.md,
// rung 3). The diff derives from the ARGS — str_replace carries the
// full old/new pair, insert its added lines, create the whole file —
// because the result carries only a post-edit snippet. On a settled
// call the editor applied exactly this change (unique-occurrence
// enforced backend-side); before it settles the same shape is labeled
// a proposal, so the view never claims an edit that hasn't happened.
// Producer transforms, argument ledger and the boundary-newline
// cross-product: docs/tool-view-ledgers.md. Arm reachability and the
// two truncation channels (the diff arms derive from the ARGS and are
// immune to both): the tool-view arm-reachability record.
//   settledOutcomeNotesOf arms — REACHABLE: tool-row no longer gates
//     output, so the refused/output-error/denied/cancelled/superseded/
//     offloaded settles render their arms in production (a
//     still-running call renders none — the switch breaks out); see
//     view-dom.ts.
//   elision marking (_diffPane) — every recorded line the Myers pane
//     does not render is marked with a ⋯: leading, between hunks, and
//     trailing. A pane without ⋯ IS the whole recorded fragment.

import { unifiedDiffOf } from "../../reader/line-diff.js";
import type { ToolViewProps } from "../../core/tool-view.js";
import {
  LABEL_CLASS,
  PANE_CLASS,
  PANE_WRAPPER_CLASS,
  el,
  note,
  pane,
  settledOutcomeNotesOf,
  settledWithResult,
  statelessToolView,
  stringOf,
} from "./view-dom.js";

export const fileEditToolView = statelessToolView(_renderFileEdit);

function _renderFileEdit({ call }: ToolViewProps): HTMLElement {
  const root = el("div", "tf:flex tf:flex-col tf:gap-2");
  root.dataset.tfFileEditView = "";
  const path = stringOf(call.args.path);
  if (path !== null && path !== "") {
    root.append(el("p", "tf:font-mono tf:text-xs tf:text-tf-foreground", path));
  }
  root.append(...settledOutcomeNotesOf(call));
  const settled = settledWithResult(call);
  switch (stringOf(call.args.command)) {
    case "str_replace":
      root.append(_strReplaceReadingOf(call, settled));
      break;
    case "create":
      root.append(_createReadingOf(call, settled));
      break;
    case "insert":
      root.append(_insertReadingOf(call, settled));
      break;
    case "view": {
      const read = _viewedContentsReadingOf(call, settled);
      if (read !== null) {
        root.append(read);
      }
      break;
    }
    default:
      root.append(note("No rendered edit for this call."));
  }
  return root;
}

function _strReplaceReadingOf(
  call: ToolViewProps["call"],
  settled: boolean,
): HTMLElement {
  const oldStr = stringOf(call.args.old_str);
  // new_str is optional for str_replace and omitting it DELETES the
  // match (the editor expands a missing or empty new_str to "") — so an
  // absent value is a deletion to render, and only a wrong-typed one is
  // unrenderable.
  const rawNewStr = call.args.new_str;
  const newStr =
    rawNewStr === undefined || rawNewStr === null ? "" : stringOf(rawNewStr);
  if (oldStr === null || newStr === null) {
    return note("No rendered edit for this call.");
  }
  // The editor matches and writes tab-EXPANDED fragments, so the file
  // received these bytes, and equality is judged on them.
  const expandedOld = _expandedTabs(oldStr);
  const expandedNew = _expandedTabs(newStr);
  if (newStr === "" && oldStr !== "") {
    return _diffPane(
      settled ? "Deletion" : "Proposed deletion",
      _prefixedLines(_withoutBoundaryNewlines(expandedOld), "-"),
    );
  }
  const diff = unifiedDiffOf(expandedOld, expandedNew);
  if (diff === "") {
    return note("The replacement matches the original — no change to render.");
  }
  return _diffPane(
    settled ? "Edit" : "Proposed edit",
    diff,
    expandedOld.split("\n").length,
  );
}

function _createReadingOf(
  call: ToolViewProps["call"],
  settled: boolean,
): HTMLElement {
  const fileText = stringOf(call.args.file_text);
  if (fileText === null) {
    return note("No rendered edit for this call.");
  }
  if (fileText === "") {
    // An empty file has no added lines; a bare "+" would claim one.
    return note(settled ? "Created an empty file." : "Proposes an empty file.");
  }
  // Verbatim on purpose: create is the one command the editor does NOT
  // tab-expand, and a leading newline really is a blank first line —
  // only the trailing terminator drops.
  return _diffPane(
    settled ? "New file" : "Proposed new file",
    _prefixedLines(_withoutTrailingNewline(fileText), "+"),
  );
}

function _insertReadingOf(
  call: ToolViewProps["call"],
  settled: boolean,
): HTMLElement {
  const newStr = stringOf(call.args.new_str);
  if (newStr === null) {
    return note("No rendered edit for this call.");
  }
  const line = call.args.insert_line;
  // insert_line counts the existing lines that PRECEDE the insertion —
  // the editor splices at file_text_lines[:insert_line] and accepts
  // only integers in [0, n_lines] — so 0 is the top of the file, a
  // positive integer reads as the ordinary "after line N" (1-indexed
  // reading), and anything the editor would refuse (negative,
  // fractional, non-number) claims no position at all. The vended
  // docstring says "0-indexed"; its own splice contradicts it, and the
  // splice is what runs.
  const where =
    typeof line !== "number" || !Number.isInteger(line) || line < 0
      ? ""
      : line === 0
        ? " at the top of the file"
        : ` after line ${String(line)}`;
  // Tab-expanded (the splice inserts expanded lines), but no boundary
  // drops: split("\n") is spliced verbatim, so leading and trailing
  // newlines really insert blank lines.
  return _diffPane(
    settled ? `Inserted${where}` : `Proposed insertion${where}`,
    _prefixedLines(_expandedTabs(newStr), "+"),
  );
}

function _viewedContentsReadingOf(
  call: ToolViewProps["call"],
  settled: boolean,
): HTMLElement | null {
  if (!settled) {
    return null;
  }
  if (call.resultText === undefined || call.resultText === "") {
    return note("Nothing to show for this read.");
  }
  // "Contents", not "File": a view over a directory returns a listing,
  // and the recorded args cannot tell the two apart.
  return pane("Contents", _withoutViewPreamble(call.resultText));
}

/** The editor's own transform: "\t" → 8 spaces, applied to old_str and
 *  new_str (never file_text) before matching and writing. */
function _expandedTabs(text: string): string {
  return text.replaceAll("\t", "        ");
}

/** One trailing "\n" is a terminator, not a line. */
function _withoutTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

/** Deletion drops one newline at EACH boundary: the leading one is the
 *  preceding line's terminator consumed as the joint, the trailing one
 *  the last deleted line's own (the cross-product above). */
function _withoutBoundaryNewlines(text: string): string {
  return _withoutTrailingNewline(text.startsWith("\n") ? text.slice(1) : text);
}

/** A view result is never bare contents: the vended tool opens with one
 *  deterministic model-facing sentence (file or directory form, both
 *  ending in ":"), restating the path the header line above already
 *  shows — dropped so the pane holds the recorded read alone. */
function _withoutViewPreamble(text: string): string {
  const newline = text.indexOf("\n");
  if (newline === -1) {
    return text;
  }
  const firstLine = text.slice(0, newline);
  const isPreamble =
    (firstLine.startsWith("Here's the result of running") ||
      firstLine.startsWith("Here's the files and directories")) &&
    firstLine.endsWith(":");
  return isPreamble ? text.slice(newline + 1) : text;
}

function _prefixedLines(text: string, prefix: "+" | "-"): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

/** The diff register: additions in foreground ink, deletions in the
 *  status voice, context muted (no success token exists in Graphite —
 *  none is minted). Hunk headers render as quiet ⋯ separators: their
 *  offsets are relative to the recorded fragment, and printing numbers
 *  that read as file lines would be a wrong claim — but every ELISION
 *  is marked: a first hunk opening past the
 *  fragment's first line gets a leading ⋯, and when `oldLineCount` is
 *  given (the Myers arm), recorded lines past the last hunk get a
 *  trailing ⋯ — the pane never reads as a complete diff of a fragment
 *  it elided. Lines join with prepended newlines so the pane carries no
 *  trailing empty line box. */
function _diffPane(
  label: string,
  diff: string,
  oldLineCount?: number,
): HTMLElement {
  const wrapper = el("div", PANE_WRAPPER_CLASS);
  wrapper.append(el("p", LABEL_CLASS, label));
  const pre = el("pre", PANE_CLASS);
  const code = el("code", "tf:font-mono");
  let rendered = 0;
  const append = (className: string, text: string) => {
    code.append(el("span", className, rendered === 0 ? text : `\n${text}`));
    rendered += 1;
  };
  // The first recorded-fragment line AFTER the last hunk (1-indexed),
  // from the header's own `-start,count` — the only place the diff
  // says how far it reached.
  let afterLastHunk: number | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      const header = /^@@ -(\d+),(\d+)/.exec(line);
      if (header !== null) {
        afterLastHunk = Number(header[1]) + Number(header[2]);
      }
      // A hunk opening at the fragment's first line elides nothing
      // before it; every other header stands for skipped recorded
      // lines and must say so.
      if (rendered > 0 || !line.startsWith("@@ -1,")) {
        append("tf:text-tf-muted-foreground", "⋯");
      }
      continue;
    }
    const className = line.startsWith("+")
      ? "tf:text-tf-foreground"
      : line.startsWith("-")
        ? "tf:text-tf-destructive"
        : "tf:text-tf-muted-foreground";
    append(className, line);
  }
  if (
    oldLineCount !== undefined &&
    afterLastHunk !== null &&
    afterLastHunk <= oldLineCount
  ) {
    append("tf:text-tf-muted-foreground", "⋯");
  }
  pre.append(code);
  wrapper.append(pre);
  return wrapper;
}
