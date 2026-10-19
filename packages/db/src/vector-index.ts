import mongoose from 'mongoose';
import { ChunkModel } from './models/chunk';

export const VECTOR_INDEX = 'chunks_vector';

/**
 * Creates the Atlas Vector Search index on chunks if it doesn't exist yet.
 * workspaceId is a filter field, so every search can be restricted to one tenant inside the index.
 * Atlas builds it in the background (about a minute); chunks saved before that are indexed too.
 */
export async function ensureVectorIndex(dimensions: number) {
  const collection = mongoose.connection.collection(ChunkModel.collection.name);
  const existing = await collection.listSearchIndexes(VECTOR_INDEX).toArray();
  if (existing.length > 0) return 'exists';

  // createSearchIndex fails if the collection doesn't exist yet.
  await mongoose.connection.createCollection(ChunkModel.collection.name).catch(() => undefined);
  await collection.createSearchIndex({
    name: VECTOR_INDEX,
    type: 'vectorSearch',
    definition: {
      fields: [
        { type: 'vector', path: 'embedding', numDimensions: dimensions, similarity: 'cosine' },
        { type: 'filter', path: 'workspaceId' },
      ],
    },
  });
  return 'created';
}
