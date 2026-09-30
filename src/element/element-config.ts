// The script-tag distribution's config surface. Attributes carry
// everything a string can say; anything richer — callbacks, the theme
// object, suggestions — is a JS property on the element. Both halves
// resolve to ordinary <TeaflaskAssistant> props here, in pure
// functions the element calls on every render.

import { createElement } from "react";

import type {
  AssistantTheme,
  AssistantThemeMode,
} from "../appearance/theme.js";
import type { AssistantCompanionProps } from "../components/assistant-companion.js";
import type { AssistantPageProps } from "../components/assistant-page.js";
import { CompanionMarkImage } from "../components/companion-mark-image.js";
import type { AssistantSuggestionInput } from "../components/conversation-view.js";
import type { TeaflaskAssistantProps } from "../components/teaflask-assistant.js";
import type { TeaflaskAssistantProviderProps } from "../components/teaflask-assistant-provider.js";
import type { ActionsAdapter } from "../contract/actions-adapter.js";
import {
  isReservedToolViewKey,
  type ToolViewRegistration,
  type ToolViewRegistry,
} from "../core/tool-view.js";

export const ELEMENT_TAG_NAME = "teaflask-assistant";
export const PAGE_ELEMENT_TAG_NAME = "teaflask-assistant-page";

/** Attribute changes re-render the mounted tree; `publishable-key` and
 *  `base-url` deliberately rebuild the session (they key it). */
export const OBSERVED_ELEMENT_ATTRIBUTES = [
  "publishable-key",
  "base-url",
  "mode",
  "corner",
  "hotkey",
  "companion-mark-src",
] as const;

/** The page surface has no companion, palette, or hotkey — its attribute
 *  set is the session pair plus the page's own chrome knobs. `heading`
 *  feeds the React `title` prop under a different name on purpose: the
 *  global HTML `title` attribute would also render a native tooltip over
 *  the whole surface and name the region for screen readers. */
export const OBSERVED_PAGE_ELEMENT_ATTRIBUTES = [
  "publishable-key",
  "base-url",
  "mode",
  "heading",
  "frameless",
] as const;

const THEME_MODES: readonly AssistantThemeMode[] = ["light", "dark", "auto"];
const CORNERS: readonly NonNullable<AssistantCompanionProps["corner"]>[] = [
  "bottom-right",
  "bottom-left",
];

export interface ElementAttributeReader {
  getAttribute(name: string): string | null;
}

export interface ParsedElementConfig {
  /** Null until the attribute lands — the element mounts nothing. */
  publishableKey: string | null;
  baseUrl?: string;
  mode?: AssistantThemeMode;
  corner?: AssistantCompanionProps["corner"];
  /** The attribute value "false" disables the chord. Any other value is
   *  handed to the root verbatim — it owns the spec grammar and its own
   *  warn-then-disable. */
  hotkey?: string | false;
  /** An image URL for the host's companion mark; unset keeps the
   *  package's flask. */
  companionMarkSrc?: string;
  /** Invalid attribute values, one sentence each; the element warns each
   *  once and the invalid value degrades to the default. */
  warnings: readonly string[];
}

export function parseElementConfig(
  element: ElementAttributeReader,
): ParsedElementConfig {
  const warnings: string[] = [];
  return {
    publishableKey: _nonEmptyAttribute(element, "publishable-key"),
    baseUrl: _nonEmptyAttribute(element, "base-url") ?? undefined,
    mode: _oneOfAttribute(element, "mode", THEME_MODES, warnings),
    corner: _oneOfAttribute(element, "corner", CORNERS, warnings),
    hotkey: _hotkeyAttribute(element),
    companionMarkSrc:
      _nonEmptyAttribute(element, "companion-mark-src") ?? undefined,
    warnings,
  };
}

/** A parse whose publishable key arrived — the only config that mounts. */
export type MountableElementConfig = ParsedElementConfig & {
  publishableKey: string;
};

export interface ParsedPageElementConfig {
  /** Null until the attribute lands — the element mounts nothing. */
  publishableKey: string | null;
  baseUrl?: string;
  mode?: AssistantThemeMode;
  /** Becomes AssistantPage's `title` prop — see the attribute list for
   *  why the attribute cannot be named `title` itself. */
  heading?: string;
  frameless?: boolean;
  /** Invalid attribute values, one sentence each; the element warns each
   *  once and the invalid value degrades to the default. */
  warnings: readonly string[];
}

