/**
 * The boundary placement census. A witness law that validates prose and
 * string existence, not structure, is hollow: a row could claim
 * `ancestor` and cite any true sentence about a file — including
 * `key={row.key}`, the very key whose stability makes the claim false —
 * and pass.
 *
 * The closed mechanism: an `ancestor` row's witness is checked for
 * RELEVANCE, not existence. The witness names a keyed element or a
 * conditional branch; the census computes that construct's actual JSX
 * span and requires the row's own placement offset to be reachable from
 * it — directly inside the span, or through the row's declared `via`
 * component-hop chain, where every hop must be a component defined in
 * the placement's file, mounted (`<Hop`) inside the previous span, and
 * the final hop's function body must contain the placement offset. The
 * round-4 probe now fails structurally: `key={row.key}` rides a
 * SELF-CLOSING `<Row />`, whose subtree is empty and can reach nothing.
 *
 * Stated residual (what static structure cannot see): a witness that IS
 * a genuine ancestor but whose key value never changes when the prose
 * claims it does. Every same-file key witness below is therefore one
 * whose subtree provably contains its placement, and the regression
 * control at the bottom keeps the round-4 probe red forever.
 *
 * Reset vocabulary:
 * - element-key: the key sits ON the boundary element (mechanical:
 *   key= in the scanned tag).
 * - ancestor: a structurally verified ancestor construct remounts the
 *   subtree — witnessed as above.
 * - backstop: deliberately unkeyed, no witness allowed; clears only when
 *   the surface itself remounts, and the row's prose must own that.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

type ResetClass = "element-key" | "ancestor" | "backstop";

interface Witness {
  file: string;
  /** Either a `key={…}` fragment (the witness is the element carrying
   *  it) or a conditional ending in `? (` (the witness is the ternary's
   *  branches). */
  pattern: string;
  /** Component hops from the witness span to the placement, outermost
   *  first. Every hop must be defined in the PLACEMENT's file. */
  via?: readonly string[];
}

interface BoundaryPlacement {
  file: string;
  surface: string;
  keyedOnElement: boolean;
  silent: boolean;
  resetClass: ResetClass;
  reset: string;
  resetWitness?: Witness;
  blastRadius: string;
  radiusWitness?: { file: string; pattern: string };
}

const TRANSCRIPT_BACKSTOP_WITNESS: Witness = {
  file: "src/components/conversation-view.tsx",
  pattern:
    "key={`${core.conversation.thread.id}#${String(core.reconnectNonce)}`}",
  via: ["Transcript"],
};

/** Rows for one (file, surface) pair must be listed in SOURCE ORDER —
 *  each is bound to its own placement instance by ordinal, so two
 *  same-shaped rows cannot have their reset stories swapped silently. */
