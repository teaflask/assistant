// @vitest-environment jsdom
// The builtin.read_page handler through the registry — the reader's own
// walk is covered in read-page.test.ts; this file pins the handler
// contract: registered unconditionally, outcome shape, failure prose.

import { beforeEach, describe, expect, it } from "vitest";

import {
  executionHandlersFor,
  READ_PAGE_REQUEST_KIND,
  type ExecutionHandler,
} from "../src/core/execution-handlers";
import type { ExecutionEntryModel } from "../src/core/execution-inbox";
import { _resetBaselinesForTests } from "../src/reader/read-page";

function readPageEntryOf(
  action: Record<string, unknown> | null,
): ExecutionEntryModel {
  return {
    interruptId: "v1:tool_call:t7",
    toolName: "read_page",
    toolCallId: "run-1-a1-t7",
    anchored: false,
    kind: READ_PAGE_REQUEST_KIND,
    action,
    intent: null,
    round: 0,
    runId: "run-1",
    status: { kind: "pending" },
    asker: { kind: "assistant" },
    turnId: null,
  };
}

function readPageHandlerOf(threadId: string): ExecutionHandler {
  const handler = executionHandlersFor(null, null, threadId).get(
    READ_PAGE_REQUEST_KIND,
  );
  if (handler === undefined) {
    throw new Error("The registry lost its read_page handler.");
  }
  return handler;
}

beforeEach(() => {
  _resetBaselinesForTests();
  document.body.innerHTML = "";
  document.title = "Handler test page";
});

describe("the read_page handler", () => {
  it("delivers the strict result shape from a bare mount", async () => {
    document.body.innerHTML = "<h1>Invoices</h1><button>New invoice</button>";
    const outcome = await readPageHandlerOf("thread-a")(readPageEntryOf(null));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("Expected a success outcome.");
    }
    expect(Object.keys(outcome.result).sort()).toEqual([
      "content",
      "is_diff",
      "title",
      "truncated",
      "url",
    ]);
    expect(outcome.result.title).toBe("Handler test page");
    expect(outcome.result.is_diff).toBe(false);
    expect(outcome.result.truncated).toBe(false);
    expect(String(outcome.result.content)).toContain('- heading "Invoices"');
  });

  it("applies the request's ignore selectors from the wire", async () => {
    document.body.innerHTML =
      '<div class="private"><h2>Hidden rows</h2></div><h2>Fine</h2>';
    const outcome = await readPageHandlerOf("thread-b")(
      readPageEntryOf({ ignore_selectors: [".private"] }),
    );
    if (!outcome.ok) {
      throw new Error("Expected a success outcome.");
    }
    expect(String(outcome.result.content)).not.toContain("Hidden rows");
  });

  it("delivers a read refusal's own recovery sentence verbatim", async () => {
    document.body.innerHTML = "<button>Anything</button>";
    const outcome = await readPageHandlerOf("thread-c")(
      readPageEntryOf({ ref_id: "e999999" }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      throw new Error("Expected a failure outcome.");
    }
    expect(outcome.error.code).toBe("execution_failed");
    // The reader's sentence asks for a retry ("take a fresh full read");
    // the give-up wrapper would cancel exactly that.
    expect(outcome.error.message).toContain("fresh full read");
    expect(outcome.error.message).not.toContain("Reading this page failed");
    expect(outcome.error.message).not.toContain("Ask the user");
  });
});
