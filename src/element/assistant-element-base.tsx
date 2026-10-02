// The machinery every teaflask custom element shares: the shadow mount
// with the package stylesheet adopted exactly once, the eight rich host
// properties with the upgrade-order reclaim, the microtask-deferred
// disconnect (a reparent is a non-event, not a conversation teardown),
// and the warn-once ledger. Subclasses supply only what differs: the
// observed attributes, the mounted React tree, and any per-tag connect
// bookkeeping.

import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  IDENTITY_PAIR_WARNING,
  identityPairIsHalfSet,
} from "../core/identity-pair.js";
import {
  ELEMENT_HOST_PROP_KEYS,
  type ElementHostProps,
} from "./element-config.js";
import { startHostAttributeReflection } from "./host-attribute-reflection.js";

// Supplied by the define functions before any element class can
// construct — the bundle's one side effect wires it.
let elementStylesheetText: string | null = null;

export function setElementStylesheetText(cssText: string): void {
  elementStylesheetText = cssText;
}

// Element warnings are per-message, once each — an attribute flapping
// between two bad values must not flood the console.
const warnedElementMessages = new Set<string>();

export function warnElementMessageOnce(message: string): void {
  if (warnedElementMessages.has(message)) {
    return;
  }
  warnedElementMessages.add(message);
  console.warn(`[teaflask-assistant] ${message}`);
}

export abstract class AssistantElementBase extends HTMLElement {
  #reactRoot: Root | null = null;
  #wrapper: HTMLDivElement | null = null;
  #stopReflection: (() => void) | null = null;
  #hostProps: ElementHostProps = {};

  get onNavigate(): ElementHostProps["onNavigate"] {
    return this.#hostProps.onNavigate;
  }
  set onNavigate(value: ElementHostProps["onNavigate"]) {
    this.#hostProps.onNavigate = value;
    this.#render();
  }

  get userId(): ElementHostProps["userId"] {
    return this.#hostProps.userId;
  }
  set userId(value: ElementHostProps["userId"]) {
    this.#hostProps.userId = value;
    this.#render();
    this.#warnIfStillHalfPaired();
  }

  get getEndUserToken(): ElementHostProps["getEndUserToken"] {
    return this.#hostProps.getEndUserToken;
  }
  set getEndUserToken(value: ElementHostProps["getEndUserToken"]) {
    this.#hostProps.getEndUserToken = value;
    this.#render();
    this.#warnIfStillHalfPaired();
  }

  get actionsAdapter(): ElementHostProps["actionsAdapter"] {
    return this.#hostProps.actionsAdapter;
  }
  set actionsAdapter(value: ElementHostProps["actionsAdapter"]) {
    this.#hostProps.actionsAdapter = value;
    this.#render();
  }

  get onError(): ElementHostProps["onError"] {
    return this.#hostProps.onError;
  }
  set onError(value: ElementHostProps["onError"]) {
    this.#hostProps.onError = value;
    this.#render();
  }

  get theme(): ElementHostProps["theme"] {
    return this.#hostProps.theme;
  }
  set theme(value: ElementHostProps["theme"]) {
    this.#hostProps.theme = value;
    this.#render();
  }

  get suggestions(): ElementHostProps["suggestions"] {
    return this.#hostProps.suggestions;
  }
  set suggestions(value: ElementHostProps["suggestions"]) {
    this.#hostProps.suggestions = value;
    this.#render();
  }

  get toolViews(): ElementHostProps["toolViews"] {
    return this.#hostProps.toolViews;
  }
  set toolViews(value: ElementHostProps["toolViews"]) {
    this.#hostProps.toolViews = value;
    this.#render();
  }

  /** The React tree for the current attributes and host properties, or
   *  null when nothing should mount (no publishable key yet). The
   *  subclass parses its own attribute set and warns through
   *  warnElementMessageOnce. */
  protected abstract _mountedTree(hostProps: ElementHostProps): ReactNode;

  /** Per-tag bookkeeping at a real mount (not a reparent). */
  protected _onMount(): void {
    // Nothing shared to do — the widget counts its instances here.
  }

  /** Per-tag bookkeeping at a real teardown (not a reparent). */
  protected _onTeardown(): void {
    // Nothing shared to do — the widget counts its instances here.
  }

  /** Extra per-tag stylesheet text adopted beside the package sheet at
   *  shadow-root creation (the page element sizes its own :host here). */
  protected _hostSheetText(): string | null {
    return null;
  }

