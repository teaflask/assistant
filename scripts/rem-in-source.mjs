// The JS/TS half of the rem law. rem-to-px.mjs converts the element
// bundle's stylesheet and tripwires on any rem its pattern missed —
// but it scans CSS text only, so a rem literal authored in a JS/TS
// inline style (a style={{…}} object, a "--prop": "…rem" custom
// property, a .style.setProperty call, a `${n}rem` template) was
// structurally invisible to it. That is exactly how a fallback card
// shipped 48rem/0.5rem/0.75rem box metrics that tracked a host's html
// { font-size } while claiming to depend on nothing. This scanner
// closes that surface: it walks a source file's string and template
// literals — the compiler's lexer, not a text regex, so comments,
// regex literals and JSX text are excluded by construction — and
// reports every digit-adjacent rem, every `${n}rem` template tail, and
// every bare "rem" unit literal (the concatenation shape) it finds.
//
// Enforced by tests/rem-in-source.test.ts over src/** and fixtures/**.
// Test-time only, on purpose: the required CI check runs `npm test`
// before `npm run build:element` in the same job, so a build-time hook
// in build-element.mjs would add zero coverage while coupling the
// typescript module into every element build and bundle-weight test for
// a function the build never calls.
//
// The legitimate survivor, mirroring the CSS tripwire's escaped-selector
// exception: a Tailwind arbitrary-value class token in a className
// string (`h-[calc(100dvh-2rem)]`, `pb-[calc(0.5rem_+_env(…))]`), where
// the rem is part of a class name that must match the stylesheet's
// selector byte for byte — rewriting it would unhook the rule, and the
// stylesheet side already converts the declaration's value. The
// discriminator is lexical, like the CSS side's `(?![\w\\_-])`: the
// match sits inside an unclosed `[` whose opener is immediately preceded
// by `-` (the utility-prefix shape `h-[`, `pb-[`, `grid-cols-[`). A
// Tailwind arbitrary PROPERTY class (`[margin:2rem]`, no `-` before the
// bracket) would flag — none exists, and if one arrives the law goes red
// and the author allowlists it deliberately: fail-loud in the ambiguous
// middle.
//
// What this scanner cannot see, and what does or does not compensate.
// A control is credited below only for what it actually checks — a
// residual marked uncompensated is uncompensated, and saying so beats a
// false all-clear (the failure shape this ticket exists to end):
// - A rem value whose unit lives in a NON-LITERAL expression (a
//   variable, a function result — or spelled through escape sequences:
//   detection reads source text). Everything else about runtime style
//   writes IS visible here: the scanner reads every string and template
//   literal in the file, so a rem literal argument to
//   element.style.setProperty(…), a `${n}rem` template, and the bare
//   "rem" unit half of a String(n) + "rem" join are all caught. No
//   hand-maintained census of the write sites lives here — a count
//   drifts silently as sites are added (this header shipped one that
//   undercounted by half); the criterion does not: every write through
//   element.style in src/** (property assignment or setProperty — the
//   shape TVC-171's style-prop ban cannot see) currently passes its
//   value text through string or template literals this scanner reads,
//   px/unitless today (dock-reflow also restores the host root's own
//   saved margin/transition text — the host's property, returned
//   untouched). THAT PREMISE is what the safety conclusion rests on; it
//   is not mechanically enforced, and it is falsified by any future
//   site that joins its unit from data instead of a literal — the
//   scanner will not notice that arrival, a reviewer must. The residual
//   is otherwise UNCOMPENSATED by any general check: TVC-171
//   (tests/tvc/tvc-lint.test.ts) bans only the JSX style prop — the
//   element.style writes bypass it on purpose — and
//   tests-e2e/boundary.spec.ts's sixth arm asserts four computed box
//   metrics of one surface (the fallback card) under a 62.5% root, a
//   spot check, not coverage. Accepted because authoring it requires
//   deliberately splitting digit from unit across expressions, and the
//   sweeps found no such site; a per-surface computed-style arm is the
//   compensation to add if one ever ships.
// - node_modules. UNCOMPENSATED mechanically: no test pins third-party
//   code rem-free (tests/bundle-closure.test.ts guards subpath-entry
//   discipline — which entries may pull CopilotKit and kin — not the
//   element graph's style behavior). What stands instead: the reviewed
//   dependency inventory carries no library that writes inline styles
//   (no radix, no floating-ui), and the element stylesheet itself is
//   baked to px, so only a dependency writing element.style at runtime
//   could reintroduce rem.
// - Host-supplied theme strings passing through themeToStyleVars
//   (src/appearance/theme.ts): a host that configures radius "0.25rem"
//   gets rem, by design — the host owns that choice; the pass-through is
//   pinned at tests/appearance-theme.test.ts.
// - The fixture harnesses' index.html <style> blocks: simulated host
//   pages, never shipped — host-page CSS is where rem is legitimately
//   the host's business. The transcript harness runs at the
//   browser-default 16px root; fixtures/element/index.html deliberately
//   toggles html { font-size: 62.5% } as the uneven-degrade demo the
//   CSS transform exists for.
// - The dashboard and marketing-site trees, which author real rem inline
//   styles (the dashboard shell's sidebar-width custom properties and its
//   sidebar's SIDEBAR_WIDTH constants, the marketing site's hero
//   animation offsets) and are deliberately OUT of scope: rem-to-px.mjs's
//   own header draws the line at "the host owns the page", and the
//   dashboard and the marketing site are the host — each owns its page
//   and its root font-size. Named here so the boundary reads as a
//   decision, not an omission.

