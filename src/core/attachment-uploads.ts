// One attached file's server-side life, driven from the composer: the
// three-step upload (declare, PUT, finalize) and the on-demand display
// URL mint with its TTL cache. The _downloadUrls cache stays a store
// field per the friend convention.

import type { ServingAttachment } from "../contract/threads.js";
import {
  createAttachmentUpload,
  finalizeAttachment,
  getAttachmentDownloadUrl,
  putFileToUploadUrl,
} from "../transport/serving-api.js";
import type { MintedDownloadUrl } from "./conversation-contract.js";
import type { AssistantConversationStore } from "./conversation-store.js";

/** The three-step upload as one call: declare, PUT the bytes straight
 *  to storage, finalize (the server sniffs what the file actually is).
 *  Resolves with the settled attachment; throws with a user sentence
 *  when any step refuses — the chip renders it. */
export async function uploadAttachmentFromStore(
  store: AssistantConversationStore,
  file: File,
): Promise<ServingAttachment> {
  const intent = await createAttachmentUpload(store.deps.session, {
    filename: file.name !== "" ? file.name : "attachment",
    byte_size: file.size,
  });
  await putFileToUploadUrl(intent.upload_url, file);
  return finalizeAttachment(store.deps.session, intent.attachment.id);
}

/** Exchange a stable attachment id for a display URL, minted on demand
 *  and reused only while comfortably inside its short TTL. The expiry
 *  rides along so a long-lived renderer knows when to come back for a
 *  fresh one — a widget stays open far longer than a URL lives. */
export async function mintAttachmentDownloadUrlFromStore(
  store: AssistantConversationStore,
  attachmentId: string,
): Promise<MintedDownloadUrl> {
  const cached = store._downloadUrls.get(attachmentId);
  if (cached !== undefined && cached.expiresAtMs > Date.now()) {
    return cached;
  }
  const fresh = await getAttachmentDownloadUrl(
    store.deps.session,
    attachmentId,
  );
  const minted: MintedDownloadUrl = {
    url: fresh.url,
    // A 30-second safety margin: a URL about to expire must not be
    // handed to an <img> that fetches it a beat later.
    expiresAtMs: Date.now() + (fresh.expires_in_seconds - 30) * 1000,
  };
  store._downloadUrls.set(attachmentId, minted);
  return minted;
}
