// The tool-offload anchor set: an offloaded TOOL_CALL_RESULT's content is
// the context offloader's model-facing replacement (retrieval guidance,
// stored-reference lines), not the tool's output, so the transcript reads
// this set to render the quiet shortened-result line instead. One binding
// of the shared boolean-flag family — see tool-flag-anchors.ts for the
// model and the strip-and-lift rationale.

import { toolFlagAnchorsOf } from "./tool-flag-anchors.js";

const anchors = toolFlagAnchorsOf("offloaded");

export const EMPTY_TOOL_OFFLOAD_ANCHORS = anchors.empty;
export const toolCallOffloadedOf = anchors.flagOf;
export const withToolOffloadAnchored = anchors.withAnchored;
export const wellFormedToolOffloadAnchorsOf = anchors.wellFormedOf;
export const toolOffloadRecorder = anchors.recorderOf;
