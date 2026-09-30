// The page surface for non-React hosts: a second custom element that
// mounts <AssistantPage/> — the full conversation with the
// thread-history rail — under its own provider, on the same shadow-mount
// machinery as the widget element. The host gives it a sized box and the
// surface fills it. Because the provider resolves its session through
// the module-level registry, a widget and a page with the same
// publishable key on one host page share ONE live conversation — a turn
// typed in either streams into both.

import { lazy, type ReactNode } from "react";

import { LazyBody } from "../components/lazy-body.js";
import { TeaflaskAssistantProvider } from "../components/teaflask-assistant-provider.js";
import {
  AssistantElementBase,
  setElementStylesheetText,
  warnElementMessageOnce,
} from "./assistant-element-base.js";
import {
  OBSERVED_PAGE_ELEMENT_ATTRIBUTES,
  PAGE_ELEMENT_TAG_NAME,
  parsePageElementConfig,
  resolvePageElementProps,
  type ElementHostProps,
} from "./element-config.js";

// The dynamic edge that keeps the transcript stack out of the eager
// shell: a widget-only host never downloads the page surface, exactly
// like the palette body. LazyBody owns the chunk-failure story (honest
// fallback, never an auto-reload).
const LazyAssistantPage = lazy(() =>
  import("../components/assistant-page.js").then((module) => ({
    default: module.AssistantPage,
  })),
);

// Custom elements lay out inline by default, which collapses a sized
// box to nothing — so the element declares itself a block that fills
// its container (the host styles the element itself to override), and
// the wrapper hands the size down so the surface's h-full has something
// to fill (and the LazyBody notices, built flex-first, center
// themselves while loading).
const PAGE_HOST_SHEET_TEXT =
  ":host { display: block; height: 100%; } " +
  ":host > div { display: flex; flex-direction: column; height: 100%; }";

export class TeaflaskAssistantPageElement extends AssistantElementBase {
  static observedAttributes = [...OBSERVED_PAGE_ELEMENT_ATTRIBUTES];

  protected override _hostSheetText(): string {
    return PAGE_HOST_SHEET_TEXT;
  }

  protected _mountedTree(hostProps: ElementHostProps): ReactNode {
    const config = parsePageElementConfig(this);
    for (const warning of config.warnings) {
      warnElementMessageOnce(warning);
    }
    if (config.publishableKey === null) {
      return null;
    }
    const resolved = resolvePageElementProps(
      { ...config, publishableKey: config.publishableKey },
      hostProps,
    );
    for (const warning of resolved.warnings) {
      warnElementMessageOnce(warning);
    }
    return (
      <TeaflaskAssistantProvider {...resolved.providerProps}>
        <LazyBody>
          <LazyAssistantPage {...resolved.pageProps} />
        </LazyBody>
      </TeaflaskAssistantProvider>
    );
  }
}

/**
 * Registers <teaflask-assistant-page> with the supplied stylesheet text.
 * Idempotent for the same reason as the widget's define: doubled script
 * tags are the host's reality, and the first registration stands.
 */
export function defineTeaflaskAssistantPageElement(options: {
  cssText: string;
}): void {
  if (customElements.get(PAGE_ELEMENT_TAG_NAME) !== undefined) {
    return;
  }
  setElementStylesheetText(options.cssText);
  customElements.define(PAGE_ELEMENT_TAG_NAME, TeaflaskAssistantPageElement);
}
