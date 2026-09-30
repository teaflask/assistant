"use client";

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type RefObject,
} from "react";

import { ApprovalCard } from "./approval-card.js";
import { ApprovalsContext } from "./approval-context.js";
import { ElicitationsContext } from "./elicitation-context.js";
import { TfButton } from "./primitives/button.js";
import { QuestionPanel } from "./question-panel.js";
import { SurfaceBoundary } from "./surface-boundary.js";
import {
  clampedCursorOf,
  decisionKeyOf,
  suspensionQueueOf,
  type PendingDecision,
} from "../core/suspension-queue.js";

// The suspension slot's tenant: the ONE actionable surface for the
// conversation's pending decisions, between the transcript and the
// composer. The landlord contract (docs/activity-shelf-slot-contract.md)
// binds the structure: the root carries data-tf-shelf-item, renders null
// with nothing to decide (the :empty collapse — expression-only children),
// stays in normal flow, and wears hairline borders only. The ONE sanctioned
// tenant scroll region is the decision scroll well: a viewport-relative
// bound around the current card alone (TVC-067, the Scroll-Well Rule) — the
// queue bar stays outside it, the fold cue shows only while more is below,
// and its listeners watch only its own region. One decision renders at a
// time; a package-owned queue bar ("Decision 2 of 3") keeps every one
// reachable in core/suspension-queue.ts's order, and paging never answers
// anything. Focus moves only at member-initiated moments — the FOCUS
// PREMISE is in docs/transcript-surfaces.md.
export function SuspensionSurfaces({
  rowIndexByToolCallId,
}: {
  /** Transcript order for the deterministic queue: the anchoring call's
   *  display-row index by tool call id. */
  rowIndexByToolCallId: ReadonlyMap<string, number>;
}) {
  const { cards } = useContext(ApprovalsContext);
  const { cards: elicitationCards } = useContext(ElicitationsContext);
  const queue = useMemo(
    () => suspensionQueueOf(cards, elicitationCards, rowIndexByToolCallId),
    [cards, elicitationCards, rowIndexByToolCallId],
  );
  const queueKeys = useMemo(() => queue.map(decisionKeyOf), [queue]);
  const {
    position,
    current,
    currentKey,
    currentWrapRef,
    previousButtonRef,
    nextButtonRef,
    pagePrevious,
    pageNext,
  } = useDecisionQueueHold(queue, queueKeys);
  const { scrollWellRef, foldBelow, declareFold } =
    useScrollWellFold(currentKey);
  const { captureConversationScope, noteFocusWithin, noteBlur } =
    useDecisionFocusReturn(queueKeys, currentKey, currentWrapRef);

  if (current === null) {
    return null;
  }

  return (
    <section
      ref={captureConversationScope}
      data-tf-shelf-item=""
      data-tf-suspension-surfaces=""
      aria-label="Pending decisions"
      className="tf:w-full"
      onFocus={noteFocusWithin}
      onBlur={noteBlur}
    >
      {queue.length > 1 ? (
        <div
          data-tf-suspension-pager=""
          className="tf:flex tf:items-center tf:justify-between tf:gap-2 tf:pb-1 tf:text-tf-label tf:text-tf-muted-foreground"
        >
          {/* The position is text, never colour or a dot count — the
              current decision is the one on screen, and the words say
              where it sits in the queue. */}
          <span>{`Decision ${String(position + 1)} of ${String(queue.length)}`}</span>
          <span className="tf:flex tf:gap-1">
            {/* End-press focus rule: see pendingPagerFocusRef in
                useDecisionQueueHold. The sibling is enabled after the
                re-render whenever the pager renders at all
                (queue.length > 1). */}
            <TfButton
              ref={previousButtonRef}
              variant="ghost"
              disabled={position === 0}
              onClick={pagePrevious}
            >
              Previous
            </TfButton>
            <TfButton
              ref={nextButtonRef}
              variant="ghost"
              disabled={position === queue.length - 1}
              onClick={pageNext}
            >
              Next
            </TfButton>
          </span>
        </div>
      ) : null}
      <div
        ref={scrollWellRef}
        data-tf-decision-scroll-well=""
        // The height bound and the fold cue both live in styles.css: the
        // bound is a custom property so a height-capped host (the
        // palette's 36rem panel, the companion's 52rem card) can size
        // the well below its own cap instead of letting a
        // viewport-relative value clip the composer — and the cue is a
        // MASK fading the card's own tail, keyed on data-tf-fold-below,
        // because a painted band would re-opaque the glass hosts'
        // material (the strip styles.css zeroes on
        // [data-tf-composer-ground] under [data-tf-glass]).
        data-tf-fold-below={foldBelow ? "" : undefined}
        className="tf:overflow-y-auto tf:overscroll-contain"
        onScroll={declareFold}
      >
        <div
          // Keyed by decision identity: paging remounts the surface so
          // one decision's component-local state (an approval's deny
          // reason) can never bleed into another's. The question panel
          // keeps NO local draft — its answers live in the store's
          // draft store keyed by interrupt id, so this remount
          // isolates without destroying.
          key={currentKey}
          ref={currentWrapRef}
          data-tf-current-decision=""
          tabIndex={-1}
          className="tf:outline-none"
        >
          {/* Per-decision boundary: with decisionSurfacesInShelf the
              message list skips its per-card boundaries, so without this
              one a single poisoned card would latch the shelf's outer
              boundary for the Transcript's whole life and block every
              LATER decision too. Inside the keyed wrapper on purpose:
              the identity key above remounts this subtree — boundary
              included — whenever the presented decision changes (paging,
              resolution, a new arrival), so a latched card clears the
              moment the next decision takes the slot. */}
          <SurfaceBoundary surface="decision-card">
            {current.kind === "approval" ? (
              <ApprovalCard card={current.card} />
            ) : (
              <QuestionPanel card={current.card} />
            )}
          </SurfaceBoundary>
        </div>
      </div>
    </section>
  );
}

