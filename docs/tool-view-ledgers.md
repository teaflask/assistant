# Tool-view ledgers — arguments, producer transforms, and the boundary-newline cross-product

**Status: accepted.** The living ledgers of the package's
producer-backed rung-3 views (`tool-views.md`): for each view, the
ARGUMENT LEDGER it renders against, the PRODUCER TRANSFORMS between the
recorded call and the real effect, and — for the file-edit view — the
BOUNDARY-NEWLINE CROSS-PRODUCT its diff arms decide. A ledger changes
when its producer does; the producers are named inside each block.

## `teaflask.command` — `src/components/tool-views/command-view.ts`

```text
ARGUMENT LEDGER (verified against the producers,
strands/vended_tools/shell/shell.py and
the serving side's docs_filesystem module):
  command — required str on both tools; absent (mid-stream) or
    wrong-typed → no Command pane, the rest renders.
  timeout — sandbox_bash only, optional int (default 120);
    deliberately not rendered (operational knob, not the operation).
```

```text
PRODUCER TRANSFORMS (the sweep of everything between the recorded
call and the real streams): sandbox_bash's dict rides as its
json.dumps transport form (accounted: the record arm parses it, the
cut-document guard refuses its clipped half); bash's 2MB stream
marker and docsfs's 30k marker are IN the recorded text and render
verbatim; docsfs merges stderr and the exit code into stdout with
[stderr] / [exit code N] markers, likewise rendered verbatim; a
docsfs run with no output at all is replaced by one model-facing
sentence ("The command ran with exit code 0 and produced no
output.", _render_run_result) — recognized and rendered as this
view's own quiet no-output note, the same treatment the file-edit
view gives the editor's preamble; the mapper's 20k clip is channel
2 below.
```

## `teaflask.file-edit` — `src/components/tool-views/file-edit-view.ts`

```text
PRODUCER TRANSFORMS (the sweep of everything the editor does between
the recorded args and the real effect,
strands/vended_tools/file_editor/file_editor.py):
  tab expansion — str_replace and insert expand "\t" to 8 spaces on
    the file content AND on old_str/new_str before matching and
    writing; create writes file_text VERBATIM. Accounted: the
    str_replace arms and insert expand before rendering/diffing (the
    file received spaces, and a tab⇄8-spaces "edit" is byte-identical
    at the producer, so it renders "matches the original", never an
    Edit); create stays verbatim, pinned.
  path normalization — trailing slashes are stripped from `path`
    before use. Deliberately unhandled: the header renders the
    recorded argument, and the strip changes no content.
  view preamble — a view result is never bare contents: _make_output
    prefixes "Here's the result of running `cat -n` on <path>:" and
    _list_directory prefixes "Here's the files and directories up to
    2 levels deep in <path>, excluding hidden items:". Accounted: the
    pane drops that one model-facing first line;
    the `cat -n` numbering and any view_range slice below it ARE the
    recorded read and render verbatim.
```

```text
ARGUMENT LEDGER (verified against the producer):
  command — required Literal[view, create, str_replace, insert];
    absent/unknown/wrong-typed → the quiet "No rendered edit" note.
  path — required str; absent → no header line, the rest renders.
    For `view` it may name a FILE or a DIRECTORY (_handle_view
    returns a listing for a directory), and the args carry no signal
    which — so the pane label stays neutral ("Contents"), never
    "File".
  old_str — str, required for str_replace (the handler raises on
    None); wrong-typed here → "No rendered edit".
  new_str — OPTIONAL for str_replace, and absence means DELETE: the
    editor expands a missing OR empty new_str to "" (`if new_str
    else ""`), so absent/null/"" all render as a deletion;
    only a wrong-typed value is unrenderable. Required
    for insert (the handler raises on None).
  insert_line — int, required for insert; the editor accepts only
    integers in [0, n_lines] and raises otherwise, so the position
    claim renders only for a non-negative integer — anything else
    omits the claim rather than guessing.
  file_text — str, required for create; wrong-typed/absent → the
    quiet note; empty → a note, never a bare "+" claiming a line.
  view_range — list[int], optional, view only; deliberately not
    rendered (the result IS the recorded read).
```

