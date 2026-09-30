import { describe, expect, it, vi } from "vitest";

import type { ToolCallDisplay } from "../src/core/tool-call-display";
import {
  EMPTY_TOOL_CALL_DISPLAY_ANCHORS,
  toolCallDisplayAnchorOf,
  toolCallDisplayRecorder,
  wellFormedToolCallDisplayAnchorsOf,
  withToolCallDisplayAnchored,
} from "../src/core/tool-call-display-anchors";
import { StreamResumeStore } from "../src/transport/stream-resume";

const PROGRESS = "Searching your docs for “steeping sencha”…";
const COMPLETE = "Searched your docs for “steeping sencha” — 3 results";

function markerValue(fields: Record<string, unknown> = {}) {
  return {
    tool_call_id: "t1",
    display: { progress_text: PROGRESS },
    ...fields,
  };
}

function customEvent(value: unknown) {
  return { type: "CUSTOM", name: "tool_call_annotated", value };
}

describe("toolCallDisplayAnchorOf", () => {
  it("narrows the wire's snake_case payload to the display contract", () => {
    const anchor = toolCallDisplayAnchorOf(
      markerValue({
        display: {
          progress_text: PROGRESS,
          complete_text: COMPLETE,
        },
      }),
    );
    expect(anchor).toEqual({
      toolCallId: "t1",
      display: { progressText: PROGRESS, completeText: COMPLETE },
    });
  });

  it("carries a single-sentence display without inventing the other field", () => {
    const anchor = toolCallDisplayAnchorOf(markerValue());
    expect(anchor?.display).toEqual({ progressText: PROGRESS });
    expect(anchor?.display).not.toHaveProperty("completeText");
  });

  it("treats a stale `kind` as an unrecognized field — ignored, never display-blanking", () => {
    // `kind` is on neither the wire nor the client model. The
    // contract's rule for fields this build does not recognize is to
    // ignore THE FIELD — a legacy or future `kind` beside recognized
    // copy must not blank the whole display (a gate that rejected the
    // whole payload is the recorded regression).
    for (const kind of ["text", "chart", 7]) {
      const anchor = toolCallDisplayAnchorOf(
        markerValue({ display: { kind, progress_text: PROGRESS } }),
      );
      expect(anchor?.display).toEqual({ progressText: PROGRESS });
      expect(anchor?.display).not.toHaveProperty("kind");
    }
  });

  it("ignores blank sentences and displays carrying no recognized field at all", () => {
    expect(toolCallDisplayAnchorOf(markerValue({ display: {} }))).toBeNull();
    expect(
      toolCallDisplayAnchorOf(markerValue({ display: { kind: "text" } })),
    ).toBeNull();
    expect(
      toolCallDisplayAnchorOf(
        markerValue({ display: { progress_text: "   " } }),
      ),
    ).toBeNull();
  });

  it("rejects malformed values instead of throwing", () => {
    expect(toolCallDisplayAnchorOf(null)).toBeNull();
    expect(toolCallDisplayAnchorOf("annotated")).toBeNull();
    expect(
      toolCallDisplayAnchorOf(markerValue({ tool_call_id: 7 })),
    ).toBeNull();
    expect(
      toolCallDisplayAnchorOf(markerValue({ tool_call_id: "" })),
    ).toBeNull();
    expect(
      toolCallDisplayAnchorOf(markerValue({ display: "text" })),
    ).toBeNull();
    expect(
      toolCallDisplayAnchorOf(markerValue({ display: { progress_text: 7 } })),
    ).toBeNull();
  });

  it("caps a runaway sentence instead of retaining it unbounded", () => {
    const anchor = toolCallDisplayAnchorOf(
      markerValue({
        display: { progress_text: "n".repeat(50_000) },
      }),
    );
    expect(anchor?.display.progressText?.length).toBe(500);
  });
});

