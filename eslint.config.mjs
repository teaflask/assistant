import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// The package's lint rig, two layers. Layer 1 carries the frontend
// rulebook's architecture-neutral laws verbatim in spirit (strict
// type-aware linting, zero warnings, suppressions carry reasons, a11y,
// tokens over invention). Layer 2 re-parameterizes the architecture laws
// to THIS package's architecture: transport is the only fetch/SSE layer,
// primitives is the only raw-element layer, and the dogfood boundary
// bans app internals outright. Deliberately not a copy of the
// dashboard's eslint config — its Next config, page-layout law, and
// shadcn paths are app-specific and would need exemptions from day one.

// Numbered-scale palette classes (bg-red-500). The semantic tf tokens
// don't match; variant prefixes (hover:, dark:) do.
const PALETTE_CLASS_CORE =
  "(bg|text|border|ring|from|via|to|fill|stroke|divide|outline|decoration|accent|caret|shadow)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\\d+";
const RAW_PALETTE_CLASSES = `(^|:)${PALETTE_CLASS_CORE}`;
const RAW_PALETTE_IN_ANY_STRING = `(^|[\\s:])${PALETTE_CLASS_CORE}`;
// Numeric-literal arbitrary values only (w-[347px]); calc()/var() values
// and data-[...] variants stay legal.
const ARBITRARY_LITERAL_VALUES = "-\\[[0-9.]+[a-z%]*\\]";
const ARBITRARY_COLOR_VALUES = "-\\[(#|rgb|hsl|oklch|oklab)";
// Geist restraint: borders are hairlines; elevation never comes from
// ad-hoc shadow classes.
const HEAVY_BORDER_WIDTHS = "(^|:)border(-[xy])?-[248]$";
const AD_HOC_SHADOWS = "(^|:)shadow-(2xs|xs|sm|md|lg|xl|2xl)$";

const TOKEN_RESTRICTIONS = [
  {
    pattern: RAW_PALETTE_CLASSES,
    message:
      "Raw palette color — use a tf semantic token (text-tf-foreground, bg-tf-muted, ...).",
  },
  {
    pattern: ARBITRARY_LITERAL_VALUES,
    message:
      "Arbitrary literal value — use the spacing/size scale or a design token.",
  },
  {
    pattern: ARBITRARY_COLOR_VALUES,
    message: "Arbitrary color value — use a tf semantic token.",
  },
  {
    pattern: HEAVY_BORDER_WIDTHS,
    message: "Heavy border — boundaries are the 1px hairline default.",
  },
  {
    pattern: AD_HOC_SHADOWS,
    message:
      "Ad-hoc shadow — the widget lifts surfaces via border + background, not shadow.",
  },
];

// The size law's numbers — code lines, blanks and comments skipped. The
// architecture test pins the config block below to these, so the law has
// one statement.
export const SIZE_LAW = {
  maxLines: 600,
  maxLinesPerFunction: 100,
  maxDepth: 4,
};

