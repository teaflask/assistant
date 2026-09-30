// @vitest-environment jsdom
// Rung 4 — the package default view (tool-views.md): the bounded,
// deterministic argument reading lifted out of the approval card. Its
// caps and its determinism are contract: two identical calls render
// byte-identical output, with no clocks and no locale; and it is an
// INPUT reading — a result on the call changes nothing (TVC-111: result
// UI stays authored, never inferred).

import { describe, expect, it } from "vitest";

import { reactToolView } from "../src/components/react-tool-view";
import { DefaultToolView } from "../src/components/tool-arguments-summary";
import type { ToolViewCall, ToolViewProps } from "../src/core/tool-view";

function propsOf(overrides: Partial<ToolViewCall> = {}): ToolViewProps {
  return {
    call: {
      toolName: "acme__create_ticket",
      toolCallId: "t1",
      status: "input-available",
      awaitingDecision: false,
      args: {
        subject: "Kettle whistles in B minor",
        customer: { email: "sam@acme.example", tier: "pro" },
        urgent: true,
      },
      ...overrides,
    },
    context: { themeMode: "light" },
  };
}

/** Renders through the canonical adapter form — the same lifecycle the
 *  slot drives — and returns the committed markup. */
function renderedHtmlOf(props: ToolViewProps): string {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const instance = reactToolView(DefaultToolView).mount(container, props);
  const html = container.innerHTML;
  instance.destroy();
  container.remove();
  return html;
}

describe("DefaultToolView", () => {
  it("renders byte-identical output for two identical calls", () => {
    const first = renderedHtmlOf(propsOf());
    const second = renderedHtmlOf(propsOf());
    expect(first).not.toBe("");
    expect(second).toBe(first);
  });

  it("orders fields deterministically — key order in the args object is irrelevant", () => {
    const shuffled = renderedHtmlOf(
      propsOf({
        args: {
          urgent: true,
          customer: { tier: "pro", email: "sam@acme.example" },
          subject: "Kettle whistles in B minor",
        },
      }),
    );
    expect(shuffled).toBe(renderedHtmlOf(propsOf()));
  });

  it("renders nothing for an argument-less call", () => {
    expect(renderedHtmlOf(propsOf({ args: {} }))).toBe("");
  });

  it("caps the visible rows and counts the hidden remainder honestly", () => {
    const args = Object.fromEntries(
      Array.from({ length: 11 }, (_, index) => [
        `field_${String(index)}`,
        index,
      ]),
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const instance = reactToolView(DefaultToolView).mount(
      container,
      propsOf({ args }),
    );
    expect(container.querySelectorAll("dt")).toHaveLength(8);
    expect(container.textContent).toContain("3 more fields");
    instance.destroy();
    container.remove();
  });

  it("is an input reading: a landed result changes nothing (the result-UI-stays-authored law)", () => {
    const withoutResult = renderedHtmlOf(propsOf());
    const withResult = renderedHtmlOf(
      propsOf({
        status: "output-available",
        result: { ticket_id: 99, status: "open" },
        resultText: '{"ticket_id":99,"status":"open"}',
      }),
    );
    expect(withResult).toBe(withoutResult);
  });
});

describe("the reading's one grammar (the tool-view card)", () => {
  it("DefaultToolView wears the shared card vocabulary: a hairline card, property rows, no height floor", () => {
    const html = renderedHtmlOf(propsOf());
    // The rung-4 reading is a property card like every other view
    // (tool-views/parts-classes.ts): hairline border on the card ground,
    // never a min-h floor (a card premise that never applied to a row).
    const sectionClass = /<section[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(html).toContain("data-tf-approval-request-summary");
    expect(sectionClass).toContain("tf:rounded-lg");
    expect(sectionClass).toContain("tf:border-tf-border");
    expect(sectionClass).toContain("tf:bg-tf-card");
    expect(sectionClass).not.toContain("min-h-24");
    expect(sectionClass).not.toContain("flex-1");
  });

  it("draws one hairline between the Request caption and the first field — on the list, never as a per-row override", () => {
    const html = renderedHtmlOf(propsOf());
    // The rows' first-child rule (tf:first:border-t-0) outranks any class
    // appended to the first row, so the hairline under the caption is
    // the LIST's border, itself suppressed only when the list opens the
    // card. Every row carries the plain row class.
    const listClass = /<dl[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(listClass).toContain("tf:border-t tf:border-tf-border");
    expect(listClass).toContain("tf:first:border-t-0");
    const rowClasses = [
      ...html.matchAll(/<div class="([^"]*tf:grid[^"]*)"/g),
    ].map((match) => match[1]);
    expect(rowClasses.length).toBeGreaterThan(0);
    for (const rowClass of rowClasses) {
      expect(rowClass.endsWith(" tf:border-t")).toBe(false);
      expect(rowClass).toContain("tf:first:border-t-0");
    }
  });
});
