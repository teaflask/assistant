// One conversation per session identity, however many providers. Each
// React root used to build its own TokenSession + store pair, so two
// custom elements on one host page (the widget and the full page) held
// two conversations that converged only through localStorage and server
// history — never live. The registry hoists the pair into module scope,
// keyed by the session's identity inputs and ref-counted: same-identity
// providers — across separate React roots — resolve the SAME store, and
// every surface streams the same turn. Module-scoped on purpose, like
// the surface registry beside it: the sharing has to cross React trees,
// and every element loads from one assistant.js, so module state IS the
// cross-root channel.
//
// Per-provider wiring (token resolver, host capabilities, error sink)
// cannot be baked into the shared pair, so registrants carry it and the
// entry owns stable closures that delegate by rule:
//   - host capabilities: the first capable registrant, per capability,
//     read fresh at each execution pass — a capability-less widget never
//     masks a page that wired an adapter, and a released provider hands
//     over automatically on the next scan;
//   - end-user token: the first identity-wired registrant, scanned at
//     each mint. The key carries the host's userId, so one key IS one
//     signed-in user and any registrant's resolver is correct (order
//     makes it deterministic). A different user is a different entry;
//     the old entry's sweep drops its store, token, and cells wholesale,
//     so nothing of the previous user survives the switch.
//   - reportError: fanned out to every registrant — observability, not
//     capability; a duplicate report is harmless, a dropped one is a hole.

import type {
  ServedAttachmentPolicy,
  ServedModelChoice,
  ServedSuggestionsConfig,
} from "../contract/assistant-config.js";
import type { VisitorTier } from "../contract/identity.js";
import type { SubscriptionStatus } from "../contract/subscriptions.js";
import type { AssistantTelemetryEvent } from "../contract/telemetry.js";
import {
  readStoredThread,
  writeStoredThread,
} from "../persistence/stored-thread.js";
import {
  getAssistantConfig,
  listSubscriptions,
} from "../transport/serving-api.js";
import type { ServingApiError } from "../transport/serving-error.js";
import {
  END_USER_ID_MISMATCH,
  TokenSession,
} from "../transport/token-session.js";
import {
  type ConversationGate,
  NO_GATE,
  gateOfProjection,
  gateOfRefusal,
  gatesEqual,
} from "./connect-gate.js";
import {
  AssistantConversationStore,
  type HostCapabilities,
} from "./conversation-store.js";
import { namedUserIdOf } from "./identity-pair.js";
import { ObservableCell, type ReadonlyCell } from "./observable-cell.js";

export const DEFAULT_BASE_URL = "https://api.teaflask.com";

/** The session's identity inputs — and nothing else. The token itself is
 *  mutable session state (re-mints overwrite it in place), so identity is
 *  the user the host claims (undefined for an anonymous host), never the
 *  token's value. */
export interface AssistantSessionSpec {
  publishableKey: string;
  baseUrl?: string;
  userId?: string;
}

/** One provider's wiring, registered for the lifetime of its retain. */
export interface AssistantSessionRegistrant {
  /** Null on a provider whose host never wired getEndUserToken. */
  resolveEndUserToken: (() => string | null | Promise<string | null>) | null;
  /** Read fresh at each execution pass, exactly like the provider's own
   *  latest-value ref underneath it. */
  hostCapabilitiesOf: () => HostCapabilities;
  reportError: (error: Error) => void;
  /** Null on a provider whose host never wired onTelemetry. Fanned out to
   *  every wired registrant — observability, exactly like reportError. */
  onTelemetry: ((event: AssistantTelemetryEvent) => void) | null;
}