export default tseslint.config(
  {
    // Orval output: regenerated, never hand-edited, never linted.
    // Fixture-bench build artifacts likewise.
    ignores: ["dist/**", "*.tgz", "src/generated/**", "fixtures/*/out/**"],
  },

  // ---- Layer 1: the architecture-neutral rulebook ----

  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mjs", "knip.json"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },

  comments.recommended,
  { linterOptions: { reportUnusedDisableDirectives: "error" } },
  // Law: every suppression carries its reason.
  {
    rules: {
      "@eslint-community/eslint-comments/require-description": "error",
    },
  },

  // Law: size. Skim in five seconds — a function fits on a screen and a
  // module fits in a head. No disable and no override: over the line means
  // split. `complexity` is deliberately not a law here — the functions it
  // would flag are spec-shaped switches (the accname algorithm and kin) that
  // read worse split, and a law adopted with carve-outs is no law.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "max-lines": [
        "error",
        { max: SIZE_LAW.maxLines, skipBlankLines: true, skipComments: true },
      ],
      "max-lines-per-function": [
        "error",
        {
          max: SIZE_LAW.maxLinesPerFunction,
          skipBlankLines: true,
          skipComments: true,
          IIFEs: true,
        },
      ],
      "max-depth": ["error", SIZE_LAW.maxDepth],
    },
  },

  // Law: a11y + the hooks rules every React surface answers to.
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "jsx-a11y": jsxA11y },
    rules: { ...jsxA11y.flatConfigs.recommended.rules },
  },
  reactHooks.configs.flat.recommended,

  // Law: styling comes from the token registry, not invention. No inline
  // styles; runtime-computed values go through CSS variables.
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { react },
    settings: { react: { version: "19" } },
    rules: {
      "react/forbid-dom-props": [
        "error",
        {
          forbid: [
            {
              propName: "style",
              message:
                "No inline styles — use the tf token utilities; runtime-computed values go through CSS variables with a described disable.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "better-tailwindcss": betterTailwindcss },
    settings: {
      "better-tailwindcss": { entryPoint: "src/styles/styles.css" },
    },
    rules: {
      "better-tailwindcss/no-unknown-classes": "error",
      "better-tailwindcss/no-restricted-classes": [
        "error",
        { restrict: TOKEN_RESTRICTIONS },
      ],
      // Class strings hiding outside className are still class strings.
      "no-restricted-syntax": [
        "error",
        {
          selector: `Literal[value=/${RAW_PALETTE_IN_ANY_STRING}/]`,
          message: "Raw palette color in a string — use a tf semantic token.",
        },
        {
          selector: `TemplateElement[value.raw=/${RAW_PALETTE_IN_ANY_STRING}/]`,
          message:
            "Raw palette color in a template string — use a tf semantic token.",
        },
        // The two import-extension selectors live in this same array on
        // purpose: flat config replaces a rule's options wholesale, so
        // a second no-restricted-syntax entry elsewhere would silently
        // drop the token selectors above. They cover the forms
        // no-restricted-imports (the dogfood block below) cannot see:
        // dynamic import() and typeof import().
        {
          selector:
            'ImportExpression[source.type="Literal"][source.value=/^\\.(?!.*\\.(?:js|css|json)$)/]',
          message:
            "Dynamic import of an extensionless relative path — append .js.",
        },
        {
          selector:
            'TSImportType[source.type="Literal"][source.value=/^\\.(?!.*\\.(?:js|css|json)$)/]',
          message:
            "typeof import() of an extensionless relative path — append .js.",
        },
      ],
    },
  },

  // ---- Layer 2: the architecture laws, re-parameterized ----

  // Law: transport is the only layer that speaks the network. Everything
  // else goes through the functions it exports.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message:
            "Raw fetch is confined to src/transport/ — call its exported functions instead.",
        },
        {
          name: "EventSource",
          message:
            "Streaming is confined to src/transport/ (the replay-stream agent).",
        },
        {
          name: "XMLHttpRequest",
          message: "Raw XHR is banned — src/transport/ owns the network.",
        },
      ],
    },
  },
  {
    files: ["src/transport/**"],
    rules: { "no-restricted-globals": "off" },
  },

  // Law: raw interactive elements live only in the package's primitives
  // layer (the components/ui analogue).
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/primitives/**"],
    rules: {
      "react/forbid-elements": [
        "error",
        {
          forbid: [
            {
              element: "button",
              message: "Use <TfButton> from the primitives layer.",
            },
            {
              element: "input",
              message: "Use a primitives-layer control.",
            },
            {
              element: "textarea",
              message: "Use <TfTextarea> from the primitives layer.",
            },
            {
              element: "select",
              message: "Use a primitives-layer control.",
            },
            {
              element: "details",
              message: "Use <Disclosure> from the primitives layer.",
            },
            {
              element: "dialog",
              message: "Use a primitives-layer overlay.",
            },
            {
              element: "table",
              message: "Use a primitives-layer table if one is ever needed.",
            },
          ],
        },
      ],
    },
  },

  // Law: the dogfood boundary. The package speaks only the public
  // contract and its pinned chassis — never app internals, never a
  // framework beyond React, never CopilotKit entry points other than the
  // sanctioned v2 subpath.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/*"],
              message:
                "App internals are out of reach — the package speaks only the public /serving/v1 contract.",
            },
            {
              group: ["next", "next/*"],
              message:
                "The package must work in any React 19 host, not just Next.",
            },
            {
              regex: "^@copilotkit/(?!react-core/v2$)",
              message:
                "Only the pinned @copilotkit/react-core/v2 chassis entry is sanctioned.",
            },
            // tsc emits relative specifiers verbatim, so an extensionless
            // one ships unloadable under Node's ESM resolver. Dynamic
            // import() and typeof import() are covered by the
            // no-restricted-syntax selectors co-located with the token
            // policy above.
            {
              regex: "^\\.(?!.*\\.(?:js|css|json)$)",
              message:
                'Relative import without an explicit extension — Node\'s ESM resolver needs "./x.js" (or "./dir/index.js").',
            },
          ],
        },
      ],
    },
  },
);
