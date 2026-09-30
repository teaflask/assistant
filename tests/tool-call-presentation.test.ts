import { describe, expect, it, vi } from "vitest";

import {
  toolRowHeadlineOf,
  type ToolCallViewModel,
} from "../src/core/tool-call-display";
import {
  TOOL_CALL_ICONS,
  toolCallPresentationOf,
} from "../src/core/tool-call-presentation";
import {
  PACKAGE_TOOL_VIEWS,
  isReservedToolViewKey,
  resolvedToolViewsOf,
  type ToolViewAdapter,
  type ToolViewRegistry,
} from "../src/core/tool-view";

function viewOf(overrides: Partial<ToolCallViewModel>): ToolCallViewModel {
  return {
    toolName: "action__create-support-ticket",
    state: "input-available",
    input: "{}",
    ...overrides,
  };
}

function adapterOf(): ToolViewAdapter {
  return {
    mount: () => ({ update: () => undefined, destroy: () => undefined }),
  };
}

const STATES = [
  "input-streaming",
  "input-available",
  "output-available",
  "output-error",
  "cancelled",
] as const;

describe("toolCallPresentationOf — vocabulary resolution", () => {
  it("resolves every known icon token and collapses unknown or absent to generic", () => {
    for (const icon of TOOL_CALL_ICONS) {
      expect(toolCallPresentationOf(viewOf({ display: { icon } })).icon).toBe(
        icon,
      );
    }
    // An unknown token is a FUTURE vocabulary member, not an error — the
    // narrower kept it verbatim so this resolver's fallback owns it.
    expect(
      toolCallPresentationOf(viewOf({ display: { icon: "telescope" } })).icon,
    ).toBe("generic");
    expect(toolCallPresentationOf(viewOf({})).icon).toBe("generic");
  });
});

describe("toolCallPresentationOf — the consumer slots", () => {
  const DISPLAY = {
    progressText: "Creating a support ticket…",
    completeText: "Created a support ticket",
    errorText: "Couldn't create the support ticket",
  } as const;

  it("derives the current-work label from progress copy, else the running frame", () => {
    expect(
      toolCallPresentationOf(viewOf({ display: DISPLAY })).currentWorkLabel,
    ).toBe("Creating a support ticket…");
    expect(toolCallPresentationOf(viewOf({})).currentWorkLabel).toBe(
      "Running action create support ticket…",
    );
  });

  it("TVC-113 derives every copy slot FROM the ladder — a respelled frame cannot drift", () => {
    // The anti-fork pin: copy slots must equal the ladder's own arms, so a
    // frame change in tool-call-display.ts lands everywhere by construction.
    for (const state of STATES) {
      for (const display of [undefined, DISPLAY]) {
        const view = viewOf({ state, display });
        const presentation = toolCallPresentationOf(view);
        expect(presentation.currentWorkLabel).toBe(
          toolRowHeadlineOf({ ...view, state: "input-available" }),
        );
        expect(presentation.settledSummary).toBe(toolRowHeadlineOf(view));
      }
    }
  });

  it("summarizes a settled call with the same success/failure discipline as the headline", () => {
    expect(
      toolCallPresentationOf(
        viewOf({ state: "output-available", output: "ok", display: DISPLAY }),
      ).settledSummary,
    ).toBe("Created a support ticket");
    expect(
      toolCallPresentationOf(
        viewOf({ state: "output-error", display: DISPLAY }),
      ).settledSummary,
    ).toBe("Couldn't create the support ticket");
    expect(
      toolCallPresentationOf(viewOf({ state: "output-error" })).settledSummary,
    ).toBe("action create support ticket failed");
    // Cancelled refuses ALL copy — even authored error copy: the call
    // never ran, so nothing authored about running it is true.
    expect(
      toolCallPresentationOf(viewOf({ state: "cancelled", display: DISPLAY }))
        .settledSummary,
    ).toBe("Didn't run action create support ticket");
    expect(
      toolCallPresentationOf(
        viewOf({ state: "output-available", output: "ok" }),
      ).settledSummary,
    ).toBe("Ran action create support ticket");
  });

  it("passes the protocol state through and equals the ladder's headline in every state", () => {
    for (const state of STATES) {
      const view = viewOf({ state, display: DISPLAY });
      const presentation = toolCallPresentationOf(view);
      expect(presentation.status).toBe(state);
      expect(presentation.headline).toBe(toolRowHeadlineOf(view));
    }
  });

  it("carries no raw payload slot — the tool view is the row's whole body", () => {
    const settled = toolCallPresentationOf(
      viewOf({
        state: "output-available",
        input: '{"subject":"kettle"}',
        output: '{"id":7}',
      }),
    );
    expect("technicalDetails" in settled).toBe(false);
    expect(settled.toolView.call.resultText).toBe('{"id":7}');
  });
});

