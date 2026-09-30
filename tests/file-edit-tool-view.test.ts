// @vitest-environment jsdom
// teaflask.file-edit — the recorded edit as a diff derived from the
// ARGS (the result carries only a post-edit snippet): str_replace's
// old/new pair through unifiedDiffOf, create as an all-added file,
// insert as added lines after the first insert_line existing lines,
// view as the read snippet with no diff claim.

import { describe, expect, it } from "vitest";

import { fileEditToolView } from "../src/components/tool-views/file-edit-view";
import type { ToolViewCall, ToolViewProps } from "../src/core/tool-view";

function propsOf(overrides: Partial<ToolViewCall> = {}): ToolViewProps {
  return {
    call: {
      toolName: "sandbox_file_editor",
      toolCallId: "t1",
      status: "output-available",
      awaitingDecision: false,
      args: {
        command: "str_replace",
        path: "/workspace/src/kettle.py",
        old_str: "temperature = 100\nsteep_minutes = 5",
        new_str: "temperature = 80\nsteep_minutes = 2",
      },
      // Abridged scaffolding, not a producer mirror: the edit arms
      // render from args and never read resultText, and this string
      // carries no counterfeit formatting (no cat -n gutter). Strings
      // that DO claim the real format live in the view tests below and
      // follow _make_output exactly.
      resultText:
        "The file /workspace/src/kettle.py has been edited. Review the changes.",
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
  const instance = fileEditToolView.mount(container, props);
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

describe("fileEditToolView — the four commands", () => {
  it("str_replace renders a real diff: deletions in the status voice, additions in ink, no hunk offsets", () => {
    const { container, destroy } = mounted(propsOf());
    expect(container.textContent).toContain("/workspace/src/kettle.py");
    expect(container.textContent).toContain("Edit");
    const deletions = [
      ...container.querySelectorAll(String.raw`span.tf\:text-tf-destructive`),
    ].map((span) => span.textContent.replace(/^\n/, ""));
    const additions = [...container.querySelectorAll("span")]
      .filter((span) => span.className === "tf:text-tf-foreground")
      .map((span) => span.textContent.replace(/^\n/, ""));
    expect(deletions.join("")).toContain("-temperature = 100");
    expect(additions.join("")).toContain("+temperature = 80");
    // Hunk offsets are fragment-relative; printing them would read as
    // file line numbers — a wrong claim, so they never render.
    expect(container.textContent).not.toContain("@@");
    destroy();
  });

  // NEGATIVE CONTROLS for the elision-marking law (round-4 finding 1),
  // executed and reverted; recorded here because a diff that silently
  // claims completeness is exactly the defect a passing test cannot
  // catch — the plausible output IS the bug. Each mutation of
  // _diffPane's marking went red in the named test:
  //   leading marker removed (the header condition reduced to
  //     `rendered > 0`, i.e. first header never marked) →
  //     "marks a LEADING elision — anchor lines before the first hunk
  //     never vanish silently".
  //   over-marked (the condition forced true, so a hunk opening at the
  //     fragment's first line is marked too) →
  //     "a diff covering the whole fragment carries no elision mark"
  //     AND "marks a TRAILING elision …" (its spans[0]-is-not-⋯ arm).
  //   trailing marker removed (the post-loop oldLineCount check
  //     deleted) → "marks a TRAILING elision — recorded lines past the
  //     last hunk are said to be skipped".
  //   The invisible-elision case below is the class-breaking pose: with
  //   identical recorded lines, NOTHING but the marker distinguishes
  //   the rendered context from the whole fragment.

  it("marks a LEADING elision — anchor lines before the first hunk never vanish silently", () => {
    // PREMISE (round-4 finding 1): unifiedDiffOf keeps 3 context lines,
    // so a change past the fragment's 6th anchor line starts its hunk
    // mid-fragment — without a marker the pane would read as a complete
    // diff of a fragment it elided.
    const anchors = ["a1", "a2", "a3", "a4", "a5", "a6"];
    const { container, destroy } = mounted(
      propsOf({
        args: {
          command: "str_replace",
          path: "/w/f.txt",
          old_str: [...anchors, "old7"].join("\n"),
          new_str: [...anchors, "new7"].join("\n"),
        },
      }),
    );
    const spans = [...container.querySelectorAll("code span")].map((span) =>
      span.textContent.replace(/^\n/, ""),
    );
    expect(spans[0]).toBe("⋯");
    expect(container.textContent).not.toContain("a1");
    expect(container.textContent).toContain("a4");
    destroy();
  });

  it("marks a TRAILING elision — recorded lines past the last hunk are said to be skipped", () => {
    const anchors = ["a1", "a2", "a3", "a4", "a5", "a6"];
    const { container, destroy } = mounted(
      propsOf({
        args: {
          command: "str_replace",
          path: "/w/f.txt",
          old_str: ["old1", ...anchors].join("\n"),
          new_str: ["new1", ...anchors].join("\n"),
        },
      }),
    );
    const spans = [...container.querySelectorAll("code span")].map((span) =>
      span.textContent.replace(/^\n/, ""),
    );
    expect(spans[spans.length - 1]).toBe("⋯");
    expect(spans[0]).not.toBe("⋯");
    expect(container.textContent).not.toContain("a5");
    destroy();
  });

  it("marks an INVISIBLE elision — identical recorded lines give the reader no other signal", () => {
    // The class-breaking pose: six identical recorded anchor lines,
    // change on the seventh. The pane renders three context copies plus
    // the change — a perfectly coherent, complete-looking fragment —
    // and the ⋯ marker is the ONLY thing that says three more recorded
    // lines were dropped. Distinct anchor names (the leading-elision
    // test above) leak the elision through their numbering; identical
    // lines do not.
    const oldLines = [...Array.from({ length: 6 }, () => "retry()"), "old7"];
    const newLines = [...Array.from({ length: 6 }, () => "retry()"), "new7"];
    const { container, destroy } = mounted(
      propsOf({
        args: {
          command: "str_replace",
          path: "/w/f.txt",
          old_str: oldLines.join("\n"),
          new_str: newLines.join("\n"),
        },
      }),
    );
    const spans = [...container.querySelectorAll("code span")].map((span) =>
      span.textContent.replace(/^\n/, ""),
    );
    expect(spans[0]).toBe("⋯");
    // Exactly three rendered context copies of a line the record holds
    // six times — without the marker the pane would read complete.
    expect(spans.filter((text) => text === " retry()")).toHaveLength(3);
    expect(spans.filter((text) => text === "⋯")).toHaveLength(1);
    destroy();
  });

  it("a diff covering the whole fragment carries no elision mark", () => {
    // The other direction: the hunk opens at line 1 and its context
    // reaches the fragment's end, so nothing is skipped and no ⋯
    // renders.
    const { container, destroy } = mounted(
      propsOf({
        args: {
          command: "str_replace",
          path: "/w/f.txt",
          old_str: "a\nb",
          new_str: "x\nb",
        },
      }),
    );
    expect(container.textContent).not.toContain("⋯");
    destroy();
  });

  it("diff panes carry no trailing empty line box", () => {
    // Lines join with prepended newlines (round-4 finding 3): under
    // pre-wrap a trailing "\n" would paint an empty line the recorded
    // edit does not have.
    const { container, destroy } = mounted(propsOf());
    const code = container.querySelector("code");
    expect(code?.textContent.endsWith("\n")).toBe(false);
    destroy();
  });

  it("separates multiple hunks with a quiet mark instead of offsets", () => {
    const spacer = Array.from({ length: 10 }, (_, i) => `keep ${String(i)}`);
    const before = ["first old", ...spacer, "last old"].join("\n");
    const after = ["first new", ...spacer, "last new"].join("\n");
    const { container, destroy } = mounted(
      propsOf({
        args: {
          command: "str_replace",
          path: "/w/f.txt",
          old_str: before,
          new_str: after,
        },
      }),
    );
    expect(container.textContent).toContain("⋯");
    expect(container.textContent).not.toContain("@@");
    destroy();
  });

  it("create renders the whole file as additions", () => {
    const { container, destroy } = mounted(
      propsOf({
        args: {
          command: "create",
          path: "/workspace/notes.md",
          file_text: "# Notes\nSteep longer.",
        },
      }),
    );
    expect(container.textContent).toContain("New file");
    expect(container.textContent).toContain("+# Notes");
    expect(container.textContent).toContain("+Steep longer.");
    destroy();
  });

  it("create with a trailing newline renders exactly the file's lines — no bare +", () => {
    // PREMISE (round-2 finding 2): _handle_create writes file_text
    // VERBATIM, so "a\nb\n" is a two-line file whose trailing "\n" is
    // the last line's terminator — never a third added line.
    const { container, destroy } = mounted(
      propsOf({
        args: {
          command: "create",
          path: "/workspace/notes.md",
          file_text: "# Notes\nSteep longer.\n",
        },
      }),
    );
    const additions = [...container.querySelectorAll("code span")].filter(
      (span) => span.className === "tf:text-tf-foreground",
    );
    expect(
      additions.map((span) => span.textContent.replace(/^\n/, "")),
    ).toEqual(["+# Notes", "+Steep longer."]);
    destroy();
  });

  it("create with empty file_text says so — a bare + would claim an added line", () => {
    const { container, destroy } = mounted(
      propsOf({
        args: { command: "create", path: "/workspace/empty.md", file_text: "" },
      }),
    );
    expect(container.textContent).toContain("Created an empty file.");
    expect(container.querySelectorAll("pre")).toHaveLength(0);
    destroy();
  });

  it("insert names its anchor the way the editor splices: after the first N lines", () => {
    // PREMISE (round-1 finding 2): _build_insert_result splices at
    // file_text_lines[:insert_line], so the text lands after the first
    // `insert_line` existing lines — insert_line: 4 is after line 4 in
    // the ordinary 1-indexed reading. The vended docstring's
    // "0-indexed" contradicts its own splice; a "(0-indexed)" label
    // here would send the reader one line down.
    const { container, destroy } = mounted(
      propsOf({
        args: {
          command: "insert",
          path: "/workspace/notes.md",
          new_str: "A new line.",
          insert_line: 4,
        },
      }),
    );
    expect(container.textContent).toContain("Inserted after line 4");
    expect(container.textContent).not.toContain("0-indexed");
    expect(container.textContent).toContain("+A new line.");
    destroy();
  });

  it("insert_line 0 is the top of the file, never 'after line 0'", () => {
    const { container, destroy } = mounted(
      propsOf({
        args: {
          command: "insert",
          path: "/workspace/notes.md",
          new_str: "A new line.",
          insert_line: 0,
        },
      }),
    );
    expect(container.textContent).toContain("Inserted at the top of the file");
    expect(container.textContent).not.toContain("after line");
    destroy();
  });

  it("insert without a usable line number claims no position", () => {
    const { container, destroy } = mounted(
      propsOf({
        args: {
          command: "insert",
          path: "/workspace/notes.md",
          new_str: "A new line.",
          insert_line: "four",
        },
      }),
    );
    expect(container.textContent).toContain("Inserted");
    expect(container.textContent).not.toContain("after line");
    expect(container.textContent).not.toContain("top of the file");
    destroy();
  });

  it("every labelled pane — the diff pane and the Contents pane — keeps the one label-to-pane rhythm", () => {
    // PANE_CLASS carries no margin of its own (a host's reset could not
    // collapse what is not there), so the gap between label and pane is
    // the wrapper's explicit flex gap, shared with view-dom's pane().
    const edit = mounted(propsOf());
    const diffWrapper = edit.container.querySelector("pre")?.parentElement;
    expect(diffWrapper?.className).toContain("tf:flex tf:flex-col tf:gap-1");
    expect(diffWrapper?.firstElementChild?.tagName).toBe("P");
    edit.destroy();
    const read = mounted(
      propsOf({
        args: { command: "view", path: "/workspace/src/kettle.py" },
        resultText: "line one\nline two",
      }),
    );
    const readWrapper = read.container.querySelector("pre")?.parentElement;
    expect(readWrapper?.className).toContain("tf:flex tf:flex-col tf:gap-1");
    read.destroy();
  });

  it("view renders the read as a plain 'Contents' pane, dropping the model-facing preamble", () => {
    // The REAL producer output (round-3 finding 1): _make_output always
    // opens with one sentence addressed to the model, restating the
    // path the header line above already shows. "Contents", not "File"
    // (round-2 finding 4): a view over a directory returns a listing,
    // and the args cannot tell which. Gutter per _make_output: a
    // width-6 right-aligned number, then two spaces — tabs are expanded
    // to 8 spaces before numbering, so a literal tab cannot appear.
    const real =
      "Here's the result of running `cat -n` on /workspace/src/kettle.py:\n" +
      "     1  temperature = 80\n     2  steep_minutes = 2\n";
    const { container, destroy } = mounted(
      propsOf({
        args: { command: "view", path: "/workspace/src/kettle.py" },
        resultText: real,
      }),
    );
    expect(container.textContent).toContain("Contents");
    expect(container.textContent).not.toContain("File");
    expect(container.textContent).not.toContain("Here's the result");
    expect(container.textContent).toContain("temperature = 80");
    // Standalone on the row, the pane sits flush with the path line and
    // the diff panes — no card-interior inset.
    const paneWrapper = container.querySelector("pre")?.parentElement;
    expect(paneWrapper?.className).not.toContain("tf:px-");
    expect(paneWrapper?.className).not.toContain("tf:py-");
    expect(
      container.querySelectorAll(String.raw`span.tf\:text-tf-destructive`),
    ).toHaveLength(0);
    destroy();
  });

  it("view drops the directory preamble too, and leaves preamble-free text alone", () => {
    // _list_directory emits paths RELATIVE to the viewed directory
    // (entry.name, or prefix/name one level down), sorted — never
    // absolute paths.
    const listing =
      "Here's the files and directories up to 2 levels deep in /workspace/src, excluding hidden items:\n" +
      "kettle.py\nsteep.py\n";
    const directory = mounted(
      propsOf({
        args: { command: "view", path: "/workspace/src" },
        resultText: listing,
      }),
    );
    expect(directory.container.textContent).not.toContain("Here's the files");
    expect(directory.container.textContent).toContain("kettle.py");
    directory.destroy();

    // The other direction: text without the deterministic preamble
    // renders untouched — the drop never eats a recorded first line.
    const bare = mounted(
      propsOf({
        args: { command: "view", path: "/workspace/src/kettle.py" },
        resultText: "first line\nsecond line",
      }),
    );
    expect(bare.container.textContent).toContain("first line");
    bare.destroy();
  });

  it("a str_replace without new_str is a DELETION and renders one", () => {
    // PREMISE (round-1 finding 1): new_str is optional for str_replace
    // and the editor expands a missing OR empty value to "" — omitting
    // it deletes the match. Absent, null, and "" all mean the same
    // recorded deletion.
    for (const argsOverride of [
      { command: "str_replace", path: "/w/f.txt", old_str: "gone\nlines" },
      {
        command: "str_replace",
        path: "/w/f.txt",
        old_str: "gone\nlines",
        new_str: null,
      },
      {
        command: "str_replace",
        path: "/w/f.txt",
        old_str: "gone\nlines",
        new_str: "",
      },
    ]) {
      const { container, destroy } = mounted(propsOf({ args: argsOverride }));
      expect(container.textContent).toContain("Deletion");
      const deletions = [
        ...container.querySelectorAll(String.raw`span.tf\:text-tf-destructive`),
      ].map((span) => span.textContent.replace(/^\n/, ""));
      expect(deletions.join("")).toContain("-gone");
      expect(deletions.join("")).toContain("-lines");
      expect(container.textContent).not.toContain("No rendered edit");
      destroy();
    }
  });

  it("a deletion whose old_str ends in a newline drops the terminator — no bare -", () => {
    // PREMISE (round-2 finding 2): the editor removes old_str's exact
    // CHARACTERS, so "gone\nlines\n" deletes two lines and their
    // terminators — the trailing "\n" is not a third deleted line.
    const { container, destroy } = mounted(
      propsOf({
        args: {
          command: "str_replace",
          path: "/w/f.txt",
          old_str: "gone\nlines\n",
        },
      }),
    );
    const deletions = [
      ...container.querySelectorAll(String.raw`span.tf\:text-tf-destructive`),
    ].map((span) => span.textContent.replace(/^\n/, ""));
    expect(deletions).toEqual(["-gone", "-lines"]);
    destroy();
  });

  it("insert KEEPS a trailing newline's empty segment — the splice really inserts a blank line", () => {
    // The deliberate other half of round-2 finding 2:
    // _build_insert_result splices new_str.split("\n") verbatim, so
    // "x\n" inserts "x" AND a real blank line — dropping the trailing
    // segment here would hide an applied change.
    const { container, destroy } = mounted(
      propsOf({
        args: {
          command: "insert",
          path: "/workspace/notes.md",
          new_str: "x\n",
          insert_line: 2,
        },
      }),
    );
    const additions = [...container.querySelectorAll("code span")].filter(
      (span) => span.className === "tf:text-tf-foreground",
    );
    expect(
      additions.map((span) => span.textContent.replace(/^\n/, "")),
    ).toEqual(["+x", "+"]);
    destroy();
  });

  it("an anchor the editor would refuse claims no position — negative or fractional included", () => {
    // The editor accepts only integers in [0, n_lines] (round-2
    // finding 3): interpolating "-1" or "2.5" would be a guess about a
    // call the producer would have raised on.
    for (const badLine of [-1, 2.5]) {
      const { container, destroy } = mounted(
        propsOf({
          args: {
            command: "insert",
            path: "/workspace/notes.md",
            new_str: "A new line.",
            insert_line: badLine,
          },
        }),
      );
      expect(container.textContent).toContain("Inserted");
      expect(container.textContent).not.toContain("after line");
      expect(container.textContent).not.toContain("top of the file");
      destroy();
    }
  });

  it("a deletion whose old_str LEADS with a newline drops the joint — one deleted line, not two", () => {
    // PREMISE (round-3 finding 3): removing "\nfoo" consumes the
    // PRECEDING line's terminator as the joint — the deleted line is
    // foo alone, never a blank line plus foo.
    const { container, destroy } = mounted(
      propsOf({
        args: { command: "str_replace", path: "/w/f.txt", old_str: "\nfoo" },
      }),
    );
    const deletions = [
      ...container.querySelectorAll(String.raw`span.tf\:text-tf-destructive`),
    ].map((span) => span.textContent.replace(/^\n/, ""));
    expect(deletions).toEqual(["-foo"]);
    destroy();
  });

  it("deletion drops exactly ONE newline per boundary — an interior blank line stays deleted", () => {
    const bothBoundaries = mounted(
      propsOf({
        args: { command: "str_replace", path: "/w/f.txt", old_str: "\nfoo\n" },
      }),
    );
    expect(
      [
        ...bothBoundaries.container.querySelectorAll(
          String.raw`span.tf\:text-tf-destructive`,
        ),
      ].map((span) => span.textContent.replace(/^\n/, "")),
    ).toEqual(["-foo"]);
    bothBoundaries.destroy();

    const realBlank = mounted(
      propsOf({
        args: { command: "str_replace", path: "/w/f.txt", old_str: "\n\nfoo" },
      }),
    );
    expect(
      [
        ...realBlank.container.querySelectorAll(
          String.raw`span.tf\:text-tf-destructive`,
        ),
      ].map((span) => span.textContent.replace(/^\n/, "")),
    ).toEqual(["-", "-foo"]);
    realBlank.destroy();
  });

  it("create KEEPS a leading newline — the file really starts with a blank line", () => {
    // Deliberate non-change (the cross-product's create × leading
    // cell): file_text is written verbatim.
    const { container, destroy } = mounted(
      propsOf({
        args: { command: "create", path: "/w/f.txt", file_text: "\nA" },
      }),
    );
    const additions = [...container.querySelectorAll("code span")].filter(
      (span) => span.className === "tf:text-tf-foreground",
    );
    expect(
      additions.map((span) => span.textContent.replace(/^\n/, "")),
    ).toEqual(["+", "+A"]);
    destroy();
  });

  it("insert KEEPS a leading newline — the splice really inserts a blank line first", () => {
    // Deliberate non-change (insert × leading).
    const { container, destroy } = mounted(
      propsOf({
        args: {
          command: "insert",
          path: "/w/f.txt",
          new_str: "\nx",
          insert_line: 1,
        },
      }),
    );
    const additions = [...container.querySelectorAll("code span")].filter(
      (span) => span.className === "tf:text-tf-foreground",
    );
    expect(
      additions.map((span) => span.textContent.replace(/^\n/, "")),
    ).toEqual(["+", "+x"]);
    destroy();
  });

  it("the Myers edit arm KEEPS boundary newlines on both sides — a one-sided one is a real change", () => {
    // Deliberate non-changes (Myers × leading, Myers × trailing): with
    // both fragments recorded, a one-sided boundary newline is a line
    // join/split and the ± empty line is the diff's honest spelling.
    const leading = mounted(
      propsOf({
        args: {
          command: "str_replace",
          path: "/w/f.txt",
          old_str: "\nfoo",
          new_str: "bar",
        },
      }),
    );
    expect(
      [
        ...leading.container.querySelectorAll(
          String.raw`span.tf\:text-tf-destructive`,
        ),
      ].map((span) => span.textContent.replace(/^\n/, "")),
    ).toEqual(["-", "-foo"]);
    leading.destroy();

    const trailing = mounted(
      propsOf({
        args: {
          command: "str_replace",
          path: "/w/f.txt",
          old_str: "a",
          new_str: "a\n",
        },
      }),
    );
    const additions = [...trailing.container.querySelectorAll("code span")]
      .filter((span) => span.className === "tf:text-tf-foreground")
      .map((span) => span.textContent.replace(/^\n/, ""));
    expect(additions).toEqual(["+"]);
    trailing.destroy();
  });

  it("a tab⇄eight-spaces replacement is byte-identical at the editor and renders no Edit", () => {
    // PREMISE (round-3 finding 2): str_replace matches and writes
    // tab-EXPANDED fragments, so this call changed nothing — an "Edit"
    // pane would be a wrong claim.
    const { container, destroy } = mounted(
      propsOf({
        args: {
          command: "str_replace",
          path: "/w/f.txt",
          old_str: "        x",
          new_str: "\tx",
        },
      }),
    );
    expect(container.textContent).toContain("matches the original");
    expect(container.textContent).not.toContain("Edit");
    destroy();
  });

  it("deletion and insert render the tab-expanded bytes the file actually received", () => {
    const deletion = mounted(
      propsOf({
        args: { command: "str_replace", path: "/w/f.txt", old_str: "\tfoo" },
      }),
    );
    expect(
      [
        ...deletion.container.querySelectorAll(
          String.raw`span.tf\:text-tf-destructive`,
        ),
      ].map((span) => span.textContent.replace(/^\n/, "")),
    ).toEqual(["-        foo"]);
    deletion.destroy();

    const insertion = mounted(
      propsOf({
        args: {
          command: "insert",
          path: "/w/f.txt",
          new_str: "\tx",
          insert_line: 1,
        },
      }),
    );
    expect(insertion.container.textContent).toContain("+        x");
    insertion.destroy();
  });

  it("create keeps tabs verbatim — the one command the editor does not expand", () => {
    // Deliberate non-change: _handle_create writes file_text verbatim.
    const { container, destroy } = mounted(
      propsOf({
        args: { command: "create", path: "/w/f.txt", file_text: "\tx" },
      }),
    );
    const additions = [...container.querySelectorAll("code span")].filter(
      (span) => span.className === "tf:text-tf-foreground",
    );
    expect(
      additions.map((span) => span.textContent.replace(/^\n/, "")),
    ).toEqual(["+\tx"]);
    destroy();
  });

  it("an unsettled deletion is labeled a proposal", () => {
    const { container, destroy } = mounted(
      propsOf({
        status: "input-available",
        resultText: undefined,
        args: { command: "str_replace", path: "/w/f.txt", old_str: "gone" },
      }),
    );
    expect(container.textContent).toContain("Proposed deletion");
    destroy();
  });

  it("a wrong-typed new_str is still unrenderable — absence means delete, garbage means nothing", () => {
    const { container, destroy } = mounted(
      propsOf({
        args: {
          command: "str_replace",
          path: "/w/f.txt",
          old_str: "gone",
          new_str: 7,
        },
      }),
    );
    expect(container.textContent).toContain("No rendered edit");
    expect(container.textContent).not.toContain("Deletion");
    destroy();
  });

  it("an identical replacement says so instead of rendering an empty diff", () => {
    const { container, destroy } = mounted(
      propsOf({
        args: {
          command: "str_replace",
          path: "/w/f.txt",
          old_str: "same",
          new_str: "same",
        },
      }),
    );
    expect(container.textContent).toContain("matches the original");
    destroy();
  });

  it("an unknown or malformed command renders a quiet note, never a guess", () => {
    // new_str is deliberately NOT in this list: absent/null new_str is
    // a deletion, not a malformation (the deletion test above). What is
    // malformed here is a wrong-typed old_str and a missing command.
    for (const args of [
      { command: "undo_edit", path: "/w/f.txt" },
      { command: "str_replace", path: "/w/f.txt", old_str: 4 },
      { path: "/w/f.txt" },
    ]) {
      const { container, destroy } = mounted(propsOf({ args }));
      expect(container.textContent).toContain("No rendered edit");
      destroy();
    }
  });
});

describe("fileEditToolView — honesty across the lifecycle", () => {
  it("labels the same shape a proposal until the call settles", () => {
    const running = mounted(
      propsOf({ status: "input-available", resultText: undefined }),
    );
    expect(running.container.textContent).toContain("Proposed edit");
    running.destroy();

    const settled = mounted(propsOf());
    expect(settled.container.textContent).toContain("Edit");
    expect(settled.container.textContent).not.toContain("Proposed");
    settled.destroy();
  });

  it("a failed or interrupted call keeps the proposal framing, never the applied claim", () => {
    for (const status of [
      "output-error",
      "cancelled",
      "refused",
      "superseded",
    ] as const) {
      const { container, destroy } = mounted(
        propsOf({ status, resultText: undefined }),
      );
      expect(container.textContent).toContain("Proposed edit");
      destroy();
    }
  });

  it("updates in place from proposal to applied and clears on destroy", () => {
    const { container, update, destroy } = mounted(
      propsOf({ status: "input-available", resultText: undefined }),
    );
    expect(container.textContent).toContain("Proposed edit");
    update(propsOf());
    expect(container.textContent).not.toContain("Proposed");
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
      { args: {} },
      { args: { command: "view", path: 9 } },
      { args: { command: "create" } },
      { args: { command: "insert", new_str: "x", insert_line: -1 } },
      {
        args: { command: "str_replace", old_str: "a", new_str: "b" },
        truncated: true,
      },
      { offloaded: true, resultText: undefined },
      { errorText: "boom", resultText: undefined },
      { refusalText: "no", resultText: undefined },
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
});
