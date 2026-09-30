// actionFailureOf — the failed action's recorded reason in both forms the
// transcript can carry: the whole failure envelope, and the sentence alone
// (the mapper keeps error.message for the error channel), whose words
// spell the same status, code and field problems.

import { describe, expect, it } from "vitest";

import {
  actionFailureOf,
  humanFailureSentenceOf,
} from "../src/components/tool-views/view-dom";

const SENTENCE =
  '"Create Doc" failed in this page: HTTP 422 VALIDATION_ERROR — Validation failed. ' +
  'Field problems: "body.title": "Field required"; "body.body_md": "line 3: unknown directive". ' +
  "Do not assume the action ran; tell the user what was being attempted so they can decide what to do.";

describe("actionFailureOf", () => {
  it("reads the structured detail off the failure envelope", () => {
    const text = JSON.stringify({
      ok: false,
      error: {
        code: "execution_failed",
        message: "It failed.",
        detail: { status: 409, code: "DOC_SLUG_TAKEN", fields: [] },
      },
      instruction: "Do not assume the action ran.",
    });
    expect(actionFailureOf(text)).toEqual({
      message: "It failed.",
      detail: { status: 409, code: "DOC_SLUG_TAKEN", fields: [] },
    });
  });

  it("reads the same facts off the bare sentence", () => {
    expect(actionFailureOf(SENTENCE)).toEqual({
      message: SENTENCE,
      detail: {
        status: 422,
        code: "VALIDATION_ERROR",
        fields: [
          { path: "body.title", message: "Field required" },
          { path: "body.body_md", message: "line 3: unknown directive" },
        ],
      },
    });
  });

  it("reads any whitespace-free code the API spells — lowercase, dotted, hyphenated — never only SCREAMING_SNAKE", () => {
    for (const code of ["doc.slug-taken", "e42", "Validation-Error:body"]) {
      const sentence =
        `"Create Doc" failed in this page: HTTP 409 ${code} — Taken. ` +
        'Field problems: "body.slug": "already used". ' +
        "Do not assume the action ran; tell the user what was being attempted so they can decide what to do.";
      expect(actionFailureOf(sentence)?.detail).toEqual({
        status: 409,
        code,
        fields: [{ path: "body.slug", message: "already used" }],
      });
      expect(humanFailureSentenceOf(sentence)).toBe(
        '"Create Doc" failed in this page: Taken.',
      );
    }
  });

  it("keeps a path-less message whole when it carries the grammar's own delimiters — colon-space and semicolon-space", () => {
    // The breaking case: bare `Something: happened; and more` would read
    // as path "Something" and two entries. Quoted literals make the
    // delimiters inert inside the API's words.
    const sentence =
      '"Create Doc" failed in this page: HTTP 422 VALIDATION_ERROR — Validation failed. ' +
      `Field problems: ${JSON.stringify("Something: happened; and more")}; ` +
      `"body.title": ${JSON.stringify("use a colon: never; a semicolon")}; ` +
      `${JSON.stringify('quoted "word"')}. ` +
      "Do not assume the action ran; tell the user what was being attempted so they can decide what to do.";
    expect(actionFailureOf(sentence)?.detail?.fields).toEqual([
      { path: "", message: "Something: happened; and more" },
      { path: "body.title", message: "use a colon: never; a semicolon" },
      { path: "", message: 'quoted "word"' },
    ]);
    expect(humanFailureSentenceOf(sentence)).toBe(
      '"Create Doc" failed in this page: Validation failed.',
    );
  });

  it("reads the omitted tally — `; and N more` closes the clause — and never invents one", () => {
    const sentence =
      '"Create Doc" failed in this page: HTTP 422 VALIDATION_ERROR — Validation failed. ' +
      'Field problems: "body.title": "Field required"; and 4 more. ' +
      "Do not assume the action ran; tell the user what was being attempted so they can decide what to do.";
    expect(actionFailureOf(sentence)?.detail).toEqual({
      status: 422,
      code: "VALIDATION_ERROR",
      fields: [{ path: "body.title", message: "Field required" }],
      fieldsOmitted: 4,
    });
    // A tally without the closing tail is not the grammar.
    expect(
      actionFailureOf(
        sentence.replace("and 4 more. Do not", "and 4 more Do not"),
      )?.detail?.fields,
    ).toEqual([]);
    // The envelope shape carries the same count.
    const envelope = JSON.stringify({
      ok: false,
      error: {
        code: "execution_failed",
        message: "It failed.",
        detail: { status: 422, code: "X", fields: [], fieldsOmitted: 3 },
      },
    });
    expect(actionFailureOf(envelope)?.detail?.fieldsOmitted).toBe(3);
  });

  it("yields no fields, never a guess, for a clause that is not the producer's grammar", () => {
    // The unquoted spelling an older producer or a hand-written sentence
    // might carry, and a literal broken by a raw line break: the status
    // and code still read; the fields do not tokenize and stay empty.
    const unquoted =
      '"Create Doc" failed in this page: HTTP 422 VALIDATION_ERROR — Validation failed. ' +
      "Field problems: body.title: Field required. " +
      "Do not assume the action ran; tell the user what was being attempted so they can decide what to do.";
    expect(actionFailureOf(unquoted)?.detail).toEqual({
      status: 422,
      code: "VALIDATION_ERROR",
      fields: [],
    });
    const broken =
      '"Create Doc" failed in this page: HTTP 422 VALIDATION_ERROR — Validation failed. ' +
      'Field problems: "body.title": "line 3:\nunknown". ' +
      "Do not assume the action ran; tell the user what was being attempted so they can decide what to do.";
    expect(actionFailureOf(broken)?.detail?.fields).toEqual([]);
    expect(humanFailureSentenceOf(broken)).toBe(
      '"Create Doc" failed in this page: Validation failed.',
    );
  });

  it("reads no status off a prefix that is not the frame's — the grammar is anchored to the frame's own words", () => {
    // A bare "HTTP 500 x — " inside some other sentence is not the
    // producer's shape; the reader must not invent a detail from it.
    expect(
      actionFailureOf("The API said HTTP 500 upstream — try again.")?.detail,
    ).toBeNull();
  });

  it("keeps a sentence naming no facts as a message with no detail", () => {
    expect(actionFailureOf("The page took too long.")).toEqual({
      message: "The page took too long.",
      detail: null,
    });
    expect(actionFailureOf(undefined)).toBeNull();
    expect(
      actionFailureOf(JSON.stringify({ ok: true, result: {} })),
    ).toBeNull();
  });
});

