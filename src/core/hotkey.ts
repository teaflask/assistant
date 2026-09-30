// The batteries-root's hotkey grammar: parsing "mod+k"-style specs and
// matching them against keyboard events. Pure over an event-shaped input
// on purpose — no DOM or window imports — so the script-tag distribution
// can reuse the exact same binding semantics outside React.
//
// Matching is by event.key, the repo-wide idiom. Known limitation: on
// macOS the Option key rewrites event.key ("alt+k" arrives as key "˚"),
// so alt chords are not reliably bindable — none of our defaults use alt,
// and a host that needs one owns the trigger via <AssistantPalette/>.

export const DEFAULT_ASSISTANT_HOTKEY = "mod+k";

/** The subset of KeyboardEvent the matcher reads — pure and constructible
 *  in any test or non-DOM host. */
export interface HotkeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface HotkeyBinding {
  /** event.key, lowercased ("k", "j", "escape"). */
  key: string;
  /** The portable primary modifier: satisfied by meta OR ctrl. */
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

const MODIFIER_TOKENS = ["mod", "ctrl", "meta", "alt", "shift"] as const;
type ModifierToken = (typeof MODIFIER_TOKENS)[number];

/**
 * Parses a "mod+k"-style spec: "+"-separated tokens in any order, exactly
 * one non-modifier token (the key), at least one modifier drawn from
 * mod|ctrl|meta|alt|shift, case-insensitive. Exactly these five names —
 * no cmd/command/option aliases; a rejected alias warns loudly at the
 * call site, which beats two spellings of the same chord. A modifier-less
 * spec ("/", "k") is rejected too: the palette opens from anywhere, so a
 * bare key would swallow that character in every input on the page — and
 * for the same reason shift alone only pairs with a non-printable key
 * ("shift+f1" yes, "shift+k" no: Shift+letter is just typing a capital).
 * Returns null on anything else — the caller decides what a bad binding
 * means.
 */
export function parseHotkey(spec: string): HotkeyBinding | null {
  const binding: HotkeyBinding = {
    key: "",
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
  };
  for (const token of spec.toLowerCase().split("+")) {
    if (_isModifierToken(token)) {
      if (binding[token]) {
        return null;
      }
      binding[token] = true;
    } else if (_isKeyToken(token)) {
      if (binding.key !== "") {
        return null;
      }
      binding.key = token;
    } else {
      return null;
    }
  }
  if (binding.key === "" || !_hasAnyModifier(binding)) {
    return null;
  }
  if (_shiftIsTheOnlyModifier(binding) && _isPrintableKey(binding.key)) {
    return null;
  }
  return binding;
}

/**
 * Exact-chord match: named modifiers must be down and unnamed ones up
 * ("mod+k" does not match mod+shift+k — ⌘⇧K is someone else's chord).
 * `mod` is satisfied by meta or ctrl and absorbs exactly one of them, so
 * "mod+k" accepts ⌘K and Ctrl+K but rejects ⌘Ctrl+K.
 */
export function hotkeyMatches(
  binding: HotkeyBinding,
  event: HotkeyEventLike,
): boolean {
  if (event.key.toLowerCase() !== binding.key) {
    return false;
  }
  if (event.altKey !== binding.alt || event.shiftKey !== binding.shift) {
    return false;
  }
  if (_explicitlyNamedPrimaryIsUp(binding, event)) {
    return false;
  }
  // Primaries held down beyond the explicitly named ones: mod claims
  // exactly one of them; without mod there must be none.
  const unclaimedPrimariesDown =
    Number(event.metaKey && !binding.meta) +
    Number(event.ctrlKey && !binding.ctrl);
  return unclaimedPrimariesDown === (binding.mod ? 1 : 0);
}

function _isModifierToken(token: string): token is ModifierToken {
  return (MODIFIER_TOKENS as readonly string[]).includes(token);
}

// A key token is any single non-empty word that isn't a modifier — one
// event.key value ("k", "escape", "/"). Whitespace or an empty token
// (a stray "+") is a malformed spec, not a key.
function _isKeyToken(token: string): boolean {
  return token !== "" && !/\s/.test(token);
}

function _hasAnyModifier(binding: HotkeyBinding): boolean {
  return (
    binding.mod || binding.ctrl || binding.meta || binding.alt || binding.shift
  );
}

function _shiftIsTheOnlyModifier(binding: HotkeyBinding): boolean {
  return (
    binding.shift &&
    !binding.mod &&
    !binding.ctrl &&
    !binding.meta &&
    !binding.alt
  );
}

// A single-character event.key is a character the press would have typed
// ("k", "/", "?"); multi-character names ("f1", "escape") are actions.
function _isPrintableKey(key: string): boolean {
  return key.length === 1;
}

function _explicitlyNamedPrimaryIsUp(
  binding: HotkeyBinding,
  event: HotkeyEventLike,
): boolean {
  return (binding.meta && !event.metaKey) || (binding.ctrl && !event.ctrlKey);
}
