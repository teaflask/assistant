// Mid-stream markdown arrives syntactically unfinished — an open code
// fence swallows the rest of the answer as code, a dangling ** bolds it,
// a half-streamed table row renders as prose — and the renderer re-parses
// on every delta, so each glitch flashes at the reader. This repair
// closes what the stream will close anyway and holds back what cannot
// render sensibly yet. Deliberately conservative: only the constructs
// whose unfinished form is visually loud are touched (fences, inline
// code, ** strong, table rows); a half-typed link or _emphasis_ renders
// as plain text harmlessly and is left alone.

export function repairedStreamingMarkdown(text: string): string {
  let repaired = _withoutAHalfTypedFenceOpener(text);
  if (_endsInsideACodeFence(repaired)) {
    return `${repaired}\n\`\`\``;
  }
  repaired = _withoutAnUnfinishedTrailingTableRow(repaired);
  repaired = _withInlineCodeClosed(repaired);
  repaired = _withStrongEmphasisClosed(repaired);
  return repaired;
}

// A fence opener being typed ("`" or "``" alone on the last line) must be
// held back: counting its backticks would mis-balance inline code and
// close it into a real fence.
function _withoutAHalfTypedFenceOpener(text: string): string {
  const lines = text.split("\n");
  const last = lines[lines.length - 1];
  if (/^`{1,2}$/.test(last.trim())) {
    return lines.slice(0, -1).join("\n");
  }
  return text;
}

function _endsInsideACodeFence(text: string): boolean {
  let insideAFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      insideAFence = !insideAFence;
    }
  }
  return insideAFence;
}

// A table row missing its closing pipe is still streaming; rendered now
// it would flash as a paragraph and snap into the table a delta later.
function _withoutAnUnfinishedTrailingTableRow(text: string): string {
  const lines = text.split("\n");
  const last = lines[lines.length - 1];
  if (/^\s*\|/.test(last) && !/\|\s*$/.test(last)) {
    return lines.slice(0, -1).join("\n");
  }
  return text;
}

function _withInlineCodeClosed(text: string): string {
  const fenceless = _outsideCodeFences(text);
  const backticks = (fenceless.match(/`/g) ?? []).length;
  return backticks % 2 === 1 ? `${text}\`` : text;
}

function _withStrongEmphasisClosed(text: string): string {
  const fenceless = _outsideCodeFences(text);
  const strongMarkers = (fenceless.match(/\*\*/g) ?? []).length;
  return strongMarkers % 2 === 1 ? `${text}**` : text;
}

// The text with fenced blocks removed, so fence contents never count
// toward inline balancing. Only called once the trailing fence (if any)
// is known to be closed.
function _outsideCodeFences(text: string): string {
  const kept: string[] = [];
  let insideAFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      insideAFence = !insideAFence;
      continue;
    }
    if (!insideAFence) {
      kept.push(line);
    }
  }
  return kept.join("\n");
}
