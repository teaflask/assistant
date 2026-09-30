// The tool-call display anchor model, pure of React: the recorder maps
// each tool_call_annotated CUSTOM marker to its toolCallId, the
// transcript reads the map to headline the call with the backend's own
// copy, and the resume store holds the map across remounts. The
// indirection exists because a CUSTOM marker never becomes a message —
// like the tool-error anchors, this map is the copy's only home on the
// client, and it must outlive the epoch: a snapshot-seeded reconnect
// replays only past the cursor, so historical rows keep their copy from
// here alone.

import type { AgentSubscriber } from "@ag-ui/client";

import { TOOL_CALL_ANNOTATED_EVENT_NAME } from "../contract/events.js";
import type { ToolCallDisplay } from "./tool-call-display.js";

// The sentences are backend-authored (already clipped at the source),
// but the narrower distrusts the wire by contract; a runaway sentence is
// retained capped, never unbounded.
const DISPLAY_TEXT_MAX_CHARS = 500;

// Vocabulary tokens (icon) are single words by contract; a
// runaway token is retained capped like a sentence, and an unknown
// token resolves to its documented fallback downstream.
const TOKEN_MAX_CHARS = 64;

// A view key is an opaque registry handle (the tool-views contract);
// one this long could never have been registered, so an over-cap key
// drops the whole ref rather than clipping into a key that matches
// nothing.
const VIEW_KEY_MAX_CHARS = 128;

export const EMPTY_TOOL_CALL_DISPLAY_ANCHORS: ReadonlyMap<
  string,
  ToolCallDisplay
> = new Map();

/**
 * Narrow a tool_call_annotated marker's value. Null means ignore — the
 * contract's "clients MUST ignore events and fields they do not
 * recognize": a blank text is no sentence, and a display carrying no
 * recognized field annotates nothing. `kind` left the wire and the
 * client model: it is no longer a recognized field
 * of this contract, so a present `kind` of any value is ignored like
 * any other unrecognized field — never a display-blanking gate. A
 * future display variant arrives as a new field or marker; views are
 * the generative-UI door.
 */
export function toolCallDisplayAnchorOf(
  value: unknown,
): { toolCallId: string; display: ToolCallDisplay } | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { tool_call_id: toolCallId, display } = value as {
    tool_call_id?: unknown;
    display?: unknown;
  };
  if (typeof toolCallId !== "string" || toolCallId === "") {
    return null;
  }
  if (typeof display !== "object" || display === null) {
    return null;
  }
  const { caption, progress_text, complete_text, error_text, icon, view } =
    display as {
      caption?: unknown;
      progress_text?: unknown;
      complete_text?: unknown;
      error_text?: unknown;
      icon?: unknown;
      view?: unknown;
    };
  const narrowed: ToolCallDisplay = {};
  const captionText = _displayTextOf(caption);
  if (captionText !== undefined) {
    narrowed.caption = captionText;
  }
  const progressText = _displayTextOf(progress_text);
  if (progressText !== undefined) {
    narrowed.progressText = progressText;
  }
  const completeText = _displayTextOf(complete_text);
  if (completeText !== undefined) {
    narrowed.completeText = completeText;
  }
  const errorText = _displayTextOf(error_text);
  if (errorText !== undefined) {
    narrowed.errorText = errorText;
  }
  const iconToken = _tokenOf(icon);
  if (iconToken !== undefined) {
    narrowed.icon = iconToken;
  }
  const viewRef = _viewRefOf(view);
  if (viewRef !== undefined) {
    narrowed.view = viewRef;
  }
  if (
    narrowed.caption === undefined &&
    narrowed.progressText === undefined &&
    narrowed.completeText === undefined &&
    narrowed.errorText === undefined &&
    narrowed.icon === undefined &&
    narrowed.view === undefined
  ) {
    return null;
  }
  return { toolCallId, display: narrowed };
}

/**
 * Idempotent per-field merge: one call's copy legitimately arrives as
 * more than one marker (the progress sentence at start-of-run, the
 * completion sentence at finish, a tool body's richer completion first),
 * and every replay re-delivers them all. First non-absent value per
 * field wins — re-applying the same sequence changes nothing, and a
 * no-op merge returns the map unchanged: identity is the publish gate.
 */
export function withToolCallDisplayAnchored(
  previous: ReadonlyMap<string, ToolCallDisplay>,
  toolCallId: string,
  display: ToolCallDisplay,
): ReadonlyMap<string, ToolCallDisplay> {
  const existing = previous.get(toolCallId);
  if (existing === undefined) {
    const next = new Map(previous);
    next.set(toolCallId, display);
    return next;
  }
  if (
    (existing.caption !== undefined || display.caption === undefined) &&
    (existing.progressText !== undefined ||
      display.progressText === undefined) &&
    (existing.completeText !== undefined ||
      display.completeText === undefined) &&
    (existing.errorText !== undefined || display.errorText === undefined) &&
    (existing.icon !== undefined || display.icon === undefined) &&
    (existing.view !== undefined || display.view === undefined)
  ) {
    return previous;
  }
  const merged: ToolCallDisplay = {};
  const caption = existing.caption ?? display.caption;
  if (caption !== undefined) {
    merged.caption = caption;
  }
  const progressText = existing.progressText ?? display.progressText;
  if (progressText !== undefined) {
    merged.progressText = progressText;
  }
  const completeText = existing.completeText ?? display.completeText;
  if (completeText !== undefined) {
    merged.completeText = completeText;
  }
  const errorText = existing.errorText ?? display.errorText;
  if (errorText !== undefined) {
    merged.errorText = errorText;
  }
  const icon = existing.icon ?? display.icon;
  if (icon !== undefined) {
    merged.icon = icon;
  }
  // The view ref merges ATOMICALLY: the first non-absent whole
  // {key, version} wins — a key from one marker must never weld to a
  // version from another.
  const view = existing.view ?? display.view;
  if (view !== undefined) {
    merged.view = view;
  }
  const next = new Map(previous);
  next.set(toolCallId, merged);
  return next;
}

