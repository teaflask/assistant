// @vitest-environment jsdom
// The builtin.prefill_form path: the fill mechanics per control type
// (prototype-setter writes with real bubbling events, so a framework's
// change handling hears them), the always-on refusals (secrets, files,
// inert controls — the write-side twin of the snapshot's redaction), the
// read-back honesty rule, and the handler contract.

import { beforeEach, describe, expect, it } from "vitest";

import { prefilledFieldsReport } from "../src/affordances/prefill";
import {
  executionHandlersFor,
  PREFILL_FORM_REQUEST_KIND,
  type ExecutionHandler,
  type ExecutionOutcome,
} from "../src/core/execution-handlers";
import type { ExecutionEntryModel } from "../src/core/execution-inbox";
import {
  snapshotTreeOf,
  type SnapshotNode,
  type SnapshotOptions,
} from "../src/reader/snapshot";
import { fakeLayoutProbeOf } from "./reader-fakes";

beforeEach(() => {
  document.body.innerHTML = "";
});

function prefillEntryOf(
  action: Record<string, unknown> | null,
): ExecutionEntryModel {
  return {
    interruptId: "v1:tool_call:t9",
    toolName: "prefill_form",
    toolCallId: "run-1-a1-t9",
    anchored: false,
    kind: PREFILL_FORM_REQUEST_KIND,
    action,
    intent: null,
    round: 0,
    runId: "run-1",
    status: { kind: "pending" },
    asker: { kind: "assistant" },
    turnId: null,
  };
}

function prefillHandlerOf(): ExecutionHandler {
  const handler = executionHandlersFor(null, null, "thread-under-test").get(
    PREFILL_FORM_REQUEST_KIND,
  );
  if (handler === undefined) {
    throw new Error("The registry lost its prefill_form handler.");
  }
  return handler;
}

function failureMessageOf(outcome: ExecutionOutcome): string {
  if (outcome.ok) {
    throw new Error("Expected a failure outcome.");
  }
  return outcome.error.message;
}

/** Walk a fresh snapshot and return the ref the reader minted for the
 * element — the same ref the model would quote back. */
function mintedRefOf(element: Element, showHidden = false): string {
  const options: SnapshotOptions = {
    probe: fakeLayoutProbeOf(),
    ignoreSelectors: [],
    maxDepth: 50,
    interactive: false,
    showHidden,
    selector: null,
    refId: null,
    rootElement: null,
  };
  const outcome = snapshotTreeOf(options);
  if (outcome.tree === null) {
    throw new Error(`The seeding snapshot failed: ${outcome.error}`);
  }
  const ref = _refInTree(outcome.tree, element);
  if (ref === null) {
    throw new Error("The reader minted no ref for the target element.");
  }
  return ref;
}

function _refInTree(node: SnapshotNode, element: Element): string | null {
  if (node.element === element && node.refId !== null) {
    return node.refId;
  }
  for (const child of node.children) {
    if (typeof child === "string") {
      continue;
    }
    const found = _refInTree(child, element);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the concrete element type the fixture returns; asserting at every call site would say the same thing louder.
function fixtureElementOf<T extends Element>(
  html: string,
  selector: string,
): T {
  document.body.innerHTML = html;
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`The fixture lost its "${selector}".`);
  }
  return element;
}

function soleRefusalReasonOf(refId: string, value: string): string {
  const report = prefilledFieldsReport([{ refId, value }]);
  expect(report.filled).toEqual([]);
  expect(report.refused).toHaveLength(1);
  return report.refused[0].reason;
}

describe("filling text-like controls", () => {
  it("writes a text input through the prototype setter and announces with bubbling input+change", () => {
    const input = fixtureElementOf<HTMLInputElement>(
      '<form><label>Name <input id="name" /></label></form>',
      "#name",
    );
    const heard: string[] = [];
    const form = document.querySelector("form");
    form?.addEventListener("input", () => heard.push(`input:${input.value}`));
    form?.addEventListener("change", () => heard.push(`change:${input.value}`));
    const refId = mintedRefOf(input);

    const report = prefilledFieldsReport([{ refId, value: "Ada Lovelace" }]);

    expect(report).toEqual({ filled: [refId], refused: [] });
    expect(input.value).toBe("Ada Lovelace");
    // Both events bubbled to the form with the value already in place.
    expect(heard).toEqual(["input:Ada Lovelace", "change:Ada Lovelace"]);
  });

  it("fills a textarea the same way", () => {
    const textArea = fixtureElementOf<HTMLTextAreaElement>(
      '<label>Notes <textarea id="notes"></textarea></label>',
      "#notes",
    );
    const refId = mintedRefOf(textArea);

    const report = prefilledFieldsReport([{ refId, value: "Two sugars." }]);

    expect(report.filled).toEqual([refId]);
    expect(textArea.value).toBe("Two sugars.");
  });

  it("reports a value the page's own scripts rejected as refused, never as filled", () => {
    const input = fixtureElementOf<HTMLInputElement>(
      '<label>Qty <input id="qty" /></label>',
      "#qty",
    );
    // The page fights back: an input listener that resets the value.
    input.addEventListener("input", () => {
      input.value = "";
    });
    const refId = mintedRefOf(input);

    expect(soleRefusalReasonOf(refId, "9000")).toContain(
      "did not stay in the field",
    );
  });
});