export function parsePageElementConfig(
  element: ElementAttributeReader,
): ParsedPageElementConfig {
  const warnings: string[] = [];
  return {
    publishableKey: _nonEmptyAttribute(element, "publishable-key"),
    baseUrl: _nonEmptyAttribute(element, "base-url") ?? undefined,
    mode: _oneOfAttribute(element, "mode", THEME_MODES, warnings),
    heading: _nonEmptyAttribute(element, "heading") ?? undefined,
    frameless: _booleanAttribute(element, "frameless", warnings),
    warnings,
  };
}

/** A parse whose publishable key arrived — the only config that mounts. */
export type MountablePageElementConfig = ParsedPageElementConfig & {
  publishableKey: string;
};

/**
 * The rich half of the config: settable only as JS properties on the
 * element, before or after it upgrades.
 *
 * Every one of these admits `null`, because assigning null is how a
 * plain-JS host clears a property it once set and there is no compiler
 * to tell it otherwise. For all but `onNavigate` that means "not
 * wired", identical to never setting it — the React props underneath
 * test for `undefined`, so a null reaching them would variously throw
 * (the theme mapper indexes it, the adapter's kind is dereferenced) or
 * quietly lie (`getEndUserToken !== undefined` would announce an
 * identity the page cannot actually produce).
 */
export interface ElementHostProps {
  /**
   * Leave unset and navigation requests become full-page loads
   * (`window.location.assign`) — the honest default for a non-React
   * host. Assign a function to drive your own router instead, or
   * `null` to declare this page cannot navigate (the assistant is told
   * so in-band, exactly like omitting the React prop). The one
   * property where null says something other than "unset".
   */
  onNavigate?: ((path: string) => void | Promise<void>) | null;
  getEndUserToken?: TeaflaskAssistantProps["getEndUserToken"] | null;
  actionsAdapter?: ActionsAdapter | null;
  onError?: ((error: Error) => void) | null;
  theme?: AssistantTheme | null;
  suggestions?: readonly AssistantSuggestionInput[] | null;
  /**
   * The tool-view registry (core/tool-view.ts), keyed exactly like the
   * React provider's `toolViews` prop — one registration concept, two
   * spellings. Assignable before or after the element upgrades, and a
   * late assignment reaches calls already on screen, not just future
   * ones. Deliberately a JS property with NO attribute spelling: a
   * registry carries functions, and an attribute form would mean
   * deserializing executable text out of markup — exactly what
   * "executable code never rides the wire" and a strict CSP forbid.
   * Reserved `teaflask.*` keys and wrong-shaped registrations are
   * dropped one by one with a named warning; well-formed siblings keep
   * working.
   */
  toolViews?: ToolViewRegistry | null;
}

/** Null and unset are the same answer everywhere but navigation. */
function _unsetIfCleared<Value>(value: Value | null | undefined) {
  return value ?? undefined;
}

export const ELEMENT_HOST_PROP_KEYS = [
  "onNavigate",
  "getEndUserToken",
  "actionsAdapter",
  "onError",
  "theme",
  "suggestions",
  "toolViews",
] as const satisfies readonly (keyof ElementHostProps)[];

/** The distribution's navigation default: a plain host has no client
 *  router, so an app-relative path becomes a full-page load. */
export function navigateByFullPageLoad(path: string): void {
  window.location.assign(path);
}

const ACTIONS_ADAPTER_KINDS = ["cookies", "headers", "request"];

/**
 * The adapter's `kind` is the one discriminant a plain-JS host can
 * mistype, and the executor reads it positively three times — so
 * `"cookie"` wouldn't throw, it would fall through to a fetch with
 * `credentials: "include"` silently dropped and the host's headers
 * silently skipped. That surfaces as unexplained 401s from the
 * customer's own API. An unusable adapter is refused here instead: the
 * assistant reports it cannot perform actions, which is a supported,
 * in-band state, and the warning names the typo.
 */
function _usableActionsAdapter(
  adapter: ActionsAdapter | null | undefined,
  warnings: string[],
): ActionsAdapter | undefined {
  if (adapter === null || adapter === undefined) {
    return undefined;
  }
  const kind: string = adapter.kind;
  if (!ACTIONS_ADAPTER_KINDS.includes(kind)) {
    warnings.push(
      `Unrecognized actionsAdapter kind "${kind}" — expected one of ` +
        `${ACTIONS_ADAPTER_KINDS.join(", ")}. This page cannot perform ` +
        `actions until it is corrected.`,
    );
    return undefined;
  }
  return adapter;
}