  connectedCallback(): void {
    this.#reclaimPropertiesSetBeforeUpgrade();
    if (this.#reactRoot !== null) {
      // A same-tick reparent (append elsewhere) — the microtask below
      // saw isConnected and never tore down; nothing to rebuild.
      return;
    }
    this._onMount();
    const wrapper = this.#ensureShadowMount();
    this.#reactRoot = createRoot(wrapper);
    this.#render();
    this.#warnIfStillKeyless();
    this.#warnIfStillHalfPaired();
    this.#stopReflection = startHostAttributeReflection(this, wrapper);
  }

  disconnectedCallback(): void {
    // Deferred a microtask: appendChild-moving the element fires
    // disconnect+connect synchronously, and a reparent must be a
    // non-event, not a conversation teardown.
    queueMicrotask(() => {
      if (this.isConnected) {
        return;
      }
      this.#teardown();
    });
  }

  attributeChangedCallback(): void {
    if (this.#reactRoot !== null) {
      this.#render();
    }
  }

  #ensureShadowMount(): HTMLDivElement {
    let shadow = this.shadowRoot;
    if (shadow === null) {
      // Adoption happens exactly once, with the shadow root's creation —
      // a reconnect reuses both.
      shadow = this.attachShadow({ mode: "open" });
      shadow.adoptedStyleSheets = this.#adoptedSheets();
    }
    if (this.#wrapper === null) {
      // The React mount target and the reflection target in one: an
      // in-shadow ancestor of the whole tree, so the mirrored
      // `data-tf-theme`/`data-reduce-motion` sit where descendant
      // selectors (and closest() sniffers) can reach them again.
      this.#wrapper = this.ownerDocument.createElement("div");
      shadow.append(this.#wrapper);
    }
    return this.#wrapper;
  }

  #adoptedSheets(): CSSStyleSheet[] {
    const sheets: CSSStyleSheet[] = [];
    if (elementStylesheetText !== null) {
      sheets.push(_constructedSheetOf(elementStylesheetText));
    }
    const hostSheetText = this._hostSheetText();
    if (hostSheetText !== null) {
      sheets.push(_constructedSheetOf(hostSheetText));
    }
    return sheets;
  }

  #render(): void {
    if (this.#reactRoot === null) {
      return;
    }
    this.#reactRoot.render(this._mountedTree(this.#hostProps));
  }

  #teardown(): void {
    if (this.#reactRoot === null) {
      return;
    }
    this._onTeardown();
    this.#stopReflection?.();
    this.#stopReflection = null;
    this.#reactRoot.unmount();
    this.#reactRoot = null;
  }

  // The classic upgrade gotcha: a property assigned before the element's
  // definition loads lands as an OWN property and shadows the class
  // accessor forever. Re-route any such value through the setter.
  #reclaimPropertiesSetBeforeUpgrade(): void {
    const bag = this as unknown as Record<string, unknown>;
    for (const key of ELEMENT_HOST_PROP_KEYS) {
      if (Object.prototype.hasOwnProperty.call(this, key)) {
        const value = bag[key];
        Reflect.deleteProperty(bag, key);
        bag[key] = value;
      }
    }
  }

  // A blank surface with no console line is the worst failure mode, but
  // "append first, setAttribute after" is a legitimate imperative order
  // — so the check waits out the current task before concluding the key
  // is genuinely missing.
  #warnIfStillKeyless(): void {
    queueMicrotask(() => {
      if (this.isConnected && this.#publishableKeyIsMissing()) {
        warnElementMessageOnce(
          `<${this.localName}> has no publishable-key attribute — ` +
            `nothing renders until one is set.`,
        );
      }
    });
  }

  // Same stance for the identity pair: `el.userId = …; el.getEndUserToken
  // = …;` is the documented wiring, and the two renders it causes commit
  // as one — so the verdict waits for the task to end, like the key's.
  #warnIfStillHalfPaired(): void {
    queueMicrotask(() => {
      if (this.isConnected && identityPairIsHalfSet(this.#hostProps)) {
        warnElementMessageOnce(IDENTITY_PAIR_WARNING);
      }
    });
  }

  #publishableKeyIsMissing(): boolean {
    const value = this.getAttribute("publishable-key");
    return value === null || value === "";
  }
}

/** The baked sheet already carries the shadow-root edition of Tailwind's
 *  `--tw-*` fallback (scripts/build-element.mjs), so every utility chain
 *  resolves inside this root without the element writing anything —
 *  registrations, rules or properties — to the host document. */
function _constructedSheetOf(cssText: string): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(cssText);
  return sheet;
}
