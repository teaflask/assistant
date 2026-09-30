// The tool-results door refuses results whose serialized JSON passes 20k
// chars — measured server-side with ensure_ascii escaping and spaced
// separators — and a refused POST would strand the turn until it parks.
// Every client-side size bound on a deliverable payload must therefore be
// taken against a CEILING of the door's own metric, never against raw JS
// string length: non-ASCII re-escapes into 6-char \uXXXX sequences and a
// truncated-text payload re-escapes its quotes, either of which can
// inflate a "small" payload past the cap. Shared by whichever producer
// ships text through the door (action responses, page reads).

/**
 * A ceiling on the length the tool-results door will measure for a
 * client-serialized JSON text: the door re-serializes with ensure_ascii
 * (every non-ASCII UTF-16 unit becomes a 6-char \uXXXX) and spaced
 * separators (every comma and colon may gain a space). In-string commas
 * are over-counted — a ceiling never needs to be exact, only never under.
 */
export function doorLengthCeilingOf(serialized: string): number {
  let length = 0;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    if (code > 0x7f) {
      length += 6;
    } else if (code === 0x2c /* , */ || code === 0x3a /* : */) {
      length += 2;
    } else {
      length += 1;
    }
  }
  return length;
}

/**
 * Truncate by what each unit will cost once this text rides as a JSON
 * string through the door's ensure_ascii serializer, at worst case — a
 * raw-length cut could still blow the cap on re-escaping. Never splits a
 * surrogate pair.
 */
export function boundedTextOf(text: string, maxEscapedChars: number): string {
  let budget = maxEscapedChars;
  let end = 0;
  while (end < text.length) {
    const cost = escapedCostOf(text.charCodeAt(end));
    if (cost > budget) {
      break;
    }
    budget -= cost;
    end += 1;
  }
  if (end > 0 && _isHighSurrogate(text.charCodeAt(end - 1))) {
    end -= 1; // never cut a surrogate pair in half
  }
  return text.slice(0, end);
}

/** The worst-case door footprint of a whole text inside a JSON string. */
export function doorCostOfText(text: string): number {
  let cost = 0;
  for (let index = 0; index < text.length; index += 1) {
    cost += escapedCostOf(text.charCodeAt(index));
  }
  return cost;
}

/** The worst-case door footprint of one UTF-16 unit inside a JSON string. */
export function escapedCostOf(code: number): number {
  if (code > 0x7f || code < 0x20) {
    return 6;
  }
  if (code === 0x22 /* " */ || code === 0x5c /* \ */) {
    return 2;
  }
  return 1;
}

function _isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
