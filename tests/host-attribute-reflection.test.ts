// @vitest-environment jsdom
/**
 * The reflection bridge: `data-tf-theme` and `data-reduce-motion` are
 * descendant selectors that never cross a shadow boundary, so the
 * custom element mirrors the nearest light-DOM ancestor's value onto an
 * in-shadow wrapper — live, via one MutationObserver — and strips the
 * mirrors on stop.
 */
import { afterEach, describe, expect, it } from "vitest";

import { startHostAttributeReflection } from "../src/element/host-attribute-reflection";

let cleanups: (() => void)[] = [];

function bridgeFixture(): { host: HTMLElement; target: HTMLElement } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const target = document.createElement("div");
  host.attachShadow({ mode: "open" }).appendChild(target);
  cleanups.push(() => {
    host.remove();
  });
  return { host, target };
}

function startBridge(host: HTMLElement, target: HTMLElement): () => void {
  const stop = startHostAttributeReflection(host, target);
  cleanups.push(stop);
  return stop;
}

// MutationObserver callbacks ride the microtask queue.
async function observerFlush(): Promise<void> {
  await Promise.resolve();
}

afterEach(() => {
  for (const cleanup of cleanups) {
    cleanup();
  }
  cleanups = [];
  document.body.removeAttribute("data-tf-theme");
  document.body.removeAttribute("data-reduce-motion");
});

describe("startHostAttributeReflection", () => {
  it("mirrors both attributes present at start", () => {
    document.body.setAttribute("data-tf-theme", "dark");
    document.body.setAttribute("data-reduce-motion", "true");
    const { host, target } = bridgeFixture();

    startBridge(host, target);

    expect(target.getAttribute("data-tf-theme")).toBe("dark");
    expect(target.getAttribute("data-reduce-motion")).toBe("true");
  });

  it("follows attribute changes anywhere above the host", async () => {
    const { host, target } = bridgeFixture();
    startBridge(host, target);
    expect(target.hasAttribute("data-tf-theme")).toBe(false);

    document.documentElement.setAttribute("data-tf-theme", "dark");
    await observerFlush();
    expect(target.getAttribute("data-tf-theme")).toBe("dark");

    document.documentElement.removeAttribute("data-tf-theme");
    await observerFlush();
    expect(target.hasAttribute("data-tf-theme")).toBe(false);

    document.body.setAttribute("data-reduce-motion", "true");
    await observerFlush();
    expect(target.getAttribute("data-reduce-motion")).toBe("true");

    document.documentElement.removeAttribute("data-reduce-motion");
    cleanups.push(() => {
      document.documentElement.removeAttribute("data-tf-theme");
    });
  });

  it("prefers the nearest carrier, exactly like the descendant selector", () => {
    document.documentElement.setAttribute("data-tf-theme", "dark");
    cleanups.push(() => {
      document.documentElement.removeAttribute("data-tf-theme");
    });
    document.body.setAttribute("data-tf-theme", "light");
    const { host, target } = bridgeFixture();

    startBridge(host, target);

    expect(target.getAttribute("data-tf-theme")).toBe("light");
  });

  it("stops observing and strips the mirrors on stop", async () => {
    document.body.setAttribute("data-tf-theme", "dark");
    const { host, target } = bridgeFixture();
    const stop = startBridge(host, target);

    stop();
    expect(target.hasAttribute("data-tf-theme")).toBe(false);

    document.body.setAttribute("data-tf-theme", "light");
    await observerFlush();
    expect(target.hasAttribute("data-tf-theme")).toBe(false);
  });
});
