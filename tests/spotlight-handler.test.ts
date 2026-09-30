// @vitest-environment jsdom
// The builtin.highlight path: the spotlight affordance's overlay
// mechanics under a hand-steered probe, and the handler contract —
// registered unconditionally, ref narrowing, the reader's own refusal
// delivered verbatim, strict result shape.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HIGHLIGHT_DWELL_MS,
  spotlightElement,
} from "../src/affordances/highlight";
import {
  executionHandlersFor,
  HIGHLIGHT_REQUEST_KIND,
  type ExecutionHandler,
  type ExecutionOutcome,
} from "../src/core/execution-handlers";
import type { ExecutionEntryModel } from "../src/core/execution-inbox";
import {
  snapshotTreeOf,
  type SnapshotNode,
  type SnapshotOptions,
} from "../src/reader/snapshot";
import { fakeLayoutProbeOf, type FakeLayoutProbe } from "./reader-fakes";

let probe: FakeLayoutProbe;

beforeEach(() => {
  vi.useFakeTimers();
  probe = fakeLayoutProbeOf();
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
});

function highlightEntryOf(
  action: Record<string, unknown> | null,
): ExecutionEntryModel {
  return {
    interruptId: "v1:tool_call:t8",
    toolName: "highlight",
    toolCallId: "run-1-a1-t8",
    anchored: false,
    kind: HIGHLIGHT_REQUEST_KIND,
    action,
    intent: null,
    round: 0,
    runId: "run-1",
    status: { kind: "pending" },
    asker: { kind: "assistant" },
    turnId: null,
  };
}

function highlightHandlerOf(): ExecutionHandler {
  const handler = executionHandlersFor(null, null, "thread-under-test").get(
    HIGHLIGHT_REQUEST_KIND,
  );
  if (handler === undefined) {
    throw new Error("The registry lost its highlight handler.");
  }
  return handler;
}

function failureMessageOf(outcome: ExecutionOutcome): string {
  if (outcome.ok) {
    throw new Error("Expected a failure outcome.");
  }
  return outcome.error.message;
}

/** Walk a fresh snapshot and return the ref the reader minted for the
 * element — the same ref the model would quote back. */
function mintedRefOf(element: Element): string {
  const options: SnapshotOptions = {
    probe,
    ignoreSelectors: [],
    maxDepth: 50,
    interactive: false,
    showHidden: false,
    selector: null,
    refId: null,
    rootElement: null,
  };
  const outcome = snapshotTreeOf(options);
  if (outcome.tree === null) {
    throw new Error(`The seeding snapshot failed: ${outcome.error}`);
  }
  const ref = _refInTree(outcome.tree, element);
  if (ref === null) {
    throw new Error("The reader minted no ref for the target element.");
  }
  return ref;
}

function _refInTree(node: SnapshotNode, element: Element): string | null {
  if (node.element === element && node.refId !== null) {
    return node.refId;
  }
  for (const child of node.children) {
    if (typeof child === "string") {
      continue;
    }
    const found = _refInTree(child, element);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

function theRing(): HTMLElement {
  const ring = document.querySelector<HTMLElement>(".tf-highlight-ring");
  if (ring === null) {
    throw new Error("No spotlight ring is in the document.");
  }
  return ring;
}

describe("the spotlight affordance", () => {
  it("draws the package's own ring around the probe's rect — the host element untouched", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    probe.setRect(button, { top: 100, left: 40, width: 120, height: 32 });

    spotlightElement(button, probe);

    const ring = theRing();
    expect(ring.style.top).toBe("96px");
    expect(ring.style.left).toBe("36px");
    expect(ring.style.width).toBe("128px");
    expect(ring.style.height).toBe("40px");
    expect(ring.hasAttribute("data-tf-assistant")).toBe(true);
    expect(ring.getAttribute("aria-hidden")).toBe("true");
    expect(button.getAttribute("class")).toBeNull();
    expect(button.getAttribute("style")).toBeNull();
  });

  it("scrolls the target into view, centered", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    const scrollIntoView = vi.fn();
    button.scrollIntoView = scrollIntoView;

    spotlightElement(button, probe);

    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      inline: "nearest",
      behavior: "smooth",
    });
  });

  it("cuts the scroll when the host's kill switch sits on <body> — where the ring's CSS reads it", () => {
    document.body.dataset.reduceMotion = "true";
    const button = document.createElement("button");
    document.body.appendChild(button);
    const scrollIntoView = vi.fn();
    button.scrollIntoView = scrollIntoView;

    spotlightElement(button, probe);
    delete document.body.dataset.reduceMotion;

    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      inline: "nearest",
      behavior: "auto",
    });
  });

  it("tracks the target while the page scrolls", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    probe.setRect(button, { top: 100, left: 40, width: 120, height: 32 });
    spotlightElement(button, probe);

    probe.setRect(button, { top: 10, left: 40, width: 120, height: 32 });
    window.dispatchEvent(new Event("scroll"));

    expect(theRing().style.top).toBe("6px");
  });

  it("dwells, then fades, then leaves the document", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    spotlightElement(button, probe);
    const ring = theRing();

    vi.advanceTimersByTime(HIGHLIGHT_DWELL_MS);
    expect(ring.dataset.tfHighlightLeaving).toBe("true");
    expect(ring.isConnected).toBe(true);

    vi.advanceTimersByTime(300);
    expect(ring.isConnected).toBe(false);
  });

  it("keeps one spotlight at a time — pointing somewhere new dismisses the old", () => {
    const first = document.createElement("button");
    const second = document.createElement("button");
    document.body.append(first, second);

    spotlightElement(first, probe);
    spotlightElement(second, probe);
    vi.advanceTimersByTime(300);

    expect(document.querySelectorAll(".tf-highlight-ring")).toHaveLength(1);
  });
});

describe("the highlight handler", () => {
  it("spotlights a minted ref and synthesizes the strict HighlightResult itself", async () => {
    document.body.innerHTML = '<button id="save">Save</button>';
    const button = document.querySelector("#save");
    if (button === null) {
      throw new Error("The fixture lost its button.");
    }
    const refId = mintedRefOf(button);

    const outcome = await highlightHandlerOf()(
      highlightEntryOf({ ref_id: refId }),
    );

    expect(outcome).toEqual({
      ok: true,
      result: { highlighted: true, ref_id: refId },
    });
    expect(document.querySelectorAll(".tf-highlight-ring")).toHaveLength(1);
  });

  it("delivers the reader's own stale-ref refusal verbatim — the retry it asks for must survive", async () => {
    const outcome = await highlightHandlerOf()(
      highlightEntryOf({ ref_id: "e9999" }),
    );

    expect(outcome.ok).toBe(false);
    expect(failureMessageOf(outcome)).toContain("take a fresh full read");
    expect(document.querySelector(".tf-highlight-ring")).toBeNull();
  });

  it("refuses an unusable ref_id with canned prose", async () => {
    const unusableActions: (Record<string, unknown> | null)[] = [
      null,
      {},
      { ref_id: 7 },
      { ref_id: "  " },
    ];
    for (const action of unusableActions) {
      const outcome = await highlightHandlerOf()(highlightEntryOf(action));
      expect(failureMessageOf(outcome)).toContain(
        "did not carry a usable ref_id",
      );
    }
  });
});
