// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { ariaBooleanOf, ariaLevelOf, roleOf } from "../src/reader/roles";

function elementOf(html: string): Element {
  document.body.innerHTML = html;
  const element = document.body.firstElementChild;
  if (element === null) {
    throw new Error("The test HTML produced no element.");
  }
  return element;
}

describe("roleOf", () => {
  it("honors a valid explicit role", () => {
    expect(roleOf(elementOf('<div role="dialog"></div>'))).toBe("dialog");
  });

  it("takes the first valid token of a role list", () => {
    expect(roleOf(elementOf('<div role="bogus switch"></div>'))).toBe("switch");
  });

  it("falls back to the implicit role when the explicit one is invalid", () => {
    expect(roleOf(elementOf('<button role="banana">Go</button>'))).toBe(
      "button",
    );
  });

  it("falls back to the implicit role for presentation and none", () => {
    expect(roleOf(elementOf('<table role="presentation"></table>'))).toBe(
      "table",
    );
    expect(roleOf(elementOf('<ul role="none"></ul>'))).toBe("list");
  });

  it("maps input types onto their control roles", () => {
    expect(roleOf(elementOf('<input type="checkbox">'))).toBe("checkbox");
    expect(roleOf(elementOf('<input type="radio">'))).toBe("radio");
    expect(roleOf(elementOf('<input type="submit">'))).toBe("button");
    expect(roleOf(elementOf('<input type="file">'))).toBe("button");
    expect(roleOf(elementOf('<input type="email">'))).toBe("textbox");
  });

  it("reads contenteditable as a textbox", () => {
    expect(roleOf(elementOf('<div contenteditable="true"></div>'))).toBe(
      "textbox",
    );
  });

  it("reads unknown wrappers as generic", () => {
    expect(roleOf(elementOf("<div></div>"))).toBe("generic");
    expect(roleOf(elementOf("<span></span>"))).toBe("generic");
  });

  it("maps semantic tags onto landmark and structure roles", () => {
    expect(roleOf(elementOf("<nav></nav>"))).toBe("navigation");
    expect(roleOf(elementOf("<h2>Title</h2>"))).toBe("heading");
    expect(roleOf(elementOf("<select></select>"))).toBe("combobox");
  });
});

describe("ariaLevelOf", () => {
  it("reads native heading levels", () => {
    const heading = elementOf("<h3>Three</h3>");
    expect(ariaLevelOf(heading, roleOf(heading))).toBe(3);
  });

  it("reads aria-level on level-bearing roles", () => {
    const heading = elementOf('<div role="heading" aria-level="4">Four</div>');
    expect(ariaLevelOf(heading, "heading")).toBe(4);
  });

  it("answers null for roles that carry no level", () => {
    const button = elementOf("<button>Go</button>");
    expect(ariaLevelOf(button, "button")).toBeNull();
  });
});

describe("ariaBooleanOf", () => {
  it("is a tri-state: true, false, and absent", () => {
    expect(ariaBooleanOf("true")).toBe(true);
    expect(ariaBooleanOf("TRUE")).toBe(true);
    expect(ariaBooleanOf("false")).toBe(false);
    expect(ariaBooleanOf("anything")).toBe(false);
    expect(ariaBooleanOf(null)).toBeUndefined();
  });
});
