"use client";

import {
  CAPTION_ROW_CLASS,
  CARD_CLASS,
  FACT_LABEL_CLASS,
  FACT_LIST_CLASS,
  FACT_ROW_CLASS,
  FACT_VALUE_CLASS,
} from "./tool-views/parts-classes.js";
import type { ToolViewProps } from "../core/tool-view.js";

const MAX_VISIBLE_ROWS = 8;
const LONG_TEXT_CHARS = 120;
const TEXT_PREVIEW_CHARS = 320;
const ARRAY_PREVIEW_ITEMS = 4;

interface SummaryRow {
  key: string;
  label: string;
  value: unknown;
  depth: number;
}

type Scalar = string | number | boolean | bigint | null;

// The section chrome, hoisted so the list stays a greppable literal: the
// tool-view card vocabulary (tool-views/parts-classes.ts) — a hairline
// card, a "Request" caption, property rows — so the rung-4 reading is a
// property card like every other view in the row body. No height floor:
// the card grows to its rows and never scrolls the transcript twice.
const SECTION_CLASSES = `tf:flex tf:flex-col ${CARD_CLASS}`;

/**
 * The resolution ladder's rung 4 (tool-views.md): the package default
 * view, over the bounded argument reading below. An INPUT reading by
 * design — it ignores `result` entirely, so an unknown customer tool
 * never grows an inferred result card or a raw output dump (TVC-111).
 * Deterministic like the reading it wraps: two identical calls render
 * byte-identical output, with no clocks and no locale. Its one mount
 * site is the slot's terminal in the tool row's body, where it wears
 * the one card vocabulary every tool view paints with.
 */
export function DefaultToolView(props: ToolViewProps) {
  return <ToolArgumentsSummary arguments={props.call.args} />;
}

/**
 * A deterministic, semantics-free reading of arbitrary tool arguments —
 * general-purpose input furniture (the DOM hooks below keep their
 * approval-card-era names because styles.css and the geometry spec
 * select them). It never chooses a domain component and never prints
 * raw JSON: records become bounded field rows, long strings become a
 * two-line excerpt, and opaque structures become honest type/count
 * summaries. Determinism is contract: Object.keys().sort() at both
 * levels, no clocks, and the one locale call pinned to "en-US".
 */
function ToolArgumentsSummary({
  arguments: toolArguments,
}: {
  arguments: Record<string, unknown>;
}) {
  const rows = _summaryRowsOf(toolArguments);
  if (rows.length === 0) {
    return null;
  }
  const visible = rows.slice(0, MAX_VISIBLE_ROWS);
  const hidden = rows.length - visible.length;
  return (
    <section
      data-tf-approval-request-summary=""
      data-tf-tool-view-card=""
      aria-label="Request details"
      className={SECTION_CLASSES}
    >
      <div className={CAPTION_ROW_CLASS}>Request</div>
      <dl className={FACT_LIST_CLASS}>
        {visible.map((row) => (
          <SummaryValue key={row.key} row={row} />
        ))}
        {hidden > 0 ? (
          <div className={CAPTION_ROW_CLASS}>
            {hidden} more {hidden === 1 ? "field" : "fields"}
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function SummaryValue({ row }: { row: SummaryRow }) {
  return (
    <div className={`${FACT_ROW_CLASS}${row.depth > 0 ? " tf:ps-6" : ""}`}>
      <dt className={FACT_LABEL_CLASS}>{row.label}</dt>
      <dd className={FACT_VALUE_CLASS}>
        <SummaryValueBody value={row.value} />
      </dd>
    </div>
  );
}

function SummaryValueBody({ value }: { value: unknown }) {
  if (typeof value === "string") {
    if (value.length <= LONG_TEXT_CHARS) {
      return (
        <span className="tf:font-mono tf:wrap-anywhere tf:whitespace-pre-wrap">
          {value === "" ? "Empty text" : value}
        </span>
      );
    }
    const preview = value.slice(0, TEXT_PREVIEW_CHARS);
    return (
      <div>
        <p
          data-tf-approval-text-preview=""
          className="tf:m-0 tf:overflow-hidden tf:wrap-anywhere tf:whitespace-pre-wrap"
        >
          {preview}
          {value.length > preview.length ? "…" : ""}
        </p>
        <p className="tf:mt-1 tf:text-xs tf:text-tf-muted-foreground tf:tabular-nums">
          {value.length.toLocaleString("en-US")} characters
        </p>
      </div>
    );
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return (
      <span className="tf:font-mono tf:wrap-anywhere">{String(value)}</span>
    );
  }
  if (value === null) {
    return (
      <span className="tf:font-mono tf:text-tf-muted-foreground">null</span>
    );
  }
  if (value === undefined) {
    return <span className="tf:text-tf-muted-foreground">Not provided</span>;
  }
  if (Array.isArray(value)) {
    const preview = value.slice(0, ARRAY_PREVIEW_ITEMS);
    const primitives = preview.every(_isScalar);
    return (
      <div>
        <span className="tf:text-tf-muted-foreground tf:tabular-nums">
          {value.length} {value.length === 1 ? "item" : "items"}
        </span>
        {primitives && preview.length > 0 ? (
          <p className="tf:mt-0.5 tf:m-0 tf:font-mono tf:wrap-anywhere">
            {preview.map(_scalarTextOf).join(", ")}
            {value.length > preview.length ? ", …" : ""}
          </p>
        ) : null}
      </div>
    );
  }
  if (_isRecord(value)) {
    const count = Object.keys(value).length;
    return (
      <span className="tf:text-tf-muted-foreground tf:tabular-nums">
        {count} {count === 1 ? "field" : "fields"}
      </span>
    );
  }
  return <span className="tf:text-tf-muted-foreground">Opaque value</span>;
}

function _summaryRowsOf(toolArguments: Record<string, unknown>): SummaryRow[] {
  const rows: SummaryRow[] = [];
  for (const key of Object.keys(toolArguments).sort()) {
    const value = toolArguments[key];
    if (_isRecord(value) && Object.keys(value).length > 0) {
      for (const childKey of Object.keys(value).sort()) {
        rows.push({
          key: `${key}.${childKey}`,
          label: `${_labelOf(key)} · ${_labelOf(childKey)}`,
          value: value[childKey],
          depth: 1,
        });
      }
      continue;
    }
    rows.push({ key, label: _labelOf(key), value, depth: 0 });
  }
  return rows;
}

function _labelOf(key: string): string {
  const words = key.replace(/[-_]+/g, " ").trim();
  return words === "" ? "Value" : words[0].toUpperCase() + words.slice(1);
}

function _isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function _isScalar(value: unknown): value is Scalar {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  );
}

function _scalarTextOf(value: Scalar): string {
  return value === null ? "null" : String(value);
}
