// The script-tag distribution: a custom element that mounts the
// batteries-included React root into an open shadow root, with the
// package stylesheet adopted in and React bundled alongside — the host
// never knows React is in there. Nothing is rewritten: the surfaces are
// the same components the npm package ships, so everything about them
// (top-layer dialogs, `--tf-*` theming, the serving contract) holds; the
// shared shadow-mount machinery lives in AssistantElementBase, beside
// the page element that reuses it.

import { createRef, type ReactNode } from "react";

import {
  TeaflaskAssistant,
  type TeaflaskAssistantHandle,
} from "../components/teaflask-assistant.js";
import {
  AssistantElementBase,
  setElementStylesheetText,
  warnElementMessageOnce,
} from "./assistant-element-base.js";
import {
  ELEMENT_TAG_NAME,
  OBSERVED_ELEMENT_ATTRIBUTES,
  parseElementConfig,
  resolveElementProps,
  type ElementHostProps,
} from "./element-config.js";

// One widget per page is the supported shape — the same stance as
// <TeaflaskAssistant/> itself (a second instance double-binds the hotkey
// and mounts a second companion). Warned once, not enforced; the page
// element deliberately does not count here — widget + page on one host
// page is a designed pairing.
let warnedAboutSecondInstance = false;
let connectedInstanceCount = 0;

export class TeaflaskAssistantElement extends AssistantElementBase {
  static observedAttributes = [...OBSERVED_ELEMENT_ATTRIBUTES];

  #handleRef = createRef<TeaflaskAssistantHandle>();

  /** The imperative escape hatch, mirroring the React ref handle: opens
   *  the palette regardless of the hotkey setting; no-ops unmounted. */
  openPalette(): void {
    this.#handleRef.current?.openPalette();
  }

  protected override _onMount(): void {
    connectedInstanceCount += 1;
    if (connectedInstanceCount > 1 && !warnedAboutSecondInstance) {
      warnedAboutSecondInstance = true;
      console.warn(
        `[teaflask-assistant] A second <${ELEMENT_TAG_NAME}> connected — ` +
          `one per page is the supported shape (each binds the hotkey ` +
          `and mounts its own companion).`,
      );
    }
  }

  protected override _onTeardown(): void {
    connectedInstanceCount -= 1;
  }

  protected _mountedTree(hostProps: ElementHostProps): ReactNode {
    const config = parseElementConfig(this);
    for (const warning of config.warnings) {
      warnElementMessageOnce(warning);
    }
    if (config.publishableKey === null) {
      return null;
    }
    const resolved = resolveElementProps(
      { ...config, publishableKey: config.publishableKey },
      hostProps,
    );
    for (const warning of resolved.warnings) {
      warnElementMessageOnce(warning);
    }
    return <TeaflaskAssistant {...resolved.props} ref={this.#handleRef} />;
  }
}

/**
 * Registers <teaflask-assistant> with the supplied stylesheet text (the
 * build bakes in the package CSS: rem→px transformed, Tailwind's `--tw-*`
 * fallback appended ungated for the shadow root). Idempotent,
 * because a host controls how many times the snippet reaches the page
 * and some of those ways aren't visible from any one template: the tag
 * pasted into both a shared layout and a route that also includes it,
 * or a tag manager injecting it beside a hardcoded copy. The first
 * registration stands — customElements.define throws on a duplicate
 * name, and taking down the host's page over a doubled script tag
 * would be a poor way to report it.
 */
export function defineTeaflaskAssistantElement(options: {
  cssText: string;
}): void {
  if (customElements.get(ELEMENT_TAG_NAME) !== undefined) {
    return;
  }
  setElementStylesheetText(options.cssText);
  customElements.define(ELEMENT_TAG_NAME, TeaflaskAssistantElement);
}