/**
 * The registry is the one host property whose wrong shapes are legion,
 * and a wrong shape must cost exactly the registration carrying it —
 * never its siblings, never the surface (the rung-failure rule,
 * tool-views.md). Reserved `teaflask.*` keys are refused here by name:
 * the resolution ladder refuses them again downstream, silently — this
 * is the door's own lock, with a warning a page author can act on.
 * Survivors pass through by reference, because the view slot tracks a
 * failed adapter by object identity.
 */
function _usableToolViews(
  value: ToolViewRegistry | null | undefined,
  warnings: string[],
): ToolViewRegistry | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const registry: unknown = value;
  if (
    typeof registry !== "object" ||
    registry === null ||
    Array.isArray(registry)
  ) {
    const shape = Array.isArray(registry) ? "an array" : `a ${typeof registry}`;
    warnings.push(
      `Ignoring toolViews — expected an object keyed by view key or ` +
        `tool name, got ${shape}.`,
    );
    return undefined;
  }
  // Null prototype: an own key literally named "__proto__" must land as
  // data, judged like any other key — never mutate the output's
  // prototype on assignment. The ladder's lookups are own-guarded, so a
  // null-proto registry is safe downstream.
  const usable: Record<string, ToolViewRegistration> = Object.create(
    null,
  ) as Record<string, ToolViewRegistration>;
  for (const [key, registration] of Object.entries(registry)) {
    if (isReservedToolViewKey(key)) {
      warnings.push(
        `Ignoring toolViews["${key}"] — the "teaflask." namespace is ` +
          `reserved for package built-ins; host registrations never ` +
          `resolve under it.`,
      );
      continue;
    }
    const survivor = _usableToolViewRegistration(key, registration, warnings);
    if (survivor !== undefined) {
      usable[key] = survivor;
    }
  }
  return usable;
}

function _usableToolViewRegistration(
  key: string,
  value: unknown,
  warnings: string[],
): ToolViewRegistration | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    warnings.push(
      `Ignoring toolViews["${key}"] — a registration must be an object ` +
        `carrying a numeric version and a view and/or icon adapter.`,
    );
    return undefined;
  }
  const entry = value as { version?: unknown; view?: unknown; icon?: unknown };
  if (typeof entry.version !== "number" || !Number.isFinite(entry.version)) {
    warnings.push(
      `Ignoring toolViews["${key}"] — its version must be a finite number.`,
    );
    return undefined;
  }
  for (const role of ["view", "icon"] as const) {
    const adapter: unknown = entry[role];
    if (adapter === undefined || adapter === null) {
      continue;
    }
    if (
      typeof adapter !== "object" ||
      typeof (adapter as { mount?: unknown }).mount !== "function"
    ) {
      warnings.push(
        `Ignoring toolViews["${key}"] — its ${role} has no callable ` +
          `mount(container, props).`,
      );
      return undefined;
    }
  }
  if (entry.view !== null && entry.icon !== null) {
    return value as ToolViewRegistration;
  }
  // A null role is a cleared role (the property convention above) — but
  // the resolution ladder reads presence as `!== undefined`, so a null
  // must not travel. Normalize into a copy; the adapters themselves
  // keep their identity.
  const normalized: {
    version: number;
    view?: ToolViewRegistration["view"];
    icon?: ToolViewRegistration["icon"];
  } = { version: entry.version };
  if (entry.view !== null && entry.view !== undefined) {
    normalized.view = entry.view as ToolViewRegistration["view"];
  }
  if (entry.icon !== null && entry.icon !== undefined) {
    normalized.icon = entry.icon as ToolViewRegistration["icon"];
  }
  return normalized;
}

export interface ResolvedElementProps {
  props: TeaflaskAssistantProps;
  /** Unusable host values, one sentence each; the caller warns once. */
  warnings: readonly string[];
}

