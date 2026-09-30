// The stream's frozen AG-UI event vocabulary. Structural shapes come from
// @ag-ui/core; CUSTOM marker names and payloads are generated from
// serving-openapi.json. Clients MUST ignore unrecognized events and fields.

import type {
  ApprovalRequestedMarker,
  ApprovalResolvedMarker,
  InterruptAnswerConsumedMarker,
  RunResumedMarker,
  SubagentResultsDeliveredMarker,
  ToolExecutionRequestedMarker,
} from "../generated/models/index.js";
import { AssistantStreamMarkerName } from "../generated/models/index.js";

// The @ag-ui/core subset the backend emits: product truth, not generated.
export type AssistantStreamEventType =
  | "TEXT_MESSAGE_START"
  | "TEXT_MESSAGE_CONTENT"
  | "TEXT_MESSAGE_END"
  | "REASONING_START"
  | "REASONING_END"
  | "REASONING_MESSAGE_START"
  | "REASONING_MESSAGE_CONTENT"
  | "REASONING_MESSAGE_END"
  | "TOOL_CALL_START"
  | "TOOL_CALL_ARGS"
  | "TOOL_CALL_END"
  | "TOOL_CALL_RESULT"
  | "RUN_STARTED"
  | "RUN_FINISHED"
  | "RUN_ERROR"
  | "CUSTOM";

// A retried activity attempt, emitted only when attempt > 1 — never a
// message; the client reads it for retry severance only (stream-resume).
export const RUN_RESUMED_EVENT_NAME = AssistantStreamMarkerName.run_resumed;

export type RunResumedPayload = RunResumedMarker;

// One per pending approval while the turn awaits input; tool_call_id anchors
// the ask to the already-streamed tool call (the card is keyed by interrupt_id).
export const APPROVAL_REQUESTED_EVENT_NAME =
  AssistantStreamMarkerName.approval_requested;

// The approval-inbox decoder guarantees these server-defaulted fields.
export type ApprovalRequestedPayload = ApprovalRequestedMarker &
  Required<
    Pick<
      ApprovalRequestedMarker,
      | "tool_args"
      | "tool_input_schema"
      | "tool_output_schema"
      | "round"
      | "gated"
      | "trust_available"
    >
  >;

// The durable receipt of a human's answer to an approval_requested ask —
// never a message; a replayed receipt flips the replayed card to answered.
export const APPROVAL_RESOLVED_EVENT_NAME =
  AssistantStreamMarkerName.approval_resolved;

export type ApprovalResolvedPayload = ApprovalResolvedMarker;

// A resume carried this pause's answer into the agent: never
// rendered, it is consumed evidence for the pending-decision-gap derivation.
export const INTERRUPT_ANSWER_CONSUMED_EVENT_NAME =
  AssistantStreamMarkerName.interrupt_answer_consumed;

export type InterruptAnswerConsumedPayload = InterruptAnswerConsumedMarker;

// The turn settled failed outside any single tool — never a
// message or banner. Its live run ends in RUN_ERROR; on replay the terminal
// demotes to RUN_FINISHED and this marker is the failure's durable record.
export const TURN_FAILED_EVENT_NAME = AssistantStreamMarkerName.turn_failed;

// The member ended the turn; same { receipt } shape as turn_failed.
export const TURN_STOPPED_EVENT_NAME = AssistantStreamMarkerName.turn_stopped;

// One per pending client-executed tool call while the turn awaits input —
// this package's execution loop executes it and POSTs the result back.
export const TOOL_EXECUTION_REQUESTED_EVENT_NAME =
  AssistantStreamMarkerName.tool_execution_requested;

// The execution-inbox decoder guarantees these server-defaulted fields.
export type ToolExecutionRequestedPayload = ToolExecutionRequestedMarker &
  Required<Pick<ToolExecutionRequestedMarker, "round">>;

// Durable receipt of a delivered result: a reconnect never re-runs the request.
export const TOOL_RESULT_RECORDED_EVENT_NAME =
  AssistantStreamMarkerName.tool_result_recorded;

// Backend-authored human copy for one tool call, anchored by tool_call_id. May
// arrive more than once per call: merged per field by tool-call-display-anchors.ts.
export const TOOL_CALL_ANNOTATED_EVENT_NAME =
  AssistantStreamMarkerName.tool_call_annotated;

// A machine-started delivery turn opens its run with this receipt
// naming the settled dispatches it pushes. A quiet divider, never a message.
export const SUBAGENT_RESULTS_DELIVERED_EVENT_NAME =
  AssistantStreamMarkerName.subagent_results_delivered;

export type SubagentResultsDeliveredPayload = SubagentResultsDeliveredMarker;

// The turn's settled token totals: one per settled turn that had
// usage to sum, landed just before the terminal. Only finality "final" is
// settled truth ("partial" sums are lower bounds); absence means UNKNOWN —
// never an estimate or zero.
export const TURN_USAGE_RECORDED_EVENT_NAME =
  AssistantStreamMarkerName.turn_usage_recorded;

// One agent-memory row actually written during the run; a dedup
// no-op emits nothing. memory_id reconciles re-deliveries. End-user safe:
// a scope token and a canned sentence, never the memory's content.
export const MEMORY_UPDATED_EVENT_NAME =
  AssistantStreamMarkerName.memory_updated;