const LEDGER: readonly BoundaryPlacement[] = [
  {
    file: "src/components/assistant-companion.tsx",
    surface: "companion",
    keyedOnElement: false,
    silent: true,
    resetClass: "backstop",
    reset:
      "backstop — clears when the host remounts the companion; the drawer body inside keeps its own LazyBody boundary",
    blastRadius:
      "the companion vanishes (silent: a yielded companion renders nothing already, and a card mid-page would be worse than absence); onError and the console still report",
  },
  {
    file: "src/components/assistant-page.tsx",
    surface: "page",
    keyedOnElement: false,
    silent: false,
    resetClass: "backstop",
    reset:
      "backstop — clears when the host remounts AssistantPage; the keyed transcript boundary and the granular wraps inside recover on their own",
    blastRadius: "the whole page surface (header + body), host page intact",
  },
  {
    file: "src/components/assistant-page.tsx",
    surface: "history-menu",
    keyedOnElement: false,
    silent: false,
    resetClass: "ancestor",
    reset:
      "ancestor — historyOpen unmounts the menu on close; reopening the disclosure remounts boundary and list",
    resetWitness: {
      file: "src/components/assistant-page.tsx",
      pattern: "core.historyExpected && historyOpen ? (",
    },
    blastRadius: "the transient history menu",
  },
  {
    file: "src/components/assistant-palette.tsx",
    surface: "palette",
    keyedOnElement: false,
    silent: true,
    resetClass: "backstop",
    reset:
      "backstop — clears when the host remounts AssistantPalette; the open-state body inside is also unmounted/remounted per open and LazyBody-guarded",
    blastRadius:
      "the palette vanishes (silent: an overlay must not become an in-flow card at the bottom of the host page); onError and the console still report",
  },
  {
    file: "src/components/child-transcript.tsx",
    surface: "child-transcript",
    keyedOnElement: false,
    silent: false,
    resetClass: "ancestor",
    reset:
      "ancestor — the drill-in preview popover mounts conditionally and keys on the active child's session id; moving between coworkers or closing and reopening remounts it",
    resetWitness: {
      file: "src/components/subagent-delegation-surface.tsx",
      pattern: "key={activeDrillIn.childSessionId}",
      via: ["ChildTranscriptPreview", "ChildTranscript", "ChildTranscriptBody"],
    },
    blastRadius: "one subagent transcript preview",
  },
  {
    file: "src/components/conversation-view.tsx",
    surface: "transcript",
    keyedOnElement: true,
    silent: false,
    resetClass: "element-key",
    reset:
      "element-key `${threadId}#${reconnectNonce}` — a thread switch or Retry's reconnect bump remounts boundary and Transcript together (round-1 finding)",
    blastRadius: "the transcript composition, composer included",
  },
  {
    file: "src/components/conversation-view.tsx",
    surface: "welcome",
    keyedOnElement: false,
    silent: false,
    resetClass: "ancestor",
    reset:
      "ancestor — the welcome branch unmounts the moment a conversation exists (the core.conversation ternary)",
    resetWitness: {
      file: "src/components/conversation-view.tsx",
      pattern: "core.conversation !== null ? (",
    },
    blastRadius: "the empty-state welcome (heading, suggestions)",
  },
  {
    file: "src/components/conversation-view.tsx",
    surface: "message-list",
    keyedOnElement: false,
    silent: false,
    resetClass: "ancestor",
    reset:
      "ancestor — the pending-echo branch exists only while a send is in flight; it unmounts when the transcript takes over",
    resetWitness: {
      file: "src/components/conversation-view.tsx",
      pattern: "pendingEcho !== null ? (",
    },
    blastRadius: "the one-row send echo",
  },
  {
    file: "src/components/conversation-view.tsx",
    surface: "composer",
    keyedOnElement: false,
    silent: false,
    resetClass: "ancestor",
    reset:
      "ancestor — the empty-state composer unmounts when the conversation opens (the core.conversation ternary, through EmptyConversation)",
    resetWitness: {
      file: "src/components/conversation-view.tsx",
      pattern: "core.conversation !== null ? (",
      via: ["EmptyConversation"],
    },
    blastRadius: "the welcome composer",
  },
  {
    file: "src/components/conversation-view.tsx",
    surface: "message-list",
    keyedOnElement: false,
    silent: false,
    resetClass: "ancestor",
    reset:
      "ancestor — CompanionWelcome's echo branch unmounts when the send settles",
    resetWitness: {
      file: "src/components/conversation-view.tsx",
      pattern: "pendingRows.length > 0 ? (",
    },
    blastRadius: "the drawer welcome's one-row send echo",
  },
  {
    file: "src/components/conversation-view.tsx",
    surface: "composer",
    keyedOnElement: false,
    silent: false,
    resetClass: "ancestor",
    reset:
      "ancestor — the drawer welcome unmounts when the conversation opens (the core.conversation ternary, through EmptyConversation and CompanionWelcome)",
    resetWitness: {
      file: "src/components/conversation-view.tsx",
      pattern: "core.conversation !== null ? (",
      via: ["EmptyConversation", "CompanionWelcome"],
    },
    blastRadius: "the drawer welcome's composer",
  },
  {
    file: "src/components/message-list-row.tsx",
    surface: "tool-row",
    keyedOnElement: false,
    silent: false,
    resetClass: "backstop",
    reset:
      "backstop — RESTATED in round 4: the row list keys rows on row.key (`${message.id}:${toolCall.id}`, core/transcript-rows.ts), which is STABLE for the call's whole life, so stream updates reuse this boundary instance and nothing here remounts on data change. The stated consequence: a row that throws transiently mid-stream stays a card even after the call settles cleanly, until the transcript backstop's thread#nonce key remounts everything (thread switch or Retry). Accepted over a data-derived key (e.g. row.state), which would remount HEALTHY rows on every state transition and close their open disclosures mid-conversation",
    blastRadius:
      "one tool row — INCLUDING its view-model projection: _toolViewOf(row) runs inside ToolCallRows, which this boundary wraps whole (re-seated on the slot binder at merge). This instance is the top-level tool-call case (settled ask receipts and shelf-less decision surfaces included)",
    radiusWitness: {
      file: "tests-e2e/boundary.spec.ts",
      pattern: 'data-tf-surface-fallback="tool-row"',
    },
  },
  {
    file: "src/components/activity-rail.tsx",
    surface: "tool-row",
    keyedOnElement: false,
    silent: false,
    resetClass: "backstop",
    reset:
      "backstop — same contract as instance #0: activity steps key on step.row.key, stable for the call's life, so the boundary instance persists until the transcript backstop remounts everything",
    blastRadius:
      "one tool row inside an activity group's step — the same ToolCallRows wrap at the second call site (the fold path)",
  },
  {
    file: "src/components/tool-call-rows.tsx",
    surface: "approval-card",
    keyedOnElement: true,
    silent: false,
    resetClass: "element-key",
    reset: "element-key interruptId — a new decision is a new boundary",
    blastRadius: "one inline approval card (shelf-less hosts only)",
  },
  {
    file: "src/components/tool-call-rows.tsx",
    surface: "question-panel",
    keyedOnElement: true,
    silent: false,
    resetClass: "element-key",
    reset: "element-key interruptId — a new set is a new boundary",
    blastRadius: "one inline question panel (shelf-less hosts only)",
  },
  {
    file: "src/components/suspension-surfaces.tsx",
    surface: "decision-card",
    keyedOnElement: false,
    silent: false,
    resetClass: "ancestor",
    reset:
      "ancestor — the keyed data-tf-current-decision wrapper remounts this boundary whenever the presented decision changes: paging, resolution, or a new arrival (round-2 finding 1)",
    resetWitness: {
      file: "src/components/suspension-surfaces.tsx",
      pattern: "key={currentKey}",
    },
    blastRadius: "the currently presented decision; the queue bar survives",
    radiusWitness: {
      file: "tests/suspension-surfaces.test.tsx",
      pattern: 'data-tf-surface-fallback="decision-card"',
    },
  },
  {
    file: "src/components/transcript.tsx",
    surface: "message-list",
    keyedOnElement: false,
    silent: false,
    resetClass: "ancestor",
    reset:
      "ancestor — the transcript backstop's thread#nonce key remounts the whole Transcript on switch/Retry",
    resetWitness: TRANSCRIPT_BACKSTOP_WITNESS,
    blastRadius: "the conversation's message list",
  },
  {
    file: "src/components/transcript.tsx",
    surface: "status-announcer",
    keyedOnElement: false,
    silent: true,
    resetClass: "ancestor",
    reset: "ancestor — the transcript backstop's key, as above",
    resetWitness: TRANSCRIPT_BACKSTOP_WITNESS,
    blastRadius:
      "the sr-only status region vanishes (silent — round-6 finding 2: nothing visible was there to degrade, so a sighted user sees NO change and a screen reader loses the announcer either way; the round-6 audit found no other always-invisible wrapped surface — the count pill paints visible chrome)",
  },
  {
    file: "src/components/transcript.tsx",
    surface: "activity-overlay",
    keyedOnElement: false,
    silent: false,
    resetClass: "ancestor",
    reset: "ancestor — the transcript backstop's key, as above",
    resetWitness: TRANSCRIPT_BACKSTOP_WITNESS,
    blastRadius: "the floating subagent count pill",
  },
  {
    file: "src/components/transcript.tsx",
    surface: "activity-shelf",
    keyedOnElement: false,
    silent: false,
    resetClass: "ancestor",
    reset: "ancestor — the transcript backstop's key, as above",
    resetWitness: TRANSCRIPT_BACKSTOP_WITNESS,
    blastRadius: "the shelf frame (its decision tenant has finer wraps)",
  },
  {
    file: "src/components/transcript.tsx",
    surface: "decisions",
    keyedOnElement: false,
    silent: false,
    resetClass: "ancestor",
    reset:
      "ancestor — the transcript backstop's key; the per-decision boundary INSIDE the tenant handles the common case, this covers the tenant's own frame (queue bar, scroll well)",
    resetWitness: TRANSCRIPT_BACKSTOP_WITNESS,
    blastRadius: "the shelf's decision tenant",
  },
  // DELIBERATE ABSENCE, not an omission: the store binder's composer in
  // transcript.tsx carries NO SurfaceBoundary. The input-region rule — the
  // input region carries the surface's ability to act, so its render throw
  // must propagate loudly, never latch into a fallback beside a read-only
  // transcript — is pinned by tests/transcript-chrome-propagation.test.tsx
  // (a composer throw reaches the HOST's boundary in a bare mount). In the
  // shipping composition the throw lands on conversation-view.tsx's keyed
  // transcript backstop above: the whole conversation degrades to one
  // card, recoverable by thread switch or Retry. The welcome composer rows
  // above are unaffected: the welcome has no live conversation to lock
  // read-only.
];