export interface AssistantSessionEntry {
  readonly session: TokenSession;
  readonly store: AssistantConversationStore;
  /** Null until the first mint answers; late registrants read the cached
   *  verdict instead of waiting for a mint that already happened. */
  readonly tier: ReadonlyCell<VisitorTier | null>;
  /** A loud mint failure (bad key, origin, or end-user signer). Shared on
   *  purpose: the key is broken for every same-identity surface at once. */
  readonly setupError: ReadonlyCell<ServingApiError | null>;
  /** The served suggestion sets, null until ensureAssistantConfig()'s
   *  fetch answers — and forever on a surface that never asks. */
  readonly assistantConfig: ReadonlyCell<ServedSuggestionsConfig | null>;
  /** The served attachment policy from the same fetch: what the composer
   *  may offer. Null until the fetch answers — and null AFTER it where
   *  the environment has no attachment storage, which hides the
   *  affordance entirely. */
  readonly attachmentPolicy: ReadonlyCell<ServedAttachmentPolicy | null>;
  /** The served model picker menu from the same fetch. Null
   *  until the fetch answers — and null AFTER it when the agent's
   *  operator has not enabled user model choice, which hides the picker
   *  chip entirely (the provider chip keeps the shelf). */
  readonly modelChoice: ReadonlyCell<ServedModelChoice | null>;
  /** Whether the config fetch has SETTLED (success or failure) — the
   *  signal the nullable cells above cannot carry, because null means
   *  both "not answered yet" and "answered: none". The composer shelf
   *  reads it to hold the slot blank through the fetch window and then
   *  fall back honestly on failure (the provider chip renders off the
   *  separate subscriptions read). */
  readonly configAnswered: ReadonlyCell<boolean>;
  /** Kicks the config fetch, single-flight: a success sticks for the
   *  session, a failure leaves the cell null and lets a later mount retry.
   *  Never an error surface — served suggestions are decoration, and a
   *  surface without them still converses. Only ever called from a mount
   *  effect; entry construction stays side-effect-free. */
  readonly ensureAssistantConfig: () => void;
  /** Forces a config re-read — the gate's refresh moments: a settled
   *  turn (the taster may have just crossed), a landed connect or
   *  disconnect, a tier flip. The refreshSubscriptions superseding-flight
   *  shape. */
  readonly refreshAssistantConfig: () => void;
  /** What stands between this visitor and their next send — seeded by
   *  the config read's pre-flight projection, corrected by send refusals
   *  (the race window), re-read at every refresh moment above.
   *  ConversationView renders it in the composer's place. */
  readonly conversationGate: ReadonlyCell<ConversationGate>;
  /** Every provider's connect standing for this visitor, null
   *  until ensureSubscriptions()'s fetch answers. Identified sessions
   *  only — the GET 403s an anonymous bearer, so callers gate the kick
   *  on the identified tier. */
  readonly subscriptions: ReadonlyCell<SubscriptionStatus[] | null>;
  /** Kicks the subscriptions fetch, single-flight and self-evicting on
   *  failure — the ensureAssistantConfig shape. Only ever called from a
   *  mount effect, and only on an identified session. */
  readonly ensureSubscriptions: () => void;
  /** Forces a re-fetch — the moment after a connect completes or a
   *  disconnect lands, when the stored standing just changed. */
  readonly refreshSubscriptions: () => void;
  /** A parked ask to open the provider chip's menu — set by
   *  requestSubscriptionConnect, cleared only when a surface consumes it
   *  (acknowledgeSubscriptionConnect). Lives on the entry, not in any
   *  component: the minimized companion unmounts its chrome, and a ring
   *  while minimized must be honored on the next expand, never dropped.
   *  Send refusals no longer ring it — a gate refusal renders as the
   *  composer's takeover card (conversationGate above); this ask remains
   *  for the bench and for hosts that want to spotlight the chip. */
  readonly connectOpenRequested: ReadonlyCell<boolean>;
  readonly requestSubscriptionConnect: () => void;
  readonly acknowledgeSubscriptionConnect: () => void;
}

interface Registration {
  registrant: AssistantSessionRegistrant;
}

