"use client";

import type { ServingAssistantThread } from "../contract/threads.js";
import { RECENT_WINDOW_DAYS, startOfLocalDayMs } from "../core/time-labels.js";
import { ComposeIcon } from "./icons.js";
import { TfButton } from "./primitives/button.js";
import { cx } from "./primitives/cx.js";

export interface ThreadGroup {
  label: string;
  threads: ServingAssistantThread[];
}

/**
 * History bucketed the way people remember it — by calendar day, not by
 * elapsed hours: a conversation from 11pm last night is "Yesterday" at
 * 8am even though it is nine hours old. Grouping is also why the rows
 * carry no timestamp of their own; the heading already said it, and a
 * right-aligned time would eat the title in a 280px rail.
 */
export function groupThreadsByRecency(
  threads: readonly ServingAssistantThread[],
  now: Date,
): ThreadGroup[] {
  // Each boundary is a local midnight of its own, counted back in
  // CALENDAR days (startOfLocalDayMs — hoisted to core/time-labels so
  // the user-bubble timestamps read this exact recency rule).
  const startOfDay = (daysBack: number) => startOfLocalDayMs(now, daysBack);
  const startOfToday = startOfDay(0);
  const startOfYesterday = startOfDay(1);
  const startOfRecentWindow = startOfDay(RECENT_WINDOW_DAYS);
  const buckets = new Map<string, ServingAssistantThread[]>();
  // Groups come out in the order their first thread arrives, so the sort
  // decides the headings' order too. An unparseable stamp is therefore ranked
  // rather than left to arithmetic: it sorts to the very top, which is where
  // its "Today" bucket belongs.
  //
  // Compared, not subtracted, so the comparator is total. Ranking alone did
  // not achieve that, whatever the older wording here claimed: two
  // unparseable stamps both rank Infinity, and `Infinity - Infinity` is NaN.
  // That particular NaN is in fact harmless — SortCompare coerces it to +0,
  // and "equal" is the honest answer for two threads that are equally
  // unrankable — but a comparator whose totality rests on a spec footnote is
  // one refactor away from mattering.
  const ordered = [...threads].sort((a, b) => {
    const left = _rankOf(b);
    const right = _rankOf(a);
    if (left === right) {
      return 0;
    }
    return left > right ? 1 : -1;
  });

  for (const thread of ordered) {
    const at = Date.parse(thread.updated_at);
    // An unparseable or future stamp is described honestly rather than
    // being filed under a day it did not happen.
    const label =
      Number.isNaN(at) || at >= startOfToday
        ? "Today"
        : at >= startOfYesterday
          ? "Yesterday"
          : at >= startOfRecentWindow
            ? "Previous 7 days"
            : "Older";
    const bucket = buckets.get(label);
    if (bucket === undefined) {
      buckets.set(label, [thread]);
    } else {
      bucket.push(thread);
    }
  }
  return [...buckets].map(([label, bucketed]) => ({
    label,
    threads: bucketed,
  }));
}

/** A thread's place on the timeline, as a number the comparator can always
 * subtract. A stamp that will not parse ranks above every real one. */
function _rankOf(thread: ServingAssistantThread): number {
  const at = Date.parse(thread.updated_at);
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at;
}

interface ThreadHistoryProps {
  threads: ServingAssistantThread[];
  activeThreadId: string | null;
  onSelectThread: (thread: ServingAssistantThread) => void;
  onNewConversation: () => void;
  /**
   * Grows the rows to the 44px touch floor and the 15px step. The rail is
   * leaned over with a mouse; the drawer is held at arm's length.
   */
  touch?: boolean;
  /**
   * Whether the scroller owes the phone's home indicator its clearance.
   * True for surfaces that run to the viewport's bottom edge (the page's
   * history sheet); false for ones that end mid-panel (the companion
   * drawer's history menu), where the env() inset would be dead padding.
   */
  safeAreaBottom?: boolean;
}

/**
 * The history body: the one command, then the conversations under their
 * recency headings. Shared verbatim between the rail and the drawer —
 * they are the same list at two densities, and the day a phone's history
 * diverges from a desk's is the day one of them is wrong.
 */
export function ThreadHistory({
  threads,
  activeThreadId,
  onSelectThread,
  onNewConversation,
  touch = false,
  safeAreaBottom = true,
}: ThreadHistoryProps) {
  const groups = groupThreadsByRecency(threads, new Date());
  return (
    <div className="tf:flex tf:min-h-0 tf:flex-1 tf:flex-col">
      {/* Outside the scroller on purpose: an action that scrolls away
          with the list it commands is an action you have to go find. */}
      <div className="tf:shrink-0 tf:px-2 tf:pb-1">
        <TfButton
          variant={touch ? "rowActionTouch" : "rowAction"}
          onClick={onNewConversation}
        >
          <ComposeIcon />
          New conversation
        </TfButton>
      </div>
      {/* The page's history sheet runs to the bottom edge of the phone,
          so its list owes the home indicator its clearance. As a utility
          rather than a stylesheet rule: the package's hand-written rules
          and its utilities share one sheet, and which of two
          equal-specificity declarations wins is not a thing to leave to
          source order. env() is 0 everywhere else, so this is just pb-2
          on a desk. */}
      <div
        className={cx(
          "tf:flex tf:min-h-0 tf:flex-1 tf:flex-col tf:overflow-y-auto tf:px-2",
          safeAreaBottom
            ? "tf:pb-[calc(0.5rem_+_env(safe-area-inset-bottom))]"
            : "tf:pb-2",
        )}
      >
        {groups.length === 0 ? (
          <NoConversationsYet />
        ) : (
          groups.map((group) => (
            <section key={group.label} className="tf:pt-3">
              {/* Not an eyebrow: these stack down the column and each one
                  is the answer to "when was that". */}
              <h3 className="tf:px-2.5 tf:pb-1 tf:text-tf-label tf:font-normal tf:text-tf-muted-foreground">
                {group.label}
              </h3>
              <ul className="tf:flex tf:flex-col tf:gap-px">
                {group.threads.map((thread) => (
                  <li key={thread.id}>
                    <TfButton
                      variant={touch ? "rowTouch" : "row"}
                      aria-current={
                        thread.id === activeThreadId ? "true" : undefined
                      }
                      onClick={() => {
                        onSelectThread(thread);
                      }}
                    >
                      <span className="tf:truncate">{thread.title}</span>
                    </TfButton>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

// The house empty-state silhouette at rail scale: centred, a line that
// names the state and a line that says what fills it. No action — the
// only one there is sits 40px above this.
function NoConversationsYet() {
  return (
    <div className="tf:my-auto tf:flex tf:flex-col tf:items-center tf:gap-1 tf:px-4 tf:py-6 tf:text-center">
      <p className="tf:text-tf-label tf:font-medium">No conversations yet</p>
      <p className="tf:text-tf-label tf:text-tf-muted-foreground">
        Your chats show up here.
      </p>
    </div>
  );
}