import ts from "typescript";

// A digit wearing the rem unit inside a string literal. The trailing
// guard keeps `remaining`-style identifiers out but deliberately admits
// Tailwind's `_` space substitute (`0.5rem_+_…`), so those matches reach
// the survivor rule and prove it against real shapes instead of
// vanishing before classification.
const REM_IN_STRING = /\d(?:\.\d+)?rem(?![A-Za-z0-9-])/g;

// A template span whose literal begins with the unit — `${n}rem`, the
// shape where the substitution supplies the digit.
const REM_AFTER_SUBSTITUTION = /^rem(?![A-Za-z0-9-])/;

// A string literal that IS the unit — `String(n) + "rem"`, the
// concatenation shape where no single literal ever holds digit and unit
// together. Exact match only: prose mentioning rem stays invisible.
const BARE_REM_LITERAL = "rem";

export function findAuthoredRemInSource(sourceText, filePath) {
  const scriptKind = filePath.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const source = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    false,
    scriptKind,
  );
  // parseDiagnostics is internal but stable; the public routes need a
  // full Program, which this per-file lex check does not. A file the
  // parser cannot lex must redden the law, not shrink its input.
  const diagnostics = source.parseDiagnostics;
  if (diagnostics !== undefined && diagnostics.length > 0) {
    const first = diagnostics[0];
    throw new Error(
      `rem-in-source cannot lex ${filePath}: ` +
        ts.flattenDiagnosticMessageText(first.messageText, " "),
    );
  }
  const violations = [];
  const excused = [];
  // ONE locating mechanism for every branch: a finding sits at a FILE
  // position — its line is the match's own line (a rem on line 3 of a
  // multi-line template reports line 3), and its excerpt is the ±30/+20
  // window of surrounding SOURCE text, so a short literal like "48rem"
  // still carries the code around it and an allowlist row keyed on the
  // excerpt names one site, not every same-shaped rem in the file.
  const findingAt = (filePos, matchLength) => ({
    file: filePath,
    line: source.getLineAndCharacterOfPosition(filePos).line + 1,
    excerpt: sourceText.slice(
      Math.max(0, filePos - 30),
      filePos + matchLength + 20,
    ),
  });
  // Detection runs over the literal's source-text slice (delimiters
  // included — harmless to the patterns), which is what makes file
  // positions exact. The cost, stated: a rem spelled through an escape
  // sequence would evade; that sits with the non-literal-expression
  // residual in the header above.
  const scanChunk = (chunkStart, chunkEnd) => {
    const raw = sourceText.slice(chunkStart, chunkEnd);
    for (const match of raw.matchAll(REM_IN_STRING)) {
      const isExcused = _isInsideArbitraryValueBracket(raw, match.index);
      const finding = {
        ...findingAt(chunkStart + match.index, match[0].length),
        excused: isExcused,
      };
      (isExcused ? excused : violations).push(finding);
    }
  };
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const start = node.getStart(source);
      scanChunk(start, node.end);
      // Whole-literal check only: a template SPAN equal to "rem" is the
      // `${n}rem` shape, recorded below — not this one twice.
      if (node.text === BARE_REM_LITERAL) {
        violations.push({
          ...findingAt(start, node.end - start),
          excused: false,
        });
      }
    } else if (ts.isTemplateExpression(node)) {
      scanChunk(node.head.getStart(source), node.head.end);
      for (const span of node.templateSpans) {
        const literalStart = span.literal.getStart(source);
        scanChunk(literalStart, span.literal.end);
        if (REM_AFTER_SUBSTITUTION.test(span.literal.text)) {
          // Located at the span's closing `}`, so the excerpt window
          // reaches back over the substitution expression itself.
          violations.push({
            ...findingAt(literalStart, "}rem".length),
            excused: false,
          });
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(source);
  return { violations, excused };
}

// Walk backwards from the match: inside an unclosed `[` whose opener is
// immediately preceded by `-`, the rem is part of a Tailwind
// arbitrary-value class token, not a style value.
function _isInsideArbitraryValueBracket(text, index) {
  let closed = 0;
  for (let at = index - 1; at >= 0; at -= 1) {
    const char = text[at];
    if (char === "]") {
      closed += 1;
    } else if (char === "[") {
      if (closed === 0) {
        return at > 0 && text[at - 1] === "-";
      }
      closed -= 1;
    }
  }
  return false;
}