```text
BOUNDARY-NEWLINE CROSS-PRODUCT (every cell decided against the
producer; each kept cell is pinned by a deliberate-non-change
test in tests/file-edit-tool-view.test.ts):
  create × leading — KEEP: file_text is written verbatim, so a
    leading "\n" IS a first blank line.
  create × trailing — DROP ONE: the last line's terminator.
  insert × leading — KEEP: the splice inserts split("\n") verbatim,
    so a leading "" is a real inserted blank line.
  insert × trailing — KEEP: same; "x\n" inserts a real blank line.
  str_replace deletion × leading — DROP ONE: removing "\nfoo"
    consumes the PRECEDING line's terminator as the joint — the
    deleted line is foo, not a blank plus foo.
  str_replace deletion × trailing — DROP ONE: the last deleted
    line's terminator.
  Myers edit × leading and × trailing — KEEP BOTH: with both
    fragments recorded, a one-sided boundary newline is a real
    structural change (a line join or split) and the ± empty line is
    the diff's standard spelling of it; a shared boundary newline
    renders as a blank context line.
```

## `teaflask.action` — `src/components/tool-views/action-view.ts`

```text
PRODUCER TRANSFORMS (the sweep of everything between the recorded
call and the real request/response):
  the envelope wrap — tool_return_of serializes the success envelope
    whole; accounted, it IS the parse premise below.
  the client's body degrade — result.truncated; the adapter
    (transport/actions-adapter.ts) bounds the body and appends its
    own in-text "… [truncated: …]" notice alongside the flag;
    accounted (the truncation note, the "(truncated)" label, and the
    notice rendering verbatim inside the recorded body).
  the sanitizer — sanitize_untrusted_json rewrites forged role tags
    in the client-reported result's string leaves before recording;
    the record IS the sanitized form, and this view renders the
    record (the honesty law) — nothing to undo.
  headers — an OPTIONAL wire field no producer populates today:
    _intentResultOf (transport/actions-adapter.ts) builds exactly
    {status, body, truncated}. Nothing to render;
    the tests and the fixture pose the adapter's real shape.
  the path fill — the client composes the real URL from path_template
    outside the recorded call; that is the method/path omission
    recorded above.
```

```text
ARGUMENT LEDGER (verified against the producer,
the serving side's http_actions.py::build_action_tool):
  path_params — dict, required iff the catalog row declares the
    section; absent/null → the section is not part of this request,
    so no pane (absence is meaningful, never an error).
  query — dict, required only when its schema names required
    properties; absent/null → no pane.
  body — dict, required iff declared; absent/null → no pane.
  (All three sections: an EMPTY record renders no pane either — the
  same absence, since _required_section_names leaves e.g. `query`
  optional when its schema names no required properties and a model
  may send `{}`. No other argument exists; additionalProperties is
  false at the producer, but args are unvalidated model output
  mid-stream, so every read still guards its type.)
```

## `teaflask.docs-search` — `src/components/tool-views/docs-search-view.ts`

```text
ARGUMENT LEDGER (verified against the producer,
the serving side's docs_search.py::build_docs_search):
  query — required str; absent (mid-stream) or wrong-typed → the card
    title degrades from `Results for “<query>”` to `Results` (over the
    skeleton while running, over the card once settled); the rest
    renders.
```

```text
PRODUCER TRANSFORMS (everything between the recorded call and the
real search): the tool returns plain text, never the envelope —
_render_hits joins one block per hit with a blank line; each block is
"[slug#anchor] Title › Heading" (the heading suffix only when the
section has one), an optional "Updated: YYYY-MM-DD · Verified:
YYYY-MM-DD" facts line, then the section content verbatim; no hits is
the sentence "No documentation sections matched this query." The view
parses exactly that grammar (docsSearchHitsOf) and renders any other
text verbatim in a pane — a producer change degrades to honest text,
never to a wrong list. A hit ends only where a blank line meets the next
headline line — the join _render_hits makes — so a section whose content
carries its own blank lines (mdv1_chunker rejoins a section's blocks with
one) stays one hit; text that does not open with a headline is not the
format and falls to the pane whole. The mapper's 20k clip (channel 2) is
invisible here: a cut list renders its complete hits and the cut tail as
the last hit's text.
```
