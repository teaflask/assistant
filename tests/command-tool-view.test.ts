// @vitest-environment jsdom
// teaflask.command — a command and its output as one terminal block, shape-total over the two
// authored result formats (sandbox_bash's {output, error} record and
// docs_filesystem's plain text) without ever reading the tool name.

import { describe, expect, it } from "vitest";

import { commandToolView } from "../src/components/tool-views/command-view";
import { toolCallPresentationOf } from "../src/core/tool-call-presentation";
import type { ToolViewCall, ToolViewProps } from "../src/core/tool-view";

function propsOf(overrides: Partial<ToolViewCall> = {}): ToolViewProps {
  return {
    call: {
      toolName: "sandbox_bash",
      toolCallId: "t1",
      status: "output-available",
      awaitingDecision: false,
      args: { command: "rg --files src" },
      result: { output: "src/a.ts\nsrc/b.ts\n", error: "" },
      resultText: '{"output":"src/a.ts\\nsrc/b.ts\\n","error":""}',
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
  const instance = commandToolView.mount(container, props);
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

describe("commandToolView — the two authored result shapes", () => {
  it("renders the {output, error} record: command, stdout, and no empty stderr pane", () => {
    const { container, destroy } = mounted(propsOf());
    const text = container.textContent;
    expect(
      container.querySelector("[data-tf-terminal-command]"),
    ).not.toBeNull();
    expect(text).toContain("rg --files src");
    expect(container.querySelector("[data-tf-terminal-output]")).not.toBeNull();
    expect(text).toContain("src/a.ts");
    expect(container.querySelector("[data-tf-terminal-stderr]")).toBeNull();
    destroy();
  });

  it("renders stderr in the quiet register — routine on a successful command, never failure ink", () => {
    const { container, destroy } = mounted(
      propsOf({
        result: { output: "", error: "warning: shallow clone\n" },
        resultText: '{"output":"","error":"warning: shallow clone\\n"}',
      }),
    );
    expect(container.querySelector("[data-tf-terminal-stderr]")).not.toBeNull();
    expect(container.textContent).toContain("warning: shallow clone");
    expect(container.innerHTML).not.toContain("text-tf-destructive");
    destroy();
  });

  it("says so when both streams are empty", () => {
    const { container, destroy } = mounted(
      propsOf({
        result: { output: "", error: "" },
        resultText: '{"output":"","error":""}',
      }),
    );
    expect(container.textContent).toContain("produced no output");
    destroy();
  });

  it("renders plain text output verbatim (the docs_filesystem shape, exit markers included)", () => {
    const plain = "guides/\nreference/\n[stderr]\nnope\n[exit code 2]";
    const { container, destroy } = mounted(
      propsOf({
        args: { command: "ls /docs && false" },
        result: undefined,
        resultText: plain,
      }),
    );
    expect(container.textContent).toContain("[exit code 2]");
    expect(container.querySelector("[data-tf-terminal-output]")).not.toBeNull();
    destroy();
  });

  it("the docs no-output sentence renders as the quiet note, never as stdout", () => {
    // PREMISE (round-4 finding 5): docsfs replaces a silent exit-0 run
    // with one model-facing sentence (_render_run_result) — it is not
    // the command's stdout, so it gets this view's own note, the same
    // treatment the file-edit view gives the editor's preamble.
    const sentence = "The command ran with exit code 0 and produced no output.";
    const { container, destroy } = mounted(
      propsOf({
        args: { command: "true" },
        result: undefined,
        resultText: sentence,
      }),
    );
    expect(container.textContent).toContain("The command produced no output.");
    expect(container.textContent).not.toContain("exit code 0");
    expect(container.querySelector("[data-tf-terminal-output]")).toBeNull();
    destroy();

    // The other direction: stdout that merely CONTAINS the sentence is
    // real output and renders — the recognition is exact-match only.
    const containing = mounted(
      propsOf({
        args: { command: "cat log.txt" },
        result: undefined,
        resultText: `${sentence}\nplus a real second line`,
      }),
    );
    expect(
      containing.container.querySelector("[data-tf-terminal-output]"),
    ).not.toBeNull();
    expect(containing.container.textContent).toContain(
      "plus a real second line",
    );
    containing.destroy();
  });

  it("paints no terminal block for an empty or absent command with nothing printed — every command × stream pairing", () => {
    // The block exists for a prompt line or a stream. Without either —
    // an empty command still streaming, or a note-only settle — an empty
    // bordered pre would be a frame around nothing.
    for (const command of ["", undefined]) {
      const running = mounted(
        propsOf({
          args: command === undefined ? {} : { command },
          status: "input-available",
          result: undefined,
          resultText: undefined,
        }),
      );
      expect(running.container.querySelector("[data-tf-terminal]")).toBeNull();
      running.destroy();
      const silent = mounted(
        propsOf({
          args: command === undefined ? {} : { command },
          result: { output: "", error: "" },
          resultText: '{"output":"","error":""}',
        }),
      );
      expect(silent.container.querySelector("[data-tf-terminal]")).toBeNull();
      expect(silent.container.textContent).toContain("produced no output");
      silent.destroy();
      // Real output with no command still renders: the stream is content.
      const streamed = mounted(
        propsOf({ args: command === undefined ? {} : { command } }),
      );
      expect(
        streamed.container.querySelector("[data-tf-terminal-output]"),
      ).not.toBeNull();
      expect(
        streamed.container.querySelector("[data-tf-terminal-command]"),
      ).toBeNull();
      streamed.destroy();
    }
    // A real command with a note-only settle keeps its prompt line.
    const noted = mounted(
      propsOf({
        result: { output: "", error: "" },
        resultText: '{"output":"","error":""}',
      }),
    );
    expect(
      noted.container.querySelector("[data-tf-terminal-command]"),
    ).not.toBeNull();
    expect(
      noted.container.querySelector("[data-tf-terminal-output]"),
    ).toBeNull();
    noted.destroy();
  });

  it("never invents streams: a record missing a string half renders the verbatim text instead", () => {
    // The case that would break the class: output is a string but error
    // is a number — treating it as the bash shape would fabricate a
    // stderr. It must fall through to the verbatim arm.
    const { container, destroy } = mounted(
      propsOf({
        result: { output: "hi", error: 3 },
        resultText: '{"output":"hi","error":3}',
      }),
    );
    expect(container.querySelector("[data-tf-terminal-stderr]")).toBeNull();
    expect(container.textContent).toContain('{"output":"hi","error":3}');
    destroy();
  });

  it("a mapper-clipped bash record renders the incomplete note, never cut JSON as Output", () => {
    // PREMISE (round-2 finding 1): the AG-UI mapper clips tool-result
    // content at 20,000 chars and no client field consumes its
    // truncated extra yet — so a >20k bash output arrives as the
    // {output, error} JSON cut mid-string, with call.truncated false
    // and call.result absent. The cut document is the record's
    // transport form, not the command's output; the shape (unparseable,
    // opens with "{") is the only available signal.
    const cut = '{"output":"line1\\nline2\\nline3\\nli';
    const { container, destroy } = mounted(
      propsOf({ result: undefined, resultText: cut }),
    );
    expect(container.textContent).toContain(
      "The recorded output is incomplete and isn't rendered.",
    );
    expect(container.querySelector("[data-tf-terminal-output]")).toBeNull();
    expect(container.textContent).not.toContain("line1");
    destroy();
  });

  it("a COMPLETE JSON document still renders verbatim — the guard fires only on unparseable text", () => {
    // The other direction: docs output that IS valid JSON (a `cat` of a
    // JSON file) parses, so call.result is defined and the verbatim arm
    // renders the recorded text — the cut-document guard must not
    // suppress complete documents that merely open with "{".
    const documentText = '{"name": "teaflask", "private": true}';
    const { container, destroy } = mounted(
      propsOf({
        args: { command: "cat package.json" },
        result: { name: "teaflask", private: true },
        resultText: documentText,
      }),
    );
    expect(container.querySelector("[data-tf-terminal-output]")).not.toBeNull();
    expect(container.textContent).toContain('"teaflask"');
    expect(container.textContent).not.toContain("incomplete");
    destroy();
  });

  it("reads the bash record through the real presenter — the passthrough premise, pinned", () => {
    // sandbox_bash results are NOT the tool-result envelope, so the
    // unwrapper passes the parsed record through as call.result. If it
    // ever started unwrapping this shape, the view's record arm dies —
    // red here first.
    const wire = '{"output":"hello\\n","error":""}';
    const presentation = toolCallPresentationOf({
      toolName: "sandbox_bash",
      toolCallId: "t1",
      state: "output-available",
      input: "{}",
      argsText: '{"command":"echo hello"}',
      output: wire,
    });
    const call = presentation.toolView.call;
    expect(call.result).toEqual({ output: "hello\n", error: "" });
    const { container, destroy } = mounted({
      call,
      context: { themeMode: "light" },
    });
    expect(container.textContent).toContain("hello");
    destroy();
  });
});

describe("commandToolView — lifecycle and totality", () => {
  it("updates in place from running to settled and clears on destroy", () => {
    const { container, update, destroy } = mounted(
      propsOf({
        status: "input-available",
        result: undefined,
        resultText: undefined,
      }),
    );
    expect(container.querySelector("[data-tf-terminal-output]")).toBeNull();
    update(propsOf());
    expect(container.textContent).toContain("src/a.ts");
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
    const variants: Partial<ToolViewCall>[] = [
      { args: {}, result: undefined, resultText: undefined },
      { args: { command: 42 } },
      { result: [1, 2] as never },
      { result: "just a string" },
      { result: { output: null, error: null } },
      { truncated: true, result: undefined },
      { offloaded: true, result: undefined, resultText: undefined },
      { errorText: "boom", result: undefined, resultText: undefined },
      { refusalText: "no", result: undefined, resultText: undefined },
      { resultText: "", result: undefined },
    ];
    for (const status of states) {
      for (const variant of variants) {
        expect(() => {
          const { update, destroy } = mounted(propsOf({ status, ...variant }));
          update(propsOf({ status, ...variant }));
          destroy();
        }).not.toThrow();
      }
    }
  });

  it("a call that didn't settle cleanly renders its honesty note, never an output pane", () => {
    for (const status of [
      "output-error",
      "cancelled",
      "refused",
      "superseded",
    ] as const) {
      const { container, destroy } = mounted(propsOf({ status }));
      expect(container.textContent).not.toContain("src/a.ts");
      destroy();
    }
    // Reachable only exotically (see the arm ledger: output that
    // coincidentally parses as the tool-result envelope), but when the
    // unwrapper says the recorded copy is degraded the view refuses to
    // structure it and says so — and never renders the streams.
    const truncated = mounted(propsOf({ truncated: true, result: undefined }));
    expect(truncated.container.textContent).toContain("incomplete");
    expect(truncated.container.textContent).not.toContain("src/a.ts");
    truncated.destroy();
  });
});
