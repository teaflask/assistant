"use client";

// The conversation's drill-in host: the provider that makes the inline
// delegation rows' affordance reachable. A row's click hands over its
// child session and its own element (the opener focus returns to — never
// an activeElement read); this surface floats the SAME preview shell the
// roster uses (subagent-preview-popover.tsx → ChildTranscriptPreview),
// so the drill-in reuses the shipped child driver rather than growing a
// second one. The popover is top-layer content: nothing here adds a
// scroll region, covers the composer, or touches the follow machinery
// (TVC-120/122 stay the pill's and the shelf's laws). This surface also
// OWNS the current-work map (subagent-current-work.tsx): the open
// preview's stream publishes its newest live call here, the group rows
// read it — one writer, zero extra streams. The surface's failure-mode
// ledger — every way this lifecycle can move, its outcome and its named
// test, modes 1–15 cited below by number — is
// docs/subagent-delegation-surface.md.

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import {
  coworkerIndicesOf,
  sameCurrentWorkView,
} from "../core/subagent-presence.js";
import type { ToolCallViewModel } from "../core/tool-call-display.js";
import type { ThreadDispatch } from "../contract/dispatches.js";
import { ChildTranscriptPreview } from "./child-transcript.js";
import {
  SubagentCurrentWorkContext,
  SubagentCurrentWorkPublisherContext,
  type SubagentCurrentWorkPublisher,
} from "./subagent-current-work.js";
import {
  SubagentDrillInContext,
  type SubagentDrillIn,
} from "./subagent-drill-in.js";
import { SubagentPreviewPopover } from "./subagent-preview-popover.js";

/** Focus restoration with an HONEST guard: isConnected does
 *  NOT test visibility — a collapsed <details> group keeps its row
 *  connected but boxless, and focus() on a hidden element silently
 *  no-ops. The opener is focused only when connected AND visible;
 *  checkVisibility is feature-tested (jsdom defines none; absent ⇒
 *  visible) and its visibility/opacity options are load-bearing — the
 *  bare call defaults them OFF and a `visibility: hidden` opener reads
 *  as visible. Hidden by a group collapse, the group's summary takes
 *  the focus; hidden by the activity slot yielding to scrollback, the
 *  merged jump affordance does. */
export function focusIfRestorable(opener: HTMLElement | null): void {
  if (!opener?.isConnected) {
    return;
  }
  const visible =
    (
      opener as {
        checkVisibility?: (options?: Record<string, boolean>) => boolean;
      }
    ).checkVisibility?.({
      visibilityProperty: true,
      opacityProperty: true,
      checkVisibilityCSS: true,
      checkOpacity: true,
    }) ?? true;
  if (visible) {
    opener.focus();
    return;
  }
  const summary = opener.closest("details")?.querySelector("summary");
  if (summary instanceof HTMLElement) {
    summary.focus();
    return;
  }
  if (opener.closest("[data-tf-activity-slot]") !== null) {
    const root = opener.getRootNode();
    const jump =
      root instanceof Document || root instanceof ShadowRoot
        ? root.querySelector("[data-tf-scroll-away-activity]")
        : null;
    if (jump instanceof HTMLElement) {
      jump.focus();
    }
  }
}

interface OpenDrillIn {
  childSessionId: string;
  opener: HTMLElement | null;
  /** The thread VISIT the drill-in was opened under (failure-mode
   *  ledger, mode 8): a per-visit token, not the thread id — a
   *  thread-id stamp matches AGAIN on A→B→A within one
   *  mount, re-floating a preview the reader never re-opened. The token
   *  is a fresh object identity per contiguous visit, so a stale entry
   *  can never revive; staleness stays derived — no effect, no setState
   *  cascade. */
  forVisit: object;
}

