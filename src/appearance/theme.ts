// The JS half of the theming contract: a typed mirror of the 21 public
// `--tf-*` tokens (src/styles/styles.css) and the pure mapping from the
// camelCase config object to CSS variable declarations. Deliberately
// plain data and a plain function — no React — so the script-tag
// distribution can carry the exact same config object.

export type AssistantThemeMode = "light" | "dark" | "auto";

export interface AssistantThemeTokens {
  background?: string;
  foreground?: string;
  card?: string;
  cardForeground?: string;
  popover?: string;
  popoverForeground?: string;
  primary?: string;
  primaryForeground?: string;
  secondary?: string;
  secondaryForeground?: string;
  muted?: string;
  mutedForeground?: string;
  accent?: string;
  accentForeground?: string;
  destructive?: string;
  border?: string;
  input?: string;
  ring?: string;
  /** A bare number means pixels. */
  radius?: string | number;
  fontSans?: string;
  /** The UA scheme native form controls draw their indicators from
   *  ("light" or "dark") — for hosts that dark-theme with tokens alone,
   *  so native control chrome stays legible. The mode prop and the
   *  data-tf-theme attribute already flip the default; a set value wins
   *  in both modes, like every --tf-* token. */
  colorScheme?: string;
}

// Dark can flip every color, but never the geometry or the typeface —
// the stylesheet's dark block holds the same line. colorScheme is also
// mode-independent by construction: the stylesheet's dark blocks read
// no --_tf-dark-color-scheme, they already default the scheme to dark.
export type AssistantThemeDarkTokens = Omit<
  AssistantThemeTokens,
  "radius" | "fontSans" | "colorScheme"
>;

export interface AssistantTheme extends AssistantThemeTokens {
  /**
   * Values that take over whenever dark is active — via the provider's
   * `mode` prop or a `data-tf-theme="dark"` attribute on any ancestor.
   */
  dark?: AssistantThemeDarkTokens;
}

// Typed key lists so the mapping iterates without Object.keys widening,
// and so the parity test can pin this module to the stylesheet.
export const THEME_TOKEN_KEYS: readonly (keyof AssistantThemeTokens)[] = [
  "background",
  "foreground",
  "card",
  "cardForeground",
  "popover",
  "popoverForeground",
  "primary",
  "primaryForeground",
  "secondary",
  "secondaryForeground",
  "muted",
  "mutedForeground",
  "accent",
  "accentForeground",
  "destructive",
  "border",
  "input",
  "ring",
  "radius",
  "fontSans",
  "colorScheme",
];

export const DARK_THEME_TOKEN_KEYS: readonly (keyof AssistantThemeDarkTokens)[] =
  THEME_TOKEN_KEYS.filter(
    (key): key is keyof AssistantThemeDarkTokens =>
      key !== "radius" && key !== "fontSans" && key !== "colorScheme",
  );

/**
 * Maps a theme config to the CSS variables the widget roots carry
 * inline. Base values set the public `--tf-*` tokens — inline beats any
 * ambient host CSS, which is the prop-wins precedence. Dark values set
 * the private `--_tf-dark-*` mechanism variables the stylesheet's dark
 * blocks read first, so they stay out of the public token contract.
 */
export function themeToStyleVars(
  theme: AssistantTheme,
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const key of THEME_TOKEN_KEYS) {
    const value = theme[key];
    if (value !== undefined) {
      vars[`--tf-${_cssNameOf(key)}`] = _cssValueOf(value);
    }
  }
  for (const key of DARK_THEME_TOKEN_KEYS) {
    const value = theme.dark?.[key];
    if (value !== undefined) {
      vars[`--_tf-dark-${_cssNameOf(key)}`] = _cssValueOf(value);
    }
  }
  return vars;
}

function _cssNameOf(key: string): string {
  return key.replace(/[A-Z]/g, (upper) => `-${upper.toLowerCase()}`);
}

// React does not px-suffix numbers on custom properties the way it does
// on known style props, so the mapping owns the unit.
function _cssValueOf(value: string | number): string {
  return typeof value === "number" ? `${String(value)}px` : value;
}
