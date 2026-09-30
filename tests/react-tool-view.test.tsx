// @vitest-environment jsdom
// The React sugar over the imperative lifecycle (tool-views.md): one
// contract, two spellings. mount commits synchronously; update applies
// new props IN PLACE (React reconciles, component-local state
// survives); destroy unmounts; a render throw surfaces as a synchronous
// mount/update throw — the adapter contract's one failure channel.

import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { reactToolView } from "../src/components/react-tool-view";
import type { ToolViewAdapter, ToolViewProps } from "../src/core/tool-view";

function propsOf(status: ToolViewProps["call"]["status"]): ToolViewProps {
  return {
    call: {
      toolName: "acme__lookup",
      toolCallId: "t1",
      status,
      awaitingDecision: false,
      args: { q: "sencha" },
    },
    context: { themeMode: "light" },
  };
}

// The instrument: a per-suite identity counter. A REMOUNT constructs a
// new component instance, so the rendered id increments; an in-place
// update keeps it. The effect counter cross-checks the same fact
// through the mount effect.
let instanceCounter = 0;
let mountEffects = 0;

function StatefulView(props: ToolViewProps) {
  const [id] = useState(() => {
    instanceCounter += 1;
    return instanceCounter;
  });
  useEffect(() => {
    mountEffects += 1;
  }, []);
  return (
    <p>
      instance {id} · {props.call.status}
    </p>
  );
}

afterEach(() => {
  instanceCounter = 0;
  mountEffects = 0;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function containerOf(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return container;
}

/** flushSync commits render effects synchronously, but React 18 defers
 *  PASSIVE effects (the mount-effect counter) to a later task. */
async function drainEffects() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("reactToolView", () => {
  it("mounts synchronously: the DOM is committed when mount() returns", () => {
    const adapter = reactToolView(StatefulView);
    const container = containerOf();
    const instance = adapter.mount(container, propsOf("input-available"));
    expect(container.textContent).toBe("instance 1 · input-available");
    instance.destroy();
  });

  it("update applies new props in place — component identity and local state survive", async () => {
    const adapter = reactToolView(StatefulView);
    const container = containerOf();
    const instance = adapter.mount(container, propsOf("input-available"));
    await drainEffects();

    instance.update(propsOf("output-available"));
    instance.update(propsOf("output-available"));
    await drainEffects();

    // The props landed…
    expect(container.textContent).toContain("output-available");
    // …into the SAME instance: the useState initializer never re-ran and
    // the mount effect fired exactly once.
    expect(container.textContent).toContain("instance 1");
    expect(instanceCounter).toBe(1);
    expect(mountEffects).toBe(1);
    instance.destroy();
  });

  it("NEGATIVE CONTROL: a remounting adapter trips the same instrument", async () => {
    // Proves the test above would fail if update remounted: wrap the
    // sugar in an adapter whose update is destroy-then-mount, and the
    // identity counter must advance.
    const sugar = reactToolView(StatefulView);
    const remounting: ToolViewAdapter = {
      mount(container, props) {
        let inner = sugar.mount(container, props);
        return {
          update(next) {
            inner.destroy();
            inner = sugar.mount(container, next);
          },
          destroy() {
            inner.destroy();
          },
        };
      },
    };
    const container = containerOf();
    const instance = remounting.mount(container, propsOf("input-available"));
    await drainEffects();
    instance.update(propsOf("output-available"));
    await drainEffects();

    expect(container.textContent).toContain("instance 2");
    expect(instanceCounter).toBe(2);
    expect(mountEffects).toBe(2);
    instance.destroy();
  });

  it("destroy unmounts the component and empties the container", () => {
    const adapter = reactToolView(StatefulView);
    const container = containerOf();
    const instance = adapter.mount(container, propsOf("input-available"));
    expect(container.textContent).not.toBe("");
    instance.destroy();
    expect(container.innerHTML).toBe("");
  });

  it("a render throw surfaces synchronously from mount", () => {
    // React logs the boundary-caught error; spied to keep output clean.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const Kaboom = (): never => {
      throw new Error("kaboom at mount");
    };
    const adapter = reactToolView(Kaboom);
    expect(() =>
      adapter.mount(containerOf(), propsOf("input-available")),
    ).toThrow("kaboom at mount");
  });

  it("a render throw surfaces synchronously from update", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const FailsOnSettle = (props: ToolViewProps) => {
      if (props.call.status === "output-available") {
        throw new Error("kaboom at update");
      }
      return <p>running</p>;
    };
    const adapter = reactToolView(FailsOnSettle);
    const instance = adapter.mount(containerOf(), propsOf("input-available"));
    expect(() => {
      instance.update(propsOf("output-available"));
    }).toThrow("kaboom at update");
  });
});