describe("humanFailureSentenceOf", () => {
  it("keeps the human reason alone — no status, no error code, no field clause, no model-facing tail — and plain text as itself", () => {
    const envelope = JSON.stringify({
      ok: false,
      error: {
        code: "execution_failed",
        message:
          '"Create Doc" failed in this page: HTTP 422 DOC_BODY_INVALID — Raw HTML is not allowed. Do not assume the action ran; tell the user what was being attempted so they can decide what to do.',
      },
      instruction: "Do not assume the action ran.",
    });
    expect(humanFailureSentenceOf(envelope)).toBe(
      '"Create Doc" failed in this page: Raw HTML is not allowed.',
    );
    // The bare sentence — what the mapper's error channel carries.
    expect(humanFailureSentenceOf(SENTENCE)).toBe(
      '"Create Doc" failed in this page: Validation failed.',
    );
    expect(humanFailureSentenceOf("The fare backend broke.")).toBe(
      "The fare backend broke.",
    );
  });

  it("the machine facts the row drops are exactly the ones actionFailureOf still reads for a view", () => {
    const human = humanFailureSentenceOf(SENTENCE);
    expect(human).not.toContain("HTTP");
    expect(human).not.toContain("VALIDATION_ERROR");
    expect(human).not.toContain("Field problems");
    expect(actionFailureOf(SENTENCE)?.detail?.fields).toHaveLength(2);
  });
});
