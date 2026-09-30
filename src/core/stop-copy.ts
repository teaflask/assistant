// The stop door's failure vocabulary, as a dependency-free leaf:
// a failed stop must never read as a failed send — the door's
// own sentences pass through on every surface, and this one line covers
// only transport deaths that never reached the door. Lives apart from
// error-copy.ts, which imports the transport, so the ./transcript entry
// can export it to the dashboard playground without paying that closure.
export const STOP_NOT_DELIVERED_SENTENCE =
  "The stop couldn't be delivered right now. Please try again in a moment.";
