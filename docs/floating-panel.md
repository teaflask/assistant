# The floating panel — the non-modal top-layer decision

**Status: accepted.**

The primitives-layer floating surface
(`src/components/primitives/floating-panel.tsx`) rides `popover="manual"`
on a plain element. Why that mechanic, what the modal contract gave the
dialog for free and what this surface does about each piece, the stacking
manners, the yield rule under a modal, and the recorded deferrals. The
module keeps the decisions in short form and points here for the
argument.

```text
// The primitives-layer NON-MODAL floating surface: a corner-anchored
// panel the companion expands into, riding popover="manual" on a plain
// element. The choice of mechanic is the decision this file exists to
// record, so here it is in full.
//
// Why a manual popover: it is the one primitive that buys top-layer
// paint WITHOUT modality. The page behind stays fully interactive — no
// inert, no focus trap, no focus steal on showPopover(), no light
// dismiss — while the element still paints above every host stacking
// context with zero z-index, and still sits where React rendered it, so
// host `--tf-*` variables and `data-tf-theme` keep inheriting (the same
// argument dialog.tsx makes for its top layer). The alternative — a
// position:fixed element with a giant z-index — silently breaks the
// moment any host ancestor carries a transform, filter, will-change or
// container-type: those re-parent the containing block and the "fixed"
// panel scrolls away with the page. The top layer is immune to that, and
// it works from inside a shadow root. A non-modal dialog.show() gets
// neither the top layer nor manners: it runs the dialog focusing steps
// and steals focus on open, which a presence surface must never do.
// The named degradation path, should a customer's browser matrix demand
// one, is that fixed element with a documented z-band, keyed off a data
// attribute instead of :popover-open — deliberately not built today. In
// a browser without popover support this panel simply never opens (the
// effect below no-ops and the `hidden` class holds).
//
// What the modal contract gave the dialog for free, and what this
// surface does about each piece:
// - The inert page: dropped deliberately — being usable alongside the
//   host page is the entire feature.
// - The focus trap: dropped. Tab walks out of the panel into the host in
//   DOM order; trapping a non-modal surface would make "the page stays
//   interactive" a lie for keyboard users.
// - Esc via `cancel`: re-implemented, panel-scoped. Escape closes the
//   panel only while focus is inside it — a document-level listener
//   would fight the host's own Esc semantics.
// - Focus on open: opt-in, same convention as the dialog — content marks
//   its landing spot with data-tf-autofocus. Opening is an explicit user
//   act (the companion is clicked), so moving the caret in is right;
//   with nothing marked, focus does not move at all.
// - Focus return on close: re-implemented, conditionally. The opener is
//   remembered before showPopover() and restored only when focus is
//   still inside the panel at close — a user who went back to work must
//   not be teleported. Manual popovers get no reliable native restore.
// - Backdrop click-to-close: dropped on purpose. A presence surface
//   survives while the user works; its ::backdrop is never styled and
//   popover backdrops don't intercept the pointer anyway.
// - Scroll: never locked; the panel's content scrolls internally.
//
// Stacking manners in the top layer: promotion order is the only rule,
// so host popovers and toasts shown after this panel paint above it —
// transient host UI over a persistent presence surface is correct, and
// the package still ships no z-index at all.
//
// The one force the panel cannot resist is a modal: showModal() (the
// host's, or our own palette) makes the whole document inert and paints
// above later in the top layer. Current Chromium leaves a MANUAL popover
// open through that — the panel simply sits inert under the modal's
// backdrop like the rest of the page, which is already the right
// manners. But engines have also shipped the hide-all-popovers reading
// of showModal, and a host script can hidePopover() anything — and
// either of those is a YIELD, not a close: re-showing over a page the
// host deliberately inerted would be exactly the wrong instinct, and
// reporting a close would lose the user's panel to a dialog they merely
// glanced at. So a hide the panel didn't initiate parks it: `open` stays
// true, the panel waits for modals to leave (a dialog closing,
// fullscreen ending), and comes back without touching focus.
//
// Known deferrals, recorded rather than discovered later: the software
// keyboard on a bottom-anchored panel (the conversation surface's
// problem, with the composer), and scroll-position-aware swipe
// arbitration (dismiss only at scrollTop 0) — until then the dismissing
// swipe is confined to the grab region below.
```
