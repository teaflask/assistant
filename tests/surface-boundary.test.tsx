// @vitest-environment jsdom
/**
 * The surface boundary: a throw inside a mounted surface must degrade
 * that surface to a card — the host page and every sibling stay alive —
 * while still reporting through onError and still naming the failed
 * surface in the console. Never swallowed, never a wrapper while
 * healthy.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import { SurfaceBoundary } from "../src/components/surface-boundary";
import { TeaflaskAssistantProvider } from "../src/components/teaflask-assistant-provider";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../src/transport/token-session", () => ({
  TokenSession: class {
    dispose(): void {
      // Nothing to release — the suite never opens anything.
    }
    authorizedFetch(): Promise<never> {
      return new Promise<never>(() => undefined);
    }
  },
}));

const BOOM = new Error("a poisoned row");

function Bomb(): never {
  throw BOOM;
}

let container: HTMLDivElement;
let root: Root;
// Both React 18 and 19 narrate caught boundary errors to console.error
// (this package tests under both — the react18 CI job re-runs vitest);
// the spy silences the deliberate noise AND is what the naming
// assertions read.
let consoleError: MockInstance<typeof console.error>;

// React 18's development build re-dispatches a boundary-CAUGHT error on
// window for debugger visibility (React 19 routes it through
// onCaughtError/console.error instead). jsdom turns that deliberate
// re-dispatch into an unhandled error, which fails the react18 CI arm on
// a passing suite — preventDefault marks it handled. Harmless under 19:
// the event is never dispatched there.
function swallowBoundaryRedispatch(event: Event) {
  event.preventDefault();
}

beforeEach(() => {
  window.localStorage.clear();
  window.addEventListener("error", swallowBoundaryRedispatch);

  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  window.removeEventListener("error", swallowBoundaryRedispatch);
  consoleError.mockRestore();
});

describe("SurfaceBoundary", () => {
  it("negative control: without the boundary, the throw escapes the render — the bomb is live", () => {
    expect(() => {
      act(() => {
        root.render(
          <div>
            <Bomb />
          </div>,
        );
      });
    }).toThrow(BOOM);
  });

  it("degrades to the card, keeps siblings alive, fires onError once, and names the surface", () => {
    const onError = vi.fn();
    act(() => {
      root.render(
        <div>
          <p data-testid="sibling">still here</p>
          <SurfaceBoundary surface="message-list" onError={onError}>
            <Bomb />
          </SurfaceBoundary>
        </div>,
      );
    });

    // The page survived: the sibling is still mounted…
    expect(container.querySelector('[data-testid="sibling"]')).not.toBeNull();
    // …the degraded card stands where the surface was…
    const fallback = container.querySelector("[data-tf-surface-fallback]");
    expect(fallback).not.toBeNull();
    expect(fallback?.getAttribute("role")).toBe("alert");
    expect(fallback?.getAttribute("data-tf-surface-fallback")).toBe(
      "message-list",
    );
    expect(fallback?.textContent).toContain("hit an error");
    // …the error was reported, not swallowed…
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(BOOM);
    // …and the console named which surface failed.
    expect(
      consoleError.mock.calls.some(
        (call: unknown[]) =>
          typeof call[0] === "string" &&
          call[0].includes("message-list surface failed to render"),
      ),
    ).toBe(true);
  });

  it("healthy render is transparent — no wrapper element, children verbatim", () => {
    act(() => {
      root.render(
        <div data-testid="host">
          <SurfaceBoundary surface="message-list">
            <p data-testid="content">fine</p>
          </SurfaceBoundary>
        </div>,
      );
    });
    const host = container.querySelector('[data-testid="host"]');
    // The child is the host's DIRECT child: the boundary added zero DOM.
    expect(host?.children).toHaveLength(1);
    expect(host?.children[0].getAttribute("data-testid")).toBe("content");
  });

  it("shelfItem: the fallback card carries the slot contract's data-tf-shelf-item", () => {
    act(() => {
      root.render(
        <SurfaceBoundary
          surface="decisions"
          shelfItem
          onError={() => undefined}
        >
          <Bomb />
        </SurfaceBoundary>,
      );
    });
    const fallback = container.querySelector("[data-tf-surface-fallback]");
    expect(fallback?.hasAttribute("data-tf-shelf-item")).toBe(true);
    // And a non-shelf fallback does not (the attribute is the shelf's).
  });

  it("defaults to the session's reportError: the provider's onError prop hears the throw", () => {
    const onError = vi.fn();
    act(() => {
      root.render(
        <TeaflaskAssistantProvider
          publishableKey="pk_test_surface_boundary"
          onError={onError}
        >
          <SurfaceBoundary surface="tool-row">
            <Bomb />
          </SurfaceBoundary>
        </TeaflaskAssistantProvider>,
      );
    });
    expect(onError).toHaveBeenCalledWith(BOOM);
    expect(
      container.querySelector('[data-tf-surface-fallback="tool-row"]'),
    ).not.toBeNull();
  });

  it("a key change on the boundary is the sanctioned reset: the remount clears the latch", () => {
    const onError = vi.fn();
    act(() => {
      root.render(
        <SurfaceBoundary
          key="thread-1#0"
          surface="transcript"
          onError={onError}
        >
          <Bomb />
        </SurfaceBoundary>,
      );
    });
    expect(
      container.querySelector("[data-tf-surface-fallback]"),
    ).not.toBeNull();

    // Same key, healthy child: the latch holds (recovery is a REMOUNT,
    // never a quiet re-render — the flicker-back rule below).
    act(() => {
      root.render(
        <SurfaceBoundary
          key="thread-1#0"
          surface="transcript"
          onError={onError}
        >
          <p data-testid="content">healthy</p>
        </SurfaceBoundary>,
      );
    });
    expect(
      container.querySelector("[data-tf-surface-fallback]"),
    ).not.toBeNull();

    // New key (a thread switch or reconnectNonce bump in
    // conversation-view.tsx): boundary and subtree remount, latch gone.
    act(() => {
      root.render(
        <SurfaceBoundary
          key="thread-1#1"
          surface="transcript"
          onError={onError}
        >
          <p data-testid="content">healthy</p>
        </SurfaceBoundary>,
      );
    });
    expect(container.querySelector("[data-tf-surface-fallback]")).toBeNull();
    expect(container.querySelector('[data-testid="content"]')).not.toBeNull();
  });

  // (The round-3 "card is its own theming root" pin is deliberately
  // GONE: the round-6 ruling made the card cascade-independent — inline
  // literals, no data-tf-assistant, no rootProps — and the matrix in
  // tests-e2e/boundary.spec.ts falsifies it by computed style.)

  it("a THROWING host onError never escapes: the host tree stays mounted and the console still names the surface (round-6 finding 1)", () => {
    const hostObserverBoom = new Error("the host observer is broken too");
    const throwingOnError = vi.fn(() => {
      throw hostObserverBoom;
    });
    // The whole point: this render must NOT throw out of act — an
    // unguarded observer throw re-raises past the outermost boundary and
    // unmounts the host tree.
    act(() => {
      root.render(
        <div>
          <p data-testid="host-alive">host content</p>
          <SurfaceBoundary surface="page" onError={throwingOnError}>
            <Bomb />
          </SurfaceBoundary>
        </div>,
      );
    });
    // The host tree survived its own broken observer…
    expect(
      container.querySelector('[data-testid="host-alive"]'),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-tf-surface-fallback]"),
    ).not.toBeNull();
    // …the observer WAS called (report attempted, not skipped)…
    expect(throwingOnError).toHaveBeenCalledWith(BOOM);
    // …the surface narration still happened despite the observer throw…
    expect(
      consoleError.mock.calls.some(
        (call: unknown[]) =>
          typeof call[0] === "string" &&
          call[0].includes("page surface failed to render"),
      ),
    ).toBe(true);
    // …and the observer's own throw is surfaced, not silently eaten.
    expect(
      consoleError.mock.calls.some(
        (call: unknown[]) =>
          typeof call[0] === "string" &&
          call[0].includes("onError observer itself threw"),
      ),
    ).toBe(true);
  });

  // THE THROWN-PAYLOAD ENUMERATION (round-7 verifier finding 1): a host
  // observer may `throw` ANYTHING — JavaScript does not restrict throw to
  // Error. The old guard used `null` as its no-throw sentinel, so a host's
  // `throw null` was indistinguishable from a clean return and its
  // narration was silently lost; the boolean flag makes every payload
  // narrate. For EACH payload the same four guarantees hold: tree alive,
  // fallback present, surface narration emitted, observer-throw narration
  // emitted carrying the exact payload by identity (never stringified by
  // us — which is why the toString-detonating payload cannot land inside
  // our own narration call).
  describe("a throwing host onError narrates for every payload class, not just Error", () => {
    const hostileToString = {
      toString(): never {
        throw new Error("toString detonated inside a stringification");
      },
    };
    const OBSERVER_PAYLOADS: readonly {
      label: string;
      payload: unknown;
    }[] = [
      // The sentinel-collision case: reddens with the null sentinel
      // restored (`observerError !== null` reads `throw null` as no-throw).
      { label: "null", payload: null },
      { label: "undefined", payload: undefined },
      { label: "a bare string", payload: "the observer exploded" },
      { label: "a falsy number", payload: 0 },
      { label: "a plain object with no message", payload: { code: 500 } },
      { label: "a Symbol", payload: Symbol("observer boom") },
      {
        label: "a payload whose own toString throws",
        payload: hostileToString,
      },
    ];

    for (const { label, payload } of OBSERVER_PAYLOADS) {
      it(`${label}: tree alive, both narrations, payload carried by identity`, () => {
        const throwingOnError = vi.fn(() => {
          // The whole point: hosts throw non-Errors.
          throw payload;
        });
        act(() => {
          root.render(
            <div>
              <p data-testid="host-alive">host content</p>
              <SurfaceBoundary surface="page" onError={throwingOnError}>
                <Bomb />
              </SurfaceBoundary>
            </div>,
          );
        });
        expect(
          container.querySelector('[data-testid="host-alive"]'),
        ).not.toBeNull();
        expect(
          container.querySelector("[data-tf-surface-fallback]"),
        ).not.toBeNull();
        expect(throwingOnError).toHaveBeenCalledWith(BOOM);
        expect(
          consoleError.mock.calls.some(
            (call: unknown[]) =>
              typeof call[0] === "string" &&
              call[0].includes("page surface failed to render"),
          ),
        ).toBe(true);
        const narration = consoleError.mock.calls.find(
          (call: unknown[]) =>
            typeof call[0] === "string" &&
            call[0].includes("onError observer itself threw"),
        );
        expect(narration).toBeDefined();
        // Identity, arity-pinned: the payload rides as the one extra
        // console argument, whatever it is (Object.is semantics).
        expect(narration).toHaveLength(2);
        expect(narration?.[1]).toBe(payload);
      });
    }
  });

  it("guard 2's falsifier (round-7 verifier finding 2): a console interceptor that throws on the package's narration costs the log lines, never the tree", () => {
    // WHERE THIS CASE HAD TO LIVE: this file's beforeEach replaces
    // console.error with a benign no-op — under it, guard 2's try/catch
    // was dead weight to every test (deleting it left all of them green:
    // the 4th harness-excludes-its-own-case instance on this ticket). The
    // adversarial case therefore lives here IN the same file but escapes
    // that exclusion by re-arming the shared spy with a
    // selectively-throwing implementation for this one test: it detonates
    // only on the package's own "[teaflask-assistant]" lines, so React's
    // boundary narration (the noise the no-op exists to silence, and the
    // reason a throw-on-everything interceptor is unusable here) still
    // passes through harmlessly. afterEach's mockRestore puts the world
    // back.
    const interceptorBoom = new Error(
      "the host's console interceptor is hostile",
    );
    consoleError.mockImplementation((...args: unknown[]) => {
      if (
        typeof args[0] === "string" &&
        args[0].startsWith("[teaflask-assistant]")
      ) {
        throw interceptorBoom;
      }
    });
    const observerBoom = new Error("the observer is broken too");
    const throwingOnError = vi.fn(() => {
      throw observerBoom;
    });
    // The falsifier: delete guard 2 (the second try/catch) and the
    // interceptor's throw escapes componentDidCatch, React re-raises it
    // past the boundary, and this render throws out of act — RED.
    act(() => {
      root.render(
        <div>
          <p data-testid="host-alive">host content</p>
          <SurfaceBoundary surface="page" onError={throwingOnError}>
            <Bomb />
          </SurfaceBoundary>
        </div>,
      );
    });
    expect(
      container.querySelector('[data-testid="host-alive"]'),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-tf-surface-fallback]"),
    ).not.toBeNull();
    // Reporting was untouched: onError ran BEFORE guard 2's block.
    expect(throwingOnError).toHaveBeenCalledWith(BOOM);
    // The accepted cost, exactly as enumeration item 3 states it: the
    // interceptor detonated on the FIRST narration line, and the
    // observer-throw line — inside the same try, after it — was never
    // reached. One attempted package line, zero second lines.
    const packageCalls = consoleError.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === "string" &&
        call[0].startsWith("[teaflask-assistant]"),
    );
    expect(packageCalls).toHaveLength(1);
    expect(packageCalls[0][0]).toContain("surface failed to render");
  });

  it("degrade=silent renders NOTHING when latched — reporting untouched (round-3 finding 4)", () => {
    const onError = vi.fn();
    act(() => {
      root.render(
        <div data-testid="host-tree">
          <SurfaceBoundary surface="palette" degrade="silent" onError={onError}>
            <Bomb />
          </SurfaceBoundary>
        </div>,
      );
    });
    // Absence, not a card: an overlay surface must not become an in-flow
    // block at the bottom of the host page.
    expect(container.querySelector("[data-tf-surface-fallback]")).toBeNull();
    expect(
      container.querySelector('[data-testid="host-tree"]')?.childNodes,
    ).toHaveLength(0);
    // The non-negotiable half is identical to the card path: reported,
    // never swallowed, surface named.
    expect(onError).toHaveBeenCalledWith(BOOM);
    expect(
      consoleError.mock.calls.some(
        (call: unknown[]) =>
          typeof call[0] === "string" &&
          call[0].includes("palette surface failed to render"),
      ),
    ).toBe(true);
  });

  it("stays degraded once latched — a re-render never flickers the broken surface back", () => {
    const onError = vi.fn();
    const view = (
      <SurfaceBoundary surface="message-list" onError={onError}>
        <Bomb />
      </SurfaceBoundary>
    );
    act(() => {
      root.render(view);
    });
    act(() => {
      root.render(view);
    });
    expect(
      container.querySelector("[data-tf-surface-fallback]"),
    ).not.toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