// The replay-compatibility law: a text-only history resolves to
// exactly the words the old ladder chose.
describe("toolCallPresentationOf — old histories render unchanged", () => {
  it("TVC-114 resolves a legacy text-only display identically to the ladder in every state", () => {
    for (const state of STATES) {
      const view = viewOf({
        state,
        display: {
          progressText: "Searching your docs…",
          completeText: "Searched your docs — 3 results",
        },
      });
      expect(toolCallPresentationOf(view).headline).toBe(
        toolRowHeadlineOf(view),
      );
    }
  });

  it("resolves an unannotated call entirely from the mechanical ladder", () => {
    const presentation = toolCallPresentationOf(viewOf({}));
    expect(presentation.headline).toBe("Running action create support ticket…");
    expect(presentation.icon).toBe("generic");
    expect(presentation.toolView.views).toEqual([]);
    expect(presentation.toolView.icons).toEqual([]);
  });
});

// The four-rung ladder (tool-views.md): host by wire {key, version},
// host by exact tool name, package built-ins under teaflask.*, and the
// package default as the definitional terminal (an empty `views` list).
describe("toolCallPresentationOf — the tool-view resolution ladder", () => {
  const KEYED_VIEW = adapterOf();
  const NAMED_VIEW = adapterOf();
  const REGISTRY: ToolViewRegistry = {
    "acme.order-lookup": { version: 2, view: KEYED_VIEW },
    action__create_order: { version: 1, view: NAMED_VIEW },
  };
  const orderView = viewOf({
    toolName: "action__create_order",
    display: { view: { key: "acme.order-lookup", version: 2 } },
  });

  it("resolves rung 1 before rung 2, in ladder order", () => {
    const { views } = toolCallPresentationOf(orderView, REGISTRY).toolView;
    expect(views.map((candidate) => [candidate.rung, candidate.key])).toEqual([
      [1, "acme.order-lookup"],
      [2, "action__create_order"],
    ]);
    expect(views[0].adapter).toBe(KEYED_VIEW);
    expect(views[1].adapter).toBe(NAMED_VIEW);
  });

  it("rung 1 resolves only on exact key AND exact version — drift lands on the rung below", () => {
    const drifted = viewOf({
      toolName: "action__create_order",
      display: { view: { key: "acme.order-lookup", version: 1 } },
    });
    const { views } = toolCallPresentationOf(drifted, REGISTRY).toolView;
    expect(views.map((candidate) => candidate.rung)).toEqual([2]);
    const unknown = viewOf({
      toolName: "action__create_order",
      display: { view: { key: "acme.unknown", version: 2 } },
    });
    expect(
      toolCallPresentationOf(unknown, REGISTRY).toolView.views.map(
        (candidate) => candidate.rung,
      ),
    ).toEqual([2]);
  });

  it("rung 2 resolves the host's own tool name directly — no wire annotation, no version compare", () => {
    const bare = viewOf({ toolName: "action__create_order" });
    const { views } = toolCallPresentationOf(bare, REGISTRY).toolView;
    expect(views.map((candidate) => [candidate.rung, candidate.key])).toEqual([
      [2, "action__create_order"],
    ]);
    // The registration's version is the contract it was written against,
    // not a wire match — there is no wire version on this rung.
    const versionSeven: ToolViewRegistry = {
      action__create_order: { version: 7, view: NAMED_VIEW },
    };
    expect(
      toolCallPresentationOf(bare, versionSeven).toolView.views,
    ).toHaveLength(1);
  });

  it("an absent registry and a role-less registration are the same answer: the rung below", () => {
    expect(toolCallPresentationOf(orderView).toolView.views).toEqual([]);
    const iconOnly: ToolViewRegistry = {
      "acme.order-lookup": { version: 2, icon: adapterOf() },
    };
    const { views, icons } = toolCallPresentationOf(
      orderView,
      iconOnly,
    ).toolView;
    expect(views).toEqual([]);
    expect(icons.map((candidate) => [candidate.rung, candidate.key])).toEqual([
      [1, "acme.order-lookup"],
    ]);
  });

  it("never resolves through the prototype chain — the registry is a plain record", () => {
    const named = viewOf({
      toolName: "toString",
      display: { view: { key: "toString", version: 1 } },
    });
    expect(toolCallPresentationOf(named, REGISTRY).toolView.views).toEqual([]);
    expect(
      resolvedToolViewsOf(
        { key: "toString", version: 1 },
        "toString",
        REGISTRY,
        {
          constructor: { version: 1, view: adapterOf() },
        },
      ).views,
    ).toEqual([]);
  });

  it("drops a teaflask.* key from the host registry — the reserved namespace never resolves from a non-package source", () => {
    const hijack: ToolViewRegistry = {
      "teaflask.http-action": { version: 1, view: adapterOf() },
    };
    const annotated = viewOf({
      display: { view: { key: "teaflask.http-action", version: 1 } },
    });
    expect(toolCallPresentationOf(annotated, hijack).toolView.views).toEqual(
      [],
    );
    // Negative control — the identical registration under a non-reserved
    // key resolves, proving the guard (not a lookup miss) did the drop.
    const sanctioned: ToolViewRegistry = {
      "acme.http-action": { version: 1, view: adapterOf() },
    };
    const acmeAnnotated = viewOf({
      display: { view: { key: "acme.http-action", version: 1 } },
    });
    expect(
      toolCallPresentationOf(acmeAnnotated, sanctioned).toolView.views,
    ).toHaveLength(1);
  });

  it("refuses a teaflask.* TOOL NAME at rung 2 the same way", () => {
    const hijack: ToolViewRegistry = {
      "teaflask.pretender": { version: 1, view: adapterOf() },
    };
    expect(
      toolCallPresentationOf(viewOf({ toolName: "teaflask.pretender" }), hijack)
        .toolView.views,
    ).toEqual([]);
    // Negative control — the same shape under the host's own name resolves.
    const sanctioned: ToolViewRegistry = {
      "acme.pretender": { version: 1, view: adapterOf() },
    };
    expect(
      toolCallPresentationOf(viewOf({ toolName: "acme.pretender" }), sanctioned)
        .toolView.views,
    ).toHaveLength(1);
  });

  it("rung 3 ships the package built-ins under reserved keys", () => {
    // The rung's exact contents, pinned: four views, all version 1,
    // every key reserved, no icon role. The backend twin of this ledger
    // is test_tool_call_display.py's recorded-decision pin.
    expect(Object.keys(PACKAGE_TOOL_VIEWS).sort()).toEqual([
      "teaflask.action",
      "teaflask.command",
      "teaflask.docs-search",
      "teaflask.file-edit",
      "teaflask.questions",
    ]);
    expect(Object.isFrozen(PACKAGE_TOOL_VIEWS)).toBe(true);
    for (const [key, registration] of Object.entries(PACKAGE_TOOL_VIEWS)) {
      expect(isReservedToolViewKey(key)).toBe(true);
      expect(registration.version).toBe(1);
      expect(registration.view).toBeDefined();
      expect(registration.icon).toBeUndefined();
    }
    // Resolution through the REAL default table — no registry, no
    // seeded builtIns: the wire ref alone reaches rung 3.
    const annotated = viewOf({
      display: { view: { key: "teaflask.action", version: 1 } },
    });
    expect(
      toolCallPresentationOf(annotated).toolView.views.map((candidate) => [
        candidate.rung,
        candidate.key,
      ]),
    ).toEqual([[3, "teaflask.action"]]);
    // Exact version only — a drifted ref falls through to nothing.
    const drifted = viewOf({
      display: { view: { key: "teaflask.action", version: 2 } },
    });
    expect(toolCallPresentationOf(drifted).toolView.views).toEqual([]);
    // An unregistered reserved key still resolves no built-in.
    const unregistered = viewOf({
      display: { view: { key: "teaflask.http-action", version: 1 } },
    });
    expect(toolCallPresentationOf(unregistered).toolView.views).toEqual([]);
  });

  it("rung 3 sits below rung 2 and holds the exact-version law (seeded built-ins)", () => {
    const builtIn = adapterOf();
    const builtIns: ToolViewRegistry = {
      "teaflask.http-action": { version: 1, view: builtIn },
    };
    const ref = { key: "teaflask.http-action", version: 1 };
    // Rung 2 beats rung 3 — a customer may re-skin a tool we ship.
    const reskinned = resolvedToolViewsOf(
      ref,
      "action__create_order",
      REGISTRY,
      builtIns,
    );
    expect(
      reskinned.views.map((candidate) => [candidate.rung, candidate.key]),
    ).toEqual([
      [2, "action__create_order"],
      [3, "teaflask.http-action"],
    ]);
    // Exact version at rung 3, exactly as at rung 1.
    expect(
      resolvedToolViewsOf(
        { key: "teaflask.http-action", version: 2 },
        "unregistered_tool",
        undefined,
        builtIns,
      ).views,
    ).toEqual([]);
    expect(
      resolvedToolViewsOf(ref, "unregistered_tool", undefined, builtIns).views,
    ).toEqual([{ rung: 3, key: "teaflask.http-action", adapter: builtIn }]);
  });

  it("names the reserved namespace once", () => {
    expect(isReservedToolViewKey("teaflask.http-action")).toBe(true);
    expect(isReservedToolViewKey("acme.http-action")).toBe(false);
  });
});

