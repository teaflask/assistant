// @vitest-environment jsdom
import { StrictMode, act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { useRegisterAssistantSurface } from "../src/components/use-register-assistant-surface";
import {
  assistantSurfaceRegistry,
  type AssistantSurfaceKind,
} from "../src/core/surface-registry";

// The hook is exercised against the real module singleton — the whole
// point of the registry is that producers and the companion meet there.
// Every test unmounts, so each ends back at the all-false snapshot.

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({
  kind,
  active,
}: {
  kind: AssistantSurfaceKind;
  active?: boolean;
}) {
  useRegisterAssistantSurface(kind, active);
  return null;
}

let root: Root | null = null;

function render(element: ReactNode): void {
  act(() => {
    root ??= createRoot(document.createElement("div"));
    root.render(element);
  });
}

function unmount(): void {
  act(() => {
    root?.unmount();
  });
  root = null;
}

afterEach(unmount);

describe("useRegisterAssistantSurface", () => {
  it("registers a full surface on mount and unregisters on unmount", () => {
    render(<Harness kind="full-surface" />);
    expect(assistantSurfaceRegistry.getSnapshot().fullSurfaceMounted).toBe(
      true,
    );

    unmount();
    expect(assistantSurfaceRegistry.getSnapshot().fullSurfaceMounted).toBe(
      false,
    );
  });

  it("follows the active flag — the palette's open prop", () => {
    render(<Harness kind="transient" active={false} />);
    expect(assistantSurfaceRegistry.getSnapshot().transientOpen).toBe(false);

    render(<Harness kind="transient" active={true} />);
    expect(assistantSurfaceRegistry.getSnapshot().transientOpen).toBe(true);

    render(<Harness kind="transient" active={false} />);
    expect(assistantSurfaceRegistry.getSnapshot().transientOpen).toBe(false);
  });

  it("unregisters when unmounted while active — the palette torn down open", () => {
    render(<Harness kind="transient" active={true} />);
    expect(assistantSurfaceRegistry.getSnapshot().transientOpen).toBe(true);

    unmount();
    expect(assistantSurfaceRegistry.getSnapshot().transientOpen).toBe(false);
  });

  it("settles correctly under StrictMode's doubled effects", () => {
    render(
      <StrictMode>
        <Harness kind="full-surface" />
      </StrictMode>,
    );
    expect(assistantSurfaceRegistry.getSnapshot().fullSurfaceMounted).toBe(
      true,
    );

    unmount();
    expect(assistantSurfaceRegistry.getSnapshot().fullSurfaceMounted).toBe(
      false,
    );
  });
});
