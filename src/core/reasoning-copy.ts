// The reasoning step's two state labels, in core so both consumers read
// ONE spelling: components/reasoning-row.tsx renders them on the row,
// and core/run-folds.ts's liveFoldHeadlineOf names a collapsed live
// fold's latest step with them. Components import core, never the
// reverse — hoisting the strings here is what lets the pure headline
// derivation say exactly what the row says without a core→component
// import.

export const REASONING_STREAMING_LABEL = "Thinking…";
export const REASONING_SETTLED_LABEL = "Thought about it";
