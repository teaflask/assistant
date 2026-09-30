import type { BaseEvent } from "@ag-ui/core";
import { from, lastValueFrom, toArray } from "rxjs";
import { describe, expect, it } from "vitest";

import {
  liftToolOutcome,
  toolOutcomeOf,
  withToolOutcomeLifted,
} from "../src/core/tool-outcome";

// The wire's TOOL_CALL_RESULT as the serving contract sends it: the five
// extras ride the top level, present only when true of the call.
function resultOnTheWire(extras: Record<string, unknown>): BaseEvent {
  return {
    type: "TOOL_CALL_RESULT",
    messageId: "t1-result",
    toolCallId: "t1",
    content: "…",
    role: "tool",
    ...extras,
  } as unknown as BaseEvent;
}

describe("withToolOutcomeLifted", () => {
  it("moves every extra under metadata.teaflask.toolOutcome and clears the top level", () => {
    const lifted = withToolOutcomeLifted(
      resultOnTheWire({
        error: "It broke.",
        refused: "Not on this door.",
        cancelled: true,
        truncated: true,
        offloaded: true,
      }),
    ) as unknown as Record<string, unknown>;
    expect(lifted.metadata).toEqual({
      teaflask: {
        toolOutcome: {
          error: "It broke.",
          refused: "Not on this door.",
          cancelled: true,
          truncated: true,
          offloaded: true,
        },
      },
    });
    for (const field of [
      "error",
      "refused",
      "cancelled",
      "truncated",
      "offloaded",
    ]) {
      expect(lifted).not.toHaveProperty(field);
    }
    expect(lifted.content).toBe("…");
    expect(lifted.toolCallId).toBe("t1");
  });

  it("returns the same reference for a result without extras and for any other event", () => {
    const plain = resultOnTheWire({});
    expect(withToolOutcomeLifted(plain)).toBe(plain);
    const start = {
      type: "TOOL_CALL_START",
      toolCallId: "t1",
      toolCallName: "read_page",
      cancelled: true,
    } as unknown as BaseEvent;
    expect(withToolOutcomeLifted(start)).toBe(start);
  });

  it("merges into existing metadata without clobbering foreign or sibling keys", () => {
    const lifted = withToolOutcomeLifted(
      resultOnTheWire({
        cancelled: true,
        metadata: {
          "ag-ui": { authoritativeActivityTypes: [] },
          teaflask: { other: 1, toolOutcome: { error: "earlier" } },
        },
      }),
    ) as unknown as Record<string, unknown>;
    expect(lifted.metadata).toEqual({
      "ag-ui": { authoritativeActivityTypes: [] },
      teaflask: {
        other: 1,
        toolOutcome: { error: "earlier", cancelled: true },
      },
    });
  });

  it("leaves a result whose metadata the protocol would reject exactly as sent — the validator's call, not the lift's", () => {
    // Negative control for the lift's own reach: replacing a string,
    // array or number with a fresh object would hide a malformed event
    // from the client's validator, which rejects such metadata.
    for (const metadata of ["nope", [], 3, null]) {
      const wire = resultOnTheWire({ cancelled: true, metadata });
      expect(withToolOutcomeLifted(wire)).toBe(wire);
    }
  });

  it("takes the teaflask namespace over when a non-object sits there — the extras are never left to be stripped", () => {
    // The protocol validates only the outer metadata object, so a string
    // under `teaflask` or an array under `toolOutcome` would pass the
    // validator while the untouched top-level extras were stripped: a
    // refusal or a cancellation rendering as success. The namespace is
    // this package's own; nothing else ever wrote or read a non-object
    // there, and the wire's outcome wins.
    for (const teaflask of [
      "theirs",
      7,
      [],
      { toolOutcome: [] },
      { toolOutcome: "x" },
    ]) {
      const lifted = withToolOutcomeLifted(
        resultOnTheWire({
          cancelled: true,
          metadata: { keep: "me", teaflask },
        }),
      ) as unknown as Record<string, unknown>;
      expect(toolOutcomeOf(lifted)).toEqual({ cancelled: true });
      expect(lifted).not.toHaveProperty("cancelled");
      expect((lifted.metadata as Record<string, unknown>).keep).toBe("me");
    }
    // Sibling keys inside a well-formed namespace still survive.
    const lifted = withToolOutcomeLifted(
      resultOnTheWire({
        refused: "No.",
        metadata: { teaflask: { other: 1, toolOutcome: { error: "earlier" } } },
      }),
    ) as unknown as Record<string, unknown>;
    expect(lifted.metadata).toEqual({
      teaflask: { other: 1, toolOutcome: { error: "earlier", refused: "No." } },
    });
  });

  it("does not mutate the wire event", () => {
    const wire = resultOnTheWire({ cancelled: true });
    withToolOutcomeLifted(wire);
    expect((wire as unknown as Record<string, unknown>).cancelled).toBe(true);
    expect(
      (wire as unknown as Record<string, unknown>).metadata,
    ).toBeUndefined();
  });
});

describe("toolOutcomeOf", () => {
  it("reads the lifted namespace, values as the wire sent them", () => {
    const lifted = withToolOutcomeLifted(
      resultOnTheWire({ cancelled: "true", error: "" }),
    );
    expect(toolOutcomeOf(lifted)).toEqual({ cancelled: "true", error: "" });
  });

  it("reads a top-level extra as absent — the pipeline never delivers that shape", () => {
    // The negative control for the readers: before the lift every family
    // read the top level; a reader that still did would report an outcome
    // the 1.0 client has already stripped.
    expect(toolOutcomeOf(resultOnTheWire({ cancelled: true }))).toEqual({});
  });

  it("is empty for non-objects and for a namespace of the wrong shape", () => {
    expect(toolOutcomeOf(null)).toEqual({});
    expect(toolOutcomeOf("cancelled")).toEqual({});
    expect(
      toolOutcomeOf(resultOnTheWire({ metadata: { teaflask: "nope" } })),
    ).toEqual({});
    expect(
      toolOutcomeOf(
        resultOnTheWire({ metadata: { teaflask: { toolOutcome: [] } } }),
      ),
    ).toEqual({});
  });
});

describe("liftToolOutcome", () => {
  it("maps a run's events frame for frame, lifting only the results", async () => {
    const start = {
      type: "TOOL_CALL_START",
      toolCallId: "t1",
      toolCallName: "read_page",
    } as unknown as BaseEvent;
    const out = await lastValueFrom(
      liftToolOutcome(from([start, resultOnTheWire({ offloaded: true })])).pipe(
        toArray(),
      ),
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(start);
    expect(toolOutcomeOf(out[1])).toEqual({ offloaded: true });
    expect(out[1]).not.toHaveProperty("offloaded");
  });
});
