"use client";

import type { SettledQuestionsReceipt } from "../core/question-receipt.js";
import { ToolRow } from "./tool-row.js";

// The temporary receipt in a shelf-less host uses the same registered
// tool view as the durable transcript row once its result arrives.
export function QuestionSetReceiptRow({
  receipt,
}: {
  receipt: SettledQuestionsReceipt;
}) {
  return (
    <ToolRow
      view={{
        toolName: "ask_user",
        state: "output-available",
        input: JSON.stringify({ questions: receipt.questions }),
        output: JSON.stringify({ answers: receipt.answers }),
        display: {
          completeText: "Asked for your input",
          icon: "question",
          view: { key: "teaflask.questions", version: 1 },
        },
      }}
    />
  );
}
