"use client";

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from "react";

/**
 * The member's outrank, permanent for the fold: one explicit toggle of
 * the fold's OWN summary pins the disclosure to native <details> for the
 * component's lifetime — a later view-bearing call, a fresh decision, a
 * first failure, and the decay release all stop writing the open
 * attribute. The pin is session state, not derived state: it records the
 * member's gesture, which no replay re-derives (Law 9 governs the DEFAULT
 * state).
 *
 * The gesture is recognized in TWO stages: the capture click on the
 * group wrapper writes a REF only — keyboard activation dispatches the
 * same click, and only the fold's own summary matches (a member row's
 * summary has its own parent <details>) — and the state flips from the
 * fold <details>' own toggle event. Committing state in the capture
 * handler races the summary's activation behaviour: React 19 flushes a
 * discrete update at the microtask checkpoint the browser reaches DURING
 * propagation, so on a held-open fold the commit would remove the open
 * attribute before the activation behaviour ran — which then toggles the
 * now-absent attribute back ON, swallowing the member's collapse.
 *
 * The premise this ordering rests on: the DOM queues the toggle event
 * AFTER the activation behaviour has applied the attribute change
 * (HTML's details toggle steps), so by the time the pin commits, the
 * <details> already holds the member's chosen state — and the pin's own
 * re-render releases the prop to undefined, whose only DOM effect is
 * removing an attribute the collapse case has already removed (a no-op
 * writes no mutation and queues no second toggle). In the window between
 * the activation and the toggle task, an unrelated re-render still holds
 * the prop's OLD value — and React re-writes the open attribute only on
 * a prop VALUE change (see primitives/disclosure.tsx), so it cannot fight
 * the member there either. preventDefault is no fix: it would keep a
 * held fold collapsible and make a decayed fold un-expandable.
 *
 * The census of every activation handler in the class this guards is
 * the activation-commit class census record.
 *
 * `groupRef` goes on the group wrapper, `onGroupActivation` on its
 * capture click; the fold's <details> must be the wrapper's direct child.
 */
export function useMemberToggleOutrank(): {
  groupRef: RefObject<HTMLDivElement | null>;
  memberToggled: boolean;
  onGroupActivation: (event: MouseEvent<HTMLDivElement>) => void;
} {
  const groupRef = useRef<HTMLDivElement | null>(null);
  const [memberToggled, setMemberToggled] = useState(false);
  const memberToggleIntentRef = useRef(false);
  const onGroupActivation = (event: MouseEvent<HTMLDivElement>) => {
    const summary =
      event.target instanceof Element ? event.target.closest("summary") : null;
    if (
      summary !== null &&
      summary.parentElement ===
        groupRef.current?.querySelector(":scope > details")
    ) {
      memberToggleIntentRef.current = true;
    }
  };
  useEffect(() => {
    const details =
      groupRef.current?.querySelector<HTMLDetailsElement>(":scope > details");
    if (details === null || details === undefined) {
      return;
    }
    // toggle does not bubble, so the listener rides the <details>
    // itself (the element is stable for this component's lifetime).
    // Programmatic toggles — decay's release, an arrival's re-open —
    // find the ref unarmed and commit nothing; the member's activation
    // is the only path that arms it, and its own toggle consumes it.
    const commitMemberToggle = () => {
      if (memberToggleIntentRef.current) {
        memberToggleIntentRef.current = false;
        setMemberToggled(true);
      }
    };
    details.addEventListener("toggle", commitMemberToggle);
    return () => {
      details.removeEventListener("toggle", commitMemberToggle);
    };
  }, []);
  return { groupRef, memberToggled, onGroupActivation };
}
