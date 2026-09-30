import { describe, expect, it, vi } from "vitest";

// The door measure is wrapped so the fit loop's passes can be counted:
// each pass measures exactly one candidate.
vi.mock("../src/transport/door-budget", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/transport/door-budget")>();
  return {
    ...actual,
    doorLengthCeilingOf: vi.fn(actual.doorLengthCeilingOf),
  };
});

import {
  executionHandlersFor,
  HIGHLIGHT_REQUEST_KIND,
  HTTP_INTENT_REQUEST_KIND,
  KIND_UNSUPPORTED_OUTCOME,
  NAVIGATE_REQUEST_KIND,
  PREFILL_FORM_REQUEST_KIND,
  READ_PAGE_REQUEST_KIND,
  type ExecuteActionIntent,
  type ExecutionHandler,
  type ExecutionOutcome,
  type HostNavigate,
} from "../src/core/execution-handlers";
import type { ExecutionEntryModel } from "../src/core/execution-inbox";
import {
  closeCompanionDrawer,
  companionDrawerOpen,
} from "../src/core/companion-drawer-flag";
import { actionFailureOf } from "../src/components/tool-views/view-dom";
import { doorLengthCeilingOf } from "../src/transport/door-budget";

function navigateEntryOf(
  action: Record<string, unknown> | null,
): ExecutionEntryModel {
  return {
    interruptId: "v1:tool_call:t1",
    toolName: "navigate",
    toolCallId: "run-1-a1-t1",
    anchored: false,
    kind: NAVIGATE_REQUEST_KIND,
    action,
    intent: null,
    round: 0,
    runId: "run-1",
    status: { kind: "pending" },
    asker: { kind: "assistant" },
    turnId: null,
  };
}

// The wire's snake_case intent, exactly as the server builds it.
const WIRE_INTENT: Record<string, unknown> = {
  action: { slug: "cancel-subscription", title: "Cancel a subscription" },
  method: "POST",
  path_template: "/subscriptions/{subscription_id}",
  path_params: { subscription_id: "sub_42" },
  query: {},
  body: { reason: "Too much tea." },
};

function httpIntentEntryOf(
  intent: Record<string, unknown> | null,
): ExecutionEntryModel {
  return {
    interruptId: "v1:tool_call:t2",
    toolName: "action__cancel-subscription",
    toolCallId: "run-1-a1-t2",
    anchored: false,
    kind: HTTP_INTENT_REQUEST_KIND,
    action: null,
    intent,
    round: 0,
    runId: "run-1",
    status: { kind: "pending" },
    asker: { kind: "assistant" },
    turnId: null,
  };
}

/** json.dumps(value, ensure_ascii=False) — Python's default spaced
 *  separators, the exact text tool_return_of hands the mapper. */
