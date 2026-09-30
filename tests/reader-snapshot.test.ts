// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { renderedTreeOf } from "../src/reader/render";
import {
  DEFAULT_MAX_DEPTH,
  IGNORE_ATTRIBUTE,
  snapshotTreeOf,
  type SnapshotOptions,
} from "../src/reader/snapshot";
import { fakeLayoutProbeOf, type FakeLayoutProbe } from "./reader-fakes";

let probe: FakeLayoutProbe;

beforeEach(() => {
  probe = fakeLayoutProbeOf();
  document.body.innerHTML = "";
});

function requiredElement(selector: string): Element {
  const element = document.querySelector(selector);
  if (element === null) {
    throw new Error(`The test HTML holds no "${selector}".`);
  }
  return element;
}

function optionsOf(overrides: Partial<SnapshotOptions> = {}): SnapshotOptions {
  return {
    probe,
    ignoreSelectors: [],
    maxDepth: DEFAULT_MAX_DEPTH,
    interactive: false,
    showHidden: false,
    selector: null,
    refId: null,
    rootElement: null,
    ...overrides,
  };
}

function renderedPage(overrides: Partial<SnapshotOptions> = {}): string {
  const outcome = snapshotTreeOf(optionsOf(overrides));
  if (outcome.error !== null) {
    throw new Error(outcome.error);
  }
  return renderedTreeOf(outcome.tree);
}