export function SubagentDelegationSurface({
  dispatches,
  threadId,
  renderPreview,
  children,
}: {
  dispatches: ReadonlyMap<number, ThreadDispatch>;
  threadId: string | undefined;
  /** Deterministic preview seam for the package fixture (the count
   *  pill's own renderPreview precedent) — production leaves it unset
   *  and gets the live ChildTranscriptPreview. */
  renderPreview?: (childSessionId: string, variantIndex?: number) => ReactNode;
  children: ReactNode;
}) {
  const { previewId, activeDrillIn, anchorRef, previewRef, drillIn } =
    useSubagentDrillInController(threadId);
  const { currentWork, publishCurrentWork } = useCurrentWorkPublisher();

  const label =
    activeDrillIn !== null
      ? _drillInLabelOf(dispatches, activeDrillIn.childSessionId)
      : null;

  return (
    <SubagentDrillInContext.Provider value={drillIn}>
      <SubagentCurrentWorkPublisherContext.Provider value={publishCurrentWork}>
        <SubagentCurrentWorkContext.Provider value={currentWork}>
          {children}
          {activeDrillIn !== null && threadId !== undefined ? (
            <SubagentPreviewPopover
              key={activeDrillIn.childSessionId}
              id={previewId}
              anchorRef={anchorRef}
              previewRef={previewRef}
              label={label ?? "Delegated task"}
            >
              {renderPreview !== undefined ? (
                renderPreview(
                  activeDrillIn.childSessionId,
                  coworkerIndicesOf(dispatches.values()).get(
                    activeDrillIn.childSessionId,
                  ),
                )
              ) : (
                <ChildTranscriptPreview
                  threadId={threadId}
                  childSessionId={activeDrillIn.childSessionId}
                  variantIndex={coworkerIndicesOf(dispatches.values()).get(
                    activeDrillIn.childSessionId,
                  )}
                />
              )}
            </SubagentPreviewPopover>
          ) : null}
        </SubagentCurrentWorkContext.Provider>
      </SubagentCurrentWorkPublisherContext.Provider>
    </SubagentDrillInContext.Provider>
  );
}

interface SubagentDrillInController {
  previewId: string;
  /** The drill-in that is open for THIS thread visit, or null. */
  activeDrillIn: OpenDrillIn | null;
  anchorRef: RefObject<HTMLElement | null>;
  previewRef: RefObject<HTMLDivElement | null>;
  drillIn: SubagentDrillIn | null;
}

/** The drill-in lifecycle: open, the per-visit staleness stamp, close
 *  with focus restoration, sibling dismiss, and the open preview's Esc
 *  and light-dismiss listeners. */
function useSubagentDrillInController(
  threadId: string | undefined,
): SubagentDrillInController {
  const previewId = useId();
  const [openDrillIn, setOpenDrillIn] = useState<OpenDrillIn | null>(null);

  // The visit token (failure-mode ledger, mode 8): one fresh object
  // identity per CONTIGUOUS thread visit — it changes on A→B and again
  // on B→A, so a stale drill-in can never revive when a thread id
  // recurs (a thread-id stamp matched again on the way back).
  // Residual, accepted: React may in principle discard a useMemo
  // cache, which would mint a new token mid-visit and close an OPEN
  // drill-in — the fail-safe direction, never a revival. The threadId
  // inside is a debug fact; the token is the identity.
  const visitToken = useMemo<object>(() => ({ threadId }), [threadId]);

  // Thread switch (failure-mode ledger, mode 8): a drill-in opened over
  // one thread must not stay afloat over the next — the held
  // childSessionId belongs to the OLD thread's ledger, and rendering it
  // against the new threadId would dial a cross-thread stream URL.
  // Staleness is DERIVED (the visit-token stamp), never an effect's
  // setState, so there is no cascading render and no focus restore on
  // this arm — the opener row left with its conversation. The stale
  // state itself is overwritten by the next open. In the SHIPPED host
  // this arm is second-line defense: conversation-view keys Transcript
  // by thread.id#reconnectNonce, so the surface remounts per thread and
  // per reconnect — the stamp is what keeps an unkeyed host honest.
  const activeDrillIn =
    openDrillIn !== null && openDrillIn.forVisit === visitToken
      ? openDrillIn
      : null;

  // The popover anchors to the opener element itself (the row's button):
  // a ref-shaped memo over the open state, the shape the shared popover
  // shell reads — never a ref written during render.
  const anchorRef = useMemo<RefObject<HTMLElement | null>>(
    () => ({ current: activeDrillIn?.opener ?? null }),
    [activeDrillIn],
  );
  const previewRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    // Focus returns to the opener exactly when it survived the visit
    // AND is still visible (focusIfRestorable: isConnected alone does
    // not test visibility, and a collapsed group's hidden row would
    // swallow the focus silently). OUTSIDE the setState updater on
    // purpose: updaters must stay pure (StrictMode double-invokes them,
    // and React may re-run an interrupted queue), so the focus move
    // rides the callback itself. Re-entrancy premise: two close() calls
    // in one tick both read this render's activeDrillIn — focus() on
    // the same element is idempotent and the second
    // setOpenDrillIn(null) bails on Object.is.
    focusIfRestorable(activeDrillIn?.opener ?? null);
    setOpenDrillIn(null);
  }, [activeDrillIn]);

  // The sibling-surface dismiss (failure-mode ledger mode 14). A
  // no-restore rule would weigh only the pointer reader: the open
  // effect focuses the popover for EVERY drill-in, so a bare unmount
  // strands focus on <body> — the exact failure the pill's own
  // pointer-leave guard exists to prevent. The opener is restored
  // exactly when the popover CONTAINS focus at dismiss time; focus
  // already elsewhere (a keyboard reader mid-route to the superseding
  // surface — the pill's own focus-open arm) means someone moved it
  // deliberately, and it stays where they put it.
  const dismiss = useCallback(() => {
    const preview = previewRef.current;
    const root = preview?.getRootNode();
    const active =
      root instanceof Document || root instanceof ShadowRoot
        ? root.activeElement
        : null;
    if (preview !== null && active !== null && preview.contains(active)) {
      focusIfRestorable(activeDrillIn?.opener ?? null);
    }
    setOpenDrillIn(null);
  }, [activeDrillIn]);

  // The drill-in seam's value. Without a thread id there is no child
  // stream door to open, so the rows stay honestly non-interactive (the
  // null default). The value changes on open/close BY DESIGN:
  // rows read openChildSessionId for their aria-expanded, so
  // the affected rows must re-render — the row count is the fan-out's,
  // small by construction.
  const drillIn = useMemo<SubagentDrillIn | null>(
    () =>
      threadId === undefined
        ? null
        : {
            open: (childSessionId, opener) => {
              setOpenDrillIn({ childSessionId, opener, forVisit: visitToken });
            },
            dismiss,
            openChildSessionId: activeDrillIn?.childSessionId ?? null,
            previewId,
          },
    [threadId, visitToken, dismiss, activeDrillIn, previewId],
  );

  // An explicitly activated dialog takes focus (unlike the roster's
  // hover preview, whose reader is mid-hover): Escape then works from
  // inside, and close() hands focus back to the opener. Esc rides the
  // PREVIEW ELEMENT natively and stops propagation — the roster card's
  // idiom, and load-bearing: a document-level listener never
  // runs inside the companion drawer, whose own Esc-to-close is a React
  // onKeyDown dispatched from the ROOT CONTAINER — an ancestor of this
  // popover but a descendant of document — so the drawer would minimize
  // with the preview still open. Attached deeper than the root
  // container, this handler runs first and one keystroke performs one
  // action. Light dismissal is judged by composedPath(), never
  // contains(), for the script-tag shadow-root distribution.
  useEffect(() => {
    if (activeDrillIn === null) {
      return;
    }
    const preview = previewRef.current;
    if (preview === null) {
      return;
    }
    preview.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    const closeUnlessInside = (event: Event) => {
      const path = event.composedPath();
      if (path.includes(preview)) {
        return;
      }
      const opener = activeDrillIn.opener;
      if (opener !== null && path.includes(opener)) {
        return;
      }
      close();
    };
    const doc = preview.ownerDocument;
    preview.addEventListener("keydown", closeOnEscape);
    doc.addEventListener("pointerdown", closeUnlessInside);
    return () => {
      preview.removeEventListener("keydown", closeOnEscape);
      doc.removeEventListener("pointerdown", closeUnlessInside);
    };
  }, [close, activeDrillIn]);

  return { previewId, activeDrillIn, anchorRef, previewRef, drillIn };
}