// The assembled call — the props a view receives, built at the single
// resolution point so parsing never forks per consumer.
describe("toolCallPresentationOf — the tool-view call", () => {
  it("assembles the call LAZILY and memoizes it — consumers that never read it never pay the parse", () => {
    const parse = vi.spyOn(JSON, "parse");
    try {
      // Unique strings on purpose: the parse memo is module-level, so a
      // text another test already parsed would satisfy the read without
      // calling JSON.parse and turn this pin order-dependent.
      const presentation = toolCallPresentationOf(
        viewOf({
          state: "output-available",
          argsText: '{"laziness_probe":"args"}',
          output: '{"laziness_hits":3}',
        }),
      );
      // The approval card and the subagent label discard toolView; an
      // unannotated row reads only the candidate lists — none of that
      // may cost a JSON.parse per render.
      expect(presentation.toolView.views).toEqual([]);
      expect(parse).not.toHaveBeenCalled();
      // The first reader pays once…
      const first = presentation.toolView.call;
      expect(first.result).toEqual({ laziness_hits: 3 });
      const afterFirstRead = parse.mock.calls.length;
      expect(afterFirstRead).toBeGreaterThan(0);
      // …and the memo makes the second read free and identical.
      expect(presentation.toolView.call).toBe(first);
      expect(parse.mock.calls.length).toBe(afterFirstRead);
    } finally {
      parse.mockRestore();
    }
  });

  it("structures the RESULT lazier still — reading the call parses the arguments alone; result and truncated parse on first read, once", () => {
    const parse = vi.spyOn(JSON, "parse");
    try {
      const output = '{"result_probe_hits":[1,2,3]}';
      const presentation = toolCallPresentationOf(
        viewOf({
          state: "output-available",
          argsText: '{"result_probe":"args"}',
          output,
        }),
      );
      const call = presentation.toolView.call;
      const outputParses = () =>
        parse.mock.calls.filter(([text]) => text === output).length;
      // The args parsed; the 20k-capable result did not.
      expect(call.args).toEqual({ result_probe: "args" });
      expect(call.resultText).toBe(output);
      expect(outputParses()).toBe(0);
      expect(call.truncated).toBeUndefined();
      expect(outputParses()).toBe(1);
      expect(call.result).toEqual({ result_probe_hits: [1, 2, 3] });
      expect(outputParses()).toBe(1);
      // A truncated envelope structures to the flag alone, still lazily.
      const cut = toolCallPresentationOf(
        viewOf({
          state: "output-available",
          argsText: "{}",
          output:
            '{"ok":true,"result":{"status":200,"body":"x","truncated":true}}',
        }),
      ).toolView.call;
      expect(cut.result).toBeUndefined();
      expect(cut.truncated).toBe(true);
    } finally {
      parse.mockRestore();
    }
  });

  it("IDENTITY LAW: unchanged source text yields identity-equal args and result across presentations", () => {
    // The mount slot's structural delivery guard rests on this: parsed
    // values must not be re-minted per render, or nested arguments read
    // as changed on every streamed token (r2 finding 1).
    const sourceView = viewOf({
      state: "output-available",
      argsText: '{"filters":{"status":"open"},"ids":[1,2]}',
      output: '{"ok":true,"result":{"status":200,"body":{"nested":{"id":7}}}}',
    });
    const first = toolCallPresentationOf(sourceView).toolView.call;
    const second = toolCallPresentationOf({ ...sourceView }).toolView.call;
    expect(second.args).toBe(first.args);
    expect(second.result).toBe(first.result);
    // The empty-args identity is shared too — mid-stream tails and
    // narrow callers all resolve the one constant.
    expect(
      toolCallPresentationOf(viewOf({ argsText: '{"broken' })).toolView.call
        .args,
    ).toBe(
      toolCallPresentationOf(viewOf({ argsText: "[3]" })).toolView.call.args,
    );
  });

  it("IDENTITY LAW's one stated instability: a memo cap reset re-mints identities once, then re-stabilizes", () => {
    // The law claims the reset is a single over-delivery, not a leak
    // back into per-render re-minting — enforce the claim, don't state
    // it.
    const source = viewOf({ argsText: '{"cap_probe":{"nested":true}}' });
    const first = toolCallPresentationOf(source).toolView.call.args;
    expect(toolCallPresentationOf(source).toolView.call.args).toBe(first);
    // Blow past the cap (512) with distinct texts to force the reset.
    for (let filler = 0; filler < 600; filler += 1) {
      const parsed = toolCallPresentationOf(
        viewOf({ argsText: `{"cap_filler_${String(filler)}":1}` }),
      ).toolView.call.args;
      expect(parsed).toEqual({ [`cap_filler_${String(filler)}`]: 1 });
    }
    const reminted = toolCallPresentationOf(source).toolView.call.args;
    expect(reminted).not.toBe(first);
    expect(reminted).toEqual(first);
    // …and one re-mint only: the memo holds the new identity again.
    expect(toolCallPresentationOf(source).toolView.call.args).toBe(reminted);
  });

  it("carries the identity, state and decision facts", () => {
    const { call } = toolCallPresentationOf(
      viewOf({ toolCallId: "t-1", state: "output-available", output: "ok" }),
      undefined,
      { awaitingDecision: true },
    ).toolView;
    expect(call.toolName).toBe("action__create-support-ticket");
    expect(call.toolCallId).toBe("t-1");
    expect(call.status).toBe("output-available");
    expect(call.awaitingDecision).toBe(true);
    // The default: no options means no pending decision, and a narrow
    // caller without an id hands the view the empty id honestly.
    const bare = toolCallPresentationOf(viewOf({})).toolView.call;
    expect(bare.awaitingDecision).toBe(false);
    expect(bare.toolCallId).toBe("");
  });

  it("parses args from the raw stream text, whole records only", () => {
    expect(
      toolCallPresentationOf(viewOf({ argsText: '{"subject":"kettle"}' }))
        .toolView.call.args,
    ).toEqual({ subject: "kettle" });
    // Mid-stream tails and non-records must never hand a view half an
    // argument object.
    expect(
      toolCallPresentationOf(viewOf({ argsText: '{"subject":"ket' })).toolView
        .call.args,
    ).toEqual({});
    expect(
      toolCallPresentationOf(viewOf({ argsText: "[1,2]" })).toolView.call.args,
    ).toEqual({});
    // Narrow callers hand only the pretty-printed input; it parses the
    // same when it is a whole record.
    expect(
      toolCallPresentationOf(viewOf({ input: '{\n  "window": "24h"\n}' }))
        .toolView.call.args,
    ).toEqual({ window: "24h" });
  });

  it("unwraps the tool-result/v1 envelope into result", () => {
    const { call } = toolCallPresentationOf(
      viewOf({
        state: "output-available",
        output: JSON.stringify({
          ok: true,
          result: { status: 200, body: { id: 7 } },
        }),
      }),
    ).toolView;
    expect(call.result).toEqual({ id: 7 });
    expect(call.resultText).toBe(
      '{"ok":true,"result":{"status":200,"body":{"id":7}}}',
    );
    expect(call.truncated).toBeUndefined();
  });

  it("flags a truncated envelope honestly instead of parsing it into a lie", () => {
    const { call } = toolCallPresentationOf(
      viewOf({
        state: "output-available",
        output: JSON.stringify({
          ok: true,
          result: { status: 200, body: "…", truncated: true },
        }),
      }),
    ).toolView;
    expect(call.result).toBeUndefined();
    expect(call.truncated).toBe(true);
    // The verbatim bytes stay available — the refusal is structural.
    expect(call.resultText).toContain("truncated");
  });

  it("passes a plain JSON document through and withholds result from non-JSON text", () => {
    expect(
      toolCallPresentationOf(
        viewOf({ state: "output-available", output: '{"p95_ms":412}' }),
      ).toolView.call.result,
    ).toEqual({ p95_ms: 412 });
    const prose = toolCallPresentationOf(
      viewOf({ state: "output-available", output: "All done." }),
    ).toolView.call;
    expect(prose.result).toBeUndefined();
    expect(prose.truncated).toBeUndefined();
    expect(prose.resultText).toBe("All done.");
  });

  it("carries the honesty flags and failure sentences the view model recorded", () => {
    const offloaded = toolCallPresentationOf(
      viewOf({ state: "output-available", offloaded: true }),
    ).toolView.call;
    expect(offloaded.offloaded).toBe(true);
    expect(offloaded.resultText).toBeUndefined();
    const failed = toolCallPresentationOf(
      viewOf({ state: "output-error", errorText: "It broke." }),
    ).toolView.call;
    expect(failed.errorText).toBe("It broke.");
    const refused = toolCallPresentationOf(
      viewOf({ state: "refused", refusalText: "Not while paused." }),
    ).toolView.call;
    expect(refused.refusalText).toBe("Not while paused.");
  });

  it("carries the registered schemas verbatim, and absence as ABSENCE — never `{}`", () => {
    const argsSchema = {
      type: "object",
      properties: { body: { type: "object" } },
    };
    const resultSchema = { type: "object", properties: { id: {} } };
    const { call } = toolCallPresentationOf(
      viewOf({ argsSchema, resultSchema }),
    ).toolView;
    // Verbatim references: the anchors map owns identity stability, the
    // presenter must not re-mint (the IDENTITY LAW's census entry).
    expect(call.argsSchema).toBe(argsSchema);
    expect(call.resultSchema).toBe(resultSchema);
    // A view model without schemas hands the view undefined fields — the
    // keys are not even present, so `"argsSchema" in call` stays false.
    const bare = toolCallPresentationOf(viewOf({})).toolView.call;
    expect(bare.argsSchema).toBeUndefined();
    expect(bare.resultSchema).toBeUndefined();
    expect("argsSchema" in bare).toBe(false);
    expect("resultSchema" in bare).toBe(false);
  });

  it("IDENTITY LAW: unchanged schema references stay identity-equal across presentations", () => {
    const argsSchema = { type: "object" };
    const sourceView = viewOf({ argsSchema });
    const first = toolCallPresentationOf(sourceView).toolView.call;
    const second = toolCallPresentationOf({ ...sourceView }).toolView.call;
    expect(second.argsSchema).toBe(first.argsSchema);
  });
});
