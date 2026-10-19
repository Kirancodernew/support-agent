import { Router } from 'express';
import { z } from '@support-agent/config';
import { DocumentModel } from '@support-agent/db';
import { getAuth, requireAuth } from '../auth/require-auth';
import type { AppDeps } from '../deps';
import { parseBody } from '../lib/validate';

const searchSchema = z.object({
  query: z.string().trim().min(1, 'Type a question').max(500),
  limit: z.number().int().min(1).max(10).default(5),
});

/** Test search: the passages from this workspace's documents closest in meaning to a question. */
export function searchRouter({ llm, retriever }: Pick<AppDeps, 'llm' | 'retriever'>) {
  const router = Router();
  router.use(requireAuth);

  router.post('/', async (req, res) => {
    const { workspaceId } = getAuth(req);
    const { query, limit } = parseBody(searchSchema, req.body);

    const [vector] = await llm.embed([query], 'query');
    if (!vector) throw new Error('embedding returned no vector');
    const hits = await retriever.search(workspaceId, vector, limit);

    // Attach filenames; scoped to the workspace as a second line of defence.
    const docs = await DocumentModel.find({ _id: { $in: hits.map((h) => h.documentId) }, workspaceId }, { filename: 1 });
    const names = new Map(docs.map((d) => [String(d._id), d.filename]));

    res.json({
      results: hits
        .filter((h) => names.has(h.documentId))
        .map((h) => ({ ...h, filename: names.get(h.documentId) })),
    });
  });

  return router;
}