class SessionEntry implements AssistantSessionEntry {
  readonly session: TokenSession;
  readonly store: AssistantConversationStore;
  readonly tier: ReadonlyCell<VisitorTier | null>;
  readonly setupError: ReadonlyCell<ServingApiError | null>;
  readonly assistantConfig: ReadonlyCell<ServedSuggestionsConfig | null>;
  readonly attachmentPolicy: ReadonlyCell<ServedAttachmentPolicy | null>;
  readonly modelChoice: ReadonlyCell<ServedModelChoice | null>;
  readonly configAnswered: ReadonlyCell<boolean>;
  readonly conversationGate: ReadonlyCell<ConversationGate>;
  readonly subscriptions: ReadonlyCell<SubscriptionStatus[] | null>;
  readonly connectOpenRequested: ReadonlyCell<boolean>;

  /** Insertion-ordered — "first registrant" is this set's iteration order. */
  readonly registrations = new Set<Registration>();

  /** Ends the wait below; set only while a mint is parked on it, so the
   *  ordinary case arms no timer. */
  private _endFirstRetainWait: (() => void) | null = null;
  private _everRetained = false;

  private readonly _tierCell = new ObservableCell<VisitorTier | null>(null);
  private readonly _setupErrorCell = new ObservableCell<ServingApiError | null>(
    null,
  );
  private readonly _assistantConfigCell =
    new ObservableCell<ServedSuggestionsConfig | null>(null);
  private readonly _attachmentPolicyCell =
    new ObservableCell<ServedAttachmentPolicy | null>(null);
  private readonly _modelChoiceCell =
    new ObservableCell<ServedModelChoice | null>(null);
  private readonly _configAnsweredCell = new ObservableCell<boolean>(false);
  private readonly _conversationGateCell = new ObservableCell<ConversationGate>(
    NO_GATE,
  );
  private _assistantConfigFetch: Promise<void> | null = null;
  private readonly _subscriptionsCell = new ObservableCell<
    SubscriptionStatus[] | null
  >(null);
  private _subscriptionsFetch: Promise<void> | null = null;
  private readonly _connectOpenRequestedCell = new ObservableCell<boolean>(
    false,
  );

  /** Arrow field so it travels unbound through the provider's context,
   *  exactly like a cell's get/subscribe. */
  readonly ensureAssistantConfig = (): void => {
    this._assistantConfigFetch ??= this._fetchAssistantConfig();
  };

  readonly refreshAssistantConfig = (): void => {
    // Refresh only supersedes an existing read: before the first
    // ensureAssistantConfig there is nothing stale to correct, and the
    // mount that needs the config will kick its own fetch.
    if (this._assistantConfigFetch !== null) {
      this._assistantConfigFetch = this._fetchAssistantConfig();
    }
  };

  private _fetchAssistantConfig(): Promise<void> {
    const fetch: Promise<void> = getAssistantConfig(this.session).then(
      (config) => {
        // Only the current flight may write: an older flight resolving
        // late must not clobber the refresh that superseded it.
        if (this._assistantConfigFetch === fetch) {
          this._assistantConfigCell.set(config.suggestions);
          this._attachmentPolicyCell.set(config.attachments ?? null);
          this._modelChoiceCell.set(config.model_choice ?? null);
          this._configAnsweredCell.set(true);
          // Deduped on substance: the projection mints a fresh object
          // every read, and an unchanged gate must not notify — the
          // verifying banner re-reads this every few seconds.
          const gate = gateOfProjection(config.connect);
          if (!gatesEqual(this._conversationGateCell.get(), gate)) {
            this._conversationGateCell.set(gate);
          }
        }
      },
      () => {
        // A failed attempt evicts itself so the next mount retries;
        // decoration never surfaces an error.
        // The fetch still ANSWERED — failure is an answer — so the slot
        // that held blank for the window may now fall back honestly.
        if (this._assistantConfigFetch === fetch) {
          this._assistantConfigFetch = null;
          this._configAnsweredCell.set(true);
        }
      },
    );
    return fetch;
  }

  /** Same arrow-field discipline as ensureAssistantConfig, same
   *  single-flight-with-self-eviction shape. */
  readonly ensureSubscriptions = (): void => {
    this._subscriptionsFetch ??= this._fetchSubscriptions();
  };