describe("withToolCallDisplayAnchored", () => {
  it("merges per field: the progress marker and the completion marker compose", () => {
    let anchors: ReadonlyMap<string, ToolCallDisplay> = new Map();
    anchors = withToolCallDisplayAnchored(anchors, "t1", {
      progressText: PROGRESS,
    });
    anchors = withToolCallDisplayAnchored(anchors, "t1", {
      completeText: COMPLETE,
    });
    expect(anchors.get("t1")).toEqual({
      progressText: PROGRESS,
      completeText: COMPLETE,
    });
  });

  it("keeps the first value per field: a tool body's richer completion beats the hook's fallback", () => {
    let anchors: ReadonlyMap<string, ToolCallDisplay> = new Map();
    anchors = withToolCallDisplayAnchored(anchors, "t1", {
      completeText: COMPLETE,
    });
    anchors = withToolCallDisplayAnchored(anchors, "t1", {
      completeText: "Searched your docs",
    });
    expect(anchors.get("t1")?.completeText).toBe(COMPLETE);
  });

  it("is idempotent under replay: a no-op merge returns the map unchanged", () => {
    const once = withToolCallDisplayAnchored(new Map(), "t1", {
      progressText: PROGRESS,
      completeText: COMPLETE,
    });
    const twice = withToolCallDisplayAnchored(once, "t1", {
      progressText: PROGRESS,
      completeText: COMPLETE,
    });
    expect(twice).toBe(once);
  });

  it("keeps distinct calls' displays apart", () => {
    let anchors: ReadonlyMap<string, ToolCallDisplay> = new Map();
    anchors = withToolCallDisplayAnchored(anchors, "t1", {
      progressText: PROGRESS,
    });
    anchors = withToolCallDisplayAnchored(anchors, "t2", {
      progressText: "Opening a page…",
    });
    expect(anchors.get("t1")?.progressText).toBe(PROGRESS);
    expect(anchors.get("t2")?.progressText).toBe("Opening a page…");
  });
});

describe("wellFormedToolCallDisplayAnchorsOf", () => {
  it("drops malformed entries rather than rendering (or crashing on) them", () => {
    const stored = new Map<unknown, unknown>([
      ["t1", { progressText: PROGRESS }],
      // A stale extra property (an older store's kind stamp) is
      // tolerated exactly as the wire narrower tolerates unrecognized
      // fields — the recognized fields carry the entry.
      ["t2", { kind: "text", progressText: PROGRESS }],
      ["t3", {}],
      ["t4", { progressText: 7 }],
      ["t5", "a bare sentence"],
      [6, { progressText: PROGRESS }],
    ]) as unknown as ReadonlyMap<string, ToolCallDisplay>;

    const seeded = wellFormedToolCallDisplayAnchorsOf(stored);

    expect(seeded.size).toBe(2);
    expect(seeded.get("t1")).toEqual({ progressText: PROGRESS });
    expect(seeded.get("t2")?.progressText).toBe(PROGRESS);
  });
});

describe("toolCallDisplayRecorder", () => {
  it("records an annotated call's toolCallId and narrowed display", () => {
    const onDisplayAnchored = vi.fn();
    const recorder = toolCallDisplayRecorder(onDisplayAnchored);

    void recorder.onCustomEvent?.({
      event: customEvent(markerValue()),
    } as never);

    expect(onDisplayAnchored).toHaveBeenCalledWith("t1", {
      progressText: PROGRESS,
    });
  });

  it("ignores other markers and malformed values", () => {
    const onDisplayAnchored = vi.fn();
    const recorder = toolCallDisplayRecorder(onDisplayAnchored);

    void recorder.onCustomEvent?.({
      event: { type: "CUSTOM", name: "run_resumed", value: { attempt: 2 } },
    } as never);
    void recorder.onCustomEvent?.({
      event: customEvent({ display: { progress_text: PROGRESS } }),
    } as never);

    expect(onDisplayAnchored).not.toHaveBeenCalled();
  });
});

describe("the resume store's display map", () => {
  it("survives across records and merges the two moments per call", () => {
    const store = new StreamResumeStore();
    store.recordToolCallDisplay("t1", { progressText: PROGRESS });
    store.recordToolCallDisplay("t1", { completeText: COMPLETE });
    const afterBoth = store.toolCallDisplayAnchors;
    store.recordToolCallDisplay("t1", {
      progressText: "a replayed copy",
      completeText: "a replayed copy",
    });

    expect(store.toolCallDisplayAnchors).toBe(afterBoth);
    expect(store.toolCallDisplayAnchors.get("t1")).toEqual({
      progressText: PROGRESS,
      completeText: COMPLETE,
    });
  });
});

