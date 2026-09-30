// The read-only record of ask_user. Answering remains in QuestionPanel;
// this registered view presents the recorded questions and answers.
import type { QuestionModel } from "../../core/elicitation-pickers.js";
import { settledQuestionsReceiptOf } from "../../core/question-receipt.js";
import type { ToolViewProps } from "../../core/tool-view.js";
import {
  card,
  el,
  note,
  settledOutcomeNotesOf,
  settledWithResult,
  statelessToolView,
} from "./view-dom.js";

export const questionsToolView = statelessToolView(renderQuestions);

function renderQuestions({ call }: ToolViewProps): HTMLElement {
  const root = el("div", "tf:min-w-0");
  root.dataset.tfQuestionsView = "";
  root.append(...settledOutcomeNotesOf(call));
  const receipt =
    settledWithResult(call) && call.truncated !== true
      ? settledQuestionsReceiptOf(
          call.toolName,
          JSON.stringify(call.args),
          call.resultText,
        )
      : null;
  // The active QuestionPanel owns unanswered questions. Keep this view
  // empty until there is a durable answer record to inspect.
  if (receipt === null) {
    if (settledWithResult(call)) {
      root.append(note("No answers are available in this record."));
    }
    return root;
  }
  root.dataset.tfElicitationReceipt = "";
  root.dataset.tfQuestionsReceipt = "";
  const answers = new Map(
    receipt.answers.map((answer) => [answer.id, answer.text]),
  );
  const list = el("dl", "tf:m-0");
  receipt.questions.forEach((question) => {
    list.append(
      questionSection(question, answers.get(question.id) ?? "Answered."),
    );
  });
  root.append(card([list]));
  return root;
}

function questionSection(
  question: QuestionModel,
  answer: string | undefined,
): HTMLElement {
  const section = el(
    "div",
    "tf:min-w-0 tf:border-t tf:border-tf-border tf:p-4 tf:first:border-t-0",
  );
  const title = el("dt", "");
  title.append(
    el(
      "span",
      "tf:wrap-anywhere tf:text-tf-label tf:font-medium tf:text-tf-foreground",
      question.heading,
    ),
  );
  const prompt = el(
    "dd",
    "tf:m-0 tf:mt-1.5 tf:wrap-anywhere tf:whitespace-pre-wrap tf:text-tf-label tf:leading-relaxed tf:text-tf-muted-foreground",
    question.prompt,
  );
  prompt.dataset.tfElicitationReceiptQuestion = "";
  section.append(title, prompt);
  if (answer !== undefined) {
    const value = el(
      "dd",
      "tf:m-0 tf:mt-3 tf:rounded-md tf:bg-tf-muted tf:px-3 tf:py-2.5 tf:wrap-anywhere tf:whitespace-pre-wrap tf:text-tf-label tf:leading-relaxed tf:text-tf-foreground",
    );
    value.dataset.tfElicitationReceiptAnswer = "";
    value.append(
      el("span", "tf:sr-only", "Answered: "),
      document.createTextNode(answer),
    );
    section.append(value);
  }
  return section;
}
