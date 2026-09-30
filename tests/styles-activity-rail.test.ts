// The expanded rail's layout contract: an open fold grows to its content
// in the transcript's own flow. It declares NO height cap, NO inner
// scroller and NO fold masks — a tool view inside a fold is never clipped
// or scrolled twice; the transcript's one scroller is the message list.
// Textual pins over styles.css and the rail's markup (activity-rail.tsx).

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const STYLES = readFileSync(
  path.resolve(import.meta.dirname, "../src/styles/styles.css"),
  "utf8",
);
const ACTIVITY_RAIL = readFileSync(
  path.resolve(import.meta.dirname, "../src/components/activity-rail.tsx"),
  "utf8",
);

describe("the expanded rail grows to its content", () => {
  it("the stylesheet declares no rail rule: no max-height, no scrollbar cosmetics, no fold masks", () => {
    expect(STYLES).not.toContain("[data-tf-activity-rail]");
    expect(STYLES).not.toContain("data-tf-fold-above");
  });

  it("the step connector runs the mark column only between rows that keep it clear — folded narration paints none and is not reached into", () => {
    // Reasoning and tool rows carry their marks at the connector's
    // column (0.47rem) and indent their bodies past it; narration is
    // flush prose at x=0. A connector through a wrapped narration step
    // would strike its second and later lines, so the rail pauses: the
    // narration step is excluded from the base rule, and the step above
    // it stops at its own edge.
    const base = connectorRuleOf(
      "[data-tf-activity-step]:not(:last-child):not([data-tf-activity-narration])::after",
    );
    expect(base.declarations["inset-block-end"]).toBe("-0.45rem");
    expect(base.declarations["inset-inline-start"]).toBe("0.47rem");
    expect(base.declarations.content).toBe('""');
    const stop = connectorRuleOf(
      "[data-tf-activity-step]:not(:last-child):not([data-tf-activity-narration]):has(+ [data-tf-activity-narration])::after",
    );
    expect(stop.declarations["inset-block-end"]).toBe("0");
    // No unguarded connector selector survives beside them.
    expect(compact(STYLES)).not.toContain(
      "[data-tf-activity-step]:not(:last-child)::after",
    );
    expect(compact(STYLES)).not.toMatch(
      /\[data-tf-activity-step\]:has\(\+\[data-tf-activity-narration\]\)::after/,
    );
  });

  it("the stop rule WINS the cascade by specificity, not by source order — (0,4,1) over the base's (0,3,1)", () => {
    // Selectors Level 4: an attribute selector and a pseudo-class each
    // count one in the second column; :not() and :has() count their most
    // specific argument; a pseudo-element counts one in the third. A stop
    // rule written as a bare `:has()` would sit at (0,2,1) and lose to
    // the base whatever the source order — the reach into narration
    // would stand. The stop rule repeats the base's whole subject and adds
    // the sibling condition, so it outranks it and would even if it were
    // declared first.
    const base = specificityOf(
      "[data-tf-activity-step]:not(:last-child):not([data-tf-activity-narration])::after",
    );
    const stop = specificityOf(
      "[data-tf-activity-step]:not(:last-child):not([data-tf-activity-narration]):has(+ [data-tf-activity-narration])::after",
    );
    const bare = specificityOf(
      "[data-tf-activity-step]:has(+ [data-tf-activity-narration])::after",
    );
    expect(base).toEqual([0, 3, 1]);
    expect(stop).toEqual([0, 4, 1]);
    expect(bare).toEqual([0, 2, 1]);
    expect(compareSpecificity(stop, base)).toBeGreaterThan(0);
    expect(compareSpecificity(bare, base)).toBeLessThan(0);
    // The committed rules resolve, per element, to the geometry the rail
    // promises — the cascade walked as a browser walks it, highest
    // specificity then source order.
    const rules = [
      connectorRuleOf(
        "[data-tf-activity-step]:not(:last-child):not([data-tf-activity-narration])::after",
      ),
      connectorRuleOf(
        "[data-tf-activity-step]:not(:last-child):not([data-tf-activity-narration]):has(+ [data-tf-activity-narration])::after",
      ),
    ];
    const resolved = (element: StepShape) =>
      resolveAfter(rules, element, "inset-block-end");
    expect(
      resolved({ last: false, narration: false, nextNarration: false }),
    ).toBe("-0.45rem");
    expect(
      resolved({ last: false, narration: false, nextNarration: true }),
    ).toBe("0");
    expect(
      resolved({ last: false, narration: true, nextNarration: false }),
    ).toBe(undefined);
    expect(
      resolved({ last: true, narration: false, nextNarration: false }),
    ).toBe(undefined);
  });

  it("the rail element is a plain flow container around one content child", () => {
    const rail =
      /<div data-tf-activity-rail="">\s*<div>\{steps\}<\/div>\s*<\/div>/.exec(
        ACTIVITY_RAIL,
      );
    expect(rail).not.toBeNull();
    expect(ACTIVITY_RAIL).not.toContain("overflow-y-auto");
    expect(ACTIVITY_RAIL).not.toContain("data-tf-fold-below");
    expect(ACTIVITY_RAIL).not.toContain("useRailFollow");
  });
});