// The semantic envelope: the six-field wire display — caption, sentences, icon,
// and the tool-view ref. Old payloads must narrow exactly as before, unknown
// tokens survive verbatim (resolution owns the fallback), and the view ref is
// all-or-nothing.
describe("the semantic envelope fields", () => {
  const ERROR = "Couldn't reach your docs — the index is rebuilding.";
  const VIEW_REF = { key: "acme.order-lookup", version: 2 };

  it("keeps narrowing a legacy payload exactly as before — no new keys invented", () => {
    const anchor = toolCallDisplayAnchorOf(
      markerValue({
        display: {
          progress_text: PROGRESS,
          complete_text: COMPLETE,
        },
      }),
    );
    expect(anchor?.display).toEqual({
      progressText: PROGRESS,
      completeText: COMPLETE,
    });
  });

  it("narrows the envelope's non-sentence fields to the display contract", () => {
    const anchor = toolCallDisplayAnchorOf(
      markerValue({
        display: {
          progress_text: PROGRESS,
          error_text: ERROR,
          icon: "search",
          view: VIEW_REF,
        },
      }),
    );
    expect(anchor?.display).toEqual({
      progressText: PROGRESS,
      errorText: ERROR,
      icon: "search",
      view: VIEW_REF,
    });
  });

  it("an icon-only display still anchors — the hint is the annotation", () => {
    const anchor = toolCallDisplayAnchorOf(
      markerValue({ display: { icon: "terminal" } }),
    );
    expect(anchor?.display).toEqual({ icon: "terminal" });
  });

  it("a view-ref-only display still anchors — the ref is the annotation", () => {
    const anchor = toolCallDisplayAnchorOf(
      markerValue({ display: { view: VIEW_REF } }),
    );
    expect(anchor?.display).toEqual({ view: VIEW_REF });
  });

  it("keeps an unknown token verbatim — the resolver owns the fallback", () => {
    const anchor = toolCallDisplayAnchorOf(
      markerValue({ display: { icon: "telescope" } }),
    );
    expect(anchor?.display).toEqual({ icon: "telescope" });
  });

  it("caps runaway tokens and error copy instead of retaining them unbounded", () => {
    const anchor = toolCallDisplayAnchorOf(
      markerValue({
        display: {
          error_text: "n".repeat(50_000),
          icon: "i".repeat(500),
        },
      }),
    );
    expect(anchor?.display.errorText?.length).toBe(500);
    expect(anchor?.display.icon?.length).toBe(64);
  });

  // The one case that poses a runaway DISCLOSURE token: `disclosure`
  // is not in the model, so the same input is an unrecognized field,
  // dropped whole — never capped, never retained, never
  // display-blanking.
  it("drops a retired token field whole — a runaway disclosure is unrecognized, not capped", () => {
    const anchor = toolCallDisplayAnchorOf(
      markerValue({
        display: {
          kind: "text",
          icon: "telescope",
          disclosure: "p".repeat(500),
        },
      }),
    );
    expect(anchor?.display).toEqual({ icon: "telescope" });
  });

  it("drops malformed new fields without dropping the display", () => {
    const anchor = toolCallDisplayAnchorOf(
      markerValue({
        display: {
          progress_text: PROGRESS,
          error_text: 7,
          icon: "",
        },
      }),
    );
    expect(anchor?.display).toEqual({ progressText: PROGRESS });
  });

  it("drops a malformed view ref whole — never half a pair", () => {
    for (const view of [
      "acme.order-lookup",
      { key: "acme.order-lookup" },
      { version: 2 },
      { key: "", version: 2 },
      { key: "k".repeat(200), version: 2 },
      { key: "acme.order-lookup", version: "2" },
      { key: "acme.order-lookup", version: 1.5 },
      { key: "acme.order-lookup", version: 0 },
    ]) {
      const anchor = toolCallDisplayAnchorOf(
        markerValue({
          display: { progress_text: PROGRESS, view },
        }),
      );
      expect(anchor?.display).toEqual({ progressText: PROGRESS });
    }
  });

  it("merges first-wins per new field and the view ref atomically", () => {
    let anchors: ReadonlyMap<string, ToolCallDisplay> = new Map();
    anchors = withToolCallDisplayAnchored(anchors, "t1", {
      icon: "search",
      view: VIEW_REF,
    });
    anchors = withToolCallDisplayAnchored(anchors, "t1", {
      icon: "file",
      errorText: ERROR,
      view: { key: "acme.other", version: 9 },
    });
    expect(anchors.get("t1")).toEqual({
      icon: "search",
      errorText: ERROR,
      view: VIEW_REF,
    });
  });

  it("is idempotent under replay across the new fields", () => {
    const once = withToolCallDisplayAnchored(
      EMPTY_TOOL_CALL_DISPLAY_ANCHORS,
      "t1",
      {
        errorText: ERROR,
        icon: "search",
        view: VIEW_REF,
      },
    );
    const twice = withToolCallDisplayAnchored(once, "t1", {
      errorText: ERROR,
      icon: "search",
      view: VIEW_REF,
    });
    expect(twice).toBe(once);
  });

  it("the well-formed gate seeds new-field entries and drops malformed ones", () => {
    const stored = new Map<unknown, unknown>([
      ["t1", { icon: "search", view: VIEW_REF }],
      ["t2", { icon: 7 }],
      ["t3", { view: { key: "acme", version: 1.5 } }],
    ]) as unknown as ReadonlyMap<string, ToolCallDisplay>;

    const seeded = wellFormedToolCallDisplayAnchorsOf(stored);

    expect(seeded.size).toBe(1);
    expect(seeded.get("t1")).toEqual({
      icon: "search",
      view: VIEW_REF,
    });
  });
});

