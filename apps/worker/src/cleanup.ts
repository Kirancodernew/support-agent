import { DocumentModel } from '@support-agent/db';
import type { Storage } from '@support-agent/storage';

// Upload links expire after 5 minutes, so an upload still "uploading" after an hour was abandoned
// (tab closed, network died) and can never finish.
export const STALE_UPLOAD_MS = 60 * 60 * 1000;
const BATCH = 100;

/** Removes abandoned uploads: the record (so it stops counting toward the limit) and any file in S3. */
export async function cleanupStaleUploads(storage: Storage, now = new Date()) {
  const cutoff = new Date(now.getTime() - STALE_UPLOAD_MS);
  const stale = await DocumentModel.find({ status: 'uploading', createdAt: { $lt: cutoff } }, { _id: 1 }).limit(BATCH);

  let removed = 0;
  for (const { _id } of stale) {
    // Conditional delete: if the upload was completed in the meantime, leave it alone.
    const doc = await DocumentModel.findOneAndDelete({ _id, status: 'uploading' });
    if (!doc) continue;
    // The file may never have reached S3; deleting a missing key is fine.
    await storage.remove(doc.s3Key);
    removed++;
  }
  return { removed };
}