interface DecisionQueueHold {
  position: number;
  current: PendingDecision | null;
  currentKey: string | null;
  /** The presented decision's wrapper — the focus target when the held
   *  decision resolves under the member's focus. */
  currentWrapRef: RefObject<HTMLDivElement | null>;
  previousButtonRef: RefObject<HTMLButtonElement | null>;
  nextButtonRef: RefObject<HTMLButtonElement | null>;
  pagePrevious: () => void;
  pageNext: () => void;
}

// THE PRESENTED-DECISION HOLD: the current decision is held by IDENTITY
// (a queue key in state); the numeric index is only the fallback for the
// moment that identity leaves the queue. A new arrival can reorder the
// queue or land on a stale index, and the held KEY still names the same
// decision, so the presented card never swaps or remounts under a
// mid-review member. It changes only when the member pages or the held
// decision resolves — then the NEXT decision at the same position is promoted.
function useDecisionQueueHold(
  queue: readonly PendingDecision[],
  queueKeys: readonly string[],
): DecisionQueueHold {
  const [hold, setHold] = useState<{
    key: string | null;
    /** Where the held decision last sat — the promotion point when the
     *  held decision itself leaves the queue. */
    position: number;
  }>({ key: null, position: 0 });
  const heldIndex = hold.key === null ? -1 : queueKeys.indexOf(hold.key);
  const position =
    heldIndex >= 0 ? heldIndex : clampedCursorOf(hold.position, queue.length);
  const current: PendingDecision | null =
    queue.length === 0 ? null : queue[position];
  const currentKey = current === null ? null : decisionKeyOf(current);
  // Adopt the presented decision as the hold — the guarded
  // adjust-state-during-render idiom (React discards this render's
  // output and restarts with the settled value), so a reorder has
  // re-pointed nothing by the time anything paints and no effect ever
  // races the adoption.
  if (currentKey !== hold.key || position !== hold.position) {
    setHold({ key: currentKey, position });
  }

  const currentWrapRef = useRef<HTMLDivElement | null>(null);
  const previousButtonRef = useRef<HTMLButtonElement | null>(null);
  const nextButtonRef = useRef<HTMLButtonElement | null>(null);
  // A pager press that LANDS on an end disables the pressed button while
  // it holds focus, and a browser blurs a disabled element to nowhere —
  // dropping the member to the top of the document and (via the
  // section's onBlur with a null relatedTarget) disarming the resolve
  // hand-off. The landing press therefore requests focus for the
  // sibling, honored AFTER the re-render — at click time the sibling
  // may itself still be disabled (the two-decision case).
  const pendingPagerFocusRef = useRef<"previous" | "next" | null>(null);
  useEffect(() => {
    if (pendingPagerFocusRef.current === "previous") {
      previousButtonRef.current?.focus();
    } else if (pendingPagerFocusRef.current === "next") {
      nextButtonRef.current?.focus();
    }
    pendingPagerFocusRef.current = null;
  });
  return {
    position,
    current,
    currentKey,
    currentWrapRef,
    previousButtonRef,
    nextButtonRef,
    pagePrevious: () => {
      const target = clampedCursorOf(position - 1, queue.length);
      setHold({ key: queueKeys[target] ?? null, position: target });
      if (target === 0) {
        pendingPagerFocusRef.current = "next";
      }
    },
    pageNext: () => {
      const target = clampedCursorOf(position + 1, queue.length);
      setHold({ key: queueKeys[target] ?? null, position: target });
      if (target === queue.length - 1) {
        pendingPagerFocusRef.current = "previous";
      }
    },
  };
}

