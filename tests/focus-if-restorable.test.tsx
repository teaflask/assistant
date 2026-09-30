// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { focusIfRestorable } from "../src/components/subagent-delegation-surface";

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

function stubVisibility(element: HTMLElement, visible: boolean) {
  const spy = vi.fn().mockReturnValue(visible);
  (element as unknown as { checkVisibility: typeof spy }).checkVisibility = spy;
  return spy;
}

describe("focusIfRestorable", () => {
  it("asks checkVisibility about the visibility and opacity PROPERTIES", () => {
    // The bare call defaults both options OFF, so a visibility:hidden
    // opener — the scrollback-yielded pill — read as visible and focus()
    // silently no-opped (round-4 regression review). The options are the
    // fix; this pins them.
    const opener = document.createElement("button");
    host.appendChild(opener);
    const spy = stubVisibility(opener, true);
    focusIfRestorable(opener);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        visibilityProperty: true,
        opacityProperty: true,
      }),
    );
    expect(document.activeElement).toBe(opener);
  });

  it("hands focus from a yielded activity-slot opener to the jump affordance", () => {
    // The scrollback yield hides the whole slot (visibility: hidden), so
    // the trigger cannot take focus back — the merged jump affordance is
    // the control that replaced it, and focus belongs there.
    const slot = document.createElement("div");
    slot.setAttribute("data-tf-activity-slot", "");
    const opener = document.createElement("button");
    slot.appendChild(opener);
    const jump = document.createElement("button");
    jump.setAttribute("data-tf-scroll-away-activity", "");
    host.append(slot, jump);
    stubVisibility(opener, false);

    focusIfRestorable(opener);
    expect(document.activeElement).toBe(jump);
  });

  it("still prefers a collapsed group's summary over the jump affordance", () => {
    // The pre-existing arm: an opener hidden by its own <details>
    // collapsing hands focus to the summary that swallowed it.
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.tabIndex = 0;
    const opener = document.createElement("button");
    details.append(summary, opener);
    host.appendChild(details);
    stubVisibility(opener, false);

    focusIfRestorable(opener);
    expect(document.activeElement).toBe(summary);
  });

  it("skips a disconnected opener without crashing", () => {
    const opener = document.createElement("button");
    stubVisibility(opener, true);
    focusIfRestorable(opener);
    focusIfRestorable(null);
    expect(document.activeElement).not.toBe(opener);
  });
});
