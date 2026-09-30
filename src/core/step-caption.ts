// The protocol-reserved argument key: every tool's schema
// carries the model's `caption`, and it is the row's label, not an
// argument — stripped before a tool view or an approval card reads the
// arguments. A dependency-free leaf, so the approval narrowing stays one.

export const STEP_CAPTION_ARG_KEY = "caption";

/** `args` without the reserved key: the same object when the key is
 *  absent, else a copy — the source is never mutated. */
export function withoutStepCaption(
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (!(STEP_CAPTION_ARG_KEY in args)) {
    return args;
  }
  return Object.fromEntries(
    Object.entries(args).filter(([key]) => key !== STEP_CAPTION_ARG_KEY),
  );
}
