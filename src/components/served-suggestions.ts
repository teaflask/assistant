// Picking the served suggestion set for the page the visitor is on.
// Lives beside the drawer body so it rides the drawer's lazy chunk —
// the eager element shell never pays for it. Matching is computed per
// render from the pathname the caller reads; the package deliberately
// holds no route subscription.

import type {
  ServedRouteSuggestions,
  ServedSuggestionsConfig,
} from "../contract/assistant-config.js";
import type { AssistantSuggestion } from "./conversation-view.js";

/**
 * The longest-prefix route's set, or the default set when no route
 * covers the path. A matched route's EMPTY set is honored — it authors
 * "no suggestions on this route" — which is why this never falls back
 * from a match.
 */
export function servedSuggestionsForPath(
  config: ServedSuggestionsConfig,
  pathname: string,
): readonly AssistantSuggestion[] {
  const route = _longestCoveringRoute(config.routes ?? [], pathname);
  const items =
    route === null ? (config.default ?? []) : (route.suggestions ?? []);
  return items.map((item) => ({ prompt: item.prompt, kind: item.kind }));
}

function _longestCoveringRoute(
  routes: readonly ServedRouteSuggestions[],
  pathname: string,
): ServedRouteSuggestions | null {
  let covering: ServedRouteSuggestions | null = null;
  let coveringLength = -1;
  for (const route of routes) {
    const fence = _fenceOf(route.path_prefix);
    if (!_aFenceCovers(fence, pathname)) {
      continue;
    }
    // Strictly longer wins; a duplicate-length tie keeps the first
    // (duplicates are unstorable anyway — the write gate rejects them).
    if (fence.length > coveringLength) {
      covering = route;
      coveringLength = fence.length;
    }
  }
  return covering;
}

// The navigate fence's grammar (mirrors _a_prefix_covers in the backend):
// segment-aware — "/docs" covers "/docs/x", never "/docsy"; a trailing
// slash on the prefix is cosmetic; an all-slash prefix covers everything.
function _fenceOf(prefix: string): string {
  return prefix.replace(/\/+$/, "");
}

function _aFenceCovers(fence: string, pathname: string): boolean {
  if (fence === "") {
    return true;
  }
  return pathname === fence || pathname.startsWith(fence + "/");
}
