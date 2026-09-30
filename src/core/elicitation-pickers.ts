// The ask's wire narrowing: from a builtin.ask_questions
// request's distrusted action payload to the question set the panel
// renders, or null. Like the other transcript narrowers, this module is
// React-free and deterministic (no clocks, no locale, question and
// option order preserved), own-key reads over the distrusted wire — the
// action arrives verbatim on the execution request and is narrowed here
// even though the server's questions/v1 door already refused malformed
// shapes, because the client never assumes server-side validation holds
// across versions. Public via ./transcript: the dashboard imports this
// module rather than keeping a fork.

export interface QuestionOptionModel {
  text: string;
  description: string | null;
}

export interface QuestionModel {
  id: string;
  heading: string;
  prompt: string;
  options: readonly QuestionOptionModel[];
}

/**
 * Narrow a builtin.ask_questions request's action payload —
 * the wire is distrusted. Own-key checks, never `in`. Strict about the
 * whole set: one malformed question returns null for the set, because
 * a panel that silently dropped a question would post an incomplete
 * answer set the door refuses; the pending-decision gap then speaks for
 * the unrenderable pause instead.
 */
export function askQuestionsActionOf(
  action: Record<string, unknown> | null,
): { questions: QuestionModel[] } | null {
  if (action === null) {
    return null;
  }
  const raw = _hasOwn(action, "questions") ? action.questions : null;
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }
  const questions: QuestionModel[] = [];
  const seen = new Set<string>();
  for (const candidate of raw) {
    if (!_isRecord(candidate)) {
      return null;
    }
    const id = _hasOwn(candidate, "id") ? candidate.id : null;
    const heading = _hasOwn(candidate, "heading") ? candidate.heading : null;
    const prompt = _hasOwn(candidate, "prompt") ? candidate.prompt : null;
    if (
      typeof id !== "string" ||
      id === "" ||
      seen.has(id) ||
      typeof heading !== "string" ||
      heading.trim() === "" ||
      typeof prompt !== "string" ||
      prompt.trim() === ""
    ) {
      return null;
    }
    seen.add(id);
    const rawOptions = _hasOwn(candidate, "options") ? candidate.options : [];
    if (!Array.isArray(rawOptions)) {
      return null;
    }
    const options: QuestionOptionModel[] = [];
    // Suggestion texts are the rows' React keys and the answer itself:
    // distinct within a question by the server's law, re-checked here
    // because the wire is distrusted (case-insensitively, as the server).
    const seenTexts = new Set<string>();
    for (const option of rawOptions) {
      if (!_isRecord(option)) {
        return null;
      }
      const text = _hasOwn(option, "text") ? option.text : null;
      if (typeof text !== "string" || text.trim() === "") {
        return null;
      }
      const folded = text.toLowerCase();
      if (seenTexts.has(folded)) {
        return null;
      }
      seenTexts.add(folded);
      const description = _hasOwn(option, "description")
        ? option.description
        : null;
      // Every model-authored display string of the set takes the same
      // escaped-quote normalization: heading, prompt, suggestion text
      // AND description — the suggestion's text is also the answer that
      // posts back, so it must read clean in the panel, in the receipt
      // and to the model alike.
      options.push({
        text: text.replace(/\\"/g, '"'),
        description:
          typeof description === "string" && description.trim() !== ""
            ? description.replace(/\\"/g, '"')
            : null,
      });
    }
    questions.push({
      id,
      heading: heading.replace(/\\"/g, '"'),
      prompt: prompt.replace(/\\"/g, '"'),
      options,
    });
  }
  return { questions };
}

function _hasOwn(record: Record<string, unknown>, key: string): boolean {
  // An own-key read spelled to compile under lib es6 — the constraint
  // the deleted dashboard fork imposed; the spelling stays
  // because changing it buys nothing.
  return Object.prototype.hasOwnProperty.call(record, key);
}

function _isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
