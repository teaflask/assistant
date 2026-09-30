"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

import {
  themeToStyleVars,
  type AssistantTheme,
  type AssistantThemeMode,
} from "../appearance/theme.js";
import type {
  ActionIntent,
  ActionsAdapter,
} from "../contract/actions-adapter.js";
import type {
  ServedAttachmentPolicy,
  ServedModelChoice,
  ServedSuggestionsConfig,
} from "../contract/assistant-config.js";
import type { VisitorTier } from "../contract/identity.js";
import type { SubscriptionStatus } from "../contract/subscriptions.js";
import type { AssistantTelemetryEvent } from "../contract/telemetry.js";
import {
  assistantSessionRegistry,
  type AssistantSessionRegistrant,
} from "../core/assistant-session-registry.js";
import type { ConversationGate } from "../core/connect-gate.js";
import { hostFillDeclines } from "../core/host-fill.js";
import type { ReadonlyCell } from "../core/observable-cell.js";
import type {
  AssistantConversationStore,
  HostCapabilities,
} from "../core/conversation-store.js";
import type {
  ExecuteActionIntent,
  HostNavigate,
} from "../core/execution-handlers.js";
import { performActionIntent } from "../transport/actions-adapter.js";
import type { ServingApiError } from "../transport/serving-error.js";
import type { TokenSession } from "../transport/token-session.js";
import type { ToolViewRegistry } from "../core/tool-view.js";
import {
  AssistantAppearanceContext,
  type AssistantAppearanceValue,
  type AssistantRootProps,
} from "./appearance-context.js";
import { ToolViewRegistryContext } from "./tool-view-registry-context.js";
import { ConversationSurfacesProvider } from "./conversation-surfaces-provider.js";
import type { AssistantSuggestionInput } from "./conversation-view.js";
import { useCell } from "./use-store-cell.js";

export interface TeaflaskAssistantProviderProps {
  publishableKey: string;
  baseUrl?: string;
  // How a signed-in host vouches for its user: an async callback (never a
  // static token) because the short-lived visitor token forces re-mints.
  getEndUserToken?: () => string | null | Promise<string | null>;
  /**
   * How this page performs the actions the org's catalog grants (the
   * http_intent execution request) — see the ActionsAdapter contract.
   * Absent means this surface cannot perform actions: the assistant is
   * told so in-band and tells the user what to do themselves.
   */
  actionsAdapter?: ActionsAdapter;
  /**
   * How this page takes the visitor to an app-relative path when the
   * assistant asks (the builtin.navigate execution request). Absent means
   * this surface cannot navigate: the assistant is told so in-band. May be
   * async; resolve once the navigation has been handed to the host's router.
   */
  onNavigate?: (path: string) => void | Promise<void>;
  onError?: (error: Error) => void;
  /**
   * Observer for the package's product-telemetry events — the approval
   * submit path's attempted/sent/dropped narration, for hosts that
   * forward product analytics (the dashboard sends these to PostHog).
   * Distinct from onError on purpose: these are events, not failures,
   * and most carry no exception.
   */
  onTelemetry?: (event: AssistantTelemetryEvent) => void;
  /**
   * JS theming over the same 21 public tokens as the CSS route, in
   * camelCase (`primaryForeground` sets `--tf-primary-foreground`), plus a
   * nested `dark` variant. Values land as inline style variables on the
   * widget roots, so an explicit prop beats ambient host CSS. Read by value
   * — a fresh literal every render never resets conversation state. Inline
   * styles need `style-src 'unsafe-inline'` (or `style-src-attr`) under a strict CSP; theme
   * through the CSS route instead if that is not allowed.
   */
  theme?: AssistantTheme;
  /**
   * Writes `data-tf-theme` on the widget roots: `"dark"` pins the dark
   * palette, `"light"` pins light even under an ancestor's dark
   * attribute, `"auto"` follows the visitor's OS preference (a CSS media
   * query — no script runs). Omit it and the attribute stays the host's
   * to manage on any ancestor.
   */
  mode?: AssistantThemeMode;
  /**
   * Your own companion mark, rendered on the corner perch and the
   * drawer's welcome inside one box the package sizes (4rem on both).
   * The package sets your node to 100% width and height of that box, so
   * a bare `<svg viewBox>` or `<img>` fills it without sizing itself;
   * keep the artwork's aspect inside the viewBox. A
   * sibling of `theme` on purpose — the mark is identity, not a theme
   * token. Read by identity like `toolViews`. Omit it for the TeaFlask
   * flask in the foreground color — `flag && <Mark />` on its false arm
   * counts as omitted, like every host fill in the package.
   */
  companionMark?: ReactNode;
  /**
   * Opening prompts for the companion drawer's first-run welcome. A bare
   * string renders as an `ask`; `{ prompt, kind }` picks the glyph. Read by
   * value like `theme`. Omit it and the drawer serves the prompts authored
   * on the organization's assistant, matched to the page's path. Passing
   * any value — even `[]` — overrides the served sets wholesale, never
   * merges: explicit JS intent beats remote config.
   */
  suggestions?: readonly AssistantSuggestionInput[];
  /**
   * The trusted-host tool-view registry (tool-views.md): adapters this
   * host compiled and deployed, keyed by the opaque namespaced key a
   * backend display annotation may name (rung 1: exact key AND version)
   * or by the host's own exact tool name (rung 2). A registration carries
   * a view, an icon, or both; absence, mismatch, or a throw falls to the
   * rung below, terminally the package default view. Adapters receive
   * exactly `ToolViewProps` — never stores, tokens, or transport, and never
   * approve/deny. `teaflask.*` keys are reserved for package built-ins.
   * Read by identity but never memo-keyed: a fresh literal every render
   * never resets conversation state (registries should still live at
   * module scope — the mount slot keys the adapter lifecycle on identity).
   */
  toolViews?: ToolViewRegistry;
  children?: ReactNode;
}