// --------------------------------------------------------------------------
// The scan.
// --------------------------------------------------------------------------

function sourceFilesOf(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFilesOf(full));
    } else if (entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
}

interface FoundPlacement {
  file: string;
  surface: string;
  keyedOnElement: boolean;
  silent: boolean;
  /** Byte offset of the boundary tag — what witness spans must reach. */
  offset: number;
}

function placementsInSource(): FoundPlacement[] {
  const found: FoundPlacement[] = [];
  for (const file of sourceFilesOf(path.join(packageRoot, "src"))) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/<SurfaceBoundary\b[\s\S]*?>/g)) {
      const tag = match[0];
      found.push({
        file: path.relative(packageRoot, file),
        surface: /surface="([^"]+)"/.exec(tag)?.[1] ?? "?",
        keyedOnElement: /\bkey=/.test(tag),
        silent: tag.includes('degrade="silent"'),
        offset: match.index,
      });
    }
  }
  return found;
}

// --------------------------------------------------------------------------
// Witness structure: the span a witness construct actually governs.
// --------------------------------------------------------------------------

/** Balanced scan from an opening delimiter; returns the end offset. */
function balancedEnd(
  text: string,
  start: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === open) {
      depth += 1;
    } else if (text[i] === close) {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  throw new Error(`unbalanced ${open}${close} from ${String(start)}`);
}

