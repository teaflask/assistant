// The hotkey grammar and chord matcher. Exactness is the
// cooperation-critical part: the batteries root registers a global
// shortcut inside a customer's app, so a binding must claim its own
// chord and nothing adjacent — ⌘⇧K is someone else's muscle memory.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_ASSISTANT_HOTKEY,
  hotkeyMatches,
  parseHotkey,
  type HotkeyEventLike,
} from "../src/core/hotkey";

function keyEvent(overrides: Partial<HotkeyEventLike>): HotkeyEventLike {
  return {
    key: "k",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("parseHotkey", () => {
  it("parses the default spec", () => {
    expect(parseHotkey(DEFAULT_ASSISTANT_HOTKEY)).toEqual({
      key: "k",
      mod: true,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
  });

  it("accepts every canonical modifier alongside one key", () => {
    expect(parseHotkey("mod+ctrl+meta+alt+shift+k")).toEqual({
      key: "k",
      mod: true,
      ctrl: true,
      meta: true,
      alt: true,
      shift: true,
    });
  });

  it("is order- and case-insensitive", () => {
    expect(parseHotkey("k+mod")).toEqual(parseHotkey("mod+k"));
    expect(parseHotkey("Mod+K")).toEqual(parseHotkey("mod+k"));
    expect(parseHotkey("CTRL+SHIFT+P")).toEqual(parseHotkey("ctrl+shift+p"));
  });

  it("accepts multi-character event.key names as the key token", () => {
    expect(parseHotkey("mod+escape")?.key).toBe("escape");
  });

  it("rejects a spec without a key", () => {
    expect(parseHotkey("mod")).toBeNull();
    expect(parseHotkey("mod+shift")).toBeNull();
  });

  it("rejects a modifier-less spec — a bare key would swallow typing", () => {
    expect(parseHotkey("k")).toBeNull();
    expect(parseHotkey("/")).toBeNull();
    expect(parseHotkey("escape")).toBeNull();
  });

  it("lets shift alone pair only with non-printable keys", () => {
    // Shift+letter is just typing a capital — accepting it would swallow
    // that character in every input.
    expect(parseHotkey("shift+k")).toBeNull();
    expect(parseHotkey("shift+/")).toBeNull();
    expect(parseHotkey("shift+f1")).not.toBeNull();
    expect(parseHotkey("ctrl+shift+p")).not.toBeNull();
  });

  it("rejects two key tokens", () => {
    expect(parseHotkey("mod+k+j")).toBeNull();
  });

  it("rejects duplicate modifiers", () => {
    expect(parseHotkey("mod+mod+k")).toBeNull();
  });

  it("rejects empty and whitespace tokens", () => {
    expect(parseHotkey("")).toBeNull();
    expect(parseHotkey("mod+")).toBeNull();
    expect(parseHotkey("mod + k")).toBeNull();
  });

  it("treats unknown modifier aliases as a second key, and rejects", () => {
    expect(parseHotkey("cmd+j")).toBeNull();
    expect(parseHotkey("command+k")).toBeNull();
    expect(parseHotkey("option+k")).toBeNull();
  });
});

describe("hotkeyMatches", () => {
  const modK = parseHotkey("mod+k");
  if (modK === null) {
    throw new Error("mod+k must parse");
  }

  it("lets mod ride either primary", () => {
    expect(hotkeyMatches(modK, keyEvent({ metaKey: true }))).toBe(true);
    expect(hotkeyMatches(modK, keyEvent({ ctrlKey: true }))).toBe(true);
  });

  it("matches the key case-insensitively", () => {
    expect(hotkeyMatches(modK, keyEvent({ key: "K", metaKey: true }))).toBe(
      true,
    );
  });

  it("rejects the shifted chord even though shift uppercases the key", () => {
    expect(
      hotkeyMatches(
        modK,
        keyEvent({ key: "K", metaKey: true, shiftKey: true }),
      ),
    ).toBe(false);
  });

  it("rejects the bare key and extra modifiers — exact chords only", () => {
    expect(hotkeyMatches(modK, keyEvent({}))).toBe(false);
    expect(
      hotkeyMatches(modK, keyEvent({ metaKey: true, shiftKey: true })),
    ).toBe(false);
    expect(hotkeyMatches(modK, keyEvent({ metaKey: true, altKey: true }))).toBe(
      false,
    );
    expect(
      hotkeyMatches(modK, keyEvent({ metaKey: true, ctrlKey: true })),
    ).toBe(false);
  });

  it("holds explicit primaries to their own key", () => {
    const ctrlK = parseHotkey("ctrl+k");
    if (ctrlK === null) {
      throw new Error("ctrl+k must parse");
    }
    expect(hotkeyMatches(ctrlK, keyEvent({ ctrlKey: true }))).toBe(true);
    expect(hotkeyMatches(ctrlK, keyEvent({ metaKey: true }))).toBe(false);
    expect(
      hotkeyMatches(ctrlK, keyEvent({ metaKey: true, ctrlKey: true })),
    ).toBe(false);
  });

  it("makes mod claim a primary beyond the explicitly named one", () => {
    const modCtrlK = parseHotkey("mod+ctrl+k");
    if (modCtrlK === null) {
      throw new Error("mod+ctrl+k must parse");
    }
    expect(
      hotkeyMatches(modCtrlK, keyEvent({ metaKey: true, ctrlKey: true })),
    ).toBe(true);
    expect(hotkeyMatches(modCtrlK, keyEvent({ ctrlKey: true }))).toBe(false);
  });

  it("requires named alt and shift", () => {
    const ctrlShiftP = parseHotkey("ctrl+shift+p");
    if (ctrlShiftP === null) {
      throw new Error("ctrl+shift+p must parse");
    }
    expect(
      hotkeyMatches(
        ctrlShiftP,
        keyEvent({ key: "P", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(true);
    expect(
      hotkeyMatches(ctrlShiftP, keyEvent({ key: "p", ctrlKey: true })),
    ).toBe(false);
  });
});
