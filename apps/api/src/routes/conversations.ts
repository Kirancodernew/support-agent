import { Router } from 'express';
import { z } from '@support-agent/config';
import { ConversationModel, isValidObjectId, toObjectId } from '@support-agent/db';
import { getAuth, requireAuth } from '../auth/require-auth';
import { HttpError } from '../lib/http-error';
import { parseBody } from '../lib/validate';

const PAGE_SIZE = 20;

const listSchema = z.object({
  filter: z.enum(['all', 'needs_human', 'disliked']).default('all'),
  cursor: z.string().regex(/^\d+_[a-f0-9]{24}$/).optional(),
});

export const feedbackSchema = z.object({
  messageId: z.string().refine(isValidObjectId, 'Invalid message'),
  value: z.enum(['up', 'down']).nullable(),
});

/**
 * Sets 👍/👎 on one *assistant* message of a conversation the caller may access (`scope`).
 * $elemMatch makes sure id and role match on the same array element before "$" updates it.
 */
export async function setFeedback(scope: Record<string, unknown>, conversationId: string, body: z.infer<typeof feedbackSchema>) {
  if (!isValidObjectId(conversationId)) throw new HttpError(404, 'not_found', 'Conversation not found');
  const result = await ConversationModel.updateOne(
    { ...scope, _id: conversationId, messages: { $elemMatch: { _id: toObjectId(body.messageId), role: 'assistant' } } },
    { $set: { 'messages.$.feedback': body.value } },
    // A rating isn't new activity: keep the conversation's place in the list and its period.
    { timestamps: false },
  );
  if (result.matchedCount === 0) throw new HttpError(404, 'not_found', 'Message not found');
}

type ListRow = {
  _id: unknown;
  title: string;
  channel: string;
  visitorId?: string | null;
  needsHuman: boolean;
  updatedAt: Date;
  messages: { role: string; feedback?: string | null }[];
};

/** The owner's view of every conversation, newest first. */
export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);

conversationsRouter.get('/', async (req, res) => {
  const { workspaceId } = getAuth(req);
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, 'validation_error', 'Invalid filter or cursor');
  const { filter, cursor } = parsed.data;

  const query: Record<string, unknown> = { workspaceId };
  if (filter === 'needs_human') query.needsHuman = true;
  if (filter === 'disliked') query['messages.feedback'] = 'down';
  // Cursor = (updatedAt, _id) of the last row seen. "Older than that row" stays correct even when
  // new chats arrive, unlike page numbers (skip), which would shift rows and repeat them.
  if (cursor) {
    const [time, id] = cursor.split('_');
    const updatedAt = new Date(Number(time));
    query.$or = [{ updatedAt: { $lt: updatedAt } }, { updatedAt, _id: { $lt: toObjectId(id!) } }];
  }

  const rows = await ConversationModel.find(query, {
    title: 1,
    channel: 1,
    visitorId: 1,
    needsHuman: 1,
    updatedAt: 1,
    'messages.role': 1,
    'messages.feedback': 1,
  })
    .sort({ updatedAt: -1, _id: -1 })
    .limit(PAGE_SIZE + 1)
    .lean<ListRow[]>();

  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  res.json({
    items: page.map((c) => ({
      id: String(c._id),
      title: c.title,
      channel: c.channel,
      visitor: c.visitorId ? c.visitorId.slice(0, 8) : null,
      questions: c.messages.filter((m) => m.role === 'user').length,
      needsHuman: c.needsHuman,
      disliked: c.messages.some((m) => m.feedback === 'down'),
      updatedAt: c.updatedAt,
    })),
    nextCursor: rows.length > PAGE_SIZE && last ? `${last.updatedAt.getTime()}_${String(last._id)}` : null,
  });
});

conversationsRouter.get('/:id', async (req, res) => {
  const { workspaceId } = getAuth(req);
  if (!isValidObjectId(req.params.id)) throw new HttpError(404, 'not_found', 'Conversation not found');
  const c = await ConversationModel.findOne({ _id: req.params.id, workspaceId }).lean();
  if (!c) throw new HttpError(404, 'not_found', 'Conversation not found');
  res.json({
    id: String(c._id),
    title: c.title,
    channel: c.channel,
    needsHuman: c.needsHuman,
    messages: c.messages.map((m) => ({
      id: String(m._id),
      role: m.role,
      content: m.content,
      sources: (m.sources ?? []).map((s) => s.filename),
      actions: m.actions ?? [],
      feedback: m.feedback ?? null,
      firstTokenMs: m.firstTokenMs ?? null,
      unanswered: m.unanswered ?? false,
      createdAt: m.createdAt,
    })),
  });
});

// The owner rating answers while testing in the dashboard chat.
conversationsRouter.post('/:id/feedback', async (req, res) => {
  const { workspaceId } = getAuth(req);
  await setFeedback({ workspaceId }, req.params.id, parseBody(feedbackSchema, req.body));
  res.status(204).end();
});
