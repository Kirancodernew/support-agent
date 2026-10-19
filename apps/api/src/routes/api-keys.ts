import { Router } from 'express';
import { z } from '@support-agent/config';
import { ApiKeyModel, isValidObjectId } from '@support-agent/db';
import { getAuth, requireAuth } from '../auth/require-auth';
import { generateApiKey } from '../lib/api-key';
import { HttpError } from '../lib/http-error';
import { parseBody } from '../lib/validate';

const MAX_ACTIVE_KEYS = 10;

const createSchema = z.object({ name: z.string().trim().min(1, 'Give the key a name').max(50) });

type ApiKeyDoc = { _id: unknown; name: string; prefix: string; createdAt: Date; lastUsedAt?: Date | null };

const toPublic = (k: ApiKeyDoc) => ({
  id: String(k._id),
  name: k.name,
  prefix: k.prefix,
  createdAt: k.createdAt,
  lastUsedAt: k.lastUsedAt ?? null,
});

export const apiKeysRouter = Router();
apiKeysRouter.use(requireAuth);

// Every query below is scoped to the caller's workspaceId: one business never sees another's keys.

apiKeysRouter.get('/', async (req, res) => {
  const { workspaceId } = getAuth(req);
  const keys = await ApiKeyModel.find({ workspaceId, revokedAt: null }).sort({ createdAt: -1 });
  res.json({ apiKeys: keys.map(toPublic) });
});

apiKeysRouter.post('/', async (req, res) => {
  const { workspaceId } = getAuth(req);
  const { name } = parseBody(createSchema, req.body);

  const active = await ApiKeyModel.countDocuments({ workspaceId, revokedAt: null });
  if (active >= MAX_ACTIVE_KEYS) {
    throw new HttpError(409, 'key_limit', `You can have at most ${MAX_ACTIVE_KEYS} active keys. Revoke one first.`);
  }

  const { key, hash, prefix } = generateApiKey();
  const apiKey = await ApiKeyModel.create({ workspaceId, name, prefix, keyHash: hash });
  // The only time the full key leaves the server.
  res.status(201).json({ key, apiKey: toPublic(apiKey) });
});

apiKeysRouter.delete('/:id', async (req, res) => {
  const { workspaceId } = getAuth(req);
  const { id } = req.params;
  // Same 404 for "doesn't exist" and "belongs to another workspace": no hint that the id is real.
  if (!isValidObjectId(id)) throw new HttpError(404, 'not_found', 'API key not found');

  // Soft delete: keep the record (for audit) but the key stops working.
  const result = await ApiKeyModel.updateOne({ _id: id, workspaceId, revokedAt: null }, { revokedAt: new Date() });
  if (result.matchedCount === 0) throw new HttpError(404, 'not_found', 'API key not found');
  res.status(204).end();
});
