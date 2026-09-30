import { describe, expect, it, vi } from "vitest";

import {
  approvalCardSchemasOf,
  toolSchemaAnchorOf,
  toolSchemaRecorder,
  wellFormedToolSchemaAnchorsOf,
  withToolSchemasAnchored,
  type ToolCallSchemas,
} from "../src/core/tool-schema-anchors";
import { StreamResumeStore } from "../src/transport/stream-resume";

const INPUT_SCHEMA = {
  type: "object",
  properties: { query: { type: "string" } },
};
const OUTPUT_SCHEMA = {
  type: "object",
  properties: { hits: { type: "array" } },
};

function markerValue(fields: Record<string, unknown> = {}) {
  return {
    tool_call_id: "t1",
    display: { progress_text: "Searching your docs…" },
    tool_input_schema: INPUT_SCHEMA,
    ...fields,
  };
}

function customEvent(value: unknown) {
  return { type: "CUSTOM", name: "tool_call_annotated", value };
}

describe("toolSchemaAnchorOf", () => {
  it("narrows the marker's schema siblings to the client contract", () => {
    const anchor = toolSchemaAnchorOf(
      markerValue({ tool_output_schema: OUTPUT_SCHEMA }),
    );
    expect(anchor).toEqual({
      toolCallId: "t1",
      schemas: { argsSchema: INPUT_SCHEMA, resultSchema: OUTPUT_SCHEMA },
    });
    // Verbatim references, never copies: identity is the delivery
    // guard's change signal downstream.
    expect(anchor?.schemas.argsSchema).toBe(INPUT_SCHEMA);
  });

  it("carries one schema without inventing the other", () => {
    const anchor = toolSchemaAnchorOf(markerValue());
    expect(anchor?.schemas).toEqual({ argsSchema: INPUT_SCHEMA });
    expect(anchor?.schemas).not.toHaveProperty("resultSchema");
  });

  it("anchors nothing for a display-only annotation", () => {
    expect(
      toolSchemaAnchorOf({
        tool_call_id: "t1",
        display: { complete_text: "Searched your docs" },
      }),
    ).toBeNull();
  });

  it("treats null, arrays, and non-records as absent — never `{}`", () => {
    for (const malformed of [null, [], "schema", 7]) {
      expect(
        toolSchemaAnchorOf(markerValue({ tool_input_schema: malformed })),
      ).toBeNull();
    }
    // A malformed half never blanks the sound half.
    const anchor = toolSchemaAnchorOf(
      markerValue({
        tool_input_schema: null,
        tool_output_schema: OUTPUT_SCHEMA,
      }),
    );
    expect(anchor?.schemas).toEqual({ resultSchema: OUTPUT_SCHEMA });
  });

  it("ignores a marker without a usable tool_call_id", () => {
    expect(toolSchemaAnchorOf(markerValue({ tool_call_id: "" }))).toBeNull();
    expect(toolSchemaAnchorOf(markerValue({ tool_call_id: 7 }))).toBeNull();
    expect(toolSchemaAnchorOf("not a record")).toBeNull();
  });
});

describe("withToolSchemasAnchored", () => {
  it("first non-absent value per field wins, and re-application is a no-op", () => {
    const first = withToolSchemasAnchored(new Map(), "t1", {
      argsSchema: INPUT_SCHEMA,
    });
    const second = withToolSchemasAnchored(first, "t1", {
      argsSchema: { type: "object", properties: {} },
      resultSchema: OUTPUT_SCHEMA,
    });
    expect(second.get("t1")).toEqual({
      argsSchema: INPUT_SCHEMA,
      resultSchema: OUTPUT_SCHEMA,
    });
    // The merged entry keeps the previously stored field REFERENCE —
    // the slot's delivery guard compares `===`.
    expect(second.get("t1")?.argsSchema).toBe(INPUT_SCHEMA);
    const third = withToolSchemasAnchored(second, "t1", {
      argsSchema: INPUT_SCHEMA,
      resultSchema: OUTPUT_SCHEMA,
    });
    expect(third).toBe(second);
  });

  it("returns the map unchanged when the merge adds nothing — identity is the publish gate", () => {
    const anchored = withToolSchemasAnchored(new Map(), "t1", {
      argsSchema: INPUT_SCHEMA,
    });
    expect(
      withToolSchemasAnchored(anchored, "t1", { argsSchema: INPUT_SCHEMA }),
    ).toBe(anchored);
  });
});

