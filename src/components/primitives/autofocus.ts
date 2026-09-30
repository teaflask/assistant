// The package's opt-in initial-focus convention, shared by every surface
// that moves focus on open: content marks its own landing spot with
// data-tf-autofocus (the composer does), and the surface honors it. What
// happens without a mark is the surface's own affair — the modal dialog
// falls back to the native first-focusable, the non-modal panel
// deliberately moves nothing.

/** Focuses the surface's marked autofocus target, with one frame of
 * grace for content that mounts a beat after the surface is shown. The
 * predicate guards the deferred attempt: a surface that closed inside
 * that frame must not have focus pulled into it. */
export function focusAutofocusTarget(
  surface: HTMLElement,
  stillShowing: () => boolean,
): void {
  const target = surface.querySelector<HTMLElement>("[data-tf-autofocus]");
  if (target !== null) {
    target.focus();
    return;
  }
  requestAnimationFrame(() => {
    if (stillShowing()) {
      surface.querySelector<HTMLElement>("[data-tf-autofocus]")?.focus();
    }
  });
}
