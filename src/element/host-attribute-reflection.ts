// The shadow boundary's one theming gap: `--tf-*` custom properties
// inherit straight through it, and the media-query routes
// (prefers-color-scheme, prefers-reduced-motion) never needed the DOM at
// all — but `[data-tf-theme="dark"] …` and `[data-reduce-motion="true"]
// …` are descendant selectors, and selectors never match across a shadow
// boundary. The bridge: watch the host document for those two attributes
// and mirror the nearest ancestor's value onto a wrapper INSIDE the
// shadow tree, where the selectors (and the `element.closest()`
// sniffers) can see it again.

const REFLECTED_HOST_ATTRIBUTES = ["data-tf-theme", "data-reduce-motion"];

export function startHostAttributeReflection(
  host: HTMLElement,
  target: HTMLElement,
): () => void {
  const reflect = () => {
    for (const attribute of REFLECTED_HOST_ATTRIBUTES) {
      const carrier = host.closest(`[${attribute}]`);
      const value = carrier?.getAttribute(attribute);
      if (value === undefined || value === null) {
        target.removeAttribute(attribute);
      } else {
        target.setAttribute(attribute, value);
      }
    }
  };
  reflect();
  const observer = new MutationObserver(reflect);
  observer.observe(host.ownerDocument.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: REFLECTED_HOST_ATTRIBUTES,
  });
  return () => {
    observer.disconnect();
    for (const attribute of REFLECTED_HOST_ATTRIBUTES) {
      target.removeAttribute(attribute);
    }
  };
}