/** The declared fold (the Scroll-Well Rule): true while more of the
 *  current decision sits below the well's visible bottom. */
function useScrollWellFold(currentKey: string | null): {
  scrollWellRef: RefObject<HTMLDivElement | null>;
  foldBelow: boolean;
  declareFold: () => void;
} {
  const scrollWellRef = useRef<HTMLDivElement | null>(null);
  const [foldBelow, setFoldBelow] = useState(false);
  const declareFold = useCallback(() => {
    const well = scrollWellRef.current;
    if (well === null) {
      return;
    }
    setFoldBelow(well.scrollHeight - well.scrollTop - well.clientHeight > 1);
  }, []);
  useEffect(() => {
    const well = scrollWellRef.current;
    if (well === null) {
      return;
    }
    // A newly presented decision starts at its top — the consent reading
    // begins at the title, never mid-payload where the last one left off.
    well.scrollTop = 0;
    declareFold();
    // The well's content changes height without scrolling (for example,
    // a deny textarea appearing) — watch the
    // content itself so the cue stays honest. Own-region observation
    // only; the transcript's follow machinery is never touched.
    const content = well.firstElementChild;
    if (
      !(content instanceof HTMLElement) ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }
    const observer = new ResizeObserver(() => {
      declareFold();
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
    };
  }, [currentKey, declareFold]);
  return { scrollWellRef, foldBelow, declareFold };
}

/** Where focus goes when the decision under it resolves: the next
 *  presented decision's wrapper, or — the queue emptied — THIS
 *  conversation's composer input. */
function useDecisionFocusReturn(
  queueKeys: readonly string[],
  currentKey: string | null,
  currentWrapRef: RefObject<HTMLDivElement | null>,
): {
  captureConversationScope: (node: HTMLElement | null) => void;
  noteFocusWithin: () => void;
  noteBlur: (event: FocusEvent<HTMLElement>) => void;
} {
  // Whether focus currently lives inside the tenant — tracked by the
  // focus events themselves, because by the time an unmount effect runs
  // the browser has already dropped focus to <body> silently.
  const focusWithinRef = useRef(false);
  // THIS conversation's column, captured while the tenant is mounted so the
  // queue-empties hand-off can still find the composer after this component
  // returns null. Scoped to the closest [data-tf-conversation]: surfaces
  // mount Transcript CONCURRENTLY (the page under an open palette), and a
  // document-scoped query would resolve the FIRST composer — inert behind
  // the modal. The root node is only the fallback for bare hosts.
  const conversationScopeRef = useRef<ParentNode | null>(null);
  const previousKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const previousKey = previousKeyRef.current;
    previousKeyRef.current = currentKey;
    if (previousKey === null) {
      return;
    }
    const currentDecisionLeft = !queueKeys.includes(previousKey);
    if (!currentDecisionLeft || !focusWithinRef.current) {
      return;
    }
    if (currentKey !== null) {
      currentWrapRef.current?.focus();
      return;
    }
    // The queue emptied under the member's focus: hand it back to THIS
    // conversation's composer input (the scope captured above — same
    // column, shadow-root safe, never another surface's composer).
    focusWithinRef.current = false;
    const composerInput =
      conversationScopeRef.current?.querySelector<HTMLTextAreaElement>(
        "[data-tf-composer-wash] textarea",
      );
    composerInput?.focus();
  }, [queueKeys, currentKey, currentWrapRef]);

  return {
    captureConversationScope: (node) => {
      if (node !== null) {
        conversationScopeRef.current =
          node.closest("[data-tf-conversation]") ??
          (node.getRootNode() as Document | ShadowRoot);
      }
    },
    noteFocusWithin: () => {
      focusWithinRef.current = true;
    },
    noteBlur: (event) => {
      // Disarm ONLY when focus verifiably moved outside the tenant. A null
      // relatedTarget is a blur to NOWHERE — the browser's disable-blur fixup
      // on our own controls (the double-click guard) or a window blur — where
      // the hand-off must stay armed. Accepted residual: a click on a
      // non-focusable page area also blurs to nowhere, so a later resolve
      // re-anchors focus onto the decision region. Seam enumeration: the
      // decision-surface coverage record.
      if (
        event.relatedTarget !== null &&
        !event.currentTarget.contains(event.relatedTarget)
      ) {
        focusWithinRef.current = false;
      }
    },
  };
}
