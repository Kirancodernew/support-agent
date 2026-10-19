import mongoose from 'mongoose';
import { ChunkModel } from './models/chunk';

export const VECTOR_INDEX = 'chunks_vector';

const definition = (dimensions: number) => ({
  fields: [
    { type: 'vector', path: 'embedding', numDimensions: dimensions, similarity: 'cosine' },
    // Every tenant search filters by workspace inside the index.
    { type: 'filter', path: 'workspaceId' },
    // Lets the worker check that a new document's chunks are searchable before calling it ready.
    { type: 'filter', path: 'documentId' },
  ],
});

/**
 * Creates the Atlas Vector Search index on chunks, or updates it if its definition changed.
 * Atlas builds/rebuilds it in the background; searches keep working on the old version meanwhile.
 */
export async function ensureVectorIndex(dimensions: number): Promise<'created' | 'updated' | 'exists'> {
  const collection = mongoose.connection.collection(ChunkModel.collection.name);
  const wanted = definition(dimensions);
  const [existing] = (await collection.listSearchIndexes(VECTOR_INDEX).toArray()) as {
    latestDefinition?: { fields?: unknown };
  }[];

  if (!existing) {
    // createSearchIndex fails if the collection doesn't exist yet.
    await mongoose.connection.createCollection(ChunkModel.collection.name).catch(() => undefined);
    await collection.createSearchIndex({ name: VECTOR_INDEX, type: 'vectorSearch', definition: wanted });
    return 'created';
  }
  const current = JSON.stringify(existing.latestDefinition?.fields ?? []);
  if (current !== JSON.stringify(wanted.fields)) {
    await collection.updateSearchIndex(VECTOR_INDEX, wanted);
    return 'updated';
  }
  return 'exists';
}