interface AssistantSessionValue {
  session: TokenSession;
  // The shared conversation engine every surface subscribes to — the
  // context only distributes the reference; all conversational state
  // lives in the store's cells, never in React state.
  store: AssistantConversationStore;
  publishableKey: string;
  // Whether the host wired getEndUserToken — the identified experience
  // (cross-device history) is expected, so the page loads it eagerly.
  identityProvided: boolean;
  // The host's navigation hookup, or null on a surface that cannot
  // navigate (the execution loop then answers navigate requests with the
  // canned unsupported error).
  navigate: HostNavigate | null;
  // The wired adapter's executor, or null on a surface that cannot
  // perform actions (the execution loop then answers http_intent
  // requests with the canned unsupported error).
  executeActionIntent: ExecuteActionIntent | null;
  // Null until the first mint answers.
  tier: VisitorTier | null;
  // A loud mint failure (bad key, origin, or end-user signer) — the whole
  // surface renders the setup error instead of a broken conversation.
  setupError: ServingApiError | null;
  // The served suggestion sets as the entry's cell, not its value: only
  // the surface that renders suggestions subscribes, so a config arriving
  // never re-renders the whole tree.
  assistantConfig: ReadonlyCell<ServedSuggestionsConfig | null>;
  // The served attachment policy from the same fetch: what the composer
  // may offer. Null hides the affordance.
  attachmentPolicy: ReadonlyCell<ServedAttachmentPolicy | null>;
  // The served model picker menu from the same fetch, as the entry's
  // cell: only the composer's shelf subscribes. Null hides the picker
  // chip entirely — the provider chip keeps the shelf.
  modelChoice: ReadonlyCell<ServedModelChoice | null>;
  // Whether the config fetch has settled (success OR failure) — the
  // shelf's slot-identity signal: blank through the fetch window, then
  // the picker or the honest provider-chip fallback.
  configAnswered: ReadonlyCell<boolean>;
  // Kicks the lazily-fetched, session-cached config read — called from
  // the drawer body's mount effect, and only when the host passed no
  // suggestions prop (explicit JS intent beats remote config).
  ensureAssistantConfig: () => void;
  // Forces a config re-read — the gate's refresh moments (a landed
  // connect, a cleared credential); the registry also rings it itself
  // on settled turns and tier flips.
  refreshAssistantConfig: () => void;
  // What stands between this visitor and their next send, as the
  // entry's cell: only the composer's gate surface subscribes.
  conversationGate: ReadonlyCell<ConversationGate>;
  // The connect standing per provider, as the entry's cell: only the
  // drawer header and connect panel subscribe. Null until the fetch
  // answers; the fetch is gated on the identified tier.
  subscriptions: ReadonlyCell<SubscriptionStatus[] | null>;
  ensureSubscriptions: () => void;
  refreshSubscriptions: () => void;
  // The connect panel's open-by-name hook: a parked ask the drawer consumes
  // when it discloses (rung by requestSubscriptionConnect on the send's
  // SUBSCRIPTION_CONNECT_REQUIRED refusal; a ring while unmounted parks).
  connectOpenRequested: ReadonlyCell<boolean>;
  requestSubscriptionConnect: () => void;
  acknowledgeSubscriptionConnect: () => void;
  reportError: (error: Error) => void;
}

