// The conversation surfaces: send, list, detail, approval. The shapes are
// generated from serving-openapi.json; this file keeps the package's
// public names stable over the generated ones. The serving contract
// stays normative for semantics (additive-only policy, tier rules).

export type {
  CreateServingAttachmentUploadResponse as AttachmentUploadIntent,
  HighlightResult,
  NavigateResult,
  PrefillFormResult,
  ReadPageResult,
  ResolveServingTurnApprovalRequest as ResolveTurnApprovalRequest,
  ResolveServingTurnApprovalResponse as ResolveTurnApprovalResponse,
  ResolveServingTurnToolResultsRequest as ResolveTurnToolResultsRequest,
  ResolveServingTurnToolResultsResponse as ResolveTurnToolResultsResponse,
  SendServingAssistantMessageRequest as SendAssistantMessageRequest,
  SendServingAssistantMessageResponse as SendAssistantMessageResponse,
  ServingApprovalDelivery as ApprovalDelivery,
  ServingAssistantThreadDetailResponse as AssistantThreadDetailResponse,
  ServingAssistantThreadResponse as ServingAssistantThread,
  ServingAssistantTurnResponse as ServingAssistantTurn,
  ServingAttachmentResponse as ServingAttachment,
  ServingTurnApprovalDecision as TurnApprovalDecision,
  ServingTurnAttachmentResponse as TurnAttachment,
  StopServingTurnResponse as StopTurnResponse,
  ThreadModelPickResponse as ThreadModelPick,
  AssistantTurnStatus as TurnStatus,
} from "../generated/models/index.js";

// Mirrors the send surface's message length bound, so the limit is felt
// while typing rather than as a 422 after submitting. A runtime value the
// schema carries only as a maxLength annotation — tests/contract-parity
// pins it to serving-openapi.json.
export const ASSISTANT_MESSAGE_MAX_CHARS = 4000;

// Mirrors the send surface's attachment_ids bound the same way — the
// composer refuses an eleventh chip instead of surfacing a 422.
export const ASSISTANT_MAX_ATTACHMENTS = 10;
