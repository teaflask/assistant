// The stylesheet rides rem for type and spacing — right for the npm
// distribution, where the host owns the page and can be expected to own
// a sane root font-size, but wrong for the script-tag widget dropped
// into a host that sets html { font-size: 62.5% }: the rem parts shrink
// to ~9px while the px parts hold, an uneven degrade. The element
// bundle converts at build time against the CSS-standard 16px root; the
// npm dist/styles.css is untouched. Documented tradeoff: media-query
// rems convert too, so a visitor's enlarged browser font-size no longer
// scales the widget — traded for rendering identically on every host.
//
// This file is the CSS half of the rule: it sees the compiled
// stylesheet and nothing else. The JS/TS half — rem literals authored
// in inline styles, custom-property assignments, setProperty calls and
// templates, which are structurally invisible to a CSS-text scan — is
// scripts/rem-in-source.mjs, enforced by tests/rem-in-source.test.ts,
// with the out-of-scope surfaces and their compensating controls stated
// in that scanner's header.

// A number token immediately followed by the rem unit: not preceded by
// an identifier/number character (keeps `--lorem` and `1.5remish`-style
// idents out), not followed by one (keeps `remaining`-style idents out).
const REM_VALUE = /(?<![\w.-])(-?(?:\d+\.\d+|\d+|\.\d+))rem(?![\w-])/g;

// The build-failing tripwire that keeps the pattern above honest: any
// digit still wearing the rem unit after the pass means the stylesheet
// grew a shape the pattern misses. Two shapes are legitimate survivors —
// Tailwind's escaped arbitrary-value class SELECTORS
// (`.h-\[calc\(100dvh-2rem\)\]{…}`, `calc\(0\.5rem_…`), where rem is
// part of a class name the component's className carries verbatim, so
// rewriting it would unhook the rule; their declaration values still
// convert. In selector position the unit is always followed by an
// escape or Tailwind's `_` space substitute, which is how the tripwire
// tells them apart.
const SURVIVING_REM = /\drem(?![\w\\_-])/;

export function transformRemToPx(cssText, rootFontSizePx = 16) {
  const transformed = cssText.replace(
    REM_VALUE,
    (_match, value) => `${_asCleanNumber(Number(value) * rootFontSizePx)}px`,
  );
  const survivor = SURVIVING_REM.exec(transformed);
  if (survivor !== null) {
    const at = survivor.index;
    throw new Error(
      `rem-to-px left a rem value behind near ` +
        `"…${transformed.slice(Math.max(0, at - 40), at + 20)}…" — ` +
        `the pattern needs updating for this stylesheet shape.`,
    );
  }
  return transformed;
}

function _asCleanNumber(value) {
  return String(Number(value.toFixed(4)));
}
