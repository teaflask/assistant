// teaflask.action — the package's one view for every `action__{slug}`
// tool (tool-views.md, rung 3): customer HTTP actions are structurally
// our tools — generated from the catalog, their arguments always the
// same three-key envelope {path_params, query, body} — so one shipped
// view renders any org's action, in every host, with zero customer
// frontend work. It reads the recorded call and nothing else: the
// method and path template ride only the execution-request marker, not
// the call's bounded props, so they are deliberately not shown — a
// built-in gets no privileged data. Producer transforms and argument
// ledger: docs/tool-view-ledgers.md. Arm reachability and the two
// truncation channels: the tool-view arm-reachability record.
//   settledOutcomeNotesOf arms — REACHABLE: tool-row no longer gates
//     output, so a refused, errored (output-error), denied, cancelled,
//     superseded or offloaded rung-3 call renders its arm in production;
//     a still-RUNNING call renders none (input-streaming/input-available
//     break out to []).
//   resultText === undefined early return — unreachable today (its call
//     site is guarded by settledWithResult); kept as totality: a view
//     never throws on posed props.

import type { ToolViewCall, ToolViewProps } from "../../core/tool-view.js";
import { prettyPrintParameters } from "../pretty-print.js";
import { CARD_BLOCK_CLASS } from "./parts-classes.js";
import {
  actionEnvelopeOf,
  actionFailureOf,
  captionRow,
  card,
  el,
  factRows,
  note,
  recordOf,
  scrollRegion,
  settledOutcomeNotesOf,
  settledWithResult,
  statelessToolView,
} from "./view-dom.js";

const REQUEST_SECTIONS = [
  ["path_params", "Path parameters"],
  ["query", "Query"],
  ["body", "Body"],
] as const;

const VALUE_PANE_CLASS =
  "tf:m-0 tf:whitespace-pre-wrap tf:font-mono tf:text-xs tf:text-tf-foreground";

export const actionToolView = statelessToolView(_renderAction);

function _renderAction({ call }: ToolViewProps): HTMLElement {
  const root = el("div", "tf:flex tf:flex-col tf:gap-2");
  root.dataset.tfActionView = "";
  const sections: HTMLElement[] = [];
  for (const [key, label] of REQUEST_SECTIONS) {
    const value = call.args[key];
    if (value === undefined || value === null) {
      continue;
    }
    // An empty record is the same absence the argument ledger already
    // describes — a labeled section holding "{}" would be a content-free
    // frame. An empty ARRAY body still renders: "[]" is a value the
    // customer's endpoint received.
    const record = recordOf(value);
    if (record !== null && Object.keys(record).length === 0) {
      continue;
    }
    sections.push(captionRow(label), _valueRows(value));
  }
  if (sections.length > 0) {
    root.append(card(sections));
  }
  root.append(...settledOutcomeNotesOf(call));
  if (call.status === "output-error") {
    _appendFieldProblems(root, call);
  }
  if (settledWithResult(call)) {
    _appendResponse(root, call);
  }
  return root;
}

/** A failure's per-field problems as property rows, the one structured
 *  fact a failed action carries: the row beside this view already says
 *  Failed and the human reason, so the view adds the fields alone —
 *  never the status or error code. Nothing when the API named none. */
function _appendFieldProblems(root: HTMLElement, call: ToolViewCall): void {
  const detail = actionFailureOf(call.errorText)?.detail;
  const fields = detail?.fields ?? [];
  if (fields.length === 0) {
    return;
  }
  const rows = factRows(
    fields.map(
      (field) => [field.path === "" ? "—" : field.path, field.message] as const,
    ),
  );
  rows.dataset.tfActionFieldProblems = "";
  const parts = [captionRow("Field problems"), rows];
  const omitted = detail?.fieldsOmitted ?? 0;
  if (omitted > 0) {
    // The API named more than the record carries: say so, never let a
    // partial list read as the whole.
    const more = captionRow(
      `${String(omitted)} more ${omitted === 1 ? "problem" : "problems"} not listed here.`,
    );
    more.dataset.tfActionFieldProblemsOmitted = String(omitted);
    parts.push(more);
  }
  root.append(card(parts));
}

/** A record becomes property rows (one per top-level key, nested values
 *  pretty-printed); anything else — an array, a scalar — is one
 *  pretty-printed block on the same card-child grammar as the rows: the
 *  hairline above, the rows' inset. Either rides in a bounded scrolling
 *  well: a body can run to the door's 20k, and a value that tall would
 *  be the transcript's height, not a card's. */
function _valueRows(value: unknown): HTMLElement {
  const record = recordOf(value);
  if (record !== null) {
    return scrollRegion([
      factRows(
        Object.entries(record).map(
          ([key, entry]) => [key, _valueOf(entry)] as const,
        ),
      ),
    ]);
  }
  const wrapper = el("div", CARD_BLOCK_CLASS);
  wrapper.dataset.tfActionValueBlock = "";
  wrapper.append(el("pre", VALUE_PANE_CLASS, prettyPrintParameters(value)));
  return scrollRegion([wrapper]);
}

function _valueOf(value: unknown): string | HTMLElement {
  if (typeof value === "string") {
    return value === "" ? "—" : value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (value === null || value === undefined) {
    return "—";
  }
  return el("pre", VALUE_PANE_CLASS, prettyPrintParameters(value));
}

function _appendResponse(root: HTMLElement, call: ToolViewCall): void {
  if (call.resultText === undefined) {
    return;
  }
  const envelope = actionEnvelopeOf(call.resultText);
  if (envelope === null) {
    // Covers the wire's 20k clip too: `call.truncated` is set only by a
    // WELL-FORMED envelope whose result.truncated is true — which by
    // construction parsed — so "unparseable but flagged truncated"
    // cannot co-occur and earns no arm of its own.
    root.append(
      note(
        "The response couldn't be read as an action result and isn't rendered.",
      ),
    );
    return;
  }
  const rows: HTMLElement[] = [];
  let status: HTMLElement | undefined;
  if (envelope.status !== null) {
    status = el(
      "span",
      envelope.status >= 400
        ? "tf:font-medium tf:text-tf-destructive"
        : "tf:text-tf-muted-foreground",
      `HTTP ${String(envelope.status)}`,
    );
    status.dataset.tfActionStatus = String(envelope.status);
  }
  rows.push(
    captionRow(
      envelope.truncated ? "Response (truncated)" : "Response",
      status,
    ),
  );
  if (envelope.truncated) {
    rows.push(
      captionRow(
        "The response body was truncated by the client to fit the size cap.",
      ),
    );
  }
  if (
    envelope.body === undefined ||
    envelope.body === null ||
    envelope.body === ""
  ) {
    rows.push(captionRow("Empty response body."));
  } else {
    rows.push(_valueRows(envelope.body));
  }
  root.append(card(rows));
}
