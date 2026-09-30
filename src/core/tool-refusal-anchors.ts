// The tool-refusal anchor map: a refused TOOL_CALL_RESULT's
// `refused` extra is the door's own refusal sentence — a door that
// answered and declined — so the transcript reads this map to light the
// call's refused state and show the sentence as the row's reason. One
// binding of the shared sentence family — see tool-sentence-anchors.ts
// for the model and the strip-and-lift rationale. Only a non-empty
// string counts here: the sentence IS the reason the row shows, and the
// mapper never stamps an empty one.

import { toolSentenceAnchorsOf } from "./tool-sentence-anchors.js";

const anchors = toolSentenceAnchorsOf("refused", { acceptEmpty: false });

export const EMPTY_TOOL_REFUSAL_ANCHORS = anchors.empty;
export const toolCallRefusalOf = anchors.sentenceOf;
export const withToolRefusalAnchored = anchors.withAnchored;
export const wellFormedToolRefusalAnchorsOf = anchors.wellFormedOf;
export const toolRefusalRecorder = anchors.recorderOf;
