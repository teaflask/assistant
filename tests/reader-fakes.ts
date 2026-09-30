// A hand-steered LayoutProbe for reader tests: jsdom has no layout
// engine, so every layout-derived fact (computed style, rects, pseudo
// content, viewport) is injected per element here. Defaults say
// "visible, sized, on-screen, unstyled" — each test overrides only the
// facts it is about.

import type {
  LayoutProbe,
  RectSlice,
  SizeSlice,
  StyleSlice,
} from "../src/reader/layout-probe";

const DEFAULT_STYLE: StyleSlice = {
  display: "block",
  visibility: "visible",
  opacity: "1",
  cursor: "auto",
  overflowX: "visible",
  overflowY: "visible",
};

const DEFAULT_RECT: RectSlice = {
  top: 0,
  left: 0,
  right: 120,
  bottom: 20,
  width: 120,
  height: 20,
};

export interface FakeLayoutProbe extends LayoutProbe {
  setStyle(element: Element, style: Partial<StyleSlice>): void;
  setPseudoContent(
    element: Element,
    pseudo: "::before" | "::after",
    text: string,
  ): void;
  setRect(element: Element, rect: Partial<RectSlice>): void;
  setOffsetSize(element: Element, size: SizeSlice): void;
  setViewportSize(size: SizeSlice): void;
  setNativeVisibility(element: Element, visible: boolean | null): void;
}

export function fakeLayoutProbeOf(): FakeLayoutProbe {
  const styleByElement = new Map<Element, StyleSlice>();
  const pseudoByElement = new Map<Element, Map<string, string>>();
  const rectByElement = new Map<Element, RectSlice>();
  const offsetSizeByElement = new Map<Element, SizeSlice>();
  const nativeVisibilityByElement = new Map<Element, boolean | null>();
  let viewport: SizeSlice = { width: 1280, height: 800 };

  return {
    styleOf(element) {
      return styleByElement.get(element) ?? DEFAULT_STYLE;
    },
    pseudoContentOf(element, pseudo) {
      return pseudoByElement.get(element)?.get(pseudo) ?? "";
    },
    rectOf(element) {
      return rectByElement.get(element) ?? DEFAULT_RECT;
    },
    offsetSizeOf(element) {
      const overridden = offsetSizeByElement.get(element);
      if (overridden !== undefined) {
        return overridden;
      }
      const rect = rectByElement.get(element) ?? DEFAULT_RECT;
      return { width: rect.width, height: rect.height };
    },
    viewportSizeOf() {
      return viewport;
    },
    nativeVisibilityOf(element) {
      return nativeVisibilityByElement.get(element) ?? null;
    },
    setStyle(element, style) {
      const current = styleByElement.get(element) ?? DEFAULT_STYLE;
      styleByElement.set(element, { ...current, ...style });
    },
    setPseudoContent(element, pseudo, text) {
      const forElement =
        pseudoByElement.get(element) ?? new Map<string, string>();
      forElement.set(pseudo, text);
      pseudoByElement.set(element, forElement);
    },
    setRect(element, rect) {
      rectByElement.set(element, { ...DEFAULT_RECT, ...rect });
    },
    setOffsetSize(element, size) {
      offsetSizeByElement.set(element, size);
    },
    setViewportSize(size) {
      viewport = size;
    },
    setNativeVisibility(element, visible) {
      nativeVisibilityByElement.set(element, visible);
    },
  };
}
