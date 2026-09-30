// @vitest-environment jsdom
/** useAgentSubscriber: one subscription per (agent, thunk) for the
 *  component's lifetime — the thunk runs fresh on every subscribe, a
 *  disposable is disposed before its unsubscribe, and changing the agent
 *  or the thunk re-subscribes. */
import { act, useCallback } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentSubscriber, AgentSubscriberParams } from "@ag-ui/client";

import { useAgentSubscriber } from "../src/components/use-agent-subscriber";
import {
  disposableSubscriber,
  type DisposableAgentSubscriber,
} from "../src/core/disposable-subscriber";

interface FakeAgent {
  subscribers: AgentSubscriber[];
  log: string[];
  subscribe: (subscriber: AgentSubscriber) => { unsubscribe: () => void };
}

function fakeAgent(name = "agent"): FakeAgent {
  const agent: FakeAgent = {
    subscribers: [],
    log: [],
    subscribe(subscriber) {
      agent.subscribers.push(subscriber);
      agent.log.push(`${name}:subscribe`);
      return {
        unsubscribe: () => {
          agent.subscribers = agent.subscribers.filter((s) => s !== subscriber);
          agent.log.push(`${name}:unsubscribe`);
        },
      };
    },
  };
  return agent;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
});

function Recorder({
  agent,
  subscriberOf,
}: {
  agent: FakeAgent;
  subscriberOf: () => AgentSubscriber | DisposableAgentSubscriber;
}) {
  useAgentSubscriber(agent, subscriberOf);
  return null;
}

describe("useAgentSubscriber", () => {
  it("subscribes on mount and unsubscribes on unmount, the thunk called once per subscribe", () => {
    const agent = fakeAgent();
    const subscriberOf = vi.fn((): AgentSubscriber => ({}));
    act(() => {
      root.render(<Recorder agent={agent} subscriberOf={subscriberOf} />);
    });
    expect(subscriberOf).toHaveBeenCalledTimes(1);
    expect(agent.subscribers).toHaveLength(1);
    act(() => {
      root.unmount();
    });
    root = createRoot(host);
    expect(agent.subscribers).toHaveLength(0);
    expect(agent.log).toEqual(["agent:subscribe", "agent:unsubscribe"]);
  });

  it("re-subscribes when the agent changes, and when the thunk's identity changes", () => {
    const first = fakeAgent("first");
    const second = fakeAgent("second");
    const subscriberOf = () => ({});
    act(() => {
      root.render(<Recorder agent={first} subscriberOf={subscriberOf} />);
    });
    act(() => {
      root.render(<Recorder agent={second} subscriberOf={subscriberOf} />);
    });
    expect(first.log).toEqual(["first:subscribe", "first:unsubscribe"]);
    expect(second.log).toEqual(["second:subscribe"]);
    act(() => {
      root.render(<Recorder agent={second} subscriberOf={() => ({})} />);
    });
    expect(second.log).toEqual([
      "second:subscribe",
      "second:unsubscribe",
      "second:subscribe",
    ]);
  });

  it("a memoized thunk holds the subscription across re-renders", () => {
    const agent = fakeAgent();
    function Host({ label }: { label: string }) {
      const subscriberOf = useCallback((): AgentSubscriber => ({}), []);
      useAgentSubscriber(agent, subscriberOf);
      return <span>{label}</span>;
    }
    act(() => {
      root.render(<Host label="a" />);
    });
    act(() => {
      root.render(<Host label="b" />);
    });
    expect(agent.log).toEqual(["agent:subscribe"]);
  });

  it("disposes a disposable subscriber BEFORE unsubscribing it", () => {
    // One order log for both halves of the teardown: the fake's own
    // unsubscribe writes into it, so the assertion sees the sequence the
    // hook actually ran — dispose, then unsubscribe — and reddens on the
    // reverse order or on a missing dispose.
    const order: string[] = [];
    const agent: FakeAgent = {
      subscribers: [],
      log: [],
      subscribe(subscriber) {
        agent.subscribers.push(subscriber);
        return {
          unsubscribe: () => {
            order.push("unsubscribe");
            agent.subscribers = agent.subscribers.filter(
              (s) => s !== subscriber,
            );
          },
        };
      },
    };
    const onRunFinalized = vi.fn();
    const subscriberOf = () => {
      const wrapped = disposableSubscriber({ onRunFinalized });
      return {
        subscriber: wrapped.subscriber,
        dispose: () => {
          order.push("dispose");
          wrapped.dispose();
        },
      };
    };
    act(() => {
      root.render(<Recorder agent={agent} subscriberOf={subscriberOf} />);
    });
    const [snapshotted] = agent.subscribers;
    expect(order).toEqual([]);
    // A new thunk identity re-subscribes: the first subscription tears
    // down, and the teardown's two steps land in `order` in hook order.
    act(() => {
      root.render(
        <Recorder agent={agent} subscriberOf={() => subscriberOf()} />,
      );
    });
    expect(order).toEqual(["dispose", "unsubscribe"]);
    expect(agent.subscribers).toHaveLength(1);
    expect(agent.subscribers[0]).not.toBe(snapshotted);
    // The disposed subscriber — the one a run in flight still holds —
    // says nothing more.
    void snapshotted.onRunFinalized?.({} as AgentSubscriberParams);
    expect(onRunFinalized).not.toHaveBeenCalled();
  });

  it("per-subscription closure state starts fresh on every subscribe", () => {
    const agent = fakeAgent();
    const seen: number[] = [];
    let mints = 0;
    const subscriberOf = () => {
      const mint = (mints += 1);
      seen.push(mint);
      return {};
    };
    act(() => {
      root.render(<Recorder agent={agent} subscriberOf={subscriberOf} />);
    });
    act(() => {
      root.render(
        <Recorder agent={agent} subscriberOf={() => subscriberOf()} />,
      );
    });
    expect(seen).toEqual([1, 2]);
  });
});