  readonly refreshSubscriptions = (): void => {
    this._subscriptionsFetch = this._fetchSubscriptions();
  };

  readonly requestSubscriptionConnect = (): void => {
    // The ask fires ABOUT the standing (an auth-bounced credential), and
    // the session-cached read predates the bounce: re-read so the panel
    // opens on the bounced state and its reconnect affordance, not a
    // stale "Connected".
    this.refreshSubscriptions();
    this._connectOpenRequestedCell.set(true);
  };

  readonly acknowledgeSubscriptionConnect = (): void => {
    this._connectOpenRequestedCell.set(false);
  };

  private _fetchSubscriptions(): Promise<void> {
    const fetch: Promise<void> = listSubscriptions(this.session).then(
      (subscriptions) => {
        // Only the current flight may write: an older flight resolving
        // late must not clobber the refresh that superseded it.
        if (this._subscriptionsFetch === fetch) {
          this._subscriptionsCell.set(subscriptions);
        }
      },
      () => {
        // A failed attempt evicts itself so the next mount retries — but
        // only its own flight, never a refresh that superseded it.
        if (this._subscriptionsFetch === fetch) {
          this._subscriptionsFetch = null;
        }
      },
    );
    return fetch;
  }

  constructor(
    readonly key: string,
    spec: AssistantSessionSpec,
  ) {
    this.tier = this._tierCell;
    this.setupError = this._setupErrorCell;
    this.assistantConfig = this._assistantConfigCell;
    this.attachmentPolicy = this._attachmentPolicyCell;
    this.modelChoice = this._modelChoiceCell;
    this.configAnswered = this._configAnsweredCell;
    this.conversationGate = this._conversationGateCell;
    this.subscriptions = this._subscriptionsCell;
    this.connectOpenRequested = this._connectOpenRequestedCell;
    const publishableKey = spec.publishableKey;
    const userId = spec.userId;
    const identityProvided = userId !== undefined;
    this.session = new TokenSession({
      publishableKey,
      baseUrl: _withoutTrailingSlash(spec.baseUrl ?? DEFAULT_BASE_URL),
      getEndUserToken: identityProvided
        ? () => this._resolveEndUserToken()
        : undefined,
      expectedEndUserId: userId,
      // Claim-at-mint: the stored anonymous thread rides the sign-in
      // re-mint, read fresh each time (claim loss is silent by contract).
      claimThreadId: () => {
        const stored = readStoredThread(publishableKey);
        return stored !== null && !stored.identified ? stored.threadId : null;
      },
      onMinted: (minted) => {
        const previousTier = this._tierCell.get();
        this._setupErrorCell.set(null);
        this._tierCell.set(minted.tier);
        if (minted.tier === "identified") {
          _markStoredThreadIdentified(publishableKey, userId);
        }
        // The mint's verdict flows straight to the store; identification
        // can arrive mid-session and flips the history expectation.
        this.store.setTier(minted.tier);
        // A tier flip changes what the projection would answer (a
        // sign-in gate clears the moment the vouch lands) — re-read.
        if (previousTier !== null && previousTier !== minted.tier) {
          this.refreshAssistantConfig();
        }
      },
      onMintFailed: (error) => {
        // Only a setup bug takes the surfaces down. A transient failure
        // (a rate-limit window, a proxy blip) on the proactive background
        // re-mint must not blank healthy surfaces whose token is still
        // valid — the next request mints again.
        if (_isSetupFailure(error)) {
          this._setupErrorCell.set(error);
        }
        this._reportToEveryRegistrant(error);
      },
    });
    this.store = new AssistantConversationStore({
      session: this.session,
      publishableKey,
      userId,
      hostCapabilitiesOf: () => this._firstCapableRegistrantCapabilities(),
      reportError: (error) => {
        this._reportToEveryRegistrant(error);
      },
      onTelemetry: (event) => {
        // The narration gates nothing: attempted fires before the submit
        // even validates, and the host callback is arbitrary embedder
        // code — a throw here must never break the approval it narrates
        // (it would strand the card's synchronous click guard disabled
        // forever). A broken telemetry hook is itself worth one report
        // on the error seam, whose own fan-out is throw-proof below.
        for (const registration of [...this.registrations]) {
          try {
            registration.registrant.onTelemetry?.(event);
          } catch (error) {
            this._reportToEveryRegistrant(_asError(error));
          }
        }
      },
      // A gate refusal is the projection's race window surfacing: adopt
      // it as the gate immediately (the card renders now, not after a
      // round-trip) and re-read the standing it spoke about.
      onGateRefusal: (error) => {
        const gate = gateOfRefusal(error);
        if (gate !== null) {
          this._conversationGateCell.set(gate);
          this.refreshSubscriptions();
        }
      },
      // A settled turn may have crossed the taster budget or drained a
      // window — the projection is the honest re-read.
      onTurnSettled: this.refreshAssistantConfig,
    });
  }

