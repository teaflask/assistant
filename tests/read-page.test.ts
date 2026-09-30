// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  readPageResultOf,
  _resetBaselinesForTests,
} from "../src/reader/read-page";
import { fakeLayoutProbeOf, type FakeLayoutProbe } from "./reader-fakes";

let probe: FakeLayoutProbe;

beforeEach(() => {
  probe = fakeLayoutProbeOf();
  _resetBaselinesForTests();
  document.body.innerHTML = "";
  document.title = "Billing — Teaflask";
});

describe("readPageResultOf", () => {
  it("delivers a full read with the page header on first read", () => {
    document.body.innerHTML = "<h1>Billing</h1><button>Pay now</button>";
    const report = readPageResultOf("thread-1", null, probe);
    expect(report.is_diff).toBe(false);
    expect(report.truncated).toBe(false);
    expect(report.title).toBe("Billing — Teaflask");
    expect(report.url).toContain("http");
    expect(report.content).toContain('# page: "Billing — Teaflask"');
    expect(report.content).toContain("# url:");
    expect(report.content).toContain('- heading "Billing"');
    expect(report.content).toContain('- button "Pay now"');
  });

  it("delivers a diff on a repeat read when the diff is shorter", () => {
    document.body.innerHTML = Array.from(
      { length: 40 },
      (_, i) => `<button>Action ${String(i)}</button>`,
    ).join("");
    readPageResultOf("thread-1", null, probe);
    const toast = document.createElement("div");
    toast.setAttribute("role", "alert");
    toast.textContent = "Payment failed";
    document.body.append(toast);
    const second = readPageResultOf("thread-1", null, probe);
    expect(second.is_diff).toBe(true);
    expect(second.content).toContain("@@");
    expect(second.content).toContain("+");
    expect(second.content).toContain("Payment failed");
    expect(second.content).not.toContain("Action 20");
  });

  it("delivers an empty diff when nothing changed", () => {
    document.body.innerHTML = "<h1>Quiet page</h1>".repeat(20);
    readPageResultOf("thread-1", null, probe);
    const second = readPageResultOf("thread-1", null, probe);
    expect(second.is_diff).toBe(true);
    expect(second.content).toBe("");
  });

  it("never diffs across scopes — twin regions must not read as unchanged", () => {
    document.body.innerHTML =
      '<section id="a"><h2>Pending invoices</h2></section>' +
      '<section id="b"><h2>Pending invoices</h2></section>';
    readPageResultOf("thread-1", { selector: "#a" }, probe);
    // Identically-rendered but different region: an inherited baseline
    // would produce the empty "nothing changed" diff here.
    const other = readPageResultOf("thread-1", { selector: "#b" }, probe);
    expect(other.is_diff).toBe(false);
    expect(other.content).toContain("Pending invoices");
    // A full read after a scoped one starts fresh too, never "removals".
    const full = readPageResultOf("thread-1", null, probe);
    expect(full.is_diff).toBe(false);
  });

  it("still diffs repeat reads of the same scope", () => {
    document.body.innerHTML =
      '<section id="a">' +
      Array.from(
        { length: 30 },
        (_, i) => `<button>Row action ${String(i)}</button>`,
      ).join("") +
      "</section>";
    readPageResultOf("thread-1", { selector: "#a" }, probe);
    const alert = document.createElement("div");
    alert.setAttribute("role", "alert");
    alert.textContent = "Row failed to save";
    requiredSection().append(alert);
    const repeat = readPageResultOf("thread-1", { selector: "#a" }, probe);
    expect(repeat.is_diff).toBe(true);
    expect(repeat.content).toContain("Row failed to save");
  });

  it("never diffs across a client-side navigation", () => {
    // navigate routes without a reload, so this module survives the page
    // change; two pages sharing shell chrome must not diff into "the old
    // page's content was removed".
    document.body.innerHTML =
      "<nav><a href='/billing'>Billing</a></nav><h1>Invoices</h1>".repeat(1) +
      Array.from(
        { length: 20 },
        (_, i) => `<button>Invoice row ${String(i)}</button>`,
      ).join("");
    readPageResultOf("thread-1", null, probe);
    window.history.pushState({}, "", "/settings");
    document.body.innerHTML =
      "<nav><a href='/billing'>Billing</a></nav><h1>Settings</h1>";
    const afterNavigation = readPageResultOf("thread-1", null, probe);
    expect(afterNavigation.is_diff).toBe(false);
    expect(afterNavigation.content).toContain("Settings");
  });

  it("never diffs across a ladder-rung shift — truncation is not removal", () => {
    // A deep chain the ladder can cut, plus ref-free filler tuned until
    // the full outline sits just under the cap. A small append then
    // pushes the same request onto a shallower rung; diffing across that
    // shift would report the depth-cut sections as removed.
    const deepChainHtml = (() => {
      let html = "<button>Deepest action</button>";
      for (let level = 35; level >= 1; level -= 1) {
        html = `<section aria-label="Level ${String(level)}">${html}</section>`;
      }
      return html;
    })();
    const fillerOf = (count: number): string =>
      Array.from(
        { length: count },
        (_, i) => `<h6>Stable filler row number ${String(i)}</h6>`,
      ).join("");
    // Grow the filler toward the cap, always undershooting (a filler line
    // costs under 60 door-chars), until one more heading would overflow —
    // leaving the full read under the cap by less than one line.
    let count = 200;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      document.body.innerHTML = deepChainHtml + fillerOf(count + 1);
      const probeRead = readPageResultOf(
        `tune-${String(attempt)}`,
        null,
        probe,
      );
      if (probeRead.truncated) {
        break; // count + 1 overflows, so count is the last full fit
      }
      const headroom = 16_000 - _doorCostOf(probeRead.content);
      count += Math.max(1, Math.floor(headroom / 60));
    }

    document.body.innerHTML = deepChainHtml + fillerOf(count);
    const first = readPageResultOf("rung-thread", null, probe);
    expect(first.truncated).toBe(false);

    document.body.innerHTML = deepChainHtml + fillerOf(count + 10);
    const second = readPageResultOf("rung-thread", null, probe);
    expect(second.truncated).toBe(true);
    expect(second.is_diff).toBe(false);
    expect(second.content).toContain("# page:");
  });

  it("keeps baselines apart per thread", () => {
    document.body.innerHTML = "<h1>Shared page</h1>".repeat(20);
    readPageResultOf("thread-1", null, probe);
    const otherThread = readPageResultOf("thread-2", null, probe);
    expect(otherThread.is_diff).toBe(false);
  });

  it("diffs against the new full tree even after delivering a diff", () => {
    document.body.innerHTML = Array.from(
      { length: 40 },
      (_, i) => `<button>Row ${String(i)}</button>`,
    ).join("");
    readPageResultOf("thread-1", null, probe);
    const first = document.createElement("h2");
    first.textContent = "First change";
    document.body.append(first);
    const diffOne = readPageResultOf("thread-1", null, probe);
    expect(diffOne.is_diff).toBe(true);
    const second = document.createElement("h2");
    second.textContent = "Second change";
    document.body.append(second);
    const diffTwo = readPageResultOf("thread-1", null, probe);
    expect(diffTwo.is_diff).toBe(true);
    const addedLines = diffTwo.content
      .split("\n")
      .filter((line) => line.startsWith("+"));
    // The first change is context now, never an addition again.
    expect(addedLines.join("\n")).toContain("Second change");
    expect(addedLines.join("\n")).not.toContain("First change");
  });

  it("degrades an oversized page and flags the truncation", () => {
    document.body.innerHTML =
      "<section>" +
      Array.from(
        { length: 900 },
        (_, i) =>
          `<button>A deliberately wordy action label number ${String(i)}</button>`,
      ).join("") +
      "</section>";
    const report = readPageResultOf("thread-1", null, probe);
    expect(report.truncated).toBe(true);
    expect(_doorCostOf(report.content)).toBeLessThanOrEqual(16_000);
  });

  it("keeps a shown ref resolvable when even the shallowest depth overflows", () => {
    // A deep target near the top (survives line-truncation, but sits below
    // the shallowest ladder rung) followed by enough flat content that
    // every rung overflows — the case where the fitter falls back to a
    // line-bounded full render. The ref it shows must match the registry.
    const deep =
      "<div>".repeat(8) +
      "<button>DeepTarget action</button>" +
      "</div>".repeat(8);
    const shallow = Array.from(
      { length: 400 },
      (_, i) => `<button>Wordy action label number ${String(i)}</button>`,
    ).join("");
    document.body.innerHTML = `<main>${deep}${shallow}</main>`;

    const report = readPageResultOf("trunc-thread", null, probe);
    expect(report.truncated).toBe(true);
    const ref = /- button "DeepTarget action" \[ref=(e\d+)\]/.exec(
      report.content,
    )?.[1];
    expect(ref).toBeDefined();

    const rooted = readPageResultOf("trunc-follow", { ref_id: ref }, probe);
    expect(rooted.content).toContain("DeepTarget action");
  });

  it("honors the interactive and selector knobs", () => {
    document.body.innerHTML =
      "<main id='m'><p>Wordy copy</p><button>Do it</button></main>" +
      "<footer><button>Elsewhere</button></footer>";
    const interactiveOnly = readPageResultOf(
      "thread-1",
      { interactive: true },
      probe,
    );
    expect(interactiveOnly.content).toContain("Do it");
    expect(interactiveOnly.content).not.toContain("- paragraph");
    const rooted = readPageResultOf("thread-2", { selector: "#m" }, probe);
    expect(rooted.content).toContain("Do it");
    expect(rooted.content).not.toContain("Elsewhere");
  });

  it("applies the wire's ignore selectors", () => {
    document.body.innerHTML =
      '<div class="private"><h2>Not for the model</h2></div><h2>Fine</h2>';
    const report = readPageResultOf(
      "thread-1",
      { ignore_selectors: [".private"] },
      probe,
    );
    expect(report.content).not.toContain("Not for the model");
    expect(report.content).toContain("Fine");
  });

  it("roots a repeat read at a remembered ref", () => {
    document.body.innerHTML =
      "<section><button>Target</button></section><button>Elsewhere</button>";
    const full = readPageResultOf("thread-1", null, probe);
    const ref = /\[ref=(e\d+)\] *$/m.exec(
      full.content.split("\n").find((line) => line.includes("Target")) ?? "",
    )?.[1];
    if (ref === undefined) {
      throw new Error("The full read minted no ref for the target.");
    }
    const rooted = readPageResultOf("thread-2", { ref_id: ref }, probe);
    expect(rooted.content).toContain("Target");
    expect(rooted.content).not.toContain("Elsewhere");
  });

  it("resolves a renamed ref the same way whether the subtree fits or overflows", () => {
    // The size-fitting ladder renders one read several times; a ref whose
    // element changed name since minting must not resolve on the first
    // render and be gone by the second — success cannot depend on size.
    document.body.innerHTML =
      '<section aria-label="Invoices">' +
      Array.from(
        { length: 900 },
        (_, i) =>
          `<button>A deliberately wordy invoice row action ${String(i)}</button>`,
      ).join("") +
      "</section>";
    const full = readPageResultOf("thread-1", null, probe);
    const ref = /- region "Invoices" \[ref=(e\d+)\]/.exec(full.content)?.[1];
    if (ref === undefined) {
      throw new Error("The full read minted no ref for the section.");
    }
    requiredSection().setAttribute("aria-label", "Invoices (42)");
    const rooted = readPageResultOf("thread-2", { ref_id: ref }, probe);
    expect(rooted.truncated).toBe(true);
    expect(rooted.content).toContain("invoice row action");
  });

  it("throws a model-actionable sentence for a stale ref", () => {
    document.body.innerHTML = "<button>Anything</button>";
    expect(() =>
      readPageResultOf("thread-1", { ref_id: "e424242" }, probe),
    ).toThrow(/fresh full read/);
  });

  it("drops wrong-typed knobs instead of failing the read", () => {
    document.body.innerHTML = "<button>Robust</button>";
    const report = readPageResultOf(
      "thread-1",
      {
        interactive: "yes",
        max_depth: "deep",
        ignore_selectors: [42, ".ok", null],
        selector: 7,
      },
      probe,
    );
    expect(report.content).toContain("Robust");
  });
});

function requiredSection(): Element {
  const section = document.querySelector("section");
  if (section === null) {
    throw new Error("The test HTML holds no section.");
  }
  return section;
}

function _doorCostOf(text: string): number {
  let cost = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    cost += code > 0x7f || code < 0x20 ? 6 : code === 34 || code === 92 ? 2 : 1;
  }
  return cost;
}
