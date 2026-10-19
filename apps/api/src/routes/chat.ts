import { Router } from 'express';
import { z } from '@support-agent/config';
import { ConversationModel, isValidObjectId, MAX_MESSAGES_PER_CONVERSATION, WorkspaceModel } from '@support-agent/db';
import { getAuth, requireAuth } from '../auth/require-auth';
import { streamAnswer } from '../chat/answer';
import type { AppDeps } from '../deps';
import { HttpError } from '../lib/http-error';
import { parseBody } from '../lib/validate';

export const CHAT_MESSAGES_PER_MINUTE = 20;

const chatSchema = z.object({
  conversationId: z.string().optional(),
  message: z.string().trim().min(1, 'Type a message').max(1000, 'Keep messages under 1000 characters'),
});

/** The owner testing their agent from the dashboard. */
export function chatRouter(deps: AppDeps) {
  const router = Router();
  router.use(requireAuth);

  router.post('/', async (req, res) => {
    const { workspaceId } = getAuth(req);
    const body = parseBody(chatSchema, req.body);

    // Each answer costs a model call; cap it per workspace so one user can't drain the quota.
    const limit = await deps.rateLimiter.hit(`chat:${workspaceId}`, CHAT_MESSAGES_PER_MINUTE, 60);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      throw new HttpError(429, 'rate_limited', `Too many messages. Try again in ${limit.retryAfterSeconds}s.`);
    }

    // Continue a conversation (only one of this workspace's) or start a new one.
    let conversation;
    if (body.conversationId) {
      if (!isValidObjectId(body.conversationId)) throw new HttpError(404, 'not_found', 'Conversation not found');
      conversation = await ConversationModel.findOne({ _id: body.conversationId, workspaceId });
      if (!conversation) throw new HttpError(404, 'not_found', 'Conversation not found');
      if (conversation.messages.length >= MAX_MESSAGES_PER_CONVERSATION) {
        throw new HttpError(409, 'conversation_full', 'This conversation is full. Start a new one.');
      }
    } else {
      conversation = new ConversationModel({ workspaceId, channel: 'dashboard', title: body.message.slice(0, 80), messages: [] });
    }
    const workspace = await WorkspaceModel.findById(workspaceId, { name: 1, orderWebhookUrl: 1, webhookSecret: 1, notifyEmail: 1 });
    if (!workspace) throw new HttpError(401, 'unauthorized', 'Please log in');

    await streamAnswer(deps, {
      req,
      res,
      workspace: { ...workspace.toObject(), id: workspaceId },
      conversation,
      message: body.message,
    });
  });

  return router;
}