function pythonDumps(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(pythonDumps).join(", ")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .map(([key, entry]) => `${JSON.stringify(key)}: ${pythonDumps(entry)}`)
      .join(", ")}}`;
  }
  return JSON.stringify(value);
}

function navigateHandlerOf(navigate: HostNavigate): ExecutionHandler {
  const handler = executionHandlersFor(navigate, null, "thread-under-test").get(
    NAVIGATE_REQUEST_KIND,
  );
  if (handler === undefined) {
    throw new Error("The registry lost its navigate handler.");
  }
  return handler;
}

function httpIntentHandlerOf(execute: ExecuteActionIntent): ExecutionHandler {
  const handler = executionHandlersFor(null, execute, "thread-under-test").get(
    HTTP_INTENT_REQUEST_KIND,
  );
  if (handler === undefined) {
    throw new Error("The registry lost its http_intent handler.");
  }
  return handler;
}

function failureMessageOf(outcome: ExecutionOutcome): string {
  if (outcome.ok) {
    throw new Error("Expected a failure outcome.");
  }
  return outcome.error.message;
}

describe("the handler registry", () => {
  it("serves builtin.navigate exactly when the host wired a navigation hookup", () => {
    expect(
      executionHandlersFor(() => undefined, null, "thread-under-test").has(
        NAVIGATE_REQUEST_KIND,
      ),
    ).toBe(true);
    expect(
      executionHandlersFor(null, null, "thread-under-test").has(
        NAVIGATE_REQUEST_KIND,
      ),
    ).toBe(false);
  });

  it("always serves the page-operating kinds — the package works its own page", () => {
    const bareMount = executionHandlersFor(null, null, "thread-under-test");
    expect(bareMount.has(READ_PAGE_REQUEST_KIND)).toBe(true);
    expect(bareMount.has(HIGHLIGHT_REQUEST_KIND)).toBe(true);
    expect(bareMount.has(PREFILL_FORM_REQUEST_KIND)).toBe(true);
    expect(bareMount.size).toBe(3);
  });

  it("serves http_intent exactly when the host wired an actions adapter", () => {
    const execute: ExecuteActionIntent = () =>
      Promise.resolve({ status: 200, body: null });
    expect(
      executionHandlersFor(null, execute, "thread-under-test").has(
        HTTP_INTENT_REQUEST_KIND,
      ),
    ).toBe(true);
    expect(
      executionHandlersFor(null, null, "thread-under-test").has(
        HTTP_INTENT_REQUEST_KIND,
      ),
    ).toBe(false);
  });

  it("answers an unsupported kind with deterministic canned prose, distinguishable from a real failure", () => {
    expect(KIND_UNSUPPORTED_OUTCOME.ok).toBe(false);
    expect(KIND_UNSUPPORTED_OUTCOME.error.code).toBe("kind_unsupported");
    expect(KIND_UNSUPPORTED_OUTCOME.error.message).toContain(
      "This page cannot perform this action",
    );
  });
});

describe("the navigate handler", () => {
  it("navigates and synthesizes the contract's strict NavigateResult itself", async () => {
    const visited: string[] = [];
    const handler = navigateHandlerOf((path) => {
      visited.push(path);
    });
    const outcome = await handler(navigateEntryOf({ path: "/memory" }));
    expect(visited).toEqual(["/memory"]);
    expect(outcome).toEqual({
      ok: true,
      result: { navigated: true, path: "/memory" },
    });
  });

  it("awaits an async host before reporting", async () => {
    let settled = false;
    const handler = navigateHandlerOf(async () => {
      await Promise.resolve();
      settled = true;
    });
    const outcome = await handler(navigateEntryOf({ path: "/memory" }));
    expect(settled).toBe(true);
    expect(outcome.ok).toBe(true);
  });

  it("shapes a throwing host into a model-actionable failure — the path and reason, never a stack", async () => {
    const handler = navigateHandlerOf(() => {
      throw new Error("router is detached\n    at push (router.ts:12)");
    });
    const outcome = await handler(navigateEntryOf({ path: "/memory" }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("execution_failed");
    }
    const message = failureMessageOf(outcome);
    expect(message).toContain('Navigation to "/memory" failed');
    expect(message).toContain("router is detached");
    expect(message).not.toContain("at push");
    expect(message).toContain("Do not assume the user moved");
  });

  it("refuses an unusable path with canned prose instead of navigating", async () => {
    const visited: string[] = [];
    const handler = navigateHandlerOf((path) => {
      visited.push(path);
    });
    const unusableActions: (Record<string, unknown> | null)[] = [
      null,
      {},
      { path: 7 },
      { path: "memory" },
    ];
    for (const action of unusableActions) {
      const outcome = await handler(navigateEntryOf(action));
      expect(failureMessageOf(outcome)).toContain(
        "did not carry a usable path",
      );
    }
    expect(visited).toEqual([]);
  });

  // The drawer flag is page-level state the companion reads at the
  // destination; each test below starts it closed.
  it("opens the companion drawer once a sync host returned", async () => {
    closeCompanionDrawer();
    const handler = navigateHandlerOf(() => undefined);
    await handler(navigateEntryOf({ path: "/memory" }));
    expect(companionDrawerOpen.get()).toBe(true);
    closeCompanionDrawer();
  });

  it("opens the drawer only once an async host has settled", async () => {
    closeCompanionDrawer();
    let openWhenHostSettled: boolean | null = null;
    const handler = navigateHandlerOf(async () => {
      await Promise.resolve();
      openWhenHostSettled = companionDrawerOpen.get();
    });
    await handler(navigateEntryOf({ path: "/memory" }));
    expect(openWhenHostSettled).toBe(false);
    expect(companionDrawerOpen.get()).toBe(true);
    closeCompanionDrawer();
  });

  it("leaves the drawer closed for a throwing host", async () => {
    closeCompanionDrawer();
    const handler = navigateHandlerOf(() => {
      throw new Error("router is detached");
    });
    await handler(navigateEntryOf({ path: "/memory" }));
    expect(companionDrawerOpen.get()).toBe(false);
  });

  it("leaves the drawer closed for an unusable path", async () => {
    closeCompanionDrawer();
    const handler = navigateHandlerOf(() => undefined);
    await handler(navigateEntryOf({ path: "memory" }));
    expect(companionDrawerOpen.get()).toBe(false);
  });
});

describe("the http_intent handler", () => {
  it("hands the executor the narrowed camelCase intent and reports its synthesized result", async () => {
    const seen: unknown[] = [];
    const handler = httpIntentHandlerOf((intent) => {
      seen.push(intent);
      return Promise.resolve({ status: 200, body: { status: "cancelled" } });
    });
    const outcome = await handler(httpIntentEntryOf(WIRE_INTENT));
    expect(seen).toEqual([
      {
        action: { slug: "cancel-subscription", title: "Cancel a subscription" },
        method: "POST",
        pathTemplate: "/subscriptions/{subscription_id}",
        pathParams: { subscription_id: "sub_42" },
        query: {},
        body: { reason: "Too much tea." },
      },
    ]);
    expect(outcome).toEqual({
      ok: true,
      result: { status: 200, body: { status: "cancelled" } },
    });
  });

  it("refuses an unusable intent with canned prose without ever invoking the adapter", async () => {
    let invoked = 0;
    const handler = httpIntentHandlerOf(() => {
      invoked += 1;
      return Promise.resolve({ status: 200, body: null });
    });
    const unusableIntents: (Record<string, unknown> | null)[] = [
      null,
      {},
      { ...WIRE_INTENT, action: undefined },
      { ...WIRE_INTENT, action: { slug: "cancel-subscription" } },
      { ...WIRE_INTENT, method: 7 },
      { ...WIRE_INTENT, path_template: "" },
      { ...WIRE_INTENT, path_params: "sub_42" },
    ];
    for (const intent of unusableIntents) {
      const outcome = await handler(httpIntentEntryOf(intent));
      expect(failureMessageOf(outcome)).toContain(
        "did not carry a usable intent",
      );
    }
    expect(invoked).toBe(0);
  });

  it("carries the API's own status, code and field problems as detail when the adapter's error has them", async () => {
    // The shape a typed HTTP client throws: a status beside the API's
    // error envelope. Duck-typed — the package imports no host.
    const apiError = Object.assign(new Error("Validation failed"), {
      status: 422,
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: [
          { loc: ["body", "title"], msg: "Field required" },
          { path: "body.body_md", message: "line 3: unknown directive" },
          { nonsense: true },
        ],
      },
    });
    const handler = httpIntentHandlerOf(() => Promise.reject(apiError));
    const outcome = await handler(httpIntentEntryOf(WIRE_INTENT));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.detail).toEqual({
        status: 422,
        code: "VALIDATION_ERROR",
        fields: [
          { path: "body.title", message: "Field required" },
          { path: "body.body_md", message: "line 3: unknown directive" },
        ],
      });
    }
    // The sentence carries the same facts, because the transcript's error
    // channel keeps only the sentence (the mapper's error.message).
    const message = failureMessageOf(outcome);
    expect(message).toContain("Validation failed");
    expect(message).toContain("HTTP 422 VALIDATION_ERROR — ");
    expect(message).toContain(
      'Field problems: "body.title": "Field required"; "body.body_md": "line 3: unknown directive". ',
    );
  });

  it("counts the problems the per-detail cap drops and says so on both carriers — a partial list never reads as the whole", async () => {
    const details = Array.from({ length: 25 }, (_, index) => ({
      path: `body.f${String(index)}`,
      message: `problem ${String(index)}`,
    }));
    const apiError = Object.assign(new Error("Validation failed"), {
      status: 422,
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details,
      },
    });
    const handler = httpIntentHandlerOf(() => Promise.reject(apiError));
    const outcome = await handler(httpIntentEntryOf(WIRE_INTENT));
    if (outcome.ok) {
      throw new Error("expected a failure");
    }
    expect(outcome.error.detail?.fields).toHaveLength(20);
    expect(outcome.error.detail?.fieldsOmitted).toBe(5);
    expect(outcome.error.message).toContain(
      '"body.f19": "problem 19"; and 5 more. Do not assume',
    );
    expect(actionFailureOf(outcome.error.message)?.detail).toEqual(
      outcome.error.detail,
    );
  });

  it("counts the problems the door fit drops on top of the cap's, keeps at least one, and stays under the cap", async () => {
    // 20 long fields pass the cap; the fit drops from the tail and every
    // drop is counted, so the sentence's "and N more" is the true tally
    // of what the API named and the record does not carry.
    const details = Array.from({ length: 23 }, (_, index) => ({
      path: `body.items.${String(index)}.` + "x".repeat(280),
      message: `Problem ${String(index)}: ` + "y".repeat(285),
    }));
    const apiError = Object.assign(new Error("Validation failed"), {
      status: 422,
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details,
      },
    });
    const handler = httpIntentHandlerOf(() => Promise.reject(apiError));
    const outcome = await handler(httpIntentEntryOf(WIRE_INTENT));
    if (outcome.ok) {
      throw new Error("expected a failure");
    }
    const kept = outcome.error.detail?.fields?.length ?? 0;
    expect(kept).toBeGreaterThanOrEqual(1);
    expect(kept).toBeLessThan(20);
    expect(outcome.error.detail?.fieldsOmitted).toBe(23 - kept);
    expect(outcome.error.message).toContain(`; and ${String(23 - kept)} more.`);
    expect(
      doorLengthCeilingOf(JSON.stringify(outcome.error)),
    ).toBeLessThanOrEqual(18_976);
    expect(actionFailureOf(outcome.error.message)?.detail).toEqual(
      outcome.error.detail,
    );
  });

  it("carries a lowercase, dotted or hyphenated code as itself, and the sentence round-trips it whole", async () => {
    for (const code of ["doc.slug-taken", "e42", "Validation-Error:body"]) {
      const apiError = Object.assign(new Error("Taken"), {
        status: 409,
        error: {
          code,
          message: "Taken",
          details: [{ path: "body.slug", message: "already used" }],
        },
      });
      const handler = httpIntentHandlerOf(() => Promise.reject(apiError));
      const outcome = await handler(httpIntentEntryOf(WIRE_INTENT));
      if (outcome.ok) {
        throw new Error("expected a failure");
      }
      expect(outcome.error.detail?.code).toBe(code);
      expect(outcome.error.message).toContain(`HTTP 409 ${code} — Taken.`);
      // The transcript keeps the sentence alone; the reader recovers
      // exactly the detail the JSON carried.
      expect(actionFailureOf(outcome.error.message)?.detail).toEqual(
        outcome.error.detail,
      );
    }
  });

  it("single-lines a field's path and message on both carriers, so the sentence and the detail agree", async () => {
    const apiError = Object.assign(new Error("Validation failed"), {
      status: 422,
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: [
          { loc: ["body", "body_md"], msg: "line 3:\n  unknown\tdirective\n" },
          { path: "body.title", message: "   \n  " },
        ],
      },
    });
    const handler = httpIntentHandlerOf(() => Promise.reject(apiError));
    const outcome = await handler(httpIntentEntryOf(WIRE_INTENT));
    if (outcome.ok) {
      throw new Error("expected a failure");
    }
    // The blank message says nothing and is dropped; the other is one line.
    expect(outcome.error.detail?.fields).toEqual([
      { path: "body.body_md", message: "line 3: unknown directive" },
    ]);
    expect(outcome.error.message).toContain(
      'Field problems: "body.body_md": "line 3: unknown directive". ',
    );
    expect(actionFailureOf(outcome.error.message)?.detail).toEqual(
      outcome.error.detail,
    );
  });

  it("round-trips a path-less problem carrying colon-space and semicolon-space, and a quoted word — the grammar's own delimiters stay inert", async () => {
    const details = [
      { message: "Something: happened; and more" },
      { path: "body.title", message: 'use "quotes": freely; always' },
    ];
    const apiError = Object.assign(new Error("Validation failed"), {
      status: 422,
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details,
      },
    });
    const handler = httpIntentHandlerOf(() => Promise.reject(apiError));
    const outcome = await handler(httpIntentEntryOf(WIRE_INTENT));
    if (outcome.ok) {
      throw new Error("expected a failure");
    }
    expect(outcome.error.detail?.fields).toEqual([
      { path: "", message: "Something: happened; and more" },
      { path: "body.title", message: 'use "quotes": freely; always' },
    ]);
    expect(actionFailureOf(outcome.error.message)?.detail).toEqual(
      outcome.error.detail,
    );
  });

  it("the COMPLETE interrupt envelope the server emits stays parseable and under the mapper's 20k clip", async () => {
    // The end-to-end carrier: the door records the error object, the
    // server frames it as failed_interrupt_response_of (toolresultv1.py)
    // with the canned instruction, tool_return_of json.dumps it with
    // Python's spaced separators, and the AG-UI mapper clips that text
    // at TOOL_RESULT_CONTENT_MAX_CHARS. The instruction is transcribed
    // here because this test pins that wire shape.
    const instruction =
      "The client could not complete this action. Read the error, explain " +
      "the problem to the user in plain language, and do not retry the " +
      "action unless the user asks you to.";
    const details = Array.from({ length: 20 }, (_, index) => ({
      path: `body.items.${String(index)}.` + "x".repeat(280),
      message: `Problem ${String(index)}: ` + "y".repeat(285),
    }));
    const apiError = Object.assign(new Error("z".repeat(14_000)), {
      status: 422,
      error: { code: "VALIDATION_ERROR", message: "big", details },
    });
    const handler = httpIntentHandlerOf(() => Promise.reject(apiError));
    const outcome = await handler(httpIntentEntryOf(WIRE_INTENT));
    if (outcome.ok) {
      throw new Error("expected a failure");
    }
    const envelope = pythonDumps({
      ok: false,
      error: outcome.error,
      instruction,
    });
    const errorAlone = pythonDumps(outcome.error);
    expect(errorAlone.length).toBeGreaterThan(18_000);
    expect(envelope.length).toBeLessThanOrEqual(20_000);
    expect(envelope.length - errorAlone.length).toBeLessThan(1_024);
    // Parseable whole — the mapper's clip leaves it untouched, so the
    // transcript keeps the real failure, never the generic sentence.
    const parsed = JSON.parse(envelope) as { error: { message: string } };
    expect(parsed.error.message).toContain('"Cancel a subscription" failed');
  });

  it("fits in a bounded number of passes, each one changing the candidate — the worst shape is a short reason over a field list barely past the cap", async () => {
    // Before the budget was seeded and clamped to the reason's real
    // door cost, this shape counted a 14,000-unit budget down by the
    // overshoot — one identical ~19k-character reserialization per unit
    // — for thousands of passes. Now a pass either drops a field or
    // shortens the reason, so passes are bounded by the field count
    // plus a handful of reason steps.
    let mostPasses = 0;
    let sawOneFieldDropped = false;
    for (let messageChars = 150; messageChars <= 260; messageChars += 2) {
      const details = Array.from({ length: 17 }, (_, index) => ({
        path: `body.items.${String(index)}.` + "x".repeat(280),
        message: "y".repeat(messageChars),
      }));
      const apiError = Object.assign(new Error("x"), {
        status: 422,
        error: { code: "VALIDATION_ERROR", message: "x", details },
      });
      const handler = httpIntentHandlerOf(() => Promise.reject(apiError));
      vi.mocked(doorLengthCeilingOf).mockClear();
      const outcome = await handler(httpIntentEntryOf(WIRE_INTENT));
      if (outcome.ok) {
        throw new Error("expected a failure");
      }
      const passes = vi.mocked(doorLengthCeilingOf).mock.calls.length;
      mostPasses = Math.max(mostPasses, passes);
      const kept = outcome.error.detail?.fields?.length ?? 0;
      if (kept === 16) {
        sawOneFieldDropped = true;
      }
      // One measuring pass per candidate; a candidate per dropped field
      // plus the first: exactly the field count dropped, plus one.
      expect(kept).toBeGreaterThanOrEqual(16);
      expect(passes).toBe(17 - kept + 1);
      expect(outcome.error.message).toContain("— x.");
    }
    expect(sawOneFieldDropped).toBe(true);
    expect(mostPasses).toBe(2);
  });

  it("a long reason barely over the cap shortens in one measured step, keeping every field", async () => {
    const details = Array.from({ length: 8 }, (_, index) => ({
      path: `body.f${String(index)}`,
      message: "w".repeat(300),
    }));
    const apiError = Object.assign(new Error("z".repeat(14_000)), {
      status: 422,
      error: { code: "VALIDATION_ERROR", message: "big", details },
    });
    const handler = httpIntentHandlerOf(() => Promise.reject(apiError));
    vi.mocked(doorLengthCeilingOf).mockClear();
    const outcome = await handler(httpIntentEntryOf(WIRE_INTENT));
    if (outcome.ok) {
      throw new Error("expected a failure");
    }
    expect(
      vi.mocked(doorLengthCeilingOf).mock.calls.length,
    ).toBeLessThanOrEqual(3);
    expect(outcome.error.detail?.fields).toHaveLength(8);
    expect(outcome.error.message).not.toContain("z".repeat(14_000));
    expect(outcome.error.message).toContain("z".repeat(13_000));
    expect(
      doorLengthCeilingOf(JSON.stringify(outcome.error)),
    ).toBeLessThanOrEqual(18_976);
  });

  it("drops the detail whole for a code with whitespace — it fits no sentence — and keeps the reason verbatim", async () => {
    const apiError = Object.assign(new Error("Taken"), {
      status: 409,
      error: {
        code: "slug taken",
        message: "Taken",
        details: [{ path: "body.slug", message: "already used" }],
      },
    });
    const handler = httpIntentHandlerOf(() => Promise.reject(apiError));
    const outcome = await handler(httpIntentEntryOf(WIRE_INTENT));
    if (outcome.ok) {
      throw new Error("expected a failure");
    }
    expect(outcome.error.detail).toBeUndefined();
    expect(outcome.error.message).not.toContain("HTTP");
    expect(outcome.error.message).not.toContain("Field problems");
    expect(outcome.error.message).toContain("failed in this page: Taken.");
  });

  it("carries only an HTTP status — 100 to 599 — and drops the detail whole for 0, a fraction, 99, 600 or 1000", async () => {
    // The reader's grammar is three digits; a host adapter's 0 (a
    // network failure) or an invented 1000 would leak "HTTP 0 CODE — "
    // into the member row and lose the fields to a non-parse. No detail
    // means no prefix and no clause: the reason rides alone.
    for (const status of [0, 42.5, 99, 600, 1000, -1]) {
      const apiError = Object.assign(new Error("Unreachable"), {
        status,
        error: {
          code: "NETWORK",
          message: "Unreachable",
          details: [{ path: "body.x", message: "y" }],
        },
      });
      const handler = httpIntentHandlerOf(() => Promise.reject(apiError));
      const outcome = await handler(httpIntentEntryOf(WIRE_INTENT));
      if (outcome.ok) {
        throw new Error("expected a failure");
      }
      expect(outcome.error.detail, String(status)).toBeUndefined();
      expect(outcome.error.message).not.toContain("HTTP");
      expect(outcome.error.message).not.toContain("Field problems");
      expect(outcome.error.message).toContain(
        "failed in this page: Unreachable.",
      );
    }
    for (const status of [100, 404, 599]) {
      const apiError = Object.assign(new Error("Nope"), {
        status,
        error: { code: "NOPE", message: "Nope" },
      });
      const handler = httpIntentHandlerOf(() => Promise.reject(apiError));
      const outcome = await handler(httpIntentEntryOf(WIRE_INTENT));
      if (outcome.ok) {
        throw new Error("expected a failure");
      }
      expect(outcome.error.detail?.status).toBe(status);
      expect(actionFailureOf(outcome.error.message)?.detail?.status).toBe(
        status,
      );
    }
  });

  it("adds no detail for a bare Error, and none for a status without an error code", async () => {
    for (const thrown of [
      new Error("Failed to fetch"),
      Object.assign(new Error("Gateway"), { status: 502 }),
      Object.assign(new Error("Odd"), { status: 500, error: { message: "x" } }),
    ]) {
      const handler = httpIntentHandlerOf(() => Promise.reject(thrown));
      const outcome = await handler(httpIntentEntryOf(WIRE_INTENT));
      if (!outcome.ok) {
        expect(outcome.error.detail).toBeUndefined();
      }
    }
  });

  it("shapes a failing execution into the action's title and reason — never a stack", async () => {
    const handler = httpIntentHandlerOf(() =>
      Promise.reject(
        new Error("Failed to fetch\n    at perform (adapter.ts:12)"),
      ),
    );
    const outcome = await handler(httpIntentEntryOf(WIRE_INTENT));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("execution_failed");
    }
    const message = failureMessageOf(outcome);
    expect(message).toContain('"Cancel a subscription" failed');
    expect(message).toContain("Failed to fetch");
    expect(message).not.toContain("at perform");
    expect(message).toContain("Do not assume the action ran");
  });

  it("carries a long server teach-back whole — the 422 offender list is the reason, not a stack to tersen", async () => {
    // The server's teach-back law: a 422 lists EVERY offender, budgeted
    // to ~12k door units. The action-failure reason must not amputate it
    // at the terse host-error bound.
    const offenders = Array.from({ length: 40 }, (_, index) => {
      const ordinal = String(index + 1);
      return (
        `Section "Core concepts", doc ${ordinal}: "What is thing ` +
        `${ordinal}?" is a question — questions live in FAQ bodies ` +
        `and H3 anchors, never in titles.`
      );
    });
    const teachBack =
      "The plan was not accepted: " +
      offenders.join(" ") +
      " Fix every problem and submit again.";
    expect(teachBack.length).toBeGreaterThan(4_000);
    const handler = httpIntentHandlerOf(() =>
      Promise.reject(new Error(teachBack)),
    );
    const outcome = await handler(httpIntentEntryOf(WIRE_INTENT));
    const message = failureMessageOf(outcome);
    expect(message).toContain(offenders[0]);
    expect(message).toContain(offenders[39]);
    expect(message).toContain("Fix every problem and submit again.");
  });

  it("keeps the terse default path in raw characters — a CJK host error is not shrunk 6x", async () => {
    // Only the ACTION path bounds by escaped cost; the navigation
    // failure's readability slice stays raw, so a non-ASCII host error
    // reaches the model at its full 300 characters.
    const handler = navigateHandlerOf(() => {
      throw new Error("分".repeat(400));
    });
    const outcome = await handler(navigateEntryOf({ path: "/somewhere" }));
    expect(failureMessageOf(outcome)).toContain("分".repeat(300));
    expect(failureMessageOf(outcome)).not.toContain("分".repeat(301));
  });

  it("fits a many-field 422 under the door's cap whole — the sentence and the detail shrink together, and the real failure survives", async () => {
    // Each field rides twice (the sentence and detail.fields), so twenty
    // 300-char paths and messages alone pass the door's 20k; the door
    // would then drop the payload for its canned too-large failure,
    // whose instruction says the action ran.
    const details = Array.from({ length: 20 }, (_, index) => ({
      path: `body.items.${String(index)}.` + "x".repeat(280),
      message: `Problem ${String(index)}: ` + "y".repeat(285),
    }));
    const apiError = Object.assign(new Error("Validation failed"), {
      status: 422,
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details,
      },
    });
    const handler = httpIntentHandlerOf(() => Promise.reject(apiError));
    const outcome = await handler(httpIntentEntryOf(WIRE_INTENT));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(
      doorLengthCeilingOf(JSON.stringify(outcome.error)),
    ).toBeLessThanOrEqual(20_000);
    const message = outcome.error.message;
    expect(message).toContain('"Cancel a subscription" failed');
    expect(message).toContain("HTTP 422 VALIDATION_ERROR — Validation failed.");
    expect(message).toContain("Do not assume the action ran");
    const kept = outcome.error.detail?.fields ?? [];
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(20);
    // The two carriers agree: the sentence names exactly the fields the
    // detail keeps, from the head of the list.
    expect(kept).toEqual(details.slice(0, kept.length));
    expect(message).toContain(kept[kept.length - 1].message);
    expect(message).not.toContain(details[kept.length].message);
  });

  it("gives up reason before field problems, but never below the reason's floor", async () => {
    const teachBack = "Every offender: " + "z".repeat(13_900);
    const details = Array.from({ length: 20 }, (_, index) => ({
      path: `body.f${String(index)}`,
      message: "w".repeat(300),
    }));
    const apiError = Object.assign(new Error(teachBack), {
      status: 422,
      error: { code: "VALIDATION_ERROR", message: teachBack, details },
    });
    const handler = httpIntentHandlerOf(() => Promise.reject(apiError));
    const outcome = await handler(httpIntentEntryOf(WIRE_INTENT));
    if (outcome.ok) {
      throw new Error("expected a failure");
    }
    expect(
      doorLengthCeilingOf(JSON.stringify(outcome.error)),
    ).toBeLessThanOrEqual(20_000);
    // The reason kept at least its 2,000-char floor; the field list
    // absorbed the rest and stayed non-empty.
    expect(outcome.error.message).toContain(
      "Every offender: " + "z".repeat(1_900),
    );
    expect(outcome.error.message).not.toContain("z".repeat(13_900));
    expect(outcome.error.detail?.fields?.length).toBeGreaterThan(0);
  });

  it("still bounds a pathological reason by its escaped door cost", async () => {
    const handler = httpIntentHandlerOf(() =>
      Promise.reject(new Error("分".repeat(20_000))),
    );
    const outcome = await handler(httpIntentEntryOf(WIRE_INTENT));
    const message = failureMessageOf(outcome);
    // 14,000 escaped chars at 6 per CJK unit keeps ~2,333 characters.
    expect(message.length).toBeLessThan(3_000);
    expect(message).toContain("Do not assume the action ran");
  });
});
