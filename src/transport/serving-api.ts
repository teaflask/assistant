// The session-scoped face over the generated /serving/v1 client: every
// call threads its TokenSession into the mutator, so streams and REST
// calls share one token lifecycle. Signatures stay the package's own —
// components never see the generated layer.

import {
  beginSubscriptionAuthorization as beginSubscriptionAuthorizationOperation,
  completeSubscriptionAuthorization as completeSubscriptionAuthorizationOperation,
  createServingAttachmentUpload as createServingAttachmentUploadOperation,
  disconnectSubscription as disconnectSubscriptionOperation,
  finalizeServingAttachment as finalizeServingAttachmentOperation,
  getServingAttachmentDownloadUrl as getServingAttachmentDownloadUrlOperation,
  getServingAssistantThread as getServingAssistantThreadOperation,
  listServingAssistantThreadDispatches as listServingAssistantThreadDispatchesOperation,
  listServingAssistantThreads as listServingAssistantThreadsOperation,
  listServingSubscriptions as listServingSubscriptionsOperation,
  readAssistantConfig as readAssistantConfigOperation,
  resolveServingAssistantTurnApproval as resolveServingAssistantTurnApprovalOperation,
  resolveServingAssistantTurnToolResults as resolveServingAssistantTurnToolResultsOperation,
  sendServingAssistantMessage as sendServingAssistantMessageOperation,
  stopServingAssistantTurn as stopServingAssistantTurnOperation,
} from "../generated/serving.js";
import type {
  GetServingAssistantThreadParams,
  ListServingAssistantThreadsParams,
  ServingAttachmentDownloadUrlResponse,
} from "../generated/models/index.js";
import type { AssistantConfigResponse } from "../contract/assistant-config.js";
import type { ThreadDispatch } from "../contract/dispatches.js";
import type {
  AssistantThreadDetailResponse,
  AttachmentUploadIntent,
  ResolveTurnApprovalRequest,
  ResolveTurnApprovalResponse,
  ResolveTurnToolResultsRequest,
  ResolveTurnToolResultsResponse,
  SendAssistantMessageRequest,
  SendAssistantMessageResponse,
  ServingAssistantThread,
  ServingAttachment,
  StopTurnResponse,
} from "../contract/threads.js";
import type {
  SubscriptionAuthorization,
  SubscriptionAuthorizationCompletion,
  SubscriptionAuthorizationCompletionRequest,
  SubscriptionProvider,
  SubscriptionStatus,
} from "../contract/subscriptions.js";
import type { ServingRequestInit } from "./serving-fetch.js";
import type { TokenSession } from "./token-session.js";

export async function sendAssistantMessage(
  session: TokenSession,
  request: SendAssistantMessageRequest,
): Promise<SendAssistantMessageResponse> {
  return sendServingAssistantMessageOperation(request, _withSession(session));
}

/** The stop door: thread-scoped on purpose — the server's
 *  thread pointer names the live turn (liveness, never recency), so the
 *  caller never picks one. Every answer is a receipt, including
 *  already_settled: the button races the answer by nature. */
export async function stopAssistantTurn(
  session: TokenSession,
  threadId: string,
): Promise<StopTurnResponse> {
  return stopServingAssistantTurnOperation(threadId, _withSession(session));
}

export async function listAssistantThreads(
  session: TokenSession,
  params?: ListServingAssistantThreadsParams,
): Promise<ServingAssistantThread[]> {
  return listServingAssistantThreadsOperation(params, _withSession(session));
}

export async function getAssistantThread(
  session: TokenSession,
  threadId: string,
  params?: GetServingAssistantThreadParams,
): Promise<AssistantThreadDetailResponse> {
  return getServingAssistantThreadOperation(
    threadId,
    params,
    _withSession(session),
  );
}

export async function listThreadDispatches(
  session: TokenSession,
  threadId: string,
): Promise<ThreadDispatch[]> {
  return listServingAssistantThreadDispatchesOperation(
    threadId,
    _withSession(session),
  );
}

export async function getAssistantConfig(
  session: TokenSession,
): Promise<AssistantConfigResponse> {
  return readAssistantConfigOperation(_withSession(session));
}