const AssistantSessionContext = createContext<AssistantSessionValue | null>(
  null,
);

export function useAssistantSession(): AssistantSessionValue {
  const value = useContext(AssistantSessionContext);
  if (value === null) {
    throw new Error(
      "Teaflask assistant components must be rendered inside <TeaflaskAssistantProvider>.",
    );
  }
  return value;
}

/** The tolerant read for components with a degraded no-session rendering
 *  (the composer's paperclip, an attachment's inline image) — outside the
 *  provider they hide the affordance instead of throwing, which is also
 *  what lets welcome-branch tests render the view bare. */
export function useOptionalAssistantSession(): AssistantSessionValue | null {
  return useContext(AssistantSessionContext);
}

/**
 * Owns the visitor-token session and the identity handshake. Deliberately
 * no visitorToken, data, or agent props — the package speaks only the
 * public contract (each of those would be a dogfood escape hatch).
 */
export function TeaflaskAssistantProvider({
  publishableKey,
  baseUrl,
  getEndUserToken,
  actionsAdapter,
  onNavigate,
  onError,
  onTelemetry,
  theme,
  mode,
  companionMark,
  suggestions,
  toolViews,
  children,
}: TeaflaskAssistantProviderProps) {
  const host = useHostCallbackRefs({
    getEndUserToken,
    actionsAdapter,
    onNavigate,
    onError,
    onTelemetry,
  });
  const value = useSessionRegistration({ publishableKey, baseUrl, host });
  const appearance = useAppearanceValue({
    theme,
    mode,
    companionMark,
    suggestions,
  });

  return (
    <AssistantSessionContext.Provider value={value}>
      <AssistantAppearanceContext.Provider value={appearance}>
        <ToolViewRegistryContext.Provider value={toolViews ?? null}>
          <ConversationSurfacesProvider store={value.store}>
            {children}
          </ConversationSurfacesProvider>
        </ToolViewRegistryContext.Provider>
      </AssistantAppearanceContext.Provider>
    </AssistantSessionContext.Provider>
  );
}

interface HostCallbacks {
  identityProvided: boolean;
  actionsProvided: boolean;
  navigationProvided: boolean;
  telemetryProvided: boolean;
  resolveEndUserToken: () => string | null | Promise<string | null>;
  hostNavigate: HostNavigate;
  executeActionIntent: ExecuteActionIntent;
  reportError: (error: Error) => void;
  recordTelemetry: (event: AssistantTelemetryEvent) => void;
  hostCapabilitiesOf: () => HostCapabilities;
}

/** The host's callbacks behind identity-stable wrappers, so hosts that
 *  pass inline arrows never disturb the session or the store. */
