// @vitest-environment jsdom
// teaflask.action — the package built-in for every action__{slug} tool.
// It renders the recorded call alone: the three-key request envelope
// from the args, and the response — status included, non-2xx included —
// recovered from resultText, because the core unwrapper deliberately
// hands call.result the body alone. Method and path template are NOT in
// the call's bounded props and are deliberately not shown.

import { describe, expect, it } from "vitest";

import { actionToolView } from "../src/components/tool-views/action-view";
import { toolCallPresentationOf } from "../src/core/tool-call-presentation";
import type { ToolViewCall, ToolViewProps } from "../src/core/tool-view";

// The adapter's REAL result shape (round-4 finding 2): _intentResultOf
// (transport/actions-adapter.ts) builds exactly {status, body,
// truncated} — the wire's optional `headers` is never populated, so
// posing it here would test a shape production cannot emit.
const ENVELOPE_200 = JSON.stringify({
  ok: true,
  result: {
    status: 200,
    body: { refund_id: "r_1", amount: 1200 },
    truncated: false,
  },
});

function propsOf(overrides: Partial<ToolViewCall> = {}): ToolViewProps {
  return {
    call: {
      toolName: "action__issue-refund",
      toolCallId: "t1",
      status: "output-available",
      awaitingDecision: false,
      args: {
        path_params: { order_id: "o_77" },
        query: { notify: true },
        body: { amount: 1200, reason: "damaged" },
      },
      resultText: ENVELOPE_200,
      result: { refund_id: "r_1", amount: 1200 },
      ...overrides,
    },
    context: { themeMode: "light" },
  };
}

function mounted(props: ToolViewProps): {
  container: HTMLElement;
  update: (next: ToolViewProps) => void;
  destroy: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const instance = actionToolView.mount(container, props);
  return {
    container,
    update: (next) => {
      instance.update(next);
    },
    destroy: () => {
      instance.destroy();
      container.remove();
    },
  };
}

describe("actionToolView — the request reading", () => {
  it("renders each recorded request section as its own labeled pane, and no method or path", () => {
    const { container, destroy } = mounted(propsOf());
    const text = container.textContent;
    expect(text).toContain("Path parameters");
    expect(text).toContain("o_77");
    expect(text).toContain("Query");
    expect(text).toContain("notify");
    expect(text).toContain("Body");
    expect(text).toContain("damaged");
    // The recorded call carries no method or path template — the view
    // must not invent them (tool-views.md: no privileged data).
    expect(text).not.toMatch(/GET|POST|PUT|PATCH|DELETE/);
    destroy();
  });

  it("renders an argument-less mid-stream call as a quiet empty frame", () => {
    const { container, destroy } = mounted(
      propsOf({
        status: "input-streaming",
        args: {},
        result: undefined,
        resultText: undefined,
      }),
    );
    expect(container.querySelectorAll("pre")).toHaveLength(0);
    destroy();
  });
});

