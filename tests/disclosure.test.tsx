// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  Disclosure,
  DisclosureChevron,
  useDisclosureVisualState,
} from "../src/components/primitives/disclosure";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
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

function render(open: boolean | undefined) {
  act(() => {
    root.render(
      <Disclosure
        summary={
          <>
            <span>Working…</span>
            <DisclosureChevron revealOnInteraction />
          </>
        }
        open={open}
      >
        <p>body</p>
      </Disclosure>,
    );
  });
}

function details(): HTMLDetailsElement {
  const element = host.querySelector<HTMLDetailsElement>("details");
  if (element === null) {
    throw new Error("no details rendered");
  }
  return element;
}

function chevron(): SVGElement {
  const element = host.querySelector<SVGElement>(
    "[data-tf-disclosure-chevron]",
  );
  if (element === null) {
    throw new Error("no chevron rendered");
  }
  return element;
}

// jsdom renders <details> but never fires the native toggle event on the
// visitor's click; the browser does. These helpers replay exactly what the
// browser would: flip the DOM property, dispatch toggle.
function visitorToggles(to: boolean) {
  act(() => {
    details().open = to;
    details().dispatchEvent(new Event("toggle"));
  });
}

describe("the disclosure's visual-state mirror", () => {
  it("reads the DOM, not the prop: a visitor collapse of a force-opened details closes the chevron", () => {
    // The selector this mirror replaced ([open]>summary) always read the
    // DOM. React re-writes the open attribute only when the prop VALUE
    // changes, so with the prop pinned true the visitor's own collapse
    // must still un-rotate and un-reveal the chevron.
    render(true);
    expect(details().open).toBe(true);
    expect(chevron().hasAttribute("data-tf-disclosure-chevron-open")).toBe(
      true,
    );

    visitorToggles(false);
    render(true); // the prop has not moved; a re-render must not resurrect it
    expect(chevron().hasAttribute("data-tf-disclosure-chevron-open")).toBe(
      false,
    );
    expect(chevron().getAttribute("opacity")).toBe("0");
  });

  it("an undefined→true flip opens the chevron through the toggle it fires", () => {
    render(undefined);
    expect(chevron().hasAttribute("data-tf-disclosure-chevron-open")).toBe(
      false,
    );

    render(true);
    // React sets the attribute; the browser answers with a toggle event.
    visitorToggles(true);
    expect(chevron().hasAttribute("data-tf-disclosure-chevron-open")).toBe(
      true,
    );
  });
});

describe("useDisclosureVisualState — the exported summary-scope hook", () => {
  function StateProbe() {
    const open = useDisclosureVisualState()?.open ?? false;
    return <span data-probe-open={String(open)} />;
  }

  it("hands summary content the DOM-backed open bit, through dispatched toggles both ways", () => {
    act(() => {
      root.render(
        <Disclosure summary={<StateProbe />} open={undefined}>
          <p>body</p>
        </Disclosure>,
      );
    });
    const probe = () =>
      host.querySelector("[data-probe-open]")?.getAttribute("data-probe-open");
    expect(probe()).toBe("false");
    act(() => {
      details().open = true;
      details().dispatchEvent(new Event("toggle"));
    });
    expect(probe()).toBe("true");
    act(() => {
      details().open = false;
      details().dispatchEvent(new Event("toggle"));
    });
    expect(probe()).toBe("false");
  });

  it("returns null outside a Disclosure summary — the body subtree included", () => {
    function NullProbe() {
      return (
        <span data-probe-null={String(useDisclosureVisualState() === null)} />
      );
    }
    act(() => {
      root.render(
        <Disclosure summary={<span>head</span>} open={undefined}>
          <NullProbe />
        </Disclosure>,
      );
    });
    expect(
      host.querySelector("[data-probe-null]")?.getAttribute("data-probe-null"),
    ).toBe("true");
  });
});