function useHostCallbackRefs({
  getEndUserToken,
  actionsAdapter,
  onNavigate,
  onError,
  onTelemetry,
}: Pick<
  TeaflaskAssistantProviderProps,
  | "getEndUserToken"
  | "actionsAdapter"
  | "onNavigate"
  | "onError"
  | "onTelemetry"
>): HostCallbacks {
  // Latest-callback refs keep the TokenSession identity stable across
  // re-renders that only changed the closures (hosts often pass inline
  // arrows). Updated in an effect per the hooks lint law.
  const getEndUserTokenRef = useRef(getEndUserToken);
  const actionsAdapterRef = useRef(actionsAdapter);
  const onNavigateRef = useRef(onNavigate);
  const onErrorRef = useRef(onError);
  const onTelemetryRef = useRef(onTelemetry);
  useEffect(() => {
    getEndUserTokenRef.current = getEndUserToken;
    actionsAdapterRef.current = actionsAdapter;
    onNavigateRef.current = onNavigate;
    onErrorRef.current = onError;
    onTelemetryRef.current = onTelemetry;
  });
  const identityProvided = getEndUserToken !== undefined;
  const actionsProvided = actionsAdapter !== undefined;
  const navigationProvided = onNavigate !== undefined;

  const resolveEndUserToken = useCallback(
    () => getEndUserTokenRef.current?.() ?? null,
    [],
  );
  const hostNavigate = useCallback(async (path: string) => {
    await onNavigateRef.current?.(path);
  }, []);
  const executeActionIntent = useCallback(
    (intent: ActionIntent) =>
      performActionIntent(_wiredAdapterOf(actionsAdapterRef.current), intent),
    [],
  );
  const reportError = useCallback((error: Error) => {
    onErrorRef.current?.(error);
  }, []);
  const recordTelemetry = useCallback((event: AssistantTelemetryEvent) => {
    onTelemetryRef.current?.(event);
  }, []);
  const telemetryProvided = onTelemetry !== undefined;

  // What this page can execute, read fresh by the store at each execution
  // pass — hosts re-wire navigation/actions across renders and the store's
  // identity must not depend on theirs.
  const hostCapabilitiesRef = useRef<HostCapabilities>({
    navigate: null,
    executeActionIntent: null,
  });
  useEffect(() => {
    hostCapabilitiesRef.current = {
      navigate: navigationProvided ? hostNavigate : null,
      executeActionIntent: actionsProvided ? executeActionIntent : null,
    };
  });
  const hostCapabilitiesOf = useCallback(() => hostCapabilitiesRef.current, []);

  return {
    identityProvided,
    actionsProvided,
    navigationProvided,
    telemetryProvided,
    resolveEndUserToken,
    hostNavigate,
    executeActionIntent,
    reportError,
    recordTelemetry,
    hostCapabilitiesOf,
  };
}

/** Resolves the shared session entry, holds it retained for the mounted
 *  lifetime, and shapes the context value every surface reads. */
