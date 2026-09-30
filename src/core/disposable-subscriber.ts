import type { AgentSubscriber } from "@ag-ui/client";

/** A subscriber with an off switch: `dispose()` mutes every handler for
 *  good, so a run that snapshotted the subscriber list before the
 *  unsubscribe can say nothing more through it. */
export interface DisposableAgentSubscriber {
  subscriber: AgentSubscriber;
  dispose: () => void;
}

/**
 * Wrap a subscriber so it can be silenced. `AbstractAgent.connectAgent`
 * snapshots the subscriber list per run, so an effect cleanup's
 * `unsubscribe()` cannot reach the run already in flight — its teardown
 * would still call the old subscriber's `onRunFinalized`, and on a live
 * pause that reads as a quiet close. Every handler on the returned
 * subscriber checks the flag first; after `dispose()` the old run
 * reaches nothing.
 *
 * A Proxy, so the wrapper keeps the inner subscriber's exact member set
 * and every handler's own signature: a handler that is absent stays
 * absent (the agent's optional calls skip it), a present one forwards
 * its parameters and its return until disposed, then returns undefined.
 */
export function disposableSubscriber(
  inner: AgentSubscriber,
): DisposableAgentSubscriber {
  let disposed = false;
  const subscriber = new Proxy(inner, {
    get(target, property, receiver): unknown {
      const member: unknown = Reflect.get(target, property, receiver);
      if (typeof member !== "function") {
        return member;
      }
      return (...args: unknown[]): unknown =>
        disposed ? undefined : Reflect.apply(member, target, args);
    },
  });
  return {
    subscriber,
    dispose: () => {
      disposed = true;
    },
  };
}
