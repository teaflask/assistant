// The reader's one window onto layout and computed style. Every
// getComputedStyle / getBoundingClientRect / viewport read in the reader
// goes through this interface — nothing else may touch those APIs — so
// the walk's structural logic unit-tests under jsdom (which has no
// layout engine) with a fake probe, while the browser probe stays a thin
// adapter exercised by the live lanes.

export interface StyleSlice {
  display: string;
  visibility: string;
  opacity: string;
  cursor: string;
  overflowX: string;
  overflowY: string;
}

export interface RectSlice {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface SizeSlice {
  width: number;
  height: number;
}

export interface LayoutProbe {
  styleOf(element: Element): StyleSlice;
  /** The rendered text of a ::before/::after pseudo-element, or "". */
  pseudoContentOf(element: Element, pseudo: "::before" | "::after"): string;
  rectOf(element: Element): RectSlice;
  /** Layout box size (offsetWidth/offsetHeight); -1 when unknowable. */
  offsetSizeOf(element: Element): SizeSlice;
  viewportSizeOf(): SizeSlice;
  /**
   * The engine's own visibility verdict (checkVisibility), or null when
   * the engine does not offer one.
   */
  nativeVisibilityOf(element: Element): boolean | null;
}

const DEFAULT_STYLE: StyleSlice = {
  display: "block",
  visibility: "visible",
  opacity: "1",
  cursor: "auto",
  overflowX: "visible",
  overflowY: "visible",
};

const ZERO_RECT: RectSlice = {
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
};

/** The real-browser probe. Every read is fenced — cross-origin style
 * access and detached nodes throw in some engines, and a probe failure
 * must never fail a snapshot. */
export function browserLayoutProbe(): LayoutProbe {
  return {
    styleOf(element) {
      try {
        const style = window.getComputedStyle(element);
        return {
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          cursor: style.cursor,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
        };
      } catch {
        return DEFAULT_STYLE;
      }
    },
    pseudoContentOf(element, pseudo) {
      try {
        const style = window.getComputedStyle(element, pseudo);
        if (style.display === "none" || style.visibility === "hidden") {
          return "";
        }
        return pseudoTextFromContentValue(style.content);
      } catch {
        return "";
      }
    },
    rectOf(element) {
      try {
        const rect = element.getBoundingClientRect();
        return {
          top: rect.top,
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      } catch {
        return ZERO_RECT;
      }
    },
    offsetSizeOf(element) {
      if (element instanceof HTMLElement) {
        return { width: element.offsetWidth, height: element.offsetHeight };
      }
      return { width: -1, height: -1 };
    },
    viewportSizeOf() {
      return { width: window.innerWidth, height: window.innerHeight };
    },
    nativeVisibilityOf(element) {
      if (typeof element.checkVisibility !== "function") {
        return null;
      }
      try {
        return element.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
        });
      } catch {
        return null;
      }
    },
  };
}

/**
 * The text a CSS content value renders: its quoted string tokens,
 * unescaped and joined. "none"/"normal" and non-string values (counters,
 * url()) render nothing the reader can use.
 */
function pseudoTextFromContentValue(content: string): string {
  if (content === "" || content === "none" || content === "normal") {
    return "";
  }
  const tokens = content.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g);
  if (tokens === null) {
    return "";
  }
  return tokens
    .map((token) => _unescapedCssString(token.slice(1, -1)))
    .join("");
}

function _unescapedCssString(text: string): string {
  return text.replace(/\\(.)/g, (_match, escaped: string) => {
    if (escaped === "n") {
      return "\n";
    }
    if (escaped === "r") {
      return "\r";
    }
    if (escaped === "t") {
      return "\t";
    }
    return escaped;
  });
}
