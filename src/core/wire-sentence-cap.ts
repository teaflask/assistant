// The one narrowing cap for every server-derived sentence a marker or
// tool result carries (a receipt, an error, a refusal): the narrower
// distrusts the wire by contract, so a runaway sentence is retained
// capped, never unbounded. One constant so five anchor
// families cannot drift apart on the number.
export const WIRE_SENTENCE_MAX_CHARS = 2000;
