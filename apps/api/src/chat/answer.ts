import type { Request, Response } from 'express';
import { ConversationModel, DocumentModel } from '@support-agent/db';
import type { ChatTurn } from '@support-agent/llm';
import type { AppDeps } from '../deps';
import { buildSystemPrompt, buildUserTurn, HISTORY_MESSAGES, NO_ANSWER, retrievalQuery } from './prompt';

const TOP_K = 5;

type ConversationDoc = InstanceType<typeof ConversationModel>;

/** One Server-Sent Event: an event name and a JSON payload, ended by a blank line. */
const sendEvent = (res: Response, event: string, data: unknown) =>
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/**
 * The RAG answer, shared by the dashboard chat and the website widget:
 * retrieve this workspace's passages → stream a grounded answer as SSE → save both messages.
 * The caller has already authenticated, rate-limited and loaded (or created) the conversation.
 */
export async function streamAnswer(
  { llm, retriever, chat }: Pick<AppDeps, 'llm' | 'retriever' | 'chat'>,
  {
    req,
    res,
    workspace,
    conversation,
    message,
  }: {
    req: Request;
    res: Response;
    workspace: { id: string; name: string };
    conversation: ConversationDoc;
    message: string;
  },
) {
  const history: ChatTurn[] = conversation.messages
    .slice(-HISTORY_MESSAGES)
    .map((m) => ({ role: m.role as ChatTurn['role'], text: m.content }));

  // Retrieve: embed the question, find the closest passages in this workspace only.
  const [vector] = await llm.embed([retrievalQuery(history, message)], 'query');
  if (!vector) throw new Error('embedding returned no vector');
  const hits = await retriever.search(workspace.id, vector, TOP_K);
  const docs = await DocumentModel.find(
    { _id: { $in: hits.map((h) => h.documentId) }, workspaceId: workspace.id },
    { filename: 1 },
  );
  const filenames = new Map(docs.map((d) => [String(d._id), d.filename]));
  // Weak matches are dropped: better "I don't know" than an answer built on unrelated text.
  const sources = hits
    .filter((h) => filenames.has(h.documentId) && h.score >= chat.minScore)
    .map((h, i) => ({ n: i + 1, ...h, filename: filenames.get(h.documentId)! }));
  const citedSources = sources.map(({ n, documentId, filename, position, score }) => ({
    n,
    documentId,
    filename,
    position,
    score,
  }));

  conversation.messages.push({ role: 'user', content: message });
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
        turns: [...history, { role: 'user', text: buildUserTurn(message, sources) }],
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
    req.log.info({ firstTokenMs, totalMs, sources: sources.length, channel: conversation.channel }, 'chat answered');
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
}
