// The tool-error anchor map: an errored TOOL_CALL_RESULT's `error` extra
// is the envelope's error.message or the tool's own error text, so the
// transcript reads this map to light the call's output-error state and
// pane. One binding of the shared sentence family — see
// tool-sentence-anchors.ts for the model and the strip-and-lift
// rationale. The empty string still counts here: presence is the failure
// signal, and the pane text falls back to the result.

import { toolSentenceAnchorsOf } from "./tool-sentence-anchors.js";

const anchors = toolSentenceAnchorsOf("error", { acceptEmpty: true });

export const EMPTY_TOOL_ERROR_ANCHORS = anchors.empty;
export const toolCallErrorOf = anchors.sentenceOf;
export const withToolErrorAnchored = anchors.withAnchored;
export const wellFormedToolErrorAnchorsOf = anchors.wellFormedOf;
export const toolErrorRecorder = anchors.recorderOf;
