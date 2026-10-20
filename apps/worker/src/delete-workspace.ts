import {
  ApiKeyModel,
  ChunkModel,
  ConversationModel,
  deleteSequence,
  DocumentModel,
  InboxItemModel,
  toObjectId,
  UserModel,
  WorkspaceModel,
} from '@support-agent/db';
import type { Storage } from '@support-agent/storage';

const S3_PARALLEL = 10;
const SWEEP_BATCH = 10;

/**
 * Removes everything a workspace owns. Safe to run again after a failure part-way: each step
 * deletes whatever is left, and the workspace record goes last, so it stays marked until all is gone.
 */
export async function purgeWorkspace(storage: Storage, workspaceId: string) {
  const wid = toObjectId(workspaceId);

  // Files first. Our document records are the only list of them (the worker can't list the bucket:
  // least privilege), so the records must outlive the files.
  const docs = await DocumentModel.find({ workspaceId: wid }, { s3Key: 1 }).lean();
  for (let i = 0; i < docs.length; i += S3_PARALLEL) {
    await Promise.all(docs.slice(i, i + S3_PARALLEL).map((d) => storage.remove(d.s3Key)));
  }

  // Chunks are indexed by document, so delete them by document id (by workspace would scan them all).
  const chunks = await ChunkModel.deleteMany({ documentId: { $in: docs.map((d) => d._id) } });
  const [documents, conversations, inboxItems, apiKeys, users] = await Promise.all([
    DocumentModel.deleteMany({ workspaceId: wid }),
    ConversationModel.deleteMany({ workspaceId: wid }),
    InboxItemModel.deleteMany({ workspaceId: wid }),
    ApiKeyModel.deleteMany({ workspaceId: wid }),
    UserModel.deleteMany({ workspaceId: wid }),
  ]);
  await deleteSequence(`inbox:${workspaceId}`);
  await WorkspaceModel.deleteOne({ _id: wid });

  return {
    files: docs.length,
    chunks: chunks.deletedCount,
    documents: documents.deletedCount,
    conversations: conversations.deletedCount,
    inboxItems: inboxItems.deletedCount,
    apiKeys: apiKeys.deletedCount,
    users: users.deletedCount,
  };
}

/** Safety net: finishes any deletion whose job was never queued or ran out of retries. */
export async function purgeDeletedWorkspaces(storage: Storage) {
  const pending = await WorkspaceModel.find({ deletingAt: { $type: 'date' } }, { _id: 1 }).limit(SWEEP_BATCH).lean();
  for (const { _id } of pending) await purgeWorkspace(storage, String(_id));
  return { purged: pending.length };
}
