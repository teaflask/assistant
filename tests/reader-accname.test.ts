// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { accessibleNameOf } from "../src/reader/accessible-name";
import { fakeLayoutProbeOf, type FakeLayoutProbe } from "./reader-fakes";

let probe: FakeLayoutProbe;

beforeEach(() => {
  probe = fakeLayoutProbeOf();
  document.body.innerHTML = "";
});

function nameOf(element: Element): string {
  return accessibleNameOf(element, probe, new Map());
}

function firstElement(html: string): Element {
  document.body.innerHTML = html;
  const element = document.body.firstElementChild;
  if (element === null) {
    throw new Error("The test HTML produced no element.");
  }
  return element;
}

describe("accessibleNameOf", () => {
  it("prefers aria-labelledby over everything else", () => {
    document.body.innerHTML =
      '<span id="l1">Send</span><span id="l2">now</span>' +
      '<button aria-labelledby="l1 l2" aria-label="Ignored">Also ignored</button>';
    const button = document.querySelector("button");
    expect(button).not.toBeNull();
    expect(nameOf(button as Element)).toBe("Send now");
  });

  it("prefers aria-label over content", () => {
    expect(nameOf(firstElement('<button aria-label="Close">×</button>'))).toBe(
      "Close",
    );
  });

  it("reads a label wired with for=", () => {
    document.body.innerHTML =
      '<label for="mail">Email address</label><input id="mail">';
    const input = document.querySelector("input");
    expect(nameOf(input as Element)).toBe("Email address");
  });

  it("resolves a for= label through a selector-hostile id", () => {
    const label = document.createElement("label");
    label.textContent = "Card holder";
    label.setAttribute("for", 'weird"id\\');
    const input = document.createElement("input");
    input.setAttribute("id", 'weird"id\\');
    document.body.append(label, input);
    expect(nameOf(input)).toBe("Card holder");
  });

  it("never lets an unselectable id break the read", () => {
    const input = document.createElement("input");
    input.setAttribute("id", "trailing\\");
    document.body.append(input);
    expect(() => nameOf(input)).not.toThrow();
  });

  it("reads an enclosing label", () => {
    document.body.innerHTML = "<label>Remember me<input></label>";
    const input = document.querySelector("input");
    expect(nameOf(input as Element)).toBe("Remember me");
  });

  it("counts a label that both wraps and references its control once", () => {
    document.body.innerHTML =
      '<label for="mail">Email<input id="mail"></label>';
    const input = document.querySelector("input");
    expect(nameOf(input as Element)).toBe("Email");
  });

  it("reads alt text, and honors an empty alt as decorative", () => {
    expect(nameOf(firstElement('<img alt="Team photo">'))).toBe("Team photo");
    expect(nameOf(firstElement('<img alt="" title="Never seen">'))).toBe("");
  });

  it("names a fieldset from its legend", () => {
    expect(
      nameOf(
        firstElement("<fieldset><legend>Shipping</legend><input></fieldset>"),
      ),
    ).toBe("Shipping");
  });

  it("names content roles from their contents, across nested spans", () => {
    expect(
      nameOf(
        firstElement("<button><span>Save</span> <span>all</span></button>"),
      ),
    ).toBe("Save all");
  });

  it("weaves pseudo-element text into a content name", () => {
    const link = firstElement('<a href="/next">Next</a>');
    probe.setPseudoContent(link, "::after", " →");
    expect(nameOf(link)).toBe("Next →");
  });

  it("skips hidden parts of a content name", () => {
    const button = firstElement(
      "<button><span>Visible</span><span>Hidden</span></button>",
    );
    const hidden = button.children[1];
    probe.setStyle(hidden, { display: "none" });
    expect(nameOf(button)).toBe("Visible");
  });

  it("still reads hidden elements referenced by aria-labelledby", () => {
    document.body.innerHTML =
      '<span id="hint">Offscreen label</span><button aria-labelledby="hint">x</button>';
    const hint = document.getElementById("hint");
    probe.setStyle(hint as Element, { display: "none" });
    const button = document.querySelector("button");
    expect(nameOf(button as Element)).toBe("Offscreen label");
  });

  it("gives anonymous wrappers no name at all", () => {
    expect(nameOf(firstElement("<div>Plenty of text</div>"))).toBe("");
    expect(nameOf(firstElement("<p>Paragraph text</p>"))).toBe("");
  });

  it("falls back to submit values, placeholders, then titles", () => {
    expect(nameOf(firstElement('<input type="submit" value="Send it">'))).toBe(
      "Send it",
    );
    expect(nameOf(firstElement('<input placeholder="Search docs">'))).toBe(
      "Search docs",
    );
    expect(nameOf(firstElement('<button title="Settings"></button>'))).toBe(
      "Settings",
    );
  });

  it("collapses whitespace and caps the name at 300 characters", () => {
    const longText = "word ".repeat(120);
    const name = nameOf(firstElement(`<button>  ${longText}  </button>`));
    expect(name.length).toBe(300);
    expect(name.startsWith("word word")).toBe(true);
  });

  it("survives an aria-labelledby cycle", () => {
    document.body.innerHTML =
      '<button id="a" aria-labelledby="b">A</button>' +
      '<button id="b" aria-labelledby="a">B</button>';
    const a = document.getElementById("a");
    expect(() => nameOf(a as Element)).not.toThrow();
  });
});