/** The current-work map this surface owns: the open preview's stream
 *  publishes its newest live call, the group rows read it. */
function useCurrentWorkPublisher(): {
  currentWork: ReadonlyMap<string, ToolCallViewModel>;
  publishCurrentWork: SubagentCurrentWorkPublisher;
} {
  const [currentWork, setCurrentWork] = useState<
    ReadonlyMap<string, ToolCallViewModel>
  >(() => new Map());

  const publishCurrentWork = useCallback<SubagentCurrentWorkPublisher>(
    (childSessionId, view) => {
      setCurrentWork((previous) => {
        const held = previous.get(childSessionId);
        if (view === null) {
          if (held === undefined) {
            return previous;
          }
          const next = new Map(previous);
          next.delete(childSessionId);
          return next;
        }
        // Equal-evidence bail-out, by VALUE, never reference: the child
        // transcript derives a FRESH view object from every streamed
        // delta (newestToolCallViewOf), so a reference check never
        // fires. This one fires on every delta that leaves the newest
        // live call's label evidence unchanged — prose/reasoning deltas,
        // the same call's argument streaming — returning `previous` so
        // React bails and no group row re-renders. It stops firing (and
        // publishes) when a different call becomes newest, the display
        // annotation's caption or progressText lands or changes, or the
        // child settles (the null arm above).
        if (held !== undefined && sameCurrentWorkView(held, view)) {
          return previous;
        }
        const next = new Map(previous);
        next.set(childSessionId, view);
        return next;
      });
    },
    [],
  );

  return { currentWork, publishCurrentWork };
}

function _drillInLabelOf(
  dispatches: ReadonlyMap<number, ThreadDispatch>,
  childSessionId: string,
): string {
  return (
    [...dispatches.values()].find(
      (dispatch) =>
        dispatch.child_session_id === childSessionId && dispatch.label !== "",
    )?.label ?? "Delegated task"
  );
}
