// The tool-cancel anchor set: a cancelled TOOL_CALL_RESULT's content is
// the model-facing cancellation text, so the transcript reads this set to
// light the call's cancelled state and keep that text off the Result
// pane. One binding of the shared boolean-flag family — see
// tool-flag-anchors.ts for the model and the strip-and-lift rationale.

import { toolFlagAnchorsOf } from "./tool-flag-anchors.js";

const anchors = toolFlagAnchorsOf("cancelled");

export const EMPTY_TOOL_CANCEL_ANCHORS = anchors.empty;
export const toolCallCancelledOf = anchors.flagOf;
export const withToolCancelAnchored = anchors.withAnchored;
export const wellFormedToolCancelAnchorsOf = anchors.wellFormedOf;
export const toolCancelRecorder = anchors.recorderOf;
