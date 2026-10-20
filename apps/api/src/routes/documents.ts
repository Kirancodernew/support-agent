import path from 'node:path';
import { Router } from 'express';
import { z } from '@support-agent/config';
import { ChunkModel, DocumentModel, isValidObjectId } from '@support-agent/db';
import { getAuth, requireAuth } from '../auth/require-auth';
import type { AppDeps } from '../deps';
import { HttpError } from '../lib/http-error';
import { forbidInDemo } from '../lib/demo';
import { parseBody } from '../lib/validate';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENTS = 20;

// The content type comes from the extension, decided by us: browsers often send none for .md.
const FILE_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
};

const createSchema = z.object({
  filename: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((name) => path.extname(name).toLowerCase() in FILE_TYPES, 'Upload a PDF, TXT or Markdown file'),
  size: z.number().int().positive().max(MAX_FILE_BYTES, 'Files can be up to 10 MB'),
});

type DocumentDoc = {
  _id: unknown;
  filename: string;
  size: number;
  status: string;
  error?: string | null;
  chunkCount: number;
  createdAt: Date;
};

const toPublic = (d: DocumentDoc) => ({
  id: String(d._id),
  filename: d.filename,
  size: d.size,
  status: d.status,
  error: d.error ?? null,
  chunkCount: d.chunkCount,
  createdAt: d.createdAt,
});

const notFound = () => new HttpError(404, 'not_found', 'Document not found');

export function documentsRouter({ storage, ingestQueue }: Pick<AppDeps, 'storage' | 'ingestQueue'>) {
  const router = Router();
  router.use(requireAuth);

  // Step 1: create the record and hand the browser a one-time upload form for S3.
  router.post('/', forbidInDemo('Uploading documents'), async (req, res) => {
    const { workspaceId } = getAuth(req);
    const { filename, size } = parseBody(createSchema, req.body);

    const count = await DocumentModel.countDocuments({ workspaceId });
    if (count >= MAX_DOCUMENTS) {
      throw new HttpError(409, 'document_limit', `You can have at most ${MAX_DOCUMENTS} documents. Delete one first.`);
    }

    const ext = path.extname(filename).toLowerCase();
    const contentType = FILE_TYPES[ext] ?? 'application/octet-stream';
    const doc = new DocumentModel({ workspaceId, filename, size, contentType, s3Key: 'pending', status: 'uploading' });
    // The key is built from ids we control, never from the user's filename (no path tricks).
    doc.s3Key = `workspaces/${workspaceId}/documents/${String(doc._id)}${ext}`;
    await doc.save();

    const upload = await storage.presignUpload(doc.s3Key, contentType, MAX_FILE_BYTES);
    res.status(201).json({ document: toPublic(doc), upload });
  });

  // Step 2: the browser uploaded to S3; check the file really is there, then queue processing.
  router.post('/:id/complete', forbidInDemo('Uploading documents'), async (req, res) => {
    const { workspaceId } = getAuth(req);
    if (!isValidObjectId(req.params.id)) throw notFound();
    const doc = await DocumentModel.findOne({ _id: req.params.id, workspaceId });
    if (!doc) throw notFound();
    if (doc.status !== 'uploading') throw new HttpError(409, 'already_completed', 'This upload was already completed');
    if (!(await storage.exists(doc.s3Key))) {
      throw new HttpError(409, 'upload_missing', 'The file has not finished uploading. Try again.');
    }

    // Conditional update: if two "complete" calls race, only one flips the status and enqueues.
    const updated = await DocumentModel.findOneAndUpdate(
      { _id: doc._id, status: 'uploading' },
      { status: 'queued' },
      { returnDocument: 'after' },
    );
    if (!updated) throw new HttpError(409, 'already_completed', 'This upload was already completed');
    await ingestQueue.enqueue(String(updated._id));
    res.json({ document: toPublic(updated) });
  });

  router.get('/', async (req, res) => {
    const { workspaceId } = getAuth(req);
    const docs = await DocumentModel.find({ workspaceId }).sort({ createdAt: -1 });
    res.json({ documents: docs.map(toPublic) });
  });

  router.delete('/:id', forbidInDemo('Deleting documents'), async (req, res) => {
    const { workspaceId } = getAuth(req);
    if (!isValidObjectId(req.params.id)) throw notFound();
    const doc = await DocumentModel.findOneAndDelete({ _id: req.params.id, workspaceId });
    if (!doc) throw notFound();
    // Record first, then its chunks and file. The worker re-checks the record before saving
    // chunks, so a document deleted mid-processing doesn't leave orphans behind.
    await ChunkModel.deleteMany({ documentId: doc._id });
    await storage.remove(doc.s3Key).catch((err: unknown) => req.log.warn({ err }, 'S3 delete failed'));
    res.status(204).end();
  });

  return router;
}
