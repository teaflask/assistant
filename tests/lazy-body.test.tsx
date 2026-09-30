// @vitest-environment jsdom
/**
 * The on-demand body wrapper. A dynamic import that never resolves its
 * chunk — the script-tag distribution's deploy deletes the previous
 * build's chunks, so a visitor on a slightly stale entry can ask for one
 * that is gone — must not take the surrounding surface down with it.
 */
import { act, lazy, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LazyBody } from "../src/components/lazy-body";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const reportError = vi.fn();
vi.mock("../src/components/teaflask-assistant-provider", () => ({
  useAssistantSession: () => ({ reportError }),
  useOptionalAssistantSession: () => ({ reportError }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  reportError.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

async function renderAndSettle(body: ReactNode): Promise<void> {
  act(() => {
    root.render(
      <div data-testid="surrounding-surface">
        <LazyBody>{body}</LazyBody>
      </div>,
    );
  });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    if (!container.textContent.includes("Loading…")) {
      break;
    }
  }
}

describe("LazyBody", () => {
  it("shows the placeholder, then the body once its chunk lands", async () => {
    const Body = lazy(() =>
      Promise.resolve({
        default: () => <div data-testid="body">the conversation</div>,
      }),
    );

    await renderAndSettle(<Body />);

    expect(container.querySelector('[data-testid="body"]')).not.toBeNull();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("contains a chunk that never arrives, and offers a way out", async () => {
    // Exactly what a deleted chunk looks like to React.lazy.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const Body = lazy(() =>
      Promise.reject(
        new Error("Failed to fetch dynamically imported module: chunk.js"),
      ),
    );

    await renderAndSettle(<Body />);

    // The surface around it is still standing — the whole point.
    expect(
      container.querySelector('[data-testid="surrounding-surface"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("didn’t load");
    expect(container.querySelector<HTMLButtonElement>("button")).not.toBeNull();
    // The host's observer hears about it rather than it vanishing.
    expect(reportError).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalled();
  });
});
