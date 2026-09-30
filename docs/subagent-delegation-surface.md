# The subagent delegation surface — its failure-mode ledger

**Status: accepted.** The design record for
`src/components/subagent-delegation-surface.tsx`. The module's comments
cite the ledger's modes by number ("failure-mode ledger, mode 8"); the
numbers resolve here. Tests named without a path live in
`tests/subagent-delegation-surface.test.tsx`. Inside a fenced block,
"here", "below" and "this surface" refer to the module, not to this
document.

## What the surface is

```text
The conversation's drill-in host: the provider that makes the
inline delegation rows' affordance reachable in production. A row's
click hands over its child session and its own element (the opener
focus returns to — never an activeElement read); this surface floats
the SAME preview shell the roster uses (subagent-preview-popover.tsx →
ChildTranscriptPreview), so the drill-in reuses the shipped child
driver — the capacity-1 tail lease, replay-without-tailing for settled
children, the child's identity token — rather than growing a second
one. The popover is browser top-layer content: nothing here adds a
scroll region, covers the composer, or touches the follow machinery
(TVC-120/122 stay the pill's and the shelf's laws).

This surface also OWNS the current-work map (subagent-current-work.tsx):
the open preview's stream publishes its newest live call here, and the
group rows below read it — one honest writer, zero extra streams.
```

## The failure-mode ledger

