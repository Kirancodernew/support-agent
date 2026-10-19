import { model, Schema } from 'mongoose';

const chunkSchema = new Schema(
  {
    // Copied from the document so vector search can filter by tenant without a join.
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    documentId: { type: Schema.Types.ObjectId, ref: 'Document', required: true, index: true },
    // Position in the document, so neighbouring chunks can be found and order kept.
    position: { type: Number, required: true },
    text: { type: String, required: true },
    embedding: { type: [Number], required: true },
  },
  { timestamps: true },
);

export const ChunkModel = model('Chunk', chunkSchema);