  private _resolveEndUserToken(): string | null | Promise<string | null> {
    const vouch = this._vouchFromRegistrants();
    if (vouch !== undefined) {
      return vouch;
    }
    // No registrant YET means one of two opposite things, and answering
    // both anonymously was the silent-anonymous bug: a provider whose
    // retain effect has not run is moments from an identity; one whose
    // registrants have left never will be. Only the identity-wired spec
    // builds this resolver, so retention is the whole question.
    if (this._everRetained) {
      return null; // The contract's fail-open: the providers have gone.
    }
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, FIRST_RETAIN_WAIT_MS);
      this._endFirstRetainWait = () => {
        clearTimeout(timer);
        resolve();
      };
    }).then(() => this._vouchFromRegistrants() ?? null);
  }

  /** The first registrant's vouch; null when one answered without a
   *  vouch, undefined when there was none to ask — the wait needs both. */
  private _vouchFromRegistrants():
    string | null | Promise<string | null> | undefined {
    for (const registration of this.registrations) {
      const resolve = registration.registrant.resolveEndUserToken;
      if (resolve !== null) {
        return resolve();
      }
    }
    return this.registrations.size === 0 ? undefined : null;
  }

  /** The wait is over; later mints resolve straight through. */
  settleFirstRetain(): void {
    this._everRetained = true;
    this._endFirstRetainWait?.();
    this._endFirstRetainWait = null;
  }

  private _firstCapableRegistrantCapabilities(): HostCapabilities {
    const merged: HostCapabilities = {
      navigate: null,
      executeActionIntent: null,
    };
    for (const registration of this.registrations) {
      const capabilities = registration.registrant.hostCapabilitiesOf();
      merged.navigate ??= capabilities.navigate;
      merged.executeActionIntent ??= capabilities.executeActionIntent;
    }
    return merged;
  }

  private _reportToEveryRegistrant(error: Error): void {
    for (const registration of [...this.registrations]) {
      try {
        registration.registrant.reportError(error);
      } catch (hookFailure) {
        // The error channel itself broke — no registrant seam is left to
        // report through, and observability must never break the path it
        // narrates (reportError also runs on the approval drop path). The
        // console keeps the reason on record, the package's manner for
        // broken host wiring (approval-context's out-of-surface submit).
        console.warn(
          "A host reportError callback threw while being handed an error:",
          hookFailure,
          "— the original error it was reporting:",
          error,
        );
      }
    }
  }
}

export class AssistantSessionRegistry {
  private readonly entries = new Map<string, SessionEntry>();

  /**
   * Get-or-create, render-safe: both constructors are side-effect-free
   * (no network, no timers, no listeners), so a discarded render leaves
   * only an inert map entry that the next same-identity resolve reuses.
   */
  entryFor(requested: AssistantSessionSpec): AssistantSessionEntry {
    const spec = _withNamedUser(requested);
    const key = _identityKeyOf(spec);
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const entry = new SessionEntry(key, spec);
    this.entries.set(key, entry);
    return entry;
  }

