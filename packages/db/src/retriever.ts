import { ChunkModel } from './models/chunk';
import { VECTOR_INDEX } from './vector-index';
import { toObjectId } from './connect';

export type SearchHit = { documentId: string; position: number; text: string; score: number };

/** Finds the chunks closest in meaning to a query vector, within one workspace only. */
export interface Retriever {
  search(workspaceId: string, vector: number[], limit: number): Promise<SearchHit[]>;
}

/**
 * True once Atlas Vector Search can find this document's chunks. Atlas indexes new writes a few
 * seconds after they're saved, so a document is only "ready" when this says yes.
 */
export async function isDocumentSearchable(documentId: string, vector: number[]) {
  const rows = await ChunkModel.aggregate([
    {
      $vectorSearch: {
        index: VECTOR_INDEX,
        path: 'embedding',
        queryVector: vector,
        numCandidates: 10,
        limit: 1,
        filter: { documentId: toObjectId(documentId) },
      },
    },
    { $project: { _id: 1 } },
  ]);
  return rows.length > 0;
}

export function createAtlasRetriever(): Retriever {
  return {
    async search(workspaceId, vector, limit) {
      const rows = await ChunkModel.aggregate<SearchHit & { documentId: unknown }>([
        {
          $vectorSearch: {
            index: VECTOR_INDEX,
            path: 'embedding',
            queryVector: vector,
            // Approximate search looks at this many candidates, then returns the best `limit`.
            numCandidates: Math.min(limit * 20, 1000),
            limit,
            // Applied inside the index: other tenants' chunks are never even candidates.
            filter: { workspaceId: toObjectId(workspaceId) },
          },
        },
        { $project: { _id: 0, documentId: 1, position: 1, text: 1, score: { $meta: 'vectorSearchScore' } } },
      ]);
      return rows.map((r) => ({ ...r, documentId: String(r.documentId) }));
    },
  };
}