describe("the snapshot walk", () => {
  it("keeps meaningful elements and drops anonymous wrappers", () => {
    document.body.innerHTML =
      '<div class="wrapper"><div class="inner">' +
      "<h1>Billing</h1><button>Pay now</button></div></div>" +
      "<div><span>plain text</span></div>";
    const tree = renderedPage();
    expect(tree).toContain('- heading "Billing"');
    expect(tree).toContain('- button "Pay now"');
    expect(tree).not.toContain("wrapper");
    expect(tree).toContain('- text: "plain text"');
  });

  it("marks heuristically clickable elements with their signals", () => {
    document.body.innerHTML =
      '<div onclick="void 0">Open menu</div><div tabindex="0">Focusable</div>';
    const tree = renderedPage();
    expect(tree).toContain("[onclick]");
    expect(tree).toContain("[tabindex]");
  });

  it("flags cursor:pointer but suppresses it under a clickable parent", () => {
    document.body.innerHTML =
      '<div id="card"><span id="inner">Row text</span></div>';
    const card = document.getElementById("card") as Element;
    const inner = document.getElementById("inner") as Element;
    probe.setStyle(card, { cursor: "pointer" });
    probe.setStyle(inner, { cursor: "pointer" });
    const tree = renderedPage();
    const cardLines = tree
      .split("\n")
      .filter((line) => line.includes("cursor:pointer"));
    expect(cardLines).toHaveLength(1);
  });

  it("prunes a subtree carrying the ignore attribute", () => {
    document.body.innerHTML =
      `<div ${IGNORE_ATTRIBUTE}><button>Secret admin action</button></div>` +
      "<button>Public action</button>";
    const tree = renderedPage();
    expect(tree).not.toContain("Secret admin action");
    expect(tree).toContain("Public action");
  });

  it("prunes subtrees matching a configured ignore selector", () => {
    document.body.innerHTML =
      '<section class="pii-panel"><h2>Other users</h2></section><h2>Mine</h2>';
    const tree = renderedPage({ ignoreSelectors: [".pii-panel"] });
    expect(tree).not.toContain("Other users");
    expect(tree).toContain("Mine");
  });

  it("never lets an invalid ignore selector break a read", () => {
    document.body.innerHTML = "<button>Still here</button>";
    const tree = renderedPage({ ignoreSelectors: ["::not-a-selector!!"] });
    expect(tree).toContain("Still here");
  });

  it("filters invisible elements, unless show_hidden asks for them", () => {
    document.body.innerHTML =
      '<button id="gone">Dismissed toast</button><button>Live</button>';
    probe.setStyle(document.getElementById("gone") as Element, {
      display: "none",
    });
    expect(renderedPage()).not.toContain("Dismissed toast");
    const withHidden = renderedPage({ showHidden: true });
    expect(withHidden).toContain("Dismissed toast");
    expect(withHidden).toContain("[hidden]");
  });

  it("treats aria-hidden as covering the whole subtree", () => {
    document.body.innerHTML =
      '<div aria-hidden="true"><button>Decoy buy</button>decoy text</div>' +
      "<button>Real</button>";
    const tree = renderedPage();
    // The wrapper's aria-hidden hides its descendants too — a default
    // read must not surface the decoy as a live control.
    expect(tree).not.toContain("Decoy buy");
    expect(tree).not.toContain("decoy text");
    expect(tree).toContain('- button "Real"');
    const withHidden = renderedPage({ showHidden: true });
    const decoyLine = withHidden
      .split("\n")
      .find((line) => line.includes("Decoy buy"));
    expect(decoyLine).toContain("[hidden]");
  });

  it("show_hidden surfaces hidden text and structure, not just controls", () => {
    document.body.innerHTML =
      '<div role="alert" id="toast">Session expired</div>' +
      '<nav id="menu" aria-label="Admin">Hidden menu</nav>' +
      "<button>Live</button>";
    probe.setStyle(document.getElementById("toast") as Element, {
      display: "none",
    });
    probe.setStyle(document.getElementById("menu") as Element, {
      display: "none",
    });
    expect(renderedPage()).not.toContain("Session expired");
    const withHidden = renderedPage({ showHidden: true });
    // The knob's whole point: hidden ref-less content stays, marked.
    expect(withHidden).toContain('- alert [hidden]: "Session expired"');
    expect(withHidden).toContain("- navigation [hidden]");
  });

  it("keeps a hidden branded checkbox in the tree", () => {
    document.body.innerHTML =
      '<label>Subscribe<input type="checkbox" id="real" checked></label>';
    probe.setStyle(document.getElementById("real") as Element, {
      display: "none",
    });
    const tree = renderedPage();
    expect(tree).toContain("- checkbox");
    expect(tree).toContain("[checked]");
  });

  it("marks visible elements outside the viewport as offscreen", () => {
    document.body.innerHTML =
      '<button id="below">Load more</button><button>Above the fold</button>';
    probe.setRect(document.getElementById("below") as Element, {
      top: 2000,
      bottom: 2020,
    });
    const tree = renderedPage();
    const belowLine = tree
      .split("\n")
      .find((line) => line.includes("Load more"));
    expect(belowLine).toContain("[offscreen]");
    expect(
      tree.split("\n").find((line) => line.includes("Above the fold")),
    ).not.toContain("[offscreen]");
  });

  it("walks shadow DOM content", () => {
    document.body.innerHTML = "<div id='host'></div>";
    const host = requiredElement("#host");
    const shadow = host.attachShadow({ mode: "open" });
    const button = document.createElement("button");
    button.textContent = "Shadow action";
    shadow.append(button);
    expect(renderedPage()).toContain('- button "Shadow action"');
  });

  it("renders an iframe as a leaf and never walks into it", () => {
    document.body.innerHTML =
      '<iframe title="Payment form" srcdoc="<button>Inside</button>"></iframe>';
    const tree = renderedPage();
    expect(tree).toContain('- iframe "Payment form"');
    expect(tree).not.toContain("Inside");
  });

  it("seeds a textbox with its (redacted) value", () => {
    document.body.innerHTML =
      '<label>Email<input id="mail"></label>' +
      '<label>Password<input id="pw" type="password"></label>';
    (document.getElementById("mail") as HTMLInputElement).value =
      "tea@example.com";
    (document.getElementById("pw") as HTMLInputElement).value = "hunter2";
    const tree = renderedPage();
    expect(tree).toContain('"tea@example.com"');
    expect(tree).toContain("[redacted]");
    expect(tree).not.toContain("hunter2");
  });

  it("folds a lone text child that repeats the node's name", () => {
    document.body.innerHTML = "<button>Send</button>";
    const tree = renderedPage();
    expect(tree).toContain('- button "Send"');
    expect(tree).not.toContain('- button "Send": "Send"');
  });

  it("merges inline fragments without doubling their boundary space", () => {
    document.body.innerHTML = "<h1>Welcome <strong>back</strong></h1>";
    const tree = renderedPage();
    // The text fragment already carries its boundary space; a second one
    // would defeat the repeats-the-name dedup and leave a noisy child.
    expect(tree).toContain('- heading "Welcome back" [level=1]');
    expect(tree).not.toContain("Welcome  back");
    expect(tree).not.toContain('[level=1]: "Welcome');
  });

  it("renders select options inline with the selection marked", () => {
    document.body.innerHTML =
      "<select><option>Small</option><option selected>Medium</option>" +
      '<option value="lg">Large</option></select>';
    const tree = renderedPage();
    expect(tree).toContain('- option "Small"');
    expect(tree).toContain('- option "Medium" (selected)');
    expect(tree).toContain('- option "Large" value="lg"');
  });

  it("does not fold option text into an unlabeled select's own name", () => {
    document.body.innerHTML =
      "<select><option>Small</option><option>Medium</option></select>";
    const tree = renderedPage();
    // The walk must not descend into the select and adopt its options as
    // the combobox's name — the options render on their own lines.
    expect(tree).not.toContain('combobox "Small Medium"');
    expect(tree).toContain('- option "Small"');
    expect(tree).toContain('- option "Medium"');
  });

  it("never surfaces a hidden input's value, even under show_hidden", () => {
    document.body.innerHTML =
      '<form><input type="hidden" name="csrf" value="tok-abc123-secret"></form>';
    const tree = renderedPage({ showHidden: true });
    expect(tree).not.toContain("tok-abc123-secret");
  });

  it("keeps every contenteditable form in an interactive-only read", () => {
    document.body.innerHTML =
      '<div contenteditable id="bare">Draft one</div>' +
      '<div contenteditable="plaintext-only" id="plain">Draft two</div>' +
      '<div contenteditable="true" id="explicit">Draft three</div>';
    const tree = renderedPage({ interactive: true });
    expect(tree).toContain("Draft one");
    expect(tree).toContain("Draft two");
    expect(tree).toContain("Draft three");
  });

  it("emits a content-named leaf's text once in an interactive read", () => {
    document.body.innerHTML =
      "<ul><li>Item one</li></ul><table><tr><td>Cell text</td></tr></table>";
    const tree = renderedPage({ interactive: true });
    // The hoisted name already carries the leaf's text; descending too
    // would double it ("Item one Item one").
    expect(tree).toContain("Item one");
    expect(tree).not.toContain("Item one Item one");
    expect(tree).not.toContain("Cell text Cell text");
  });

  it("keeps interactive mode to controls, landmarks, and loose text", () => {
    document.body.innerHTML =
      "<p>A long marketing paragraph.</p><button>Sign up</button><nav>Menu</nav>";
    const tree = renderedPage({ interactive: true });
    expect(tree).toContain('- button "Sign up"');
    expect(tree).toContain("- navigation");
    // The paragraph node itself is filtered; its text survives as a
    // loose string so the terse view still reads coherently.
    expect(tree).not.toContain("- paragraph");
    expect(tree).toContain('- text: "A long marketing paragraph."');
  });

  it("respects max_depth", () => {
    document.body.innerHTML =
      "<section><article><button>Deep action</button></article></section>";
    expect(renderedPage()).toContain("Deep action");
    expect(renderedPage({ maxDepth: 1 })).not.toContain("Deep action");
  });
});

