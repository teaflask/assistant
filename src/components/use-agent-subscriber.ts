"use client";

import { useEffect } from "react";

import type { AbstractAgent, AgentSubscriber } from "@ag-ui/client";

import type { DisposableAgentSubscriber } from "../core/disposable-subscriber.js";

/**
 * Subscribe to an agent for the lifetime of a component, or of a
 * dependency set. `subscriberOf` is called at subscribe time and again
 * on every re-subscribe, so a subscriber that carries per-subscription
 * state in closure variables starts fresh each time (StrictMode's
 * simulated remount included). It may return a plain subscriber or a
 * disposable one (`disposableSubscriber`); a disposable is disposed
 * BEFORE the unsubscribe, so a run that snapshotted the subscriber list
 * hears nothing more from it.
 *
 * The caller memoizes `subscriberOf` (`useCallback`) with the facts the
 * subscriber closes over — those are the re-subscribe triggers, exactly
 * as the deps of the effect this hook replaces were. An unmemoized thunk
 * would re-subscribe every render, after `connectAgent` has run, and
 * miss the replay's first events.
 */
export function useAgentSubscriber(
  agent: Pick<AbstractAgent, "subscribe">,
  subscriberOf: () => AgentSubscriber | DisposableAgentSubscriber,
): void {
  useEffect(() => {
    const made = subscriberOf();
    const { subscriber, dispose } =
      "subscriber" in made ? made : { subscriber: made, dispose: undefined };
    const subscription = agent.subscribe(subscriber);
    return () => {
      dispose?.();
      subscription.unsubscribe();
    };
  }, [agent, subscriberOf]);
}