function useSessionRegistration({
  publishableKey,
  baseUrl,
  host,
}: {
  publishableKey: string;
  baseUrl: string | undefined;
  host: HostCallbacks;
}): AssistantSessionValue {
  const {
    identityProvided,
    actionsProvided,
    navigationProvided,
    telemetryProvided,
    resolveEndUserToken,
    hostNavigate,
    executeActionIntent,
    reportError,
    recordTelemetry,
    hostCapabilitiesOf,
  } = host;

  // The registry resolves the session's identity inputs to ONE shared
  // TokenSession + store pair — same-identity providers, even in other
  // React roots (two custom elements on one host page), converse through
  // the same store. Render-safe: entryFor only constructs, never boots.
  const entry = useMemo(
    () =>
      assistantSessionRegistry.entryFor({
        publishableKey,
        baseUrl,
        identityProvided,
      }),
    [publishableKey, baseUrl, identityProvided],
  );
  const session = entry.session;
  const store = entry.store;

  // This provider's wiring rides the entry for exactly the mounted
  // lifetime: the first retain boots the store, the last release
  // disposes store and session (the registry's ref-count replaces the
  // per-provider dispose that lived here).
  useEffect(() => {
    const registrant: AssistantSessionRegistrant = {
      resolveEndUserToken: identityProvided ? resolveEndUserToken : null,
      hostCapabilitiesOf,
      reportError,
      onTelemetry: telemetryProvided ? recordTelemetry : null,
    };
    return assistantSessionRegistry.retain(entry, registrant);
  }, [
    entry,
    identityProvided,
    resolveEndUserToken,
    hostCapabilitiesOf,
    reportError,
    telemetryProvided,
    recordTelemetry,
  ]);

  // The mint's verdict lives on the entry, not in provider state: a
  // provider mounting after the mint answered reads the cached verdict
  // instead of waiting for a mint that already happened.
  const tier = useCell(entry.tier);
  const setupError = useCell(entry.setupError);

  return useMemo(
    () => ({
      session,
      store,
      publishableKey,
      identityProvided,
      navigate: navigationProvided ? hostNavigate : null,
      executeActionIntent: actionsProvided ? executeActionIntent : null,
      tier,
      setupError,
      assistantConfig: entry.assistantConfig,
      attachmentPolicy: entry.attachmentPolicy,
      modelChoice: entry.modelChoice,
      configAnswered: entry.configAnswered,
      ensureAssistantConfig: entry.ensureAssistantConfig,
      refreshAssistantConfig: entry.refreshAssistantConfig,
      conversationGate: entry.conversationGate,
      subscriptions: entry.subscriptions,
      ensureSubscriptions: entry.ensureSubscriptions,
      refreshSubscriptions: entry.refreshSubscriptions,
      connectOpenRequested: entry.connectOpenRequested,
      requestSubscriptionConnect: entry.requestSubscriptionConnect,
      acknowledgeSubscriptionConnect: entry.acknowledgeSubscriptionConnect,
      reportError,
    }),
    [
      session,
      store,
      publishableKey,
      identityProvided,
      navigationProvided,
      hostNavigate,
      actionsProvided,
      executeActionIntent,
      tier,
      setupError,
      entry,
      reportError,
    ],
  );
}

/** A host's mark, or null for the package flask — the fall-through rule
 *  (core/host-fill.ts): the idiomatic `companionMark={flag && <Mark />}`
 *  gets the flask on its false arm; renderable emptiness is the host's
 *  deliberate content. Folded once, here, because CompanionMark branches
 *  on null. */
function _companionMarkOf(companionMark: ReactNode): ReactNode | null {
  return hostFillDeclines(companionMark) ? null : companionMark;
}

/** The theme and suggestions props travel by value, not identity: hosts
 *  write both as inline literals. Serializing once and keying the memo on
 *  the strings keeps those identities out of every dependency array here.
 *  The companion mark is the exception — a ReactNode has no value form,
 *  so it rides by identity, like toolViews. */
function useAppearanceValue({
  theme,
  mode,
  companionMark,
  suggestions,
}: Pick<
  TeaflaskAssistantProviderProps,
  "theme" | "mode" | "companionMark" | "suggestions"
>): AssistantAppearanceValue {
  const themeJson = theme === undefined ? null : JSON.stringify(theme);
  const suggestionsJson =
    suggestions === undefined ? null : JSON.stringify(suggestions);
  return useMemo<AssistantAppearanceValue>(() => {
    const rootProps: AssistantRootProps = {};
    if (themeJson !== null) {
      rootProps.style = themeToStyleVars(
        JSON.parse(themeJson) as AssistantTheme,
      );
    }
    if (mode !== undefined) {
      rootProps["data-tf-theme"] = mode;
    }
    return {
      rootProps,
      companionMark: _companionMarkOf(companionMark),
      suggestions:
        suggestionsJson === null
          ? null
          : (JSON.parse(suggestionsJson) as AssistantSuggestionInput[]),
    };
  }, [themeJson, mode, companionMark, suggestionsJson]);
}

// The context value only exposes the executor when the adapter prop is
// present, so an empty ref here is a package bug, not a host mistake —
// but the narrowing must still be explicit for the lint laws.
function _wiredAdapterOf(adapter: ActionsAdapter | undefined): ActionsAdapter {
  if (adapter === undefined) {
    throw new Error(
      "The actions adapter was removed while an action was executing.",
    );
  }
  return adapter;
}
