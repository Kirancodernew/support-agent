import { Router } from 'express';
import { z } from '@support-agent/config';
import { ConversationModel, InboxItemModel, isValidObjectId } from '@support-agent/db';
import { getAuth, requireAuth } from '../auth/require-auth';
import { HttpError } from '../lib/http-error';
import { parseBody } from '../lib/validate';

type InboxDoc = InstanceType<typeof InboxItemModel>;

const toPublic = (i: InboxDoc, transcript?: { role: string; content: string }[]) => ({
  id: String(i._id),
  number: `T-${String(i.number).padStart(4, '0')}`,
  kind: i.kind,
  summary: i.summary,
  details: i.details ?? null,
  customerEmail: i.customerEmail ?? null,
  customerPhone: i.customerPhone ?? null,
  preferredTime: i.preferredTime ?? null,
  status: i.status,
  createdAt: i.createdAt,
  conversationId: String(i.conversationId),
  transcript,
});

/** What the agent handed to the team: tickets, call-back requests and handoffs. */
export const inboxRouter = Router();
inboxRouter.use(requireAuth);

inboxRouter.get('/', async (req, res) => {
  const { workspaceId } = getAuth(req);
  const status = req.query.status === 'closed' ? 'closed' : 'open';
  const items = await InboxItemModel.find({ workspaceId, status }).sort({ createdAt: -1 }).limit(100);
  // The conversation each item came from, so the team sees the whole context.
  const conversations = await ConversationModel.find(
    { _id: { $in: items.map((i) => i.conversationId) }, workspaceId },
    { messages: { role: 1, content: 1 } },
  );
  const byId = new Map(conversations.map((c) => [String(c._id), c.messages.map((m) => ({ role: m.role, content: m.content }))]));
  res.json({ items: items.map((i) => toPublic(i, byId.get(String(i.conversationId)))) });
});

inboxRouter.patch('/:id', async (req, res) => {
  const { workspaceId } = getAuth(req);
  const { status } = parseBody(z.object({ status: z.enum(['open', 'closed']) }), req.body);
  if (!isValidObjectId(req.params.id)) throw new HttpError(404, 'not_found', 'Item not found');
  const item = await InboxItemModel.findOneAndUpdate({ _id: req.params.id, workspaceId }, { status }, { returnDocument: 'after' });
  if (!item) throw new HttpError(404, 'not_found', 'Item not found');
  res.json({ item: toPublic(item) });
});