/**
 * A defensive copy for seeding transcript state from the resume store:
 * entries that are not a string keyed text display are dropped rather
 * than rendered (or crashed on). The store is in-memory today, so every
 * entry passed the narrower — this seam is where any future persisted
 * form of the store must degrade gracefully: a dropped display falls
 * back to the mechanical headline until the next full replay.
 */
export function wellFormedToolCallDisplayAnchorsOf(
  stored: ReadonlyMap<string, ToolCallDisplay>,
): ReadonlyMap<string, ToolCallDisplay> {
  const seeded = new Map<string, ToolCallDisplay>();
  // The narrowing deliberately distrusts the map's own types: this seam
  // is what turns a stale shape into a missing display, never a crash.
  const entries = stored as ReadonlyMap<unknown, unknown>;
  for (const [toolCallId, display] of entries) {
    if (typeof toolCallId !== "string" || !_isWellFormedDisplay(display)) {
      continue;
    }
    seeded.set(toolCallId, display);
  }
  return seeded;
}

/**
 * Narrow the turn record's `pending_approval_displays` map —
 * the REST recovery read's display annotations, keyed by tool call id,
 * the same `tool_call_annotated` content the stream replays. Distrusts
 * the wire exactly as the stream recorder does by reusing its narrower
 * (REST nulls become absent fields, so downstream `undefined` semantics
 * — an absent icon resolves generic — stay sound); a malformed entry is
 * dropped, never rendered or crashed on.
 */
export function restDisplayAnchorsOf(
  value: unknown,
): ReadonlyMap<string, ToolCallDisplay> {
  const anchors = new Map<string, ToolCallDisplay>();
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return anchors;
  }
  for (const [toolCallId, display] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const anchor = toolCallDisplayAnchorOf({
      tool_call_id: toolCallId,
      display,
    });
    if (anchor !== null) {
      anchors.set(anchor.toolCallId, anchor.display);
    }
  }
  return anchors;
}

/** Records each annotated call's toolCallId → display envelope. */
export function toolCallDisplayRecorder(
  onDisplayAnchored: (toolCallId: string, display: ToolCallDisplay) => void,
): AgentSubscriber {
  return {
    onCustomEvent({ event }) {
      if (event.name !== TOOL_CALL_ANNOTATED_EVENT_NAME) {
        return;
      }
      const anchor = toolCallDisplayAnchorOf(event.value);
      if (anchor !== null) {
        onDisplayAnchored(anchor.toolCallId, anchor.display);
      }
    },
  };
}

function _displayTextOf(text: unknown): string | undefined {
  if (typeof text !== "string" || text.trim() === "") {
    return undefined;
  }
  return text.slice(0, DISPLAY_TEXT_MAX_CHARS);
}

/** A vocabulary token (icon): a non-blank string, retained capped.
 *  Unknown tokens survive verbatim — the presentation resolver owns the
 *  fallback, so an older build's store never destroys a newer wire
 *  value. */
function _tokenOf(token: unknown): string | undefined {
  if (typeof token !== "string" || token.trim() === "") {
    return undefined;
  }
  return token.slice(0, TOKEN_MAX_CHARS);
}

/** The view ref narrows whole or not at all — key and version are
 *  meaningless apart, so any malformed half drops the entire ref (the
 *  package default rendering takes over, never a mismatched pair). */
function _viewRefOf(
  view: unknown,
): { key: string; version: number } | undefined {
  if (typeof view !== "object" || view === null) {
    return undefined;
  }
  const { key, version } = view as { key?: unknown; version?: unknown };
  if (
    typeof key !== "string" ||
    key.trim() === "" ||
    key.length > VIEW_KEY_MAX_CHARS
  ) {
    return undefined;
  }
  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    return undefined;
  }
  return { key, version };
}

function _isWellFormedDisplay(display: unknown): display is ToolCallDisplay {
  if (typeof display !== "object" || display === null) {
    return false;
  }
  // This predicate asserts the CLIENT model — every recognized field
  // well-typed or absent, at least one present. Extra properties (a
  // future persisted store's stale `kind`, say) are tolerated exactly
  // as the wire narrower tolerates unrecognized fields; a malformed
  // recognized field drops the entry fail-closed.
  const { caption, progressText, completeText, errorText, icon, view } =
    display as {
      caption?: unknown;
      progressText?: unknown;
      completeText?: unknown;
      errorText?: unknown;
      icon?: unknown;
      view?: unknown;
    };
  const fieldsAreWellTypedOrAbsent =
    (caption === undefined || typeof caption === "string") &&
    (progressText === undefined || typeof progressText === "string") &&
    (completeText === undefined || typeof completeText === "string") &&
    (errorText === undefined || typeof errorText === "string") &&
    (icon === undefined || typeof icon === "string") &&
    (view === undefined || _viewRefOf(view) !== undefined);
  return (
    fieldsAreWellTypedOrAbsent &&
    (caption !== undefined ||
      progressText !== undefined ||
      completeText !== undefined ||
      errorText !== undefined ||
      icon !== undefined ||
      view !== undefined)
  );
}
