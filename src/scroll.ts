// The transcript's scroll-follow guards (fork the composition, share
// the leaves; the entry has no dashboard importer). Kept public for
// tarball hosts: use-stick-to-bottom's follow-contract holes (an
// unobserved scroll element, escapes swallowed while streaming) are
// wire-agnostic and their repair exists once, here.
// Public API like "." — additions are cheap until the package publishes,
// breaking changes are a customer conversation after.
//
// Unlike ./markdown, this leaf reads React context ACROSS the package
// boundary: the host renders its own <StickToBottom> and the guards call
// useStickToBottomContext() from in here, so both sides must resolve the
// same use-stick-to-bottom module instance — context identity is per
// module copy, and a nested duplicate makes the hook throw. That is why
// use-stick-to-bottom is a peerDependency (beside react/react-dom), not
// a dependency: the host's copy is the only copy.

export { ScrollFollowGuards } from "./components/scroll-follow-guards.js";