  /**
   * Registers the provider's wiring and boots the store on the first
   * retain (or revives it — `bootstrap()` resets a disposed store by
   * design, so retain-after-sweep works). Returns the release; calling
   * it twice is a no-op. The last release sweeps on a microtask, so
   * StrictMode's synchronous release-then-retain never tears anything
   * down, and only the sweep disposes the store and session.
   */
  retain(
    entry: AssistantSessionEntry,
    registrant: AssistantSessionRegistrant,
  ): () => void {
    if (!(entry instanceof SessionEntry)) {
      throw new Error(
        "Only entries resolved by entryFor() can be retained — construct nothing yourself.",
      );
    }
    // A wrapper per retain, not the bare registrant: two providers may
    // pass identical wiring, and each still holds its own registration.
    const registration: Registration = { registrant };
    const firstRetain = entry.registrations.size === 0;
    entry.registrations.add(registration);
    entry.settleFirstRetain(); // Before bootstrap: a parked mint wakes first.
    if (firstRetain) {
      this._reviveIfSwept(entry);
      entry.store.bootstrap();
    }
    return () => {
      if (!entry.registrations.delete(registration)) {
        return; // released twice — the first release already counted
      }
      if (entry.registrations.size > 0) {
        return;
      }
      queueMicrotask(() => {
        this._sweepIfStillUnretained(entry);
      });
    };
  }

  /** A retain that lands after the sweep emptied the map re-inserts the
   *  entry, so the next entryFor resolves it again. If a successor entry
   *  already took the key (a cross-root race through the microtask gap),
   *  the stale entry simply runs unshared for its lifetime — benign. */
  private _reviveIfSwept(entry: SessionEntry): void {
    if (!this.entries.has(entry.key)) {
      this.entries.set(entry.key, entry);
    }
  }

  private _sweepIfStillUnretained(entry: SessionEntry): void {
    if (entry.registrations.size > 0) {
      return;
    }
    // Guard against deleting a successor entry that took the key between
    // this entry emptying and the microtask running.
    if (this.entries.get(entry.key) === entry) {
      this.entries.delete(entry.key);
    }
    entry.store.dispose();
    entry.session.dispose();
  }
}

/** The one instance every provider resolves through — the module scope
 *  shared by all React roots on the page is the whole mechanism. */
export const assistantSessionRegistry = new AssistantSessionRegistry();

// The bound on waiting for a provider's retain effect: React runs it in
// the same commit, so this covers only the render that never commits,
// where waiting forever would hang the request rather than answer it.
const FIRST_RETAIN_WAIT_MS = 2_000;

// The userId half of core/identity-pair's rule at the spec boundary (the
// vouch half is the provider's, applied before the spec is built): an
// empty id names nobody and runs anonymous.
function _withNamedUser(spec: AssistantSessionSpec): AssistantSessionSpec {
  return { ...spec, userId: namedUserIdOf(spec.userId) };
}

function _identityKeyOf(spec: AssistantSessionSpec): string {
  const userId = spec.userId;
  return [
    spec.publishableKey,
    _withoutTrailingSlash(spec.baseUrl ?? DEFAULT_BASE_URL),
    userId === undefined ? "anonymous" : "identified",
    userId ?? "",
  ].join("\u0000");
}

// The contract's loud-by-design mint failures: a broken key, origin
// allowlist, or end-user signer needs the developer, not a retry.
function _isSetupFailure(error: ServingApiError): boolean {
  return (
    error.code === "PUBLISHABLE_KEY_INVALID" ||
    error.code === "ORIGIN_NOT_ALLOWED" ||
    error.code === "END_USER_TOKEN_INVALID" ||
    error.code === END_USER_ID_MISMATCH
  );
}

// The mint 201'd with the claim on board: the stored thread is this
// user's now (or the claim silently lost and reads will say so) —
// either way it must not be offered again.
function _markStoredThreadIdentified(
  publishableKey: string,
  userId: string | undefined,
): void {
  const stored = readStoredThread(publishableKey);
  if (stored !== null && !stored.identified) {
    writeStoredThread(publishableKey, { ...stored, identified: true, userId });
  }
}

function _withoutTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function _asError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}
