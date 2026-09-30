// A minimal unified line diff (Myers shortest-edit), so a repeat page
// read can ride as "what changed since your last read" instead of the
// whole tree. Output is the familiar hunk format — `@@ -a,b +c,d @@`
// headers, three lines of context, no file header — because the model
// already knows how to read it. Pure text in, pure text out.

const CONTEXT_LINES = 3;

interface EditOp {
  tag: "equal" | "delete" | "insert";
  text: string;
}

/** The unified diff from before to after; "" when the texts are equal. */
export function unifiedDiffOf(before: string, after: string): string {
  if (before === after) {
    return "";
  }
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const ops = _editOpsOf(beforeLines, afterLines);
  return _hunksOf(ops).join("\n");
}

function _editOpsOf(before: string[], after: string[]): EditOp[] {
  const trace = _shortestEditTraceOf(before, after);
  return _backtrackedOpsOf(trace, before, after);
}

function _shortestEditTraceOf(before: string[], after: string[]): number[][] {
  const n = before.length;
  const m = after.length;
  const max = n + m;
  const offset = max;
  const v: number[] = new Array<number>(2 * max + 2).fill(0);
  const trace: number[][] = [];
  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && before[x] === after[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        return trace;
      }
    }
  }
  return trace;
}

function _backtrackedOpsOf(
  trace: number[][],
  before: string[],
  after: string[],
): EditOp[] {
  const offset = before.length + after.length;
  const reversed: EditOp[] = [];
  let x = before.length;
  let y = after.length;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d -= 1) {
    const v = trace[d];
    const k = x - y;
    let previousK: number;
    if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
      previousK = k + 1;
    } else {
      previousK = k - 1;
    }
    const previousX = v[offset + previousK];
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      reversed.push({ tag: "equal", text: before[x - 1] });
      x -= 1;
      y -= 1;
    }
    if (d > 0) {
      if (x === previousX) {
        reversed.push({ tag: "insert", text: after[y - 1] });
        y -= 1;
      } else {
        reversed.push({ tag: "delete", text: before[x - 1] });
        x -= 1;
      }
    }
  }
  return reversed.reverse();
}

function _hunksOf(ops: EditOp[]): string[] {
  const groups = _changeGroupsOf(ops);
  const lines: string[] = [];
  // Running line numbers (1-indexed) per op index, computed as we walk.
  let aLine = 1;
  let bLine = 1;
  let opIndex = 0;
  for (const group of groups) {
    while (opIndex < group.start) {
      const op = ops[opIndex];
      if (op.tag !== "insert") {
        aLine += 1;
      }
      if (op.tag !== "delete") {
        bLine += 1;
      }
      opIndex += 1;
    }
    let aCount = 0;
    let bCount = 0;
    const body: string[] = [];
    for (let index = group.start; index < group.end; index += 1) {
      const op = ops[index];
      if (op.tag === "equal") {
        body.push(` ${op.text}`);
        aCount += 1;
        bCount += 1;
      } else if (op.tag === "delete") {
        body.push(`-${op.text}`);
        aCount += 1;
      } else {
        body.push(`+${op.text}`);
        bCount += 1;
      }
    }
    lines.push(
      `@@ -${String(aLine)},${String(aCount)} +${String(bLine)},${String(bCount)} @@`,
      ...body,
    );
    while (opIndex < group.end) {
      const op = ops[opIndex];
      if (op.tag !== "insert") {
        aLine += 1;
      }
      if (op.tag !== "delete") {
        bLine += 1;
      }
      opIndex += 1;
    }
  }
  return lines;
}

function _changeGroupsOf(ops: EditOp[]): { start: number; end: number }[] {
  const changeIndexes = ops
    .map((op, index) => (op.tag === "equal" ? -1 : index))
    .filter((index) => index >= 0);
  const groups: { start: number; end: number }[] = [];
  for (const changeIndex of changeIndexes) {
    const start = Math.max(0, changeIndex - CONTEXT_LINES);
    const end = Math.min(ops.length, changeIndex + CONTEXT_LINES + 1);
    const last = groups[groups.length - 1] as
      { start: number; end: number } | undefined;
    if (last !== undefined && start <= last.end) {
      last.end = Math.max(last.end, end);
    } else {
      groups.push({ start, end });
    }
  }
  return groups;
}