// --- the cascade, modelled ---------------------------------------------------

/** Whitespace-normalized stylesheet text: Prettier wraps long selectors
 *  across lines, so every pin reads the compacted form. */
function compact(text: string): string {
  return text.replace(/\s+/g, "");
}

interface ConnectorRule {
  selector: string;
  declarations: Partial<Record<string, string>>;
}

/** The one rule whose compacted selector equals the given one. */
function connectorRuleOf(selector: string): ConnectorRule {
  const wanted = compact(selector);
  for (const match of STYLES.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (compact(match[1]) !== wanted) {
      continue;
    }
    const declarations: Partial<Record<string, string>> = {};
    for (const declaration of match[2].split(";")) {
      const colon = declaration.indexOf(":");
      if (colon !== -1) {
        declarations[declaration.slice(0, colon).trim()] = declaration
          .slice(colon + 1)
          .trim();
      }
    }
    return { selector: wanted, declarations };
  }
  throw new Error(`no rule with selector ${selector}`);
}

type Specificity = [number, number, number];

/** Selectors Level 4 specificity over the grammar these rules use:
 *  attribute selectors and pseudo-classes count in the second column,
 *  :not()/:has() count their most specific argument, pseudo-elements in
 *  the third; a combinator inside :has() contributes nothing. */
function specificityOf(selector: string): Specificity {
  const total: Specificity = [0, 0, 0];
  let rest = compact(selector);
  while (rest !== "") {
    if (rest.startsWith("::")) {
      total[2] += 1;
      rest = rest.replace(/^::[a-z-]+/, "");
    } else if (rest.startsWith(":not(") || rest.startsWith(":has(")) {
      const open = rest.indexOf("(");
      const close = matchingParen(rest, open);
      const inner = rest.slice(open + 1, close).replace(/^[+~>]/, "");
      const argument = specificityOf(inner);
      total[0] += argument[0];
      total[1] += argument[1];
      total[2] += argument[2];
      rest = rest.slice(close + 1);
    } else if (rest.startsWith(":")) {
      total[1] += 1;
      rest = rest.replace(/^:[a-z-]+/, "");
    } else if (rest.startsWith("[")) {
      total[1] += 1;
      rest = rest.slice(rest.indexOf("]") + 1);
    } else {
      throw new Error(`unmodelled selector piece: ${rest}`);
    }
  }
  return total;
}

function matchingParen(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    if (text[index] === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`unbalanced parentheses in ${text}`);
}

function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

interface StepShape {
  last: boolean;
  narration: boolean;
  nextNarration: boolean;
}

/** Does this connector selector match the step's ::after? The grammar is
 *  the two rules' own: the step attribute, :not(:last-child),
 *  :not([narration]) and :has(+ [narration]). */
function matches(selector: string, step: StepShape): boolean {
  const pieces = compact(selector);
  if (pieces.includes(":not(:last-child)") && step.last) return false;
  if (pieces.includes(":not([data-tf-activity-narration])") && step.narration)
    return false;
  if (
    pieces.includes(":has(+[data-tf-activity-narration])") &&
    !step.nextNarration
  )
    return false;
  return true;
}

/** The cascade for one property on one step's ::after: among matching
 *  rules, the highest specificity wins; source order breaks ties. */
function resolveAfter(
  rules: readonly ConnectorRule[],
  step: StepShape,
  property: string,
): string | undefined {
  let winner: { value: string; specificity: Specificity } | undefined;
  for (const rule of rules) {
    const value = rule.declarations[property];
    if (value === undefined || !matches(rule.selector, step)) continue;
    const specificity = specificityOf(rule.selector);
    if (
      winner === undefined ||
      compareSpecificity(specificity, winner.specificity) >= 0
    ) {
      winner = { value, specificity };
    }
  }
  return winner?.value;
}
