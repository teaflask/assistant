import type { ServedThinkingEffort } from "../contract/assistant-config.js";
import { ThinkingEffort } from "../generated/models/index.js";

// The nearest ladder member by the generated enum's rank order,
// equidistant ties DOWN — the platform's one clamp rule (the backend's
// nearest_effort_in and the operator editor's nearestEffortFor are its
// siblings; the package boundary keeps this the widget's own copy).
// Null when the effort is outside the bundle's vocabulary or the ladder
// holds nothing rankable — ladder members the bundle doesn't know are
// skipped rather than mis-ranked.
export function nearestEffortIn(
  ladder: readonly ServedThinkingEffort[],
  effort: ServedThinkingEffort,
): ServedThinkingEffort | null {
  const ranks: readonly string[] = Object.values(ThinkingEffort);
  const requested = ranks.indexOf(effort);
  if (requested === -1) {
    return null;
  }
  let best: ServedThinkingEffort | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const level of ladder) {
    const rank = ranks.indexOf(level);
    if (rank === -1) {
      continue;
    }
    const distance = Math.abs(rank - requested);
    if (
      distance < bestDistance ||
      (distance === bestDistance && rank < bestRank)
    ) {
      best = level;
      bestDistance = distance;
      bestRank = rank;
    }
  }
  return best;
}

// A selection the rendered ladder can express: the value itself when the
// ladder holds it, otherwise its nearest member, and the served default —
// itself expressed on THIS ladder — when the value is outside the
// bundle's vocabulary entirely. Null is the honest no-selection
// presentation (the config sends no thinking at all).
export function displayEffortOf(
  ladder: readonly ServedThinkingEffort[],
  effort: ServedThinkingEffort | null,
  servedDefault: ServedThinkingEffort | null,
): ServedThinkingEffort | null {
  if (effort === null || ladder.includes(effort)) {
    return effort;
  }
  const nearest = nearestEffortIn(ladder, effort);
  if (nearest !== null) {
    return nearest;
  }
  if (servedDefault === null || ladder.includes(servedDefault)) {
    return servedDefault;
  }
  return nearestEffortIn(ladder, servedDefault);
}

// The known ladder's labels, mirroring the dashboard's operator
// vocabulary for agent config — without this a five-level ladder renders
// "Xhigh" by accident. The wire's vocabulary may grow, so an unknown
// value still renders (title-cased) rather than vanishing: render what
// the wire names.
const EFFORT_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

export function effortLabelOf(effort: ServedThinkingEffort): string {
  return (
    EFFORT_LABELS[effort] ?? effort.charAt(0).toUpperCase() + effort.slice(1)
  );
}
