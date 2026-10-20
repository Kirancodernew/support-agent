import { Router, type Response } from 'express';
import { z } from '@support-agent/config';
import { ConversationModel, isValidObjectId, MAX_MESSAGES_PER_CONVERSATION, WorkspaceModel } from '@support-agent/db';
import { streamAnswer } from '../chat/answer';
import { feedbackSchema, setFeedback } from './conversations';
import type { AppDeps } from '../deps';
import { HttpError } from '../lib/http-error';
import type { RateLimiter } from '../lib/rate-limit';
import { parseBody } from '../lib/validate';

// A publishable key is public, so anyone can call these endpoints with it. Limits are what keep
// abuse cheap and bounded: per visitor, per workspace, and a daily ceiling per workspace.
export const WIDGET_LIMITS = {
  perVisitorPerMinute: 10,
  perWorkspacePerMinute: 60,
  perWorkspacePerDay: 500,
};

const key = z.string().regex(/^pk_live_[A-Za-z0-9_-]{10,64}$/, 'Invalid widget key');

const chatSchema = z.object({
  key,
  // Random id the widget stores per browser. Clients choose it, so it groups chats; it doesn't authenticate.
  visitorId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/, 'Invalid visitor id'),
  conversationId: z.string().optional(),
  message: z.string().trim().min(1, 'Type a message').max(1000, 'Keep messages under 1000 characters'),
  // The website the widget is shown on, as the browser reports it to the widget page.
  pageOrigin: z.string().max(200).optional(),
});

const unknownKey = () => new HttpError(404, 'unknown_key', "This chat widget isn't set up correctly.");

async function enforce(rateLimiter: RateLimiter, res: Response, limitKey: string, limit: number, windowSeconds: number) {
  const result = await rateLimiter.hit(limitKey, limit, windowSeconds);
  if (!result.allowed) {
    res.setHeader('Retry-After', String(result.retryAfterSeconds));
    throw new HttpError(429, 'rate_limited', `Too many messages. Try again in ${result.retryAfterSeconds}s.`);
  }
}

/** Endpoints the website widget calls. No login: the publishable key says which workspace. */
export function publicRouter(deps: AppDeps) {
  const router = Router();

  // Read by the widget page's server before rendering, to tell the browser which sites may frame it.
  router.get('/widget-config', async (req, res) => {
    const parsed = key.safeParse(req.query.key);
    if (!parsed.success) throw unknownKey();
    const workspace = await WorkspaceModel.findOne({ publishableKey: parsed.data }, { name: 1, allowedOrigins: 1 });
    if (!workspace) throw unknownKey();
    res.json({ name: workspace.name, allowedOrigins: workspace.allowedOrigins });
  });

  router.post('/chat', async (req, res) => {
    const body = parseBody(chatSchema, req.body);
    const workspace = await WorkspaceModel.findOne(
      { publishableKey: body.key },
      { name: 1, allowedOrigins: 1, orderWebhookUrl: 1, webhookSecret: 1, notifyEmail: 1 },
    );
    if (!workspace) throw unknownKey();
    const workspaceId = String(workspace._id);

    // Defence in depth: the real guard is the browser refusing to show the widget page on other
    // sites (CSP frame-ancestors). Framed by our own site (the dashboard preview) is also fine.
    const ownSite = body.pageOrigin !== undefined && body.pageOrigin === req.get('origin');
    if (!ownSite && !workspace.allowedOrigins.includes(body.pageOrigin ?? '')) {
      throw new HttpError(403, 'origin_not_allowed', "This website isn't allowed to use this chat widget.");
    }

    await enforce(deps.rateLimiter, res, `widget:visitor:${workspaceId}:${body.visitorId}`, WIDGET_LIMITS.perVisitorPerMinute, 60);
    await enforce(deps.rateLimiter, res, `widget:minute:${workspaceId}`, WIDGET_LIMITS.perWorkspacePerMinute, 60);
    await enforce(deps.rateLimiter, res, `widget:day:${workspaceId}`, WIDGET_LIMITS.perWorkspacePerDay, 24 * 60 * 60);

    // A visitor can only continue their own conversations.
    let conversation;
    if (body.conversationId) {
      if (!isValidObjectId(body.conversationId)) throw new HttpError(404, 'not_found', 'Conversation not found');
      conversation = await ConversationModel.findOne({ _id: body.conversationId, workspaceId, visitorId: body.visitorId });
      if (!conversation) throw new HttpError(404, 'not_found', 'Conversation not found');
      if (conversation.messages.length >= MAX_MESSAGES_PER_CONVERSATION) {
        throw new HttpError(409, 'conversation_full', 'This conversation is full. Start a new one.');
      }
    } else {
      conversation = new ConversationModel({
        workspaceId,
        channel: 'widget',
        visitorId: body.visitorId,
        title: body.message.slice(0, 80),
        messages: [],
      });
    }

    await streamAnswer(deps, {
      req,
      res,
      workspace: { ...workspace.toObject(), id: workspaceId },
      conversation,
      message: body.message,
    });
  });

  // A website visitor rating an answer. Only in their own conversation (same visitor id).
  router.post('/feedback', async (req, res) => {
    const body = parseBody(
      feedbackSchema.extend({ key, visitorId: chatSchema.shape.visitorId, conversationId: z.string() }),
      req.body,
    );
    const workspace = await WorkspaceModel.findOne({ publishableKey: body.key }, { _id: 1 });
    if (!workspace) throw unknownKey();
    await enforce(deps.rateLimiter, res, `widget:feedback:${String(workspace._id)}:${body.visitorId}`, 30, 60);
    await setFeedback({ workspaceId: workspace._id, visitorId: body.visitorId }, body.conversationId, body);
    res.status(204).end();
  });

  return router;
}
