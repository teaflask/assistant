// teaflask.command — a command and its output (tool-views.md, rung 3) as
// one terminal block: `$ command`, then what it printed. Authored for
// sandbox_bash and docs_filesystem, which share the shape (a `command`
// string), and total over their two recorded result formats — the
// {output, error} record and plain text — by SHAPE, never by tool name:
// the package presents its own tools only through the opaque-key seam.
// Argument ledger and producer transforms: docs/tool-view-ledgers.md. Arm
// reachability and the two truncation channels (1: the envelope's
// result.truncated → call.truncated; 2: the mapper's 20k clip, invisible
// client-side and the COMMON one here): the tool-view arm-reachability
// record.
//   settledOutcomeNotesOf arms — REACHABLE: tool-row no longer gates
//     output, so a refused, errored (output-error), denied, cancelled,
//     superseded or offloaded rung-3 call renders its arm in production;
//     a still-RUNNING call renders none.
//   call.truncated arm — channel 1 only: when the unwrapper says the
//     recorded copy is degraded, the view must refuse to structure it.

import type { ToolViewProps } from "../../core/tool-view.js";
import {
  el,
  note,
  recordOf,
  settledOutcomeNotesOf,
  settledWithResult,
  statelessToolView,
  stringOf,
  terminal,
} from "./view-dom.js";

/** docsfs's model-facing replacement for a silent exit-0 run
 *  (_render_run_result) — not stdout, so never rendered as output. */
const DOCS_NO_OUTPUT_SENTENCE =
  "The command ran with exit code 0 and produced no output.";
const INCOMPLETE = "The recorded output is incomplete and isn't rendered.";
const NO_OUTPUT = "The command produced no output.";

export const commandToolView = statelessToolView(_renderCommand);

function _renderCommand({ call }: ToolViewProps): HTMLElement {
  const root = el("div", "tf:flex tf:flex-col tf:gap-2");
  root.dataset.tfCommandView = "";
  const command = stringOf(call.args.command);
  const streams = settledWithResult(call) ? _streamsOf(call) : null;
  // The block exists for a prompt line or a stream — an empty or absent
  // command with nothing printed would paint an empty bordered pre.
  const hasCommand = command !== null && command !== "";
  if (hasCommand || streams?.kind === "streams") {
    root.append(
      terminal({
        command,
        output: streams?.kind === "streams" ? streams.output : undefined,
        stderr: streams?.kind === "streams" ? streams.stderr : undefined,
      }),
    );
  }
  root.append(...settledOutcomeNotesOf(call));
  if (streams?.kind === "note") {
    root.append(note(streams.text));
  }
  return root;
}

type Streams =
  | { kind: "streams"; output: string; stderr: string }
  | { kind: "note"; text: string };

function _streamsOf(call: ToolViewProps["call"]): Streams | null {
  if (call.truncated === true) {
    return { kind: "note", text: INCOMPLETE };
  }
  // The sandbox_bash shape: {"output": stdout, "error": stderr} — both
  // strings by construction.
  const result = recordOf(call.result);
  const output = result === null ? null : stringOf(result.output);
  const stderr = result === null ? null : stringOf(result.error);
  if (output !== null && stderr !== null) {
    return output === "" && stderr === ""
      ? { kind: "note", text: NO_OUTPUT }
      : { kind: "streams", output, stderr };
  }
  // The mapper's 20k clip (channel 2) cuts the bash record mid-JSON:
  // parse fails and resultText holds the cut document, not the output.
  if (call.result === undefined && call.resultText?.startsWith("{") === true) {
    return { kind: "note", text: INCOMPLETE };
  }
  // The docs_filesystem shape: one text block (stdout, plus [stderr] /
  // [exit code N] markers only when they occurred).
  if (call.resultText === undefined) {
    return null;
  }
  return call.resultText === "" || call.resultText === DOCS_NO_OUTPUT_SENTENCE
    ? { kind: "note", text: NO_OUTPUT }
    : { kind: "streams", output: call.resultText, stderr: "" };
}