export function resolveElementProps(
  config: MountableElementConfig,
  hostProps: ElementHostProps,
): ResolvedElementProps {
  const warnings: string[] = [];
  return {
    props: {
      publishableKey: config.publishableKey,
      baseUrl: config.baseUrl,
      mode: config.mode,
      corner: config.corner,
      hotkey: config.hotkey,
      companionMark: _companionMarkOf(config.companionMarkSrc),
      onNavigate: _resolveNavigate(hostProps.onNavigate),
      getEndUserToken: _unsetIfCleared(hostProps.getEndUserToken),
      actionsAdapter: _usableActionsAdapter(hostProps.actionsAdapter, warnings),
      onError: _unsetIfCleared(hostProps.onError),
      theme: _unsetIfCleared(hostProps.theme),
      suggestions: _unsetIfCleared(hostProps.suggestions),
      toolViews: _usableToolViews(hostProps.toolViews, warnings),
    },
    warnings,
  };
}

/** The attribute's image, as the node the provider's `companionMark`
 *  takes (companion-mark-image.tsx: a broken URL warns once and falls
 *  back to the flask). Keyed by the URL so a changed attribute starts
 *  the load, and the fallback, over. */
function _companionMarkOf(src: string | undefined) {
  if (src === undefined) {
    return undefined;
  }
  return createElement(CompanionMarkImage, { key: src, src });
}

export interface ResolvedPageElementProps {
  providerProps: TeaflaskAssistantProviderProps;
  pageProps: AssistantPageProps;
  /** Unusable host values, one sentence each; the caller warns once. */
  warnings: readonly string[];
}

/** The page element mounts the provider and the page separately (the
 *  batteries root would drag a companion in), so its config resolves to
 *  the two prop bags rather than one. */
export function resolvePageElementProps(
  config: MountablePageElementConfig,
  hostProps: ElementHostProps,
): ResolvedPageElementProps {
  const warnings: string[] = [];
  return {
    providerProps: {
      publishableKey: config.publishableKey,
      baseUrl: config.baseUrl,
      mode: config.mode,
      onNavigate: _resolveNavigate(hostProps.onNavigate),
      getEndUserToken: _unsetIfCleared(hostProps.getEndUserToken),
      actionsAdapter: _usableActionsAdapter(hostProps.actionsAdapter, warnings),
      onError: _unsetIfCleared(hostProps.onError),
      theme: _unsetIfCleared(hostProps.theme),
      toolViews: _usableToolViews(hostProps.toolViews, warnings),
    },
    pageProps: {
      title: config.heading,
      frameless: config.frameless,
      suggestions: _unsetIfCleared(hostProps.suggestions),
    },
    warnings,
  };
}

function _resolveNavigate(
  onNavigate: ElementHostProps["onNavigate"],
): TeaflaskAssistantProps["onNavigate"] {
  if (onNavigate === null) {
    return undefined;
  }
  return onNavigate ?? navigateByFullPageLoad;
}

function _nonEmptyAttribute(
  element: ElementAttributeReader,
  name: string,
): string | null {
  const value = element.getAttribute(name);
  return value === null || value === "" ? null : value;
}

function _oneOfAttribute<Allowed extends string>(
  element: ElementAttributeReader,
  name: string,
  allowed: readonly Allowed[],
  warnings: string[],
): Allowed | undefined {
  const value = _nonEmptyAttribute(element, name);
  if (value === null) {
    return undefined;
  }
  if ((allowed as readonly string[]).includes(value)) {
    return value as Allowed;
  }
  warnings.push(
    `Unrecognized ${name} "${value}" — expected one of ${allowed.join(", ")}. ` +
      `Using the default instead.`,
  );
  return undefined;
}

/** A bare attribute (`frameless` with no value) reads as true, the two
 *  spelled-out words mean what they say, and anything else warns and
 *  degrades to the default — a plain-JS host has no compiler to catch
 *  `frameless="ture"`, so the element is the guard. */
function _booleanAttribute(
  element: ElementAttributeReader,
  name: string,
  warnings: string[],
): boolean | undefined {
  const value = element.getAttribute(name);
  if (value === null) {
    return undefined;
  }
  if (value === "" || value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  warnings.push(
    `Unrecognized ${name} "${value}" — expected "true" or "false". ` +
      `Using the default instead.`,
  );
  return undefined;
}

function _hotkeyAttribute(
  element: ElementAttributeReader,
): string | false | undefined {
  const value = _nonEmptyAttribute(element, "hotkey");
  if (value === null) {
    return undefined;
  }
  return value === "false" ? false : value;
}