describe("the model's caption field", () => {
  const anchorOf = (display: Record<string, unknown>) =>
    toolCallDisplayAnchorOf({ tool_call_id: "t1", display });

  it("narrows a caption beside the authored sentences, capped like them", () => {
    expect(
      anchorOf({ caption: "Checking for rg", progress_text: "Running…" }),
    ).toEqual({
      toolCallId: "t1",
      display: { caption: "Checking for rg", progressText: "Running…" },
    });
    const runaway = anchorOf({ caption: "x".repeat(600) });
    expect(runaway?.display.caption).toHaveLength(500);
  });

  it("a caption-only display anchors; a blank or non-string caption is absent", () => {
    expect(anchorOf({ caption: "Checking for rg" })).toEqual({
      toolCallId: "t1",
      display: { caption: "Checking for rg" },
    });
    expect(anchorOf({ caption: "   " })).toBeNull();
    expect(anchorOf({ caption: 7 })).toBeNull();
    expect(anchorOf({ caption: 7, progress_text: "Running…" })).toEqual({
      toolCallId: "t1",
      display: { progressText: "Running…" },
    });
  });

  it("merges first-wins per field and is a no-op under replay", () => {
    const first = withToolCallDisplayAnchored(new Map(), "t1", {
      caption: "Checking for rg",
    });
    const merged = withToolCallDisplayAnchored(first, "t1", {
      caption: "A later caption",
      completeText: "Ran a command",
    });
    expect(merged.get("t1")).toEqual({
      caption: "Checking for rg",
      completeText: "Ran a command",
    });
    expect(
      withToolCallDisplayAnchored(merged, "t1", { caption: "Checking for rg" }),
    ).toBe(merged);
  });

  it("a stored caption-only display is well formed; a malformed caption drops the entry", () => {
    const kept = wellFormedToolCallDisplayAnchorsOf(
      new Map<string, unknown>([
        ["t1", { caption: "Checking for rg" }],
        ["t2", { caption: 7, progressText: "Running…" }],
      ]) as unknown as ReadonlyMap<string, ToolCallDisplay>,
    );
    expect([...kept.keys()]).toEqual(["t1"]);
  });
});