describe("actionToolView — the response reading (three shapes and the honesty arms)", () => {
  it("shape 1 — a 2xx with a JSON body: quiet status line plus the body pane", () => {
    const { container, destroy } = mounted(propsOf());
    const status = container.querySelector<HTMLElement>(
      "[data-tf-action-status]",
    );
    expect(status?.textContent).toBe("HTTP 200");
    expect(status?.className).not.toContain("text-tf-destructive");
    expect(container.textContent).toContain("refund_id");
    destroy();
  });

  it("an empty record section renders no pane; an empty ARRAY body still renders", () => {
    // An empty record is the absence the argument ledger describes
    // (round-4 finding 4) — a labeled pane over "{}" is a content-free
    // frame. "[]" is different: a JSON body the endpoint received.
    const { container, destroy } = mounted(
      propsOf({
        args: { path_params: {}, query: {}, body: [] },
        result: undefined,
        resultText: undefined,
        status: "input-available",
      }),
    );
    expect(container.textContent).not.toContain("Path parameters");
    expect(container.textContent).not.toContain("Query");
    expect(container.textContent).toContain("Body");
    expect(container.textContent).toContain("[]");
    destroy();
  });

  it("a non-record body — an array, a scalar — wears the rows' own card-child grammar: the hairline above, the rows' inset", () => {
    // The breaking case: a bare padded div would sit flush against the
    // caption with no divider and a different inset from the rows.
    const arrayBody = mounted(
      propsOf({
        args: { path_params: {}, query: {}, body: [1, 2] },
        result: undefined,
        resultText: undefined,
        status: "input-available",
      }),
    );
    const request = arrayBody.container.querySelector(
      "[data-tf-action-value-block]",
    );
    expect(request?.className).toContain("tf:border-t tf:border-tf-border");
    expect(request?.className).toContain("tf:px-2.5");
    expect(request?.className).toContain("tf:first:border-t-0");
    // The block rides in the bounded well, which sits under its caption
    // and draws the one hairline between them.
    const well = request?.parentElement;
    expect(well?.hasAttribute("data-tf-scroll-region")).toBe(true);
    expect(well?.className).toContain("tf:border-t");
    expect(well?.previousElementSibling?.textContent).toBe("Body");
    arrayBody.destroy();
    for (const body of ["Not found", [{ n: 1 }], 42]) {
      const { container, destroy } = mounted(
        propsOf({
          result: body,
          resultText: JSON.stringify({
            ok: true,
            result: { status: 200, body, truncated: false },
          }),
        }),
      );
      const blocks = container.querySelectorAll("[data-tf-action-value-block]");
      expect(blocks).toHaveLength(1);
      expect(blocks[0].className).toContain("tf:border-t tf:border-tf-border");
      expect(blocks[0].className).toContain("tf:px-2.5");
      destroy();
    }
  });

  it("bounds a door-sized body in a scrolling well — a 300-key record and a 2,000-item array alike, never the transcript's height", () => {
    // The breaking case: an unbounded dl or block for a body that runs to
    // the door's 20k would render at full transcript height; every
    // sibling built-in bounds its body, and so must this one.
    const bigRecord = Object.fromEntries(
      Array.from({ length: 300 }, (_, index) => [
        `key_${String(index)}`,
        index,
      ]),
    );
    const bigArray = Array.from({ length: 2000 }, (_, index) => index);
    for (const body of [bigRecord, bigArray]) {
      const { container, destroy } = mounted(
        propsOf({
          result: body,
          resultText: JSON.stringify({
            ok: true,
            result: { status: 200, body, truncated: false },
          }),
        }),
      );
      const wells = container.querySelectorAll("[data-tf-scroll-region]");
      // The request card's Body well and the response's — one each.
      expect(wells.length).toBeGreaterThanOrEqual(1);
      for (const well of wells) {
        expect(well.className).toContain("tf:max-h-72 tf:overflow-auto");
        // The well's first child yields its own hairline to the well's.
        expect(well.firstElementChild?.className).toContain(
          "tf:first:border-t-0",
        );
      }
      const responseWell = [...wells].at(-1);
      expect(responseWell?.previousElementSibling?.textContent).toContain(
        "Response",
      );
      if (Array.isArray(body)) {
        expect(
          responseWell?.querySelector("[data-tf-action-value-block]"),
        ).not.toBeNull();
      } else {
        expect(responseWell?.querySelectorAll("dt")).toHaveLength(300);
      }
      destroy();
    }
  });

  it("shape 2 — a non-2xx wears the status honestly, never success framing", () => {
    for (const httpStatus of [404, 503]) {
      const { container, destroy } = mounted(
        propsOf({
          resultText: JSON.stringify({
            ok: true,
            result: {
              status: httpStatus,
              body: { error: "not here" },
              truncated: false,
            },
          }),
        }),
      );
      const status = container.querySelector<HTMLElement>(
        "[data-tf-action-status]",
      );
      expect(status?.textContent).toBe(`HTTP ${String(httpStatus)}`);
      expect(status?.className).toContain("text-tf-destructive");
      destroy();
    }
  });

  it("shape 3 — an empty body says so explicitly, per status", () => {
    for (const body of [null, ""]) {
      const { container, destroy } = mounted(
        propsOf({
          resultText: JSON.stringify({
            ok: true,
            result: { status: 204, body, truncated: false },
          }),
        }),
      );
      expect(container.textContent).toContain("HTTP 204");
      expect(container.textContent).toContain("Empty response body.");
      destroy();
    }
  });

  it("a client-degraded body says truncated and still shows the honest status", () => {
    const { container, destroy } = mounted(
      propsOf({
        truncated: true,
        result: undefined,
        resultText: JSON.stringify({
          ok: true,
          result: { status: 200, body: "partial…", truncated: true },
        }),
      }),
    );
    const text = container.textContent;
    expect(text).toContain("HTTP 200");
    expect(text).toContain("truncated by the client");
    expect(text).toContain("Response (truncated)");
    destroy();
  });

  it("an unparseable resultText degrades to the quiet note — the wire's 20k clip lands here", () => {
    // The wire's size cap clips the envelope mid-JSON. No truncated
    // flag accompanies it: `call.truncated` is set only by a
    // WELL-FORMED envelope (which by construction parsed), so the
    // impossible "flagged truncated but unparseable" pairing earns no
    // arm and this test poses none (round-1 finding 3's sibling trap).
    const clipped = mounted(
      propsOf({
        result: undefined,
        resultText: '{"ok":true,"result":{"status":200,"body":"aaaaaa',
      }),
    );
    expect(clipped.container.textContent).toContain(
      "couldn't be read as an action result",
    );
    expect(
      clipped.container.querySelector("[data-tf-action-status]"),
    ).toBeNull();
    clipped.destroy();

    const alien = mounted(
      propsOf({ result: undefined, resultText: "not json at all" }),
    );
    expect(alien.container.textContent).toContain(
      "couldn't be read as an action result",
    );
    alien.destroy();
  });

  it("an ok:false-shaped text never wears a status receipt — the failure envelope cannot reach a view", () => {
    // PREMISE (round-1 finding 3): tool_return_of returns every
    // ok:false envelope as a strands ERROR result, so the call settles
    // output-error and the view model withholds output — this pairing
    // is wire-impossible, and the dedicated failure arm was deleted.
    // Posed anyway as the breaking case: the failure body CARRIES a
    // result record with a status, so if the ok check ever loosened,
    // "HTTP 500" would render off a call that never succeeded — red
    // here first.
    const { container, destroy } = mounted(
      propsOf({
        result: undefined,
        resultText: JSON.stringify({
          ok: false,
          result: { status: 500, body: { error: "boom" }, truncated: false },
          error: { message: "The host blocked the request." },
        }),
      }),
    );
    expect(container.querySelector("[data-tf-action-status]")).toBeNull();
    expect(container.textContent).toContain(
      "couldn't be read as an action result",
    );
    expect(container.textContent).not.toContain("HTTP 500");
    destroy();
  });
});

