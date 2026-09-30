// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { REDACTED_VALUE, textboxValueOf } from "../src/reader/redaction";

function firstBodyElement(): Element {
  const element = document.body.firstElementChild;
  if (element === null) {
    throw new Error("The test HTML produced no element.");
  }
  return element;
}

function inputOf(html: string): HTMLInputElement {
  document.body.innerHTML = html;
  const input = document.body.querySelector("input, textarea");
  if (input === null) {
    throw new Error("The test HTML produced no input.");
  }
  return input as HTMLInputElement;
}

describe("textboxValueOf", () => {
  it("passes an ordinary value through", () => {
    const input = inputOf('<input type="text">');
    input.value = "hello";
    expect(textboxValueOf(input)).toBe("hello");
  });

  it("redacts a password with a value and shows an empty one as empty", () => {
    const filled = inputOf('<input type="password">');
    filled.value = "hunter2";
    expect(textboxValueOf(filled)).toBe(REDACTED_VALUE);
    expect(textboxValueOf(inputOf('<input type="password">'))).toBe("");
  });

  it.each([
    "cc-number",
    "cc-csc",
    "cc-exp",
    "cc-exp-month",
    "cc-exp-year",
    "current-password",
    "new-password",
    "one-time-code",
  ])("redacts a field whose autocomplete declares %s", (autocomplete) => {
    const input = inputOf(`<input autocomplete="${autocomplete}">`);
    input.value = "4111111111111111";
    expect(textboxValueOf(input)).toBe(REDACTED_VALUE);
  });

  it("redacts when the secret token rides in an autocomplete list", () => {
    const input = inputOf('<input autocomplete="billing cc-number">');
    input.value = "4111111111111111";
    expect(textboxValueOf(input)).toBe(REDACTED_VALUE);
  });

  it("leaves harmless autocomplete values readable", () => {
    const input = inputOf('<input autocomplete="email">');
    input.value = "tea@example.com";
    expect(textboxValueOf(input)).toBe("tea@example.com");
  });

  it("never surfaces a hidden input's value, even a token-bearing one", () => {
    const hidden = inputOf('<input type="hidden" name="csrf">');
    hidden.value = "a1b2c3-secret-csrf-token";
    expect(textboxValueOf(hidden)).toBeNull();
  });

  it("answers null for value-less controls", () => {
    expect(textboxValueOf(inputOf('<input type="checkbox">'))).toBeNull();
    expect(textboxValueOf(inputOf('<input type="radio">'))).toBeNull();
    expect(textboxValueOf(inputOf('<input type="file">'))).toBeNull();
    document.body.innerHTML = "<div>Not a control</div>";
    expect(textboxValueOf(firstBodyElement())).toBeNull();
  });

  it("reads a contenteditable region's text", () => {
    document.body.innerHTML = '<div contenteditable="true">Draft text</div>';
    expect(textboxValueOf(firstBodyElement())).toBe("Draft text");
  });
});
