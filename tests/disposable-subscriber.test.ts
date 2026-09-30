/** The disposable subscriber: every handler forwards until dispose(), and
 *  nothing reaches the inner subscriber after — the guard a recorder
 *  needs when connectAgent has snapshotted it into a run that outlives
 *  the effect that subscribed it. */
import { describe, expect, it, vi } from "vitest";

import type { AgentSubscriberParams } from "@ag-ui/client";

import { disposableSubscriber } from "../src/core/disposable-subscriber";

describe("disposableSubscriber", () => {
  it("forwards a handler's parameters and return value before dispose", () => {
    const onRunFinalized = vi.fn(() => ({ state: { seen: true } }));
    const { subscriber } = disposableSubscriber({ onRunFinalized });
    const params = {
      messages: [],
      state: {},
    } as unknown as AgentSubscriberParams;
    expect(subscriber.onRunFinalized?.(params)).toEqual({
      state: { seen: true },
    });
    expect(onRunFinalized).toHaveBeenCalledWith(params);
  });

  it("mutes every handler after dispose() — the inner subscriber hears nothing", () => {
    // The mocks RETURN something, so a wrapper that kept forwarding after
    // dispose would surface it here — undefined is the muted answer only.
    const onRunFinalized = vi.fn(() => ({ state: { leaked: true } }));
    const onRunFailed = vi.fn(() => ({ state: { leaked: true } }));
    const { subscriber, dispose } = disposableSubscriber({
      onRunFinalized,
      onRunFailed,
    });
    dispose();
    const params = {} as AgentSubscriberParams;
    expect(subscriber.onRunFinalized?.(params)).toBeUndefined();
    expect(
      subscriber.onRunFailed?.({ ...params, error: new Error("x") }),
    ).toBeUndefined();
    expect(onRunFinalized).not.toHaveBeenCalled();
    expect(onRunFailed).not.toHaveBeenCalled();
  });

  it("keeps the inner member set: an absent handler stays absent, so optional calls skip it", () => {
    const { subscriber } = disposableSubscriber({ onRunFinalized: vi.fn() });
    expect("onRunFailed" in subscriber).toBe(false);
    expect(Object.hasOwn(subscriber, "onRunFailed")).toBe(false);
    expect(Object.keys(subscriber)).toEqual(["onRunFinalized"]);
  });

  it("dispose is idempotent", () => {
    const onRunFinalized = vi.fn();
    const wrapped = disposableSubscriber({ onRunFinalized });
    const params = {} as AgentSubscriberParams;
    void wrapped.subscriber.onRunFinalized?.(params);
    wrapped.dispose();
    wrapped.dispose();
    void wrapped.subscriber.onRunFinalized?.(params);
    expect(onRunFinalized).toHaveBeenCalledTimes(1);
  });
});