/** The JSX children span of the element whose opening tag carries the
 *  witness key. A self-closing element governs NOTHING — an empty span —
 *  which is exactly what fails the round-4 probe (`key={row.key}` rides
 *  a self-closing <Row />). */
function keyWitnessSpanOf(
  text: string,
  patternIndex: number,
): [number, number] {
  const tagStart = text.lastIndexOf("<", patternIndex);
  const name = /^<([A-Za-z][\w.]*)/.exec(text.slice(tagStart))?.[1];
  if (name === undefined) {
    throw new Error("key witness is not inside an opening tag");
  }
  // Brace-aware walk to the tag's own '>' (attribute expressions may
  // contain '>' inside braces).
  let braceDepth = 0;
  let tagEnd = -1;
  let selfClosing = false;
  for (let i = tagStart + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") {
      braceDepth += 1;
    } else if (ch === "}") {
      braceDepth -= 1;
    } else if (ch === ">" && braceDepth === 0) {
      tagEnd = i;
      selfClosing = text[i - 1] === "/";
      break;
    }
  }
  if (tagEnd === -1) {
    throw new Error("key witness tag never closes");
  }
  if (selfClosing) {
    return [tagEnd, tagEnd]; // empty span: governs nothing
  }
  // Balance <Name …> against </Name> to the matching close.
  const openRe = new RegExp(`<${name}\\b(?![\\w.])`, "g");
  const closeRe = new RegExp(`</${name}>`, "g");
  let depth = 1;
  let cursor = tagEnd + 1;
  for (;;) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const nextOpen = openRe.exec(text);
    const nextClose = closeRe.exec(text);
    if (nextClose === null) {
      throw new Error(`no matching </${name}>`);
    }
    if (nextOpen !== null && nextOpen.index < nextClose.index) {
      // Only paired openings deepen; a self-closing same-name tag does
      // not.
      const innerEnd = text.indexOf(">", nextOpen.index);
      if (text[innerEnd - 1] !== "/") {
        depth += 1;
      }
      cursor = nextOpen.index + 1;
    } else {
      depth -= 1;
      cursor = nextClose.index + 1;
      if (depth === 0) {
        return [tagEnd, nextClose.index];
      }
    }
  }
}

