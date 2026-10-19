import { Router, type Response } from 'express';
import { z } from '@support-agent/config';
import {
  ConversationModel,
  DocumentModel,
  isValidObjectId,
  MAX_MESSAGES_PER_CONVERSATION,
  WorkspaceModel,
} from '@support-agent/db';
import type { ChatTurn } from '@support-agent/llm';
import { getAuth, requireAuth } from '../auth/require-auth';
import { buildSystemPrompt, buildUserTurn, HISTORY_MESSAGES, NO_ANSWER, retrievalQuery } from '../chat/prompt';
import type { AppDeps } from '../deps';
import { HttpError } from '../lib/http-error';
import { parseBody } from '../lib/validate';

export const CHAT_MESSAGES_PER_MINUTE = 20;
const TOP_K = 5;

const chatSchema = z.object({
  conversationId: z.string().optional(),
  message: z.string().trim().min(1, 'Type a message').max(1000, 'Keep messages under 1000 characters'),
});

/** One Server-Sent Event: an event name and a JSON payload, ended by a blank line. */
const sendEvent = (res: Response, event: string, data: unknown) =>
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

export function chatRouter({ llm, retriever, rateLimiter, chat }: Pick<AppDeps, 'llm' | 'retriever' | 'rateLimiter' | 'chat'>) {
  const router = Router();
  router.use(requireAuth);

  router.post('/', async (req, res) => {
    const { workspaceId } = getAuth(req);
    const body = parseBody(chatSchema, req.body);

    // Each answer costs a model call; cap it per workspace so one user can't drain the quota.
    const limit = await rateLimiter.hit(`chat:${workspaceId}`, CHAT_MESSAGES_PER_MINUTE, 60);
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
      conversation = new ConversationModel({ workspaceId, title: body.message.slice(0, 80), messages: [] });
    }
    const workspace = await WorkspaceModel.findById(workspaceId, { name: 1 });
    if (!workspace) throw new HttpError(401, 'unauthorized', 'Please log in');

    const history: ChatTurn[] = conversation.messages
      .slice(-HISTORY_MESSAGES)
      .map((m) => ({ role: m.role as ChatTurn['role'], text: m.content }));

    // Retrieve: embed the question, find the closest passages in this workspace only.
    const [vector] = await llm.embed([retrievalQuery(history, body.message)], 'query');
    if (!vector) throw new Error('embedding returned no vector');
    const hits = await retriever.search(workspaceId, vector, TOP_K);
    const docs = await DocumentModel.find({ _id: { $in: hits.map((h) => h.documentId) }, workspaceId }, { filename: 1 });
    const filenames = new Map(docs.map((d) => [String(d._id), d.filename]));
    // Weak matches are dropped: better "I don't know" than an answer built on unrelated text.
    const sources = hits
      .filter((h) => filenames.has(h.documentId) && h.score >= chat.minScore)
      .map((h, i) => ({ n: i + 1, ...h, filename: filenames.get(h.documentId)! }));
    const citedSources = sources.map(({ n, documentId, filename, position, score }) => ({ n, documentId, filename, position, score }));

    conversation.messages.push({ role: 'user', content: body.message });
    await conversation.save();

    // From here the response is a stream: the status is sent, so failures become an "error" event.
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // tells proxies not to buffer the stream
    });
    res.flushHeaders();
    sendEvent(res, 'meta', { conversationId: String(conversation._id), sources: citedSources });

    // If the user leaves mid-answer, stop generating (and paying for) the rest.
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });

    const started = Date.now();
    let firstTokenMs: number | undefined;
    let answer = '';
    const saveAnswer = (extra: { totalMs?: number; interrupted?: boolean }) =>
      ConversationModel.updateOne(
        { _id: conversation._id },
        {
          $push: {
            messages: {
              role: 'assistant',
              content: answer,
              sources: citedSources.map(({ n: _n, ...s }) => s),
              firstTokenMs,
              ...extra,
            },
          },
        },
      );

    try {
      if (sources.length === 0) {
        answer = NO_ANSWER;
        firstTokenMs = Date.now() - started;
        sendEvent(res, 'token', { text: answer });
      } else {
        const stream = llm.generateStream({
          system: buildSystemPrompt(workspace.name),
          turns: [...history, { role: 'user', text: buildUserTurn(body.message, sources) }],
          signal: abort.signal,
        });
        for await (const piece of stream) {
          firstTokenMs ??= Date.now() - started;
          answer += piece;
          sendEvent(res, 'token', { text: piece });
        }
      }
      const totalMs = Date.now() - started;
      await saveAnswer({ totalMs });
      req.log.info({ firstTokenMs, totalMs, sources: sources.length }, 'chat answered');
      sendEvent(res, 'done', { firstTokenMs, totalMs });
    } catch (err) {
      if (abort.signal.aborted) {
        if (answer) await saveAnswer({ interrupted: true }).catch(() => undefined);
        return;
      }
      req.log.error({ err }, 'chat failed');
      sendEvent(res, 'error', { message: 'The assistant is unavailable right now. Please try again.' });
    } finally {
      res.end();
    }
  });

  return router;
}