describe("the always-on refusals", () => {
  it("never fills a password field", () => {
    const input = fixtureElementOf<HTMLInputElement>(
      '<label>Password <input id="pw" type="password" /></label>',
      "#pw",
    );
    const refId = mintedRefOf(input);

    expect(soleRefusalReasonOf(refId, "hunter2")).toContain("secret");
    expect(input.value).toBe("");
  });

  it("never fills a field whose autocomplete declares a secret", () => {
    const input = fixtureElementOf<HTMLInputElement>(
      '<label>Card <input id="card" autocomplete="billing cc-number" /></label>',
      "#card",
    );
    const refId = mintedRefOf(input);

    expect(soleRefusalReasonOf(refId, "4242")).toContain("secret");
    expect(input.value).toBe("");
  });

  it("never fills a file picker", () => {
    const input = fixtureElementOf<HTMLInputElement>(
      '<label>Upload <input id="file" type="file" /></label>',
      "#file",
    );
    const refId = mintedRefOf(input);

    expect(soleRefusalReasonOf(refId, "/etc/passwd")).toContain("File pickers");
  });

  it("refuses disabled and read-only controls", () => {
    const disabled = fixtureElementOf<HTMLInputElement>(
      '<label>Locked <input id="locked" disabled /></label>' +
        '<label>Frozen <input id="frozen" readonly /></label>',
      "#locked",
    );
    const frozen = document.querySelector<HTMLInputElement>("#frozen");
    if (frozen === null) {
      throw new Error('The fixture lost its "#frozen".');
    }
    const disabledRef = mintedRefOf(disabled);
    const frozenRef = mintedRefOf(frozen);

    const report = prefilledFieldsReport([
      { refId: disabledRef, value: "x" },
      { refId: frozenRef, value: "y" },
    ]);

    expect(report.filled).toEqual([]);
    expect(report.refused.map((entry) => entry.ref_id)).toEqual([
      disabledRef,
      frozenRef,
    ]);
    for (const entry of report.refused) {
      expect(entry.reason).toContain("disabled or read-only");
    }
  });

  it("refuses an element that is not a form field", () => {
    const button = fixtureElementOf<HTMLButtonElement>(
      "<button id='go'>Go</button>",
      "#go",
    );
    const refId = mintedRefOf(button);

    expect(soleRefusalReasonOf(refId, "anything")).toContain(
      "not a fillable form field",
    );
  });

  it("never relabels a button-family input — its value is the visible caption", () => {
    const submit = fixtureElementOf<HTMLInputElement>(
      '<form><input id="save" type="submit" value="Save" /></form>',
      "#save",
    );
    const refId = mintedRefOf(submit);

    expect(soleRefusalReasonOf(refId, "Delete everything")).toContain(
      "not a fillable form field",
    );
    expect(submit.value).toBe("Save");
  });

  it("answers a ref that is not on the page with the reader's own sentence", () => {
    const report = prefilledFieldsReport([{ refId: "e9999", value: "x" }]);

    expect(report.refused[0].reason).toContain("take a fresh full read");
  });
});

describe("checkboxes and radios", () => {
  it('checks a checkbox for "true" and unchecks it for "false" — a real click, reversible', () => {
    const checkbox = fixtureElementOf<HTMLInputElement>(
      '<label>Subscribe <input id="sub" type="checkbox" /></label>',
      "#sub",
    );
    const refId = mintedRefOf(checkbox);

    expect(prefilledFieldsReport([{ refId, value: "true" }]).filled).toEqual([
      refId,
    ]);
    expect(checkbox.checked).toBe(true);

    expect(prefilledFieldsReport([{ refId, value: "false" }]).filled).toEqual([
      refId,
    ]);
    expect(checkbox.checked).toBe(false);
  });

  it("leaves an already-right checkbox alone and still reports it filled", () => {
    const checkbox = fixtureElementOf<HTMLInputElement>(
      '<label>Subscribe <input id="sub" type="checkbox" checked /></label>',
      "#sub",
    );
    let clicks = 0;
    checkbox.addEventListener("click", () => {
      clicks += 1;
    });
    const refId = mintedRefOf(checkbox);

    expect(prefilledFieldsReport([{ refId, value: "true" }]).filled).toEqual([
      refId,
    ]);
    expect(clicks).toBe(0);
  });

  it('selects a radio for "true" and refuses "false" — deselection is picking another option', () => {
    const radio = fixtureElementOf<HTMLInputElement>(
      '<label>Green <input id="green" type="radio" name="tea" /></label>',
      "#green",
    );
    const refId = mintedRefOf(radio);

    expect(prefilledFieldsReport([{ refId, value: "true" }]).filled).toEqual([
      refId,
    ]);
    expect(radio.checked).toBe(true);

    expect(soleRefusalReasonOf(refId, "false")).toContain(
      "can only be selected",
    );
  });

  it("refuses a checkbox value that is not true/false", () => {
    const checkbox = fixtureElementOf<HTMLInputElement>(
      '<label>Subscribe <input id="sub" type="checkbox" /></label>',
      "#sub",
    );
    const refId = mintedRefOf(checkbox);

    expect(soleRefusalReasonOf(refId, "yes")).toContain('"true" or "false"');
  });
});

