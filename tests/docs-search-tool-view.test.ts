// @vitest-environment jsdom
// teaflask.docs-search — the package built-in for the docs_search tool.
// It parses the tool's own rendered hit format (docs_search.py) into a
// scannable list and renders anything else verbatim; a not-run or
// degraded settle never wears the list.

import { describe, expect, it } from "vitest";

import {
  docsSearchHitsOf,
  docsSearchToolView,
} from "../src/components/tool-views/docs-search-view";
import type { ToolViewCall, ToolViewProps } from "../src/core/tool-view";

// The producer's format, verbatim (docs_search.py::_render_hit): a
// headline line, an optional facts line, then the section text; hits
// are separated by a blank line. A section's text is the chunker's
// blocks rejoined with blank lines (mdv1_chunker.py), so a hit's own
// content carries blank lines too.
const TWO_HITS = [
  "[refunds#eligibility] Refunds › Eligibility",
  "Updated: 2026-09-01 · Verified: 2026-09-03",
  "Orders older than 30 days are not eligible.",
  "",
  "Contact support to start one.",
  "",
  "[shipping#] Shipping",
  "We ship to 40 countries.\nDelivery takes 3–5 days.",
].join("\n");

function propsOf(overrides: Partial<ToolViewCall> = {}): ToolViewProps {
  return {
    call: {
      toolName: "docs_search",
      toolCallId: "t1",
      status: "output-available",
      awaitingDecision: false,
      args: { query: "refund window" },
      resultText: TWO_HITS,
      ...overrides,
    },
    context: { themeMode: "light" },
  };
}

function mounted(props: ToolViewProps): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  docsSearchToolView.mount(container, props);
  return container;
}

describe("docsSearchHitsOf", () => {
  it("parses the producer's format — slug, anchor, title, heading, facts, text — splitting only where a blank line meets a headline", () => {
    expect(docsSearchHitsOf(TWO_HITS)).toEqual([
      {
        slug: "refunds",
        anchor: "eligibility",
        title: "Refunds",
        heading: "Eligibility",
        facts: "Updated: 2026-09-01 · Verified: 2026-09-03",
        content:
          "Orders older than 30 days are not eligible.\n\nContact support to start one.",
      },
      {
        slug: "shipping",
        anchor: "",
        title: "Shipping",
        heading: null,
        facts: null,
        content: "We ship to 40 countries.\nDelivery takes 3–5 days.",
      },
    ]);
  });

  it("keeps a multi-paragraph section as one hit — a blank line alone is content, never a boundary", () => {
    const hits = docsSearchHitsOf(
      "[a#b] Ok\n\nnot a headline\ntext\n\n[refunds#] Refunds\n\n",
    );
    expect(hits?.map((hit) => hit.slug)).toEqual(["a", "refunds"]);
    expect(hits?.[0]?.content).toBe("\nnot a headline\ntext");
    expect(hits?.[1]?.content).toBe("\n");
  });

  it("splits title from heading at the LAST separator — a title may carry the glyph itself", () => {
    const hits = docsSearchHitsOf(
      "[a#b] Brew › Steep › Timing › Sencha\ntext\n\n[c#] Ship › Rates\ntext",
    );
    expect(hits?.[0]).toMatchObject({
      title: "Brew › Steep › Timing",
      heading: "Sencha",
    });
    expect(hits?.[1]).toMatchObject({ title: "Ship", heading: "Rates" });
    expect(docsSearchHitsOf("[d#] Plain title\ntext")?.[0]).toMatchObject({
      title: "Plain title",
      heading: null,
    });
  });

  it("returns null for text that does not open with a headline, so the view renders it verbatim", () => {
    expect(docsSearchHitsOf("Some prose the tool never emits.")).toBeNull();
    expect(docsSearchHitsOf("")).toBeNull();
    expect(docsSearchHitsOf("intro\n\n[a#b] Ok\ntext")).toBeNull();
  });
});