describe("wellFormedToolSchemaAnchorsOf", () => {
  it("keeps well-formed entries and drops stale shapes fail-closed", () => {
    const stored = new Map<string, ToolCallSchemas>([
      ["t1", { argsSchema: INPUT_SCHEMA }],
      ["t2", { resultSchema: OUTPUT_SCHEMA }],
      // A future persisted store's stale shapes: dropped, never a crash.
      ["t3", {}],
      ["t4", { argsSchema: "broken" } as unknown as ToolCallSchemas],
      ["t5", null as unknown as ToolCallSchemas],
    ]);
    const seeded = wellFormedToolSchemaAnchorsOf(stored);
    expect([...seeded.keys()]).toEqual(["t1", "t2"]);
  });
});

describe("toolSchemaRecorder", () => {
  it("records an annotated call's toolCallId and narrowed schemas", () => {
    const onSchemasAnchored = vi.fn();
    const recorder = toolSchemaRecorder(onSchemasAnchored);

    void recorder.onCustomEvent?.({
      event: customEvent(markerValue()),
    } as never);

    expect(onSchemasAnchored).toHaveBeenCalledWith("t1", {
      argsSchema: INPUT_SCHEMA,
    });
  });

  it("ignores other markers, display-only annotations, and malformed values", () => {
    const onSchemasAnchored = vi.fn();
    const recorder = toolSchemaRecorder(onSchemasAnchored);

    void recorder.onCustomEvent?.({
      event: { type: "CUSTOM", name: "run_resumed", value: { attempt: 2 } },
    } as never);
    void recorder.onCustomEvent?.({
      event: customEvent({
        tool_call_id: "t1",
        display: { progress_text: "Searching…" },
      }),
    } as never);
    void recorder.onCustomEvent?.({
      event: customEvent({ tool_input_schema: INPUT_SCHEMA }),
    } as never);

    expect(onSchemasAnchored).not.toHaveBeenCalled();
  });
});

describe("approvalCardSchemasOf", () => {
  it("converts the card's null-when-absent fields to absent-when-absent", () => {
    expect(
      approvalCardSchemasOf({
        toolInputSchema: INPUT_SCHEMA,
        toolOutputSchema: OUTPUT_SCHEMA,
      }),
    ).toEqual({ argsSchema: INPUT_SCHEMA, resultSchema: OUTPUT_SCHEMA });
    expect(
      approvalCardSchemasOf({
        toolInputSchema: INPUT_SCHEMA,
        toolOutputSchema: null,
      }),
    ).toEqual({ argsSchema: INPUT_SCHEMA });
  });

  it("answers null for a card carrying neither — nothing to anchor", () => {
    expect(
      approvalCardSchemasOf({ toolInputSchema: null, toolOutputSchema: null }),
    ).toBeNull();
  });
});

describe("StreamResumeStore.recordToolSchemas", () => {
  it("folds into the store's map with the first-wins merge", () => {
    const store = new StreamResumeStore();
    store.recordToolSchemas("t1", { argsSchema: INPUT_SCHEMA });
    const after = store.toolSchemaAnchors;
    expect(after.get("t1")).toEqual({ argsSchema: INPUT_SCHEMA });
    // Re-recording the same fact is a no-op: identity is the publish gate.
    store.recordToolSchemas("t1", { argsSchema: INPUT_SCHEMA });
    expect(store.toolSchemaAnchors).toBe(after);
  });
});