describe("dropdowns", () => {
  const SELECT_FIXTURE =
    '<label>Blend <select id="blend">' +
    '<option value="">Pick one</option>' +
    '<option value="earl-grey">Earl Grey</option>' +
    '<option value="sencha">Sencha</option>' +
    "</select></label>";

  it("matches an option by its value", () => {
    const select = fixtureElementOf<HTMLSelectElement>(
      SELECT_FIXTURE,
      "#blend",
    );
    const heard: string[] = [];
    select.addEventListener("change", () => heard.push(select.value));
    const refId = mintedRefOf(select);

    const report = prefilledFieldsReport([{ refId, value: "sencha" }]);

    expect(report.filled).toEqual([refId]);
    expect(select.value).toBe("sencha");
    expect(heard).toEqual(["sencha"]);
  });

  it("matches an option by its visible label — the model quotes what it saw", () => {
    const select = fixtureElementOf<HTMLSelectElement>(
      SELECT_FIXTURE,
      "#blend",
    );
    const refId = mintedRefOf(select);

    expect(
      prefilledFieldsReport([{ refId, value: "Earl Grey" }]).filled,
    ).toEqual([refId]);
    expect(select.value).toBe("earl-grey");
  });

  it("refuses a value no option matches", () => {
    const select = fixtureElementOf<HTMLSelectElement>(
      SELECT_FIXTURE,
      "#blend",
    );
    const refId = mintedRefOf(select);

    expect(soleRefusalReasonOf(refId, "coffee")).toContain(
      "No option in this dropdown",
    );
  });
});

describe("rich editors", () => {
  it("refuses honestly where the editor pipeline is unavailable (jsdom has no execCommand)", () => {
    const editor = fixtureElementOf<HTMLElement>(
      '<div id="editor" contenteditable="true" role="textbox" aria-label="Body"></div>',
      "#editor",
    );
    const refId = mintedRefOf(editor);

    expect(soleRefusalReasonOf(refId, "Hello")).toContain(
      "cannot be filled on this page",
    );
  });
});

describe("the batch report", () => {
  it("fills what it can and refuses the rest, field by field, in request order", () => {
    document.body.innerHTML =
      '<label>Name <input id="name" /></label>' +
      '<label>Password <input id="pw" type="password" /></label>' +
      '<label>Notes <textarea id="notes"></textarea></label>';
    const name = document.querySelector<HTMLInputElement>("#name");
    const password = document.querySelector<HTMLInputElement>("#pw");
    const notes = document.querySelector<HTMLTextAreaElement>("#notes");
    if (name === null || password === null || notes === null) {
      throw new Error("The fixture lost its fields.");
    }
    const nameRef = mintedRefOf(name);
    const passwordRef = mintedRefOf(password);
    const notesRef = mintedRefOf(notes);

    const report = prefilledFieldsReport([
      { refId: nameRef, value: "Ada" },
      { refId: passwordRef, value: "hunter2" },
      { refId: notesRef, value: "Oolong." },
    ]);

    expect(report.filled).toEqual([nameRef, notesRef]);
    expect(report.refused.map((entry) => entry.ref_id)).toEqual([passwordRef]);
    expect(name.value).toBe("Ada");
    expect(notes.value).toBe("Oolong.");
    expect(password.value).toBe("");
  });
});

describe("the prefill_form handler", () => {
  it("fills through the registry and synthesizes the strict PrefillFormResult itself", async () => {
    const input = fixtureElementOf<HTMLInputElement>(
      '<label>Name <input id="name" /></label>',
      "#name",
    );
    const refId = mintedRefOf(input);

    const outcome = await prefillHandlerOf()(
      prefillEntryOf({ fields: [{ ref_id: refId, value: "Ada" }] }),
    );

    expect(outcome).toEqual({
      ok: true,
      result: { filled: [refId], refused: [] },
    });
    expect(input.value).toBe("Ada");
  });

  it("refuses unusable fields with canned prose without touching the page", async () => {
    const input = fixtureElementOf<HTMLInputElement>(
      '<label>Name <input id="name" /></label>',
      "#name",
    );
    const refId = mintedRefOf(input);
    const unusableActions: (Record<string, unknown> | null)[] = [
      null,
      {},
      { fields: [] },
      { fields: "everything" },
      { fields: [{ ref_id: refId }] },
      { fields: [{ value: "Ada" }] },
      { fields: [{ ref_id: refId, value: 7 }] },
      { fields: ["not-an-object"] },
    ];
    for (const action of unusableActions) {
      const outcome = await prefillHandlerOf()(prefillEntryOf(action));
      expect(failureMessageOf(outcome)).toContain(
        "did not carry usable fields",
      );
    }
    expect(input.value).toBe("");
  });
});
