import { model, Schema } from 'mongoose';

export const DOCUMENT_STATUSES = ['uploading', 'queued', 'processing', 'ready', 'failed'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

const documentSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    filename: { type: String, required: true, trim: true, maxlength: 200 },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    s3Key: { type: String, required: true },
    status: { type: String, enum: DOCUMENT_STATUSES, required: true, default: 'uploading' },
    // Shown to the user when status is "failed".
    error: { type: String, default: null },
    chunkCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

documentSchema.index({ workspaceId: 1, createdAt: -1 });
// Serves the stale-upload cleanup: "uploading" records older than a cutoff.
documentSchema.index({ status: 1, createdAt: 1 });

export const DocumentModel = model('Document', documentSchema);