export async function resolveTurnApproval(
  session: TokenSession,
  threadId: string,
  turnId: string,
  request: ResolveTurnApprovalRequest,
): Promise<ResolveTurnApprovalResponse> {
  return resolveServingAssistantTurnApprovalOperation(
    threadId,
    turnId,
    request,
    _withSession(session),
  );
}

export async function resolveTurnToolResults(
  session: TokenSession,
  threadId: string,
  turnId: string,
  request: ResolveTurnToolResultsRequest,
): Promise<ResolveTurnToolResultsResponse> {
  return resolveServingAssistantTurnToolResultsOperation(
    threadId,
    turnId,
    request,
    _withSession(session),
  );
}

export async function createAttachmentUpload(
  session: TokenSession,
  request: { filename: string; byte_size: number },
): Promise<AttachmentUploadIntent> {
  return createServingAttachmentUploadOperation(request, _withSession(session));
}

export async function finalizeAttachment(
  session: TokenSession,
  attachmentId: string,
): Promise<ServingAttachment> {
  return finalizeServingAttachmentOperation(
    attachmentId,
    _withSession(session),
  );
}

export async function getAttachmentDownloadUrl(
  session: TokenSession,
  attachmentId: string,
): Promise<ServingAttachmentDownloadUrlResponse> {
  return getServingAttachmentDownloadUrlOperation(
    attachmentId,
    _withSession(session),
  );
}

export async function listSubscriptions(
  session: TokenSession,
): Promise<SubscriptionStatus[]> {
  const response = await listServingSubscriptionsOperation(
    _withSession(session),
  );
  return response.subscriptions;
}

/** Mints one Sign in with ChatGPT: the URL the widget opens in a popup
 *  and how long it stays claimable. The server's callback page posts the
 *  provider's code back to the opener (never a result); the widget then
 *  finishes with completeSubscriptionAuthorization under its own bearer.
 *  Nothing is polled. */
export async function beginSubscriptionAuthorization(
  session: TokenSession,
  provider: SubscriptionProvider,
): Promise<SubscriptionAuthorization> {
  return beginSubscriptionAuthorizationOperation(
    provider,
    _withSession(session),
  );
}

/** Finishes one Sign in with ChatGPT with the code and sealed state the
 *  callback page posted. The server refuses a state begun under another
 *  visitor's bearer, a spent state, and an expired one — all with one
 *  coarse code — so the finish is bound to the browser that began. */
export async function completeSubscriptionAuthorization(
  session: TokenSession,
  provider: SubscriptionProvider,
  request: SubscriptionAuthorizationCompletionRequest,
): Promise<SubscriptionAuthorizationCompletion> {
  return completeSubscriptionAuthorizationOperation(
    provider,
    request,
    _withSession(session),
  );
}

export async function disconnectSubscription(
  session: TokenSession,
  provider: SubscriptionProvider,
): Promise<void> {
  await disconnectSubscriptionOperation(provider, _withSession(session));
}

/**
 * The direct-to-storage PUT: a plain fetch against the presigned URL —
 * no auth header (the signature is the credential), no Content-Type (the
 * server sniffs the stored bytes; the signature pins only the length).
 */
export async function putFileToUploadUrl(
  uploadUrl: string,
  file: Blob,
): Promise<void> {
  const response = await fetch(uploadUrl, { method: "PUT", body: file });
  if (!response.ok) {
    throw new Error(`The file upload failed (${String(response.status)}).`);
  }
}

// The stream endpoints are deliberately absent from the generated client
// (they speak SSE through replay-stream-agent, not JSON); their paths are
// pinned to serving-openapi.json by tests/contract-parity.
export function streamUrlForThread(
  session: TokenSession,
  threadId: string,
): string {
  return `${session.baseUrl}/serving/v1/assistant-threads/${threadId}/stream`;
}

/** The child transcript stream: one dispatched subagent's own
 *  replay-then-tail, addressed by the thread and the child session id —
 *  the only child handle on the serving wire. */
export function streamUrlForChild(
  session: TokenSession,
  threadId: string,
  childSessionId: string,
): string {
  return `${session.baseUrl}/serving/v1/assistant-threads/${threadId}/dispatches/${childSessionId}/stream`;
}

function _withSession(session: TokenSession): ServingRequestInit {
  return { session };
}
