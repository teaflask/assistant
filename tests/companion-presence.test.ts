import { describe, expect, it } from "vitest";

import {
  companionChromeOf,
  type CompanionChromeInput,
} from "../src/core/companion-presence";

function inputOf(
  overrides: Partial<CompanionChromeInput> = {},
): CompanionChromeInput {
  return {
    surfaces: { fullSurfaceMounted: false, transientOpen: false },
    expanded: false,
    ...overrides,
  };
}

describe("the priority ladder", () => {
  it("yields to a mounted full surface, rendering nothing", () => {
    expect(
      companionChromeOf(
        inputOf({
          surfaces: { fullSurfaceMounted: true, transientOpen: false },
        }),
      ),
    ).toBe("none");
  });

  it("an open palette hides the minimized companion", () => {
    expect(
      companionChromeOf(
        inputOf({
          surfaces: { fullSurfaceMounted: false, transientOpen: true },
        }),
      ),
    ).toBe("none");
  });

  it("an open palette hides even an already-open drawer", () => {
    // The palette holds the transcript lease; the expanded flag survives
    // so the drawer returns the moment the palette closes.
    expect(
      companionChromeOf(
        inputOf({
          surfaces: { fullSurfaceMounted: false, transientOpen: true },
          expanded: true,
        }),
      ),
    ).toBe("none");
  });

  it("a full surface still beats an open drawer", () => {
    expect(
      companionChromeOf(
        inputOf({
          surfaces: { fullSurfaceMounted: true, transientOpen: false },
          expanded: true,
        }),
      ),
    ).toBe("none");
  });

  it("the expanded flag shows the drawer", () => {
    expect(companionChromeOf(inputOf({ expanded: true }))).toBe("drawer");
  });

  it("rests as the bare mark with nothing else on the page", () => {
    expect(companionChromeOf(inputOf())).toBe("companion");
  });
});