/** The span of a `cond ? (then) : (else)` witness — both branches. */
function branchWitnessSpanOf(
  text: string,
  patternIndex: number,
  pattern: string,
): [number, number] {
  const openParen = patternIndex + pattern.length - 1;
  if (text[openParen] !== "(") {
    throw new Error("branch witness pattern must end with '? ('");
  }
  let end = balancedEnd(text, openParen, "(", ")");
  const elseMatch = /^\s*:\s*\(/.exec(text.slice(end + 1));
  if (elseMatch !== null) {
    end = balancedEnd(text, end + elseMatch[0].length, "(", ")");
  }
  return [openParen, end];
}

/** The body span of `function Name(…) { … }` in a file. */
function componentBodySpanOf(text: string, name: string): [number, number] {
  const signature = new RegExp(`function ${name}\\(`).exec(text);
  if (signature === null) {
    throw new Error(`component ${name} is not defined in the placement file`);
  }
  const parametersEnd = balancedEnd(
    text,
    signature.index + signature[0].length - 1,
    "(",
    ")",
  );
  const bodyOpen = text.indexOf("{", parametersEnd);
  return [bodyOpen, balancedEnd(text, bodyOpen, "{", "}")];
}

/** The relevance law: from the witness span, walk the declared via hops
 *  (each defined in the placement file and mounted in the previous
 *  span), and require the final span to contain the placement offset.
 *  Returns null on success, else the reason the witness is irrelevant. */
function witnessReaches(
  witness: Witness,
  placementFile: string,
  placementOffset: number,
): string | null {
  const witnessText = readFileSync(
    path.join(packageRoot, witness.file),
    "utf8",
  );
  const patternIndex = witnessText.indexOf(witness.pattern);
  if (patternIndex === -1) {
    return `witness pattern not found in ${witness.file}`;
  }
  let span: [number, number];
  try {
    span = witness.pattern.includes("key={")
      ? keyWitnessSpanOf(witnessText, patternIndex)
      : branchWitnessSpanOf(witnessText, patternIndex, witness.pattern);
  } catch (error) {
    return `witness span: ${(error as Error).message}`;
  }
  let spanText = witnessText.slice(span[0], span[1]);
  const placementText = readFileSync(
    path.join(packageRoot, placementFile),
    "utf8",
  );
  const hops = witness.via ?? [];
  if (hops.length === 0 && witness.file !== placementFile) {
    return "a cross-file witness must declare via hops into the placement file";
  }
  for (const hop of hops) {
    if (!spanText.includes(`<${hop}`)) {
      return `hop <${hop}> is not mounted inside the witness span`;
    }
    let body: [number, number];
    try {
      body = componentBodySpanOf(placementText, hop);
    } catch (error) {
      return (error as Error).message;
    }
    span = body;
    spanText = placementText.slice(body[0], body[1]);
  }
  if (placementOffset < span[0] || placementOffset > span[1]) {
    return "the witness span does not contain the placement";
  }
  return null;
}

// --------------------------------------------------------------------------
// The laws.
// --------------------------------------------------------------------------

const keyOf = (p: {
  file: string;
  surface: string;
  keyedOnElement: boolean;
  silent: boolean;
  ordinal: number;
}) =>
  `${p.file} :: ${p.surface} #${String(p.ordinal)} :: ${p.keyedOnElement ? "element-key" : "no-element-key"} :: ${p.silent ? "silent" : "card"}`;

function withOrdinals<T extends { file: string; surface: string }>(
  rows: readonly T[],
): (T & { ordinal: number })[] {
  const counts = new Map<string, number>();
  return rows.map((row) => {
    const group = `${row.file} :: ${row.surface}`;
    const ordinal = counts.get(group) ?? 0;
    counts.set(group, ordinal + 1);
    return { ...row, ordinal };
  });
}

describe("the SurfaceBoundary placement census", () => {
  const found = withOrdinals(
    placementsInSource().sort(
      (a, b) => a.file.localeCompare(b.file) || a.offset - b.offset,
    ),
  );
  // Ledger rows for a (file, surface) group bind to placements in source
  // order — the ordinal in keyOf makes a swapped same-shaped pair a key
  // mismatch, and the witness law checks each row against ITS placement.
  const ledgered = withOrdinals(LEDGER);

  it("every placement in src/** is ledgered, instance-bound, and no ledger row is stale", () => {
    expect(found.map(keyOf).sort()).toEqual(ledgered.map(keyOf).sort());
  });

  it("anti-vacuity: the scan sees the shipping composition", () => {
    expect(found.length).toBeGreaterThanOrEqual(20);
    expect(
      found.some((row) => keyOf(row).includes("transcript #0 :: element-key")),
    ).toBe(true);
  });

  it("the reset class agrees with the element keying — a claimed class cannot contradict the tag", () => {
    for (const row of LEDGER) {
      expect(
        row.resetClass === "element-key",
        `${row.file} :: ${row.surface} — element-key iff key= on the tag`,
      ).toBe(row.keyedOnElement);
    }
  });

  it("reset prose opens with its class and the blast radius is stated", () => {
    // A separate law from class-vs-tag on purpose: the round-4 controls
    // showed a single loop's first throw masks the second assertion.
    for (const row of LEDGER) {
      expect(
        row.reset.startsWith(row.resetClass),
        `${row.file} :: ${row.surface} — reset prose must open with its class`,
      ).toBe(true);
      expect(row.blastRadius.length).toBeGreaterThan(0);
    }
  });

  it("every ancestor row's witness STRUCTURALLY reaches its own placement; non-ancestor rows cite none", () => {
    const placementByKey = new Map(found.map((p) => [keyOf(p), p]));
    for (const row of ledgered) {
      const label = `${row.file} :: ${row.surface} #${String(row.ordinal)}`;
      if (row.resetClass !== "ancestor") {
        expect(
          row.resetWitness,
          `${label} — only ancestor rows carry a reset witness`,
        ).toBeUndefined();
        continue;
      }
      expect(
        row.resetWitness,
        `${label} — an ancestor claim needs a witness`,
      ).toBeDefined();
      const placement = placementByKey.get(keyOf(row));
      expect(placement, `${label} — no matching placement`).toBeDefined();
      if (row.resetWitness === undefined || placement === undefined) {
        continue;
      }
      const failure = witnessReaches(
        row.resetWitness,
        row.file,
        placement.offset,
      );
      expect(failure, `${label} — ${failure ?? ""}`).toBeNull();
    }
  });

  it("every cited radius probe exists", () => {
    for (const row of LEDGER) {
      if (row.radiusWitness === undefined) {
        continue;
      }
      const text = readFileSync(
        path.join(packageRoot, row.radiusWitness.file),
        "utf8",
      );
      expect(
        text.includes(row.radiusWitness.pattern),
        `${row.file} :: ${row.surface} — radius probe pattern missing from ${row.radiusWitness.file}`,
      ).toBe(true);
    }
  });

  it("REGRESSION CONTROL — the round-4 probe: an ancestor claim witnessed by the stable row key is rejected structurally", () => {
    // The verifier's exact probe: the step key genuinely exists in
    // activity-rail.tsx, but it rides a self-closing <ActivityRailStep />,
    // whose span is empty — the law must reject it without reading any prose.
    const toolRow = found.find(
      (p) =>
        p.file === "src/components/activity-rail.tsx" &&
        p.surface === "tool-row",
    );
    expect(toolRow).toBeDefined();
    if (toolRow === undefined) {
      return;
    }
    const failure = witnessReaches(
      {
        file: "src/components/activity-rail.tsx",
        pattern:
          'key={step.kind === "tool-call" ? step.row.key : step.view.key}',
      },
      "src/components/activity-rail.tsx",
      toolRow.offset,
    );
    expect(failure).not.toBeNull();
    // And the careless author's other reach — the transcript backstop
    // witness six rows legitimately cite — is equally rejected for this
    // placement: its span mounts <Transcript>, and no Transcript hop is
    // definable in activity-rail.tsx, so the chain cannot land here.
    const crossFile = witnessReaches(
      TRANSCRIPT_BACKSTOP_WITNESS,
      "src/components/activity-rail.tsx",
      toolRow.offset,
    );
    expect(crossFile).not.toBeNull();
  });
});
