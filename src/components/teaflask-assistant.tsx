"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";

import {
  DEFAULT_ASSISTANT_HOTKEY,
  hotkeyMatches,
  parseHotkey,
  type HotkeyBinding,
} from "../core/hotkey.js";
import {
  AssistantCompanion,
  type AssistantCompanionProps,
} from "./assistant-companion.js";
import { AssistantPalette } from "./assistant-palette.js";
import {
  TeaflaskAssistantProvider,
  type TeaflaskAssistantProviderProps,
} from "./teaflask-assistant-provider.js";

// The batteries-included root: the one-mount integration that yields the
// whole product face — the companion on every route, the palette on ⌘K,
// the chat drawer on click — and owns the palette trigger.
//
// The hotkey cooperates rather than captures: the listener sits on window
// in the bubble phase — last in dispatch order — so a host handler that
// preventDefault()s first (or stops propagation) wins, and we claim an
// event only when we act on it. No focus carve-out: the chord summons the
// palette from a focused input too — an editor that needs ⌘K should
// preventDefault(), rebind us, or pass hotkey={false}. The chord toggles
// the palette closed again. One root per page: a second instance would
// double-toggle the hotkey and mount a second companion.

export interface TeaflaskAssistantHandle {
  /**
   * Opens the palette regardless of the hotkey setting — the imperative
   * escape hatch for a host that disabled or rebound the chord. Call it
   * through the ref's optional chain (`ref.current?.openPalette()`): the
   * handle exists only while the root is mounted, so an early or late
   * call no-ops instead of throwing. Opening the palette makes the
   * companion yield (hide) until it closes — by design: the palette
   * counts as an open assistant surface.
   */
  openPalette: () => void;
}

export interface TeaflaskAssistantProps extends TeaflaskAssistantProviderProps {
  /**
   * The palette chord, "mod+k" by default (mod = ⌘ or Ctrl). Rebind with
   * the same grammar ("mod+j", "ctrl+shift+p") when your app already
   * spends ⌘K, or pass false to disable — the ref handle still opens the
   * palette. An unrecognized spec disables the hotkey with a console
   * warning rather than falling back: a host rebinding away from a
   * conflict must never be silently rebound into it.
   */
  hotkey?: string | false;
  /** The viewport corner the companion (and its drawer) anchor to. */
  corner?: AssistantCompanionProps["corner"];
}

// forwardRef rather than ref-as-prop: the peer range admits React 18.3,
// where a function component receives no ref through props. The ref
// carries TeaflaskAssistantHandle (see its doc above).
export const TeaflaskAssistant = forwardRef<
  TeaflaskAssistantHandle,
  TeaflaskAssistantProps
>(function TeaflaskAssistant(
  { hotkey = DEFAULT_ASSISTANT_HOTKEY, corner, children, ...providerProps },
  ref,
) {
  const [paletteOpen, setPaletteOpen] = useState(false);

  const openPalette = useCallback(() => {
    setPaletteOpen(true);
  }, []);
  useImperativeHandle(ref, () => ({ openPalette }), [openPalette]);

  const binding = useMemo(() => _bindingOf(hotkey), [hotkey]);
  useEffect(() => {
    if (binding === null) {
      return;
    }
    const togglePaletteOnHotkey = (event: KeyboardEvent) => {
      if (!hotkeyMatches(binding, event)) {
        return;
      }
      if (event.repeat) {
        // OS auto-repeat while the chord is held: one press is one
        // toggle, not a flicker that lands wherever the key-up falls.
        return;
      }
      if (event.defaultPrevented) {
        // A host handler acted on this chord first — cooperate.
        return;
      }
      event.preventDefault();
      // A functional toggle: pure under StrictMode, always reads the
      // committed truth, and keeps the subscription keyed on the binding
      // alone.
      setPaletteOpen((open) => !open);
    };
    window.addEventListener("keydown", togglePaletteOnHotkey);
    return () => {
      window.removeEventListener("keydown", togglePaletteOnHotkey);
    };
  }, [binding]);

  return (
    <TeaflaskAssistantProvider {...providerProps}>
      {children}
      <AssistantCompanion corner={corner} />
      <AssistantPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </TeaflaskAssistantProvider>
  );
});

// Bad specs warn once each, not once per render — a root re-rendering
// sixty times a second must not flood the console with the same typo.
const warnedHotkeySpecs = new Set<string>();

// The active binding, or null when the hotkey is off: disabled by the
// host, or disabled by an unparseable spec (warn-then-degrade, the
// companion loader's manner — never a silent fallback to the very chord
// the host was rebinding away from).
function _bindingOf(hotkey: string | false): HotkeyBinding | null {
  if (hotkey === false) {
    return null;
  }
  const binding = parseHotkey(hotkey);
  if (binding === null && !warnedHotkeySpecs.has(hotkey)) {
    warnedHotkeySpecs.add(hotkey);
    console.warn(
      `[teaflask-assistant] Unrecognized hotkey "${hotkey}" — expected ` +
        `"mod+k"-style tokens (mod|ctrl|meta|alt|shift + one key). The ` +
        `hotkey is disabled; the ref handle still opens the palette.`,
    );
  }
  return binding;
}