describe("ref stability", () => {
  it("keeps an unchanged element's ref across snapshots", () => {
    document.body.innerHTML = "<button>Stable</button>";
    const first = renderedPage();
    const second = renderedPage();
    const refOf = (tree: string): string => {
      const match = /\[ref=(e\d+)\]/.exec(tree);
      if (match === null) {
        throw new Error(`No ref in tree:\n${tree}`);
      }
      return match[1];
    };
    expect(refOf(second)).toBe(refOf(first));
  });

  it("mints a fresh ref when the element's name changes", () => {
    document.body.innerHTML = "<button>Before</button>";
    const first = renderedPage();
    const button = requiredElement("button");
    button.textContent = "After";
    const second = renderedPage();
    const refOf = (tree: string): string =>
      /\[ref=(e\d+)\]/.exec(tree)?.[1] ?? "";
    expect(refOf(second)).not.toBe(refOf(first));
  });
});

describe("snapshot rooting", () => {
  it("roots at a selector match", () => {
    document.body.innerHTML =
      '<aside><button>Sidebar</button></aside><main id="m"><button>Main</button></main>';
    const tree = renderedPage({ selector: "#m" });
    expect(tree).toContain("Main");
    expect(tree).not.toContain("Sidebar");
  });

  it("finds implicit roles for [role=…] selectors", () => {
    document.body.innerHTML = "<button>Implicit</button>";
    const tree = renderedPage({ selector: '[role="button"]' });
    expect(tree).toContain("Implicit");
  });

  it("answers a readable error for a selector that matches nothing", () => {
    document.body.innerHTML = "<button>Whatever</button>";
    const outcome = snapshotTreeOf(optionsOf({ selector: "#missing" }));
    expect(outcome.error).toContain('"#missing"');
  });

  it("refuses to root inside a curated region — curation covers descendants", () => {
    document.body.innerHTML =
      '<div class="private"><h2 id="inside">Other customers PII</h2></div>';
    const bySelector = snapshotTreeOf(
      optionsOf({ selector: ".private h2", ignoreSelectors: [".private"] }),
    );
    expect(bySelector.error).toContain("opted out of page reads");

    document.body.innerHTML = `<div ${IGNORE_ATTRIBUTE}><h2 id="inside">Attribute-opted-out PII</h2></div>`;
    const byAttribute = snapshotTreeOf(optionsOf({ selector: "#inside" }));
    expect(byAttribute.error).toContain("opted out of page reads");
  });

  it("refuses a remembered ref whose region opted out after it was minted", () => {
    document.body.innerHTML =
      "<section id='wrap'><button>Target</button></section>";
    const full = renderedPage();
    const ref = /- button "Target" \[ref=(e\d+)\]/.exec(full)?.[1];
    if (ref === undefined) {
      throw new Error("The full read minted no ref for the target.");
    }
    requiredElement("#wrap").setAttribute(IGNORE_ATTRIBUTE, "");
    const rooted = snapshotTreeOf(optionsOf({ refId: ref }));
    expect(rooted.error).toContain("opted out of page reads");
  });

  it("roots at a previously-minted ref, and errors on a stale one", () => {
    document.body.innerHTML =
      "<section><button>Target</button></section><button>Elsewhere</button>";
    const full = renderedPage();
    const targetRef = full
      .split("\n")
      .find((line) => line.includes("Target"))
      ?.match(/\[ref=(e\d+)\]/)?.[1];
    if (targetRef === undefined) {
      throw new Error("The full read minted no ref for the target.");
    }
    const rooted = renderedPage({ refId: targetRef });
    expect(rooted).toContain("Target");
    expect(rooted).not.toContain("Elsewhere");

    const stale = snapshotTreeOf(optionsOf({ refId: "e999999" }));
    expect(stale.error).toContain("fresh full read");
  });
});
