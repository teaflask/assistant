// @vitest-environment jsdom
/**
 * The transcript's status live region: the conversation chrome renders
 * no visible run-state line, so this sr-only announcer is the ONLY
 * holder of the status phrases — and it must be honest about who is
 * waited on: "Waiting for your input" is announced only while an
 * actionable decision exists, never for a bare paused status (a subagent
 * park ships the same "parked" as a HITL pause). The premise (stated in
 * the component): screen readers announce mutations of an existing live
 * region and skip a node that arrives already carrying role="status" and
 * its text — so the mechanism test below pins NODE IDENTITY across the
 * idle→working transition, the executable proxy for "the region
 * pre-existed the phrase".
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunStatusAnnouncer } from "../src/components/run-status-announcer";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
});

function render(node: Parameters<Root["render"]>[0]) {
  act(() => {
    root.render(node);
  });
}

describe("RunStatusAnnouncer", () => {
  it("pre-exists every phrase: one node, mounted empty, mutated in place", () => {
    // The mechanism, not just the attribute: the SAME element must carry
    // "" while idle and the phrase once work starts — a live region that
    // arrives with its text is initial content, and most screen readers
    // skip it. Node identity across the transition is the executable
    // proxy for that premise (a real screen-reader pass is outside this
    // harness's reach, and that limit is stated in the report).
    render(<RunStatusAnnouncer status={null} decisionsPending={false} />);
    const idle = host.querySelector("[data-tf-status-announcer]");
    expect(idle).not.toBeNull();
    expect(idle?.getAttribute("role")).toBe("status");
    expect(idle?.textContent).toBe("");

    render(<RunStatusAnnouncer status="working" decisionsPending={false} />);
    const working = host.querySelector("[data-tf-status-announcer]");
    expect(working).toBe(idle);
    expect(working?.textContent).toBe("The assistant is working");

    render(
      <RunStatusAnnouncer status="awaiting_input" decisionsPending={true} />,
    );
    const waiting = host.querySelector("[data-tf-status-announcer]");
    expect(waiting).toBe(idle);
    expect(waiting?.textContent).toBe("Waiting for your input");

    render(<RunStatusAnnouncer status="succeeded" decisionsPending={false} />);
    expect(host.querySelector("[data-tf-status-announcer]")).toBe(idle);
    expect(idle?.textContent).toBe("");
  });

  it("throttles by construction: one phrase for the machine's whole window", () => {
    // queued and working share the phrase, and the announcer never sees
    // rows or the clock, so no streamed token or elapsed tick can
    // re-announce.
    render(<RunStatusAnnouncer status="queued" decisionsPending={false} />);
    const announcer = host.querySelector("[data-tf-status-announcer]");
    const queuedPhrase = announcer?.textContent;
    expect(queuedPhrase).toBe("The assistant is working");
    render(<RunStatusAnnouncer status="working" decisionsPending={false} />);
    expect(announcer?.textContent).toBe(queuedPhrase);
  });

  it("never announces waiting for a pause with no pending decision", () => {
    // A subagent park is status "parked" with zero pending decisions —
    // announcing "Waiting for your input" there tells a screen-reader
    // user the run is blocked on them while nothing is actionable.
    render(<RunStatusAnnouncer status="parked" decisionsPending={false} />);
    const announcer = host.querySelector("[data-tf-status-announcer]");
    expect(announcer?.textContent).toBe("The assistant is working");

    render(
      <RunStatusAnnouncer status="awaiting_input" decisionsPending={false} />,
    );
    expect(announcer?.textContent).toBe("The assistant is working");

    // The same statuses WITH a live decision surface are the member's
    // time — the phrase flips with the decision, not the status.
    render(<RunStatusAnnouncer status="parked" decisionsPending={true} />);
    expect(announcer?.textContent).toBe("Waiting for your input");
  });
});