describe("actionToolView — a failure's field problems", () => {
  const SENTENCE =
    '"Create Doc" failed in this page: HTTP 422 VALIDATION_ERROR — Validation failed. ' +
    'Field problems: "body.title": "Field required"; "body.body_md": "line 3: unknown directive". ' +
    "Do not assume the action ran; tell the user what was being attempted so they can decide what to do.";

  it("lists the API's per-field problems as property rows — the one structured fact the row's human sentence no longer spells", () => {
    const { container, destroy } = mounted(
      propsOf({
        status: "output-error",
        result: undefined,
        resultText: undefined,
        errorText: SENTENCE,
      }),
    );
    const rows = container.querySelector("[data-tf-action-field-problems]");
    // The list follows its caption, so it draws the hairline between them.
    expect(rows?.className).toContain("tf:border-t");
    expect(rows?.textContent).toContain("body.title");
    expect(rows?.textContent).toContain("Field required");
    expect(rows?.textContent).toContain("unknown directive");
    // Never the status or code — the row carries the failure's sentence.
    expect(container.textContent).not.toContain("HTTP 422");
    expect(container.textContent).not.toContain("VALIDATION_ERROR");
    expect(container.textContent).toContain("Failed");
    destroy();
  });

  it("says how many more problems the API named than the record lists", () => {
    const { container, destroy } = mounted(
      propsOf({
        status: "output-error",
        result: undefined,
        resultText: undefined,
        errorText: SENTENCE.replace(
          '"line 3: unknown directive". ',
          '"line 3: unknown directive"; and 7 more. ',
        ),
      }),
    );
    const more = container.querySelector(
      "[data-tf-action-field-problems-omitted='7']",
    );
    expect(more?.textContent).toBe("7 more problems not listed here.");
    destroy();
  });

  it("adds nothing when the failure named no fields", () => {
    const { container, destroy } = mounted(
      propsOf({
        status: "output-error",
        result: undefined,
        resultText: undefined,
        errorText: "The fare backend broke.",
      }),
    );
    expect(
      container.querySelector("[data-tf-action-field-problems]"),
    ).toBeNull();
    destroy();
  });
});