```text
─── The surface's failure-mode ledger ───────────────────────
Every way this lifecycle can move, its expected outcome, and its named
test — or the recorded reason it has none (tests live in
tests/subagent-delegation-surface.test.tsx unless named otherwise):

 1. Mount without a thread id → drill-in seam stays null, rows render
    passive, map empty. Test: "without a thread id the rows stay
    honestly passive".
 2. Row activation → the shared preview floats beside exactly that
    row, keyed per child, wearing its variant; focus enters the
    dialog. Test: "a row's drill-in opens the shared preview…".
 3. A second row activated while one is open → the keyed popover
    remounts for the new child; one preview at a time. No dedicated
    test: the remount is React key semantics, and mode 2's test pins
    the one-preview invariant.
 4. Child-stream delta that leaves the newest live call's label
    evidence unchanged (prose, reasoning, the same call's argument
    stream) → the publisher hands over a FRESH object every time, so
    only the VALUE bail-out below fires: the map identity holds and
    no consumer re-renders. Test: "equal-evidence publishes
    coalesce…" (its negative control — guard deleted — goes red).
 5. The newest call changes, or its caption or authored progressText
    lands → the map moves and the row's line updates in place. Test: same
    test, third render.
 6. The child settles, the stream ends, or its surface closes → the
    child transcript publishes null (guarded by its publishedRef so
    only a surface that actually published may clear) and the line
    disappears. Test: tests/child-transcript.test.tsx "publishes the
    newest live call … and clears it when the stream leaves".
 7. A slot-denied second surface on the SAME child (the capacity-1
    pool) → it never held the tail, never published, and its
    unmount therefore cannot blank the holder's entry. No dedicated
    test: the guard is child-transcript.tsx's publishedRef branch,
    and pool contention itself is pinned by the child-transcript
    waiting-state tests.
 8. Thread switch while a drill-in is open → what ACTUALLY enforces
    this in the shipped host is the host itself: conversation-view
    keys <Transcript> by thread.id#reconnectNonce, so this whole
    surface REMOUNTS and its state is gone. The surface's own
    defense — for any host that keeps it mounted — is the per-VISIT
    stamp: a fresh token per contiguous thread visit, so the entry is
    stale on A→B and cannot revive on B→A (a thread-id stamp matched
    again on the way back). No focus restore on
    this arm; the old previews unmount and clear their map entries
    via mode 6. Test (harsher than production — in-place prop swap,
    no remount): "a thread switch drops an open drill-in — and
    returning to the first thread never revives it".
 9. Escape / pointer-down outside → close(), focus back to the
    opener. Escape's enforcement is a NATIVE listener on the popover
    element itself, stopping propagation — a document-level listener
    would not do: inside the companion drawer it never runs,
    because the drawer's own Esc-to-close is a React onKeyDown
    dispatched from the root container (an ancestor of the popover,
    a descendant of document), which stops the event and minimizes
    the assistant instead. Tests: "Escape dismisses the preview
    itself — never a host panel above it", "Escape closes the
    preview and hands focus back to the opener", "a pointer down
    outside dismisses…".
10. The opener unmounted OR hidden during the visit → every restore
    rides focusIfRestorable: disconnected is skipped, and a
    connected-but-hidden opener (isConnected does not test
    visibility) hands focus to its group's visible summary instead of
    silently no-opping. Tests: tests/child-transcript.test.tsx "a
    disconnected opener is skipped, never a crash" (the disconnect
    arm) and the collapse probe (the hidden arm).
11. StrictMode double-invoke / interrupted update queues → the
    setState updater is PURE (the focus call lives
    outside it), and the document listeners attach/detach idempotently in
    one effect. No dedicated StrictMode test: purity is structural;
    the stream half's StrictMode behavior is the tail pool's own
    idempotent-acquire law.
12. Unmount with the popover open → the open effect's cleanup removes
    both document listeners and the popover shell hides itself; a
    leaked listener would land in vitest's unhandled-error trap
    (every test's afterEach unmounts mid-state). Accepted as the
    enforcement, no stronger named test.
13. Remount on reconnect/replay → the shipped host forces this too
    (the Transcript key includes reconnectNonce): nothing here is
    server state — the map rebuilds from live publishers alone, the
    drill-in starts closed, and the color variants are pure
    functions of durable ledger ordinals. Test:
    tests/subagent-presence.test.ts determinism cases.
14. A SIBLING preview surface opens (the count pill's roster —
    subagent-count-pill.tsx) → at most one
    child preview surface is open at a time: the roster's open paths
    call this seam's dismiss() (which restores the opener exactly
    when the popover holds focus; see dismiss()), so the roster's defocus blur
    (activity-shelf-slot-contract.md §6 — a POSITIONAL rule that
    would blur and inert this popover, a direct conversation-body
    child) never applies to an open preview, and the capacity-1 tail
    lease never has two previews contending. The reverse direction
    was already exclusive: activating a row fires pointerdown outside
    the roster and light-dismisses it. Tests: "hovering the pill's
    roster open dismisses an open drill-in…" (jsdom, the seam) and
    the subagent-defocus probe (container, the rendered blur measured
    before the fix and the exclusion after).
15. The opener hides while its preview is open: the
    group's <details> auto-collapses the moment the last coworker
    settles (`open={counts.running > 0 || undefined}`), and a
    keyboard toggle does the same — pointer-driven collapses dismiss
    the preview first via light dismissal, so the hidden-anchor arm
    is reached WITHOUT a pointer. Consequences and their guards: the
    popover keeps its LAST placement rather than re-placing against
    an all-zeros rect (the corner jump; the re-place guard in
    subagent-preview-popover.tsx — the initial placement stays
    unconditional, since a boxless control cannot be activated), and
    focus restoration goes through focusIfRestorable:
    isConnected does NOT test visibility, so a hidden
    opener hands focus to its group's visible summary instead of
    silently no-opping to <body>. Test: the container probe "a
    collapsing group keeps its preview placed and hands focus to the
    summary" (tvc-geometry.spec.ts, both arms falsified).
    WHY THE LEDGER MISSED IT, recorded rather than patched silently:
    modes 1–13 enumerate this surface's OWN lifecycle — mount, open,
    deltas, settle, dismissal, remount. They never asked what other
    surfaces can be open at the same time; interactions with
    independently-owned siblings sharing the same resources (the
    defocus rule's selector, the tail budget, focus) are a whole
    class the single-surface frame cannot see. An enumeration of a
    surface must also enumerate its NEIGHBORS.
```
