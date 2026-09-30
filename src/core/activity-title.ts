// Compact visible activity copy for a dispatch label: the first
// MAX_TITLE_CHARS characters of the whitespace-collapsed label, with an
// ellipsis when anything was cut. No sentence detection — a prefix is all
// a one-line row needs, and callers keep the complete label in the title
// attribute.

const MAX_TITLE_CHARS = 64;

export function activityTitleOf(label: string): string {
  const compact = label.trim().replace(/\s+/g, " ");
  if (compact.length <= MAX_TITLE_CHARS) {
    return compact;
  }
  return `${compact.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`;
}