describe("actionToolView — the parse premise, pinned against the real presenter", () => {
  it("resultText carries the whole envelope while call.result is the body alone", () => {
    // THE PREMISE this view is built on: the core unwrapper strips the
    // status from call.result, and resultText is the verbatim wire
    // envelope — so the status is recoverable only by the view's own
    // authored parse. If the unwrapper ever kept the envelope (or the
    // wire stopped carrying it), this goes red before the view lies.
    const presentation = toolCallPresentationOf({
      toolName: "action__issue-refund",
      toolCallId: "t1",
      state: "output-available",
      input: "{}",
      argsText: JSON.stringify({ path_params: { order_id: "o_77" } }),
      output: ENVELOPE_200,
    });
    const call = presentation.toolView.call;
    expect(call.resultText).toBe(ENVELOPE_200);
    expect(call.result).toEqual({ refund_id: "r_1", amount: 1200 });
    expect(call.truncated).toBeUndefined();

    const { container, destroy } = mounted({
      call,
      context: { themeMode: "light" },
    });
    expect(
      container.querySelector("[data-tf-action-status]")?.textContent,
    ).toBe("HTTP 200");
    destroy();
  });

  it("a degraded envelope surfaces as call.truncated through the presenter, and the view still reads the status", () => {
    const degraded = JSON.stringify({
      ok: true,
      result: { status: 500, body: "cut", truncated: true },
    });
    const presentation = toolCallPresentationOf({
      toolName: "action__issue-refund",
      toolCallId: "t1",
      state: "output-available",
      input: "{}",
      output: degraded,
    });
    const call = presentation.toolView.call;
    expect(call.truncated).toBe(true);
    expect(call.result).toBeUndefined();

    const { container, destroy } = mounted({
      call,
      context: { themeMode: "light" },
    });
    expect(
      container.querySelector("[data-tf-action-status]")?.textContent,
    ).toBe("HTTP 500");
    destroy();
  });
});

describe("actionToolView — lifecycle and totality", () => {
  it("updates in place from running to settled and clears on destroy", () => {
    const running = propsOf({
      status: "input-available",
      result: undefined,
      resultText: undefined,
    });
    const { container, update, destroy } = mounted(running);
    expect(container.querySelector("[data-tf-action-status]")).toBeNull();
    update(propsOf());
    expect(
      container.querySelector("[data-tf-action-status]")?.textContent,
    ).toBe("HTTP 200");
    destroy();
    expect(container.isConnected).toBe(false);
  });

  it("is total: every state times every degraded prop shape mounts and updates without throwing", () => {
    const states = [
      "input-streaming",
      "input-available",
      "output-available",
      "output-error",
      "cancelled",
      "refused",
      "superseded",
    ] as const;
    // Each variant poses the shape most likely to break the arm it
    // reaches: wrong-typed sections, a bodyless envelope, a non-record
    // JSON document, a boolean ok of the wrong kind.
    const variants: Partial<ToolViewCall>[] = [
      { args: {}, result: undefined, resultText: undefined },
      { args: { path_params: 42, query: "x", body: [1, 2] } },
      { resultText: '{"ok":true}', result: undefined },
      { resultText: "null", result: undefined },
      { resultText: "[1,2]", result: undefined },
      { resultText: '{"ok":"yes","result":{}}', result: undefined },
      {
        resultText: JSON.stringify({ ok: true, result: { body: {} } }),
        result: {},
      },
      { truncated: true, result: undefined },
      { offloaded: true, result: undefined, resultText: undefined },
      { errorText: "boom", result: undefined, resultText: undefined },
      { refusalText: "no", result: undefined, resultText: undefined },
    ];
    for (const status of states) {
      for (const variant of variants) {
        const props = propsOf({ status, ...variant });
        expect(() => {
          const { update, destroy } = mounted(props);
          update(propsOf({ status, ...variant }));
          destroy();
        }).not.toThrow();
      }
    }
  });

  it("a call that didn't settle cleanly never wears a status receipt", () => {
    for (const status of [
      "output-error",
      "cancelled",
      "refused",
      "superseded",
    ] as const) {
      const { container, destroy } = mounted(propsOf({ status }));
      expect(container.querySelector("[data-tf-action-status]")).toBeNull();
      destroy();
    }
    const offloaded = mounted(propsOf({ offloaded: true }));
    expect(
      offloaded.container.querySelector("[data-tf-action-status]"),
    ).toBeNull();
    expect(offloaded.container.textContent).toContain("shortened preview");
    offloaded.destroy();
  });
});
