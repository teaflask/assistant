// The bundle-time virtual module: scripts/build-element.mjs resolves it
// to the built package stylesheet (rem→px transformed, Tailwind's
// `--tw-*` fallback appended ungated for the shadow root) as a text loader.
// It exists only inside the element bundle — nothing in the npm dist
// imports it.
declare module "virtual:tf-element-styles" {
  const cssText: string;
  export default cssText;
}
