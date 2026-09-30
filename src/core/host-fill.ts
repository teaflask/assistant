// The fall-through rule for every host-provided node slot in the package:
// a fill declines exactly when it is a value React renders as nothing
// REGARDLESS of content — null, undefined, and both booleans, so the
// idiomatic `cond && <X/>` falls through on its false arm to the package
// default. Renderable emptiness ("", 0, []) is the host's deliberate
// content and counts as filled. One predicate, so no slot can gate on
// `!= null` and hand a `false` to the screen as a blank.
export function hostFillDeclines(fill: unknown): boolean {
  return fill === null || fill === undefined || typeof fill === "boolean";
}