describe("the docs-search view", () => {
  it("renders the query as the card title and one document row per hit — title, heading and address, excerpt", () => {
    const container = mounted(propsOf());
    const text = container.textContent;
    expect(text).toContain("Results for “refund window”");
    expect(text).not.toContain("Updated");
    expect(
      container.querySelectorAll("[data-tf-docs-search-hit]"),
    ).toHaveLength(2);
    expect(text).toContain("Refunds");
    expect(text).toContain("Eligibility · refunds");
    expect(text).not.toContain("refunds#eligibility");
    expect(container.querySelectorAll("svg")).toHaveLength(2);
    expect(text).toContain("Orders older than 30 days");
    expect(text).toContain("Contact support to start one.");
    expect(text).toContain("shipping");
  });

  it("says no sections matched, in its own words, for the producer's no-hits sentence", () => {
    const container = mounted(
      propsOf({ resultText: "No documentation sections matched this query." }),
    );
    expect(container.textContent).toContain("No sections matched");
    expect(container.querySelector("[data-tf-docs-search-hit]")).toBeNull();
  });

  it("renders text outside the format verbatim instead of guessing a list — the pane inset inside the card", () => {
    const container = mounted(
      propsOf({ resultText: "Search is unavailable." }),
    );
    expect(container.textContent).toContain("Search is unavailable.");
    expect(container.textContent).not.toContain("matched");
    const inset = container.querySelector("[data-tf-tool-view-card] > div");
    expect(inset?.className).toContain("tf:px-2.5");
    expect(inset?.className).toContain("tf:first:border-t-0");
    expect(inset?.querySelector("pre")).not.toBeNull();
    // One label-to-pane rhythm: the card title names the results, the
    // pane's label names the record — "Results" appears once.
    expect(container.textContent.match(/Results/g)).toHaveLength(1);
    expect(container.textContent).toContain("As recorded");
    expect(inset?.querySelector("p")?.textContent).toBe("As recorded");
  });

  it("reads the consent while a gated call awaits the member: the query as a proposal row with the wait as its badge, no bones", () => {
    for (const status of ["input-streaming", "input-available"] as const) {
      const container = mounted(
        propsOf({ status, awaitingDecision: true, resultText: undefined }),
      );
      const proposal = container.querySelector(
        "[data-tf-docs-search-proposal]",
      );
      expect(proposal?.textContent, status).toContain("“refund window”");
      expect(proposal?.textContent).toContain("Search your docs");
      expect(proposal?.textContent).toContain("Awaiting your decision");
      expect(container.querySelector("[aria-hidden='true']")).toBeNull();
      expect(
        container.querySelector("[data-tf-tool-view-card]"),
      ).not.toBeNull();
      expect(container.querySelector("button")).toBeNull();
    }
    // Without a query yet, the proposal still names what is asked.
    const bare = mounted(
      propsOf({
        status: "input-available",
        awaitingDecision: true,
        args: {},
        resultText: undefined,
      }),
    );
    expect(bare.textContent).toContain("Documentation search");
    expect(bare.querySelector("[aria-hidden='true']")).toBeNull();
  });

  it("renders the query over skeleton rows while running", () => {
    for (const status of ["input-streaming", "input-available"] as const) {
      const container = mounted(propsOf({ status, resultText: undefined }));
      expect(container.textContent).toContain("“refund window”");
      expect(container.textContent).not.toContain("matched");
      expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
      expect(container.querySelector("[data-tf-docs-search-hit]")).toBeNull();
    }
  });

  it("degrades the title to a bare “Results” when the query is absent or wrong-typed — over the skeleton and over the card", () => {
    for (const args of [{}, { query: 7 }]) {
      const running = mounted(
        propsOf({ args, status: "input-available", resultText: undefined }),
      );
      expect(running.textContent).toContain("Results");
      expect(running.textContent).not.toContain("Results for");
      const settled = mounted(propsOf({ args }));
      expect(settled.textContent).toContain("Results");
      expect(settled.textContent).not.toContain("Results for");
      expect(
        settled.querySelectorAll("[data-tf-docs-search-hit]"),
      ).toHaveLength(2);
    }
  });

  it("wears the honesty note and no list on every not-run settle", () => {
    const expected = {
      refused: "Declined",
      "output-error": "Failed",
      denied: "Not approved",
      cancelled: "didn't run",
      superseded: "Interrupted",
    } as const;
    for (const [status, word] of Object.entries(expected)) {
      const container = mounted(
        propsOf({
          status: status as ToolViewCall["status"],
          resultText: undefined,
        }),
      );
      expect(container.textContent, status).toContain(word);
      expect(container.querySelector("[data-tf-docs-search-hit]")).toBeNull();
    }
  });

  it("refuses to structure a truncated or offloaded record", () => {
    const truncated = mounted(propsOf({ truncated: true }));
    expect(truncated.textContent).toContain("incomplete");
    expect(truncated.querySelector("[data-tf-docs-search-hit]")).toBeNull();
    const offloaded = mounted(propsOf({ offloaded: true }));
    expect(offloaded.textContent).toContain("shortened preview");
    expect(offloaded.querySelector("[data-tf-docs-search-hit]")).toBeNull();
  });

  it("offers no decision affordance", () => {
    const container = mounted(propsOf({ awaitingDecision: true }));
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
  });
});
